/**
 * Chase camera.
 *
 * The camera follows the road rather than the car, so a big drift shows the
 * car sideways - the classic outrun look - while still feeling connected.
 * Pure math, no Three.js: the renderer applies the result to its camera.
 */

import { clamp, damp, wrapAngle } from '../core/math.js';
import { sampleTrack } from './track.js';

/**
 * @typedef {object} CameraState
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} lookX
 * @property {number} lookY
 * @property {number} lookZ
 * @property {number} fov
 * @property {number} roll
 * @property {number} shake
 */

/**
 * @returns {CameraState}
 */
export function createCamera() {
  return {
    x: 0,
    y: 3,
    z: 0,
    lookX: 0,
    lookY: 1,
    lookZ: 10,
    fov: 62,
    roll: 0,
    shake: 0,
  };
}

/**
 * @param {CameraState} camera
 * @param {import('./physics.js').CarState} car
 * @param {import('./track.js').Track} track
 * @param {number} dt
 * @param {{ back?: number, height?: number, follow?: number, lookAhead?: number }} [options]
 */
export function updateCamera(camera, car, track, dt, options = {}) {
  const back = options.back ?? 7.6;
  const height = options.height ?? 2.7;
  const follow = options.follow ?? 0.45;
  const lookAhead = options.lookAhead ?? 16;

  const sample = sampleTrack(track, car.distance);
  const driftAngle = wrapAngle(car.heading - sample.heading);
  // Mostly follow the road, partially the car: enough to feel the drift.
  const desiredHeading = sample.heading + driftAngle * follow;

  const sinH = Math.sin(desiredHeading);
  const cosH = Math.cos(desiredHeading);
  const targetX = car.x - sinH * back;
  const targetZ = car.z - cosH * back;
  const ground = car.y ?? sample.y;

  camera.x = damp(camera.x, targetX, 11, dt);
  camera.z = damp(camera.z, targetZ, 11, dt);
  camera.y = damp(camera.y, ground + height, 7, dt);

  // Look at a point down the road ahead of the car.
  const lookHeading = sample.heading + driftAngle * 0.7;
  camera.lookX = damp(camera.lookX, car.x + Math.sin(lookHeading) * lookAhead, 9, dt);
  camera.lookZ = damp(camera.lookZ, car.z + Math.cos(lookHeading) * lookAhead, 9, dt);
  camera.lookY = damp(camera.lookY, ground + 1.6, 6, dt);
  const speedRatio = clamp(car.speed / 70, 0, 1);
  // A wider lens at speed is the cheapest, best feeling speed effect there is.
  camera.fov = damp(camera.fov, 62 + speedRatio * 15 + (car.boosting ? 4 : 0), 4, dt);
  camera.roll = damp(camera.roll, clamp(-car.slip * 0.1, -0.08, 0.08), 5, dt);

  // Off-road rumble keeps the camera alive.
  const rumble = car.onRoad ? 0 : Math.min(1, car.speed / 40) * 0.5;
  camera.shake = Math.max(camera.shake * Math.exp(-6 * dt), rumble);
}

/**
 * Add a one-off camera kick (collisions, boost).
 * @param {CameraState} camera
 * @param {number} amount
 */
export function kickCamera(camera, amount) {
  camera.shake = Math.min(1.5, camera.shake + amount);
}
