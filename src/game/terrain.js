/**
 * The terrain ribbon.
 *
 * Streams seamless road-hugging alpine terrain chunks with progressive LOD
 * refinement, rich world-space shader attributes (`aTerrain`), culled wide
 * glacial lakes, and ecologically clustered forests grounded to the exact
 * rendered triangle height.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { roadOffset, roadHalfWidth, roadHeight, surfaceHeight, surfaceNormal } from './road.js';
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
 * Lateral column offsets (metres outward from the road edge).
 * Fine across shoulder, lake shore, and valley wall face; progressively coarser out in the range.
 */
export const TERRAIN_COLUMNS = [
  // Shoulder, drainage swale & meadow verge
  0, 1.6, 3.8, 6.8, 10.5, 15, 20.5, 26.5,
  // Lake basin & lower valley wall face
  33, 40, 47, 54.5, 62, 70, 78.5, 87, 96, 105.5, 115, 125, 135.5, 146, 157,
  168.5, 180, 192.5, 205, 218.5, 232, 246.5, 262, 278, 295,
  // Mid & upper mountain flanks
  313, 332, 353, 375, 399, 425, 453, 483, 515, 550, 588, 629, 673, 721, 773,
  830, 892, 960, 1034, 1115,
  // Far alpine horizon shoulders
  1204, 1300, 1406, 1522, 1650, 1790, 1945, 2115, 2300,
];

const SIDE_COLUMNS = TERRAIN_COLUMNS.length;
const TOTAL_COLUMNS = SIDE_COLUMNS * 2;
const ROW_NEAR = 4.5;
const ROW_MID = 9.5;
const ROW_FAR = 19;

