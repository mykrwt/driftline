/**
 * Car physics.
 *
 * The model is an arcade drift model, the kind that feels good with a keyboard
 * or a thumb:
 *
 *   - The car has a velocity direction and a nose. The nose is offset from the
 *     velocity by the slip angle, and that offset is what you see as a drift.
 *   - Steering rotates the velocity direction; the slip angle follows a target
 *     that the handbrake pushes much further out and the tyres pull back in.
 *   - Because the slip is a target and not an emergent force, the car never
 *     spins out - it drifts exactly as much as you ask for.
 *
 * Everything is a plain object plus pure functions so the simulation can be
 * unit tested in Node without a browser.
 */

import { clamp, sign, damp, wrapAngle } from '../core/math.js';
import { projectToTrack, sampleTrack, terrainHeightAt } from './track.js';

/**
 * @typedef {object} CarConfig
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {string} accent
 * @property {number} maxSpeed      m/s
 * @property {number} accel         m/s^2 at low speed
 * @property {number} brake         m/s^2
 * @property {number} steerRate     rad/s the velocity direction turns
 * @property {number} maxSlip       radians of slip the handbrake can reach
 * @property {number} grip          how fast the slip returns to normal
 * @property {number} boostPower    extra acceleration while boosting
 * @property {number} driftBonus    multiplier on drift score
 * @property {string} assetKey     key in the asset library
 * @property {string} description
 */

/** @type {CarConfig[]} */
export const CARS = [
  {
    id: 'vector',
    name: 'Vector GT',
    color: '#ff3f6d',
    accent: '#ffd166',
    maxSpeed: 74,
    accel: 17.5,
    brake: 28,
    steerRate: 1.85,
    maxSlip: 0.5,
    grip: 7.5,
    boostPower: 12,
    driftBonus: 1,
    assetKey: 'vector',
    description: 'Balanced street machine. Quick, forgiving, drifts forever.',
  },
  {
    id: 'comet',
    name: 'Comet RS',
    color: '#31d6ff',
    accent: '#e9fbff',
    maxSpeed: 82,
    accel: 15.2,
    brake: 26,
    steerRate: 1.7,
    maxSlip: 0.46,
    grip: 6.4,
    boostPower: 15,
    driftBonus: 1.15,
    assetKey: 'comet',
    description: 'Top end bruiser. Long straights, twitchy rear end.',
  },
  {
    id: 'bulldozer',
    name: 'Bulldozer V8',
    color: '#ffa02b',
    accent: '#fff3d6',
    maxSpeed: 66,
    accel: 20.5,
    brake: 30,
    steerRate: 1.6,
    maxSlip: 0.56,
    grip: 8.4,
    boostPower: 10,
    driftBonus: 1.35,
    assetKey: 'bulldozer',
    description: 'Heavy, planted, huge drift points. Slow in a straight line.',
  },
];

/**
 * @param {string} id
 * @returns {CarConfig}
 */
export function getCarConfig(id) {
  return CARS.find((c) => c.id === id) || CARS[0];
}

/**
 * @typedef {object} CarState
 * @property {number} x
 * @property {number} z
 * @property {number} heading      absolute heading of the nose
 * @property {number} velAngle     absolute heading of the travel direction
 * @property {number} speed        forward speed, m/s
 * @property {number} slip         nose angle relative to travel, radians
 * @property {number} distance     metres travelled along the lap
 * @property {number} offset       lateral offset from the centre line
 * @property {number} y            height of the surface under the car
 * @property {number} totalDistance
 * @property {boolean} onRoad
 * @property {boolean} drifting
 * @property {number} driftTime
 * @property {number} driftScore
 * @property {number} driftMultiplier
 * @property {number} bestDrift
 * @property {number} boostFuel    0..1
 * @property {boolean} boosting
 * @property {number} wheelAngle   visual steering angle
 * @property {number} suspension   visual body roll
 */

/**
 * @param {CarConfig} config
 * @returns {CarState}
 */
export function createCarState(config) {
  return {
    x: 0,
    z: 0,
    heading: 0,
    velAngle: 0,
    speed: 0,
    slip: 0,
    distance: 0,
    offset: 0,
    y: 0,
    totalDistance: 0,
    onRoad: true,
    drifting: false,
    driftTime: 0,
    driftScore: 0,
    driftMultiplier: 1,
    bestDrift: 0,
    boostFuel: 0.35,
    boosting: false,
    wheelAngle: 0,
    suspension: 0,
  };
}

/**
 * Place a car on the track centre line.
 * @param {CarState} state
 * @param {import('./track.js').Track} track
 * @param {number} distance
 * @param {number} [offset]
 */
export function placeCar(state, track, distance, offset = 0) {
  const sample = sampleTrack(track, distance);
  const nx = Math.cos(sample.heading);
  const nz = -Math.sin(sample.heading);
  state.x = sample.x + nx * offset;
  state.z = sample.z + nz * offset;
  state.heading = sample.heading;
  state.velAngle = sample.heading;
  state.speed = 0;
  state.slip = 0;
  state.distance = distance;
  state.offset = offset;
  state.drifting = false;
  state.driftTime = 0;
}

/**
 * Advance the car by one fixed step.
 *
 * @param {CarState} state
 * @param {import('./track.js').Track} track
 * @param {CarConfig} config
 * @param {{steer: number, throttle: number, brake: number, handbrake: boolean, boost: boolean}} input
 * @param {number} dt
 */
