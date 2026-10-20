/**
 * The infinite procedural world.
 *
 * Everything is a pure function of `(seed, z)`, which is what makes the world
 * seamless and multiplayer friendly: two peers that share a seed derive the
 * exact same road and terrain without exchanging any geometry.
 *
 * The road runs along +Z. Its centre line meanders with a sum of sines, so the
 * heading always stays bounded and the road can never loop back on itself.
 * Drift areas are widened sections that appear periodically along the route.
 */

import { clamp, smoothstep } from '../core/math.js';
import { fbm, ridged, warpedFbm } from './noise.js';

/** Metres per road segment. */
export const SEGMENT_LENGTH = 6;
/** Half width of the normal road, in metres. */
export const ROAD_HALF_WIDTH = 7;
/** How much the road surface sits above the terrain, in metres. */
export const ROAD_LIFT = 0.06;
/** Width of the paved corridor that is flattened around the road. */
export const CORRIDOR = 130;

/**
 * @typedef {object} RoadProfile
 * @property {number[]} amp       amplitude of each meander term
 * @property {number[]} freq      frequency of each meander term
 * @property {number[]} phase     phase of each meander term
 * @property {number[]} hillAmp
 * @property {number[]} hillFreq
 * @property {number[]} hillPhase
 * @property {number} driftSpacing metres between drift areas
 * @property {number} driftLength length of a drift area
 */

/**
 * Build the deterministic profile of a world.
 * @param {number} seed
 * @returns {RoadProfile}
 */
export function createRoadProfile(seed) {
  const random = mulberry32(seed >>> 0);
  const amp = [];
  const freq = [];
  const phase = [];
  const hillAmp = [];
  const hillFreq = [];
  const hillPhase = [];

  // A big slow meander, a medium one and a small one give varied corners.
  const terms = [
    { a: [90, 220], f: [0.00035, 0.00075] },
    { a: [35, 70], f: [0.0016, 0.0032] },
    { a: [7, 22], f: [0.006, 0.019] },
  ];
  for (const group of terms) {
    for (let i = 0; i < group.a.length; i++) {
      amp.push(group.a[i] * (0.6 + random() * 0.8));
      freq.push(group.f[i] * (0.85 + random() * 0.3));
      phase.push(random() * Math.PI * 2);
    }
  }
  // Keep the steepest slope at a drivable angle (about 29 degrees).
  let maxSlope = 0;
  for (let i = 0; i < amp.length; i++) maxSlope += amp[i] * freq[i];
  if (maxSlope > 0) {
    const scale = 0.55 / maxSlope;
    for (let i = 0; i < amp.length; i++) amp[i] *= scale;
  }
  for (let i = 0; i < 3; i++) {
    hillAmp.push(0.7 + random() * 2.1);
    hillFreq.push(0.0006 + random() * 0.0022);
    hillPhase.push(random() * Math.PI * 2);
  }

  return {
    amp,
    freq,
    phase,
    hillAmp,
    hillFreq,
    hillPhase,
    seed: seed >>> 0,
    driftSpacing: 1400 + random() * 900,
    driftLength: 150 + random() * 90,
  };
}

/**
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lateral offset of the road centre line.
 * @param {RoadProfile} profile
 * @param {number} s distance along the road
 */
export function roadOffset(profile, s) {
  let x = 0;
  for (let i = 0; i < profile.amp.length; i++) {
    x += profile.amp[i] * Math.sin(s * profile.freq[i] + profile.phase[i]);
  }
  return x;
}

/**
 * Slope of the centre line (dx/ds).
 * @param {RoadProfile} profile
 * @param {number} s
 */
export function roadSlope(profile, s) {
  let dx = 0;
  for (let i = 0; i < profile.amp.length; i++) {
    dx += profile.amp[i] * profile.freq[i] * Math.cos(s * profile.freq[i] + profile.phase[i]);
  }
  return dx;
}

/**
 * Height of the road centre line.
 * @param {RoadProfile} profile
 * @param {number} s
 */
export function roadHeight(profile, s) {
  let y = 0;
  for (let i = 0; i < profile.hillAmp.length; i++) {
    y += profile.hillAmp[i] * Math.sin(s * profile.hillFreq[i] + profile.hillPhase[i]);
  }
  return y;
}

/**
 * Slope of the centre line height (dy/ds).
 * @param {RoadProfile} profile
 * @param {number} s
 */
export function roadGrade(profile, s) {
  let dy = 0;
  for (let i = 0; i < profile.hillAmp.length; i++) {
    dy += profile.hillAmp[i] * profile.hillFreq[i] * Math.cos(s * profile.hillFreq[i] + profile.hillPhase[i]);
  }
  return dy;
}

/**
 * Heading of the road (the angle of the tangent in the XZ plane).
 * @param {RoadProfile} profile
 * @param {number} s
 */
export function roadHeading(profile, s) {
  return Math.atan(roadSlope(profile, s));
}

/**
 * How far into a drift area the given distance is (0 = not in one).
 * @param {RoadProfile} profile
 * @param {number} s
 */
export function driftFactor(profile, s) {
  const spacing = profile.driftSpacing;
  const length = profile.driftLength;
  const local = ((s % spacing) + spacing) % spacing;
  // Two drift areas per period, on either side of the period boundary.
  const d1 = Math.abs(local - spacing * 0.25);
  const d2 = Math.abs(local - spacing * 0.72);
  const d = Math.min(d1, d2);
  return 1 - smoothstep(clamp((d - length * 0.5) / (length * 0.5 + 30), 0, 1));
}

