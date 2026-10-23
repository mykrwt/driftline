/**
 * The palette of the world.
 *
 * Drives sky, atmosphere, directional & hemisphere light, lakes, distant
 * mountain haze, tree foliage mood, and base ground colours across all presets.
 */

export const PALETTES = {
  alpine: {
    id: 'alpine',
    label: 'Alpine Day',
    skyTop: '#062b88',
    skyHorizon: '#9acef2',
    skyGround: '#637d96',
    sun: '#fff4d8',
    sunGlow: 'rgba(255, 236, 184, 0.88)',
    fog: '#aad2f0',
    fogStart: 320,
    fogEnd: 1380,
    waterDeep: '#06263d',
    waterShallow: '#167a8a',
    horizonNear: '#6387b0',
    horizonFar: '#8cb0d4',
    horizonSnow: '#f2f8ff',
    foliageTint: '#ffffff',
    foliageEmissive: 0.56,
    headlights: 0,
    sunX: 0.74,
    sunY: 0.36,
    sunIntensity: 1.95,
    hemiIntensity: 1.5,
    fillIntensity: 0.5,
    ambient: '#758ba6',
    starAlpha: 0,
    exposure: 0.93,
    cloud: 0.62,
  },
  golden: {
    id: 'golden',
    label: 'Golden Hour',
    skyTop: '#142260',
    skyHorizon: '#f2a15a',
    skyGround: '#6c5046',
    sun: '#ffaf5c',
    sunGlow: 'rgba(255, 178, 102, 0.94)',
    fog: '#e4a76e',
    fogStart: 260,
    fogEnd: 1180,
    waterDeep: '#10243d',
    waterShallow: '#285d6c',
    horizonNear: '#745e78',
    horizonFar: '#ad827b',
    horizonSnow: '#ffd9b0',
    foliageTint: '#ffd6a6',
    foliageEmissive: 0.42,
    headlights: 0.45,
    sunX: 0.86,
    sunY: 0.11,
    sunIntensity: 2.75,
    hemiIntensity: 1.18,
    fillIntensity: 0.44,
    ambient: '#7a5a70',
    starAlpha: 0.1,
    exposure: 0.96,
    cloud: 0.64,
  },
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    skyTop: '#01030b',
    skyHorizon: '#0a1834',
    skyGround: '#040812',
    sun: '#9ebfff',
    sunGlow: 'rgba(155, 190, 255, 0.42)',
    fog: '#09152b',
    fogStart: 150,
    fogEnd: 880,
    waterDeep: '#061a36',
    waterShallow: '#144468',
    horizonNear: '#0c1c3a',
    horizonFar: '#13284e',
    horizonSnow: '#5a7ba8',
    foliageTint: '#3f577d',
    foliageEmissive: 0.13,
    headlights: 1.0,
    sunX: 0.28,
    sunY: 0.46,
    sunIntensity: 0.9,
    hemiIntensity: 0.58,
    fillIntensity: 0.24,
    ambient: '#192a4c',
    starAlpha: 1,
    exposure: 1.12,
    cloud: 0.24,
  },
};

/** Friendly aliases so callers/tests can pass either preset names or objects. */
export const PALETTE_ALIASES = {
  day: 'alpine',
  alpine: 'alpine',
  sunset: 'golden',
  dusk: 'golden',
  golden: 'golden',
  night: 'midnight',
  midnight: 'midnight',
};

/**
 * Resolve a palette preset name or partial object.
 * @param {any} input
 */
export function resolvePalette(input) {
  if (typeof input === 'string') {
    const key = PALETTE_ALIASES[input.toLowerCase()] ?? 'alpine';
    return { ...PALETTES[key] };
  }
  if (input && typeof input === 'object') {
    return input;
  }
  return { ...PALETTES.alpine };
}

/** Natural alpine ground palette (richer greens, warm soil, crisp slate & snow). */
export const GROUND = {
  grass: '#4c7f38',
  grassLight: '#6fa149',
  grassDark: '#31592a',
  scrub: '#8f8446',
  dirt: '#755f43',
  rock: '#6c727d',
  rockDark: '#474c56',
  scree: '#98968e',
  snow: '#eaf1fb',
  gravel: '#857f72',
};

/**
 * Parse a hex colour into 0..1 components.
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @param {number} t
 * @param {number[]} out
 */
export function mixInto(a, b, t, out) {
  out[0] += (b[0] - a[0]) * t;
  out[1] += (b[1] - a[1]) * t;
  out[2] += (b[2] - a[2]) * t;
}

