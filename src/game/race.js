/**
 * Race rules: countdown, laps, lap times and the finish.
 *
 * Kept free of any rendering or DOM dependency so it can be unit tested and
 * reasoned about on its own.
 */

import { clamp } from '../core/math.js';

/**
 * @typedef {object} RaceEvent
 * @property {'countdown' | 'lap' | 'finish'} type
 * @property {number} [value]
 * @property {number} [lap]
 * @property {number} [lapTime]
 * @property {number} [best]
 * @property {number} [raceTime]
 */

/**
 * @param {{ laps?: number, countdown?: number, trackLength: number }} options
 */
export function createRace(options) {
  const laps = Math.max(1, options.laps ?? 2);
  const countdownLength = options.countdown ?? 3.2;

  const state = {
    phase: /** @type {'countdown' | 'racing' | 'finished'} */ ('countdown'),
    countdown: countdownLength,
    lap: 1,
    laps,
    lapTime: 0,
    raceTime: 0,
    bestLap: /** @type {number | null} */ (null),
    lapTimes: /** @type {number[]} */ ([]),
    progress: 0,
    offRoadTime: 0,
    finished: false,
  };

  let lastDistance = 0;

  /**
   * Advance the race by one step.
   * @param {number} dt
   * @param {number} distance metres along the lap
   * @param {boolean} onRoad
   * @returns {RaceEvent[]}
   */
  function update(dt, distance, onRoad) {
    /** @type {RaceEvent[]} */
    const events = [];

    if (state.phase === 'countdown') {
      const before = Math.ceil(state.countdown);
      state.countdown -= dt;
      const after = Math.ceil(state.countdown);
      if (after !== before && after >= 0) {
        events.push({ type: 'countdown', value: after });
      }
      if (state.countdown <= 0) {
        state.phase = 'racing';
        lastDistance = distance;
      }
      return events;
    }

    if (state.phase !== 'racing') return events;

    // Unwrap the distance so lap counting survives the start/finish line.
    const length = options.trackLength;
    let delta = distance - lastDistance;
    if (delta < -length / 2) delta += length;
    if (delta > length / 2) delta -= length;
    lastDistance = distance;

    state.progress += delta;
    state.lapTime += dt;
    state.raceTime += dt;

    const lap = Math.floor(state.progress / length) + 1;
    if (lap > state.lap) {
      const lapTime = state.lapTime;
      state.lapTimes.push(lapTime);
      if (state.bestLap === null || lapTime < state.bestLap) state.bestLap = lapTime;
      state.lap = lap;
      state.lapTime = 0;
      events.push({ type: 'lap', lap, lapTime, best: state.bestLap });
      if (lap > laps) {
        state.phase = 'finished';
        state.finished = true;
        events.push({
          type: 'finish',
          lapTimes: state.lapTimes.slice(),
          bestLap: state.bestLap,
          raceTime: state.raceTime,
        });
      }
    }

    // Off road for too long and the car gets recovered to the track.
    if (!onRoad) {
      state.offRoadTime += dt;
      if (state.offRoadTime > 4.5) {
        state.offRoadTime = 0;
        events.push({ type: 'recover' });
      }
    } else {
      state.offRoadTime = 0;
    }

    return events;
  }

  return {
    state,
    update,
    /**
     * @param {number} distance
     */
    reset(distance = 0) {
      state.phase = 'countdown';
      state.countdown = countdownLength;
      state.lap = 1;
      state.lapTime = 0;
      state.raceTime = 0;
      state.bestLap = null;
      state.lapTimes = [];
      state.progress = 0;
      state.offRoadTime = 0;
      state.finished = false;
      lastDistance = distance;
    },
    /**
     * Skip the countdown (used when a peer starts the race).
     */
    begin() {
      state.phase = 'racing';
      state.countdown = 0;
    },
    /** @param {number} value */
    setLaps(value) {
      state.laps = clamp(Math.round(value), 1, 99);
    },
  };
}
