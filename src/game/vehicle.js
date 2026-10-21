/**
 * Rigid body vehicle physics.
 *
 * The car is a proper chassis with mass and inertia. Every wheel has its own
 * raycast against the terrain, its own spring and damper, and its own tyre
 * forces. That is what makes the car behave believably on uneven ground:
 *
 *   - a wheel that rolls over a rock compresses on its own and the chassis
 *     tilts around it, instead of the whole car being pushed into the air;
 *   - weight transfer, body roll and pitch emerge from the suspension forces;
 *   - the tyres run out of grip, the car slides, and counter steering brings
 *     it back - exactly like a real car.
 *
 * The simulation runs on a fixed step and knows nothing about rendering.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { clamp, sign } from '../core/math.js';

const GRAVITY = 9.81;
/** The fastest a car may be thrown upwards, in metres per second. */
const MAX_LAUNCH = 16;
/** The fastest a car may fall, in metres per second. */
const MAX_FALL = 70;
/** The fastest the chassis may spin, in radians per second. */
const MAX_SPIN = 9;

/**
 * @typedef {object} WheelSpec
 * @property {number} x
 * @property {number} z
 * @property {number} radius
 * @property {boolean} front
 * @property {boolean} driven
 */

/**
 * @typedef {object} CarSpec
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {string} accent
 * @property {string} assetKey
 * @property {number} mass            kg
 * @property {number} wheelbase       m
 * @property {number} trackWidth      m
 * @property {number} cgHeight        m
 * @property {number} engineForce     N of tractive force at full throttle
 * @property {number} maxSpeed        m/s
 * @property {number} brakeTorque     Nm
 * @property {number} gripFront       friction coefficient
 * @property {number} gripRear
 * @property {number} peakSlip        rad, slip angle at peak grip
 * @property {number} suspensionRest  m
 * @property {number} suspensionK     N/m
 * @property {number} suspensionC     Ns/m
 * @property {number} maxTravel       m
 * @property {number} downforce
 * @property {number} driftBonus
 * @property {string} description
 */

/** @type {Record<string, CarSpec>} */
export const CAR_SPECS = {
  vector: {
    id: 'vector',
    name: 'Vector GT',
    color: '#ff3f6d',
    accent: '#ffd166',
    assetKey: 'vector',
    mass: 1240,
    wheelbase: 2.62,
    trackWidth: 1.58,
    cgHeight: 0.5,
    engineForce: 9600,
    maxSpeed: 74,
    brakeTorque: 2600,
    gripFront: 1.12,
    gripRear: 1.16,
    peakSlip: 0.16,
    suspensionRest: 0.34,
    suspensionK: 46000,
    suspensionC: 5200,
    maxTravel: 0.24,
    downforce: 0.35,
    driftBonus: 1,
    description: 'Balanced street car. Quick, forgiving, easy to hold a slide.',
  },
  comet: {
    id: 'comet',
    name: 'Comet RS',
    color: '#31d6ff',
    accent: '#e9fbff',
    assetKey: 'comet',
    mass: 1180,
    wheelbase: 2.55,
    trackWidth: 1.66,
    cgHeight: 0.44,
    engineForce: 10800,
    maxSpeed: 82,
    brakeTorque: 2900,
    gripFront: 1.18,
    gripRear: 1.1,
    peakSlip: 0.14,
    suspensionRest: 0.3,
    suspensionK: 52000,
    suspensionC: 4800,
    maxTravel: 0.2,
    downforce: 0.9,
    driftBonus: 1.15,
    description: 'Mid engine racer. Huge power, sharp rear end, snappy.',
  },
  bulldozer: {
    id: 'bulldozer',
    name: 'Bulldozer V8',
    color: '#ffa02b',
    accent: '#fff3d6',
    assetKey: 'bulldozer',
    mass: 1680,
    wheelbase: 3.05,
    trackWidth: 1.78,
    cgHeight: 0.72,
    engineForce: 9200,
    maxSpeed: 64,
    brakeTorque: 3400,
    gripFront: 1.0,
    gripRear: 1.05,
    peakSlip: 0.19,
    suspensionRest: 0.42,
    suspensionK: 58000,
    suspensionC: 7200,
    maxTravel: 0.3,
    downforce: 0.2,
    driftBonus: 1.35,
    description: 'Heavy V8 truck. Plants itself, slides wide, scores big.',
  },
};

