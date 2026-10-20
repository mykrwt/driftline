/**
 * Small math helpers shared by the simulation and the renderer.
 * All angles are radians unless the name says otherwise.
 */

/** @type {number} */
export const TAU = Math.PI * 2;

/**
 * Clamp a value into a range.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * Linear interpolation.
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Frame-rate independent exponential smoothing.
 * `rate` is roughly "how many e-folds per second".
 * @param {number} current
 * @param {number} target
 * @param {number} rate
 * @param {number} dt
 * @returns {number}
 */
export function damp(current, target, rate, dt) {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

/**
 * Smoothstep easing on the 0..1 range.
 * @param {number} t
 * @returns {number}
 */
export function smoothstep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * Wrap an angle into the -PI..PI range.
 * @param {number} angle
 * @returns {number}
 */
export function wrapAngle(angle) {
  let a = (angle + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/**
 * Move `current` toward `target` by at most `maxDelta`.
 * @param {number} current
 * @param {number} target
 * @param {number} maxDelta
 * @returns {number}
 */
export function moveTowards(current, target, maxDelta) {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

/**
 * Sign helper that returns 0 for zero.
 * @param {number} n
 * @returns {number}
 */
export function sign(n) {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

/**
 * Format seconds as m:ss.cc
 * @param {number} seconds
 * @returns {string}
 */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--.--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Format a large score with a compact suffix.
 * @param {number} value
 * @returns {string}
 */
export function formatScore(value) {
  const n = Math.max(0, Math.floor(value));
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Convert meters per second to km/h.
 * @param {number} mps
 * @returns {number}
 */
export function mpsToKmh(mps) {
  return mps * 3.6;
}

/**
 * Whether a value is a usable finite number.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}
