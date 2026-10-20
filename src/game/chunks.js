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
  ROAD_LIFT,
  roadOffset,
  roadHeight,
  roadHalfWidth,
  roadBank,
  roadSlope,
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
  const columns = 5;
  const rows = endS - startS + 1;
  const positions = new Float32Array(rows * columns * 3);
  const normals = new Float32Array(rows * columns * 3);
  const uvs = new Float32Array(rows * columns * 2);
  const indices = [];

  for (let r = 0; r < rows; r++) {
    const s = startS + r;
    const centre = roadOffset(profile, s);
    const y = roadHeight(profile, s) + ROAD_LIFT;
    const half = roadHalfWidth(profile, s);
    for (let c = 0; c < columns; c++) {
      const u = c / (columns - 1);
      const lateral = (u - 0.5) * 2 * half;
      const index = (r * columns + c) * 3;
      positions[index] = centre + lateral;
      positions[index + 1] = y;
      positions[index + 2] = s;
      normals[index] = 0;
      normals[index + 1] = 1;
      normals[index + 2] = 0;
      const uvIndex = (r * columns + c) * 2;
      uvs[uvIndex] = u;
      uvs[uvIndex + 1] = s / 12;
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
        const y = surfaceHeight(profile, x, z);
        const kind = random();
        if (kind < 0.6) place(random() < 0.5 ? 'tree' : 'treeOak', x, y, z, random() * Math.PI * 2, 0.8 + random() * 0.5);
        else if (kind < 0.75) place('treePine', x, y, z, random() * Math.PI * 2, 0.8 + random() * 0.4);
        else if (kind < 0.9) place('rock', x, y, z, random() * Math.PI * 2, 0.7 + random() * 0.8);
        else place('bush', x, y, z, random() * Math.PI * 2, 0.8 + random() * 0.6);
      }
      if (random() < 0.16) {
        const side = random() < 0.5 ? -1 : 1;
        const distance = half + 3 + random() * 10;
        const x = centre + side * distance;
        const z = s;
        const y = surfaceHeight(profile, x, z);
        place(random() < 0.5 ? 'bush' : 'bushSmall', x, y, z, random() * Math.PI * 2, 0.8 + random() * 0.5);
      }

      // Guard rails where the ground falls away from the road: they make
      // the drop-offs readable and keep the car on the tarmac.
      if (i % 2 === 0) {
        for (const side of [-1, 1]) {
          const edgeX = centre + side * (half + 1.1);
          const outsideY = surfaceHeight(profile, centre + side * (half + 6), s);
          if (roadY - outsideY < 1.1) continue;
          const y = surfaceHeight(profile, edgeX, s);
          const angle = Math.atan(roadSlope(profile, s));
          place(side > 0 ? 'barrierWhite' : 'barrier', edgeX, y, s, -angle * side, 1);
        }
      }

      // Drift areas get cones and barriers on the wide tarmac.
      if (drift > 0.25) {
        if (random() < 0.45) {
          const side = random() < 0.5 ? -1 : 1;
          const distance = half * (0.55 + random() * 0.4);
          const x = centre + side * distance;
          const z = s + (random() - 0.5) * SEGMENT_LENGTH;
          const y = surfaceHeight(profile, x, z);
          place('cone', x, y, z, 0, 0.9 + random() * 0.2);
        }
        if (random() < 0.18) {
          const side = random() < 0.5 ? -1 : 1;
          const x = centre + side * (half + 1.2);
          const z = s;
          const y = surfaceHeight(profile, x, z);
          place('barrier', x, y, z, 0, 1);
        }
      }

      // Lamps along the road every few segments.
      if (i % 7 === 0) {
        const side = random() < 0.5 ? -1 : 1;
        const x = centre + side * (half + 1.6);
        const z = s;
        const y = surfaceHeight(profile, x, z);
        place('lightPost', x, y, z, 0, 1);
      }

      // A sign every few hundred metres, so the speed is readable.
      if (s > 0 && s % 400 < SEGMENT_LENGTH) {
        const side = random() < 0.5 ? -1 : 1;
        const x = centre + side * (half + 2.2);
        const z = s;
        const y = surfaceHeight(profile, x, z);
        place('sign', x, y, z, 0, 1);
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
