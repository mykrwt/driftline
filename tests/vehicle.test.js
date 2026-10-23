import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import { CAR_SPECS, createVehicle, getCarSpec, placeVehicle, stepVehicle } from '../src/game/vehicle.js';

/** Flat ground at y = 0. */
const flatGround = (/** @type {number} */ x, /** @type {number} */ z, out) => {
  out.height = 0;
  out.lateral = 0;
  out.onRoad = true;
  out.s = z;
  return 0;
};

/** A 30 cm raised pad on the right hand side of the road. */
const padGround = (x, z, out) => {
  const height = x > 0.2 && x < 2.6 && z > -4 && z < 4 ? 0.3 : 0;
  out.height = height;
  out.lateral = 0;
  out.onRoad = true;
  out.s = z;
  return height;
};

const IDLE = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
const GAS = { steer: 0, throttle: 1, brake: 0, handbrake: false, boost: false };

/**
 * @param {any} vehicle
 * @param {any} input
 * @param {Function} ground
 * @param {number} steps
 * @param {number} [dt]
 */
function run(vehicle, input, ground, steps, dt = 1 / 120) {
  for (let i = 0; i < steps; i++) stepVehicle(vehicle, input, ground, dt);
}

test('every car is configured with sane numbers', () => {
  for (const car of Object.values(CAR_SPECS)) {
    assert.ok(car.mass > 800 && car.mass < 2500, `${car.id} mass`);
    assert.ok(car.wheelbase > 2 && car.wheelbase < 3.6);
    assert.ok(car.trackWidth > 1.3 && car.trackWidth < 2);
    assert.ok(car.cgHeight > 0.3 && car.cgHeight < 0.9);
    assert.ok(car.suspensionK > 20000 && car.suspensionK < 90000);
    assert.ok(car.suspensionC > 2000);
    assert.ok(car.maxTravel > 0.1 && car.maxTravel < 0.4);
    assert.ok(car.gripFront > 0.7 && car.gripRear > 0.7);
    assert.ok(car.peakSlip > 0.08 && car.peakSlip < 0.3);
    assert.ok(car.engineForce > 5000 && car.engineForce < 20000);
  }
  assert.equal(getCarSpec('nope').id, 'vector');
});

test('the car settles on its suspension instead of sinking', () => {
  const vehicle = createVehicle(getCarSpec('vector'));
  run(vehicle, IDLE, flatGround, 240);
  // The chassis rests one suspension length above the ground.
  assert.ok(vehicle.position.y > 0.15 && vehicle.position.y < 0.55, `y ${vehicle.position.y}`);
  assert.ok(vehicle.velocity.y === 0 || Math.abs(vehicle.velocity.y) < 0.02);
  for (const wheel of vehicle.wheels) {
    assert.ok(wheel.contact, 'every wheel should touch the ground');
    assert.ok(wheel.compression > 0 && wheel.compression < 0.2, `compression ${wheel.compression}`);
    assert.ok(wheel.load > 0);
  }
});

test('the total suspension load matches the weight of the car', () => {
  const vehicle = createVehicle(getCarSpec('vector'));
  run(vehicle, IDLE, flatGround, 240);
  const total = vehicle.wheels.reduce((sum, wheel) => sum + wheel.load, 0);
  const weight = vehicle.spec.mass * 9.81;
  assert.ok(Math.abs(total - weight) / weight < 0.08, `load ${total} vs weight ${weight}`);
});

test('throttle accelerates the car and braking slows it down', () => {
  const vehicle = createVehicle(getCarSpec('vector'));
  run(vehicle, GAS, flatGround, 600);
  const fast = vehicle.speed;
  assert.ok(fast > 8, `speed ${fast}`);
  assert.ok(fast < vehicle.spec.maxSpeed * 1.2);
  run(vehicle, { ...IDLE, brake: 1 }, flatGround, 300);
  assert.ok(vehicle.speed < fast, `${vehicle.speed} !< ${fast}`);
});