/**
 * Half width of the road at a given distance (drift areas are wider).
 * @param {RoadProfile} profile
 * @param {number} s
 */
export function roadHalfWidth(profile, s) {
  return ROAD_HALF_WIDTH + driftFactor(profile, s) * 13;
}

/**
 * Curvature of the road (1/radius), used for the camera and the AI.
 * @param {RoadProfile} profile
 * @param {number} s
 */
export function roadCurvature(profile, s) {
  const step = 4;
  const a = roadHeading(profile, s - step);
  const b = roadHeading(profile, s + step);
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta / (step * 2);
}

/**
 * The height of the mountains relative to the level of the road.
 *
 * Domain warped fractal noise gives the broad shapes, a ridged multifractal
 * adds the sharp crests, so the range reads like real rock rather than soft
 * blobs.
 *
 * @param {RoadProfile} profile
 * @param {number} x
 * @param {number} z
 * @returns {number} metres above the road's level
 */
export function mountainHeight(profile, x, z) {
  const seed = profile.seed;
  const wx = warpedFbm(x * 0.00032, z * 0.00032, seed + 5) * 320;
  const wz = warpedFbm(x * 0.00032 + 13.7, z * 0.00032 - 7.1, seed + 9) * 320;
  const rolling = fbm((x + wx) * 0.0013, (z + wz) * 0.0013, 5, seed) * 55;
  const ridge = ridged((x + wx * 0.55) * 0.00055, (z + wz * 0.55) * 0.00055, 4, seed + 3);
  const peaks = Math.max(0, ridge - 0.22) * 420;
  const detail = fbm(x * 0.006, z * 0.006, 3, seed + 41) * 5.5;
  return rolling + peaks + detail;
}

/**
 * The banking of the road: corners lean into the turn.
 * @param {RoadProfile} profile
 * @param {number} s
 * @returns {number} radians of cross slope
 */
export function roadBank(profile, s) {
  return clamp(roadCurvature(profile, s) * 60, -0.1, 0.1);
}

/**
 * Rough terrain height away from the road.
 * @param {number} x
 * @param {number} z
 */
export function terrainNoise(x, z) {
  return (
    Math.sin(x * 0.0121 + z * 0.0037) * 2.2 +
    Math.sin(x * 0.031 - z * 0.017) * 1.0 +
    Math.cos(z * 0.0072 + x * 0.0044) * 1.6 +
    Math.sin(x * 0.09 + z * 0.07) * 0.3
  );
}

/**
 * The drivable surface height at a world position.
 *
 * On the road this is the road height, just outside it blends into the
 * terrain, and far away it is rolling ground.
 *
 * @param {RoadProfile} profile
 * @param {number} x
 * @param {number} z
 * @param {{ out?: { height: number, lateral: number, onRoad: boolean, s: number } }} [result]
 */
export function surfaceHeight(profile, x, z, result, forMesh = false) {
  const s = z;
  const centre = roadOffset(profile, s);
  const lateral = x - centre;
  const halfWidth = roadHalfWidth(profile, s);
  const roadY = roadHeight(profile, s);

  if (Math.abs(lateral) <= halfWidth) {
    // The road surface, banked into the corners.
    const bank = roadBank(profile, s);
    const height = roadY + ROAD_LIFT + bank * lateral - (forMesh ? 0.16 : 0);
    if (result) {
      result.height = height;
      result.lateral = lateral;
      result.onRoad = true;
      result.s = s;
    }
    return height;
  }

  const dist = Math.abs(lateral) - halfWidth;
  // The valley opens up: the ground starts at the level of the road and grows
  // into the mountain range.
  const blend = smoothstep(clamp(dist / 95, 0, 1));
  const mountain = mountainHeight(profile, x, z);
  // The banking continues into the verge so there is no ledge at the edge.
  const bankFade = 1 - smoothstep(clamp(dist / 40, 0, 1));
  // A shallow ditch along the verge reads as a drainage channel.
  const shoulder = -0.28 * Math.exp(-dist / 9);
  const height = roadY + roadBank(profile, s) * lateral * bankFade + mountain * blend + shoulder;
  if (result) {
    result.height = height;
    result.lateral = lateral;
    result.onRoad = false;
    result.s = s;
  }
  return height;
}

/**
 * Normal of the surface at a world position (finite differences).
 * @param {RoadProfile} profile
 * @param {number} x
 * @param {number} z
 * @param {THREE.Vector3 | { x: number, y: number, z: number }} [out]
 */
export function surfaceNormal(profile, x, z, out) {
  const e = 1.2;
  const hx = surfaceHeight(profile, x + e, z) - surfaceHeight(profile, x - e, z);
  const hz = surfaceHeight(profile, x, z + e) - surfaceHeight(profile, x, z - e);
  const nx = -hx;
  const nz = -hz;
  const ny = 2 * e;
  const length = Math.hypot(nx, ny, nz) || 1;
  if (out) {
    out.x = nx / length;
    out.y = ny / length;
    out.z = nz / length;
  }
  return { x: nx / length, y: ny / length, z: nz / length };
}

/**
 * Where a world position sits relative to the road.
 * @param {RoadProfile} profile
 * @param {number} x
 * @param {number} z
 */
export function roadInfo(profile, x, z) {
  const s = z;
  const centre = roadOffset(profile, s);
  const lateral = x - centre;
  const heading = roadHeading(profile, s);
  return {
    s,
    lateral,
    heading,
    onRoad: Math.abs(lateral) <= roadHalfWidth(profile, s),
    inDriftArea: driftFactor(profile, s) > 0.35,
  };
}