/**
 * @typedef {object} WheelState
 * @property {WheelSpec} spec
 * @property {THREE.Vector3} local     attachment point in chassis space
 * @property {number} compression        0..maxTravel
 * @property {number} prevCompression
 * @property {boolean} contact
 * @property {number} load               normal force in N
 * @property {number} slipAngle
 * @property {number} slipRatio
 * @property {number} spin               wheel angular velocity, rad/s
 * @property {number} steer
 * @property {THREE.Vector3} contactPoint
 * @property {THREE.Vector3} contactNormal
 * @property {boolean} onRoad
 * @property {number} lateralSlipSpeed
 */

/**
 * @typedef {object} VehicleState
 * @property {THREE.Vector3} position
 * @property {THREE.Vector3} velocity
 * @property {THREE.Quaternion} quaternion
 * @property {THREE.Vector3} angularVelocity
 * @property {CarSpec} spec
 * @property {WheelState[]} wheels
 * @property {number} speed
 * @property {number} slipAngle
 * @property {boolean} drifting
 * @property {number} driftScore
 * @property {number} driftTime
 * @property {number} driftMultiplier
 * @property {number} bestDrift
 * @property {number} boostFuel
 * @property {boolean} boosting
 * @property {number} wheelAngle
 * @property {number} airborne
 * @property {number} rpm
 * @property {number} gear
 * @property {number} odometer
 */

/**
 * @param {string} id
 * @returns {CarSpec}
 */
export function getCarSpec(id) {
  return CAR_SPECS[id] || CAR_SPECS.vector;
}

/**
 * @param {CarSpec} spec
 * @returns {VehicleState}
 */
export function createVehicle(spec) {
  const halfBase = spec.wheelbase / 2;
  const halfTrack = spec.trackWidth / 2;
  const radius = 0.34;
  /** @type {WheelSpec[]} */
  const wheelSpecs = [
    { x: -halfTrack, z: halfBase, radius, front: true, driven: false },
    { x: halfTrack, z: halfBase, radius, front: true, driven: false },
    { x: -halfTrack, z: -halfBase, radius, front: false, driven: true },
    { x: halfTrack, z: -halfBase, radius, front: false, driven: true },
  ];

  const wheels = wheelSpecs.map((wheelSpec) => ({
    spec: wheelSpec,
    // The strut top sits just above the centre of mass.
    local: new THREE.Vector3(wheelSpec.x, 0.1, wheelSpec.z),
    compression: 0,
    prevCompression: 0,
    contact: false,
    load: 0,
    slipAngle: 0,
    slipRatio: 0,
    spin: 0,
    steer: 0,
    contactPoint: new THREE.Vector3(),
    contactNormal: new THREE.Vector3(0, 1, 0),
    onRoad: false,
    lateralSlipSpeed: 0,
  }));

  return {
    position: new THREE.Vector3(0, spec.suspensionRest + 0.4, 0),
    velocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    angularVelocity: new THREE.Vector3(),
    spec,
    wheels,
    speed: 0,
    slipAngle: 0,
    drifting: false,
    braking: false,
    driftScore: 0,
    driftTime: 0,
    driftMultiplier: 1,
    bestDrift: 0,
    boostFuel: 0.4,
    boosting: false,
    wheelAngle: 0,
    airborne: 0,
    rpm: 0.15,
    gear: 1,
    odometer: 0,
  };
}

/**
 * @param {VehicleState} state
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} heading
 */
export function placeVehicle(state, x, y, z, heading) {
  state.position.set(x, y, z);
  state.velocity.set(0, 0, 0);
  state.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
  state.angularVelocity.set(0, 0, 0);
  for (const wheel of state.wheels) {
    wheel.compression = 0;
    wheel.prevCompression = 0;
    wheel.spin = 0;
    wheel.load = 0;
  }
}