test('steering turns the car', () => {
  const vehicle = createVehicle(getCarSpec('vector'));
  run(vehicle, GAS, flatGround, 240);
  const before = Math.atan2(vehicle.velocity.x, vehicle.velocity.z);
  run(vehicle, { ...GAS, steer: 0.8 }, flatGround, 240);
  const after = Math.atan2(vehicle.velocity.x, vehicle.velocity.z);
  assert.ok(Math.abs(after - before) > 0.15, `turned ${after - before}`);
});

test('weight transfer moves the load between the axles', () => {
  const vehicle = createVehicle(getCarSpec('vector'));
  run(vehicle, IDLE, flatGround, 240);
  const restFront = vehicle.wheels[0].load + vehicle.wheels[1].load;
  const restRear = vehicle.wheels[2].load + vehicle.wheels[3].load;
  run(vehicle, GAS, flatGround, 300);
  const movingFront = vehicle.wheels[0].load + vehicle.wheels[1].load;
  const movingRear = vehicle.wheels[2].load + vehicle.wheels[3].load;
  // Under power the rear squats and the front lightens.
  assert.ok(movingRear - restRear > 100, `rear ${restRear} -> ${movingRear}`);
  assert.ok(movingFront - restFront < 0, `front ${restFront} -> ${movingFront}`);
});

test('one wheel on a raised surface only lifts that corner', () => {
  const vehicle = createVehicle(getCarSpec('vector'));
  placeVehicle(vehicle, 0, 0.5, 0, 0);
  run(vehicle, IDLE, flatGround, 240);
  const flatY = vehicle.position.y;

  // Put the right hand wheels on the 30 cm pad, the left ones on the flat.
  vehicle.position.x = 0.4;
  vehicle.position.z = 0;
  run(vehicle, IDLE, padGround, 300);

  const left = vehicle.wheels[0];
  const right = vehicle.wheels[1];
  // The car leans onto the raised corner rather than climbing the whole step:
  // the chassis rolls by about the angle of the pad, both sides share the
  // load, and the raised springs are nowhere near bottomed out.
  const roll = new THREE.Euler().setFromQuaternion(vehicle.quaternion, 'XYZ');
  assert.ok(Math.abs(roll.z) > 0.05, `roll ${roll.z}`);
  assert.ok(Math.abs(roll.z) < 0.5, `roll ${roll.z} is too extreme`);
  assert.ok(right.compression < vehicle.spec.maxTravel * 0.7, `right compression ${right.compression}`);
  assert.ok(
    Math.abs(right.compression - left.compression) < 0.05,
    `the two sides should share the load: right ${right.compression} vs left ${left.compression}`,
  );
  assert.ok(vehicle.position.y > flatY - 0.05, `y ${vehicle.position.y}`);
  assert.ok(vehicle.position.y < flatY + 0.24, `the car climbed the step: y ${vehicle.position.y}`);
  // It must not be launched into the air.
  assert.ok(Math.abs(vehicle.velocity.y) < 0.5, `vertical speed ${vehicle.velocity.y}`);
  assert.ok(vehicle.wheels.every((wheel) => wheel.contact), 'every wheel stays in contact');
});

test('driving over a bump does not launch the car', () => {
  const vehicle = createVehicle(getCarSpec('vector'));
  run(vehicle, GAS, flatGround, 240);
  const before = vehicle.position.y;
  // A sharp 25 cm step across the whole road.
  const stepGround = (x, z, out) => {
    const height = z > 0 ? 0.25 : 0;
    out.height = height;
    out.lateral = 0;
    out.onRoad = true;
    out.s = z;
    return height;
  };
  run(vehicle, GAS, stepGround, 120);
  assert.ok(vehicle.position.y - before < 0.6, `the car jumped ${vehicle.position.y - before}`);
  assert.ok(vehicle.velocity.y < 6, `vertical speed ${vehicle.velocity.y}`);
});

