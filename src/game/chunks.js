/**
 * Chunked world streaming.
 *
 * The world is an endless road. Chunks of 192 metres are generated ahead of the
 * player and released behind, so memory and draw calls stay flat no matter how
 * far you drive. Every chunk is derived from the shared road profile, so two
 * peers generate exactly the same world.
 */

import * as THREE from '../../vendor/three/three.module.js';
import {
  SEGMENT_LENGTH,
  roadOffset,
  roadHeight,
  roadHalfWidth,
  roadBank,
  roadHeading,
  surfaceHeight,
  driftFactor,
} from './road.js';
import { mergeGeometries } from './models.js';

/** Segments per chunk. */
export const SEGMENTS_PER_CHUNK = 32;
/** Chunks kept behind the player. */
export const CHUNKS_BEHIND = 2;
/** Chunks kept in front of the player. */
export const CHUNKS_AHEAD = 5;

/**
 * Deterministic pseudo random generator for a chunk.
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
 * @param {import('./road.js').RoadProfile} profile
 * @param {number} startS
 * @param {number} endS
 * @param {THREE.BufferGeometry} geometry
 */
function buildRoadGeometry(profile, startS, endS, geometry) {
  // The tarmac is banked exactly like the corridor the physics uses, so the
  // tyres are always on the surface that is drawn. A handful of columns
  // carries the cross slope and gives the hills a normal to light.
  const columns = 9;
  const rows = endS - startS + 1;
  const positions = new Float32Array(rows * columns * 3);
  const normals = new Float32Array(rows * columns * 3);
  const uvs = new Float32Array(rows * columns * 2);
  const indices = [];
  // The tarmac overlaps the edge of the terrain by a hand's width, so the
  // two meshes can never open a hairline crack on a tight corner, but the
  // painted edge line still lands exactly on the edge of the road.
  const OVERLAP = 0.12;

  for (let r = 0; r < rows; r++) {
    const s = startS + r;
    const centre = roadOffset(profile, s);
    const roadHalf = roadHalfWidth(profile, s);
    const half = roadHalf + OVERLAP;
    for (let c = 0; c < columns; c++) {
      const t = c / (columns - 1);
      const lateral = (t - 0.5) * 2 * half;
      const index = (r * columns + c) * 3;
      positions[index] = centre + lateral;
      // The same height the physics uses, banking and all.
      positions[index + 1] = surfaceHeight(profile, centre + lateral, s);
      positions[index + 2] = s;
      const uvIndex = (r * columns + c) * 2;
      // The texture is mapped to the real width of the road, so the edge
      // lines stay on the edge however wide the drift areas get.
      uvs[uvIndex] = 0.5 + lateral / (2 * roadHalf);
      uvs[uvIndex + 1] = s / 12;
    }
  }

  // Normals from the grid, so the tarmac darkens on a hill and in a bank.
  for (let r = 0; r < rows; r++) {
    const rPrev = Math.max(0, r - 1);
    const rNext = Math.min(rows - 1, r + 1);
    const dz = (rNext - rPrev) || 1;
    for (let c = 0; c < columns; c++) {
      const cPrev = Math.max(0, c - 1);
      const cNext = Math.min(columns - 1, c + 1);
      const i = (r * columns + c) * 3;
      const iPrev = (r * columns + cPrev) * 3;
      const iNext = (r * columns + cNext) * 3;
      const iRow = (rPrev * columns + c) * 3;
      const iRowNext = (rNext * columns + c) * 3;
      const tx = positions[iNext] - positions[iPrev];
      const ty = positions[iNext + 1] - positions[iPrev + 1];
      const tz = positions[iNext + 2] - positions[iPrev + 2];
      const sx = positions[iRowNext] - positions[iRow];
      const sy = positions[iRowNext + 1] - positions[iRow + 1];
      const sz = positions[iRowNext + 2] - positions[iRow + 2];
      // cross(along, across)
      let nx = sy * tz - sz * ty;
      let ny = sz * tx - sx * tz;
      let nz = sx * ty - sy * tx;
      if (ny < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const length = Math.hypot(nx, ny, nz) || 1;
      normals[i] = nx / length;
      normals[i + 1] = ny / length;
      normals[i + 2] = nz / length;
      void dz;
    }
  }

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const a = r * columns + c;
      const b = (r + 1) * columns + c;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
}

/**
 * Crossed billboard geometry for a tree impostor.
 * @param {number} width
 * @param {number} height
 * @returns {THREE.BufferGeometry}
 */
export function createImpostorGeometry(width, height) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const plane = new THREE.PlaneGeometry(width, height);
    plane.translate(0, height / 2, 0);
    plane.rotateY((i / 3) * Math.PI);
    parts.push(plane);
  }
  const merged = mergeGeometries(parts);
  parts.forEach((part) => part.dispose());
  return merged;
}

