/**
 * The terrain ribbon.
 *
 * Streams seamless road-hugging alpine terrain chunks with:
 *   1. Progressive LOD refinement (`ROW_NEAR` near the car, coarser further out).
 *   2. Exact triangle barycentric grounding (`meshCell`) matching the rendered
 *      triangle diagonal split so 0 / ~3,000 props ever float off the mesh.
 *   3. Single-draw-call 1024x1024 4x4 vegetation atlas batching ALL distant
 *      trees, shrubs, & wildflowers across all 9 chunks into ONE GPU draw call,
 *      paired with real shadow-casting 3D GLTF trees right beside the road.
 *   4. Global pooled InstancedMeshes for rocks, logs & stumps + solid rigid
 *      boulder colliders near the road (never on trees, bushes, or grass).
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

export const VEGETATION_KEYS = [
  'treeOak',
  'tree',
  'treeTall',
  'treeFat',
  'treeDetailed',
  'treeSimple',
  'treePine',
  'treePineShort',
  'treePineSlim',
  'treePineWide',
  'treeCone',
  'bushLarge',
  'bush',
  'bushSmall',
  'grass',
];

/**
 * Lateral column offsets (metres outward from the road edge).
 * Fine across shoulder, lake shore, and valley wall face; progressively coarser out in the range.
 */
export const TERRAIN_COLUMNS = [
  0, 1.6, 3.8, 6.8, 10.5, 15, 20.5, 26.5,
  33, 40, 47, 54.5, 62, 70, 78.5, 87, 96, 105.5, 115, 125, 135.5, 146, 157,
  168.5, 180, 192.5, 205, 218.5, 232, 246.5, 262, 278, 295,
  313, 332, 353, 375, 399, 425, 453, 483, 515, 550, 588, 629, 673, 721, 773,
  830, 892, 960, 1034, 1115,
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
 *   getAtlas?: () => any,
 *   collisions?: any,
 * }} options
 */
