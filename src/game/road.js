/**
 * The infinite procedural world.
 *
 * Everything is a pure function of `(seed, z)`, keeping physics, mesh, and
 * peer-to-peer multiplayer 100% deterministic without exchanging geometry.
 *
 * The pass winds through asymmetric alpine chapters: sheer stratified mountain
 * spurs and couloirs on one side opening across glacial lakes, wildflower
 * pastures, pine-forested foothills, and snow-dusted arêtes on the other.
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
 * @property {number} seed
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
    hillAmp.push(0.9 + random() * 2.4);
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
 * Scenic lake & glacial basin strength (0..1) on a side of the road at `s`.
 *
 * Ensures an inviting alpine lake opens right in view on the first stretch of
 * every drive, then alternates naturally between gorges, meadows, and lakes.
 *
 * @param {RoadProfile} profile
 * @param {number} s
 * @param {number} side -1 left, +1 right
 * @returns {number} 0..1
 */
export function lakeMask(profile, s, side) {
  const seed = profile.seed;
  const preferredStartSide = (seed & 1) === 0 ? 1 : -1;

  // Scenic opening lake right in view ahead of spawn (s = 115..460m).
  let opening = 0;
  if (side === preferredStartSide) {
    opening =
      smoothstep(clamp((s - 85) / 85, 0, 1)) *
      (1 - smoothstep(clamp((s - 430) / 110, 0, 1)));
  }

  // Periodic natural glacial basins along the infinite pass (~every 900m).
  const period = 920;
  const idx = Math.floor((s + 260) / period);
  const local = s + 260 - idx * period;
  const basinSide = fbm(idx * 3.71, 1.9, 2, seed + 577) >= 0 ? 1 : -1;
  let periodic = 0;
  if (idx >= 1 && side === basinSide) {
    const jitter = fbm(idx * 5.13, 8.3, 2, seed + 613) * 120;
    const centre = period * 0.5 + jitter;
    const halfSpan = 165 + (fbm(idx * 2.3, 4.1, 2, seed + 631) * 0.5 + 0.5) * 95;
    periodic = 1 - smoothstep(clamp((Math.abs(local - centre) - halfSpan * 0.55) / (halfSpan * 0.65), 0, 1));
  }

  return clamp(Math.max(opening, periodic), 0, 1);
}

/**
 * Broad mountain height field for far peaks & preview tools.
 *
 * @param {RoadProfile} profile
 * @param {number} x
 * @param {number} z
 * @returns {number}
 */
export function mountainHeight(profile, x, z) {
  const seed = profile.seed;
  const wx = warpedFbm(x * 0.00034, z * 0.00034, seed + 5) * 300;
  const wz = warpedFbm(x * 0.00034 + 13.7, z * 0.00034 - 7.1, seed + 9) * 300;
  const rolling = fbm((x + wx) * 0.0013, (z + wz) * 0.0013, 5, seed) * 52;
  const ridge = ridged((x + wx * 0.55) * 0.00062, (z + wz * 0.55) * 0.00062, 4, seed + 3);
  const peaks = Math.pow(Math.max(0, ridge - 0.18), 1.25) * 480;
  const detail = fbm(x * 0.006, z * 0.006, 3, seed + 41) * 6;
  return rolling + peaks + detail;
}

