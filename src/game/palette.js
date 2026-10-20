/**
 * The palette of the world.
 *
 * The colours live here, away from the renderer, so the terrain map preview
 * tool can use exactly the same rules as the game.
 */

/**
 * The palettes the world can be lit with.
 *
 * They drive the sky, the fog and the lights, so a preset changes the whole
 * mood of the drive in one go.
 */
export const PALETTES = {
  alpine: {
    label: 'Alpine Day',
    skyTop: '#1b46ae',
    skyHorizon: '#a9cdec',
    skyGround: '#7f95a8',
    sun: '#fff3d2',
    sunGlow: 'rgba(255, 233, 176, 0.85)',
    fog: '#b3d1ea',
    fogStart: 260,
    fogEnd: 1050,
    sunX: 0.72,
    sunY: 0.3,
    sunIntensity: 1.6,
    hemiIntensity: 0.95,
    fillIntensity: 0.28,
    ambient: '#5d7392',
    starAlpha: 0,
    exposure: 0.88,
    cloud: 0.7,
  },
  golden: {
    label: 'Golden Hour',
    skyTop: '#22407f',
    skyHorizon: '#eec089',
    skyGround: '#7a6759',
    sun: '#ffcf8c',
    sunGlow: 'rgba(255, 190, 120, 0.9)',
    fog: '#dcb489',
    fogStart: 220,
    fogEnd: 950,
    sunX: 0.84,
    sunY: 0.12,
    sunIntensity: 2.5,
    hemiIntensity: 0.85,
    fillIntensity: 0.3,
    ambient: '#7a5f6a',
    starAlpha: 0,
    exposure: 0.95,
    cloud: 0.75,
  },
  midnight: {
    label: 'Midnight',
    skyTop: '#04060d',
    skyHorizon: '#101b33',
    skyGround: '#080c15',
    sun: '#cddcff',
    sunGlow: 'rgba(150, 180, 255, 0.35)',
    fog: '#0b1220',
    fogStart: 90,
    fogEnd: 560,
    sunX: 0.3,
    sunY: 0.45,
    sunIntensity: 0.75,
    hemiIntensity: 0.55,
    fillIntensity: 0.22,
    ambient: '#243356',
    starAlpha: 1,
    exposure: 1.2,
    cloud: 0.25,
  },
};

/** The colours the ground is painted with. */
export const GROUND = {
  grass: '#5e8a45',
  grassLight: '#77a055',
  grassDark: '#436b3a',
  scrub: '#96884c',
  dirt: '#7d6749',
  rock: '#6f737c',
  rockDark: '#4f535c',
  scree: '#8d8c85',
  snow: '#e8eef8',
};

/**
 * Parse a hex colour into linear-ish 0..1 components.
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @param {number[]} out
 */
export function mixInto(a, b, t, out) {
  out[0] += (b[0] - a[0]) * t;
  out[1] += (b[1] - a[1]) * t;
  out[2] += (b[2] - a[2]) * t;
}

/**
 * The colour of the ground at a point.
 *
 * @param {number} slope 0 = flat, 1 = a cliff
 * @param {number} altitude metres above the road
 * @param {number} dist metres from the edge of the road
 * @param {number} patch noise in 0..1
 * @param {number} [rockPatch] noise in 0..1, where the rock breaks through
 * @param {number[]} out rgb in 0..1
 */
export function groundColour(slope, altitude, dist, patch, rockPatch, out) {
  if (rockPatch === undefined) {
    rockPatch = 0;
  }
  const grass = hexToRgb(GROUND.grass);
  const grassLight = hexToRgb(GROUND.grassLight);
  const grassDark = hexToRgb(GROUND.grassDark);
  const scrub = hexToRgb(GROUND.scrub);
  const dirt = hexToRgb(GROUND.dirt);
  const rock = hexToRgb(GROUND.rock);
  const rockDark = hexToRgb(GROUND.rockDark);
  const scree = hexToRgb(GROUND.scree);
  const snow = hexToRgb(GROUND.snow);

  out[0] = grass[0];
  out[1] = grass[1];
  out[2] = grass[2];
  mixInto(out, grassLight, patch * 0.95, out);
  mixInto(out, grassDark, (1 - patch) * 0.45, out);

  // Dry scrub on the sunny shelves.
  const scrubAmount = Math.max(0, Math.min(1, (patch - 0.6) * 3.2));
  mixInto(out, scrub, scrubAmount * 0.6, out);

  // Bare earth along the verge.
  const verge = Math.max(0, Math.min(1, (16 - dist) / 12));
  mixInto(out, dirt, verge * 0.5 * (1 - slope), out);

  // Rock on the steep ground.
  const rockAmount = Math.max(0, Math.min(1, (slope - 0.3) * 2.6));
  mixInto(out, rock, rockAmount, out);
  mixInto(out, rockDark, Math.max(0, Math.min(1, (slope - 0.62) * 2.2)), out);

  // Outcrops: the mountain breaks through the turf in patches, which is what
  // makes a slope read as rock instead of as a green ramp.
  const outcrop = Math.max(0, Math.min(1, (rockPatch - 0.52) * 3.2)) * Math.min(1, altitude / 25);
  mixInto(out, rock, outcrop * 0.85, out);
  // Horizontal strata break the cliffs up into layers of rock.
  const strata = 0.5 + 0.5 * Math.sin(altitude * 0.32 + rockPatch * 7);
  mixInto(out, rockDark, outcrop * 0.42 * strata, out);
  mixInto(out, scree, outcrop * 0.2 * (1 - strata), out);

  const screeAmount = Math.max(0, Math.min(1, (altitude - 90) / 140)) * (1 - rockAmount * 0.4);
  mixInto(out, scree, screeAmount * 0.45, out);

  // Snow on the high, gentle ground.
  const snowAmount =
    Math.max(0, Math.min(1, (altitude - 215) / 130)) * (1 - Math.min(1, slope * 1.6));
  mixInto(out, snow, snowAmount, out);

  // Valleys collect more moisture, so they read greener.
  const damp = Math.max(0, Math.min(1, (-altitude - 6) / 40));
  mixInto(out, grassDark, damp * 0.4, out);
  return out;
}