test('the handbrake breaks traction and the car recovers', () => {
  const vehicle = createVehicle(getCarSpec('vector'));
  run(vehicle, GAS, flatGround, 600);
  const straight = vehicle.slipAngle;
  run(vehicle, { ...GAS, steer: 0.9, handbrake: true }, flatGround, 90);
  const sliding = Math.abs(vehicle.slipAngle);
  assert.ok(sliding > 0.15, `slip ${sliding}`);
  assert.ok(sliding > Math.abs(straight) + 0.05, 'the slip should grow in the handbrake');
  // Let go and the tyres pull the car back in line.
  run(vehicle, { ...GAS, steer: 0.4 }, flatGround, 240);
  assert.ok(Math.abs(vehicle.slipAngle) < sliding, `slip ${vehicle.slipAngle}`);
});

test('drifting scores points', () => {
  const vehicle = createVehicle(getCarSpec('vector'));
  run(vehicle, GAS, flatGround, 600);
  let peak = 0;
  for (let i = 0; i < 180; i++) {
    stepVehicle(vehicle, { ...GAS, steer: 0.8, handbrake: true }, flatGround, 1 / 120);
    peak = Math.max(peak, vehicle.driftScore);
  }
  assert.ok(peak > 0, `drift score ${peak}`);
});

test('a long simulation stays finite and stable', () => {
  const vehicle = createVehicle(getCarSpec('comet'));
  let maxY = 0;
  for (let i = 0; i < 120 * 90; i++) {
    const phaseStep = i % 900;
    const input =
      phaseStep < 300
        ? GAS
        : phaseStep < 600
          ? { ...GAS, steer: 0.7, handbrake: true }
          : { ...GAS, steer: -0.5, brake: 0.3 };
    stepVehicle(vehicle, input, flatGround, 1 / 120);
    maxY = Math.max(maxY, vehicle.position.y);
    assert.ok(Number.isFinite(vehicle.position.x));
    assert.ok(Number.isFinite(vehicle.position.y));
    assert.ok(Number.isFinite(vehicle.position.z));
    assert.ok(Number.isFinite(vehicle.slipAngle));
    assert.ok(Number.isFinite(vehicle.quaternion.w));
  }
  assert.ok(maxY < 3, `the car kept bouncing, max y ${maxY}`);
});

test('a car on its roof is not fired into the sky', () => {
  const vehicle = createVehicle(getCarSpec('vector'));
  // Land it on its roof, a metre above the flat ground.
  placeVehicle(vehicle, 0, 1, 0, 0);
  vehicle.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  run(vehicle, IDLE, flatGround, 480);

  assert.ok(Number.isFinite(vehicle.position.y), `y ${vehicle.position.y}`);
  // It comes to rest on its roof instead of being launched by its springs.
  assert.ok(vehicle.position.y > -0.2 && vehicle.position.y < 1.6, `y ${vehicle.position.y}`);
  assert.ok(Math.abs(vehicle.velocity.y) < 1.5, `vertical speed ${vehicle.velocity.y}`);
  assert.ok(vehicle.angularVelocity.length() < 2, `spin ${vehicle.angularVelocity.length()}`);
});

test('a rolled car cannot hover on a fully compressed wheel', () => {
  const vehicle = createVehicle(getCarSpec('vector'));
  placeVehicle(vehicle, 0, 0.6, 0, 0);
  // 100 degrees of roll: the wheels no longer point at the ground, so there
  // is no suspension to push the car up with.
  vehicle.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), (100 * Math.PI) / 180);
  run(vehicle, IDLE, flatGround, 480);

  assert.ok(vehicle.position.y < 1.2, `the car is hovering at ${vehicle.position.y}`);
  assert.ok(vehicle.speed < 2, `speed ${vehicle.speed}`);
});

