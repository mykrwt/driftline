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
import { createImpostorGeometry } from './chunks.js';

const BASE = './assets/models/';

/**
 * @typedef {object} CarAssetSpec
 * @property {string} file
 * @property {number} length  target length in metres
 * @property {string} [label]
 */

/**
 * The cars are built procedurally (see car.js), so there are no car models
 * to download. The entry stays for the ghosts, which pick a shape.
 * @type {Record<string, CarAssetSpec>}
 */
export const CAR_ASSETS = {};

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
  treePineSlim: { file: 'nature-kit/Models/GLTF format/tree_pineSmallA.glb', height: 9 },
  treePineWide: { file: 'nature-kit/Models/GLTF format/tree_pineDefaultA.glb', height: 11 },
  treeTall: { file: 'nature-kit/Models/GLTF format/tree_tall.glb', height: 12 },
  treeFat: { file: 'nature-kit/Models/GLTF format/tree_fat.glb', height: 8 },
  treeCone: { file: 'nature-kit/Models/GLTF format/tree_cone.glb', height: 10 },
  treeDetailed: { file: 'nature-kit/Models/GLTF format/tree_detailed.glb', height: 11 },
  treeSimple: { file: 'nature-kit/Models/GLTF format/tree_simple.glb', height: 9 },
  treePalm: { file: 'nature-kit/Models/GLTF format/tree_palmTall.glb', height: 10 },
  bush: { file: 'nature-kit/Models/GLTF format/plant_bush.glb', height: 1.6 },
  bushSmall: { file: 'nature-kit/Models/GLTF format/plant_bushSmall.glb', height: 0.9 },
  bushLarge: { file: 'nature-kit/Models/GLTF format/plant_bushLarge.glb', height: 2.4 },
  rock: { file: 'nature-kit/Models/GLTF format/rock_largeA.glb', height: 2.4 },
  rockSmall: { file: 'nature-kit/Models/GLTF format/rock_smallA.glb', height: 1.1 },
  rockTall: { file: 'nature-kit/Models/GLTF format/rock_tallA.glb', height: 3.2 },
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
 * The palette of the scenery.
 *
 * The source models use a bright stylised palette (teal leaves, orange bark),
 * so every prop is re-tinted into a natural one: foliage green, brown wood
 * and grey rock.
 */
export const PROP_TINTS = {
  treeOak: { foliage: '#5a8a41', wood: '#7a583a' },
  tree: { foliage: '#4a7a35', wood: '#6f4f33' },
  treePine: { foliage: '#376a42', wood: '#63462e' },
  treePineShort: { foliage: '#3c7146', wood: '#63462e' },
  treePineSlim: { foliage: '#2f5c3a', wood: '#5d4229' },
  treePineWide: { foliage: '#417a4c', wood: '#6b4d33' },
  treeTall: { foliage: '#4d7d38', wood: '#71522f' },
  treeFat: { foliage: '#568c3f', wood: '#6f4f33' },
  treeCone: { foliage: '#3d7038', wood: '#6a4a30' },
  treeDetailed: { foliage: '#477a37', wood: '#6b4c30' },
  treeSimple: { foliage: '#5b8c44', wood: '#7a583a' },
  treePalm: { foliage: '#4a8446', wood: '#8a6a44' },
  bush: { foliage: '#5e8c44', wood: '#6f4f33' },
  bushSmall: { foliage: '#67964a', wood: '#6f4f33' },
  bushLarge: { foliage: '#557f3e', wood: '#6f4f33' },
  grass: { foliage: '#7aa654', wood: '#7aa654' },
  rock: { foliage: '#989ba2', wood: '#878a91' },
  rockSmall: { foliage: '#9ea1a8', wood: '#8d9097' },
  rockTall: { foliage: '#8b8e95', wood: '#7d8087' },
  stump: { foliage: '#7a583a', wood: '#7a583a' },
  log: { foliage: '#7a583a', wood: '#7a583a' },
  cactus: { foliage: '#568a4b', wood: '#568a4b' },
};

