/**
 * WebGL renderer setup with adaptive resolution.
 *
 * The renderer keeps a rolling frame-time average and scales the pixel ratio
 * between a floor and a ceiling so the game stays smooth on weak phones
 * without wasting pixels on strong ones.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { createPost } from './post.js';

const QUALITY_PRESETS = {
  low: { pixelRatio: 0.75, maxPixelRatio: 1, antialias: false, fogEnd: 380, post: false },
  medium: { pixelRatio: 1, maxPixelRatio: 1.4, antialias: false, fogEnd: 520, post: true },
  high: { pixelRatio: 1.4, maxPixelRatio: 2, antialias: true, fogEnd: 760, post: true },
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ quality?: string, autoQuality?: boolean }} [options]
 */
export function createRenderer(canvas, options = {}) {
  let quality = options.quality ?? 'high';
  const preset = QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.high;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: preset.antialias,
    powerPreference: 'high-performance',
    stencil: false,
    alpha: false,
    // Needed for canvas snapshots (debug tooling).
    preserveDrawingBuffer: Boolean(globalThis.location?.search?.includes('capture')),
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.setClearColor(0x070912, 1);
  // Shadows are the single biggest visual upgrade the scene has, but they
  // cost a second pass over the geometry, so they are tied to the quality
  // preset.
  renderer.shadowMap.enabled = quality !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const camera = new THREE.PerspectiveCamera(62, 1, 0.25, 5000);
  camera.position.set(0, 3, 0);

  let width = 1;
  let height = 1;
  let pixelRatio = Math.min(preset.pixelRatio, globalThis.devicePixelRatio || 1);
  const maxPixelRatio = Math.min(preset.maxPixelRatio, globalThis.devicePixelRatio || 1);
  let autoQuality = options.autoQuality !== false;

  const post = createPost({
    width: 1,
    height: 1,
    pixelRatio: 1,
    enabled: preset.post !== false,
  });

  let frameAccum = 0;
  let frameCount = 0;
  let lastAdjust = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w === width && h === height) return false;
    width = w;
    height = h;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Keep a consistent vertical field of view on very wide or tall screens.
    camera.fov = camera.aspect < 1 ? 74 : 62;
    camera.updateProjectionMatrix();
    post.setSize(width, height, pixelRatio);
    return true;
  }

  resize();

  /**
   * Apply the pure-math camera state to the Three.js camera.
   * @param {import('./camera.js').CameraState} state
   */
  function applyCamera(state) {
    camera.position.set(state.x, state.y, state.z);
    camera.lookAt(state.lookX, state.lookY, state.lookZ);
    if (state.roll) camera.rotateZ(state.roll);
    if (Math.abs(camera.fov - state.fov) > 0.05) {
      camera.fov = state.fov;
      camera.updateProjectionMatrix();
    }
  }

  /**
   * Track the frame rate and adapt the resolution.
   * @param {number} dt
   * @param {number} now
   */
  function adapt(dt, now) {
    frameAccum += dt;
    frameCount++;
    if (frameAccum < 1.6) return;
    const fps = frameCount / frameAccum;
    frameAccum = 0;
    frameCount = 0;
    if (!autoQuality) return;
    if (now - lastAdjust < 2500) return;

    if (fps < 42 && pixelRatio > 0.55) {
      pixelRatio = Math.max(0.55, pixelRatio - 0.2);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      lastAdjust = now;
    } else if (fps > 58 && pixelRatio < maxPixelRatio) {
      pixelRatio = Math.min(maxPixelRatio, pixelRatio + 0.15);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      lastAdjust = now;
    }
  }

  canvas.addEventListener?.('webglcontextlost', (event) => {
    event.preventDefault?.();
  });

  return {
    renderer,
    camera,
    resize,
    applyCamera,
    adapt,
    /**
     * @param {THREE.Scene} scene
     * @param {import('./camera.js').CameraState} cameraState
     */
    render(scene, cameraState) {
      applyCamera(cameraState);
      post.render(renderer, scene, camera);
    },
    /**
     * @param {string} value
     */
    setQuality(value) {
      quality = value;
      const next = QUALITY_PRESETS[value] ?? QUALITY_PRESETS.high;
      maxPixelRatio = Math.min(next.maxPixelRatio, globalThis.devicePixelRatio || 1);
      pixelRatio = Math.min(next.pixelRatio, maxPixelRatio);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      renderer.shadowMap.enabled = value !== 'low';
      // Everything has to be marked for a new shadow pass.
      renderer.shadowMap.needsUpdate = true;
      post.setEnabled(next.post !== false);
      post.setSize(width, height, pixelRatio);
    },
    /** @param {boolean} value */
    setAutoQuality(value) {
      autoQuality = value;
    },
    /**
     * The tone mapping exposure, driven by the day and night palettes.
     * @param {number} value
     */
    setExposure(value) {
      renderer.toneMappingExposure = value;
    },
    /** @returns {number} */
    get pixelRatio() {
      return pixelRatio;
    },
    /** @returns {{ width: number, height: number }} */
    get size() {
      return { width, height };
    },
    dispose() {
      post.dispose();
      renderer.dispose();
    },
  };
}