// Scratch vectors, reused to avoid allocations in the hot loop.
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _wheelWorld = new THREE.Vector3();
const _ray = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _contactVel = new THREE.Vector3();
const _force = new THREE.Vector3();
const _torque = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _steerDir = new THREE.Vector3();
const _sideDir = new THREE.Vector3();
const _local = new THREE.Vector3();
const _bodyTorque = new THREE.Vector3();
const _bodyOmega = new THREE.Vector3();
const _inertia = new THREE.Vector3();
const _quaternionDelta = new THREE.Quaternion();

/**
 * @typedef {object} VehicleInput
 * @property {number} steer   -1..1
 * @property {number} throttle 0..1
 * @property {number} brake   0..1
 * @property {boolean} handbrake
 * @property {boolean} boost
 */

/**
 * Advance the vehicle by one fixed step.
 *
 * @param {VehicleState} state
 * @param {VehicleInput} input
 * @param {(x: number, z: number, out: { height: number, lateral: number, onRoad: boolean, s: number }) => number} groundAt
 * @param {number} dt
 */
export function stepVehicle(state, input, groundAt, dt) {
  const spec = state.spec;
  const steerInput = clamp(input.steer, -1, 1);
  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);
  const handbrake = Boolean(input.handbrake);
  // The brake lights and the tyre squeal follow the brake pedal.
  state.braking = brake > 0.05 || handbrake;

  // Chassis basis.
  _right.set(1, 0, 0).applyQuaternion(state.quaternion);
  _up.set(0, 1, 0).applyQuaternion(state.quaternion);
  _forward.set(0, 0, 1).applyQuaternion(state.quaternion);

  const totalForce = _force.set(0, -GRAVITY * spec.mass, 0);
  const totalTorque = _torque.set(0, 0, 0);

  // ------------------------------------------------------------- steering
  const speed = state.velocity.length();
  const forwardSpeed = state.velocity.dot(_forward);
  // Less steering lock at speed, like a real rack.
  const maxSteer = 0.52 / (1 + Math.abs(forwardSpeed) * 0.022);
  const steerAngle = steerInput * maxSteer;
  state.wheelAngle += (steerAngle - state.wheelAngle) * Math.min(1, dt * 12);

  // ---------------------------------------------------------------- wheels
  let groundedCount = 0;
  let rearSlip = 0;
  let rearLoad = 0;
  let driveTorque = 0;

  for (const wheel of state.wheels) {
    // Attachment point in world space.
    _wheelWorld.copy(wheel.local).applyQuaternion(state.quaternion).add(state.position);

    // Raycast straight down along the chassis axis.
    _ray.copy(_up).multiplyScalar(-1);
    let t = 0;
    if (_ray.y < -0.25) {
      const probe = { height: 0, lateral: 0, onRoad: false, s: 0 };
      const guess = groundAt(_wheelWorld.x, _wheelWorld.z, probe);
      t = (_wheelWorld.y - guess) / -_ray.y;
      // One refinement pass: the contact point moves as the ray travels.
      _hit.copy(_wheelWorld).addScaledVector(_ray, Math.max(0, t));
      const refined = groundAt(_hit.x, _hit.z, probe);
      t = (_wheelWorld.y - refined) / -_ray.y;
    }
    const maxT = spec.suspensionRest + spec.maxTravel + wheel.spec.radius;
    wheel.contact = t > -0.02 && t < maxT;
    if (!wheel.contact) {
      wheel.compression = 0;
      wheel.prevCompression = 0;
      wheel.load = 0;
      wheel.spin *= 1 - dt * 0.4;
      groundedCount += 0;
      continue;
    }
    groundedCount++;

    _hit.copy(_wheelWorld).addScaledVector(_ray, t);
    wheel.contactPoint.copy(_hit);

    // Suspension: the spring pushes the chassis up along the contact normal.
    const probe = { height: 0, lateral: 0, onRoad: false, s: 0 };
    groundAt(_hit.x, _hit.z, probe);
    wheel.onRoad = probe.onRoad;
    const groundNormal = surfaceNormalFor(probe, _normal);

    const springLength = t - wheel.spec.radius;
    const compression = clamp(spec.suspensionRest - springLength, 0, spec.maxTravel);
    const compressionRate = (compression - wheel.prevCompression) / dt;
    wheel.prevCompression = wheel.compression;
    wheel.compression = compression;

    let normalForce = spec.suspensionK * compression + spec.suspensionC * clamp(compressionRate, -0.9, 0.9);
    // Bump stop: the last centimetres of travel are stiffer, but not a wall.
    if (compression > spec.maxTravel * 0.9) {
      normalForce += (compression - spec.maxTravel * 0.9) * spec.suspensionK * 2.5;
    }
    // A hard cap keeps a sharp step from launching the car.
    normalForce = Math.min(normalForce, spec.mass * 9.81 * 1.6);
    normalForce = Math.max(0, normalForce);
    wheel.load = normalForce;

    _tmp.copy(groundNormal).multiplyScalar(normalForce);
    totalForce.add(_tmp);
    _tmp2.copy(_hit).sub(state.position);
    totalTorque.add(_tmp2.cross(_tmp));

    // ------------------------------------------------------- tyre forces
    const contactOffset = _tmp2.copy(_hit).sub(state.position);
    _contactVel.copy(state.angularVelocity).cross(contactOffset).add(state.velocity);

    // Wheel frame projected on the ground plane. The car faces +Z, so its
    // right hand side is -X.
    if (wheel.spec.front) {
      _steerDir.copy(_forward).applyAxisAngle(_up, -steerAngle);
    } else {
      _steerDir.copy(_forward);
    }
    _steerDir.addScaledVector(groundNormal, -_steerDir.dot(groundNormal)).normalize();
    _sideDir.copy(_steerDir).cross(groundNormal).normalize();

    const forwardVel = _contactVel.dot(_steerDir);
    const lateralVel = _contactVel.dot(_sideDir);
    wheel.lateralSlipSpeed = lateralVel;

    const surfaceGrip = wheel.onRoad ? 1 : 0.62;
    const handbrakeRear = handbrake && !wheel.spec.front;
    // A locked rear wheel loses most of its lateral grip - that is what makes
    // the handbrake break the rear loose.
    const mu =
      (wheel.spec.front ? spec.gripFront : spec.gripRear) *
      surfaceGrip *
      (handbrakeRear ? 0.45 : 1);

    // Load sensitive grip: a heavily loaded tyre gives a bit more grip.
    const load = normalForce;
    const maxLateral = mu * load;

    // Slip angle and the tyre curve: grip builds up to the peak, then falls
    // away so an over angled car can be caught again.
    const slipAngle = Math.atan2(lateralVel, Math.abs(forwardVel) + 1.2);
    wheel.slipAngle = slipAngle;
    const normalized = Math.abs(slipAngle) / spec.peakSlip;
    const shape =
      normalized <= 1
        ? Math.sin((normalized * Math.PI) / 2)
        : Math.max(0.32, 1 - (normalized - 1) * 0.42);
    let lateralForce = -maxLateral * shape * Math.sign(slipAngle);

    // Longitudinal: engine torque and brakes act on the wheel, the ground
    // reacts through the friction circle.
    const wheelInertia = 1.35;
    if (wheel.spec.driven && !handbrake) {
      const drive = (throttle * spec.engineForce * gearFactor(state, forwardSpeed)) / 2;
      const torqueAtWheel = drive * wheel.spec.radius;
      wheel.spin += (torqueAtWheel / wheelInertia) * dt;
    }
    if (handbrakeRear) {
      wheel.spin *= 1 - Math.min(1, dt * 30);
    }
    if (brake > 0) {
      const brakeTorque = spec.brakeTorque * brake * (wheel.spec.front ? 0.62 : 0.38);
      const brakeDelta = (brakeTorque / wheelInertia) * dt;
      wheel.spin -= Math.min(Math.abs(wheel.spin), brakeDelta) * sign(wheel.spin);
    }
    if (!wheel.spec.driven) {
      // Free rolling wheel: the engine is off, the ground spins it up.
      const rollSpeed = forwardVel / wheel.spec.radius;
      wheel.spin += (rollSpeed - wheel.spin) * Math.min(1, dt * 14);
    }

    const wheelSurfaceSpeed = wheel.spin * wheel.spec.radius;
    const slipRatio = clamp((wheelSurfaceSpeed - forwardVel) / Math.max(2.5, Math.abs(forwardVel)), -1, 1);
    wheel.slipRatio = slipRatio;

    // The friction circle: longitudinal force uses whatever grip is left.
    const used = Math.abs(lateralForce);
    const longMax = Math.sqrt(Math.max(0, maxLateral * maxLateral - used * used));
    let longitudinalForce = mu * load * Math.tanh(slipRatio * 4.5) * 0.95;
    longitudinalForce = clamp(longitudinalForce, -longMax, longMax);
    // The reaction torque from the ground slows the wheel down.
    wheel.spin -= (longitudinalForce * wheel.spec.radius * dt) / wheelInertia;

    _tmp.copy(_steerDir).multiplyScalar(longitudinalForce);
    _tmp.addScaledVector(_sideDir, lateralForce);
    totalForce.add(_tmp);
    totalTorque.add(contactOffset.cross(_tmp));

    if (!wheel.spec.front) {
      rearSlip += Math.abs(slipAngle);
      rearLoad += load;
    }
  }

  // --- stability assist -------------------------------------------------
  // Like the traction control of a modern car: past a certain slip angle the
  // chassis is nudged back towards its travel direction, so a drift can be
  // held and caught instead of turning into a spin.
  const horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.z);
  const slipMagnitude = Math.abs(state.slipAngle);
  if (slipMagnitude > 0.48 && horizontalSpeed > 4) {
    const excess = slipMagnitude - 0.48;
    const assist = -Math.sign(state.slipAngle) * excess * 14000;
    totalTorque.addScaledVector(_up, assist);
  }

  // ------------------------------------------------------------- integrate
  const acceleration = _tmp.copy(totalForce).multiplyScalar(1 / spec.mass);
  state.velocity.addScaledVector(acceleration, dt);
  state.position.addScaledVector(state.velocity, dt);

  // Angular integration in the body frame with a diagonal inertia tensor.
  _bodyTorque.copy(totalTorque).applyQuaternion(_quaternionDelta.copy(state.quaternion).invert());
  _bodyOmega.copy(state.angularVelocity).applyQuaternion(_quaternionDelta);
  const mass = spec.mass;
  _inertia.set(
    mass * 0.32,
    mass * 2.05,
    mass * 2.4,
  );
  const gyroX = _bodyOmega.y * _bodyOmega.z * (_inertia.z - _inertia.y);
  const gyroY = _bodyOmega.z * _bodyOmega.x * (_inertia.x - _inertia.z);
  const gyroZ = _bodyOmega.x * _bodyOmega.y * (_inertia.y - _inertia.x);
  _bodyOmega.x += ((_bodyTorque.x + gyroX) / _inertia.x) * dt;
  _bodyOmega.y += ((_bodyTorque.y + gyroY) / _inertia.y) * dt;
  _bodyOmega.z += ((_bodyTorque.z + gyroZ) / _inertia.z) * dt;
  // A touch of damping keeps the chassis from ringing.
  _bodyOmega.multiplyScalar(1 - Math.min(0.5, dt * 0.35));
  state.angularVelocity.copy(_bodyOmega).applyQuaternion(state.quaternion);

  _quaternionDelta.set(
    state.angularVelocity.x * dt * 0.5,
    state.angularVelocity.y * dt * 0.5,
    state.angularVelocity.z * dt * 0.5,
    0,
  );
  _quaternionDelta.multiply(state.quaternion);
  state.quaternion.x += _quaternionDelta.x;
  state.quaternion.y += _quaternionDelta.y;
  state.quaternion.z += _quaternionDelta.z;
  state.quaternion.w += _quaternionDelta.w;
  state.quaternion.normalize();

  // ---------------------------------------------------------------- state
  const newSpeed = state.velocity.length();
  state.speed = newSpeed;
  state.odometer += Math.abs(forwardSpeed) * dt;
  state.airborne = groundedCount === 0 ? Math.min(1, state.airborne + dt * 2) : Math.max(0, state.airborne - dt * 4);

  // A car that drives into a cliff at full speed would be turned into a
  // rocket by the contact forces. The vertical speed is capped so a launch
  // stays a jump instead of a trip to the moon.
  if (state.velocity.y > MAX_LAUNCH) state.velocity.y = MAX_LAUNCH;
  if (state.velocity.y < -MAX_FALL) state.velocity.y = -MAX_FALL;
  // The spin is capped as well, so a tumble cannot become a blender.
  const spin = state.angularVelocity.length();
  if (spin > MAX_SPIN) state.angularVelocity.multiplyScalar(MAX_SPIN / spin);

  // The chassis slip angle: the angle between where the car points and where
  // it is actually going. That is the drift.
  if (horizontalSpeed > 2) {
    const velocityAngle = Math.atan2(state.velocity.x, state.velocity.z);
    const headingAngle = Math.atan2(_forward.x, _forward.z);
    let delta = velocityAngle - headingAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    state.slipAngle = delta;
  } else {
    state.slipAngle = 0;
  }

  const drifting =
    Math.abs(state.slipAngle) > 0.17 &&
    horizontalSpeed > 9 &&
    groundedCount > 1 &&
    !state.airborne;
  state.drifting = drifting;
  if (drifting) {
    state.driftTime += dt;
    state.driftMultiplier = Math.min(5, 1 + Math.floor(state.driftTime / 1.15));
    const rate = Math.abs(state.slipAngle) * horizontalSpeed * 8.5 * state.driftMultiplier * spec.driftBonus;
    state.driftScore += rate * dt;
    state.boostFuel = Math.min(1, state.boostFuel + rate * 0.0004 * dt);
  } else {
    state.driftTime = Math.max(0, state.driftTime - dt * 2.2);
    state.driftMultiplier = Math.max(1, 1 + Math.floor(state.driftTime / 1.15));
    if (state.driftTime <= 0) {
      state.bestDrift = Math.max(state.bestDrift, state.driftScore);
      state.driftScore = 0;
    }
  }

  // Boost.
  const boosting = Boolean(input.boost) && state.boostFuel > 0.01 && throttle > 0.1;
  state.boosting = boosting;
  if (boosting) state.boostFuel = Math.max(0, state.boostFuel - 0.32 * dt);
  else state.boostFuel = Math.min(1, state.boostFuel + 0.01 * dt);

  // Fake gearbox for the sound and the HUD.
  const gearCount = 5;
  const gearSpan = spec.maxSpeed / gearCount;
  state.gear = clamp(Math.floor(Math.abs(forwardSpeed) / gearSpan) + 1, 1, gearCount);
  const within = (Math.abs(forwardSpeed) - (state.gear - 1) * gearSpan) / gearSpan;
  state.rpm = clamp(0.15 + within * 0.85, 0, 1);
}

