/**
 * The driving bot.
 *
 * It is used for the attract mode on the title screen, for the demo ghosts
 * and for the automated capture runs. It follows the road like a competent
 * driver: it looks ahead, aims at the racing line, eases off for the corners
 * and uses the handbrake only when a hairpin demands it.
 */

import { clamp, wrapAngle } from '../core/math.js';
import { roadOffset, roadHeading, roadCurvature, driftFactor } from './road.js';

/**
 * @typedef {object} AutopilotInput
 * @property {number} steer
 * @property {number} throttle
 * @property {number} brake
 * @property {boolean} handbrake
 * @property {boolean} boost
 */

/**
 * @param {import('./road.js').RoadProfile} profile
 */
export function createAutopilot(profile) {
  /** @type {AutopilotInput} */
  const output = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
  let wander = 0;
  let wanderTarget = 0;
  let wanderTimer = 0;

  /**
   * @param {import('./vehicle.js').VehicleState} vehicle
   * @param {number} dt
   * @returns {AutopilotInput}
   */
  function update(vehicle, dt) {
    const s = vehicle.position.z;
    const speed = vehicle.speed;
    const forwardX = 2 * (vehicle.quaternion.x * vehicle.quaternion.z + vehicle.quaternion.w * vehicle.quaternion.y);
    const forwardZ = 1 - 2 * (vehicle.quaternion.x * vehicle.quaternion.x + vehicle.quaternion.y * vehicle.quaternion.y);
    const heading = Math.atan2(forwardX, forwardZ);

    // --- where do we want to be? ----------------------------------------
    const lookAhead = 9 + speed * 0.42;
    const targetS = s + lookAhead;
    // A slow wander keeps the bot from driving on rails.
    wanderTimer -= dt;
    if (wanderTimer <= 0) {
      wanderTimer = 1.6 + Math.random() * 2.4;
      wanderTarget = (Math.random() - 0.5) * 2.6;
    }
    wander += (wanderTarget - wander) * Math.min(1, dt * 0.9);

    const targetX = roadOffset(profile, targetS) + wander;
    const dx = targetX - vehicle.position.x;
    const dz = targetS - vehicle.position.z;
    const desired = Math.atan2(dx, dz);

    let error = wrapAngle(desired - heading);
    // Counter steer into a slide: the car points where it wants to go.
    if (vehicle.speed > 6) {
      const travel = Math.atan2(vehicle.velocity.x, vehicle.velocity.z);
      error += wrapAngle(travel - heading) * 0.35;
    }
    // The car faces +Z, so its right hand side is -X: a positive steering
    // input turns the heading down, towards -X.
    const steer = clamp(-error * 2.2, -1, 1);

    // --- how fast? -------------------------------------------------------
    // The corner is looked for well in advance so the bot brakes before the
    // turn instead of in the middle of it.
    const curvature = roadCurvature(profile, s + 22 + speed * 1.5);
    const tight = Math.abs(curvature);
    const drift = driftFactor(profile, s);
    let targetSpeed = 31 - tight * 430 + drift * 4;
    targetSpeed = clamp(targetSpeed, 11, 32);
    if (vehicle.airborne > 0.2) targetSpeed = 16;

    const throttle = speed < targetSpeed ? 1 : 0;
    const brake = speed > targetSpeed * 1.08 ? clamp((speed - targetSpeed) / 7, 0, 1) : 0;

    // Only pull the handbrake when the corner is really tight and we are
    // carrying too much speed into it.
    const handbrake = tight > 0.021 && speed > 22 && speed > targetSpeed * 1.3;

    output.steer = steer;
    output.throttle = throttle;
    output.brake = brake;
    output.handbrake = handbrake;
    output.boost = false;
    return output;
  }

  return { update };
}
