import test from 'node:test';
import assert from 'node:assert/strict';
import { loadState, saveState, recordResult, DEFAULT_SETTINGS } from '../src/core/storage.js';

/** Minimal in-memory Storage implementation. */
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
}

test('loading without storage returns the defaults', () => {
  const original = globalThis.localStorage;
  // @ts-ignore - deliberately removing the API
  delete globalThis.localStorage;
  const state = loadState();
  assert.deepEqual(state.settings, DEFAULT_SETTINGS);
  assert.deepEqual(state.records.bestLap, {});
  if (original) globalThis.localStorage = original;
});

test('settings survive a save and load cycle', () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = new MemoryStorage();
  const state = loadState();
  state.settings.car = 'comet';
  state.settings.volume = 0.25;
  saveState(state);
  const reloaded = loadState();
  assert.equal(reloaded.settings.car, 'comet');
  assert.equal(reloaded.settings.volume, 0.25);
  if (original) globalThis.localStorage = original;
  else delete globalThis.localStorage;
});

test('corrupt storage falls back to the defaults', () => {
  const original = globalThis.localStorage;
  const store = new MemoryStorage();
  store.setItem('driftline.v1', '{not json');
  globalThis.localStorage = store;
  const state = loadState();
  assert.equal(state.settings.car, DEFAULT_SETTINGS.car);
  if (original) globalThis.localStorage = original;
  else delete globalThis.localStorage;
});

test('records keep the best lap and drift', () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = new MemoryStorage();
  const state = loadState();

  const first = recordResult(state, 'coast', { lapTime: 62.5, drift: 1200 });
  assert.equal(first.newLapRecord, true);
  assert.equal(first.newDriftRecord, true);

  const slower = recordResult(state, 'coast', { lapTime: 70, drift: 500 });
  assert.equal(slower.newLapRecord, false);
  assert.equal(slower.newDriftRecord, false);

  const faster = recordResult(state, 'coast', { lapTime: 60, drift: 4000 });
  assert.equal(faster.newLapRecord, true);
  assert.equal(faster.newDriftRecord, true);

  assert.equal(state.records.bestLap.coast, 60);
  assert.equal(state.records.bestDrift.coast, 4000);
  assert.equal(state.records.races, 3);

  const reloaded = loadState();
  assert.equal(reloaded.records.bestLap.coast, 60);
  if (original) globalThis.localStorage = original;
  else delete globalThis.localStorage;
});