/**
 * @param {THREE.Material} material
 * @param {{ foliage?: string, wood?: string } | null} tints
 * @returns {THREE.Color | null}
 */
function tintFor(material, tints) {
  if (!tints) return null;
  const color = /** @type {any} */ (material)?.color;
  if (!color) return null;
  // The teal foliage is the only material with more green than red.
  const foliage = color.g >= color.r;
  const hex = foliage ? tints.foliage : tints.wood;
  return hex ? new THREE.Color(hex) : null;
}

/**
 * Re-tint a whole scene: every mesh gets the colour of its material group.
 *
 * @param {THREE.Object3D} root
 * @param {{ foliage?: string, wood?: string } | null} tints
 */
function tintScene(root, tints) {
  if (!tints) return;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material;
    if (Array.isArray(material)) return;
    const tint = tintFor(material, tints);
    if (!tint) return;
    // The geometry is cloned: the source scene is shared with the props and
    // it must not be changed underneath them.
    const geometry = object.geometry.clone();
    const count = geometry.getAttribute('position')?.count ?? 0;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    object.geometry = geometry;
    // The clone shares the materials with the source, so they are copied
    // before they are changed.
    const own = material.clone();
    own.color = new THREE.Color(0xffffff);
    own.vertexColors = true;
    // The models use a palette texture: the tint is the final colour, so
    // the texture has to go or it would darken everything twice.
    own.map = null;
    own.needsUpdate = true;
    object.material = own;
  });
}

/**
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Material | THREE.Material[]} material
 * @param {THREE.Color | null} [tint]
 * @returns {THREE.BufferGeometry}
 */
