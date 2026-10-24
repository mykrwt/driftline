/**
 * Chunked road & roadside corridor streaming.
 *
 * Features:
 *   1. Continuous curved galvanized-steel W-beam mountain guardrails with
 *      grounded steel posts & red/white retroreflectors along lake basins,
 *      cliff drop-offs, and sharp outside hairpins — zero gaps and zero seams.
 *   2. Exact solid collision registration (`options.collisions`) for continuous
 *      guardrail ribbons, roadside boulders, lamp posts, and signs (never trees).
 *   3. Global pooled InstancedMesh batching across active road chunks so all
 *      roadside furniture renders in a handful of draw calls.
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
 * Append a colored 3D box oriented along tangent `(tx, tz)` and inward normal `(nx, nz)`
 * into flat vertex buffers so an entire chunk's guardrails draw in ONE single mesh call!
 */
function pushOrientedBox(pos, nor, col, idx, cx, cy, cz, tx, tz, nx, nz, halfT, halfN, y0, y1, r, g, b) {
  const base = pos.length / 3;
  // 8 corners: bottom 0..3, top 4..7
  const corners = [
    [-halfT, -halfN, y0],
    [halfT, -halfN, y0],
    [halfT, halfN, y0],
    [-halfT, halfN, y0],
    [-halfT, -halfN, y1],
    [halfT, -halfN, y1],
    [halfT, halfN, y1],
    [-halfT, halfN, y1],
  ];
  const world = corners.map(([lt, ln, ly]) => [
    cx + tx * lt + nx * ln,
    cy + ly,
    cz + tz * lt + nz * ln,
  ]);
  const faces = [
    { v: [3, 2, 6, 7], n: [nx, 0, nz], shade: 1.0 },
    { v: [1, 0, 4, 5], n: [-nx, 0, -nz], shade: 0.78 },
    { v: [2, 1, 5, 6], n: [tx, 0, tz], shade: 0.88 },
    { v: [0, 3, 7, 4], n: [-tx, 0, -tz], shade: 0.88 },
    { v: [7, 6, 5, 4], n: [0, 1, 0], shade: 1.12 },
  ];
  for (const f of faces) {
    const start = pos.length / 3;
    for (const vi of f.v) {
      const p = world[vi];
      pos.push(p[0], p[1], p[2]);
      nor.push(f.n[0], f.n[1], f.n[2]);
      col.push(r * f.shade, g * f.shade, b * f.shade);
    }
    idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  void base;
}

/**
 * Extrude continuous corrugated galvanized-steel W-beam guardrails + grounded steel I-posts
 * + red/white retroreflectors across all active guardrail stretches in a chunk.
 *
 * @param {{ s: number, x: number, y: number, z: number, roadX: number, roadZ: number, side: number }[][]} runs
 * @returns {THREE.BufferGeometry | null}
 */
function buildGuardrailGeometry(runs) {
  const pos = [];
  const nor = [];
  const col = [];
  const idx = [];

  // Cross-section profile of a corrugated W-beam steel highway guardrail:
  // [inwardOffset (m), heightAboveGround (m), normalInward, normalUp, AO brightness]
  const PROFILE = [
    [-0.08, 0.86, 0.0, 1.0, 1.12],
    [0.05, 0.85, 0.72, 0.69, 1.06],
    [0.08, 0.76, 1.0, 0.0, 1.0],
    [0.02, 0.69, 0.85, -0.52, 0.72], // W-groove center shadow trough!
    [0.08, 0.62, 1.0, 0.0, 0.98],
    [0.05, 0.53, 0.72, -0.69, 0.82],
    [-0.08, 0.52, -0.6, -0.8, 0.68],
    [-0.09, 0.85, -1.0, 0.0, 0.76],
  ];
  const PCOUNT = PROFILE.length;

  const steelR = 0.68;
  const steelG = 0.72;
  const steelB = 0.77;

  for (const run of runs) {
    if (run.length < 2) continue;

    // Precompute smooth tangents & road-facing inward normals at each station.
    const frames = run.map((pt, i) => {
      const a = run[Math.max(0, i - 1)];
      const b = run[Math.min(run.length - 1, i + 1)];
      let tx = b.x - a.x;
      let tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      let nx = -tz;
      let nz = tx;
      if (nx * (pt.roadX - pt.x) + nz * (pt.roadZ - pt.z) < 0) {
        nx = -nx;
        nz = -nz;
      }
      return { ...pt, tx, tz, nx, nz };
    });

    /** @type {number[]} */
    const ringStarts = [];
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      ringStarts.push(pos.length / 3);
      for (let p = 0; p < PCOUNT; p++) {
        const [offN, offY, pnx, pny, ao] = PROFILE[p];
        pos.push(f.x + f.nx * offN, f.y + offY, f.z + f.nz * offN);
        const wnx = f.nx * pnx;
        const wny = pny;
        const wnz = f.nz * pnx;
        const nl = Math.hypot(wnx, wny, wnz) || 1;
        nor.push(wnx / nl, wny / nl, wnz / nl);
        col.push(steelR * ao, steelG * ao, steelB * ao);
      }

      // Grounded galvanized steel post sinking cleanly into the shoulder every 4m!
      pushOrientedBox(
        pos, nor, col, idx,
        f.x - f.nx * 0.14, f.y, f.z - f.nz * 0.14,
        f.tx, f.tz, f.nx, f.nz,
        0.075, 0.085, -0.55, 0.87,
        0.44, 0.48, 0.53,
      );

      // High-visibility mountain pass retroreflector tab every 8m inside the W-beam trough!
      if (i % 2 === 0) {
        const isOuterRed = f.side > 0;
        pushOrientedBox(
          pos, nor, col, idx,
          f.x + f.nx * 0.055, f.y, f.z + f.nz * 0.055,
          f.tx, f.tz, f.nx, f.nz,
          0.11, 0.025, 0.655, 0.725,
          isOuterRed ? 0.96 : 0.98,
          isOuterRed ? 0.18 : 0.78,
          isOuterRed ? 0.14 : 0.22,
        );
      }
    }

    for (let i = 0; i < frames.length - 1; i++) {
      const r0 = ringStarts[i];
      const r1 = ringStarts[i + 1];
      for (let p = 0; p < PCOUNT; p++) {
        const pNext = (p + 1) % PCOUNT;
        const a = r0 + p;
        const b = r0 + pNext;
        const c = r1 + p;
        const d = r1 + pNext;
        idx.push(a, c, b, b, c, d);
      }
    }
  }

  if (idx.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Creates and recycles world road chunks with continuous safety guardrails,
 * solid corridor colliders, and globally pooled roadside furniture instancing.
 */
export function createChunkManager(options) {
  const { profile, scene, assets, seed, collisions } = options;
  const delineator = createDelineatorAsset();

  const guardrailMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.52,
    side: THREE.DoubleSide,
  });

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

  /**
   * Deterministic guardrail predicate evaluated along any `s` and `side` (-1 | 1)
   * so adjacent chunks agree 100% cleanly at boundaries with zero seams!
   */
  function rawNeedGuardrail(s, side) {
    const roadY = roadHeight(profile, s);
    const half = roadHalfWidth(profile, s);
    const lowestOutward = Math.min(
      vergeHeight(s, side * (half + 14), 1.0),
      vergeHeight(s, side * (half + 28), 1.0),
      vergeHeight(s, side * (half + 44), 1.0),
    );
    const outsideDrop = roadY - lowestOutward;
    const curve = roadCurvature(profile, s);
    const outerSide = Math.abs(curve) > 0.0026 ? (curve > 0 ? -1 : 1) : 0;
    return outsideDrop > 0.85 || (side === outerSide && Math.abs(curve) > 0.0033);
  }

  function needGuardrail(s, side) {
    if (rawNeedGuardrail(s, side)) return true;
    // Bridge short single-station dips so guardrails form clean unbroken highway runs!
    return rawNeedGuardrail(s - 4, side) && rawNeedGuardrail(s + 4, side);
  }

  /**
   * @type {Map<number, {
   *   group: THREE.Group,
   *   props: Map<string, { asset: any, matrices: THREE.Matrix4[] }>,
   * }>}
   */
  const chunks = new Map();

  /** Global pooled InstancedMesh container for all road furniture across active chunks. */
  const propPoolGroup = new THREE.Group();
  scene.add(propPoolGroup);

  function disposePoolMeshes() {
    while (propPoolGroup.children.length > 0) {
      const child = propPoolGroup.children.pop();
      propPoolGroup.remove(child);
      if (child instanceof THREE.InstancedMesh) child.dispose();
      else if (child instanceof THREE.Mesh && child.userData.ownsGeometry) child.geometry.dispose();
    }
  }

  function flushPropPool() {
    disposePoolMeshes();
    /** @type {Map<string, { asset: any, matrices: THREE.Matrix4[] }>} */
    const mergedBuckets = new Map();
    /** @type {any[][]} */
    const mergedRailRuns = [];
    for (const entry of chunks.values()) {
      if (entry.railRuns) {
        for (let r = 0; r < entry.railRuns.length; r++) mergedRailRuns.push(entry.railRuns[r]);
      }
      for (const [key, bucket] of entry.props) {
        let target = mergedBuckets.get(key);
        if (!target) {
          target = { asset: bucket.asset, matrices: [] };
          mergedBuckets.set(key, target);
        }
        for (let i = 0; i < bucket.matrices.length; i++) {
          target.matrices.push(bucket.matrices[i]);
        }
      }
    }

    const railGeo = buildGuardrailGeometry(mergedRailRuns);
    if (railGeo) {
      const railMesh = new THREE.Mesh(railGeo, guardrailMaterial);
      railMesh.userData.ownsGeometry = true;
      railMesh.castShadow = true;
      railMesh.receiveShadow = true;
      propPoolGroup.add(railMesh);
    }

    for (const [key, bucket] of mergedBuckets) {
      if (bucket.matrices.length === 0) continue;
      for (const groupPart of bucket.asset.groups) {
        const mesh = new THREE.InstancedMesh(groupPart.geometry, groupPart.material, bucket.matrices.length);
        for (let i = 0; i < bucket.matrices.length; i++) {
          mesh.setMatrixAt(i, bucket.matrices[i]);
        }
        mesh.instanceMatrix.needsUpdate = true;
        // Small distant delineator posts never need shadow passes; lamps & boulders cast crisp shadows!
        mesh.castShadow = key !== 'delineator';
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        propPoolGroup.add(mesh);
      }
    }
  }

  function buildChunk(index) {
    const startS = index * SEGMENTS_PER_CHUNK * SEGMENT_LENGTH;
    const endS = startS + SEGMENTS_PER_CHUNK * SEGMENT_LENGTH;
    const chunkKey = `road:${index}`;
    collisions?.clearGroup(chunkKey);

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

    // 1. Build continuous curved W-beam guardrails at 4m spacing across [startS .. endS].
    const RAIL_STEP = 4;
    /** @type {{ s: number, x: number, y: number, z: number, roadX: number, roadZ: number, side: number }[][]} */
    const allRailRuns = [];
    for (const side of [-1, 1]) {
      /** @type {{ s: number, x: number, y: number, z: number, roadX: number, roadZ: number, side: number }[]} */
      let currentRun = [];
      for (let s = startS; s <= endS; s += RAIL_STEP) {
        if (needGuardrail(s, side)) {
          const centre = roadOffset(profile, s);
          const half = roadHalfWidth(profile, s);
          const lateral = side * (half + 0.92);
          const x = centre + lateral;
          const y = surfaceHeight(profile, centre + side * (half + 0.35), s) - 0.04;
          currentRun.push({ s, x, y, z: s, roadX: centre, roadZ: s, side });
        } else {
          if (currentRun.length >= 2) allRailRuns.push(currentRun);
          currentRun = [];
        }
      }
      if (currentRun.length >= 2) allRailRuns.push(currentRun);
    }

    for (const run of allRailRuns) {
      collisions?.addGuardrailRun(chunkKey, run, 0.92);
    }

    // 2. Roadside boulders, curve delineator posts, turnout lamps & pass signs.
    const length = (endS - startS) / SEGMENT_LENGTH;
    for (let i = 0; i < length; i++) {
      const s = startS + i * SEGMENT_LENGTH;
      const centre = roadOffset(profile, s);
      const half = roadHalfWidth(profile, s);
      const drift = driftFactor(profile, s);
      const roadY = roadHeight(profile, s);
      const waterLevel = roadY - WATER_DROP;
      const heading = roadHeading(profile, s);

      // Solid boulders & scree stones along rock cuts & mountain shoulders (NEVER trees!).
      if (random() < 0.52) {
        const side = random() < 0.5 ? -1 : 1;
        const distance = half + 3.4 + random() * 28;
        const z = s + (random() - 0.5) * SEGMENT_LENGTH;
        const lateral = side * distance;
        const x = roadOffset(profile, z) + lateral;
        const y = vergeHeight(z, lateral, 1.0) - 0.26;
        if (y > waterLevel - 0.3 && isStandable(z, lateral, 2.5)) {
          const roll = random();
          const rockKey = roll < 0.45 ? 'rock' : roll < 0.78 ? 'rockSmall' : 'rockTall';
          const scale = 0.42 + random() * 0.46;
          place(rockKey, x, y, z, random() * Math.PI * 2, scale);
          const baseRadius = rockKey === 'rockSmall' ? 0.95 : rockKey === 'rockTall' ? 1.45 : 1.35;
          collisions?.addObstacle(chunkKey, 'rock', x, y, z, baseRadius * scale, 2.2 * scale);
        }
      }

      // Curve delineator posts every 24m wherever there is no steel guardrail.
      for (const side of [-1, 1]) {
        if (!needGuardrail(s, side) && i % 4 === 0 && drift < 0.2) {
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

      // Scenic widened alpine drift overlooks: warm pass lamps with solid steel pole colliders.
      if (drift > 0.45 && i % 4 === 0) {
        const side = (index + i) % 8 < 4 ? 1 : -1;
        const lateral = side * (half + 1.55);
        const lx = centre + lateral;
        const ly = vergeHeight(s, lateral, 0.4) - 0.06;
        place('lightPost', lx, ly, s, heading - (side * Math.PI) / 2, 0.92);
        collisions?.addObstacle(chunkKey, 'post', lx, ly, s, 0.36, 4.5);
      }

      // Pass marker signs along the outside verge with solid steel post colliders.
      if (s > 0 && s % 480 < SEGMENT_LENGTH) {
        const side = ((Math.floor(s / 480) + seed) & 1) === 0 ? 1 : -1;
        const lateral = side * (half + 2.15);
        const sx = centre + lateral;
        const sy = vergeHeight(s, lateral, 0.4) - 0.06;
        place('sign', sx, sy, s, heading + (side > 0 ? Math.PI : 0), 0.95);
        collisions?.addObstacle(chunkKey, 'post', sx, sy, s, 0.34, 2.8);
      }
    }

    scene.add(group);
    const entry = { group, props: buckets, railRuns: allRailRuns };
    chunks.set(index, entry);
    return entry;
  }

  function releaseChunk(index) {
    const entry = chunks.get(index);
    if (!entry) return;
    collisions?.clearGroup(`road:${index}`);
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
      let dirty = false;
      for (let index = first; index <= last; index++) {
        if (!chunks.has(index)) {
          buildChunk(index);
          dirty = true;
        }
      }
      for (const index of Array.from(chunks.keys())) {
        if (index < first - 1 || index > last + 1) {
          releaseChunk(index);
          dirty = true;
        }
      }
      if (dirty) flushPropPool();
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
      disposePoolMeshes();
      scene.remove(propPoolGroup);
      guardrailMaterial.dispose();
      for (const part of delineator.groups) {
        part.geometry.dispose();
        part.material.dispose();
      }
    },
  };
}
