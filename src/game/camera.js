/**
 * Chase camera for the vehicle.
 *
 * The camera follows the chassis, not the velocity, so a drift shows the car
 * sideways - but it blends a little of the travel direction so the view stays
 * readable at high slip angles.
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
 */
export function updateCamera(camera, vehicle, dt) {
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

  const back = 7.2 + clamp(speed * 0.035, 0, 2.4);
  const height = 2.9;
  const targetX = position.x - Math.sin(heading) * back;
  const targetZ = position.z - Math.cos(heading) * back;
  const targetY = position.y + height;

  camera.x = damp(camera.x, targetX, 9, dt);
  camera.z = damp(camera.z, targetZ, 9, dt);
  camera.y = damp(camera.y, targetY, 6, dt);

  const lookAhead = 16;
  camera.lookX = damp(camera.lookX, position.x + Math.sin(heading) * lookAhead, 8, dt);
  camera.lookZ = damp(camera.lookZ, position.z + Math.cos(heading) * lookAhead, 8, dt);
  camera.lookY = damp(camera.lookY, position.y + 1.4, 5, dt);

  const speedRatio = clamp(speed / 70, 0, 1);
  camera.fov = damp(camera.fov, 62 + speedRatio * 15 + (vehicle.boosting ? 4 : 0), 4, dt);
  // A touch of roll from the lateral acceleration.
  const lateral = velocity.x * Math.cos(heading) - velocity.z * Math.sin(heading);
  camera.roll = damp(camera.roll, clamp(-lateral * 0.006, -0.07, 0.07), 5, dt);
}

/**
 * @param {CameraState} camera
 * @param {number} amount
 */
export function kickCamera(camera, amount) {
  camera.shake = Math.min(1.5, camera.shake + amount);
}
