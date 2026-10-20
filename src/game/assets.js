/**
 * Asset pipeline.
 *
 * The world is built from CC0 asset packs (Kenney) that are vendored into
 * `assets/models`, plus a few procedural pieces. Everything is normalised on
 * load: models are scaled to real world metres, grounded on y = 0 and merged
 * where possible so the scene stays at a couple of dozen draw calls.
 *
 * Credits: Kenney (CC0) - car kit, racing kit, nature kit, city kit roads.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { GLTFLoader } from '../../vendor/three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from '../../vendor/three/addons/utils/BufferGeometryUtils.js';

const BASE = './assets/models/';

/**
 * @typedef {object} CarAssetSpec
 * @property {string} file
 * @property {number} length  target length in metres
 * @property {string} [label]
 */

/** @type {Record<string, CarAssetSpec>} */
export const CAR_ASSETS = {
  vector: { file: 'car-kit/Models/GLB format/sedan-sports.glb', length: 4.3, label: 'Vector GT' },
  comet: { file: 'car-kit/Models/GLB format/race.glb', length: 4.1, label: 'Comet RS' },
  bulldozer: { file: 'car-kit/Models/GLB format/truck.glb', length: 5.2, label: 'Bulldozer V8' },
  ghost1: { file: 'car-kit/Models/GLB format/hatchback-sports.glb', length: 4.1 },
  ghost2: { file: 'car-kit/Models/GLB format/suv-luxury.glb', length: 4.9 },
  ghost3: { file: 'car-kit/Models/GLB format/kart-oobi.glb', length: 2.4 },
  ghost4: { file: 'car-kit/Models/GLB format/race-future.glb', length: 4.2 },
  ghost5: { file: 'car-kit/Models/GLB format/taxi.glb', length: 4.4 },
  ghost6: { file: 'car-kit/Models/GLB format/van.glb', length: 5 },
};

/**
 * @typedef {object} PropAssetSpec
 * @property {string} file
 * @property {number} height target height in metres (0 = keep as is)
 * @property {boolean} [keepScene] keep the original multi mesh scene
 */

/** @type {Record<string, PropAssetSpec>} */
export const PROP_ASSETS = {
  tree: { file: 'nature-kit/Models/GLTF format/tree_default.glb', height: 9 },
  treeOak: { file: 'nature-kit/Models/GLTF format/tree_oak.glb', height: 11 },
  treePine: { file: 'nature-kit/Models/GLTF format/tree_pineTallA.glb', height: 12 },
  treePineShort: { file: 'nature-kit/Models/GLTF format/tree_pineRoundA.glb', height: 8 },
  treePalm: { file: 'nature-kit/Models/GLTF format/tree_palmTall.glb', height: 10 },
  bush: { file: 'nature-kit/Models/GLTF format/plant_bush.glb', height: 1.6 },
  bushSmall: { file: 'nature-kit/Models/GLTF format/plant_bushSmall.glb', height: 0.9 },
  rock: { file: 'nature-kit/Models/GLTF format/rock_largeA.glb', height: 2.4 },
  rockSmall: { file: 'nature-kit/Models/GLTF format/rock_smallA.glb', height: 1.1 },
  stump: { file: 'nature-kit/Models/GLTF format/stump_round.glb', height: 1.4 },
  log: { file: 'nature-kit/Models/GLTF format/log.glb', height: 1.2 },
  cactus: { file: 'nature-kit/Models/GLTF format/cactus_tall.glb', height: 3.4 },
  grass: { file: 'nature-kit/Models/GLTF format/grass.glb', height: 0.8 },
  cone: { file: 'city-kit-roads/Models/GLTF format/construction-cone.glb', height: 0.9, keepScene: true },
  barrier: { file: 'racing-kit/Models/GLTF format/barrierRed.glb', height: 1.1, keepScene: true },
  barrierWhite: { file: 'racing-kit/Models/GLTF format/barrierWhite.glb', height: 1.1, keepScene: true },
  lightPost: { file: 'racing-kit/Models/GLTF format/lightPostModern.glb', height: 6.5, keepScene: true },
  gantry: { file: 'racing-kit/Models/GLTF format/overhead.glb', height: 8, keepScene: true },
  flag: { file: 'racing-kit/Models/GLTF format/flagCheckers.glb', height: 2.2, keepScene: true },
  billboard: { file: 'racing-kit/Models/GLTF format/billboard.glb', height: 5, keepScene: true },
  grandStand: { file: 'racing-kit/Models/GLTF format/grandStand.glb', height: 8, keepScene: true },
  pylon: { file: 'racing-kit/Models/GLTF format/pylon.glb', height: 1.2, keepScene: true },
  sign: { file: 'city-kit-roads/Models/GLTF format/road-sign-empty.glb', height: 3.2, keepScene: true },
  pole: { file: 'city-kit-roads/Models/GLTF format/electricity-pole.glb', height: 8, keepScene: true },
};