function normalizeGeometry(geometry, material, tint = null) {
  const clone = geometry.clone();
  clone.applyMatrix4(geometry.userData?.worldMatrix ?? new THREE.Matrix4());
  if (!clone.getAttribute('normal')) clone.computeVertexNormals();

  // Every merged geometry needs the same set of attributes.
  const count = clone.getAttribute('position').count;
  if (tint) {
    // The tint replaces the colour of the model completely.
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }
    clone.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  } else if (!clone.getAttribute('color')) {
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
 * @param {{ foliage?: string, wood?: string } | null} [tints]
 * @returns {{ geometry: THREE.BufferGeometry, material: THREE.Material }[]}
 */
function mergeByMaterial(root, tints = null) {
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
    const group = groups.get(key);
    const tint = tintFor(group.material, tints);
    const geometry = normalizeGeometry(object.geometry, group.material, tint);
    geometry.applyMatrix4(object.matrixWorld);
    group.parts.push(geometry);
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
    // The tint lives in the vertex colours, so the material stays white.
    if (tints) {
      material.color = new THREE.Color(0xffffff);
      material.vertexColors = true;
      // The models use a palette texture: the tint is the final colour.
      material.map = null;
    }
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
  /** @type {Map<string, { geometry: THREE.BufferGeometry, material: THREE.Material }>} */
  const impostors = new Map();
  /** @type {Record<string, HTMLImageElement>} */
  const textures = {};
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
    const groups = mergeByMaterial(clone, PROP_TINTS[key] ?? null);
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

  /**
   * @param {string} name
   * @returns {Promise<HTMLImageElement>}
   */
  function loadTexture(name) {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(image);
      image.src = `./assets/textures/${name}.jpg`;
    });
  }

  return {
    /** @returns {boolean} */
    get ready() {
      return ready;
    },
    /** @returns {Record<string, HTMLImageElement>} */
    get textures() {
      return textures;
    },
    /**
     * Load everything up front so the race never stutters.
     * @param {(loaded: number, total: number) => void} [onProgress]
     */
    async loadAll(onProgress) {
      const total = Object.keys(CAR_ASSETS).length + Object.keys(PROP_ASSETS).length + 2;
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
      // Photographic ground textures (CC0, Poly Haven).
      await Promise.all([
        loadTexture('asphalt_diff').then((image) => {
          textures.asphalt = image;
        }),
        loadTexture('ground_diff').then((image) => {
          textures.ground = image;
        }),
      ]);
      ready = true;
      return { cars, props, textures };
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
    /**
     * Build a billboard impostor for a model: the model is rendered once into
     * a texture and then drawn with a few crossed quads, which is far cheaper
     * than thousands of real trees.
     * @param {any} renderer
     * @param {string} key
     * @param {{ size?: number }} [options]
     * @returns {{ geometry: THREE.BufferGeometry, material: THREE.Material } | null}
     */
    impostor(renderer, key, options = {}) {
      const cacheKey = `impostor:${key}`;
      if (impostors.has(cacheKey)) return impostors.get(cacheKey);
      const source = scenes.get(key);
      if (!source) return null;

      const size = options.size ?? 192;
      const preview = new THREE.Scene();
      const clone = source.clone(true);
      // The source models use a teal palette, so they are re-tinted before
      // they are baked into the billboard.
      tintScene(clone, PROP_TINTS[key] ?? null);
      // The billboard has the size of the real thing, so the trees stand on
      // the ground like the models do.
      normalizeScene(clone, PROP_ASSETS[key]?.height ?? 0);
      preview.add(clone);
      const box = new THREE.Box3().setFromObject(clone);
      const dimensions = new THREE.Vector3();
      const centre = new THREE.Vector3();
      box.getSize(dimensions);
      box.getCenter(centre);

      // Light the preview so the baked texture has the real colours. The
      // light is flat on purpose: a tree that is baked with a hard key light
      // comes out half black.
      preview.add(new THREE.HemisphereLight(0xbfd7ff, 0x6a7a62, 2.6));
      preview.add(new THREE.AmbientLight(0xffffff, 1.1));
      const keyLight = new THREE.DirectionalLight(0xfff2d6, 1.5);
      keyLight.position.set(centre.x + 30, centre.y + 40, 40);
      preview.add(keyLight);

      const width = Math.max(32, Math.round(size));
      const height = Math.max(32, Math.round((size * dimensions.y) / Math.max(0.001, dimensions.x)));
      const target = new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
      });
      const camera = new THREE.OrthographicCamera(
        -dimensions.x / 2,
        dimensions.x / 2,
        dimensions.y / 2,
        -dimensions.y / 2,
        0.1,
        400,
      );
      camera.position.set(centre.x, centre.y, 60);
      camera.lookAt(centre);
      const previousTarget = renderer.getRenderTarget();
      const previousClear = renderer.getClearColor(new THREE.Color());
      const previousAlpha = renderer.getClearAlpha();
      // The colour space has to be set before the render: the renderer writes
      // sRGB into the target, and the shader reads it back as sRGB.
      target.texture.colorSpace = THREE.SRGBColorSpace;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(preview, camera);
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(previousClear, previousAlpha);

      const geometry = createImpostorGeometry(dimensions.x, dimensions.y);
      const material = new THREE.MeshStandardMaterial({
        map: target.texture,
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        roughness: 0.95,
        metalness: 0,
        // The texture lights itself a little, so a tree in the shade of a
        // mountain does not turn into a black blob.
        emissive: new THREE.Color(0x2b3328),
        emissiveMap: target.texture,
        emissiveIntensity: 0.55,
      });
      // A gentle wind sway keeps the far forest alive.
      const timeUniform = { value: 0 };
      material.userData.time = timeUniform;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = timeUniform;
        shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           #ifdef USE_INSTANCING
             float sway = sin(uTime * 1.3 + instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.17);
             transformed.x += sway * 0.07 * max(0.0, transformed.y);
           #endif`,
        );
      };
      const result = { geometry, material };
      impostors.set(cacheKey, result);
      return result;
    },
    /** @returns {string[]} */
    carKeys() {
      return Array.from(cars.keys());
    },
    /**
     * Advance the animated materials (the wind on the far forest).
     * @param {number} time seconds
     */
    tick(time) {
      for (const entry of impostors.values()) {
        const uniform = entry.material.userData?.time;
        if (uniform) uniform.value = time;
      }
    },
    /** @returns {string[]} */
    propKeys() {
      return Array.from(props.keys());
    },
  };
}
