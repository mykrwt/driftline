/**
 * Wire protocol for the peer-to-peer session.
 *
 * Messages are JSON so they stay debuggable, but the hot path (car state) uses
 * short array payloads to keep the packets tiny.
 */

export const MSG = {
  HELLO: 'hello',
  WELCOME: 'welcome',
  STATE: 'state',
  GHOSTS: 'ghosts',
  START: 'start',
  SCORE: 'score',
  PING: 'ping',
  PONG: 'pong',
  BYE: 'bye',
};

/**
 * @typedef {object} PeerInfo
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {string} accent
 * @property {boolean} ready
 * @property {number} lastSeen
 */

/**
 * @typedef {object} GhostState
 * @property {string} id
 * @property {number} x
 * @property {number} z
 * @property {number} heading
 * @property {number} drift
 * @property {boolean} boost
 */

/**
 * Pack the local car state into a compact array.
 * @param {import('../game/physics.js').CarState} car
 * @returns {number[]}
 */
export function packState(car) {
  return [
    Math.round(car.x * 100) / 100,
    Math.round(car.z * 100) / 100,
    Math.round(car.heading * 1000) / 1000,
    Math.round(car.slip * 1000) / 1000,
    car.boosting ? 1 : 0,
  ];
}

/**
 * @param {number[]} packed
 * @returns {Omit<GhostState, 'id'>}
 */
export function unpackState(packed) {
  return {
    x: packed[0],
    z: packed[1],
    heading: packed[2],
    drift: packed[3],
    boost: Boolean(packed[4]),
  };
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidMessage(value) {
  return Boolean(value && typeof value === 'object' && typeof (/** @type {any} */ (value).t) === 'string');
}

/**
 * Encode a message for the data channel.
 * @param {string} type
 * @param {any} [payload]
 * @returns {string}
 */
export function encode(type, payload) {
  return JSON.stringify(payload === undefined ? { t: type } : { t: type, ...payload });
}

/**
 * @param {string} raw
 * @returns {{ t: string, [key: string]: any } | null}
 */
export function decode(raw) {
  try {
    const parsed = JSON.parse(raw);
    return isValidMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