/**
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Material | THREE.Material[]} material
 * @returns {THREE.BufferGeometry}
 */
function normalizeGeometry(geometry, material) {
  const clone = geometry.clone();
  clone.applyMatrix4(geometry.userData?.worldMatrix ?? new THREE.Matrix4());
  if (!clone.getAttribute('normal')) clone.computeVertexNormals();

  // Every merged geometry needs the same set of attributes.
  const count = clone.getAttribute('position').count;
  if (!clone.getAttribute('color')) {
    const materialColor = new THREE.Color(0xffffff);
    if (Array.isArray(material) && material[0]?.color) materialColor.copy(material[0].color);
    else if (!Array.isArray(material) && /** @type {any} */ (material)?.color) materialColor.copy(/** @type {any} */ (material).color);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = materialColor.r;
      colors[i * 3 + 1] = materialColor.g;
      colors[i * 3 + 2] = materialColor.b;
    }
    clone.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  if (!clone.getAttribute('uv')) {
    clone.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  // Drop everything else so the merge never fails.
  for (const name of Object.keys(clone.attributes)) {
    if (!['position', 'normal', 'color', 'uv'].includes(name)) clone.deleteAttribute(name);
  }
  clone.clearGroups();
  return clone;
}

/**
 * Scale and ground a model so it sits in the world like a real object.
 * @param {THREE.Object3D} root
 * @param {number} targetHeight desired height in metres (0 keeps the size)
 * @param {number} [length] desired length in metres
 */
/**
 * Reject a promise that takes too long.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout loading ${label}`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function normalizeScene(root, targetHeight, length) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const scale = targetHeight > 0 && size.y > 0 ? targetHeight / size.y : 1;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  const scaled = new THREE.Box3().setFromObject(root);
  const scaledSize = new THREE.Vector3();
  scaled.getSize(scaledSize);
  if (length && scaledSize.z > 0) {
    const lengthScale = length / scaledSize.z;
    root.scale.multiplyScalar(lengthScale);
    root.updateMatrixWorld(true);
  }

  const finalBox = new THREE.Box3().setFromObject(root);
  root.position.y -= finalBox.min.y;
  root.updateMatrixWorld(true);
}

/**
 * Merge a model into one geometry per material so it can be instanced.
 * @param {THREE.Object3D} root
 * @returns {{ geometry: THREE.BufferGeometry, material: THREE.Material }[]}
 */
function mergeByMaterial(root) {
  /** @type {Map<string, { material: THREE.Material, parts: THREE.BufferGeometry[] }>} */
  const groups = new Map();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material;
    const key = Array.isArray(material) ? material[0]?.uuid ?? 'multi' : material.uuid;
    if (!groups.has(key)) {
      groups.set(key, { material: Array.isArray(material) ? material[0] : material, parts: [] });
    }
    const geometry = normalizeGeometry(object.geometry, material);
    geometry.applyMatrix4(object.matrixWorld);
    groups.get(key).parts.push(geometry);
  });

  const result = [];
  for (const group of groups.values()) {
    if (group.parts.length === 0) continue;
    const merged = mergeGeometries(group.parts);
    group.parts.forEach((part) => part.dispose());
    merged.computeBoundingSphere();
    const material = group.material?.clone?.() ?? new THREE.MeshStandardMaterial({ color: 0xffffff });
    material.roughness = 0.85;
    material.metalness = 0.02;
    if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
    result.push({ geometry: merged, material });
  }
  return result;
}

