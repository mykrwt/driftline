import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrackById } from '../src/game/track.js';
import { getCarConfig, createCarState, placeCar, stepCar } from '../src/game/physics.js';
import { sampleTrack } from '../src/game/track.js';
import { createRace } from '../src/game/race.js';
import { clamp, wrapAngle } from '../src/core/math.js';

/**
 * A driving bot: it aims the car at the road and, in corners, hangs the tail
 * out with the handbrake. It is the closest thing to a human we can get in a
 * head-less test, so it tells us whether the physics is actually playable.
 */
function createBot(track, config, options = {}) {
  const car = createCarState(config);
  placeCar(car, track, 10, 0);
  const slipTarget = options.slipTarget ?? 0.32;

  return {
    car,
    /**
     * @param {number} dt
     * @returns {{ steer: number, throttle: number, brake: number, handbrake: boolean, boost: boolean }}
     */
    drive(dt) {
      const t = track;
      const index = Math.floor((car.distance % t.length) / t.segmentLength) % t.segmentCount;
      const roadHeading = t.heading[index];
      const curvature = t.curvature[index];
      const corner = Math.abs(curvature) > 0.0022;
      const sign = Math.sign(curvature) || 1;

      // Aim the nose slightly inside the corner and keep the path on the road.
      const desiredHeading = roadHeading + (corner ? sign * slipTarget : 0);
      const pathError = wrapAngle(roadHeading - car.velAngle);
      const noseError = wrapAngle(desiredHeading - car.heading);
      const steer = clamp(noseError * 1.8 + pathError * 1.4 - car.offset * 0.02, -1, 1);

      const input = {
        steer,
        throttle: 1,
        brake: 0,
        handbrake: corner,
        boost: false,
      };
      stepCar(car, track, config, input, dt);
      return input;
    },
  };
}

test('a bot can drive a full lap without leaving the road', () => {
  const track = createTrackById('coast');
  const config = getCarConfig('vector');
  const bot = createBot(track, config);
  const race = createRace({ laps: 1, trackLength: track.length });

  let maxOffset = 0;
  let steps = 0;
  const maxSteps = 60 * 240; // four minutes is plenty for one lap
  while (race.state.lap === 1 && steps < maxSteps) {
    bot.drive(1 / 60);
    for (const event of race.update(1 / 60, bot.car.distance, bot.car.onRoad)) {
      if (event.type === 'finish') {
        // finished
      }
    }
    maxOffset = Math.max(maxOffset, Math.abs(bot.car.offset));
    steps++;
  }

  assert.ok(race.state.lapTimes.length >= 1, `the bot never finished a lap (offset ${maxOffset})`);
  assert.ok(race.state.bestLap && race.state.bestLap > 20, `lap time was ${race.state.bestLap}`);
  assert.ok(maxOffset < 14, `the bot left the road by ${maxOffset} m`);
  assert.ok(bot.car.totalDistance > track.length * 0.9);
});

test('the handbrake produces a drift and scores points', () => {
  const track = createTrackById('coast');
  const config = getCarConfig('vector');
  const car = createCarState(config);
  placeCar(car, track, 20, 0);
  // accelerate
  for (let i = 0; i < 180; i++) stepCar(car, track, config, { steer: 0, throttle: 1, brake: 0, handbrake: false, boost: false }, 1 / 60);
  // handbrake + steer into a corner
  let peakSlip = 0;
  let driftingFrames = 0;
  let bestScore = 0;
  for (let i = 0; i < 90; i++) {
    stepCar(car, track, config, { steer: 0.7, throttle: 0.7, brake: 0, handbrake: true, boost: false }, 1 / 60);
    // keep the car on the road so the drift can be measured
    const s = sampleTrack(track, car.distance);
    car.x = s.x;
    car.z = s.z;
    peakSlip = Math.max(peakSlip, Math.abs(car.slip));
    if (car.drifting) driftingFrames++;
    bestScore = Math.max(bestScore, car.driftScore);
  }
  assert.ok(peakSlip > 0.16, `peak slip was only ${peakSlip}`);
  assert.ok(driftingFrames > 10, `only ${driftingFrames} frames of drift`);
  assert.ok(bestScore > 0, `no drift points were scored (${bestScore})`);
  assert.ok(car.bestDrift >= 0);
});

test('the race counts laps and finishes', () => {
  const track = createTrackById('coast');
  const race = createRace({ laps: 2, trackLength: track.length });
  const events = [];
  let distance = 0;
  const dt = 1 / 60;

  // countdown
  for (let i = 0; i < 60 * 4; i++) {
    for (const event of race.update(dt, distance, true)) events.push(event);
  }
  assert.equal(race.state.phase, 'racing');
  assert.ok(events.some((e) => e.type === 'countdown'));

  // two laps
  const length = track.length;
  for (let i = 0; i < 60 * 300; i++) {
    distance = (distance + 40) % length;
    for (const event of race.update(dt, distance, true)) events.push(event);
    if (race.state.phase === 'finished') break;
  }
  assert.equal(race.state.phase, 'finished');
  assert.equal(race.state.lapTimes.length, 2);
  assert.ok(events.some((e) => e.type === 'finish'));
  assert.ok(events.filter((e) => e.type === 'lap').length >= 2);
});

test('the race recovers the car after a long off road stretch', () => {
  const track = createTrackById('coast');
  const race = createRace({ laps: 1, trackLength: track.length });
  race.begin();
  const events = [];
  for (let i = 0; i < 60 * 6; i++) {
    for (const event of race.update(1 / 60, 100, false)) events.push(event);
  }
  assert.ok(events.some((e) => e.type === 'recover'));
});
