/**
 * Asset pipeline.
 *
 * Normalises CC0 Kenney models to real-world metres, applies natural multi-tone
 * canopy & bark vertex shading, and bakes crisp mipmapped crossed-billboard
 * impostors that respond dynamically to Alpine Day, Golden Hour, and Midnight.
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

/** @type {Record<string, CarAssetSpec>} */
export const CAR_ASSETS = {};

/**
 * @typedef {object} PropAssetSpec
 * @property {string} file
 * @property {number} height target height in metres (0 = keep as is)
 * @property {boolean} [keepScene] keep the original multi mesh scene
 * @property {number} [yaw] radians to turn the model before it is placed
 */

/** @type {Record<string, PropAssetSpec>} */
export const PROP_ASSETS = {
  tree: { file: 'nature-kit/Models/GLTF format/tree_default.glb', height: 9.5 },
  treeOak: { file: 'nature-kit/Models/GLTF format/tree_oak.glb', height: 11.5 },
  treePine: { file: 'nature-kit/Models/GLTF format/tree_pineTallA.glb', height: 13.5 },
  treePineShort: { file: 'nature-kit/Models/GLTF format/tree_pineRoundA.glb', height: 8.5 },
  treePineSlim: { file: 'nature-kit/Models/GLTF format/tree_pineSmallA.glb', height: 10 },
  treePineWide: { file: 'nature-kit/Models/GLTF format/tree_pineDefaultA.glb', height: 12 },
  treeTall: { file: 'nature-kit/Models/GLTF format/tree_tall.glb', height: 12.5 },
  treeFat: { file: 'nature-kit/Models/GLTF format/tree_fat.glb', height: 8.5 },
  treeCone: { file: 'nature-kit/Models/GLTF format/tree_cone.glb', height: 10.5 },
  treeDetailed: { file: 'nature-kit/Models/GLTF format/tree_detailed.glb', height: 11.5 },
  treeSimple: { file: 'nature-kit/Models/GLTF format/tree_simple.glb', height: 9 },
  treePalm: { file: 'nature-kit/Models/GLTF format/tree_palmTall.glb', height: 10 },
  bush: { file: 'nature-kit/Models/GLTF format/plant_bush.glb', height: 1.5 },
  bushSmall: { file: 'nature-kit/Models/GLTF format/plant_bushSmall.glb', height: 0.85 },
  bushLarge: { file: 'nature-kit/Models/GLTF format/plant_bushLarge.glb', height: 2.2 },
  rock: { file: 'nature-kit/Models/GLTF format/rock_largeA.glb', height: 1.45 },
  rockSmall: { file: 'nature-kit/Models/GLTF format/rock_smallA.glb', height: 0.72 },
  rockTall: { file: 'nature-kit/Models/GLTF format/rock_tallA.glb', height: 1.95 },
  stump: { file: 'nature-kit/Models/GLTF format/stump_round.glb', height: 0.85 },
  log: { file: 'nature-kit/Models/GLTF format/log.glb', height: 0.9 },
  cactus: { file: 'nature-kit/Models/GLTF format/cactus_tall.glb', height: 3.4 },
  grass: { file: 'nature-kit/Models/GLTF format/grass.glb', height: 0.7 },
  cone: { file: 'city-kit-roads/Models/GLTF format/construction-cone.glb', height: 0.85, keepScene: true },
  barrier: { file: 'racing-kit/Models/GLTF format/barrierRed.glb', height: 1.0, keepScene: true, yaw: Math.PI / 2 },
  barrierWhite: { file: 'racing-kit/Models/GLTF format/barrierWhite.glb', height: 1.0, keepScene: true, yaw: Math.PI / 2 },
  rail: { file: 'racing-kit/Models/GLTF format/rail.glb', height: 1.05, keepScene: true, yaw: Math.PI / 2 },
  fence: { file: 'racing-kit/Models/GLTF format/fenceStraight.glb', height: 1.15, keepScene: true, yaw: Math.PI / 2 },
  lightPost: { file: 'racing-kit/Models/GLTF format/lightPostModern.glb', height: 6.2, keepScene: true },
  gantry: { file: 'racing-kit/Models/GLTF format/overhead.glb', height: 8, keepScene: true },
  flag: { file: 'racing-kit/Models/GLTF format/flagCheckers.glb', height: 2.2, keepScene: true },
  billboard: { file: 'racing-kit/Models/GLTF format/billboard.glb', height: 5, keepScene: true, yaw: Math.PI / 2 },
  grandStand: { file: 'racing-kit/Models/GLTF format/grandStand.glb', height: 8, keepScene: true },
  pylon: { file: 'racing-kit/Models/GLTF format/pylon.glb', height: 1.2, keepScene: true },
  sign: { file: 'city-kit-roads/Models/GLTF format/road-sign-empty.glb', height: 2.9, keepScene: true },
  pole: { file: 'city-kit-roads/Models/GLTF format/electricity-pole.glb', height: 8, keepScene: true },
};