/**
 * Loads and caches the asset library.
 */
export function createAssetLibrary() {
  const loader = new GLTFLoader();
  /** @type {Map<string, any>} */
  const scenes = new Map();
  /** @type {Map<string, { geometry: THREE.BufferGeometry, material: THREE.Material }>} */
  const props = new Map();
  /** @type {Map<string, { body: THREE.Object3D, wheels: THREE.Object3D[] }>} */
  const cars = new Map();
  let ready = false;

  /**
   * @param {string} key
   * @param {string} file
   * @returns {Promise<any>}
   */
  async function loadScene(key, file) {
    if (scenes.has(key)) return scenes.get(key);
    const promise = loader.loadAsync(BASE + file).then((gltf) => {
      scenes.set(key, gltf.scene);
      return gltf.scene;
    });
    scenes.set(key, promise);
    return promise;
  }

  /**
   * @param {string} key
   * @param {PropAssetSpec} spec
   */
  async function loadProp(key, spec) {
    const scene = await loadScene(key, spec.file);
    const clone = scene.clone(true);
    normalizeScene(clone, spec.height);
    const groups = mergeByMaterial(clone);
    return { groups };
  }

  /**
   * @param {string} key
   * @param {CarAssetSpec} spec
   */
  async function loadCar(key, spec) {
    const scene = await loadScene(key, spec.file);
    const clone = scene.clone(true);
    normalizeScene(clone, 0, spec.length);

    /** @type {THREE.Object3D[]} */
    const wheels = [];
    /** @type {THREE.Object3D[]} */
    const bodyParts = [];
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.material = object.material?.clone?.() ?? new THREE.MeshStandardMaterial();
        object.material.roughness = 0.45;
        object.material.metalness = 0.25;
        object.castShadow = false;
        object.receiveShadow = false;
      }
      const name = (object.name || '').toLowerCase();
      if (object instanceof THREE.Mesh && name.includes('wheel')) wheels.push(object);
      else if (object instanceof THREE.Mesh) bodyParts.push(object);
    });

    const root = new THREE.Group();
    for (const part of bodyParts) {
      part.position.sub(new THREE.Vector3(0, 0, 0));
      root.add(part);
    }
    for (const wheel of wheels) root.add(wheel);

    return { root, wheels };
  }

  return {
    /** @returns {boolean} */
    get ready() {
      return ready;
    },
    /**
     * Load everything up front so the race never stutters.
     * @param {(loaded: number, total: number) => void} [onProgress]
     */
    async loadAll(onProgress) {
      const total = Object.keys(CAR_ASSETS).length + Object.keys(PROP_ASSETS).length;
      let done = 0;
      const track = (job) =>
        job
          .catch((err) => {
            console.warn('[driftline] asset skipped', err?.message || err);
          })
          .finally(() => {
            done++;
            onProgress?.(done, total);
          });

      const jobs = [
        ...Object.entries(CAR_ASSETS).map(([key, spec]) =>
          track(withTimeout(loadCar(key, spec).then((car) => cars.set(key, car)), 15000, `car ${key}`)),
        ),
        ...Object.entries(PROP_ASSETS).map(([key, spec]) =>
          track(withTimeout(loadProp(key, spec).then((prop) => props.set(key, prop)), 15000, `prop ${key}`)),
        ),
      ];
      await Promise.all(jobs);
      ready = true;
      return { cars, props };
    },
    /**
     * @param {string} key
     * @returns {{ body: THREE.Object3D, wheels: THREE.Object3D[] } | null}
     */
    car(key) {
      return cars.get(key) ?? null;
    },
    /**
     * @param {string} key
     * @returns {{ groups: { geometry: THREE.BufferGeometry, material: THREE.Material }[] } | null}
     */
    prop(key) {
      return props.get(key) ?? null;
    },
    /** @returns {string[]} */
    carKeys() {
      return Array.from(cars.keys());
    },
    /** @returns {string[]} */
    propKeys() {
      return Array.from(props.keys());
    },
  };
}