/**
 * The shape of the land away from the road.
 *
 * Uses true 2D domain-warped ridges, spurs, glacial couloirs, rock benches,
 * and asymmetric lake overlooks while keeping the roadside shoulder smooth
 * and drivable everywhere.
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

  // --- 1. Asymmetric valley chapters & lake basins -------------------------
  // Anti-correlated wall closeness creates real alpine corniche passes: when
  // one side crowds the road as a towering rock face, the opposite side opens
  // into sweeping meadows, lakes, and distant peak vistas.
  const chapter = fbm(s * 0.00085, 3.1, 3, seed + 907);
  const sideBias = clamp(chapter * side * 1.45, -1, 1);
  const localBreath = fbm(s * 0.00145 + side * 9.3, side * 3.7, 3, seed + 911);

  const lake = lakeMask(profile, s, side);

  // Wall height & setback respond to both chapter asymmetry and lake basins.
  const openness = clamp(0.5 + sideBias * 0.38 + localBreath * 0.28 + lake * 0.85, 0, 1.35);
  const wallHeight = 76 + (1 - clamp(openness, 0, 1)) * 96 + (localBreath * 0.5 + 0.5) * 44;
  const wallSetback = 12 + openness * 118;

  // --- 2. True 2D domain-warped spurs, ribs & valley wall climb ------------
  const warpX = fbm(x * 0.0024 + 11.3, s * 0.0024 - 5.7, 3, seed + 173) * 68;
  const warpS = fbm(x * 0.0024 - 7.9, s * 0.0024 + 19.1, 3, seed + 191) * 68;
  const wx = x + warpX;
  const ws = s + warpS;

  const spurField = fbm(wx * 0.0046, ws * 0.0054, 4, seed + 211);
  const ribField = ridged(wx * 0.0085 + side * 3.1, ws * 0.0095, 3, seed + 223) - 0.46;
  const bite = smoothstep(clamp((dist - 12) / 48, 0, 1));
  const effectiveDist = Math.max(
    0,
    dist - wallSetback * 0.42 - (spurField * 36 + ribField * 18) * bite,
  );

  // Suppressed across open lake water so lakes sit cleanly in broad basins
  // before rising dramatically into far-shore mountains beyond dist ~ 175m!
  const lakeShoreClear = 1 - lake * (1 - smoothstep(clamp((dist - 155) / 95, 0, 1))) * 0.92;
  const climb = 1 - Math.exp(-Math.pow(effectiveDist / (128 + wallSetback * 0.45), 1.58));
  const valley = wallHeight * climb * lakeShoreClear;

  // --- 3. High alpine arêtes, pyramidal peaks & secondary buttresses -------
  const away = smoothstep(clamp((dist - (52 + lake * 115)) / 275, 0, 1));
  const primaryRidge = ridged(wx * 0.00115 + side * 2.7, ws * 0.00115, 4, seed + 37);
  const peaks = Math.pow(Math.max(0, primaryRidge - 0.14), 1.22) * 435 * away;

  const secondaryRidge = ridged(wx * 0.0033 + side * 5.1, ws * 0.0031, 4, seed + 43);
  const peaks2 = Math.pow(Math.max(0, secondaryRidge - 0.18), 1.15) * 205 * away;

  const tertiaryRidge = ridged(wx * 0.0074 + side * 8.3, ws * 0.0068, 3, seed + 47);
  const peaks3 = Math.max(0, tertiaryRidge - 0.24) * 96 * away;

  const shoulders = fbm(wx * 0.0025, ws * 0.0025, 4, seed + 5) * 44 * away;

  // --- 4. Glacial lake & river basins with natural undulating shorelines ---
  const shoreWobble = fbm(x * 0.011, s * 0.011, 3, seed + 419) * 24;
  const nearShore = smoothstep(clamp((dist - 11 + shoreWobble * 0.16) / 30, 0, 1));
  const farShore = 1 - smoothstep(clamp((dist - 165 - shoreWobble) / 68, 0, 1));
  const naturalTarn = Math.max(0, fbm(x * 0.0016, s * 0.0016, 3, seed + 401) - 0.18) * 62 * (1 - away * 0.7);
  const lakeCarve = (lake * 16.5 * nearShore * farShore) + naturalTarn * nearShore * farShore;

  // --- 5. Valley spurs, couloir gullies, rock ledges & meadow roll ---------
  const face = smoothstep(clamp((dist - 20) / 48, 0, 1)) * lakeShoreClear;

  // Branching mountain spurs & incised erosion couloirs in true 2D space.
  const buttress =
    (ridged(wx * 0.0062 + side * 4.3, ws * 0.0078, 3, seed + 83) - 0.40) *
    38 *
    face;
  const couloir =
    -Math.max(0, ridged(wx * 0.0125 + side * 7.1, ws * 0.0145, 3, seed + 97) - 0.50) *
    22 *
    face;

  // Stepped geological rock benches & crag facets well away from the verge.
  const crags = fbm(wx * 0.019, ws * 0.019, 3, seed + 233) * 13 * Math.max(away, face * 0.75);
  const chutes = (ridged(wx * 0.024 + side * 5.7, ws * 0.021, 3, seed + 263) - 0.44) * 12 * face;
  const shelfWave = valley + buttress * 0.5;
  const rockSteps = Math.sin(shelfWave * 0.19 + spurField * 4.0) * 2.6 * face * smoothstep(22, 65, valley);

  // Soft pastoral meadow roll & subtle ground micro-undulation near the road.
  const roll = fbm(x * 0.0085, s * 0.0085, 3, seed + 71) * 4.2 * smoothstep(clamp((dist - 5) / 22, 0, 1));
  const rubble = fbm(x * 0.052, s * 0.052, 2, seed + 311) * 1.15 * smoothstep(clamp((dist - 6) / 26, 0, 1));
  const detail = fbm(x * 0.085, s * 0.085, 2, seed + 131) * 0.65 * smoothstep(clamp((dist - 2.5) / 9, 0, 1));

  return (
    valley +
    peaks +
    peaks2 +
    peaks3 +
    shoulders -
    lakeCarve +
    buttress +
    couloir +
    crags +
    chutes +
    rockSteps +
    roll +
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
 * @param {RoadProfile} profile
 * @param {number} x
 * @param {number} z
 * @param {{ height?: number, lateral?: number, onRoad?: boolean, s?: number }} [result]
 * @param {boolean} [forMesh]
 */
export function surfaceHeight(profile, x, z, result, forMesh = false) {
  const s = z;
  const centre = roadOffset(profile, s);
  const lateral = x - centre;
  const halfWidth = roadHalfWidth(profile, s);
  const roadY = roadHeight(profile, s);

  if (Math.abs(lateral) <= halfWidth) {
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
  const bankFade = 1 - smoothstep(clamp(dist / 45, 0, 1));
  // Subtle gravel shoulder + shallow roadside drainage swale.
  const ditch = -0.24 * Math.sin(Math.PI * clamp((dist - 1.2) / 11.5, 0, 1)) ** 2;
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
  const halfWidth = roadHalfWidth(profile, s);
  const heading = roadHeading(profile, s);
  return {
    s,
    lateral,
    heading,
    onRoad: Math.abs(lateral) <= halfWidth,
    inDriftArea: driftFactor(profile, s) > 0.35,
  };
}
