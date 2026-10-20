/**
 * The game world: track, scene, car, race rules, effects and audio.
 *
 * The simulation runs on a fixed timestep and is completely independent from
 * rendering, so it can be driven head-less in tests.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { clamp, sign } from '../core/math.js';
import { buildWorld } from './scene.js';
import { createRenderer } from './renderer.js';
import { createCamera, updateCamera, kickCamera } from './camera.js';
import { createEffects } from './effects.js';
import { createCarModel } from './models.js';
import { createCarState, getCarConfig, placeCar, stepCar } from './physics.js';
import { hashString } from '../core/rng.js';

const GHOST_ASSETS = ['vector', 'comet', 'bulldozer'];
import { createRace } from './race.js';
import { createTrackById, getTrackDef, sampleTrack, terrainHeightAt, projectToTrack } from './track.js';

/**
 * @typedef {object} GhostCar
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {string} accent
 * @property {number} x
 * @property {number} z
 * @property {number} heading
 * @property {number} drift
 * @property {boolean} boost
 */

/**
 * @typedef {object} WorldOptions
 * @property {HTMLCanvasElement} canvas
 * @property {import('../core/input.js').createInput extends (...args: any) => infer R ? R : any} input
 * @property {ReturnType<typeof import('./audio.js').createAudio>} audio
 * @property {{ quality?: string, autoQuality?: boolean }} [quality]
 * @property {string} [trackId]
 * @property {number} [seed]
 * @property {string} [carId]
 * @property {number} [laps]
 * @property {any} [assets]
 */

/**
 * @param {WorldOptions} options
 */