export function createTerrainManager(options) {
  const { profile, scene, seed, terrainMaterial, assets, collisions } = options;

  /**
   * @typedef {{
   *   key: string,
   *   matrix: THREE.Matrix4,
   *   r: number,
   *   g: number,
   *   b: number,
   *   scale: number,
   *   near3D: boolean,
   * }} VegInstance
   */

  /**
   * @typedef {{
   *   key: string,
   *   asset: any,
   *   matrix: THREE.Matrix4,
   *   r: number,
   *   g: number,
   *   b: number,
   *   nearShadow: boolean,
   * }} PropInstance
   */

  /**
   * @type {Map<number, {
   *   group: THREE.Group,
   *   mesh: THREE.Mesh,
   *   rows: number,
   *   step: number,
   *   startS: number,
   *   heights: Float32Array,
   *   veg: VegInstance[],
   *   props: PropInstance[],
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

  /** Global pooled scenery group — replaces ~250 per-chunk InstancedMeshes with ~10 global draw calls! */
  const globalSceneryGroup = new THREE.Group();
  scene.add(globalSceneryGroup);

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

    const half0 = roadHalfWidth(profile, startS + r0 * step);
    const half1 = roadHalfWidth(profile, startS + r1 * step);
    const halfAtRow = half0 + (half1 - half0) * tr;

    const onLeft = lateral < 0;
    const distance = Math.max(0, Math.abs(lateral) - halfAtRow);

    let colIdx = 0;
    while (colIdx < SIDE_COLUMNS - 2 && TERRAIN_COLUMNS[colIdx + 1] < distance) colIdx++;
    const span = Math.max(0.001, TERRAIN_COLUMNS[colIdx + 1] - TERRAIN_COLUMNS[colIdx]);
    const u = Math.min(1, Math.max(0, (distance - TERRAIN_COLUMNS[colIdx]) / span));

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

  function clearGlobalScenery() {
    while (globalSceneryGroup.children.length > 0) {
      const child = globalSceneryGroup.children.pop();
      globalSceneryGroup.remove(child);
      if (child instanceof THREE.InstancedMesh) {
        if (child.userData.ownsGeometry) child.geometry.dispose();
        child.dispose();
      }
    }
  }

  /**
   * Consolidate ALL active chunks' vegetation & rocks into minimal global GPU batches:
   *   - ONE single atlased InstancedMesh for ALL ~3,000 forest trees/bushes/flowers!
   *   - Near-road 3D GLTF InstancedMeshes (`castShadow = true`) for close trees in adjacent chunks!
   *   - ONE pooled InstancedMesh per rock/log/stump species!
   */
  function rebuildGlobalScenery() {
    clearGlobalScenery();

    const atlas = options.getAtlas?.() ?? null;
    /** @type {VegInstance[]} */
    const atlasItems = [];
    /** @type {Map<string, VegInstance[]>} */
    const fallbackBillboardBuckets = new Map();
    /** @type {Map<string, VegInstance[]>} */
    const near3DTreeBuckets = new Map();
    /** @type {Map<string, PropInstance[]>} */
    const propBuckets = new Map();

    for (const [chunkIdx, entry] of chunks) {
      const isNearChunk = chunkIdx === currentChunk;
      for (let i = 0; i < entry.veg.length; i++) {
        const item = entry.veg[i];
        if (item.near3D && isNearChunk && assets?.prop?.(item.key)) {
          let list = near3DTreeBuckets.get(item.key);
          if (!list) {
            list = [];
            near3DTreeBuckets.set(item.key, list);
          }
          list.push(item);
        } else if (atlas && atlas.entries[item.key]) {
          atlasItems.push(item);
        } else {
          let list = fallbackBillboardBuckets.get(item.key);
          if (!list) {
            list = [];
            fallbackBillboardBuckets.set(item.key, list);
          }
          list.push(item);
        }
      }

      for (let i = 0; i < entry.props.length; i++) {
        const p = entry.props[i];
        let list = propBuckets.get(p.key);
        if (!list) {
          list = [];
          propBuckets.set(p.key, list);
        }
        list.push(p);
      }
    }

    // 1. Single-draw-call 1024x1024 4x4 vegetation atlas for ALL distant vegetation!
    if (atlas && atlasItems.length > 0) {
      const geo = atlas.geometry.clone();
      const rects = new Float32Array(atlasItems.length * 4);
      const colors = new Float32Array(atlasItems.length * 3);
      const mesh = new THREE.InstancedMesh(geo, atlas.material, atlasItems.length);
      mesh.userData.ownsGeometry = true;

      for (let i = 0; i < atlasItems.length; i++) {
        const it = atlasItems[i];
        const info = atlas.entries[it.key];
        mesh.setMatrixAt(i, it.matrix);
        rects[i * 4] = info.u;
        rects[i * 4 + 1] = info.v;
        rects[i * 4 + 2] = info.width;
        rects[i * 4 + 3] = info.height;
        colors[i * 3] = it.r;
        colors[i * 3 + 1] = it.g;
        colors[i * 3 + 2] = it.b;
      }
      geo.setAttribute('aAtlasRect', new THREE.InstancedBufferAttribute(rects, 4));
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      globalSceneryGroup.add(mesh);
    }

    // Fallback per-species billboard path if a headless test mocks getImpostor without getAtlas.
    for (const [key, list] of fallbackBillboardBuckets) {
      const imp = options.getImpostor?.(key);
      if (!imp || list.length === 0) continue;
      const mesh = new THREE.InstancedMesh(imp.geometry, imp.material, list.length);
      const colors = new Float32Array(list.length * 3);
      for (let i = 0; i < list.length; i++) {
        mesh.setMatrixAt(i, list[i].matrix);
        colors[i * 3] = list[i].r;
        colors[i * 3 + 1] = list[i].g;
        colors[i * 3 + 2] = list[i].b;
      }
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      globalSceneryGroup.add(mesh);
    }

    // 2. Real 3D shadow-casting specimen trees right beside the road (zero collision — pass-through!).
    for (const [key, list] of near3DTreeBuckets) {
      const asset = assets?.prop?.(key);
      if (!asset || list.length === 0) continue;
      for (const part of asset.groups) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        const colors = new Float32Array(list.length * 3);
        for (let i = 0; i < list.length; i++) {
          mesh.setMatrixAt(i, list[i].matrix);
          colors[i * 3] = list[i].r;
          colors[i * 3 + 1] = list[i].g;
          colors[i * 3 + 2] = list[i].b;
        }
        mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        globalSceneryGroup.add(mesh);
      }
    }

    // 3. Global pooled rock, boulder, fallen log & stump meshes.
    for (const [, list] of propBuckets) {
      if (list.length === 0) continue;
      const asset = list[0].asset;
      for (const part of asset.groups) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        const colors = new Float32Array(list.length * 3);
        for (let i = 0; i < list.length; i++) {
          mesh.setMatrixAt(i, list[i].matrix);
          colors[i * 3] = list[i].r;
          colors[i * 3 + 1] = list[i].g;
          colors[i * 3 + 2] = list[i].b;
        }
        mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        globalSceneryGroup.add(mesh);
      }
    }
  }

  /**
   * Populate chunk vegetation & rock records on exact built triangles,
   * registering solid boulder colliders near the road while keeping ALL trees/shrubs/grass pass-through.
   */
  function collectScenery(index, startS) {
    /** @type {VegInstance[]} */
    const veg = [];
    /** @type {PropInstance[]} */
    const props = [];
    if (!assets) return { veg, props };

    const chunkKey = `terrain:${index}`;
    collisions?.clearGroup(chunkKey);

    const random = chunkRandom(index * 7919 + 13, seed);
    const dummy = new THREE.Object3D();
    const upAxis = new THREE.Vector3(0, 1, 0);
    const tiltAxis = new THREE.Vector3();
    const tilt = new THREE.Quaternion();
    const yaw = new THREE.Quaternion();
    const tilted = new THREE.Quaternion();

    const placeProp = (key, x, y, z, rotation, scale, sink = 0.2, lean = 0, solidRadius = 0) => {
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
      const tint = 0.84 + random() * 0.32;
      props.push({
        key,
        asset,
        matrix: dummy.matrix.clone(),
        r: tint,
        g: tint * (0.97 + random() * 0.07),
        b: tint * (0.94 + random() * 0.1),
        nearShadow: solidRadius > 0,
      });
      if (solidRadius > 0) {
        collisions?.addObstacle(chunkKey, 'rock', x, y - sink, z, solidRadius, 2.2 * scale);
      }
    };

    const placeVeg = (key, x, y, z, rotation, scale, sink = 0.14, near3D = false) => {
      dummy.position.set(x, y - sink, z);
      dummy.quaternion.identity();
      dummy.rotation.set(0, rotation, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      let r;
      let g;
      let b;
      if (key === 'grass' && random() > 0.56) {
        const fc = FLOWERS[Math.floor(random() * FLOWERS.length)];
        [r, g, b] = fc;
      } else {
        const tint = 0.82 + random() * 0.36;
        const warmth = 0.94 + random() * 0.14;
        r = tint * warmth;
        g = tint * (0.98 + random() * 0.06);
        b = tint * (0.9 + random() * 0.14);
      }
      veg.push({
        key,
        matrix: dummy.matrix.clone(),
        r,
        g,
        b,
        scale,
        near3D,
      });
    };

    const samples = Math.round(980 * forestDensity);
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

      if (y < waterLevel + 0.35) continue;

      const altitude = y - roadY;
      const slope = meshSlope(s, lateral, 2.6);
      const cliff = cell.spread > Math.max(9.5, distance * 0.145);

      if (cliff || slope > 1.06 || altitude > 142) {
        if (distance < half + 300 && random() < 0.34) {
          const key = random() < 0.52 ? 'rock' : 'rockSmall';
          const sc = 0.35 + random() * 0.42;
          const solidR = distance < half + 44 ? (key === 'rock' ? 1.35 : 0.95) * sc : 0;
          placeProp(key, x, y, z, random() * Math.PI * 2, sc, 0.22, Math.min(0.65, 0.25 + slope * 0.4), solidR);
        }
        continue;
      }

      if (slope > 0.86) {
        if (random() < 0.52) {
          placeVeg('bushSmall', x, y, z, random() * Math.PI * 2, 0.7 + random() * 0.5, 0.14, false);
        } else if (distance < half + 260 && random() < 0.38) {
          const key = random() < 0.6 ? 'rock' : 'rockTall';
          const sc = 0.42 + random() * 0.48;
          const solidR = distance < half + 44 ? 1.4 * sc : 0;
          placeProp(key, x, y, z, random() * Math.PI * 2, sc, 0.22, Math.min(0.6, slope * 0.7), solidR);
        }
        continue;
      }

      const grove = treeDensity(x, z, seed);
      const treelineFade = 1 - Math.max(0, Math.min(1, (altitude - 92) / 48));

      if (distance < half + 34) {
        const kind = random();
        if (grove > 0.44 && kind < 0.54 * treelineFade) {
          const conifer = altitude > 32 || random() < 0.54;
          const kinds = conifer ? CONIFER : BROADLEAF;
          const treeKey = kinds[Math.floor(random() * kinds.length)];
          // Use full shadow-casting 3D GLTF trees right next to the road (< half + 24m)!
          const use3D = distance < half + 24;
          placeVeg(treeKey, x, y, z, random() * Math.PI * 2, 0.84 + random() * 0.48, 0.14, use3D);
        } else if (kind < 0.68) {
          placeVeg(
            random() < 0.45 ? 'bushLarge' : random() < 0.78 ? 'bush' : 'bushSmall',
            x,
            y,
            z,
            random() * Math.PI * 2,
            0.75 + random() * 0.65,
            0.12,
            false,
          );
        } else if (kind < 0.9) {
          placeVeg('grass', x, y, z, random() * Math.PI * 2, 0.85 + random() * 0.75, 0.1, false);
        } else {
          const isRock = random() < 0.68;
          const sc = 0.52 + random() * 0.5;
          placeProp(
            isRock ? 'rockSmall' : 'log',
            x,
            y,
            z,
            random() * Math.PI * 2,
            sc,
            0.18,
            slope * 0.6,
            isRock ? 0.95 * sc : 0,
          );
        }
      } else {
        if (random() > (0.22 + grove * 0.92) * treelineFade) {
          if (distance < half + 220 && random() < 0.16) {
            const sc = 0.7 + random() * 0.85;
            placeProp('rock', x, y, z, random() * Math.PI * 2, sc, 0.22, slope * 0.75, distance < half + 46 ? 1.35 * sc : 0);
          }
          continue;
        }
        const kind = random();
        const conifer = altitude > 26 || random() < 0.74;
        const kinds = conifer ? CONIFER : BROADLEAF;
        const treeKey = kinds[Math.floor(random() * kinds.length)];
        if (kind < 0.76) {
          placeVeg(treeKey, x, y, z, random() * Math.PI * 2, 0.82 + random() * 0.58, 0.15, false);
        } else if (kind < 0.9) {
          placeVeg('treePineSlim', x, y, z, random() * Math.PI * 2, 0.75 + random() * 0.55, 0.15, false);
        } else if (distance < half + 180) {
          placeProp(
            random() < 0.55 ? 'rockTall' : 'stump',
            x,
            y,
            z,
            random() * Math.PI * 2,
            0.65 + random() * 0.65,
            0.2,
            slope * 0.6,
            0,
          );
        }
      }
    }

    return { veg, props };
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
        const i = r * columns + c;
        laterals[i] = lateral;
        const x = centre + lateral;
        const y = surfaceHeight(profile, x, s);
        heights[i] = y;
        const p = i * 3;
        positions[p] = x;
        positions[p + 1] = y;
        positions[p + 2] = s;
        const u = i * 2;
        uvs[u] = x / 18;
        uvs[u + 1] = s / 18;
      }
    }

    for (let r = 0; r < rows; r++) {
      const s = startS + r * step;
      const roadY = roadHeight(profile, s);
      const waterY = roadY - WATER_DROP;
      const half = roadHalfWidth(profile, s);
      for (let c = 0; c < columns; c++) {
        const i = r * columns + c;
        const lateral = laterals[i];
        const x = centres[r] + lateral;
        const y = heights[i];

        const onLeft = c < SIDE_COLUMNS;
        const stripFirst = onLeft ? 0 : SIDE_COLUMNS;
        const stripLast = stripFirst + SIDE_COLUMNS - 1;
        const cLeft = Math.max(stripFirst, c - 1);
        const cRight = Math.min(stripLast, c + 1);
        const dx = laterals[r * columns + cRight] - laterals[r * columns + cLeft] || 1;
        const dhx = heights[r * columns + cRight] - heights[r * columns + cLeft];

        const rPrev = Math.max(0, r - 1);
        const rNext = Math.min(rows - 1, r + 1);
        const dz = (rNext - rPrev) * step || 1;
        const dhz = heights[rNext * columns + c] - heights[rPrev * columns + c];

        let nx = -dhx / dx;
        let ny = 1;
        let nz = -dhz / dz;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;

        const p = i * 3;
        normals[p] = nx;
        normals[p + 1] = ny;
        normals[p + 2] = nz;

        const avgNeighbors =
          (heights[r * columns + cLeft] +
            heights[r * columns + cRight] +
            heights[rPrev * columns + c] +
            heights[rNext * columns + c]) *
          0.25;
        const concavity = Math.max(-1, Math.min(1, (avgNeighbors - y) / 4.5));

        const slope = Math.min(1, (1 - ny) * 2.15);
        const dist = Math.max(0, Math.abs(lateral) - half);
        const altitude = y - roadY;
        const patch = fbm(x * 0.0048, s * 0.0048, 3, seed + 17) * 0.5 + 0.5;
        const rockPatch = fbm(x * 0.013 + 7.4, s * 0.013 - 3.9, 3, seed + 29) * 0.5 + 0.5;
        const mottle = fbm(x * 0.052, s * 0.052, 2, seed + 41) * 0.5 + 0.5;

        groundColour(slope, altitude, dist, patch, rockPatch, colour, mottle);
        const ao = 1 - Math.max(0, concavity) * 0.24;
        colors[p] = colour[0] * ao;
        colors[p + 1] = colour[1] * ao;
        colors[p + 2] = colour[2] * ao;

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
    mesh.receiveShadow = step <= 2;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);

    const water = buildWater(startS, TERRAIN_CHUNK_LENGTH);
    if (water) group.add(water);

    const entry = { group, mesh, rows, step, startS, heights, veg: [], props: [] };
    chunks.set(index, entry);

    const collected = collectScenery(index, startS);
    entry.veg = collected.veg;
    entry.props = collected.props;
    scene.add(group);
  }

  function releaseChunk(index) {
    const entry = chunks.get(index);
    if (!entry) return;
    collisions?.clearGroup(`terrain:${index}`);
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
      const nextChunk = Math.floor(playerS / TERRAIN_CHUNK_LENGTH);
      const movedChunk = nextChunk !== currentChunk;
      currentChunk = nextChunk;
      let refinedNear = false;
      let changed = movedChunk;

      if (!treesReady && (options.getAtlas?.() || options.getImpostor?.('treeOak'))) {
        treesReady = true;
        for (const index of Array.from(chunks.keys())) releaseChunk(index);
        changed = true;
      }

      const first = currentChunk - TERRAIN_BEHIND;
      const last = currentChunk + TERRAIN_AHEAD;
      for (let index = first; index <= last; index++) {
        const dist = Math.abs(index - currentChunk);
        const wanted = rowStep(dist);
        const existing = chunks.get(index);
        if (!existing) {
          buildChunk(index, dist);
          changed = true;
        } else if (existing.step > wanted + 0.5) {
          releaseChunk(index);
          buildChunk(index, dist);
          changed = true;
          if (dist <= 1) refinedNear = true;
        }
      }
      for (const index of Array.from(chunks.keys())) {
        if (index < first - 1 || index > last + 1) {
          releaseChunk(index);
          changed = true;
        }
      }
      if (changed) rebuildGlobalScenery();
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
      clearGlobalScenery();
      scene.remove(globalSceneryGroup);
    },
  };
}
