/**
 * Procedural track generation.
 *
 * A track is a closed circuit: the centre line is a closed Catmull-Rom spline
 * through jittered control points, resampled at a uniform arc length so every
 * segment is exactly `segmentLength` metres long. Elevation is a sum of
 * periodic harmonics, which keeps the loop seamless.
 *
 * Everything derives from a seed, so two players only need to exchange the seed
 * to see the exact same circuit.
 */

import { createRng, hashString } from '../core/rng.js';
import { clamp, smoothstep, wrapAngle } from '../core/math.js';

/** Metres per render segment. */
export const SEGMENT_LENGTH = 6;
/** Half width of the drivable road, in metres. */
export const ROAD_HALF_WIDTH = 7.2;

/**
 * @typedef {object} TrackPalette
 * @property {string} skyTop
 * @property {string} skyBottom
 * @property {string} sun
 * @property {string} sunGlow
 * @property {string} cloud
 * @property {string} grass
 * @property {string} grassAlt
 * @property {string} road
 * @property {string} roadAlt
 * @property {string} rumbleA
 * @property {string} rumbleB
 * @property {string} lane
 * @property {string} fog
 * @property {number} fogStart   distance (m) where the fog starts
 * @property {number} fogEnd     distance (m) where the fog is complete
 * @property {number} sunX       0..1 horizontal position of the sun
 * @property {number} sunY       0..1 vertical position of the sun
 * @property {number} starAlpha  0..1
 */

/**
 * @typedef {object} Prop
 * @property {number} segment
 * @property {number} offset  lateral offset from the centre line, in metres
 * @property {string} type
 * @property {number} scale
 * @property {number} variant
 * @property {number} sway
 */

/**
 * @typedef {object} Track
 * @property {string} id
 * @property {string} name
 * @property {number} seed
 * @property {number} segmentLength
 * @property {number} segmentCount
 * @property {number} length          total lap length in metres
 * @property {Float32Array} x          centre line x per segment
 * @property {Float32Array} y          centre line height per segment
 * @property {Float32Array} z          centre line z per segment
 * @property {Float32Array} heading    tangent angle per segment (radians)
 * @property {Float32Array} curvature  1/radius per segment
 * @property {Prop[]} props
 * @property {number[]} checkpoints    segment indices
 * @property {TrackPalette} palette
 * @property {number} startHeading
 * @property {{minX: number, maxX: number, minZ: number, maxZ: number}} bounds
 */

/** @type {TrackPalette} */
export const DAY_PALETTE = {
  skyTop: '#1f4fd8',
  skyBottom: '#8fd0ff',
  sun: '#fff6d8',
  sunGlow: 'rgba(255, 236, 180, 0.55)',
  cloud: 'rgba(255,255,255,0.92)',
  grass: '#2f7a3d',
  grassAlt: '#2a6f38',
  road: '#33363f',
  roadAlt: '#3a3d47',
  rumbleA: '#e8e8ee',
  rumbleB: '#d23b4a',
  lane: '#e9ecf5',
  fog: '#b6d8f7',
  fogStart: 340,
  fogEnd: 1500,
  sunX: 0.78,
  sunY: 0.28,
  starAlpha: 0,
};

/** @type {TrackPalette} */
export const DUSK_PALETTE = {
  skyTop: '#2b1a5c',
  skyBottom: '#ff8a5c',
  sun: '#ffd9a0',
  sunGlow: 'rgba(255, 140, 90, 0.5)',
  cloud: 'rgba(255, 190, 170, 0.75)',
  grass: '#3c2a4a',
  grassAlt: '#372641',
  road: '#2b2733',
  roadAlt: '#312c3a',
  rumbleA: '#ffe9e9',
  rumbleB: '#c02a4a',
  lane: '#ffe9c9',
  fog: '#c9748f',
  fogStart: 300,
  fogEnd: 1250,
  sunX: 0.22,
  sunY: 0.42,
  starAlpha: 0.25,
};