export function createWorld(options) {
  const trackDef = getTrackDef(options.trackId) || getTrackDef('coast');
  const track = createTrackById(trackDef.id, options.seed);
  const carConfig = getCarConfig(options.carId || 'vector');
  const laps = options.laps ?? trackDef.laps ?? 2;

  const renderer = createRenderer(options.canvas, {
    quality: options.quality?.quality ?? 'high',
    autoQuality: options.quality?.autoQuality ?? true,
  });
  const scene = buildWorld(track, { assets: options.assets });
  const effects = createEffects(scene.scene);
  const cameraState = createCamera();

  // --- car model ---------------------------------------------------------
  const carRoot = new THREE.Group();
  const carBody = new THREE.Group();
  const carModel = createCarModel(carConfig, false, options.assets);
  carBody.add(carModel);
  carRoot.add(carBody);
  scene.scene.add(carRoot);

  /** @type {Map<string, { root: THREE.Group, body: THREE.Group, model: THREE.Group, data: GhostCar }>} */
  const ghosts = new Map();

  const car = createCarState(carConfig);
  placeCar(car, track, 6, 0);

  const race = createRace({ laps, trackLength: track.length });
  const state = race.state;
  state.driftScore = 0;
  state.bestDrift = 0;

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

  let lastDistance = car.distance;
  let wheelSpin = 0;
  let smokeTimer = 0;
  let skidTimer = 0;
  let wasDrifting = false;

  /**
   * Advance the simulation by one fixed step.
   * @param {number} dt
   */
  function update(dt) {
    const controls = options.input ? options.input.state : { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
    const canDrive = state.phase === 'racing';
    const input = canDrive
      ? controls
      : { steer: 0, throttle: 0, brake: controls.brake, handbrake: false, boost: false };

    stepCar(car, track, carConfig, input, dt);

    // --- race rules ------------------------------------------------------
    for (const event of race.update(dt, car.distance, car.onRoad)) {
      switch (event.type) {
        case 'countdown':
          options.audio?.countdown(event.value === 0);
          emit('countdown', event.value);
          break;
        case 'lap':
          emit('lap', { lap: event.lap, lapTime: event.lapTime, best: event.best });
          break;
        case 'finish':
          emit('finish', {
            lapTimes: event.lapTimes,
            bestLap: event.bestLap,
            bestDrift: state.bestDrift,
            raceTime: event.raceTime,
          });
          break;
        case 'recover':
          respawn();
          break;
        default:
          break;
      }
    }

    // --- drift score -----------------------------------------------------
    if (car.drifting) {
      state.driftScore = car.driftScore;
      state.bestDrift = Math.max(state.bestDrift, car.driftScore);
    }

    // --- camera ----------------------------------------------------------
    updateCamera(cameraState, car, track, dt, {
      back: 6.6 + Math.min(2.2, car.speed * 0.03),
      height: 2.35,
    });

    // --- effects ---------------------------------------------------------
    updateEffects(dt);

    // --- audio -----------------------------------------------------------
    const audio = options.audio;
    if (audio) {
      const gears = 5;
      const span = carConfig.maxSpeed / gears;
      const gearIndex = Math.min(gears - 1, Math.floor(car.speed / span));
      const within = (car.speed - gearIndex * span) / span;
      const rpm = clamp(0.18 + within * 0.82, 0, 1);
      audio.engine(rpm, controls.throttle);
      audio.tyre(clamp((Math.abs(car.slip) - 0.1) * 3.2, 0, 1), car.speed);
      audio.wind(car.speed);
    }
  }

  /**
   * @param {number} dt
   */
  function updateEffects(dt) {
    const sinH = Math.sin(car.heading);
    const cosH = Math.cos(car.heading);
    const nx = cosH;
    const nz = -sinH;
    const rearX = car.x - sinH * 1.35;
    const rearZ = car.z - cosH * 1.35;
    const sample = sampleTrack(track, car.distance);
    const groundY = car.onRoad ? sample.y : terrainHeightAt(track, car.distance, car.offset);

    const drifting = car.drifting && car.speed > 6;
    const offRoad = !car.onRoad && car.speed > 4;
    const vx = Math.sin(car.velAngle) * car.speed;
    const vz = Math.cos(car.velAngle) * car.speed;

    smokeTimer += dt;
    const interval = drifting ? 0.035 : 0.06;
    if ((drifting || offRoad) && smokeTimer > interval) {
      smokeTimer = 0;
      const tint = offRoad ? [0.62, 0.5, 0.34] : [0.92, 0.92, 0.95];
      const intensity = drifting ? clamp(Math.abs(car.slip) * 4, 0.3, 1) : 0.5;
      for (const side of [-1, 1]) {
        effects.emitSmoke(
          rearX + nx * side * 0.82,
          groundY + 0.25,
          rearZ + nz * side * 0.82,
          -vx * 0.5,
          -vz * 0.5,
          intensity,
          tint,
        );
      }
    }

    skidTimer += dt;
    if (drifting && skidTimer > 0.02) {
      skidTimer = 0;
      for (const side of [-1, 1]) {
        effects.addSkid(rearX + nx * side * 0.82, groundY, rearZ + nz * side * 0.82, nx, nz, 0.3, 0.4);
      }
    }

    if (drifting && !wasDrifting) {
      kickCamera(cameraState, 0.12);
      emit('drift-start');
    }
    wasDrifting = drifting;

    effects.update(dt);
  }

  function respawn() {
    const distance = car.distance;
    placeCar(car, track, distance, 0);
    car.boostFuel = Math.max(car.boostFuel, 0.25);
    state.offRoadTime = 0;
    lastDistance = car.distance;
    kickCamera(cameraState, 0.25);
    emit('respawn');
  }

  /**
   * Synchronise the 3D models with the simulation state.
   */
  function syncModels(dt) {
    const sample = sampleTrack(track, car.distance);
    carRoot.position.set(car.x, car.y ?? sample.y, car.z);
    carRoot.rotation.y = car.heading;
    carBody.rotation.z = car.suspension;
    carBody.rotation.x = clamp(-car.speed * 0.0016, -0.05, 0.05);

    wheelSpin += (car.speed / 0.34) * dt;
    const wheels = carModel.userData.wheels || [];
    const frontWheels = carModel.userData.frontWheels || wheels.slice(0, 2);
    for (const wheel of wheels) {
      wheel.rotation.order = 'YXZ';
      wheel.rotation.x = wheelSpin;
    }
    for (const wheel of frontWheels) {
      wheel.rotation.order = 'YXZ';
      wheel.rotation.y = car.wheelAngle;
    }

    for (const ghost of ghosts.values()) {
      const ghostY = terrainHeightAt(track, ghost.data.distance ?? car.distance, ghost.data.offset ?? 0);
      ghost.root.position.set(ghost.data.x, ghostY, ghost.data.z);
      ghost.root.rotation.y = ghost.data.heading;
      ghost.body.rotation.z = clamp(-ghost.data.drift * 0.02, -0.2, 0.2);
      const ghostWheels = ghost.model.userData.wheels || [];
      for (const wheel of ghostWheels) wheel.rotation.x += (car.speed / 0.34) * dt;
    }
  }

  /**
   * Render one frame.
   * @param {number} dt
   */
  function render(dt) {
    syncModels(dt);
    scene.follow(renderer.camera);
    renderer.render(scene.scene, cameraState);
  }

  /**
   * Add or update remote (ghost) cars. They never collide with the player.
   * @param {GhostCar[]} list
   */
  function setGhosts(list) {
    const seen = new Set();
    for (const data of list) {
      seen.add(data.id);
      let entry = ghosts.get(data.id);
      if (!entry) {
        const assetKey = GHOST_ASSETS[Math.abs(hashString(String(data.id))) % GHOST_ASSETS.length];
        const model = createCarModel(
          { color: data.color || '#31d6ff', accent: data.accent || '#e9fbff', assetKey },
          true,
          options.assets,
        );
        const body = new THREE.Group();
        body.add(model);
        const root = new THREE.Group();
        root.add(body);
        scene.scene.add(root);
        entry = { root, body, model, data };
        ghosts.set(data.id, entry);
      }
      // Work out where the ghost sits on the track so it hugs the surface.
      const projection = projectToTrack(track, data.x, data.z);
      entry.data = { ...data, distance: projection.distance, offset: projection.offset };
    }
    for (const [id, entry] of ghosts) {
      if (!seen.has(id)) {
        scene.scene.remove(entry.root);
        ghosts.delete(id);
      }
    }
  }

  function reset() {
    placeCar(car, track, 6, 0);
    race.reset(car.distance);
    state.driftScore = 0;
    state.bestDrift = 0;
    car.boostFuel = 0.35;
    car.bestDrift = 0;
    car.driftScore = 0;
    lastDistance = car.distance;
    effects.reset();
    cameraState.x = car.x;
    cameraState.z = car.z;
  }

  return {
    track,
    car,
    carConfig,
    state,
    cameraState,
    on,
    update,
    render,
    reset,
    respawn,
    setGhosts,
    /** @returns {number} */
    get speedKmh() {
      return car.speed * 3.6;
    },
    /** Render statistics, used by the performance overlay and the tests. */
    get stats() {
      const info = renderer.renderer.info;
      return {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
        pixelRatio: renderer.pixelRatio,
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
    dispose() {
      effects.dispose();
      scene.dispose();
      renderer.dispose();
    },
  };
}
