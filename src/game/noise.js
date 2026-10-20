/**
 * Procedural noise used for the mountains, the forests and the terrain
 * textures. Everything is deterministic and cheap enough to evaluate a few
 * hundred thousand times while a chunk is built.
 */

/**
 * Integer hash -> [-1, 1].
 * @param {number} x
 * @param {number} y
 * @param {number} seed
 * @returns {number}
 */
export function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1;
}

/**
 * Smooth value noise.
 * @param {number} x
 * @param {number} y
 * @param {number} seed
 * @returns {number}
 */
export function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

/**
 * Fractal brownian motion.
 * @param {number} x
 * @param {number} y
 * @param {number} octaves
 * @param {number} seed
 * @param {number} [lacunarity]
 * @param {number} [gain]
 * @returns {number} roughly -1..1
 */
export function fbm(x, y, octaves, seed, lacunarity = 2.03, gain = 0.5) {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * frequency, y * frequency, seed + i * 1013) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / (norm || 1);
}

/**
 * Ridged multifractal noise: gives sharp mountain ridges instead of soft
 * blobs.
 * @param {number} x
 * @param {number} y
 * @param {number} octaves
 * @param {number} seed
 * @returns {number} 0..1
 */
export function ridged(x, y, octaves, seed) {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  let previous = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(valueNoise(x * frequency, y * frequency, seed + i * 7919));
    n *= n;
    n *= previous;
    previous = n;
    sum += n * amplitude;
    norm += amplitude;
    amplitude *= 0.52;
    frequency *= 2.07;
  }
  return sum / (norm || 1);
}

/**
 * Domain warped fbm: bends the noise so the shapes stop looking like plain
 * sine hills.
 * @param {number} x
 * @param {number} y
 * @param {number} seed
 * @returns {number}
 */
export function warpedFbm(x, y, seed) {
  const qx = fbm(x + 0.0, y + 0.0, 4, seed + 11);
  const qy = fbm(x + 5.2, y + 1.3, 4, seed + 37);
  const rx = fbm(x + 4.0 * qx + 1.7, y + 4.0 * qy + 9.2, 4, seed + 71);
  const ry = fbm(x + 4.0 * qx + 8.3, y + 4.0 * qy + 2.8, 4, seed + 97);
  return fbm(x + 4.0 * rx, y + 4.0 * ry, 5, seed);
}