const RGB_CACHE = {
  grass: hexToRgb(GROUND.grass),
  grassLight: hexToRgb(GROUND.grassLight),
  grassDark: hexToRgb(GROUND.grassDark),
  scrub: hexToRgb(GROUND.scrub),
  dirt: hexToRgb(GROUND.dirt),
  gravel: hexToRgb(GROUND.gravel),
  rock: hexToRgb(GROUND.rock),
  rockDark: hexToRgb(GROUND.rockDark),
  scree: hexToRgb(GROUND.scree),
  snow: hexToRgb(GROUND.snow),
};

/**
 * The base vertex colour of the ground at a point (also shared by tools/scene-preview.mjs).
 *
 * @param {number} slope 0 = flat, 1 = a cliff
 * @param {number} altitude metres above the road
 * @param {number} dist metres from the edge of the road
 * @param {number} patch noise in 0..1
 * @param {number} [rockPatch] noise in 0..1, where the rock breaks through
 * @param {number[]} out rgb in 0..1
 * @param {number} [mottle] 0..1 fine noise
 */
export function groundColour(slope, altitude, dist, patch, rockPatch, out, mottle = 0.5) {
  if (rockPatch === undefined) rockPatch = 0;

  const { grass, grassLight, grassDark, scrub, dirt, gravel, rock, rockDark, scree, snow } = RGB_CACHE;

  out[0] = grass[0];
  out[1] = grass[1];
  out[2] = grass[2];
  mixInto(out, grassLight, patch * 0.9, out);
  mixInto(out, grassDark, (1 - patch) * 0.5, out);

  // Sun-warmed alpine pasture shelves.
  const scrubAmount = Math.max(0, Math.min(1, (patch - 0.58) * 3.0)) * Math.min(1, Math.max(0, altitude + 8) / 45);
  mixInto(out, scrub, scrubAmount * 0.52, out);

  // Subtle earth transition along roadside cuts/swales.
  const verge = Math.max(0, Math.min(1, (9.5 - dist) / 8.5));
  mixInto(out, dirt, verge * 0.34 * (1 - slope * 0.5), out);

  // Gravel shoulder right beside the tarmac.
  const shoulder = Math.max(0, Math.min(1, (2.6 - dist) / 2.3));
  mixInto(out, gravel, shoulder * 0.82 * (1 - slope * 0.4), out);

  // Exposed bedrock on steep slopes & high crags.
  const rockAmount = Math.max(0, Math.min(1, (slope - 0.2) * 2.9));
  mixInto(out, rock, rockAmount, out);
  mixInto(out, rockDark, Math.max(0, Math.min(1, (slope - 0.48) * 2.4)), out);

  const outcrop = Math.max(0, Math.min(1, (rockPatch - 0.4) * 3.1)) * Math.min(1, Math.max(0, altitude) / 16);
  mixInto(out, rock, outcrop * 0.92, out);

  const strata = 0.5 + 0.5 * Math.sin(altitude * 0.17 + rockPatch * 9.5);
  const grit = 0.5 + 0.5 * Math.sin(altitude * 0.85 + rockPatch * 21);
  mixInto(out, rockDark, outcrop * 0.58 * strata, out);
  mixInto(out, rockDark, rockAmount * 0.28 * (1 - strata) * grit, out);
  mixInto(out, scree, outcrop * 0.28 * (1 - strata), out);
  mixInto(out, rock, rockAmount * 0.22 * grit, out);

  const speckle = Math.max(0, mottle - 0.35) * 1.5;
  mixInto(out, rockDark, Math.min(0.72, speckle) * Math.max(rockAmount, outcrop) * 0.8, out);
  mixInto(out, scree, Math.max(0, mottle - 0.64) * 1.85 * Math.max(rockAmount, outcrop) * 0.78, out);
  mixInto(out, grassDark, Math.max(0, 0.36 - mottle) * 1.35 * (1 - rockAmount) * (1 - outcrop) * 0.68, out);

  // High alpine talus & snowline.
  const screeAmount = Math.max(0, Math.min(1, (altitude - 82) / 115)) * (1 - rockAmount * 0.35);
  mixInto(out, scree, screeAmount * 0.5, out);

  const snowAmount = Math.max(0, Math.min(1, (altitude - 155) / 95)) * (1 - Math.min(1, slope * 1.45));
  mixInto(out, snow, snowAmount * 0.95, out);

  // Moist lake shores & valley floor meadows.
  const damp = Math.max(0, Math.min(1, (-altitude - 3.5) / 8));
  mixInto(out, dirt, damp * 0.45, out);
  return out;
}