/**
 * Creates and recycles world chunks.
 *
 * @param {{
 *   profile: import('./road.js').RoadProfile,
 *   scene: THREE.Scene,
 *   assets: any,
 *   seed: number,
 *   roadMaterial: THREE.Material,
 *   terrainMaterial: THREE.Material,
 * }} options
 */
export function createChunkManager(options) {
  const { profile, scene, assets, seed } = options;
  /**
   * The height of the ground as it is drawn.
   *
   * The ribbon is a grid, so the surface under a prop is a straight line
   * between two columns and not the analytic height of the land. Road
   * furniture is placed against the mesh, and against the lowest point of
   * its footprint, so nothing hovers over the verge.
   *
   * @param {number} s
   * @param {number} lateral
   * @param {number} [spread]
   * @returns {number}
   */
  function vergeHeight(s, lateral, spread = 0.7) {
    const sample = options.groundHeight;
    const cell = options.groundCell?.(s, lateral);
    if (!sample) {
      const y = surfaceHeight(profile, roadOffset(profile, s) + lateral, s);
      return cell ? Math.min(y, cell.floor) : y;
    }
    let y = sample(s, lateral);
    if (cell) y = Math.min(y, cell.floor);
    y = Math.min(y, sample(s, lateral - spread), sample(s, lateral + spread));
    y = Math.min(y, sample(s - spread, lateral), sample(s + spread, lateral));
    return y;
  }

  /**
   * Is this a place a prop can stand on?
   *
   * A quad of the terrain ribbon has four corners, and on a mountain those
   * corners can be metres apart even though the quad itself is flat. A prop
   * dropped on such a quad hangs over the downhill half of it, which is what
   * made rocks and trees float above the cliffs.
   *
   * @param {number} s
   * @param {number} lateral
   * @param {number} tolerance how many metres the corners may differ by
   * @returns {boolean}
   */
  function isStandable(s, lateral, tolerance) {
    const cell = options.groundCell?.(s, lateral);
    if (!cell) return true;
    return cell.spread <= tolerance;
  }
  /** @type {Map<number, { group: THREE.Group, meshes: THREE.Object3D[] }>} */
  const chunks = new Map();

  /**
   * @param {number} index
   */
  function buildChunk(index) {
    const startS = index * SEGMENTS_PER_CHUNK * SEGMENT_LENGTH;
    const endS = startS + SEGMENTS_PER_CHUNK * SEGMENT_LENGTH;
    const group = new THREE.Group();

    const roadGeometry = new THREE.BufferGeometry();
    buildRoadGeometry(profile, startS, endS, roadGeometry);
    const road = new THREE.Mesh(roadGeometry, options.roadMaterial);
    road.frustumCulled = true;
    group.add(road);
    // The surrounding terrain is built by the terrain manager (mountains).

    // --- scenery ---------------------------------------------------------
    const random = chunkRandom(index, seed);
    /** @type {Map<string, { asset: any, matrices: THREE.Matrix4[] }>} */
    const buckets = new Map();
    const dummy = new THREE.Object3D();

    /**
     * @param {string} assetKey
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} rotation
     * @param {number} scale
     */
    const place = (assetKey, x, y, z, rotation, scale) => {
      const asset = assets?.prop?.(assetKey);
      if (!asset) return;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, rotation, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      if (!buckets.has(assetKey)) buckets.set(assetKey, { asset, matrices: [] });
      buckets.get(assetKey).matrices.push(dummy.matrix.clone());
    };

    const length = (endS - startS) / SEGMENT_LENGTH;
    for (let i = 0; i < length; i++) {
      const s = startS + i * SEGMENT_LENGTH;
      const centre = roadOffset(profile, s);
      const half = roadHalfWidth(profile, s);
      const drift = driftFactor(profile, s);
      const roadY = roadHeight(profile, s);

      // Trees and rocks along the roadside.
      if (random() < 0.55) {
        const side = random() < 0.5 ? -1 : 1;
        const distance = half + 4 + random() * 40;
        const x = centre + side * distance;
        const z = s + (random() - 0.5) * SEGMENT_LENGTH;
        const lateral = x - roadOffset(profile, z);
        const y = vergeHeight(z, lateral, 1.2) - 0.35;
        const kind = random();
        // Trees need ground that is flat enough to stand on; only boulders
        // are allowed to hug the steep faces.
        // Only rocks are placed here. The trees and bushes along the road
        // come from the terrain scatter, which draws them as billboards that
        // are baked with their own light. A real model this close to the road
        // sits in the shade of the mountains and reads as a black blob.
        if (isStandable(z, lateral, 1.6)) {
          place(random() < 0.5 ? 'rock' : 'rockSmall', x, y, z, random() * Math.PI * 2, 0.35 + random() * 0.4);
        } else if (kind > 0.55) {
          place('rock', x, y, z, random() * Math.PI * 2, 0.3 + random() * 0.35);
        }
      }
      if (random() < 0.16) {
        const side = random() < 0.5 ? -1 : 1;
        const distance = half + 3 + random() * 10;
        const x = centre + side * distance;
        const z = s;
        const lateral = x - roadOffset(profile, z);
        if (!isStandable(z, lateral, 1.2)) continue;
        const y = vergeHeight(z, lateral, 1) - 0.2;
        place('rockSmall', x, y, z, random() * Math.PI * 2, 0.3 + random() * 0.3);
      }

      // Guard rails where the ground falls away from the road: they make
      // the drop-offs readable and keep the car on the tarmac. The rail
      // runs along the road, so it follows the road's heading.
      if (i % 2 === 0) {
        const heading = roadHeading(profile, s);
        for (const side of [-1, 1]) {
          const lateral = side * (half + 1.1);
          const outsideY = vergeHeight(s, side * (half + 6), 1);
          if (roadY - outsideY < 1.1) continue;
          place('rail', centre + lateral, vergeHeight(s, lateral), s, heading, 1);
        }
      }

      // Drift areas get cones and barriers on the wide tarmac.
      if (drift > 0.25) {
        const heading = roadHeading(profile, s);
        if (random() < 0.45) {
          const side = random() < 0.5 ? -1 : 1;
          const distance = half * (0.55 + random() * 0.4);
          const x = centre + side * distance;
          const z = s + (random() - 0.5) * SEGMENT_LENGTH;
          // On the tarmac the surface is the road itself, banked.
          const y = surfaceHeight(profile, x, z);
          place('cone', x, y, z, heading, 0.9 + random() * 0.2);
        }
        if (random() < 0.18) {
          const side = random() < 0.5 ? -1 : 1;
          const lateral = side * (half + 1.2);
          place('barrier', centre + lateral, vergeHeight(s, lateral), s, heading, 1);
        }
      }

      // Lamps along the road every few segments. The arm of the lamp points
      // over the road, so the lamp is turned to face the tarmac.
      if (i % 7 === 0) {
        const side = random() < 0.5 ? -1 : 1;
        const lateral = side * (half + 1.6);
        place(
          'lightPost',
          centre + lateral,
          vergeHeight(s, lateral),
          s,
          roadHeading(profile, s) - (side * Math.PI) / 2,
          1,
        );
      }

      // A sign every few hundred metres, so the speed is readable. The
      // plate stands across the road and faces the driver.
      if (s > 0 && s % 400 < SEGMENT_LENGTH) {
        const side = random() < 0.5 ? -1 : 1;
        const lateral = side * (half + 2.2);
        place(
          'sign',
          centre + lateral,
          vergeHeight(s, lateral, 0.5),
          s,
          roadHeading(profile, s) + (side > 0 ? Math.PI : 0),
          1,
        );
      }
    }

    for (const [assetKey, bucket] of buckets) {
      for (const groupPart of bucket.asset.groups) {
        const mesh = new THREE.InstancedMesh(groupPart.geometry, groupPart.material, bucket.matrices.length);
        bucket.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
      }
    }

    scene.add(group);
    const entry = { group, meshes: [road] };
    chunks.set(index, entry);
    return entry;
  }

  /**
   * @param {number} index
   */
  function releaseChunk(index) {
    const entry = chunks.get(index);
    if (!entry) return;
    scene.remove(entry.group);
    entry.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry?.dispose?.();
    });
    chunks.delete(index);
  }

  return {
    /**
     * Make sure the chunks around the player exist.
     * @param {number} playerS
     */
    update(playerS) {
      const chunkSize = SEGMENTS_PER_CHUNK * SEGMENT_LENGTH;
      const current = Math.floor(playerS / chunkSize);
      const first = current - CHUNKS_BEHIND;
      const last = current + CHUNKS_AHEAD;
      for (let index = first; index <= last; index++) {
        if (!chunks.has(index)) buildChunk(index);
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
