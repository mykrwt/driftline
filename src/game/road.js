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
 * The shape of the land away from the road.
 *
 * The world is a valley: the road runs along the floor and the ground climbs
 * into hills, then into a mountain range on either side. How far out the
 * hillside starts breathes along the route, so the drive constantly opens into
 * wide plains and then squeezes back between rock walls.
 *
 * Everything is a pure function of the profile and the position, so the mesh
 * and the physics always agree on where the ground is.
 *
 * @param {RoadProfile} profile
 * @param {number} s distance along the road
 * @param {number} lateral metres from the centre line (signed)
 * @returns {number} metres above the level of the road
 */
export function terrainRelief(profile, s, lateral) {
  const halfWidth = roadHalfWidth(profile, s);
  const dist = Math.abs(lateral) - halfWidth;
  if (dist <= 0) return 0;

  const side = lateral < 0 ? -1 : 1;
  const x = roadOffset(profile, s) + lateral;
  const seed = profile.seed;

  // The valley walls.
  //
  // The height of the wall on each side drifts along the route, so the drive
  // alternates between a wide open valley and a tight gorge. The wall itself
  // rises with a soft exponential, which keeps the verge flat and drivable
  // while the land climbs away further out.
  const wallNoise = fbm(s * 0.00115 + side * 7.7, side * 2.2, 3, seed + 911);
  const wallHeight = 58 + (wallNoise * 0.5 + 0.5) * 96;
  const wallStart = 26 + (wallNoise * 0.5 + 0.5) * 88;

  // The foot of the wall meanders. Spurs push out towards the road and
  // gullies cut back into the mountain, and this side to side movement is
  // what the eye actually reads on a face that is almost vertical: moving
  // the vertices up and down there changes nothing, because the wall still
  // sits in the same place.
  const spurs = fbm(s * 0.0052 + side * 17.3, side * 4.7, 4, seed + 211);
  const ribs = ridged(s * 0.012 + side * 6.5, side * 2.3, 3, seed + 223) - 0.5;
  const bite = smoothstep(clamp((dist - 14) / 55, 0, 1)) * smoothstep(clamp((dist - 16) / 240, 0, 1));
  const wallDist = Math.max(2, dist - (spurs * 34 + ribs * 12) * bite);

  // The wall climbs over a couple of hundred metres instead of standing up
  // like a cliff right beside the road: the ground stays usable, the face is
  // wide enough for the mesh to hold its shape, and the light rakes across it
  // instead of hitting one flat sheet.
  const climb = 1 - Math.exp(-Math.pow(wallDist / 165, 1.55));
  const valley = wallHeight * climb;

  // The range on top of the walls: sharp ridged crests over broad shoulders.
  // It only starts well away from the road, so the valley floor stays open.
  // The range has to grow out of the wall, not switch on behind it: a short
  // ramp puts the whole height of the peaks into a few metres of ground and
  // stands a cliff up beside the road.
  const away = smoothstep(clamp((dist - 60) / 320, 0, 1));
  const ridge = ridged(x * 0.0011 + side * 2.7, s * 0.0011, 4, seed + 37);
  const peaks = Math.max(0, ridge - 0.16) * 380 * away;
  const ridge2 = ridged(x * 0.0034 + side * 5.1, s * 0.0034, 3, seed + 43);
  const peaks2 = Math.max(0, ridge2 - 0.2) * 190 * away;
  // A third scale of ridges: the shoulders and the buttresses that break up
  // the face of a mountain.
  const ridge3 = ridged(x * 0.0072 + side * 8.3, s * 0.0072, 3, seed + 47);
  const peaks3 = Math.max(0, ridge3 - 0.26) * 95 * away;
  const shoulders = fbm(x * 0.0026, s * 0.0026, 4, seed + 5) * 42 * away;

  // Rolling ground that reaches almost to the verge.
  const roll = fbm(x * 0.0085, s * 0.0085, 3, seed + 71) * 4.6 * smoothstep(clamp((dist - 4) / 20, 0, 1));

  // Basins: in places the valley floor drops away from the road and fills
  // with water. The drop is gentle, so the road runs along the rim.
  const basinNoise = fbm(x * 0.0014, s * 0.0014, 2, seed + 401);
  const basinDepth = Math.max(0, basinNoise - 0.08) * 130;
  const basin = -basinDepth * smoothstep(clamp((dist - 14) / 75, 0, 1));

  // Buttresses: the spurs that run down the face of a valley wall. They are
  // what keeps a mountainside from reading as one smooth ramp, so they grow
  // from the foot of the wall outwards.
  const buttress =
    (ridged(s * 0.0085 + side * 4.3, x * 0.0016, 3, seed + 83) - 0.42) *
    34 *
    smoothstep(clamp((dist - 12) / 70, 0, 1));
  // Gullies between the spurs, cut into the same slope.
  const gully =
    -Math.max(0, ridged(s * 0.017 + side * 7.1, x * 0.004, 2, seed + 97) - 0.55) *
    16 *
    smoothstep(clamp((dist - 8) / 40, 0, 1));

  // Mid scale relief: this is what makes the slopes read as land instead of
  // a smooth ramp once the sun rakes across them. It has to be strong where
  // the wall is, not only far away: the face beside the road is the part the
  // player sees all the way along the drive.
  const face = smoothstep(clamp((dist - 22) / 55, 0, 1));
  const crags = fbm(x * 0.019, s * 0.019, 3, seed + 233) * 12 * Math.max(away, face * 0.7);
  const ledges = (ridged(s * 0.04 + side * 3.3, x * 0.05, 2, seed + 251) - 0.4) * 7 * away;
  // Bands and chutes on the face of the wall. These are the shapes that catch
  // the light and tell the eye the mountainside is rock: without them the
  // face is one smooth sheet of colour no matter how detailed the mesh is.
  const chutes =
    (ridged(s * 0.021 + side * 5.7, x * 0.028, 3, seed + 263) - 0.44) * 13 * face;
  const bands = fbm(x * 0.05, s * 0.035, 3, seed + 271) * 5.5 * face;
  const rubble = fbm(x * 0.055, s * 0.055, 2, seed + 311) * 1.4 * smoothstep(clamp(dist / 30, 0, 1));

  // Fine bumps so the surface never reads as a smooth sheet.
  const detail = fbm(x * 0.085, s * 0.085, 2, seed + 131) * 0.85 * smoothstep(clamp(dist / 6, 0, 1));

  return (
    valley +
    peaks +
    peaks2 +
    peaks3 +
    shoulders +
    roll +
    basin +
    buttress +
    gully +
    crags +
    ledges +
    chutes +
    bands +
    rubble +
    detail
  );
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
 * terrain, and far away it is the open country.
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
  // The banking continues into the verge so there is no ledge at the edge.
  const bankFade = 1 - smoothstep(clamp(dist / 45, 0, 1));
  // A shallow ditch along the verge reads as a drainage channel. It starts
  // and ends at the level of the road so the tarmac always meets the ground.
  const ditch = -0.26 * Math.sin(Math.PI * clamp(dist / 13, 0, 1)) ** 2;
  const relief = terrainRelief(profile, s, lateral);
  const height = roadY + roadBank(profile, s) * lateral * bankFade + relief + ditch;
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
