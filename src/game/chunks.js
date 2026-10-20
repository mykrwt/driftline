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
  surfaceHeight,
  driftFactor,
} from './road.js';
import { mergeGeometries } from './models.js';
import { fbm } from './noise.js';

/** Terrain chunk size in metres. */
export const TERRAIN_CHUNK = 256;
/** Resolution of the terrain chunks close to the player. */
export const TERRAIN_NEAR_RES = 40;
/** Resolution of the terrain chunks further away. */
export const TERRAIN_FAR_RES = 22;
/** How many chunks are kept in each direction. */
export const TERRAIN_RADIUS = 3;

/** Segments per chunk. */
export const SEGMENTS_PER_CHUNK = 32;
/** Chunks kept behind the player. */
export const CHUNKS_BEHIND = 2;
/** Chunks kept in front of the player. */
export const CHUNKS_AHEAD = 5;

/** Lateral offsets of the terrain columns, measured from the road edge. */
const TERRAIN_COLUMNS = [2.5, 9, 26, 60, 110, 175];

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
 * @param {import('./road.js').RoadProfile} profile
 * @param {number} startS
 * @param {number} endS
 * @param {THREE.BufferGeometry} geometry
 */
function buildTerrainGeometry(profile, startS, endS, geometry) {
  const columns = [];
  for (const d of [...TERRAIN_COLUMNS].reverse()) columns.push(-d);
  columns.push(0);
  for (const d of TERRAIN_COLUMNS) columns.push(d);

  const rows = endS - startS + 1;
  const positions = new Float32Array(rows * columns.length * 3);
  const normals = new Float32Array(rows * columns.length * 3);
  const uvs = new Float32Array(rows * columns.length * 2);
  const indices = [];

  for (let r = 0; r < rows; r++) {
    const s = startS + r;
    const centre = roadOffset(profile, s);
    const half = roadHalfWidth(profile, s);
    for (let c = 0; c < columns.length; c++) {
      const base = columns[c];
      const lateral = base === 0 ? 0 : base + (base > 0 ? half : -half);
      const x = centre + lateral;
      const y = surfaceHeight(profile, x, s);
      const index = (r * columns.length + c) * 3;
      positions[index] = x;
      positions[index + 1] = y;
      positions[index + 2] = s;
      normals[index] = 0;
      normals[index + 1] = 1;
      normals[index + 2] = 0;
      const uvIndex = (r * columns.length + c) * 2;
      uvs[uvIndex] = x * 0.05;
      uvs[uvIndex + 1] = s * 0.05;
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns.length - 1; c++) {
      const a = r * columns.length + c;
      const b = (r + 1) * columns.length + c;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

/**
 * Builds the mountain terrain around the player.
 *
 * The height comes from the same function the physics uses, so the wheels
 * always touch the mesh. The colours blend grass, rock and snow by slope and
 * altitude, and the far chunks get a coarse mesh with billboard forests.
 *
 * @param {{
 *   profile: import('./road.js').RoadProfile,
 *   scene: THREE.Scene,
 *   seed: number,
 *   terrainMaterial: THREE.Material,
 *   impostors?: any,
 * }} options
 */
export function createTerrainManager(options) {
  const { profile, scene, seed, terrainMaterial } = options;
  /** @type {Map<string, { group: THREE.Group, meshes: THREE.Object3D[] }>} */
  const chunks = new Map();

  /**
   * @param {number} cx
   * @param {number} cz
   * @param {number} res
   */
  function buildChunk(cx, cz, res) {
    const key = `${cx}:${cz}`;
    if (chunks.has(key)) return;
    const group = new THREE.Group();
    const size = TERRAIN_CHUNK;
    const originX = cx * size;
    const originZ = cz * size;
    const step = size / res;

    const positions = new Float32Array((res + 1) * (res + 1) * 3);
    const normals = new Float32Array((res + 1) * (res + 1) * 3);
    const uvs = new Float32Array((res + 1) * (res + 1) * 2);
    const colors = new Float32Array((res + 1) * (res + 1) * 3);
    const indices = [];

    const grass = new THREE.Color('#5d9a52');
    const grassDry = new THREE.Color('#8a9a5c');
    const rock = new THREE.Color('#9a9ba2');
    const rockDark = new THREE.Color('#6b6d75');
    const snow = new THREE.Color('#f2f6fc');
    const colour = new THREE.Color();

    for (let z = 0; z <= res; z++) {
      for (let x = 0; x <= res; x++) {
        const wx = originX + x * step;
        const wz = originZ + z * step;
        const height = surfaceHeight(profile, wx, wz, undefined, true);
        const index = (z * (res + 1) + x) * 3;
        positions[index] = wx;
        positions[index + 1] = height;
        positions[index + 2] = wz;
        const uvIndex = (z * (res + 1) + x) * 2;
        uvs[uvIndex] = wx * 0.05;
        uvs[uvIndex + 1] = wz * 0.05;

        // Slope and altitude decide what the ground looks like.
        const hx = surfaceHeight(profile, wx + step, wz) - surfaceHeight(profile, wx - step, wz);
        const hz = surfaceHeight(profile, wx, wz + step) - surfaceHeight(profile, wx, wz - step);
        const slope = Math.min(1, Math.hypot(hx, hz) / (step * 2) * 1.4);
        const altitude = height - roadHeight(profile, wz);
        const patch = fbm(wx * 0.02, wz * 0.02, 3, seed + 17) * 0.5 + 0.5;

        colour.copy(grass).lerp(grassDry, patch * 0.7);
        colour.lerp(rock, Math.min(1, Math.max(0, (slope - 0.25) * 2.4)));
        colour.lerp(rockDark, Math.min(1, Math.max(0, (slope - 0.6) * 1.8)));
        colour.lerp(snow, Math.min(1, Math.max(0, (altitude - 105) / 70)));
        colors[index] = colour.r;
        colors[index + 1] = colour.g;
        colors[index + 2] = colour.b;
      }
    }

    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const a = z * (res + 1) + x;
        const b = (z + 1) * (res + 1) + x;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, terrainMaterial);
    mesh.receiveShadow = false;
    group.add(mesh);

    // --- far forest: billboard impostors on the slopes --------------------
    if (options.impostors && res === TERRAIN_FAR_RES) {
      addImpostorForest(group, cx, cz, seed, options.impostors);
    }

    scene.add(group);
    chunks.set(key, { group, meshes: [mesh] });
  }

  /**
   * @param {THREE.Group} group
   * @param {number} cx
   * @param {number} cz
   * @param {number} worldSeed
   * @param {any} impostors
   */
  function addImpostorForest(group, cx, cz, worldSeed, impostors) {
    const random = chunkRandom(cx * 73856093 ^ cz * 19349663, worldSeed);
    const dummy = new THREE.Object3D();
    const count = 260;
    const matrices = [];
    const size = TERRAIN_CHUNK;
    for (let i = 0; i < count; i++) {
      const wx = cx * size + random() * size;
      const wz = cz * size + random() * size;
      const height = surfaceHeight(profile, wx, wz, undefined, true);
      const altitude = height - roadHeight(profile, wz);
      if (altitude < 12 || altitude > 150) continue;
      const hx = surfaceHeight(profile, wx + 4, wz) - surfaceHeight(profile, wx - 4, wz);
      const hz = surfaceHeight(profile, wx, wz + 4) - surfaceHeight(profile, wx, wz - 4);
      const slope = Math.hypot(hx, hz) / 8;
      if (slope > 1.3) continue;
      // Keep the trees off the road.
      const centre = roadOffset(profile, wz);
      if (Math.abs(wx - centre) < roadHalfWidth(profile, wz) + 12) continue;
      const kind = random();
      const asset = kind < 0.62 ? impostors.pine : impostors.tree;
      if (!asset) continue;
      dummy.position.set(wx, height - 0.3, wz);
      dummy.rotation.set(0, random() * Math.PI * 2, 0);
      const scale = 0.75 + random() * 0.75;
      dummy.scale.set(scale, scale * (0.85 + random() * 0.4), scale);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }
    if (matrices.length === 0) return;
    for (const asset of [impostors.pine, impostors.tree]) {
      if (!asset) continue;
      const mesh = new THREE.InstancedMesh(asset.geometry, asset.material, matrices.length);
      matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }

  return {
    /**
     * @param {number} playerX
     * @param {number} playerZ
     */
    update(playerX, playerZ) {
      const cx = Math.round(playerX / TERRAIN_CHUNK);
      const cz = Math.round(playerZ / TERRAIN_CHUNK);
      for (let dz = -TERRAIN_RADIUS; dz <= TERRAIN_RADIUS; dz++) {
        for (let dx = -TERRAIN_RADIUS; dx <= TERRAIN_RADIUS; dx++) {
          const distance = Math.max(Math.abs(dx), Math.abs(dz));
          const res = distance <= 1 ? TERRAIN_NEAR_RES : TERRAIN_FAR_RES;
          buildChunk(cx + dx, cz + dz, res);
        }
      }
      for (const [key, entry] of Array.from(chunks.entries())) {
        const [kx, kz] = key.split(':').map(Number);
        if (Math.abs(kx - cx) > TERRAIN_RADIUS + 1 || Math.abs(kz - cz) > TERRAIN_RADIUS + 1) {
          scene.remove(entry.group);
          entry.group.traverse((object) => {
            if (object instanceof THREE.Mesh) object.geometry?.dispose?.();
          });
          chunks.delete(key);
        }
      }
    },
    get chunkCount() {
      return chunks.size;
    },
    dispose() {
      for (const entry of chunks.values()) {
        scene.remove(entry.group);
        entry.group.traverse((object) => {
          if (object instanceof THREE.Mesh) object.geometry?.dispose?.();
        });
      }
      chunks.clear();
    },
  };
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

      // Trees and rocks along the roadside.
      if (random() < 0.55) {
        const side = random() < 0.5 ? -1 : 1;
        const distance = half + 4 + random() * 40;
        const x = centre + side * distance;
        const z = s + (random() - 0.5) * SEGMENT_LENGTH;
        const y = surfaceHeight(profile, x, z);
        const kind = random();
        if (kind < 0.6) place(random() < 0.5 ? 'tree' : 'treeOak', x, y, z, random() * Math.PI * 2, 0.8 + random() * 0.5);
        else if (kind < 0.75) place('pine', x, y, z, random() * Math.PI * 2, 0.8 + random() * 0.4);
        else if (kind < 0.9) place('rock', x, y, z, random() * Math.PI * 2, 0.7 + random() * 0.8);
        else place('bush', x, y, z, random() * Math.PI * 2, 0.8 + random() * 0.6);
      }
      if (random() < 0.12) {
        const side = random() < 0.5 ? -1 : 1;
        const distance = half + 3 + random() * 10;
        const x = centre + side * distance;
        const z = s;
        const y = surfaceHeight(profile, x, z);
        place('cactus', x, y, z, random() * Math.PI * 2, 0.8 + random() * 0.4);
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
      if (i % 9 === 0) {
        const x = centre - (half + 1.6);
        const z = s;
        const y = surfaceHeight(profile, x, z);
        place('lightPost', x, y, z, 0, 1);
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