/**
 * @param {VehicleState} state
 * @param {number} forwardSpeed
 */
function gearFactor(state, forwardSpeed) {
  // A simple torque curve: full power in the middle, less at the top.
  const ratio = clamp(Math.abs(forwardSpeed) / state.spec.maxSpeed, 0, 1);
  return 0.55 + 0.45 * (1 - ratio ** 2);
}

/**
 * Surface normal from the probe result (approximate, cheap and stable).
 * @param {{ height: number, lateral: number, onRoad: boolean, s: number }} probe
 * @param {THREE.Vector3} out
 */
function surfaceNormalFor(probe, out) {
  // On the road the surface is nearly flat; off it we approximate with a
  // gentle slope based on the lateral position.
  if (probe.onRoad) {
    out.set(0, 1, 0);
    return out;
  }
  const slope = clamp(probe.lateral * 0.02, -0.5, 0.5);
  out.set(-slope, 1, 0).normalize();
  return out;
}

/**
 * Convenience: the wheel contact information for effects.
 * @param {VehicleState} state
 */
export function getWheelContacts(state) {
  return state.wheels.map((wheel) => ({
    contact: wheel.contact,
    point: wheel.contactPoint,
    load: wheel.load,
    slip: wheel.slipAngle,
    onRoad: wheel.onRoad,
    spin: wheel.spin,
  }));
}
