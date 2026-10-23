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
 *
 * Two rules keep the car out of orbit, and both of them used to be missing:
 *
 *   - the wheel probe is a ray straight *down in the world*, so a rolled or
 *     airborne chassis can never "find" ground where there is none and a
 *     probe that misses is a wheel in the air, never a fully compressed one;
 *   - the body itself collides with the terrain through a handful of points,
 *     so a car that lands on its nose or slides into a hillside is pushed
 *     out instead of being fired into the sky by its own springs.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { clamp, sign } from '../core/math.js';

const GRAVITY = 9.81;
/** The fastest a car may be thrown upwards, in metres per second. */
const MAX_LAUNCH = 7.5;
/** The fastest a car may fall, in metres per second. */
const MAX_FALL = 65;
/** The fastest the chassis may spin, in radians per second. */
const MAX_SPIN = 6;
/** Airborne cars are held to a slower spin still: no somersaults. */
const MAX_AIR_SPIN = 3.2;
/** Wheel angular speed cap, rad/s. */
const MAX_WHEEL_SPIN = 220;
/** Wheel plus brake inertia, kg m^2. */
const WHEEL_INERTIA = 2.6;
/** Stencil used for the surface normal finite differences, metres. */
const NORMAL_STEP = 0.5;
/** How quickly the contact normal follows the terrain (0..1 per step). */
const NORMAL_SMOOTH = 0.55;
/** A single spring may push with at most this much of the car's weight. */
const SPRING_FORCE_CAP = 1.15;
/** A single body contact may push with at most this much of the weight. */
const BODY_FORCE_CAP = 1.1;
/** Beyond this lean the chassis is held up by an anti-rollover assist, rad. */
const LEAN_LIMIT = 0.3;
/** How strongly the car resists leaning past the limit. */
const LEAN_STIFFNESS = 380;
/** Damping for that assist, so it cannot rock the car. */
const LEAN_DAMPING = 90;

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
 * @property {number} wheelRadius     m
 * @property {number} engineForce     N of tractive force at full throttle
 * @property {number} maxSpeed        m/s
 * @property {number} drag            N per (m/s)^2 of aerodynamic drag
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
    wheelRadius: 0.34,
    engineForce: 9600,
    maxSpeed: 74,
    drag: 0.96,
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
    wheelRadius: 0.35,
    engineForce: 10800,
    maxSpeed: 82,
    drag: 0.88,
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
    wheelRadius: 0.42,
    engineForce: 9200,
    maxSpeed: 64,
    drag: 1.24,
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
 * @property {THREE.Vector3[]} bodyPoints collision hull points in chassis space
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
 * @property {number} grounded
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
 * The points of the body that can hit the ground. They are the four corners
 * of the floor pan, the two ends of the nose and tail, and the roof, so a car
 * that lands on its nose or ends up on its roof still has something to rest
 * on instead of sinking into the terrain.
 *
 * @param {CarSpec} spec
 * @returns {THREE.Vector3[]}
 */
export function bodyCollisionPoints(spec) {
  const halfBase = spec.wheelbase / 2;
  const halfTrack = spec.trackWidth / 2;
  return [
    new THREE.Vector3(-halfTrack * 0.94, -0.3, halfBase * 0.95),
    new THREE.Vector3(halfTrack * 0.94, -0.3, halfBase * 0.95),
    new THREE.Vector3(-halfTrack * 0.94, -0.3, -halfBase * 0.95),
    new THREE.Vector3(halfTrack * 0.94, -0.3, -halfBase * 0.95),
    new THREE.Vector3(0, -0.16, halfBase + 0.72),
    new THREE.Vector3(0, -0.16, -(halfBase + 0.72)),
    new THREE.Vector3(0, 0.62, 0),
  ];
}

/**
 * @param {CarSpec} spec
 * @returns {VehicleState}
 */
export function createVehicle(spec) {
  const halfBase = spec.wheelbase / 2;
  const halfTrack = spec.trackWidth / 2;
  const radius = spec.wheelRadius ?? 0.34;
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
    position: new THREE.Vector3(0, spec.suspensionRest + spec.wheelRadius + 0.1, 0),
    velocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    angularVelocity: new THREE.Vector3(),
    spec,
    wheels,
    bodyPoints: bodyCollisionPoints(spec),
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
    grounded: 0,
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
  state.slipAngle = 0;
  state.drifting = false;
  state.airborne = 0;
  state.grounded = 0;
  for (const wheel of state.wheels) {
    wheel.compression = 0;
    wheel.spin = 0;
    wheel.load = 0;
    wheel.slipAngle = 0;
    wheel.slipRatio = 0;
    wheel.contact = false;
    wheel.contactNormal.set(0, 1, 0);
  }
}