/**
 * Rich sunlit natural alpine foliage, bark, and granite rock palette.
 */
export const PROP_TINTS = {
  treeOak: { foliage: '#689e48', foliageShade: '#365e2a', wood: '#7d5b3e' },
  tree: { foliage: '#5b9240', foliageShade: '#2e5525', wood: '#735337' },
  treePine: { foliage: '#437f52', foliageShade: '#1f4730', wood: '#664830' },
  treePineShort: { foliage: '#498656', foliageShade: '#224b33', wood: '#664830' },
  treePineSlim: { foliage: '#3e774c', foliageShade: '#1d422c', wood: '#60432b' },
  treePineWide: { foliage: '#478355', foliageShade: '#214931', wood: '#6d4f35' },
  treeTall: { foliage: '#5f9643', foliageShade: '#315928', wood: '#755532' },
  treeFat: { foliage: '#6aa14b', foliageShade: '#365f2b', wood: '#725236' },
  treeCone: { foliage: '#468049', foliageShade: '#214829', wood: '#6c4c32' },
  treeDetailed: { foliage: '#598f42', foliageShade: '#2f5626', wood: '#6e4f33' },
  treeSimple: { foliage: '#6ba04c', foliageShade: '#38622c', wood: '#7d5b3d' },
  treePalm: { foliage: '#58944f', foliageShade: '#2d5830', wood: '#8d6d47' },
  bush: { foliage: '#6b9f4c', foliageShade: '#39622b', wood: '#705034' },
  bushSmall: { foliage: '#74a854', foliageShade: '#3f6930', wood: '#705034' },
  bushLarge: { foliage: '#609246', foliageShade: '#335927', wood: '#705034' },
  grass: { foliage: '#84b25c', foliageShade: '#4c7534', wood: '#84b25c' },
  rock: { foliage: '#9599a1', foliageShade: '#666b75', wood: '#888c94' },
  rockSmall: { foliage: '#9da1a9', foliageShade: '#6c707a', wood: '#8f939b' },
  rockTall: { foliage: '#8c9099', foliageShade: '#5e626c', wood: '#7f838b' },
  stump: { foliage: '#856244', foliageShade: '#533b27', wood: '#856244' },
  log: { foliage: '#825f41', foliageShade: '#513925', wood: '#825f41' },
  cactus: { foliage: '#5c9150', foliageShade: '#335830', wood: '#5c9150' },
};

/**
 * Determine sunlit & shaded tint colours for a material group.
 * @param {THREE.Material} material
 * @param {{ foliage?: string, foliageShade?: string, wood?: string } | null} tints
 */
function tintPairFor(material, tints) {
  if (!tints) return null;
  const color = /** @type {any} */ (material)?.color;
  if (!color) return null;
  const isFoliage = color.g >= color.r;
  if (isFoliage && tints.foliage) {
    const hi = new THREE.Color(tints.foliage);
    const lo = tints.foliageShade ? new THREE.Color(tints.foliageShade) : hi.clone().multiplyScalar(0.58);
    return { hi, lo, foliage: true };
  }
  if (tints.wood) {
    const hi = new THREE.Color(tints.wood);
    const lo = hi.clone().multiplyScalar(0.66);
    return { hi, lo, foliage: false };
  }
  return null;
}

/**
 * Write natural height + normal crown shading into geometry vertex colours.
 * @param {THREE.BufferGeometry} geometry
 * @param {{ hi: THREE.Color, lo: THREE.Color }} pair
 */