/** @type {TrackPalette} */
export const NIGHT_PALETTE = {
  skyTop: '#05070f',
  skyBottom: '#132a4d',
  sun: '#dfe9ff',
  sunGlow: 'rgba(150, 190, 255, 0.22)',
  cloud: 'rgba(120, 150, 200, 0.28)',
  grass: '#10241a',
  grassAlt: '#0e2018',
  road: '#1b1d24',
  roadAlt: '#20232b',
  rumbleA: '#dfe4ef',
  rumbleB: '#9b1f36',
  lane: '#cfd8ea',
  fog: '#16233c',
  fogStart: 220,
  fogEnd: 950,
  sunX: 0.7,
  sunY: 0.18,
  starAlpha: 1,
};

/**
 * @typedef {object} TrackDef
 * @property {string} id
 * @property {string} name
 * @property {number} seed
 * @property {number} laps
 * @property {TrackPalette} palette
 * @property {string[]} props
 * @property {number} radius
 */

/** @type {TrackDef[]} */
export const TRACKS = [
  {
    id: 'coast',
    name: 'Coastal Run',
    seed: 0x51ce01,
    laps: 2,
    palette: DAY_PALETTE,
    props: ['palm', 'pine', 'bush', 'sign', 'billboard', 'lamp', 'building', 'rock'],
    radius: 620,
  },
  {
    id: 'alpine',
    name: 'Alpine Pass',
    seed: 0xa17e0,
    laps: 2,
    palette: DUSK_PALETTE,
    props: ['pine', 'rock', 'sign', 'lamp', 'building', 'bush'],
    radius: 540,
  },
  {
    id: 'midnight',
    name: 'Midnight Bay',
    seed: 0x0dd11a,
    laps: 3,
    palette: NIGHT_PALETTE,
    props: ['palm', 'lamp', 'building', 'bush', 'sign', 'billboard'],
    radius: 700,
  },
];

/**
 * @param {string} id
 * @returns {TrackDef | undefined}
 */
export function getTrackDef(id) {
  return TRACKS.find((t) => t.id === id);
}

/**
 * Catmull-Rom interpolation for a closed loop.
 * @param {number[]} points flat [x0, z0, x1, z1, ...]
 * @param {number} t  position in the 0..points.length range
 * @param {number} i  segment index
 * @returns {[number, number]}
 */
