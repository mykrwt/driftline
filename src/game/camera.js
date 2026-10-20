/**
 * Chase camera for the vehicle.
 *
 * The camera follows the chassis, not the velocity, so a drift shows the car
 * sideways - but it blends a little of the travel direction so the view stays
 * readable at high slip angles.
 *
 * It also sits high enough to see the road ahead, pulls back and widens with
 * the speed, and leans into the corner, which is what makes a driving game
 * feel fast.
 */

import { clamp, damp, wrapAngle } from '../core/math.js';

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
    y: 4,
    z: -8,
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
 * @param {import('./vehicle.js').VehicleState} vehicle
 * @param {number} dt
 * @param {boolean} [immediate] snap instead of easing (used on spawn)
 */
export function updateCamera(camera, vehicle, dt, immediate = false) {
  const { position, quaternion, velocity, speed } = vehicle;

  // The chassis forward direction in the XZ plane.
  const forwardX = 2 * (quaternion.x * quaternion.z + quaternion.w * quaternion.y);
  const forwardZ = 1 - 2 * (quaternion.x * quaternion.x + quaternion.y * quaternion.y);
  let heading = Math.atan2(forwardX, forwardZ);

  // Blend a little of the travel direction so a big drift reads clearly.
  const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
  if (horizontalSpeed > 3) {
    const travel = Math.atan2(velocity.x, velocity.z);
    heading += wrapAngle(travel - heading) * 0.22;
  }

  const speedRatio = clamp(speed / 62, 0, 1);
  // The camera pulls back and rises a little with the speed.
  const back = 8.4 + speedRatio * 3.2;
  const height = 3.35 + speedRatio * 0.55;
  const targetX = position.x - Math.sin(heading) * back;
  const targetZ = position.z - Math.cos(heading) * back;
  const targetY = position.y + height;

  // Look ahead down the road, not at the car: that keeps the corner in
  // frame and makes the car feel like it is going somewhere.
  const lookAhead = 17 + speedRatio * 16;
  const lookX = position.x + Math.sin(heading) * lookAhead;
  const lookZ = position.z + Math.cos(heading) * lookAhead;
  const lookY = position.y + 1.25 - speedRatio * 0.4;

  if (immediate) {
    camera.x = targetX;
    camera.y = targetY;
    camera.z = targetZ;
    camera.lookX = lookX;
    camera.lookY = lookY;
    camera.lookZ = lookZ;
    return;
  }

  camera.x = damp(camera.x, targetX, 7.5, dt);
  camera.z = damp(camera.z, targetZ, 7.5, dt);
  camera.y = damp(camera.y, targetY, 5, dt);

  camera.lookX = damp(camera.lookX, lookX, 6.5, dt);
  camera.lookZ = damp(camera.lookZ, lookZ, 6.5, dt);
  camera.lookY = damp(camera.lookY, lookY, 4.5, dt);

  camera.fov = damp(camera.fov, 60 + speedRatio * 16 + (vehicle.boosting ? 5 : 0), 4, dt);
  // A touch of roll from the lateral acceleration.
  const lateral = velocity.x * Math.cos(heading) - velocity.z * Math.sin(heading);
  camera.roll = damp(camera.roll, clamp(-lateral * 0.005, -0.06, 0.06), 5, dt);
}

/**
 * @param {CameraState} camera
 * @param {number} amount
 */
export function kickCamera(camera, amount) {
  camera.shake = Math.min(1.5, camera.shake + amount);
}