test('drifting off the road never launches the car', async () => {
  const { createRoadProfile, surfaceHeight, roadOffset, roadHeight, roadHeading, roadHalfWidth } = await import(
    '../src/game/road.js'
  );
  const profile = createRoadProfile(20260920);
  const probe = { height: 0, lateral: 0, onRoad: false, s: 0 };
  const groundAt = (x, z, out) => surfaceHeight(profile, x, z, out || probe);
  const vehicle = createVehicle(getCarSpec('vector'));
  placeVehicle(vehicle, roadOffset(profile, 40), roadHeight(profile, 40) + 0.55, 40, roadHeading(profile, 40));

  let maxAltitude = 0;
  let maxUpSpeed = 0;
  let maxDrop = 0;
  let maxSpeed = 0;
  for (let i = 0; i < 120 * 14; i++) {
    const seconds = i / 120;
    // Five seconds of full throttle, then hold the wheel over and keep going:
    // the player drives straight off the road and up the valley wall.
    const input = { steer: seconds < 5 ? 0 : 0.9, throttle: 1, brake: 0, handbrake: false, boost: false };
    stepVehicle(vehicle, input, groundAt, 1 / 120);
    const ground = groundAt(vehicle.position.x, vehicle.position.z, probe);
    const altitude = vehicle.position.y - ground;
    const lateral = Math.abs(vehicle.position.x - roadOffset(profile, vehicle.position.z));
    maxAltitude = Math.max(maxAltitude, altitude);
    // A car nosed into a cliff can have the hill above it; the dip that
    // matters is the one while it is still on or beside the road.
    if (lateral < roadHalfWidth(profile, vehicle.position.z) + 18) {
      maxDrop = Math.min(maxDrop, altitude);
    }
    maxUpSpeed = Math.max(maxUpSpeed, vehicle.velocity.y);
    maxSpeed = Math.max(maxSpeed, vehicle.speed);
    assert.ok(Number.isFinite(vehicle.position.y));
  }

  // The car may catch air over a crest, but it may never climb into the sky.
  assert.ok(maxAltitude < 4, `the car flew ${maxAltitude.toFixed(1)} m above the ground`);
  assert.ok(maxDrop > -0.6, `the body sank ${(-maxDrop).toFixed(2)} m into the ground`);
  assert.ok(maxUpSpeed < 7.6, `the car was thrown up at ${maxUpSpeed.toFixed(1)} m/s`);
  assert.ok(maxSpeed < 60, `the car picked up ${maxSpeed.toFixed(1)} m/s down the hill`);
});

test('the brake pedal reverses the car out of a stop', () => {
  const vehicle = createVehicle(getCarSpec('vector'));
  placeVehicle(vehicle, 0, 0.6, 0, 0);
  run(vehicle, IDLE, flatGround, 120);
  // Hold the brake at a standstill: that is reverse gear.
  run(vehicle, { ...IDLE, brake: 1 }, flatGround, 240);
  assert.ok(vehicle.velocity.z < -2, `speed along the car axis ${vehicle.velocity.z}`);
  assert.ok(vehicle.speed < 16, `reverse should be slow, ${vehicle.speed} m/s`);

  // Let go and the car coasts back to a stop, then the throttle drives it
  // forwards again.
  run(vehicle, GAS, flatGround, 300);
  assert.ok(vehicle.velocity.z > 2, `speed along the car axis ${vehicle.velocity.z}`);
});

test('a car that has spun out can be caught again', () => {
  const vehicle = createVehicle(getCarSpec('vector'));
  placeVehicle(vehicle, 0, 0.6, 0, 0);
  // 20 m/s of travel, the car pointing 150 degrees away from it.
  vehicle.velocity.set(0, 0, 20);
  vehicle.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (150 * Math.PI) / 180);
  run(vehicle, { ...IDLE, throttle: 0.25 }, flatGround, 60);
  assert.ok(Math.abs(vehicle.slipAngle) > 1.4, `slip ${vehicle.slipAngle} should still be a spin`);

  // No heroics: a little throttle and the stability assist swing the car
  // back round instead of leaving it sliding backwards for ever.
  run(vehicle, { ...IDLE, throttle: 0.25 }, flatGround, 240);
  assert.ok(Math.abs(vehicle.slipAngle) < 0.35, `slip ${vehicle.slipAngle} never recovered`);
});
