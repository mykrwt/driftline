#!/usr/bin/env node
/**
 * Bench for the driving bot.
 *
 * Runs the autopilot over a number of seeds and reports how far it gets and
 * how much time it spends off the road. It is the fast way to tune the bot
 * without starting the browser.
 *
 *   node tools/bot-bench.mjs [seeds] [seconds]
 */
import { createVehicle, getCarSpec, placeVehicle, stepVehicle } from '../src/game/vehicle.js';
import { createAutopilot } from '../src/game/autopilot.js';
import {
  createRoadProfile,
  roadOffset,
  roadHeight,
  roadHeading,
  roadHalfWidth,
  surfaceHeight,
} from '../src/game/road.js';

const count = Number(process.argv[2] ?? 4);
const seconds = Number(process.argv[3] ?? 90);
const dt = 1 / 120;

let totalOff = 0;
let totalDistance = 0;
let worst = 0;

for (let index = 0; index < count; index++) {
  const seed = 1000 + index * 7919;
  const profile = createRoadProfile(seed);
  const vehicle = createVehicle(getCarSpec('vector'));
  const s = 40;
  placeVehicle(vehicle, roadOffset(profile, s), roadHeight(profile, s) + 0.55, s, roadHeading(profile, s));
  const pilot = createAutopilot(profile);
  const probe = { height: 0, lateral: 0, onRoad: false, s: 0 };
  const groundAt = (x, z, out) => surfaceHeight(profile, x, z, out || probe);

  let off = 0;
  let maxLateral = 0;
  let topSpeed = 0;
  for (let i = 0; i < 120 * seconds; i++) {
    const input = pilot.update(vehicle, dt);
    stepVehicle(vehicle, input, groundAt, dt);
    const z = vehicle.position.z;
    const lateral = vehicle.position.x - roadOffset(profile, z);
    maxLateral = Math.max(maxLateral, Math.abs(lateral));
    topSpeed = Math.max(topSpeed, vehicle.speed);
    if (Math.abs(lateral) > roadHalfWidth(profile, z)) off += dt;
  }
  totalOff += off;
  totalDistance += vehicle.position.z;
  worst = Math.max(worst, maxLateral);
  console.log(
    `seed ${seed}: ${vehicle.position.z.toFixed(0)} m, off road ${off.toFixed(1)} s, ` +
      `max lateral ${maxLateral.toFixed(1)} m, top ${(topSpeed * 3.6).toFixed(0)} km/h`,
  );
}

console.log(
  `average: ${(totalDistance / count).toFixed(0)} m, off road ${(totalOff / count).toFixed(1)} s, worst lateral ${worst.toFixed(1)} m`,
);