// Scratch vectors, reused to avoid allocations in the hot loop.
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _wheelWorld = new THREE.Vector3();
const _contact = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _surfaceNormal = new THREE.Vector3();
const _contactVel = new THREE.Vector3();
const _force = new THREE.Vector3();
const _torque = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _arm = new THREE.Vector3();
const _point = new THREE.Vector3();
const _steerDir = new THREE.Vector3();
const _sideDir = new THREE.Vector3();
const _bodyTorque = new THREE.Vector3();
const _bodyOmega = new THREE.Vector3();
const _inertia = new THREE.Vector3();
const _groundUp = new THREE.Vector3();
const _leanAxis = new THREE.Vector3();
const _velocityDir = new THREE.Vector3();
const _alignAxis = new THREE.Vector3();
const _quaternionDelta = new THREE.Quaternion();
const probeScratch = { height: 0, lateral: 0, onRoad: false, s: 0 };

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
  const mass = spec.mass;
  const weight = mass * GRAVITY;
  const steerInput = clamp(input.steer, -1, 1);
  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);
  const handbrake = Boolean(input.handbrake);
  // The brake lights and the tyre squeal follow the brake pedal.
  state.braking = brake > 0.05 || handbrake;

  // Chassis basis.
  _up.set(0, 1, 0).applyQuaternion(state.quaternion);
  _forward.set(0, 0, 1).applyQuaternion(state.quaternion);

  const totalForce = _force.set(0, -weight, 0);
  const totalTorque = _torque.set(0, 0, 0);

  // ------------------------------------------------------------- steering
  const speed = state.velocity.length();
  const forwardSpeed = state.velocity.dot(_forward);
  // Less steering lock at speed, like a real rack.
  const maxSteer = 0.52 / (1 + Math.abs(forwardSpeed) * 0.022);
  const steerAngle = steerInput * maxSteer;
  state.wheelAngle += (steerAngle - state.wheelAngle) * Math.min(1, dt * 12);

  // Aerodynamic drag: this is what gives every car a top speed.
  totalForce.addScaledVector(state.velocity, -spec.drag * speed);

  // ---------------------------------------------------------------- wheels
  let groundedCount = 0;
  const maxT = spec.suspensionRest + spec.maxTravel;
  // The wheels can only carry the car when they point at the ground.
  const wheelsUnderneath = _up.y > 0.12;

  for (const wheel of state.wheels) {
    // Attachment point in world space.
    _wheelWorld.copy(wheel.local).applyQuaternion(state.quaternion).add(state.position);

    // Probe straight down in world space. The chassis may be rolled, pitched
    // or upside down - the ground is always below the wheel in world space,
    // and a probe that finds nothing means the wheel is in the air.
    probeScratch.onRoad = false;
    const groundY = groundAt(_wheelWorld.x, _wheelWorld.z, probeScratch);
    const t = _wheelWorld.y - groundY;
    const reach = maxT + wheel.spec.radius + 0.06;

    if (!wheelsUnderneath || t > reach || t < -0.35) {
      wheel.contact = false;
      wheel.compression = 0;
      wheel.load = 0;
      wheel.slipAngle = 0;
      wheel.slipRatio = 0;
      wheel.lateralSlipSpeed = 0;
      // A wheel in the air keeps spinning, slowly slowing down.
      wheel.spin *= 1 - Math.min(1, dt * 0.5);
      continue;
    }

    groundedCount++;
    wheel.contact = true;

    // The contact patch is the point of the ground under the wheel.
    _contact.set(_wheelWorld.x, groundY, _wheelWorld.z);
    wheel.contactPoint.copy(_contact);
    wheel.onRoad = probeScratch.onRoad;

    // The real slope of the ground, not a guess from the distance to the
    // road: this is what keeps the car from being thrown sideways on a
    // hillside and from sinking into it.
    surfaceNormalFrom(groundAt, _contact.x, _contact.z, groundY, _surfaceNormal);
    wheel.contactNormal.lerp(_surfaceNormal, NORMAL_SMOOTH);
    if (wheel.contactNormal.lengthSq() < 1e-6) wheel.contactNormal.set(0, 1, 0);
    wheel.contactNormal.normalize();
    _normal.copy(wheel.contactNormal);

    const springLength = Math.max(0, t - wheel.spec.radius);
    const compression = clamp(spec.suspensionRest - springLength, 0, spec.maxTravel);
    wheel.compression = compression;

    // Velocity of the contact patch: the spring and damper act on it.
    _arm.copy(_contact).sub(state.position);
    _contactVel.copy(state.angularVelocity).cross(_arm).add(state.velocity);
    const normalSpeed = _contactVel.dot(_normal);

    let load = spec.suspensionK * compression;
    // Bump stop: the last centimetres of travel are stiffer, but not a wall.
    if (compression > spec.maxTravel * 0.86) {
      load += (compression - spec.maxTravel * 0.86) * spec.suspensionK * 3.5;
    }
    // The damper only resists the chassis moving into the ground. Pulling the
    // car down is not something a damper does.
    load += spec.suspensionC * clamp(-normalSpeed, 0, 2.4);
    // A buried wheel is pushed out instead of being pulled through the floor.
    if (t < wheel.spec.radius) {
      load += (wheel.spec.radius - t) * spec.suspensionK * 2.2;
    }
    load = clamp(load, 0, weight * SPRING_FORCE_CAP);
    wheel.load = load;

    _tmp.copy(_normal).multiplyScalar(load);
    totalForce.add(_tmp);
    _arm.copy(_contact).sub(state.position);
    totalTorque.add(_arm.cross(_tmp));

    // ------------------------------------------------------- tyre forces
    // Wheel frame projected on the ground plane. The car faces +Z, so its
    // right hand side is -X.
    if (wheel.spec.front) {
      _steerDir.copy(_forward).applyAxisAngle(_up, -steerAngle);
    } else {
      _steerDir.copy(_forward);
    }
    _steerDir.addScaledVector(_normal, -_steerDir.dot(_normal));
    if (_steerDir.lengthSq() < 1e-6) _steerDir.copy(_forward);
    _steerDir.normalize();
    _sideDir.copy(_steerDir).cross(_normal).normalize();

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
    const lateralForce = load > 1 ? -maxLateral * shape * Math.sign(slipAngle) : 0;

    // Longitudinal: the wheel has its own spin, the ground reacts through the
    // friction circle. The target spin comes from the torque balance, which
    // keeps this stable at any step size instead of ringing between full
    // wheelspin and a locked wheel every step.
    const longMax = Math.sqrt(Math.max(0, maxLateral * maxLateral - lateralForce * lateralForce));
    const rollingSpeed = forwardVel / wheel.spec.radius;
    // Below walking pace the brake pedal becomes reverse gear, which is what
    // the control table promises. It fades out around 40 km/h in reverse.
    const wantReverse = brake > 0.1 && throttle < 0.1 && !handbrake && forwardSpeed < 0.6;
    let demand = 0;
    if (wheel.spec.driven && !handbrake) {
      if (wantReverse) {
        const fade = clamp(1 - Math.max(0, -forwardSpeed) / 12, 0, 1);
        demand -= (spec.engineForce * 0.45 * brake * fade * gearFactor(state, forwardSpeed)) / 2;
      } else {
        demand += (throttle * spec.engineForce * gearFactor(state, forwardSpeed)) / 2;
      }
    }
    if (brake > 0 && load > 1 && !wantReverse) {
      // Brakes act against the direction the wheel rolls.
      const brakeForce = (spec.brakeTorque * brake * (wheel.spec.front ? 0.62 : 0.38)) / wheel.spec.radius;
      demand -= brakeForce * sign(rollingSpeed || forwardVel || 1);
    }
    demand = clamp(demand, -longMax, longMax);
    // A wheel with next to no load has no grip to spend: it just rolls.
    let targetSpin = rollingSpeed;
    if (load > 1) {
      const ratio = clamp(demand / Math.max(1, mu * load * 0.95), -0.98, 0.98);
      const targetSlip = Math.atanh(ratio) / 4.5;
      targetSpin = (forwardVel + targetSlip * Math.max(2.5, Math.abs(forwardVel))) / wheel.spec.radius;
    }
    if (handbrakeRear) targetSpin = 0;
    wheel.spin += (targetSpin - wheel.spin) * Math.min(1, dt * 45);
    wheel.spin = clamp(wheel.spin, -MAX_WHEEL_SPIN, MAX_WHEEL_SPIN);

    const wheelSurfaceSpeed = wheel.spin * wheel.spec.radius;
    const slipRatio = clamp((wheelSurfaceSpeed - forwardVel) / Math.max(2.5, Math.abs(forwardVel)), -1, 1);
    wheel.slipRatio = slipRatio;

    // The friction circle: longitudinal force uses whatever grip is left.
    const longitudinalForce = clamp(mu * load * Math.tanh(slipRatio * 4.5) * 0.95, -longMax, longMax);

    _tmp.copy(_steerDir).multiplyScalar(longitudinalForce).addScaledVector(_sideDir, lateralForce);
    totalForce.add(_tmp);
    _arm.copy(_contact).sub(state.position);
    totalTorque.add(_arm.cross(_tmp));
  }

  // -------------------------------------------------------- body collision
  // The wheels carry the car, but the body still has to be kept out of the
  // hillside. Without this a car that lands nose first digs in and the
  // springs fire it straight back up.
  const bodyK = mass * 260;
  const bodyC = mass * 26;
  // The caps are per step, not per point: a car that lands on all four
  // corners must not be pushed four times as hard as one that lands on one.
  let bodyPushLeft = weight * BODY_FORCE_CAP * 2.5;
  for (const local of state.bodyPoints) {
    _point.copy(local).applyQuaternion(state.quaternion).add(state.position);
    probeScratch.onRoad = false;
    const groundY = groundAt(_point.x, _point.z, probeScratch);
    const penetration = groundY - _point.y;
    if (penetration <= 0.005) continue;

    _arm.copy(_point).sub(state.position);
    _contactVel.copy(state.angularVelocity).cross(_arm).add(state.velocity);

    if (bodyPushLeft <= 0) break;
    let push = bodyK * penetration + bodyC * clamp(-_contactVel.y, 0, 6);
    push = clamp(push, 0, Math.min(weight * BODY_FORCE_CAP, bodyPushLeft));
    bodyPushLeft -= push;
    _tmp.set(0, push, 0);
    totalForce.add(_tmp);
    totalTorque.add(_arm.cross(_tmp));

    // Scraping along the ground: a car on its side does not skate uphill.
    const friction = Math.min(push * 0.8, mass * 10);
    const horizontal = Math.hypot(_contactVel.x, _contactVel.z);
    if (horizontal > 0.02 && friction > 0) {
      _tmp.set(
        (-_contactVel.x / horizontal) * friction,
        0,
        (-_contactVel.z / horizontal) * friction,
      );
      totalForce.add(_tmp);
      _arm.copy(_point).sub(state.position);
      totalTorque.add(_arm.cross(_tmp));
    }
  }

  // --- anti-rollover assist ---------------------------------------------
  // A road car tips over at about one g of lateral load, and a drift in this
  // game pulls more than that on the grass. The chassis is held upright once
  // it leans more than about 17 degrees away from the ground it is standing
  // on, so a drift ends in a slide instead of a roll. The assist can never
  // lift the car: it is capped below the torque of its own weight.
  if (groundedCount > 0) {
    _groundUp.set(0, 0, 0);
    for (const wheel of state.wheels) {
      if (wheel.contact) _groundUp.add(wheel.contactNormal);
    }
    if (_groundUp.lengthSq() > 1e-6) {
      _groundUp.normalize();
      const lean = Math.acos(clamp(_up.dot(_groundUp), -1, 1));
      if (lean > LEAN_LIMIT && lean < 1.4) {
        // Rotating around `up x ground` brings the chassis back upright.
        _leanAxis.copy(_up).cross(_groundUp);
        if (_leanAxis.lengthSq() > 1e-6) {
          _leanAxis.normalize();
          const rate = state.angularVelocity.dot(_leanAxis);
          const excess = lean - LEAN_LIMIT;
          const assist = clamp(
            excess * mass * LEAN_STIFFNESS - rate * mass * LEAN_DAMPING,
            0,
            weight * spec.trackWidth * 0.42,
          );
          totalTorque.addScaledVector(_leanAxis, assist);
        }
      }
    }
  }

  // --- stability assist -------------------------------------------------
  // Like the traction control of a modern car: past a certain slip angle the
  // chassis is nudged back towards its travel direction, so a drift can be
  // held and caught instead of turning into a spin.
  //
  // The nudge is built from the heading and the velocity vectors, not from
  // the sign of the slip angle: at a full spin the slip angle jumps between
  // +180 and -180 degrees and a torque built on its sign flips every step,
  // which is how a car used to end up sliding backwards for ever.
  const horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.z);
  if (groundedCount > 1 && horizontalSpeed > 4) {
    _velocityDir.set(state.velocity.x, 0, state.velocity.z).multiplyScalar(1 / horizontalSpeed);
    _alignAxis.copy(_forward).cross(_velocityDir);
    const sin = _alignAxis.length();
    const alignment = Math.atan2(sin, _forward.x * _velocityDir.x + _forward.z * _velocityDir.z);
    if (alignment > 0.48) {
      if (sin > 0.02) {
        _alignAxis.multiplyScalar(1 / sin);
      } else {
        // Sliding exactly backwards: every rotation is equally short, so the
        // steering decides which way the car swings round.
        _alignAxis.copy(_up).multiplyScalar(steerInput > 0 ? -1 : 1);
      }
      const excess = alignment - 0.48;
      // Gentle at the angles a drift lives in, firm once the car is really
      // sideways, so a spin can always be caught.
      const rate = state.angularVelocity.dot(_alignAxis);
      const assist = clamp(
        excess * mass * 0.4 + excess * excess * excess * mass * 6 - rate * mass * 0.1,
        0,
        weight * spec.trackWidth * 0.6,
      );
      totalTorque.addScaledVector(_alignAxis, assist);
    }
  }

  // ------------------------------------------------------------- integrate
  const acceleration = _tmp.copy(totalForce).multiplyScalar(1 / mass);
  state.velocity.addScaledVector(acceleration, dt);
  // A car that drives into a cliff at full speed would be turned into a
  // rocket by the contact forces. The vertical speed is capped so a launch
  // stays a jump instead of a trip to the moon.
  state.velocity.y = clamp(state.velocity.y, -MAX_FALL, MAX_LAUNCH);
  state.position.addScaledVector(state.velocity, dt);

  // Angular integration in the body frame with a diagonal inertia tensor.
  _bodyTorque.copy(totalTorque).applyQuaternion(_quaternionDelta.copy(state.quaternion).invert());
  _bodyOmega.copy(state.angularVelocity).applyQuaternion(_quaternionDelta);
  _inertia.set(mass * 0.42, mass * 1.95, mass * 2.25);
  const gyroX = _bodyOmega.y * _bodyOmega.z * (_inertia.z - _inertia.y);
  const gyroY = _bodyOmega.z * _bodyOmega.x * (_inertia.x - _inertia.z);
  const gyroZ = _bodyOmega.x * _bodyOmega.y * (_inertia.y - _inertia.x);
  _bodyOmega.x += ((_bodyTorque.x + gyroX) / _inertia.x) * dt;
  _bodyOmega.y += ((_bodyTorque.y + gyroY) / _inertia.y) * dt;
  _bodyOmega.z += ((_bodyTorque.z + gyroZ) / _inertia.z) * dt;
  // A touch of damping keeps the chassis from ringing; in the air there is
  // nothing to push against, so a tumble is damped harder and capped lower.
  _bodyOmega.multiplyScalar(1 - Math.min(0.5, dt * (groundedCount > 0 ? 1.4 : 2.6)));
  const spinLimit = groundedCount > 0 ? MAX_SPIN : MAX_AIR_SPIN;
  const bodySpin = _bodyOmega.length();
  if (bodySpin > spinLimit) _bodyOmega.multiplyScalar(spinLimit / bodySpin);
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

  // Keep the numbers sane even if a machine or a very strange step slips
  // something through.
  if (!Number.isFinite(state.position.y) || !Number.isFinite(state.quaternion.w)) {
    state.velocity.set(0, 0, 0);
    state.angularVelocity.set(0, 0, 0);
    state.quaternion.set(0, 0, 0, 1);
    state.position.y = 0;
  }

  // ---------------------------------------------------------------- state
  state.speed = state.velocity.length();
  state.odometer += Math.abs(forwardSpeed) * dt;
  state.grounded = groundedCount;
  state.airborne =
    groundedCount === 0
      ? Math.min(1, state.airborne + dt * 2)
      : Math.max(0, state.airborne - dt * 4);

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
 * The slope of the ground at a point, from the height function itself.
 *
 * @param {(x: number, z: number, out: any) => number} groundAt
 * @param {number} x
 * @param {number} z
 * @param {number} height height at (x, z), already sampled
 * @param {THREE.Vector3} out
 */
function surfaceNormalFrom(groundAt, x, z, height, out) {
  const e = NORMAL_STEP;
  probeScratch.onRoad = false;
  const hx = groundAt(x + e, z, probeScratch);
  probeScratch.onRoad = false;
  const hz = groundAt(x, z + e, probeScratch);
  out.set(-(hx - height) / e, 1, -(hz - height) / e);
  if (out.lengthSq() < 1e-6) out.set(0, 1, 0);
  else out.normalize();
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