export function stepCar(state, track, config, input, dt) {
  const steer = clamp(input.steer, -1, 1);
  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);
  const handbrake = Boolean(input.handbrake);

  // --- where are we on the track? ---------------------------------------
  const projection = projectToTrack(track, state.x, state.z);
  state.distance = projection.distance;
  state.offset = projection.offset;
  const halfWidth = 7.2;
  state.onRoad = Math.abs(state.offset) - halfWidth <= 0;
  const roadSample = sampleTrack(track, state.distance);
  state.y = state.onRoad ? roadSample.y : terrainHeightAt(track, state.distance, state.offset);

  const speedRatio = clamp(state.speed / config.maxSpeed, 0, 1);
  // How much the car can rotate at this speed.
  const agility = clamp(state.speed / 12, 0, 1);

  // --- slip angle -------------------------------------------------------
  // Cornering without the handbrake gives a small slip, the handbrake lets
  // the rear end step out to the full drift angle.
  const driftReach = config.maxSlip * (handbrake ? 1 : 0.16);
  const targetSlip = steer * driftReach * agility;
  // The handbrake breaks traction (slow to build and slow to release), the
  // tyres snap the car back straight.
  const slipRate = handbrake ? 2.6 : config.grip;
  state.slip = damp(state.slip, targetSlip, slipRate, dt);

  // --- direction --------------------------------------------------------
  // The velocity turns with the steering input; the handbrake makes the car
  // rotate a touch less, so it slides wide through the corner.
  // A big slip angle also eats into the turning authority - that is what
  // lets a drift follow the road instead of spiralling off it.
  const slipRatio = clamp(Math.abs(state.slip) / (config.maxSlip * Math.max(0.25, agility)), 0, 1);
  const authority = 1 - 0.55 * slipRatio;
  const turnRate = config.steerRate * (handbrake ? 0.9 : 1) * (1 - 0.3 * speedRatio);
  state.velAngle = wrapAngle(state.velAngle + steer * turnRate * agility * authority * dt);

  // Steering assist: with the wheel straight the car gently follows the road
  // instead of wandering off, but as soon as the player steers the car goes
  // exactly where they point it.
  if (state.onRoad) {
    const align = wrapAngle(roadSample.heading - state.velAngle);
    const assist = 0.9 * (1 - Math.abs(steer)) * agility;
    state.velAngle = wrapAngle(state.velAngle + align * assist * dt);
  }

  state.heading = wrapAngle(state.velAngle + state.slip);
  state.wheelAngle = damp(state.wheelAngle, steer * 0.42, 14, dt);

  // --- longitudinal -----------------------------------------------------
  const torqueCurve = 1 - clamp(state.speed / config.maxSpeed, 0, 1) ** 1.6;
  const boosting = Boolean(input.boost) && state.boostFuel > 0.01;
  state.speed += (throttle * (config.accel * torqueCurve + (boosting ? config.boostPower : 0))) * dt;

  if (brake > 0) {
    state.speed -= sign(state.speed) * config.brake * brake * dt;
  }
  state.speed -= state.speed * (0.016 + 0.00022 * state.speed) * dt;
  if (throttle < 0.02) {
    state.speed -= sign(state.speed) * 2.6 * dt; // engine braking
  }
  if (!state.onRoad) {
    state.speed -= sign(state.speed) * 9 * dt;
  }
  state.speed = clamp(state.speed, -12, config.maxSpeed * (boosting ? 1.16 : 1));

  if (boosting) {
    state.boostFuel = Math.max(0, state.boostFuel - 0.34 * dt);
  } else {
    state.boostFuel = Math.min(1, state.boostFuel + (state.onRoad ? 0.012 : 0.004) * dt);
  }
  state.boosting = boosting && throttle > 0.1;

  // --- move -------------------------------------------------------------
  const vx = Math.sin(state.velAngle) * state.speed;
  const vz = Math.cos(state.velAngle) * state.speed;
  state.x += vx * dt;
  state.z += vz * dt;
  state.totalDistance += Math.abs(state.speed) * dt;

  // --- drift scoring ----------------------------------------------------
  const slipMagnitude = Math.abs(state.slip);
  const drifting = slipMagnitude > 0.16 && state.speed > 9 && state.onRoad;
  if (drifting) {
    state.driftTime += dt;
    state.driftMultiplier = Math.min(5, 1 + Math.floor(state.driftTime / 1.15));
    const rate = slipMagnitude * state.speed * 9 * state.driftMultiplier * config.driftBonus;
    state.driftScore += rate * dt;
    // Drifting is what refills the boost.
    state.boostFuel = Math.min(1, state.boostFuel + rate * 0.00035 * dt);
  } else {
    state.driftTime = Math.max(0, state.driftTime - dt * 2.4);
    state.driftMultiplier = Math.max(1, 1 + Math.floor(state.driftTime / 1.15));
    if (state.driftTime <= 0) {
      state.bestDrift = Math.max(state.bestDrift, state.driftScore);
      state.driftScore = 0;
    }
  }
  state.drifting = drifting;

  // --- cosmetic body movement ------------------------------------------
  const targetRoll = clamp(-state.slip * 0.5, -0.3, 0.3);
  state.suspension = damp(state.suspension, targetRoll, 9, dt);
}
