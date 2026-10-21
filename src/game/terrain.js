/**
 * The terrain ribbon.
 *
 * The land is built as a ribbon that follows the road instead of as a square
 * grid: every cross section is anchored to the road at that point, so the
 * ground always meets the tarmac exactly, the verge is always finely
 * tessellated and the mountains rise out of the valley the road runs through.
 *
 * The height comes from `surfaceHeight`, the same function the physics uses,
 * so the wheels always touch the mesh.
 *
 * Chunks stream in ahead of the player and are released behind, and the row
 * spacing grows with the distance, so the vertex count stays flat no matter
 * how far the player drives.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { roadOffset, roadHalfWidth, roadHeight, surfaceHeight } from './road.js';
import { groundColour } from './palette.js';
import { WATER_DROP } from './water.js';
import { fbm } from './noise.js';

/** How long a terrain chunk is along the road, in metres. */
export const TERRAIN_CHUNK_LENGTH = 384;
/** Chunks kept behind the player. */
export const TERRAIN_BEHIND = 2;
/** Chunks kept in front of the player. */
export const TERRAIN_AHEAD = 6;

/**
 * Distance from the edge of the road for each column of the ribbon.
 *
 * The spacing is deliberately uneven: fine close to the road where the
 * detail matters, coarse out in the mountains where the mesh is only a
 * silhouette.
 */
export const TERRAIN_COLUMNS = [
  0, 2.2, 5, 9, 14, 20, 28, 38, 50, 65, 84, 104, 126, 150, 176, 205, 236, 270, 306, 345, 388, 434, 484, 538, 596, 658, 725, 800, 880, 965,
];
/** Row spacing (metres) for the chunks close to the player. */
const ROW_NEAR = 5;
/** Row spacing for the middle distance. */
const ROW_MID = 10;
/** Row spacing for the far chunks. */
const ROW_FAR = 20;

/**
 * A deterministic random generator for one chunk.
 * @param {number} index
 * @param {number} seed
 * @returns {() => number}
 */