function catmullRom(points, t, i) {
  const n = points.length / 2;
  const p0 = ((i - 1 + n) % n) * 2;
  const p1 = ((i + 0) % n) * 2;
  const p2 = ((i + 1) % n) * 2;
  const p3 = ((i + 2) % n) * 2;
  const t2 = t * t;
  const t3 = t2 * t;
  const out = /** @type {[number, number]} */ ([0, 0]);
  for (let axis = 0; axis < 2; axis++) {
    const a = points[p0 + axis];
    const b = points[p1 + axis];
    const c = points[p2 + axis];
    const d = points[p3 + axis];
    out[axis] =
      0.5 *
      (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  }
  return out;
}

/**
 * Build a closed circuit.
 * @param {TrackDef} def
 * @param {number} [seedOverride]
 * @returns {Track}
 */
export function createTrack(def, seedOverride) {
  const seed = seedOverride ?? def.seed;
  const rng = createRng(seed);
  const controlCount = 12 + Math.floor(rng() * 5);

  // --- control points: a wobbling circle -------------------------------
  const harmonics = [];
  const harmonicCount = 2 + Math.floor(rng() * 2);
  for (let h = 0; h < harmonicCount; h++) {
    harmonics.push({
      amp: (0.06 + rng() * 0.13) / (h + 1),
      phase: rng() * Math.PI * 2,
      freq: h + 1,
    });
  }
  const baseRadius = def.radius * (0.85 + rng() * 0.3);
  /** @type {number[]} */
  const control = [];
  for (let i = 0; i < controlCount; i++) {
    const theta = (i / controlCount) * Math.PI * 2;
    let radius = baseRadius;
    for (const h of harmonics) {
      radius += baseRadius * h.amp * Math.cos(h.freq * theta + h.phase);
    }
    // A slight vertical squash makes the layout read better on a minimap.
    const squash = 0.78 + rng() * 0.02;
    control.push(radius * Math.cos(theta), radius * squash * Math.sin(theta));
  }

  // --- dense sampling, then uniform arc-length resampling ---------------
  const densePerSpan = 48;
  /** @type {number[]} */
  const denseX = [];
  /** @type {number[]} */
  const denseZ = [];
  /** @type {number[]} */
  const cumLength = [0];
  for (let i = 0; i < controlCount; i++) {
    for (let s = 0; s < densePerSpan; s++) {
      const t = s / densePerSpan;
      const [px, pz] = catmullRom(control, t, i);
      denseX.push(px);
      denseZ.push(pz);
    }
  }
  for (let i = 0; i < denseX.length; i++) {
    const j = (i + 1) % denseX.length;
    const dx = denseX[j] - denseX[i];
    const dz = denseZ[j] - denseZ[i];
    cumLength.push(cumLength[i] + Math.hypot(dx, dz));
  }
  const total = cumLength[cumLength.length - 1];
  const segmentCount = Math.max(120, Math.round(total / SEGMENT_LENGTH));
  const step = total / segmentCount;

  const x = new Float32Array(segmentCount);
  const z = new Float32Array(segmentCount);
  let cursor = 0;
  for (let i = 0; i < segmentCount; i++) {
    const target = i * step;
    while (cursor < cumLength.length - 2 && cumLength[cursor + 1] < target) cursor++;
    const span = cumLength[cursor + 1] - cumLength[cursor] || 1;
    const f = (target - cumLength[cursor]) / span;
    const a = cursor % denseX.length;
    const b = (cursor + 1) % denseX.length;
    x[i] = denseX[a] + (denseX[b] - denseX[a]) * f;
    z[i] = denseZ[a] + (denseZ[b] - denseZ[a]) * f;
  }

  // --- tangents, curvature ---------------------------------------------
  const heading = new Float32Array(segmentCount);
  const curvature = new Float32Array(segmentCount);
  for (let i = 0; i < segmentCount; i++) {
    const prev = (i - 1 + segmentCount) % segmentCount;
    const next = (i + 1) % segmentCount;
    const dx = x[next] - x[prev];
    const dz = z[next] - z[prev];
    heading[i] = Math.atan2(dx, dz);
  }
  for (let i = 0; i < segmentCount; i++) {
    const prev = (i - 1 + segmentCount) % segmentCount;
    const next = (i + 1) % segmentCount;
    const delta = wrapAngle(heading[next] - heading[prev]);
    curvature[i] = delta / (2 * SEGMENT_LENGTH);
  }

  // --- elevation: periodic harmonics -----------------------------------
  const hillCount = 2 + Math.floor(rng() * 3);
  const hills = [];
  for (let h = 0; h < hillCount; h++) {
    hills.push({
      amp: 1.6 + rng() * 5.5,
      freq: 1 + Math.floor(rng() * 3),
      phase: rng() * Math.PI * 2,
    });
  }
  const y = new Float32Array(segmentCount);
  for (let i = 0; i < segmentCount; i++) {
    const theta = (i / segmentCount) * Math.PI * 2;
    let h = 0;
    for (const hill of hills) {
      h += hill.amp * Math.sin(hill.freq * theta + hill.phase);
    }
    y[i] = h;
  }
  // Smooth the elevation a little to avoid harsh grade changes.
  const smoothY = new Float32Array(segmentCount);
  for (let i = 0; i < segmentCount; i++) {
    let sum = 0;
    for (let k = -2; k <= 2; k++) {
      sum += y[(i + k + segmentCount) % segmentCount] * (3 - Math.abs(k));
    }
    smoothY[i] = sum / 9;
  }
  y.set(smoothY);

  // --- scenery ----------------------------------------------------------
  /** @type {Prop[]} */
  const props = [];
  const propTypes = def.props;
  const density = 0.55;
  for (let i = 0; i < segmentCount; i++) {
    if (rng() > density) continue;
    const type = propTypes[Math.floor(rng() * propTypes.length)];
    const side = rng() < 0.5 ? -1 : 1;
    const margin = ROAD_HALF_WIDTH + 1.6 + rng() * 16;
    props.push({
      segment: i,
      offset: side * margin,
      type,
      scale: 0.8 + rng() * 0.6,
      variant: Math.floor(rng() * 4),
      sway: rng() * Math.PI * 2,
    });
  }
  // Lamps and signs at regular intervals for rhythm.
  for (let i = 0; i < segmentCount; i += 18) {
    props.push({
      segment: i,
      offset: -(ROAD_HALF_WIDTH + 2.6),
      type: 'lamp',
      scale: 1,
      variant: i % 3,
      sway: 0,
    });
  }
  for (let i = 0; i < segmentCount; i += 46) {
    props.push({
      segment: i,
      offset: ROAD_HALF_WIDTH + 3.4,
      type: 'sign',
      scale: 1,
      variant: Math.floor((i / 46) % 4),
      sway: 0,
    });
  }
  // Start / finish gantry (one wide object spanning the road).
  props.push({ segment: 0, offset: 0, type: 'gantry', scale: 1, variant: 0, sway: 0 });

  // --- checkpoints ------------------------------------------------------
  const checkpoints = [0];
  const sectorCount = 3;
  for (let i = 1; i < sectorCount; i++) {
    checkpoints.push(Math.floor((segmentCount * i) / sectorCount));
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < segmentCount; i++) {
    minX = Math.min(minX, x[i]);
    maxX = Math.max(maxX, x[i]);
    minZ = Math.min(minZ, z[i]);
    maxZ = Math.max(maxZ, z[i]);
  }

  return {
    id: def.id,
    name: def.name,
    seed,
    segmentLength: SEGMENT_LENGTH,
    segmentCount,
    length: segmentCount * SEGMENT_LENGTH,
    x,
    y,
    z,
    heading,
    curvature,
    props,
    checkpoints,
    palette: def.palette,
    startHeading: heading[0],
    bounds: { minX, maxX, minZ, maxZ },
  };
}

/**
 * Create a track from an id (or a raw seed for custom rooms).
 * @param {string} id
 * @param {number} [seed]
 * @returns {Track}
 */
export function createTrackById(id, seed) {
  const def = getTrackDef(id) || TRACKS[0];
  return createTrack(def, seed);
}

/**
 * Sample the centre line at an arbitrary distance.
 * @param {Track} track
 * @param {number} distance metres along the lap
 */
export function sampleTrack(track, distance) {
  const count = track.segmentCount;
  const raw = (distance / track.segmentLength) % count;
  const index = ((raw % count) + count) % count;
  const i0 = Math.floor(index);
  const i1 = (i0 + 1) % count;
  const f = index - i0;
  return {
    index: i0,
    x: track.x[i0] + (track.x[i1] - track.x[i0]) * f,
    y: track.y[i0] + (track.y[i1] - track.y[i0]) * f,
    z: track.z[i0] + (track.z[i1] - track.z[i0]) * f,
    heading: track.heading[i0] + wrapAngle(track.heading[i1] - track.heading[i0]) * f,
    curvature: track.curvature[i0],
  };
}

/**
 * Project a world position onto the track: distance along the lap and the
 * lateral offset from the centre line.
 * @param {Track} track
 * @param {number} px
 * @param {number} pz
 */
export function projectToTrack(track, px, pz) {
  const count = track.segmentCount;
  // Coarse search using a stride, then refine locally.
  let bestIndex = 0;
  let bestDist = Infinity;
  const stride = Math.max(1, Math.floor(count / 64));
  for (let i = 0; i < count; i += stride) {
    const dx = px - track.x[i];
    const dz = pz - track.z[i];
    const d = dx * dx + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }
  let best = bestIndex;
  bestDist = Infinity;
  for (let k = -stride; k <= stride; k++) {
    const i = (bestIndex + k + count) % count;
    const dx = px - track.x[i];
    const dz = pz - track.z[i];
    const d = dx * dx + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  const heading = track.heading[best];
  const dx = px - track.x[best];
  const dz = pz - track.z[best];
  // Right-hand normal of the tangent (sin, cos) is (cos, -sin).
  const nx = Math.cos(heading);
  const nz = -Math.sin(heading);
  const offset = dx * nx + dz * nz;
  const along = dx * Math.sin(heading) + dz * Math.cos(heading);
  const distance = ((best * track.segmentLength + along) % track.length + track.length) % track.length;
  return { distance, offset, segment: best, heading };
}

/**
 * Convert a track space position (distance along the lap, lateral offset) into
 * world coordinates.
 * @param {Track} track
 * @param {number} distance
 * @param {number} offset
 * @param {number} [heightOffset]
 */
export function trackToWorld(track, distance, offset, heightOffset = 0) {
  const sample = sampleTrack(track, distance);
  const nx = Math.cos(sample.heading);
  const nz = -Math.sin(sample.heading);
  return {
    x: sample.x + nx * offset,
    y: sample.y + heightOffset,
    z: sample.z + nz * offset,
    heading: sample.heading,
  };
}

/**
 * Height of the terrain at a track position.
 *
 * The road ribbon sits on the centre line, the surrounding terrain melts back
 * to y = 0 far from the road. Cars that leave the road follow this surface.
 *
 * @param {Track} track
 * @param {number} distance metres along the lap
 * @param {number} lateral metres from the centre line
 * @returns {number}
 */
export function terrainHeightAt(track, distance, lateral) {
  const sample = sampleTrack(track, distance);
  const dist = Math.abs(lateral);
  const blend = 1 - smoothstep(dist, 55, 148);
  let height = sample.y * blend;
  const segmentIndex = (distance / track.segmentLength) % track.segmentCount;
  const noise =
    Math.sin(sample.x * 0.013 + lateral * 0.02) *
    Math.cos(sample.z * 0.011 - lateral * 0.017) *
    (2.4 + Math.sin(segmentIndex * 0.05) * 1.2) *
    smoothstep(dist, 16, 60);
  height += noise * blend;
  if (dist < 9.6) height = sample.y - 0.12;
  return height;
}

/**
 * Build a minimap path scaled into the given box.
 * @param {Track} track
 * @param {number} width
 * @param {number} height
 * @param {number} padding
 */
export function buildMinimapPath(track, width, height, padding = 10) {
  const { minX, maxX, minZ, maxZ } = track.bounds;
  const spanX = maxX - minX || 1;
  const spanZ = maxZ - minZ || 1;
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanZ);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanZ * scale) / 2;
  const points = [];
  const step = Math.max(1, Math.floor(track.segmentCount / 220));
  for (let i = 0; i < track.segmentCount; i += step) {
    points.push({
      x: (track.x[i] - minX) * scale + offsetX,
      y: (track.z[i] - minZ) * scale + offsetY,
    });
  }
  return { points, scale, offsetX, offsetY, minX, minZ };
}

/**
 * Total drift of a track, used to scale the difficulty of the boost economy.
 * @param {Track} track
 */
export function trackDifficulty(track) {
  let sum = 0;
  for (let i = 0; i < track.segmentCount; i++) sum += Math.abs(track.curvature[i]);
  return clamp(sum / track.segmentCount / 0.01, 0.4, 3);
}

export { hashString };