function applyCrownGradient(geometry, pair) {
  const pos = geometry.getAttribute('position');
  if (!pos) return;
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const nor = geometry.getAttribute('normal');
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(0.001, maxY - minY);
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const hNorm = (pos.getY(i) - minY) / span;
    const upLight = nor ? Math.max(0, nor.getY(i) * 0.5 + 0.5) : 0.65;
    const t = Math.min(1, Math.max(0, hNorm * 0.68 + upLight * 0.32));
    tmp.copy(pair.lo).lerp(pair.hi, t);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * Re-tint a whole scene with rich 3D crown gradients before impostor baking.
 * @param {THREE.Object3D} root
 * @param {{ foliage?: string, foliageShade?: string, wood?: string } | null} tints
 */
function tintScene(root, tints) {
  if (!tints) return;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material;
    if (Array.isArray(material)) return;
    const pair = tintPairFor(material, tints);
    if (!pair) return;
    const geometry = object.geometry.clone();
    applyCrownGradient(geometry, pair);
    object.geometry = geometry;
    const own = material.clone();
    own.color = new THREE.Color(0xffffff);
    own.vertexColors = true;
    own.map = null;
    own.roughness = 0.88;
    own.metalness = 0.0;
    own.needsUpdate = true;
    object.material = own;
  });
}

/**
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Material | THREE.Material[]} material
 * @param {{ hi: THREE.Color, lo: THREE.Color } | null} [pair]
 * @returns {THREE.BufferGeometry}
 */