function chunkRandom(index, seed) {
  let a = (seed ^ (index * 0x9e3779b9)) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {{
 *   profile: import('./road.js').RoadProfile,
 *   scene: THREE.Scene,
 *   seed: number,
 *   terrainMaterial: THREE.Material,
 *   assets?: any,
 *   getImpostor?: (key: string) => any,
 * }} options
 */
export function createTerrainManager(options) {
  const { profile, scene, seed, terrainMaterial, assets } = options;
  /** @type {Map<number, { group: THREE.Group, mesh: THREE.Mesh }>} */
  const chunks = new Map();
  const colour = [0, 0, 0];
  const dummy = new THREE.Object3D();
  // The trees are baked into a texture when the assets are ready. A race can
  // start before they are, so the chunks are rebuilt once they are.
  let treesReady = false;

  /**
   * The row spacing for a chunk, based on how far away it is.
   * @param {number} distance
   */
  function rowStep(distance) {
    if (distance <= 1) return ROW_NEAR;
    if (distance <= 3) return ROW_MID;
    return ROW_FAR;
  }

  /**
   * Build one ribbon chunk.
   * @param {number} index
   * @param {number} distance
   */
  function buildChunk(index, distance) {
    const group = new THREE.Group();
    const startS = index * TERRAIN_CHUNK_LENGTH;
    // The rows have to end exactly on the chunk boundary, otherwise the
    // chunks tear apart where the level of detail changes.
    const wanted = rowStep(distance);
    // The rows have to end exactly on the chunk boundary, otherwise the
    // chunks tear apart where the level of detail changes.
    const rows = Math.max(2, Math.round(TERRAIN_CHUNK_LENGTH / wanted)) + 1;
    const step = TERRAIN_CHUNK_LENGTH / (rows - 1);
    const columns = TERRAIN_COLUMNS.length * 2 - 1; // mirrored around the road

    const positions = new Float32Array(rows * columns * 3);
    const normals = new Float32Array(rows * columns * 3);
    const uvs = new Float32Array(rows * columns * 2);
    const colors = new Float32Array(rows * columns * 3);
    const indices = [];

    // --- heights ---------------------------------------------------------
    // The height grid is filled first so the normals can be derived from the
    // neighbours instead of from extra noise lookups.
    const heights = new Float32Array(rows * columns);
    const laterals = new Float32Array(rows * columns);
    const centres = new Float32Array(rows);

    for (let r = 0; r < rows; r++) {
      const s = startS + r * step;
      const centre = roadOffset(profile, s);
      const half = roadHalfWidth(profile, s);
      centres[r] = centre;
      for (let c = 0; c < columns; c++) {
        // Column 0 is the left road edge, the last one the right road edge.
        const k = c - (columns - 1) / 2;
        const base = TERRAIN_COLUMNS[Math.abs(k)];
        const lateral = k < 0 ? -(base + half) : base + half;
        laterals[r * columns + c] = lateral;
        heights[r * columns + c] = surfaceHeight(profile, centre + lateral, s);
      }
    }

    // --- vertices --------------------------------------------------------
    for (let r = 0; r < rows; r++) {
      const s = startS + r * step;
      const centre = centres[r];
      const roadY = roadHeight(profile, s);
      for (let c = 0; c < columns; c++) {
        const i = r * columns + c;
        const lateral = laterals[i];
        const x = centre + lateral;
        const y = heights[i];
        const index = i * 3;
        positions[index] = x;
        positions[index + 1] = y;
        positions[index + 2] = s;

        // Tangents from the grid: one along the road, one across it.
        const rPrev = Math.max(0, r - 1);
        const rNext = Math.min(rows - 1, r + 1);
        const dz = (rNext - rPrev) * step || step;
        const dzx = centres[rNext] - centres[rPrev];
        const dzy = heights[rNext * columns + c] - heights[rPrev * columns + c];
        const cPrev = Math.max(0, c - 1);
        const cNext = Math.min(columns - 1, c + 1);
        const dx = laterals[r * columns + cNext] - laterals[r * columns + cPrev];
        const dxy = heights[r * columns + cNext] - heights[r * columns + cPrev];
        // cross(tz, tx)
        const nx = dzy * 0 - dz * dxy;
        const ny = dz * dx - dzx * 0;
        const nz = dzx * dxy - dzy * dx;
        const length = Math.hypot(nx, ny, nz) || 1;
        normals[index] = nx / length;
        normals[index + 1] = ny / length;
        normals[index + 2] = nz / length;

        const uvIndex = i * 2;
        uvs[uvIndex] = lateral / 12;
        uvs[uvIndex + 1] = s / 12;

        // Colour from the slope and the altitude.
        const slope = Math.min(1, Math.hypot(nx, nz) / Math.max(0.001, ny) / 1.9);
        const altitude = y - roadY;
        const dist = Math.abs(lateral) - roadHalfWidth(profile, s);
        const patch = fbm(x * 0.013, s * 0.013, 3, seed + 17) * 0.5 + 0.5;
        const rockPatch = fbm(x * 0.011, s * 0.011, 3, seed + 61) * 0.5 + 0.5;
        groundColour(slope, altitude, dist, patch, rockPatch, colour);
        colors[index] = colour[0];
        colors[index + 1] = colour[1];
        colors[index + 2] = colour[2];
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < columns - 1; c++) {
        const a = r * columns + c;
        const b = (r + 1) * columns + c;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, terrainMaterial);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);

    // The lakes: the same ribbon, but below the ground, so only the parts
    // that are actually under water are drawn.
    const water = buildWater(startS, rows, step, heights, laterals, centres);
    if (water) group.add(water);

    addScenery(group, index, startS, rows, step);

    scene.add(group);
    chunks.set(index, { group, mesh });
  }

  /**
   * Build the water surface of a chunk.
   *
   * The surface sits a fixed distance below the road, so the low parts of
   * the valley fill up and the road never gets flooded.
   *
   * @param {number} startS
   * @param {number} rows
   * @param {number} step
   * @param {Float32Array} heights
   * @param {Float32Array} laterals
   * @param {Float32Array} centres
   * @returns {THREE.Mesh | null}
   */
  function buildWater(startS, rows, step, heights, laterals, centres) {
    if (!options.waterMaterial) return null;
    const columns = TERRAIN_COLUMNS.length * 2 - 1;
    const limit = columns;
    const positions = [];
    const depths = [];
    const indices = [];
    let any = false;

    for (let r = 0; r < rows; r++) {
      const s = startS + r * step;
      const centre = centres[r];
      const level = roadHeight(profile, s) - WATER_DROP;
      for (let c = 0; c < limit; c++) {
        const i = r * columns + c;
        const lateral = laterals[i];
        const ground = heights[i];
        const depth = level - ground;
        if (depth > 0.05) any = true;
        positions.push(centre + lateral, level, s);
        depths.push(depth);
      }
    }
    if (!any) return null;

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < limit - 1; c++) {
        const a = r * limit + c;
        const b = (r + 1) * limit + c;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aDepth', new THREE.Float32BufferAttribute(depths, 1));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, options.waterMaterial);
    mesh.renderOrder = 1;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  /**
   * Scatter the vegetation and the rocks over the ribbon.
   *
   * The trees are billboards: the model is baked into a texture once and
   * then drawn with a few crossed quads, which is how a whole forest stays
   * cheap enough to fill a valley. The rocks and the bushes stay real
   * models, there are few of them and the player drives right past them.
   *
   * @param {THREE.Group} group
   * @param {number} index
   * @param {number} startS
   * @param {number} rows
   * @param {number} step
   */
  function addScenery(group, index, startS, rows, step) {
    if (!assets) return;
    const random = chunkRandom(index * 7919 + 13, seed);
    /** @type {Map<string, { asset: any, matrices: THREE.Matrix4[] }>} */
    const buckets = new Map();
    /** @type {Map<string, { impostor: any, matrices: THREE.Matrix4[] }>} */
    const trees = new Map();
    const dummy = new THREE.Object3D();

    /**
     * @param {string} key
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} rotation
     * @param {number} scale
     */
    const place = (key, x, y, z, rotation, scale) => {
      const asset = assets.prop?.(key);
      if (!asset) return;
      dummy.position.set(x, y - 0.15, z);
      dummy.rotation.set(0, rotation, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      if (!buckets.has(key)) buckets.set(key, { asset, matrices: [] });
      buckets.get(key).matrices.push(dummy.matrix.clone());
    };

    /**
     * @param {string} key the impostor key
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} rotation
     * @param {number} scale
     */
    const placeTree = (key, x, y, z, rotation, scale) => {
      const impostor = options.getImpostor?.(key);
      if (!impostor) return;
      // The trees are sunk into the ground a little, so they do not float
      // above it on a slope.
      dummy.position.set(x, y - 0.45, z);
      dummy.rotation.set(0, rotation, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      if (!trees.has(key)) trees.set(key, { impostor, matrices: [] });
      trees.get(key).matrices.push(dummy.matrix.clone());
    };

    const samples = rows * 4;
    for (let i = 0; i < samples; i++) {
      const s = startS + random() * TERRAIN_CHUNK_LENGTH;
      const centre = roadOffset(profile, s);
      const half = roadHalfWidth(profile, s);
      const side = random() < 0.5 ? -1 : 1;
      // Trees live between the verge and the tree line, rocks anywhere.
      const spread = random();
      const distance =
        spread < 0.5
          ? half + 3 + random() * 30
          : half + 30 + Math.pow(random(), 0.7) * 380;
      const x = centre + side * distance;
      const z = s;
      const y = surfaceHeight(profile, x, z);
      const altitude = y - roadHeight(profile, s);

      // The slope decides whether anything can grow here.
      const hx = surfaceHeight(profile, x + 3, z) - surfaceHeight(profile, x - 3, z);
      const hz = surfaceHeight(profile, x, z + 3) - surfaceHeight(profile, x, z - 3);
      const slope = Math.hypot(hx, hz) / 6;

      if (slope > 0.62 || altitude > 190) {
        // Bare rock: only boulders and scree. A billboard on a steep slope
        // would float above the ground, so nothing grows there.
        if (random() < 0.4) {
          place(random() < 0.5 ? 'rock' : 'rockSmall', x, y, z, random() * Math.PI * 2, 0.7 + random() * 0.9);
        }
        continue;
      }

      const kind = random();
      if (distance < half + 36) {
        if (kind < 0.44) {
          placeTree(random() < 0.45 ? 'treeOak' : 'tree', x, y, z, random() * Math.PI * 2, 0.85 + random() * 0.45);
        } else if (kind < 0.64) {
          placeTree(random() < 0.6 ? 'treePine' : 'treePineShort', x, y, z, random() * Math.PI * 2, 0.8 + random() * 0.5);
        } else if (kind < 0.78) {
          place(random() < 0.5 ? 'bush' : 'bushSmall', x, y, z, random() * Math.PI * 2, 0.8 + random() * 0.7);
        } else if (kind < 0.9) {
          place('rockSmall', x, y, z, random() * Math.PI * 2, 0.7 + random() * 0.8);
        } else {
          place('grass', x, y, z, random() * Math.PI * 2, 0.9 + random() * 0.6);
        }
      } else {
        // Up in the mountains the forest thins out into pines and boulders.
        if (kind < 0.42) {
          placeTree('treePine', x, y, z, random() * Math.PI * 2, 0.8 + random() * 0.6);
        } else if (kind < 0.6) {
          placeTree('treePineShort', x, y, z, random() * Math.PI * 2, 0.7 + random() * 0.5);
        } else if (kind < 0.78) {
          place('rock', x, y, z, random() * Math.PI * 2, 0.9 + random() * 1.1);
        } else if (kind < 0.9) {
          place('rockSmall', x, y, z, random() * Math.PI * 2, 0.8 + random() * 1.0);
        } else {
          place('stump', x, y, z, random() * Math.PI * 2, 0.8 + random() * 0.5);
        }
      }
    }

    for (const [, bucket] of buckets) {
      for (const part of bucket.asset.groups) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, bucket.matrices.length);
        bucket.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        // A little colour variation keeps the forest from looking stamped.
        if (mesh.instanceColor === null) {
          mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(bucket.matrices.length * 3), 3);
        }
        for (let i = 0; i < bucket.matrices.length; i++) {
          const tint = 0.84 + random() * 0.32;
          mesh.instanceColor.setXYZ(i, tint, tint * (0.97 + random() * 0.08), tint * (0.94 + random() * 0.1));
        }
        mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }

    // The trees: one instanced mesh per kind, drawn with the baked texture.
    for (const [, bucket] of trees) {
      const mesh = new THREE.InstancedMesh(
        bucket.impostor.geometry,
        bucket.impostor.material,
        bucket.matrices.length,
      );
      bucket.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor === null) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(bucket.matrices.length * 3), 3);
      }
      for (let i = 0; i < bucket.matrices.length; i++) {
        const tint = 0.8 + random() * 0.4;
        mesh.instanceColor.setXYZ(i, tint, tint * (0.97 + random() * 0.07), tint * (0.92 + random() * 0.12));
      }
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  /**
   * @param {number} index
   */
  function releaseChunk(index) {
    const entry = chunks.get(index);
    if (!entry) return;
    scene.remove(entry.group);
    entry.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry?.dispose?.();
      }
    });
    chunks.delete(index);
  }

  return {
    /**
     * Make sure the ribbon around the player exists.
     * @param {number} playerS
     */
    update(playerS) {
      if (!treesReady && options.getImpostor?.('tree')) {
        treesReady = true;
        for (const index of Array.from(chunks.keys())) releaseChunk(index);
      }
      const current = Math.floor(playerS / TERRAIN_CHUNK_LENGTH);
      const first = current - TERRAIN_BEHIND;
      const last = current + TERRAIN_AHEAD;
      for (let index = first; index <= last; index++) {
        if (!chunks.has(index)) buildChunk(index, Math.abs(index - current));
      }
      for (const index of Array.from(chunks.keys())) {
        if (index < first - 1 || index > last + 1) releaseChunk(index);
      }
    },
    /** @returns {number} */
    get chunkCount() {
      return chunks.size;
    },
    dispose() {
      for (const index of Array.from(chunks.keys())) releaseChunk(index);
    },
  };
}

/**
 * A tiny helper for scattering that keeps the tree line varied: the same
 * noise field decides where the forest thins out.
 * @param {number} x
 * @param {number} z
 * @param {number} seed
 */
export function treeDensity(x, z, seed) {
  return fbm(x * 0.004, z * 0.004, 2, seed) * 0.5 + 0.5;
}
