/**
 * Deterministic pseudo random number generation.
 *
 * The track seed is shared with peers, so every client must generate the exact
 * same world from the same seed.
 */

/**
 * mulberry32 - small, fast, good enough for procedural content.
 * @param {number} seed
 * @returns {() => number} function returning floats in [0, 1)
 */
export function createRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random helpers bound to one generator.
 * @param {() => number} rng
 */
export function createRandomHelpers(rng) {
  return {
    rng,
    /** @param {number} min @param {number} max */
    range: (min, max) => min + rng() * (max - min),
    /** @param {number} min @param {number} max */
    int: (min, max) => Math.floor(min + rng() * (max - min + 1)),
    /** @param {number} chance */
    chance: (chance) => rng() < chance,
    /** @param {readonly T[]} items @returns {T} */
    pick: (items) => items[Math.floor(rng() * items.length) % items.length],
    /** @param {T[]} items */
    shuffle: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

/**
 * @typedef {ReturnType<typeof createRandomHelpers>} RandomHelpers
 */

/**
 * Hash a string into a 32 bit seed (used to turn track names into seeds).
 * @param {string} text
 * @returns {number}
 */
export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
