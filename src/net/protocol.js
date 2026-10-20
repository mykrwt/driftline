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
 * @property {number} y
 * @property {number} z
 * @property {number} qx
 * @property {number} qy
 * @property {number} qz
 * @property {number} qw
 * @property {number} speed
 * @property {number} slip
 */

/**
 * Pack the chassis state of the local car.
 * @param {import('../game/vehicle.js').VehicleState} vehicle
 * @returns {number[]}
 */
export function packState(vehicle) {
  return [
    Math.round(vehicle.position.x * 100) / 100,
    Math.round(vehicle.position.y * 100) / 100,
    Math.round(vehicle.position.z * 100) / 100,
    Math.round(vehicle.quaternion.x * 1000) / 1000,
    Math.round(vehicle.quaternion.y * 1000) / 1000,
    Math.round(vehicle.quaternion.z * 1000) / 1000,
    Math.round(vehicle.quaternion.w * 1000) / 1000,
    Math.round(vehicle.speed * 100) / 100,
    Math.round(vehicle.slipAngle * 1000) / 1000,
  ];
}

/**
 * @param {number[]} packed
 */
export function unpackState(packed) {
  return {
    x: packed[0],
    y: packed[1],
    z: packed[2],
    qx: packed[3],
    qy: packed[4],
    qz: packed[5],
    qw: packed[6],
    speed: packed[7],
    slip: packed[8],
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
