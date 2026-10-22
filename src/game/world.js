/**
 * The game world: an endless procedural road, a rigid body car, the effects
 * and the audio.
 *
 * The simulation is fixed step and independent from rendering, so the same
 * code runs in the browser and in the head-less tests.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../core/math.js';
import { createRenderer } from './renderer.js';
import { createCamera, updateCamera, kickCamera } from './camera.js';
import { createEffects } from './effects.js';
import { createCarModel } from './models.js';
import { createVehicle, getCarSpec, placeVehicle, stepVehicle } from './vehicle.js';
import { createWorldScene } from './scene.js';
import { createAutopilot } from './autopilot.js';
import {
  createRoadProfile,
  roadOffset,
  roadHeight,
  roadHeading,
  surfaceHeight,
  roadInfo,
} from './road.js';

/** Physics sub step. The vehicle needs a small dt to stay stable. */
const PHYSICS_STEP = 1 / 120;

/**
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   input: any,
 *   audio: any,
 *   assets: any,
 *   seed?: number,
 *   carId?: string,
 *   quality?: { quality?: string, autoQuality?: boolean },
 *   renderer?: any
 *   palette?: any,
 * }} options
 */
export function createWorld(options) {
  const seed = options.seed ?? 0x5eed;
  const profile = createRoadProfile(seed);
  const spec = getCarSpec(options.carId || 'vector');

  const vehicle = createVehicle(spec);
  const spawnS = 40;
  placeVehicle(
    vehicle,
    roadOffset(profile, spawnS),
    roadHeight(profile, spawnS) + 0.6,
    spawnS,
    roadHeading(profile, spawnS),
  );

  const renderer = options.renderer ?? createRenderer(options.canvas, {
    quality: options.quality?.quality ?? 'high',
    autoQuality: options.quality?.autoQuality ?? true,
  });

  const scene = createWorldScene(profile, {
    seed,
    assets: options.assets,
    // The impostor baker needs the raw Three.js renderer.
    renderer: renderer.renderer,
    palette: options.palette,
  });
  const effects = createEffects(scene.scene);
  const cameraState = createCamera();
  renderer.setExposure?.(scene.palette.exposure ?? 1);
  // The sun direction, for the lens flare in the post processing.
  const sunDirection = new THREE.Vector3(
    scene.palette.sunX * 2 - 1,
    scene.palette.sunY * 1.6 + 0.25,
    -0.55,
  ).normalize();
  renderer.setSunDirection?.(sunDirection);

  // The camera starts behind the car, not at the world origin.
  updateCamera(cameraState, vehicle, 1 / 60, true);

  // --- car model ---------------------------------------------------------
  const carRoot = new THREE.Group();
  const carModel = createCarModel(
    { color: spec.color, accent: spec.accent, assetKey: spec.assetKey },
    false,
    options.assets,
  );
  carRoot.add(carModel);
  scene.scene.add(carRoot);

  /** @type {Map<string, { root: THREE.Group, model: THREE.Group, data: any }>} */
  const ghosts = new Map();

  /** @type {Map<string, (payload: any) => void>} */
  const listeners = new Map();
  /**
   * @param {string} event
   * @param {(payload: any) => void} handler
   */
  function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
  }
  /**
   * @param {string} event
   * @param {any} [payload]
   */
  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const handler of set) handler(payload);
  }

  // The ground query used by the vehicle physics.
  const probe = { height: 0, lateral: 0, onRoad: false, s: 0 };
  /**
   * @param {number} x
   * @param {number} z
   * @param {any} [out]
   */
  function groundAt(x, z, out) {
    const target = out || probe;
    return surfaceHeight(profile, x, z, target);
  }

  let smokeTimer = 0;
  let wasDrifting = false;
  let stuckTimer = 0;

  // The driving bot. It takes over the controls when it is enabled, which is
  // how the attract mode and the automated capture runs work.
  const autopilot = createAutopilot(profile);
  let autopilotEnabled = false;
  let elapsed = 0;

  /**
   * @param {number} dt
   */
  function update(dt) {
    const controls = options.input
      ? options.input.state
      : { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
    const input = autopilotEnabled
      ? autopilot.update(vehicle, dt)
      : {
          steer: controls.steer,
          throttle: controls.throttle,
          brake: controls.brake,
          handbrake: controls.handbrake,
          boost: controls.boost,
        };

    // Fixed sub steps keep the suspension stable at any frame rate.
    let remaining = Math.min(dt, 0.1);
    while (remaining > 0) {
      const step = Math.min(PHYSICS_STEP, remaining);
      stepVehicle(vehicle, input, groundAt, step);
      remaining -= step;
    }

    // Keep the car on the road if it ends up in a ditch or on its roof.
    const info = roadInfo(profile, vehicle.position.x, vehicle.position.z);
    const roadY = roadHeight(profile, vehicle.position.z);
    // Off the world: too high after a launch or too far down a cliff. The
    // car is put back on the road instead of being lost.
    const lost =
      vehicle.position.y > roadY + 45 || vehicle.position.y < roadY - 40;
    if (lost) {
      respawn();
      return;
    }
    const upsideDown = vehicle.quaternion.y < 0.1 && vehicle.speed < 4;
    if (upsideDown) {
      stuckTimer += dt;
      if (stuckTimer > 2.5) {
        respawn();
        stuckTimer = 0;
      }
    } else {
      stuckTimer = 0;
    }

    // --- camera ----------------------------------------------------------
    updateCamera(cameraState, vehicle, dt);

    // --- effects ---------------------------------------------------------
    updateEffects(dt);

    // --- audio -----------------------------------------------------------
    const audio = options.audio;
    if (audio) {
      audio.engine(vehicle.rpm, controls.throttle);
      const rearSlip = vehicle.wheels[2].lateralSlipSpeed + vehicle.wheels[3].lateralSlipSpeed;
      audio.tyre(clamp((Math.abs(rearSlip) - 1.2) / 7, 0, 1), vehicle.speed);
      audio.wind(vehicle.speed);
    }
  }

  /**
   * @param {number} dt
   */
  function updateEffects(dt) {
    smokeTimer += dt;
    const emitInterval = 0.03;
    for (const [index, wheel] of vehicle.wheels.entries()) {
      const slipping = wheel.contact && (Math.abs(wheel.slipAngle) > 0.12 || Math.abs(wheel.slipRatio) > 0.25);
      if (!slipping || smokeTimer < emitInterval) continue;
      smokeTimer = 0;
      const tint = wheel.onRoad ? [0.92, 0.92, 0.95] : [0.62, 0.5, 0.34];
      effects.emitSmoke(
        wheel.contactPoint.x,
        wheel.contactPoint.y + 0.12,
        wheel.contactPoint.z,
        -vehicle.velocity.x * 0.35,
        -vehicle.velocity.z * 0.35,
        clamp(Math.abs(wheel.slipAngle) * 4, 0.3, 1),
        tint,
      );
      if (wheel.onRoad) {
        effects.addSkid(index, wheel.contactPoint.x, wheel.contactPoint.y, wheel.contactPoint.z, 0.34);
      }
    }
    if (vehicle.drifting && !wasDrifting) {
      kickCamera(cameraState, 0.1);
      emit('drift-start');
    }
    wasDrifting = vehicle.drifting;
    effects.update(dt);
  }

  /**
   * Put the car back on the road, upright.
   */
  function respawn() {
    const s = vehicle.position.z;
    placeVehicle(
      vehicle,
      roadOffset(profile, s),
      roadHeight(profile, s) + 0.8,
      s,
      roadHeading(profile, s),
    );
    vehicle.boostFuel = Math.max(vehicle.boostFuel, 0.3);
    // The camera jumps straight to the car instead of flying in from the last
    // position.
    updateCamera(cameraState, vehicle, 1 / 60, true);
    emit('respawn');
  }

  /**
   * @param {number} dt
   */
  function render(dt) {
    elapsed += dt;
    // The speed blur and the field of view follow the speed.
    const speedRatio = clamp(vehicle.speed / 62, 0, 1);
    renderer.setSpeed?.(clamp((speedRatio - 0.45) / 0.55, 0, 1) * 0.85);
    // The car model follows the chassis exactly.
    carRoot.position.copy(vehicle.position);
    carRoot.quaternion.copy(vehicle.quaternion);

    const wheels = carModel.userData.wheels || [];
    const frontWheels = carModel.userData.frontWheels || wheels.slice(0, 2);
    vehicle.wheels.forEach((wheel, index) => {
      const mesh = wheels[index];
      if (!mesh) return;
      mesh.rotation.order = 'YXZ';
      mesh.rotation.x = wheel.spin;
      // The car faces +Z, so its right hand side is -X: the visual wheels
      // turn the other way round compared to the heading.
      mesh.rotation.y = wheel.spec.front ? -vehicle.wheelAngle : 0;
      // The wheel moves up into the chassis as the suspension compresses.
      mesh.position.y = (mesh.userData.baseY ?? (mesh.userData.baseY = mesh.position.y)) + wheel.compression;
    });

    // The brake lights come on, the boost burns the exhaust.
    const tailMat = carModel.userData.tailMat;
    if (tailMat) {
      const braking = vehicle.braking ? 3.4 : 1.4;
      tailMat.emissiveIntensity += (braking - tailMat.emissiveIntensity) * Math.min(1, dt * 14);
    }

    for (const ghost of ghosts.values()) {
      ghost.root.position.set(ghost.data.x, ghost.data.y, ghost.data.z);
      ghost.root.quaternion.set(
        ghost.data.qx,
        ghost.data.qy,
        ghost.data.qz,
        ghost.data.qw,
      );
      const ghostWheels = ghost.model.userData.wheels || [];
      vehicle.wheels.forEach((wheel, index) => {
        const mesh = ghostWheels[index];
        if (mesh) mesh.rotation.x = wheel.spin;
      });
    }

    scene.update(vehicle.position.z, vehicle.position.x, vehicle.position.z, elapsed);
    renderer.render(scene.scene, cameraState);
    void dt;
  }

  /**
   * Remote cars. They are ghosts: they never collide with the player.
   * @param {any[]} list
   */
  function setGhosts(list) {
    const seen = new Set();
    for (const data of list) {
      seen.add(data.id);
      let entry = ghosts.get(data.id);
      if (!entry) {
        const model = createCarModel(
          { color: data.color || '#31d6ff', accent: data.accent || '#e9fbff', assetKey: data.assetKey || 'comet' },
          true,
          options.assets,
        );
        const root = new THREE.Group();
        root.add(model);
        scene.scene.add(root);
        entry = { root, model, data };
        ghosts.set(data.id, entry);
      }
      entry.data = data;
    }
    for (const [id, entry] of ghosts) {
      if (!seen.has(id)) {
        scene.scene.remove(entry.root);
        ghosts.delete(id);
      }
    }
  }

  return {
    vehicle,
    spec,
    profile,
    cameraState,
    scene,
    on,
    update,
    render,
    respawn,
    setGhosts,
    /**
     * Hand the controls over to the driving bot.
     * @param {boolean} value
     */
    setAutopilot(value) {
      autopilotEnabled = Boolean(value);
    },
    get autopilotEnabled() {
      return autopilotEnabled;
    },
    /**
     * Change the time of day while the race is running.
     * @param {any} palette
     */
    setPalette(palette) {
      scene.setPalette?.(palette);
      renderer.setExposure?.(scene.palette.exposure ?? 1);
    },
    /**
     * @returns {{ speed: number, kmh: number, drift: number, multiplier: number, boost: number, onRoad: boolean, s: number }}
     */
    get status() {
      return {
        speed: vehicle.speed,
        kmh: vehicle.speed * 3.6,
        drift: vehicle.driftScore,
        multiplier: vehicle.driftMultiplier,
        boost: vehicle.boostFuel,
        onRoad: vehicle.wheels[0].onRoad,
        s: vehicle.position.z,
      };
    },
    resize() {
      renderer.resize();
    },
    /** @param {string} value */
    setQuality(value) {
      renderer.setQuality(value);
    },
    /** @param {boolean} value */
    setAutoQuality(value) {
      renderer.setAutoQuality(value);
    },
    /** @returns {any} */
    get stats() {
      const info = renderer.renderer.info;
      return {
        calls: info.render.calls,
        triangles: info.render.triangles,
        pixelRatio: renderer.pixelRatio,
      };
    },
    dispose() {
      effects.dispose();
      scene.dispose();
      // The renderer is shared between worlds: a canvas can only ever have
      // one WebGL context, so it is not disposed here.
    },
  };
}