function normalizeGeometry(geometry, material, pair = null) {
  const clone = geometry.clone();
  clone.applyMatrix4(geometry.userData?.worldMatrix ?? new THREE.Matrix4());
  if (!clone.getAttribute('normal')) clone.computeVertexNormals();

  const count = clone.getAttribute('position').count;
  if (pair) {
    applyCrownGradient(clone, pair);
  } else if (!clone.getAttribute('color')) {
    const materialColor = new THREE.Color(0xffffff);
    if (Array.isArray(material) && material[0]?.color) materialColor.copy(material[0].color);
    else if (!Array.isArray(material) && /** @type {any} */ (material)?.color) {
      materialColor.copy(/** @type {any} */ (material).color);
    }
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
  for (const name of Object.keys(clone.attributes)) {
    if (!['position', 'normal', 'color', 'uv'].includes(name)) clone.deleteAttribute(name);
  }
  clone.clearGroups();
  return clone;
}

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

function normalizeScene(root, targetHeight, length, yaw = 0) {
  if (yaw) {
    root.rotation.y = yaw;
    root.updateMatrixWorld(true);
  }
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
  const finalSize = new THREE.Vector3();
  finalBox.getSize(finalSize);
  root.position.x -= finalBox.min.x + finalSize.x / 2;
  root.position.z -= finalBox.min.z + finalSize.z / 2;
  root.position.y -= finalBox.min.y;
  root.updateMatrixWorld(true);
}

/**
 * Merge a model into one geometry per material so it can be instanced.
 * @param {THREE.Object3D} root
 * @param {{ foliage?: string, foliageShade?: string, wood?: string } | null} [tints]
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
    const pair = tintPairFor(group.material, tints);
    const geometry = normalizeGeometry(object.geometry, group.material, pair);
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
    material.roughness = 0.86;
    material.metalness = 0.02;
    if (tints) {
      material.color = new THREE.Color(0xffffff);
      material.vertexColors = true;
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
  /** @type {Map<string, { groups: { geometry: THREE.BufferGeometry, material: THREE.Material }[] }>} */
  const props = new Map();
  /** @type {Map<string, { geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial }>} */
  const impostors = new Map();
  /** @type {Record<string, HTMLImageElement>} */
  const textures = {};
  /** @type {Map<string, { root: THREE.Object3D, wheels: THREE.Object3D[] }>} */
  const cars = new Map();
  let ready = false;
  let currentTint = '#ffffff';
  let currentEmissive = 0.56;

  async function loadScene(key, file) {
    if (scenes.has(key)) return scenes.get(key);
    const promise = loader.loadAsync(BASE + file).then((gltf) => {
      scenes.set(key, gltf.scene);
      return gltf.scene;
    });
    scenes.set(key, promise);
    return promise;
  }

  async function loadProp(key, spec) {
    const scene = await loadScene(key, spec.file);
    const clone = scene.clone(true);
    normalizeScene(clone, spec.height, undefined, spec.yaw ?? 0);
    const groups = mergeByMaterial(clone, PROP_TINTS[key] ?? null);
    return { groups };
  }

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
    for (const part of bodyParts) root.add(part);
    for (const wheel of wheels) root.add(wheel);
    return { root, wheels };
  }

  function loadTexture(name) {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(image);
      image.src = `./assets/textures/${name}.jpg`;
    });
  }

  return {
    get ready() {
      return ready;
    },
    get textures() {
      return textures;
    },
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
    car(key) {
      return cars.get(key) ?? null;
    },
    prop(key) {
      return props.get(key) ?? null;
    },
    /**
     * Bake a high-contrast sunlit 3D billboard impostor with mipmaps & live
     * time-of-day mood support.
     * @param {any} renderer
     * @param {string} key
     * @param {{ size?: number }} [options]
     */
    impostor(renderer, key, options = {}) {
      const cacheKey = `impostor:${key}`;
      if (impostors.has(cacheKey)) return impostors.get(cacheKey);
      const source = scenes.get(key);
      if (!source || typeof source.clone !== 'function') return null;

      const size = options.size ?? 256;
      const preview = new THREE.Scene();
      const clone = source.clone(true);
      tintScene(clone, PROP_TINTS[key] ?? null);
      normalizeScene(clone, PROP_ASSETS[key]?.height ?? 0, undefined, PROP_ASSETS[key]?.yaw ?? 0);
      preview.add(clone);

      const box = new THREE.Box3().setFromObject(clone);
      const dimensions = new THREE.Vector3();
      const centre = new THREE.Vector3();
      box.getSize(dimensions);
      box.getCenter(centre);

      // Natural outdoor bake rig: warm golden sun from upper right + cool alpine sky fill.
      preview.add(new THREE.HemisphereLight(0xd4e8ff, 0x5c6f52, 2.25));
      preview.add(new THREE.AmbientLight(0xffffff, 0.85));
      const keyLight = new THREE.DirectionalLight(0xfff1cf, 2.35);
      keyLight.position.set(centre.x + 36, centre.y + 52, 42);
      preview.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0xbcd9ff, 0.75);
      rimLight.position.set(centre.x - 32, centre.y + 24, 28);
      preview.add(rimLight);

      const width = Math.max(64, Math.round(size));
      const height = Math.max(64, Math.round((size * dimensions.y) / Math.max(0.001, dimensions.x)));
      const target = new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: true,
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
      const previousToneMapping = renderer.toneMapping;
      // Render raw sRGB without double tone-mapping compression during the bake!
      renderer.toneMapping = THREE.NoToneMapping;
      target.texture.colorSpace = THREE.SRGBColorSpace;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x2a4528, 0);
      renderer.clear();
      renderer.render(preview, camera);
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(previousClear, previousAlpha);
      renderer.toneMapping = previousToneMapping;

      const geometry = createImpostorGeometry(dimensions.x, dimensions.y);
      const material = new THREE.MeshStandardMaterial({
        map: target.texture,
        alphaTest: 0.42,
        side: THREE.DoubleSide,
        roughness: 0.94,
        metalness: 0,
        color: new THREE.Color(currentTint),
        emissive: new THREE.Color(currentTint),
        emissiveMap: target.texture,
        emissiveIntensity: currentEmissive,
      });

      const timeUniform = { value: 0 };
      material.userData.time = timeUniform;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = timeUniform;
        shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           #ifdef USE_INSTANCING
             float phase = instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.17;
             float sway = sin(uTime * 0.9 + phase) * 0.6
                        + sin(uTime * 1.7 + phase * 1.7) * 0.25;
             transformed.x += sway * 0.016 * max(0.0, transformed.y);
           #endif`,
        );
      };
      const result = { geometry, material };
      impostors.set(cacheKey, result);
      return result;
    },
    /**
     * Update foliage lighting mood live when switching Alpine Day / Golden Hour / Midnight.
     * @param {string} tintHex
     * @param {number} emissiveIntensity
     */
    setPaletteMood(tintHex = '#ffffff', emissiveIntensity = 0.56) {
      currentTint = tintHex;
      currentEmissive = emissiveIntensity;
      for (const entry of impostors.values()) {
        entry.material.color.set(tintHex);
        entry.material.emissive.set(tintHex);
        entry.material.emissiveIntensity = emissiveIntensity;
      }
    },
    carKeys() {
      return Array.from(cars.keys());
    },
    tick(time) {
      for (const entry of impostors.values()) {
        const uniform = entry.material.userData?.time;
        if (uniform) uniform.value = time;
      }
    },
    propKeys() {
      return Array.from(props.keys());
    },
  };
}
