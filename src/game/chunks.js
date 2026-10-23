/**
 * Chunked road & roadside corridor streaming.
 *
 * Streams banked mountain tarmac, aligned guardrails along scenic lake & cliff
 * drop-offs, alpine curve delineator posts, pass signs, scenic turnout lamps,
 * and grounded roadside rocks cleanly ahead of the car.
 */

import * as THREE from '../../vendor/three/three.module.js';
import {
  SEGMENT_LENGTH,
  roadOffset,
  roadHeight,
  roadHalfWidth,
  roadHeading,
  roadCurvature,
  surfaceHeight,
  driftFactor,
} from './road.js';
import { WATER_DROP } from './water.js';
import { mergeGeometries, createDelineatorAsset } from './models.js';

/** Segments per chunk. */
export const SEGMENTS_PER_CHUNK = 32;
/** Chunks kept behind the player. */
export const CHUNKS_BEHIND = 2;
/** Chunks kept in front of the player. */
export const CHUNKS_AHEAD = 5;

function chunkRandom(index, seed) {
  let a = (seed ^ (index * 0x9e3779b9)) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
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
  const columns = 9;
  const rows = endS - startS + 1;
  const positions = new Float32Array(rows * columns * 3);
  const normals = new Float32Array(rows * columns * 3);
  const uvs = new Float32Array(rows * columns * 2);
  const indices = [];
  const OVERLAP = 0.16;

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
      positions[index + 1] = surfaceHeight(profile, centre + lateral, s);
      positions[index + 2] = s;
      const uvIndex = (r * columns + c) * 2;
      uvs[uvIndex] = 0.5 + lateral / (2 * roadHalf);
      uvs[uvIndex + 1] = s / 14;
    }
  }

  for (let r = 0; r < rows; r++) {
    const rPrev = Math.max(0, r - 1);
    const rNext = Math.min(rows - 1, r + 1);
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
 * Creates and recycles world road chunks.
 */
export function createChunkManager(options) {
  const { profile, scene, assets, seed } = options;
  const delineator = createDelineatorAsset();

  function vergeHeight(s, lateral, spread = 0.6) {
    const sample = options.groundHeight;
    if (!sample) return surfaceHeight(profile, roadOffset(profile, s) + lateral, s);
    let y = sample(s, lateral);
    y = Math.min(y, sample(s, lateral - spread), sample(s, lateral + spread));
    y = Math.min(y, sample(s - spread, lateral), sample(s + spread, lateral));
    return y;
  }

  function isStandable(s, lateral, tolerance) {
    const cell = options.groundCell?.(s, lateral);
    if (!cell) return true;
    return cell.spread <= tolerance;
  }

  /** @type {Map<number, { group: THREE.Group, meshes: THREE.Object3D[] }>} */
  const chunks = new Map();

  function buildChunk(index) {
    const startS = index * SEGMENTS_PER_CHUNK * SEGMENT_LENGTH;
    const endS = startS + SEGMENTS_PER_CHUNK * SEGMENT_LENGTH;
    const group = new THREE.Group();

    const roadGeometry = new THREE.BufferGeometry();
    buildRoadGeometry(profile, startS, endS, roadGeometry);
    const road = new THREE.Mesh(roadGeometry, options.roadMaterial);
    road.receiveShadow = true;
    road.frustumCulled = true;
    group.add(road);

    const random = chunkRandom(index, seed);
    /** @type {Map<string, { asset: any, matrices: THREE.Matrix4[] }>} */
    const buckets = new Map();
    const dummy = new THREE.Object3D();

    const placeAsset = (key, assetObj, x, y, z, rotation, scale) => {
      if (!assetObj) return;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, rotation, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      if (!buckets.has(key)) buckets.set(key, { asset: assetObj, matrices: [] });
      buckets.get(key).matrices.push(dummy.matrix.clone());
    };

    const place = (assetKey, x, y, z, rotation, scale) => {
      placeAsset(assetKey, assets?.prop?.(assetKey), x, y, z, rotation, scale);
    };

    const length = (endS - startS) / SEGMENT_LENGTH;
    for (let i = 0; i < length; i++) {
      const s = startS + i * SEGMENT_LENGTH;
      const centre = roadOffset(profile, s);
      const half = roadHalfWidth(profile, s);
      const drift = driftFactor(profile, s);
      const roadY = roadHeight(profile, s);
      const waterLevel = roadY - WATER_DROP;
      const heading = roadHeading(profile, s);
      const curve = roadCurvature(profile, s);

      // Natural boulders & scree stones along rock cuts & mountain shoulders.
      if (random() < 0.48) {
        const side = random() < 0.5 ? -1 : 1;
        const distance = half + 3.8 + random() * 34;
        const z = s + (random() - 0.5) * SEGMENT_LENGTH;
        const x = roadOffset(profile, z) + side * distance;
        const lateral = side * distance;
        const y = vergeHeight(z, lateral, 1.0) - 0.28;
        if (y > waterLevel - 0.3 && isStandable(z, lateral, 2.2)) {
          const rockKey = random() < 0.45 ? 'rock' : random() < 0.78 ? 'rockSmall' : 'rockTall';
          place(rockKey, x, y, z, random() * Math.PI * 2, 0.36 + random() * 0.42);
        }
      }

      // Guardrails along lake overlooks, drop-offs & sharp mountain corners!
      const outerSide = Math.abs(curve) > 0.0028 ? (curve > 0 ? -1 : 1) : 0;
      for (const side of [-1, 1]) {
        const lateral = side * (half + 1.05);
        const outsideDrop = roadY - vergeHeight(s, side * (half + 16), 1);
        const needRail = outsideDrop > 0.9 || (side === outerSide && Math.abs(curve) > 0.0036);
        if (needRail && i % 2 === 0) {
          place('rail', centre + lateral, vergeHeight(s, lateral, 0.35) - 0.06, s, heading, 1.02);
        } else if (i % 4 === 0 && drift < 0.2) {
          // Crisp alpine roadside marker posts every 24m where there is no guardrail.
          placeAsset(
            'delineator',
            delineator,
            centre + side * (half + 0.95),
            vergeHeight(s, side * (half + 0.95), 0.25) - 0.04,
            s,
            heading,
            1,
          );
        }
      }

      // Scenic widened alpine drift overlooks: warm pass lamps & outer boundary barriers
      // around the turnout edge, leaving the wide tarmac 100% clean for drifting!
      if (drift > 0.45 && i % 4 === 0) {
        const side = (index + i) % 8 < 4 ? 1 : -1;
        const lateral = side * (half + 1.45);
        place(
          'lightPost',
          centre + lateral,
          vergeHeight(s, lateral, 0.4) - 0.06,
          s,
          heading - (side * Math.PI) / 2,
          0.92,
        );
      }

      // Occasional pass marker signs along the outside verge.
      if (s > 0 && s % 480 < SEGMENT_LENGTH) {
        const side = ((Math.floor(s / 480) + seed) & 1) === 0 ? 1 : -1;
        const lateral = side * (half + 2.1);
        place(
          'sign',
          centre + lateral,
          vergeHeight(s, lateral, 0.4) - 0.06,
          s,
          heading + (side > 0 ? Math.PI : 0),
          0.95,
        );
      }
    }

    for (const [, bucket] of buckets) {
      for (const groupPart of bucket.asset.groups) {
        const mesh = new THREE.InstancedMesh(groupPart.geometry, groupPart.material, bucket.matrices.length);
        bucket.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
      }
    }

    scene.add(group);
    const entry = { group, meshes: [road] };
    chunks.set(index, entry);
    return entry;
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
    /** Rebuild road furniture if terrain mesh resolution changes underneath it. */
    rebuildAll(playerS) {
      for (const index of Array.from(chunks.keys())) releaseChunk(index);
      this.update(playerS);
    },
    get chunkCount() {
      return chunks.size;
    },
    dispose() {
      for (const index of Array.from(chunks.keys())) releaseChunk(index);
      for (const part of delineator.groups) {
        part.geometry.dispose();
        part.material.dispose();
      }
    },
  };
}
