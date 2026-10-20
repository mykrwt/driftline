/**
 * Persistent settings and records.
 *
 * Everything is optional: if localStorage is unavailable (private mode,
 * embedded webviews with storage disabled) the game still runs, it just does
 * not remember anything.
 */

const KEY = 'driftline.v1';

/**
 * @typedef {object} Settings
 * @property {number} volume          master volume 0..1
 * @property {boolean} muted
 * @property {string} quality         'low' | 'medium' | 'high'
 * @property {boolean} autoQuality    drop quality when fps is low
 * @property {boolean} tiltSteer      use device tilt for steering
 * @property {number} tiltSensitivity 0.5..2
 * @property {boolean} invertSteer
 * @property {boolean} showFps
 * @property {string} car             car id
 * @property {string} track           track id
 * @property {boolean} units          'metric' | 'imperial'
 */

/**
 * @typedef {object} Records
 * @property {Record<string, number>} bestLap     by track id
 * @property {Record<string, number>} bestDrift   by track id
 * @property {number} totalDrift
 * @property {number} races
 */

/** @type {Settings} */
export const DEFAULT_SETTINGS = {
  volume: 0.7,
  muted: false,
  quality: 'high',
  autoQuality: true,
  tiltSteer: false,
  tiltSensitivity: 1,
  invertSteer: false,
  showFps: false,
  car: 'vector',
  track: 'coast',
  units: 'metric',
};

/** @type {Records} */
export const DEFAULT_RECORDS = {
  bestLap: {},
  bestDrift: {},
  totalDrift: 0,
  races: 0,
};

/** @returns {Storage | null} */
function getStore() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = '__driftline_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

/**
 * @returns {{ settings: Settings, records: Records }}
 */
export function loadState() {
  const store = getStore();
  if (!store) {
    return { settings: { ...DEFAULT_SETTINGS }, records: { ...DEFAULT_RECORDS, bestLap: {}, bestDrift: {} } };
  }
  let raw = null;
  try {
    raw = store.getItem(KEY);
  } catch {
    raw = null;
  }
  if (!raw) {
    return { settings: { ...DEFAULT_SETTINGS }, records: { ...DEFAULT_RECORDS, bestLap: {}, bestDrift: {} } };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      records: {
        ...DEFAULT_RECORDS,
        ...(parsed.records || {}),
        bestLap: { ...(parsed.records?.bestLap || {}) },
        bestDrift: { ...(parsed.records?.bestDrift || {}) },
      },
    };
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, records: { ...DEFAULT_RECORDS, bestLap: {}, bestDrift: {} } };
  }
}

/**
 * @param {{ settings: Settings, records: Records }} state
 */
export function saveState(state) {
  const store = getStore();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota or private mode - ignore */
  }
}

/**
 * Record a finished lap / drift and persist the bests.
 * @param {{ settings: Settings, records: Records }} state
 * @param {string} trackId
 * @param {{ lapTime?: number, drift?: number }} result
 * @returns {{ newLapRecord: boolean, newDriftRecord: boolean }}
 */
export function recordResult(state, trackId, result) {
  let newLapRecord = false;
  let newDriftRecord = false;

  if (typeof result.lapTime === 'number' && result.lapTime > 0) {
    const best = state.records.bestLap[trackId];
    if (!best || result.lapTime < best) {
      state.records.bestLap[trackId] = result.lapTime;
      newLapRecord = true;
    }
  }
  if (typeof result.drift === 'number' && result.drift > 0) {
    const best = state.records.bestDrift[trackId];
    if (!best || result.drift > best) {
      state.records.bestDrift[trackId] = result.drift;
      newDriftRecord = true;
    }
    state.records.totalDrift += result.drift;
  }
  state.records.races += 1;
  saveState(state);
  return { newLapRecord, newDriftRecord };
}
