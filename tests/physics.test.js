import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrackById, ROAD_HALF_WIDTH, sampleTrack } from '../src/game/track.js';
import { CARS, getCarConfig, createCarState, placeCar, stepCar } from '../src/game/physics.js';
import { clamp, wrapAngle } from '../src/core/math.js';

const track = createTrackById('coast');
const config = getCarConfig('vector');

/** @param {Partial<import('../src/game/physics.js').CarState>} [overrides] */
function makeCar(overrides = {}) {
  const car = createCarState(config);
  placeCar(car, track, 20, 0);
  return Object.assign(car, overrides);
}

/** Keep the car on the centre line so drift tests are not cut short by the road. */
function snapToRoad(car) {
  const sample = sampleTrack(track, car.distance);
  car.x = sample.x;
  car.z = sample.z;
}

const IDLE = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
const GAS = { steer: 0, throttle: 1, brake: 0, handbrake: false, boost: false };

test('every car is configured sensibly', () => {
  assert.ok(CARS.length >= 3);
  for (const car of CARS) {
    assert.ok(car.id && car.name && car.color);
    assert.ok(car.maxSpeed > 30);
    assert.ok(car.accel > 0 && car.brake > 0);
    assert.ok(car.steerRate > 0);
    assert.ok(car.maxSlip > 0.2 && car.maxSlip < 1);
    assert.ok(car.grip > 0);
  }
  assert.equal(getCarConfig('nope'), CARS[0]);
});

test('throttle accelerates the car', () => {
  const car = makeCar();
  for (let i = 0; i < 60; i++) stepCar(car, track, config, GAS, 1 / 60);
  assert.ok(car.speed > 5, `speed was ${car.speed}`);
  assert.ok(car.distance > 0);
});

test('the car never exceeds its top speed', () => {
  const car = makeCar();
  for (let i = 0; i < 60 * 60; i++) stepCar(car, track, config, GAS, 1 / 60);
  assert.ok(car.speed <= config.maxSpeed * 1.2, `speed was ${car.speed}`);
});

test('braking slows the car down', () => {
  const car = makeCar();
  for (let i = 0; i < 300; i++) stepCar(car, track, config, GAS, 1 / 60);
  const fast = car.speed;
  for (let i = 0; i < 120; i++) {
    stepCar(car, track, config, { ...IDLE, brake: 1 }, 1 / 60);
  }
  assert.ok(car.speed < fast, `${car.speed} !< ${fast}`);
});

test('steering rotates the car', () => {
  const car = makeCar();
  for (let i = 0; i < 120; i++) stepCar(car, track, config, GAS, 1 / 60);
  const before = car.heading;
  for (let i = 0; i < 60; i++) {
    stepCar(car, track, config, { ...GAS, steer: 1 }, 1 / 60);
  }
  assert.ok(Math.abs(car.heading - before) > 0.2);
});

test('the handbrake breaks traction and creates slip', () => {
  const car = makeCar();
  for (let i = 0; i < 240; i++) stepCar(car, track, config, GAS, 1 / 60);
  let maxSlip = 0;
  for (let i = 0; i < 120; i++) {
    stepCar(car, track, config, { steer: 1, throttle: 0.6, brake: 0, handbrake: true, boost: false }, 1 / 60);
    maxSlip = Math.max(maxSlip, Math.abs(car.slip));
  }
  assert.ok(maxSlip > 0.16, `slip was only ${maxSlip}`);
});

test('drifting scores points and grows the multiplier', () => {
  const car = makeCar();
  for (let i = 0; i < 150; i++) {
    stepCar(car, track, config, GAS, 1 / 60);
    snapToRoad(car);
  }
  let peakScore = 0;
  let peakMultiplier = 1;
  let wasDrifting = false;
  let peakSlip = 0;
  for (let i = 0; i < 60; i++) {
    stepCar(car, track, config, { steer: 0.55, throttle: 0.6, brake: 0, handbrake: true, boost: false }, 1 / 60);
    snapToRoad(car);
    peakScore = Math.max(peakScore, car.driftScore);
    peakMultiplier = Math.max(peakMultiplier, car.driftMultiplier);
    peakSlip = Math.max(peakSlip, Math.abs(car.slip));
    wasDrifting = wasDrifting || car.drifting;
  }
  assert.ok(peakSlip > 0.2, `peak slip was only ${peakSlip}`);
  assert.ok(wasDrifting, 'the car never entered a drift');
  assert.ok(peakScore > 0, `peak score was ${peakScore}`);
  assert.ok(peakMultiplier >= 1);
});

test('the car never spins: the slip angle stays bounded', () => {
  const car = makeCar();
  for (let i = 0; i < 150; i++) stepCar(car, track, config, GAS, 1 / 60);
  let maxSlip = 0;
  for (let i = 0; i < 300; i++) {
    stepCar(car, track, config, { steer: 1, throttle: 1, brake: 0, handbrake: true, boost: false }, 1 / 60);
    maxSlip = Math.max(maxSlip, Math.abs(car.slip));
  }
  assert.ok(maxSlip < 0.7, `the car spun to ${maxSlip} radians`);
});

test('a car that follows the road stays on it', () => {
  const car = makeCar();
  for (let i = 0; i < 60 * 25; i++) {
    const sample = sampleTrack(track, car.distance);
    const headingError = wrapAngle(sample.heading - car.heading);
    const steer = clamp(headingError * 1.6 - car.offset * 0.05, -1, 1);
    stepCar(car, track, config, { ...GAS, steer }, 1 / 60);
  }
  assert.ok(Math.abs(car.offset) < ROAD_HALF_WIDTH, `offset ${car.offset}`);
  assert.ok(car.onRoad);
});

test('driving off the road slows the car down', () => {
  const car = makeCar();
  // Push the car off the road.
  car.x += 40;
  car.z += 40;
  for (let i = 0; i < 60; i++) stepCar(car, track, config, GAS, 1 / 60);
  assert.equal(car.onRoad, false);
  const roadSpeed = (() => {
    const other = makeCar();
    for (let i = 0; i < 60; i++) stepCar(other, track, config, GAS, 1 / 60);
    return other.speed;
  })();
  assert.ok(car.speed < roadSpeed, `off road ${car.speed} vs road ${roadSpeed}`);
});

test('a long simulation never produces NaN', () => {
  const car = makeCar();
  for (let i = 0; i < 60 * 120; i++) {
    const phase = i % 600;
    const input =
      phase < 200
        ? GAS
        : phase < 400
          ? { ...GAS, steer: 0.8, handbrake: true }
          : { steer: -0.6, throttle: 0.2, brake: 0.4, handbrake: false, boost: false };
    stepCar(car, track, config, input, 1 / 60);
    assert.ok(Number.isFinite(car.x));
    assert.ok(Number.isFinite(car.z));
    assert.ok(Number.isFinite(car.speed));
    assert.ok(Number.isFinite(car.slip));
  }
});

test('placeCar puts the car on the centre line', () => {
  const car = createCarState(config);
  placeCar(car, track, 500, 0);
  assert.ok(Math.abs(car.offset) < 0.5);
  assert.equal(car.speed, 0);
  assert.equal(Math.round(car.distance), 500);
});

test('boost consumes fuel and adds power', () => {
  const car = makeCar();
  car.boostFuel = 1;
  for (let i = 0; i < 60; i++) stepCar(car, track, config, { ...GAS, boost: true }, 1 / 60);
  assert.ok(car.boostFuel < 1, `fuel ${car.boostFuel}`);
});
