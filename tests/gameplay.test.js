import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehicle, getCarSpec, placeVehicle, stepVehicle } from '../src/game/vehicle.js';
import {
  createRoadProfile,
  roadOffset,
  roadHeight,
  roadHeading,
  roadHalfWidth,
  surfaceHeight,
} from '../src/game/road.js';
import { clamp, wrapAngle } from '../src/core/math.js';

/**
 * A bot that drives the endless road: it aims the chassis at the road and
 * keeps the speed under control. If a human can do it, the bot can too.
 */
function createBot(profile, spec) {
  const vehicle = createVehicle(spec);
  const s = 40;
  placeVehicle(vehicle, roadOffset(profile, s), roadHeight(profile, s) + 0.55, s, roadHeading(profile, s));

  const probe = { height: 0, lateral: 0, onRoad: false, s: 0 };
  const groundAt = (x, z, out) => surfaceHeight(profile, x, z, out || probe);

  return {
    vehicle,
    groundAt,
    /**
     * @param {number} dt
     */
    drive(dt) {
      const z = vehicle.position.z;
      const centre = roadOffset(profile, z);
      const lateral = vehicle.position.x - centre;
      const heading = roadHeading(profile, z);
      const currentHeading = Math.atan2(
        2 * (vehicle.quaternion.x * vehicle.quaternion.z + vehicle.quaternion.w * vehicle.quaternion.y),
        1 - 2 * (vehicle.quaternion.x * vehicle.quaternion.x + vehicle.quaternion.y * vehicle.quaternion.y),
      );
      const error = wrapAngle(heading - currentHeading);
      // The car faces +Z, so the screen's right is -X: a positive steer input
      // turns the nose towards -X.
      const steer = clamp(-error * 1.6 + lateral * 0.05, -1, 1);
      const targetSpeed = 32;
      const throttle = vehicle.speed < targetSpeed ? 0.7 : 0;
      const brake = vehicle.speed > targetSpeed + 6 ? 0.4 : 0;
      stepVehicle(vehicle, { steer, throttle, brake, handbrake: false, boost: false }, groundAt, dt);
    },
  };
}

test('a bot can drive the endless road without falling off', () => {
  const profile = createRoadProfile(4242);
  const bot = createBot(profile, getCarSpec('vector'));

  let offRoadTime = 0;
  let maxLateral = 0;
  const dt = 1 / 120;
  for (let i = 0; i < 120 * 90; i++) {
    bot.drive(dt);
    const z = bot.vehicle.position.z;
    const lateral = bot.vehicle.position.x - roadOffset(profile, z);
    maxLateral = Math.max(maxLateral, Math.abs(lateral));
    if (Math.abs(lateral) > roadHalfWidth(profile, z)) offRoadTime += dt;
    assert.ok(Number.isFinite(bot.vehicle.position.x));
    assert.ok(Number.isFinite(bot.vehicle.position.z));
  }

  assert.ok(bot.vehicle.position.z > 500, `the bot only reached ${bot.vehicle.position.z} m`);
  assert.ok(offRoadTime < 6, `the bot was off the road for ${offRoadTime.toFixed(1)} s`);
  assert.ok(maxLateral < roadHalfWidth(profile, bot.vehicle.position.z) + 6, `max lateral ${maxLateral}`);
});

test('the bot drives a long way on the same seed for every car', () => {
  for (const id of ['vector', 'comet', 'bulldozer']) {
    const profile = createRoadProfile(99);
    const bot = createBot(profile, getCarSpec(id));
    for (let i = 0; i < 120 * 30; i++) bot.drive(1 / 120);
    assert.ok(bot.vehicle.position.z > 200, `${id} only reached ${bot.vehicle.position.z} m`);
    assert.ok(bot.vehicle.speed > 5, `${id} stopped (${bot.vehicle.speed} m/s)`);
  }
});

test('driving on a hill keeps the wheels on the ground', () => {
  const profile = createRoadProfile(77);
  const bot = createBot(profile, getCarSpec('comet'));
  let maxAirborne = 0;
  for (let i = 0; i < 120 * 60; i++) {
    bot.drive(1 / 120);
    if (i < 240) continue; // the car is still settling onto its suspension
    const grounded = bot.vehicle.wheels.filter((wheel) => wheel.contact).length;
    maxAirborne = Math.max(maxAirborne, 4 - grounded);
  }
  // The car may briefly get light over a crest, but it must not fly.
  assert.ok(maxAirborne <= 2, `the car had ${maxAirborne} wheels off the ground`);
});