function chunkRandom(index, seed) {
  let a = (seed ^ Math.imul(index | 0, 0x9e3779b9)) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ecological grove density field (0..1): creates lush forest stands separated
 * by open sunlit alpine meadows and rocky spurs.
 * @param {number} x
 * @param {number} z
 * @param {number} seed
 */
export function treeDensity(x, z, seed) {
  const macro = fbm(x * 0.0034, z * 0.0034, 3, seed) * 0.5 + 0.5;
  const clumps = fbm(x * 0.014 + 21.7, z * 0.014 - 8.3, 2, seed + 59) * 0.5 + 0.5;
  return Math.max(0, Math.min(1, macro * 0.72 + clumps * 0.36));
}

/**
 * @param {{
 *   profile: import('./road.js').RoadProfile,
 *   scene: THREE.Scene,
 *   seed: number,
 *   terrainMaterial: THREE.Material,
 *   waterMaterial?: THREE.Material,
 *   assets?: any,
 *   getImpostor?: (key: string) => any,
 * }} options
 */
export function createTerrainManager(options) {
  const { profile, scene, seed, terrainMaterial, assets } = options;
  /**
   * @type {Map<number, {
   *   group: THREE.Group,
   *   mesh: THREE.Mesh,
   *   rows: number,
   *   step: number,
   *   startS: number,
   *   heights: Float32Array,
   * }>}
   */
  const chunks = new Map();
  const colour = [0, 0, 0];

  const BROADLEAF = ['treeOak', 'tree', 'treeTall', 'treeFat', 'treeDetailed', 'treeSimple'];
  const CONIFER = ['treePine', 'treePineShort', 'treePineSlim', 'treePineWide', 'treeCone'];
  const FLOWERS = [
    [1.38, 1.24, 0.42],
    [1.42, 0.88, 0.98],
    [1.34, 1.34, 1.28],
    [1.28, 0.98, 0.48],
  ];

  let treesReady = false;
  let currentChunk = 0;
  let forestDensity = 1.0;

  function rowStep(distance) {
    if (distance <= 1) return ROW_NEAR;
    if (distance <= 3) return ROW_MID;
    return ROW_FAR;
  }

  /**
   * Exact triangle barycentric height & quad spread at `(s, lateral)` matching
   * the exact built vertex & index buffer of the chunk containing `s`.
   *
   * @param {number} s
   * @param {number} lateral
   * @returns {{ height: number, floor: number, spread: number }}
   */
  function meshCell(s, lateral) {
    const chunkIndex = Math.floor(s / TERRAIN_CHUNK_LENGTH);
    const built = chunks.get(chunkIndex);
    const startS = chunkIndex * TERRAIN_CHUNK_LENGTH;
    const rows = built
      ? built.rows
      : Math.max(2, Math.round(TERRAIN_CHUNK_LENGTH / rowStep(Math.abs(chunkIndex - currentChunk)))) + 1;
    const step = built ? built.step : TERRAIN_CHUNK_LENGTH / (rows - 1);

    const rowF = Math.min(rows - 1.0001, Math.max(0, (s - startS) / step));
    const r0 = Math.floor(rowF);
    const r1 = Math.min(rows - 1, r0 + 1);
    const tr = rowF - r0;

    // On each row `r`, vertices sit at lateral = ±(TERRAIN_COLUMNS[col] + halfWidth(cs)).
    // Interpolate halfWidth linearly between r0 and r1 to invert column fractional coordinate cleanly.
    const half0 = roadHalfWidth(profile, startS + r0 * step);
    const half1 = roadHalfWidth(profile, startS + r1 * step);
    const halfAtRow = half0 + (half1 - half0) * tr;

    const onLeft = lateral < 0;
    const distance = Math.max(0, Math.abs(lateral) - halfAtRow);

    let colIdx = 0;
    while (colIdx < SIDE_COLUMNS - 2 && TERRAIN_COLUMNS[colIdx + 1] < distance) colIdx++;
    const span = Math.max(0.001, TERRAIN_COLUMNS[colIdx + 1] - TERRAIN_COLUMNS[colIdx]);
    const u = Math.min(1, Math.max(0, (distance - TERRAIN_COLUMNS[colIdx]) / span));

    // Map outward column pair `(colIdx, colIdx + 1)` to actual vertex column indices `(c0, c1)` where `c1 = c0 + 1`!
    // Left strip stores columns reversed: c = SIDE_COLUMNS - 1 - colIdx, so c0 = SIDE_COLUMNS - 2 - colIdx, c1 = c0 + 1, tc = 1 - u.
    // Right strip stores columns forward: c0 = SIDE_COLUMNS + colIdx, c1 = c0 + 1, tc = u.
    const c0 = onLeft ? SIDE_COLUMNS - 2 - colIdx : SIDE_COLUMNS + colIdx;
    const c1 = c0 + 1;
    const tc = onLeft ? 1 - u : u;

    const readCorner = (r, c) => {
      if (built) return built.heights[r * TOTAL_COLUMNS + c];
      const cs = startS + r * step;
      const centre = roadOffset(profile, cs);
      const hw = roadHalfWidth(profile, cs);
      const base = TERRAIN_COLUMNS[onLeft ? SIDE_COLUMNS - 1 - c : c - SIDE_COLUMNS];
      return surfaceHeight(profile, centre + (onLeft ? -1 : 1) * (base + hw), cs);
    };

    const h00 = readCorner(r0, c0);
    const h10 = readCorner(r1, c0);
    const h01 = readCorner(r0, c1);
    const h11 = readCorner(r1, c1);

    // Exact barycentric interpolation matching indices.push(a, b, a+1, b, b+1, a+1):
    // Diagonal split runs from b=(1,0) to a+1=(0,1), i.e. tr + tc = 1.
    const height =
      tr + tc <= 1
        ? h00 + tr * (h10 - h00) + tc * (h01 - h00)
        : h11 + (1 - tc) * (h10 - h11) + (1 - tr) * (h01 - h11);

    const floor = Math.min(h00, h10, h01, h11);
    const spread = Math.max(h00, h10, h01, h11) - floor;
    return { height, floor, spread };
  }

  function ribbonHeight(s, lateral) {
    return meshCell(s, lateral).height;
  }

  function meshSlope(s, lateral, metres) {
    const across = ribbonHeight(s, lateral + metres) - ribbonHeight(s, lateral - metres);
    const along = ribbonHeight(s + metres, lateral) - ribbonHeight(s - metres, lateral);
    return Math.hypot(across, along) / (metres * 2);
  }

  /**
   * Build wide glacial lake mesh for a chunk, emitting ONLY wet quads so dry
   * valleys add zero draw calls and zero triangles.
   */
  function buildWater(startS, totalSpan) {
    if (!options.waterMaterial) return null;
    const REACH = 236;
    const SPACING = 4;
    const columns = Math.ceil((REACH * 2) / SPACING) + 1;
    const waterStep = 6;
    const waterRows = Math.max(2, Math.round(totalSpan / waterStep)) + 1;
    const actualStep = totalSpan / (waterRows - 1);

    const positions = new Float32Array(waterRows * columns * 3);
    const depths = new Float32Array(waterRows * columns);
    const indices = [];
    let any = false;

    for (let r = 0; r < waterRows; r++) {
      const s = startS + r * actualStep;
      const centre = roadOffset(profile, s);
      const level = roadHeight(profile, s) - WATER_DROP;
      for (let c = 0; c < columns; c++) {
        const lateral = -REACH + c * SPACING;
        const ground = surfaceHeight(profile, centre + lateral, s);
        const depth = level - ground;
        const idx = r * columns + c;
        positions[idx * 3] = centre + lateral;
        positions[idx * 3 + 1] = level;
        positions[idx * 3 + 2] = s;
        depths[idx] = depth;
        if (depth > 0.04) any = true;
      }
    }
    if (!any) return null;

    // Emit triangles ONLY where at least one corner reaches water level.
    for (let r = 0; r < waterRows - 1; r++) {
      for (let c = 0; c < columns - 1; c++) {
        const a = r * columns + c;
        const b = (r + 1) * columns + c;
        if (
          depths[a] > -0.35 ||
          depths[b] > -0.35 ||
          depths[a + 1] > -0.35 ||
          depths[b + 1] > -0.35
        ) {
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    if (indices.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, options.waterMaterial);
    mesh.renderOrder = 1;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  /**
   * Scatter ecologically realistic alpine groves, shoreline trees, shrubs,
   * wildflowers, logs, stumps, and talus boulders onto exact mesh triangles.
   */
  function addScenery(group, index, startS) {
    if (!assets) return;
    const random = chunkRandom(index * 7919 + 13, seed);
    /** @type {Map<string, { asset: any, matrices: THREE.Matrix4[] }>} */
    const buckets = new Map();
    /** @type {Map<string, { impostor: any, matrices: THREE.Matrix4[] }>} */
    const trees = new Map();
    const dummy = new THREE.Object3D();

    const upAxis = new THREE.Vector3(0, 1, 0);
    const tiltAxis = new THREE.Vector3();
    const tilt = new THREE.Quaternion();
    const yaw = new THREE.Quaternion();
    const tilted = new THREE.Quaternion();

    const place = (key, x, y, z, rotation, scale, sink = 0.2, lean = 0) => {
      const asset = assets.prop?.(key);
      if (!asset) return;
      dummy.position.set(x, y - sink, z);
      if (lean > 0.02) {
        surfaceNormal(profile, x, z, tiltAxis);
        tilt.setFromUnitVectors(upAxis, tiltAxis.normalize());
        yaw.setFromAxisAngle(upAxis, rotation);
        tilted.copy(tilt).multiply(yaw);
        dummy.quaternion.copy(yaw).slerp(tilted, Math.min(1, lean));
      } else {
        dummy.quaternion.identity();
        dummy.rotation.set(0, rotation, 0);
      }
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      if (!buckets.has(key)) buckets.set(key, { asset, matrices: [] });
      buckets.get(key).matrices.push(dummy.matrix.clone());
    };

    const placeTree = (key, x, y, z, rotation, scale, sink = 0.14) => {
      const impostor = options.getImpostor?.(key);
      if (!impostor) return;
      dummy.position.set(x, y - sink, z);
      dummy.quaternion.identity();
      dummy.rotation.set(0, rotation, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      if (!trees.has(key)) trees.set(key, { impostor, matrices: [] });
      trees.get(key).matrices.push(dummy.matrix.clone());
    };

    // Dense ecological alpine forest budget per 384m of pass!
    const samples = Math.round(920 * forestDensity);
    for (let i = 0; i < samples; i++) {
      const s = startS + random() * TERRAIN_CHUNK_LENGTH;
      const centre = roadOffset(profile, s);
      const half = roadHalfWidth(profile, s);
      const roadY = roadHeight(profile, s);
      const waterLevel = roadY - WATER_DROP;
      const side = random() < 0.5 ? -1 : 1;

      const spreadRoll = random();
      const distance =
        spreadRoll < 0.30
          ? half + 3.2 + random() * 30
          : spreadRoll < 0.78
            ? half + 30 + Math.pow(random(), 0.75) * 215
            : half + 235 + Math.pow(random(), 0.75) * 440;

      const lateral = side * distance;
      const x = centre + lateral;
      const z = s;

      const cell = meshCell(s, lateral);
      const y = cell.height;

      // Never place vegetation or rocks underwater in lakes!
      if (y < waterLevel + 0.35) continue;

      const altitude = y - roadY;
      const slope = meshSlope(s, lateral, 2.6);
      const cliff = cell.spread > Math.max(9.5, distance * 0.145);

      // Sheer vertical cliffs & high alpine crags above treeline: scattered boulders only.
      if (cliff || slope > 1.06 || altitude > 142) {
        if (distance < half + 300 && random() < 0.34) {
          const key = random() < 0.52 ? 'rock' : 'rockSmall';
          place(
            key,
            x,
            y,
            z,
            random() * Math.PI * 2,
            0.35 + random() * 0.42,
            0.22,
            Math.min(0.65, 0.25 + slope * 0.4),
          );
        }
        continue;
      }

      // Very steep scree slopes above conifer belt: subalpine shrubs & rock talus.
      if (slope > 0.86) {
        if (random() < 0.52) {
          placeTree('bushSmall', x, y, z, random() * Math.PI * 2, 0.7 + random() * 0.5, 0.14);
        } else if (distance < half + 260 && random() < 0.38) {
          place(
            random() < 0.6 ? 'rock' : 'rockTall',
            x,
            y,
            z,
            random() * Math.PI * 2,
            0.42 + random() * 0.48,
            0.22,
            Math.min(0.6, slope * 0.7),
          );
        }
        continue;
      }

      // Natural grove clumping: dense spruce/pine stands climbing the mountain spurs up to treeline!
      const grove = treeDensity(x, z, seed);
      const treelineFade = 1 - Math.max(0, Math.min(1, (altitude - 92) / 48));

      if (distance < half + 34) {
        // Roadside pasture, wildflower tufts, shrubs, occasional specimen groves & boulders.
        const kind = random();
        if (grove > 0.46 && kind < 0.52 * treelineFade) {
          const conifer = altitude > 32 || random() < 0.52;
          const kinds = conifer ? CONIFER : BROADLEAF;
          const treeKey = kinds[Math.floor(random() * kinds.length)];
          placeTree(treeKey, x, y, z, random() * Math.PI * 2, 0.82 + random() * 0.48, 0.14);
        } else if (kind < 0.68) {
          placeTree(
            random() < 0.45 ? 'bushLarge' : random() < 0.78 ? 'bush' : 'bushSmall',
            x,
            y,
            z,
            random() * Math.PI * 2,
            0.75 + random() * 0.65,
            0.12,
          );
        } else if (kind < 0.9) {
          placeTree('grass', x, y, z, random() * Math.PI * 2, 0.85 + random() * 0.75, 0.1);
        } else {
          place(
            random() < 0.65 ? 'rockSmall' : 'log',
            x,
            y,
            z,
            random() * Math.PI * 2,
            0.55 + random() * 0.5,
            0.18,
            slope * 0.6,
          );
        }
      } else {
        // Valley flanks & mountain spurs: rich conifer stands up to the ragged treeline!
        if (random() > (0.22 + grove * 0.92) * treelineFade) {
          if (distance < half + 220 && random() < 0.16) {
            place('rock', x, y, z, random() * Math.PI * 2, 0.7 + random() * 0.85, 0.22, slope * 0.75);
          }
          continue;
        }
        const kind = random();
        const conifer = altitude > 26 || random() < 0.72;
        const kinds = conifer ? CONIFER : BROADLEAF;
        const treeKey = kinds[Math.floor(random() * kinds.length)];
        if (kind < 0.76) {
          placeTree(treeKey, x, y, z, random() * Math.PI * 2, 0.82 + random() * 0.58, 0.15);
        } else if (kind < 0.9) {
          placeTree('treePineSlim', x, y, z, random() * Math.PI * 2, 0.75 + random() * 0.55, 0.15);
        } else if (distance < half + 180) {
          place(
            random() < 0.55 ? 'rockTall' : 'stump',
            x,
            y,
            z,
            random() * Math.PI * 2,
            0.65 + random() * 0.65,
            0.2,
            slope * 0.6,
          );
        }
      }
    }

    for (const [, bucket] of buckets) {
      for (const part of bucket.asset.groups) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, bucket.matrices.length);
        bucket.matrices.forEach((matrix, idx) => mesh.setMatrixAt(idx, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor === null) {
          mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(bucket.matrices.length * 3), 3);
        }
        for (let i = 0; i < bucket.matrices.length; i++) {
          const tint = 0.84 + random() * 0.32;
          mesh.instanceColor.setXYZ(i, tint, tint * (0.97 + random() * 0.07), tint * (0.94 + random() * 0.1));
        }
        mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }

    for (const [key, bucket] of trees) {
      const mesh = new THREE.InstancedMesh(
        bucket.impostor.geometry,
        bucket.impostor.material,
        bucket.matrices.length,
      );
      bucket.matrices.forEach((matrix, idx) => mesh.setMatrixAt(idx, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor === null) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(bucket.matrices.length * 3), 3);
      }
      const flowers = key === 'grass';
      for (let i = 0; i < bucket.matrices.length; i++) {
        if (flowers && random() > 0.58) {
          const fc = FLOWERS[Math.floor(random() * FLOWERS.length)];
          mesh.instanceColor.setXYZ(i, fc[0], fc[1], fc[2]);
          continue;
        }
        // Subtle natural autumn/emerald/blue-spruce variation from tree to tree.
        const tint = 0.82 + random() * 0.36;
        const warmth = 0.94 + random() * 0.14;
        mesh.instanceColor.setXYZ(i, tint * warmth, tint * (0.98 + random() * 0.06), tint * (0.9 + random() * 0.14));
      }
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
    }
  }

  function buildChunk(index, distance) {
    const group = new THREE.Group();
    const startS = index * TERRAIN_CHUNK_LENGTH;
    const wanted = rowStep(distance);
    const rows = Math.max(2, Math.round(TERRAIN_CHUNK_LENGTH / wanted)) + 1;
    const step = TERRAIN_CHUNK_LENGTH / (rows - 1);
    const columns = TOTAL_COLUMNS;

    const positions = new Float32Array(rows * columns * 3);
    const normals = new Float32Array(rows * columns * 3);
    const uvs = new Float32Array(rows * columns * 2);
    const colors = new Float32Array(rows * columns * 3);
    const terrainData = new Float32Array(rows * columns * 4);
    const indices = [];

    const heights = new Float32Array(rows * columns);
    const laterals = new Float32Array(rows * columns);
    const centres = new Float32Array(rows);

    for (let r = 0; r < rows; r++) {
      const s = startS + r * step;
      const centre = roadOffset(profile, s);
      const half = roadHalfWidth(profile, s);
      centres[r] = centre;
      for (let c = 0; c < columns; c++) {
        const onLeft = c < SIDE_COLUMNS;
        const base = TERRAIN_COLUMNS[onLeft ? SIDE_COLUMNS - 1 - c : c - SIDE_COLUMNS];
        const lateral = (onLeft ? -1 : 1) * (base + half);
        laterals[r * columns + c] = lateral;
        heights[r * columns + c] = surfaceHeight(profile, centre + lateral, s);
      }
    }

    for (let r = 0; r < rows; r++) {
      const s = startS + r * step;
      const centre = centres[r];
      const roadY = roadHeight(profile, s);
      const waterY = roadY - WATER_DROP;
      const half = roadHalfWidth(profile, s);
      for (let c = 0; c < columns; c++) {
        const i = r * columns + c;
        const lateral = laterals[i];
        const cPrevI = r * columns + Math.max(0, c - 1);
        const cNextI = r * columns + Math.min(columns - 1, c + 1);
        const rPrevI = Math.max(0, r - 1) * columns + c;
        const rNextI = Math.min(rows - 1, r + 1) * columns + c;
        const acrossSpan = Math.max(0.001, Math.abs(laterals[cNextI] - laterals[cPrevI]));
        const alongSpan = Math.max(0.001, (Math.min(rows - 1, r + 1) - Math.max(0, r - 1)) * step);
        const acrossCurve =
          (heights[cPrevI] + heights[cNextI] - 2 * heights[i]) / (acrossSpan * acrossSpan * 0.25);
        const alongCurve =
          (heights[rPrevI] + heights[rNextI] - 2 * heights[i]) / (alongSpan * alongSpan * 0.25);
        const concavity = Math.max(-1.2, Math.min(1.2, (acrossCurve + alongCurve) * 14));

        const x = centre + lateral;
        const y = heights[i];
        const v3 = i * 3;
        positions[v3] = x;
        positions[v3 + 1] = y;
        positions[v3 + 2] = s;

        const rPrev = Math.max(0, r - 1);
        const rNext = Math.min(rows - 1, r + 1);
        const dz = (rNext - rPrev) * step || step;
        const dzx = centres[rNext] - centres[rPrev];
        const dzy = heights[rNext * columns + c] - heights[rPrev * columns + c];
        const cPrev = Math.max(0, c - 1);
        const cNext = Math.min(columns - 1, c + 1);
        const dx = laterals[r * columns + cNext] - laterals[r * columns + cPrev];
        const dxy = heights[r * columns + cNext] - heights[r * columns + cPrev];
        const nx = -dz * dxy;
        const ny = dz * dx;
        const nz = dzx * dxy - dzy * dx;
        const length = Math.hypot(nx, ny, nz) || 1;
        normals[v3] = nx / length;
        normals[v3 + 1] = ny / length;
        normals[v3 + 2] = nz / length;

        const uvIndex = i * 2;
        uvs[uvIndex] = lateral / 6;
        uvs[uvIndex + 1] = s / 6;

        const slope = Math.min(1, Math.hypot(nx, nz) / Math.max(0.001, Math.abs(ny)) / 1.85);
        const altitude = y - roadY;
        const dist = Math.max(0, Math.abs(lateral) - half);
        const patch = fbm(x * 0.013, s * 0.013, 3, seed + 17) * 0.5 + 0.5;
        const rockPatch = fbm(x * 0.011, s * 0.011, 3, seed + 61) * 0.5 + 0.5;
        const mottle = fbm(x * 0.068, s * 0.068, 2, seed + 89) * 0.5 + 0.5;
        groundColour(slope, altitude, dist, patch, rockPatch, colour, mottle);

        const shade = 1 - Math.max(-0.35, Math.min(0.35, concavity * 0.42));
        colors[v3] = colour[0] * shade;
        colors[v3 + 1] = colour[1] * shade;
        colors[v3 + 2] = colour[2] * shade;

        const v4 = i * 4;
        terrainData[v4] = dist;
        terrainData[v4 + 1] = altitude;
        terrainData[v4 + 2] = concavity;
        terrainData[v4 + 3] = y - waterY;
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let side = 0; side < 2; side++) {
        const first = side * SIDE_COLUMNS;
        for (let c = first; c < first + SIDE_COLUMNS - 1; c++) {
          const a = r * columns + c;
          const b = (r + 1) * columns + c;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aTerrain', new THREE.BufferAttribute(terrainData, 4));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, terrainMaterial);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);

    const water = buildWater(startS, TERRAIN_CHUNK_LENGTH);
    if (water) group.add(water);

    // Register chunk BEFORE scattering scenery so meshCell reads exact built vertices!
    const entry = { group, mesh, rows, step, startS, heights };
    chunks.set(index, entry);

    addScenery(group, index, startS);
    scene.add(group);
  }

  function releaseChunk(index) {
    const entry = chunks.get(index);
    if (!entry) return;
    scene.remove(entry.group);
    entry.group.traverse((object) => {
      if (object instanceof THREE.Mesh && !(object instanceof THREE.InstancedMesh)) {
        object.geometry?.dispose?.();
      }
    });
    chunks.delete(index);
  }

  return {
    /**
     * Stream chunks ahead of the player and upgrade coarse distant chunks to
     * fine resolution as the player drives into them!
     * @param {number} playerS
     * @returns {boolean} true if any nearby chunk changed mesh resolution
     */
    update(playerS) {
      currentChunk = Math.floor(playerS / TERRAIN_CHUNK_LENGTH);
      let refinedNear = false;
      if (!treesReady && options.getImpostor?.('treeOak')) {
        treesReady = true;
        for (const index of Array.from(chunks.keys())) releaseChunk(index);
      }
      const first = currentChunk - TERRAIN_BEHIND;
      const last = currentChunk + TERRAIN_AHEAD;
      for (let index = first; index <= last; index++) {
        const dist = Math.abs(index - currentChunk);
        const wanted = rowStep(dist);
        const existing = chunks.get(index);
        if (!existing) {
          buildChunk(index, dist);
        } else if (existing.step > wanted + 0.5) {
          releaseChunk(index);
          buildChunk(index, dist);
          if (dist <= 1) refinedNear = true;
        }
      }
      for (const index of Array.from(chunks.keys())) {
        if (index < first - 1 || index > last + 1) releaseChunk(index);
      }
      return refinedNear;
    },
    setForestDensity(value) {
      const next = Math.max(0.1, Number(value) || 1);
      if (Math.abs(next - forestDensity) < 0.01) return;
      forestDensity = next;
      const savedCurrent = currentChunk;
      for (const index of Array.from(chunks.keys())) releaseChunk(index);
      this.update(savedCurrent * TERRAIN_CHUNK_LENGTH);
    },
    get chunkCount() {
      return chunks.size;
    },
    sampleHeight(s, lateral) {
      return ribbonHeight(s, lateral);
    },
    sampleCell(s, lateral) {
      return meshCell(s, lateral);
    },
    dispose() {
      for (const index of Array.from(chunks.keys())) releaseChunk(index);
    },
  };
}
