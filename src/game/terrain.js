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
 * Distance from the edge of the road for each column of the ribbon.
 *
 * The spacing is deliberately uneven: fine close to the road where the
 * detail matters, coarse out in the mountains where the mesh is only a
 * silhouette.
 */
export const TERRAIN_COLUMNS = [
  // The verge: fine enough that the ditch and the shoulder read as shapes.
  0, 2.2, 5, 8, 12, 17, 23,
  // The face of the valley wall. This is the band the player looks at all
  // the way along the drive, and the land climbs most of its height in here:
  // a coarse grid turns that climb into one stretched quad with one flat
  // normal, which is exactly what makes a mountain look like a sheet.
  30, 35, 40, 45.5, 51, 57, 63, 69, 75, 81.5, 88, 95, 102, 109, 116, 124,
  132, 140, 149, 158, 167, 177, 187, 198, 209, 221, 234, 247, 261, 276, 292,
  // The mountain itself, getting coarser with distance.
  309, 327, 346, 367, 389, 412, 437, 464, 493, 524, 557, 592, 630, 671, 715,
  762, 812, 866, 924, 986, 1052, 1123,
  // The far columns reach well past the fog, so the edge of the mesh is never
  // visible as a straight cut against the sky.
  1200, 1283, 1373, 1470, 1575, 1688, 1810, 1941, 2082, 2234, 2398,
];
/** Columns on each side of the road. */
const SIDE_COLUMNS = TERRAIN_COLUMNS.length;
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
  // The kinds of tree that grow here. A forest that is all one species looks
  // like a plantation, so the kinds are mixed and the pines take over higher
  // up the mountain.
  const BROADLEAF = ['treeOak', 'tree', 'treeTall', 'treeFat', 'treeDetailed', 'treeSimple', 'treeCone'];
  const CONIFER = ['treePine', 'treePineShort', 'treePineSlim', 'treePineWide'];
  /** The colours of the wildflowers along the verge. */
  const FLOWERS = [
    [1.35, 1.2, 0.45],
    [1.4, 0.85, 0.95],
    [1.3, 1.3, 1.25],
    [1.25, 0.95, 0.5],
  ];
  const dummy = new THREE.Object3D();
  // The trees are baked into a texture when the assets are ready. A race can
  // start before they are, so the chunks are rebuilt once they are.
  let treesReady = false;
  // The chunk the player is in: it decides the level of detail around him.
  let currentChunk = 0;

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
    // One column per distance on each side of the road.
    const columns = SIDE_COLUMNS * 2;

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
        // Two strips, one on each side of the road, both ending exactly on
        // the tarmac edge. The road itself is covered by the road mesh: a
        // strip that ran across it would bridge the two verges with one long
        // quad and slice through the tarmac on every banked corner.
        const onLeft = c < SIDE_COLUMNS;
        const base = TERRAIN_COLUMNS[onLeft ? SIDE_COLUMNS - 1 - c : c - SIDE_COLUMNS];
        const lateral = (onLeft ? -1 : 1) * (base + half);
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
        // A hollow is darker than a spur: the grid curvature, scaled to a
        // slope, tells the two apart without another noise lookup.
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
        const crease = (acrossCurve + alongCurve) * 12;
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
        uvs[uvIndex] = lateral / 5;
        uvs[uvIndex + 1] = s / 5;

        // Colour from the slope and the altitude.
        const slope = Math.min(1, Math.hypot(nx, nz) / Math.max(0.001, ny) / 1.9);
        const altitude = y - roadY;
        const dist = Math.abs(lateral) - roadHalfWidth(profile, s);
        const patch = fbm(x * 0.013, s * 0.013, 3, seed + 17) * 0.5 + 0.5;
        const rockPatch = fbm(x * 0.011, s * 0.011, 3, seed + 61) * 0.5 + 0.5;
        const mottle = fbm(x * 0.07, s * 0.07, 2, seed + 89) * 0.5 + 0.5;
        groundColour(slope, altitude, dist, patch, rockPatch, colour, mottle);
        // The cracks in the face are darker than the rock around them. The
        // curvature of the height grid gives that for free: a hollow collects
        // shadow, a spur catches the sun.
        const shade = 1 + Math.max(-0.45, Math.min(0.45, crease)) * 0.55;
        colors[index] = colour[0] * shade;
        colors[index + 1] = colour[1] * shade;
        colors[index + 2] = colour[2] * shade;
      }
    }

    // The two strips are meshed separately: the last column of the left strip
    // and the first column of the right strip are the two road edges, and the
    // tarmac between them is the road mesh.
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
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, terrainMaterial);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);

    // The lakes: the same ribbon, but below the ground, so only the parts
    // that are actually under water are drawn.
    const water = buildWater(startS, rows, step);
    if (water) group.add(water);

    addScenery(group, index, startS, rows, step);

    scene.add(group);
    chunks.set(index, { group, mesh });
  }

  /**
   * Build the water surface of a chunk.
   *
   * The surface sits a fixed distance below the road, so the low parts of the
   * valley fill up and the road never gets flooded.
   *
   * It has a grid of its own instead of reusing the terrain columns: the
   * terrain is deliberately coarse far from the road, and a lake surface
   * stretched over one of those 200 metre cells hangs in the air across the
   * mountainside it is supposed to be hiding in. The water samples the land
   * every few metres, so its shore follows the real shoreline, and it stops
   * a few hundred metres out, where a lake can no longer be.
   *
   * @param {number} startS
   * @param {number} rows
   * @param {number} step
   * @returns {THREE.Mesh | null}
   */
  function buildWater(startS, rows, step) {
    if (!options.waterMaterial) return null;
    // A lake lives in the valley floor, close to the road. Further out the
    // land has climbed into the mountains and there is nothing to fill.
    // Only the ground close to the road is fine enough for a clean
    // shoreline; further out the land has climbed away from the water anyway.
    const REACH = 150;
    // Fine enough that the shore is a shoreline and not a staircase.
    const SPACING = 4;
    const columns = Math.ceil((REACH * 2) / SPACING) + 1;
    // The water is cheaper than the land, so it follows the road more finely
    // than the coarse chunks behind and ahead of the player.
    const waterStep = Math.min(step, 8);
    const waterRows = Math.max(2, Math.round((rows - 1) * step / waterStep)) + 1;

    const positions = [];
    const depths = [];
    const indices = [];
    let any = false;

    for (let r = 0; r < waterRows; r++) {
      const s = startS + r * waterStep;
      const centre = roadOffset(profile, s);
      const level = roadHeight(profile, s) - WATER_DROP;
      for (let c = 0; c < columns; c++) {
        const lateral = -REACH + c * SPACING;
        const ground = surfaceHeight(profile, centre + lateral, s);
        const depth = level - ground;
        if (depth > 0.02) any = true;
        positions.push(centre + lateral, level, s);
        depths.push(depth);
      }
    }
    if (!any) return null;

    for (let r = 0; r < waterRows - 1; r++) {
      for (let c = 0; c < columns - 1; c++) {
        const a = r * columns + c;
        const b = (r + 1) * columns + c;
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
   * The cell of the ribbon mesh that is drawn at a point.
   *
   * The mesh is a grid, and the ground between two columns and two rows is a
   * flat quad - two triangles, actually - while the real land is not. A prop
   * that is placed on the analytic height can therefore float above the mesh
   * or sink into it, and on a mountain the difference is metres. This returns
   * the four corners of the quad that is really drawn there.
   *
   * @param {number} s
   * @param {number} lateral
   * @returns {{ height: number, floor: number, spread: number }}
   */
  function meshCell(s, lateral) {
    const chunk = Math.floor(s / TERRAIN_CHUNK_LENGTH);
    const startS = chunk * TERRAIN_CHUNK_LENGTH;
    const wanted = rowStep(Math.abs(chunk - currentChunk));
    const rows = Math.max(2, Math.round(TERRAIN_CHUNK_LENGTH / wanted)) + 1;
    const step = TERRAIN_CHUNK_LENGTH / (rows - 1);

    const rowF = Math.min(rows - 1.0001, Math.max(0, (s - startS) / step));
    const r0 = Math.floor(rowF);
    const r1 = Math.min(rows - 1, r0 + 1);
    const t = rowF - r0;

    const half = roadHalfWidth(profile, s);
    const side = lateral < 0 ? -1 : 1;
    const distance = Math.abs(lateral) - half;
    const columns = TERRAIN_COLUMNS;
    let index = 0;
    while (index < columns.length - 2 && columns[index + 1] < distance) index++;
    const span = Math.max(0.001, columns[index + 1] - columns[index]);
    const u = distance <= 0 ? 0 : Math.min(1, Math.max(0, (distance - columns[index]) / span));

    /**
     * @param {number} rowIndex
     * @param {number} columnIndex
     * @returns {number}
     */
    const corner = (rowIndex, columnIndex) => {
      const cs = startS + rowIndex * step;
      const centre = roadOffset(profile, cs);
      const halfWidth = roadHalfWidth(profile, cs);
      const base = columns[Math.min(columns.length - 1, columnIndex)];
      return surfaceHeight(profile, centre + side * (base + halfWidth), cs);
    };

    const h00 = corner(r0, index);
    const h01 = corner(r0, index + 1);
    const h10 = corner(r1, index);
    const h11 = corner(r1, index + 1);
    const low = h00 + (h01 - h00) * u;
    const high = h10 + (h11 - h10) * u;
    const floor = Math.min(h00, h01, h10, h11);
    const spread = Math.max(h00, h01, h10, h11) - floor;
    return { height: low + (high - low) * t, floor, spread };
  }

  /**
   * The height of the ribbon mesh at a point, the way the mesh is drawn.
   *
   * @param {number} s
   * @param {number} lateral
   * @returns {number}
   */
  function ribbonHeight(s, lateral) {
    return meshCell(s, lateral).height;
  }

  /**
   * The lowest point of the mesh under a prop's footprint.
   *
   * A prop that is placed on the centre point of a slope still floats over
   * the downhill side of it, so the ground is sampled around the base and
   * the lowest of those samples wins.
   *
   * @param {number} s
   * @param {number} lateral
   * @param {number} spread metres
   */
  function baseHeight(s, lateral, spread) {
    const cell = meshCell(s, lateral);
    let y = Math.min(cell.height, cell.floor);
    y = Math.min(y, ribbonHeight(s, lateral - spread), ribbonHeight(s, lateral + spread));
    y = Math.min(y, ribbonHeight(s - spread, lateral), ribbonHeight(s + spread, lateral));
    return y;
  }

  /**
   * How steep the mesh is around a point.
   * @param {number} s
   * @param {number} lateral
   * @param {number} metres
   */
  function meshSlope(s, lateral, metres) {
    const across = ribbonHeight(s, lateral + metres) - ribbonHeight(s, lateral - metres);
    const along = ribbonHeight(s + metres, lateral) - ribbonHeight(s - metres, lateral);
    return Math.hypot(across, along) / (metres * 2);
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
    const upAxis = new THREE.Vector3(0, 1, 0);
    const tiltAxis = new THREE.Vector3();
    const tilt = new THREE.Quaternion();
    const yaw = new THREE.Quaternion();
    const tilted = new THREE.Quaternion();

    /**
     * @param {string} key
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} rotation yaw, radians
     * @param {number} scale
     * @param {number} [sink] how deep the base is pushed into the ground
     * @param {number} [lean] 0 = upright, 1 = lying flat on the slope
     */
    const place = (key, x, y, z, rotation, scale, sink = 0.25, lean = 0) => {
      const asset = assets.prop?.(key);
      if (!asset) return;
      dummy.position.set(x, y - sink, z);
      if (lean > 0.02) {
        // A boulder on a cliff leans into the rock face instead of standing
        // on end and hanging half out of it.
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

    /**
     * @param {string} key the impostor key
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} rotation
     * @param {number} scale
     */
    const placeTree = (key, x, y, z, rotation, scale, sink = 0.3) => {
      const impostor = options.getImpostor?.(key);
      if (!impostor) return;
      // The billboards are upright, so on a slope the base of the quad has to
      // be pushed further into the ground or the trunk hangs in the air.
      dummy.position.set(x, y - sink, z);
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
          : half + 30 + Math.pow(random(), 0.7) * 650;
      const x = centre + side * distance;
      const z = s;
      // The props stand on the mesh, not on the real terrain: the mesh is a
      // grid and the land between two of its columns is a straight line, so
      // the analytic height and the drawn height are not the same thing.
      //
      // `distance` is already measured from the centre line, so it is the
      // lateral offset itself - adding the half width again here used to put
      // every prop on the wrong column, which is what made rocks and trees
      // hang in the air above the cliffs.
      const lateral = side * distance;
      const cell = meshCell(s, lateral);
      const y = baseHeight(s, lateral, 1.4);
      const altitude = y - roadHeight(profile, s);
      const slope = meshSlope(s, lateral, 3);
      // The quad is flat, but its corners can still be tens of metres apart:
      // that is a cliff, and no tree stands on a cliff.
      const cliff = cell.spread > Math.max(2.5, distance * 0.05);

      if (cliff || slope > 0.85 || altitude > 260) {
        // Bare rock: only boulders and scree. Nothing grows on a cliff, and
        // the boulders that do sit on it lean into the face.
        if (random() < 0.45) {
          const key = random() < 0.5 ? 'rock' : 'rockSmall';
          place(
            key,
            x,
            y,
            z,
            random() * Math.PI * 2,
            0.32 + random() * 0.35,
            0.3 + Math.min(0.5, slope * 0.3),
            Math.min(0.6, 0.3 + slope * 0.35),
          );
        }
        continue;
      }
      if (slope > 0.5) {
        // A tree cannot stand on this, but a boulder can be wedged into it.
        if (random() < 0.5) {
          place('rock', x, y, z, random() * Math.PI * 2, 0.45 + random() * 0.4, 0.3, Math.min(0.6, slope * 0.7));
        }
        continue;
      }

      const kind = random();
      // The higher up the mountain, the more conifers.
      const conifer = altitude > 45 || random() < 0.35;
      const kinds = conifer ? CONIFER : BROADLEAF;
      const treeKey = kinds[Math.floor(random() * kinds.length)];

      if (distance < half + 36) {
        if (kind < 0.46) {
          placeTree(treeKey, x, y, z, random() * Math.PI * 2, 0.8 + random() * 0.5, 0.3 + slope * 2.2);
        } else if (kind < 0.66) {
          placeTree(
            random() < 0.5 ? 'bushLarge' : 'bush',
            x,
            y,
            z,
            random() * Math.PI * 2,
            0.8 + random() * 0.7,
            0.2 + slope * 0.9,
          );
        } else if (kind < 0.8) {
          placeTree('bushSmall', x, y, z, random() * Math.PI * 2, 0.8 + random() * 0.6, 0.15 + slope * 0.6);
        } else if (kind < 0.9) {
          place(
            random() < 0.5 ? 'rockSmall' : 'rockTall',
            x,
            y,
            z,
            random() * Math.PI * 2,
            0.7 + random() * 0.8,
            0.25 + slope * 0.6,
            slope * 0.7,
          );
        } else {
          // Tufts of grass along the verge.
          placeTree('grass', x, y, z, random() * Math.PI * 2, 0.9 + random() * 0.8, 0.1 + slope * 0.4);
        }
      } else {
        // Up in the mountains the forest thins out into pines and boulders.
        if (kind < 0.46) {
          placeTree(treeKey, x, y, z, random() * Math.PI * 2, 0.8 + random() * 0.6, 0.3 + slope * 2.2);
        } else if (kind < 0.62) {
          placeTree('treePineSlim', x, y, z, random() * Math.PI * 2, 0.7 + random() * 0.5, 0.3 + slope * 1.8);
        } else if (kind < 0.78) {
          place(random() < 0.5 ? 'rock' : 'rockTall', x, y, z, random() * Math.PI * 2, 0.9 + random() * 1.1, 0.3 + slope * 0.7, slope);
        } else if (kind < 0.9) {
          place('rockSmall', x, y, z, random() * Math.PI * 2, 0.8 + random() * 1.0, 0.25 + slope * 0.6, slope);
        } else {
          place('stump', x, y, z, random() * Math.PI * 2, 0.8 + random() * 0.5, 0.2 + slope * 0.5);
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
    for (const [key, bucket] of trees) {
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
      const flowers = key === 'grass';
      for (let i = 0; i < bucket.matrices.length; i++) {
        if (flowers) {
          // Some of the tufts are wildflowers.
          const roll = random();
          if (roll > 0.62) {
            const colour = FLOWERS[Math.floor(random() * FLOWERS.length)];
            mesh.instanceColor.setXYZ(i, colour[0], colour[1], colour[2]);
            continue;
          }
        }
        const tint = 0.8 + random() * 0.4;
        mesh.instanceColor.setXYZ(i, tint, tint * (0.97 + random() * 0.07), tint * (0.92 + random() * 0.12));
      }
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      // A crossed billboard throws a shadow of its own quads, not of a tree:
      // the sun rakes across the road in stripes. The far forest does not
      // need to cast, and it does not receive either.
      mesh.castShadow = false;
      mesh.receiveShadow = false;
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
      currentChunk = Math.floor(playerS / TERRAIN_CHUNK_LENGTH);
      if (!treesReady && options.getImpostor?.('treeOak')) {
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
    /**
     * The height of the mesh at a point, the same way the props are placed.
     * @param {number} s distance along the road
     * @param {number} lateral offset from the centre line
     * @returns {number}
     */
    sampleHeight(s, lateral) {
      return ribbonHeight(s, lateral);
    },
    /**
     * The quad of the mesh that is drawn at a point: its height, the lowest
     * of its four corners and how far apart those corners are.
     * @param {number} s
     * @param {number} lateral
     */
    sampleCell(s, lateral) {
      return meshCell(s, lateral);
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
