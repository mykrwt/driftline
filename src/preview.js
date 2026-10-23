/**
 * Terrain look comparison (`terrain-preview.html`).
 *
 * Interactive browser showcase comparing terrain detail modes AND time-of-day
 * lighting moods from a sweeping scenic alpine overlook.
 */

import * as THREE from '../vendor/three/three.module.js';
import { createRenderer } from './game/renderer.js';
import { createWorldScene } from './game/scene.js';
import { createAssetLibrary } from './game/assets.js';
import { createRoadProfile, roadHeight, roadOffset } from './game/road.js';
import { PALETTES } from './game/palette.js';
import { applyTerrainDetail } from './shaders/terrainDetail.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('pv'));
const label = document.getElementById('pv-label');
const statsEl = document.getElementById('pv-stats');
const bar = document.getElementById('pv-bar');

const MODES = {
  a: {
    label: 'A - Alpine Pass',
    text: 'Triplanar rock strata, glacial lakes, wildflower pastures, exact triangle prop grounding & 360° snow horizons.',
    detail: 0,
    forest: 1,
    fog: 1,
  },
  b: {
    label: 'B - GPU Micro-Relief',
    text: 'Adds multi-octave GPU vertex displacement on slopes & crags while preserving the road edge.',
    detail: 1.5,
    forest: 1,
    fog: 1,
  },
  c: {
    label: 'C - Deep Forest',
    text: 'Dense conifer canopy sweeping across the mountain spurs with deeper alpine valley mist.',
    detail: 0,
    forest: 2.2,
    fog: 0.78,
  },
};

let mode = 'a';
let paletteKey = 'alpine';
let world = null;
let renderer = null;
let camera = null;
let assets = null;
let detail = null;

function setLabel() {
  const m = MODES[mode];
  const p = PALETTES[paletteKey] ?? PALETTES.alpine;
  label.innerHTML = `<b>${m.label} · ${p.label}</b><span>${m.text}</span>`;
}

function buildBar() {
  const modeButtons = Object.entries(MODES).map(([key, value]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = value.label;
    button.setAttribute('aria-pressed', String(key === mode));
    button.addEventListener('click', () => {
      mode = key;
      applyMode();
      buildBar();
      setLabel();
    });
    return button;
  });

  const paletteButtons = Object.entries(PALETTES).map(([key, value]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = value.label;
    button.setAttribute('aria-pressed', String(key === paletteKey));
    button.addEventListener('click', () => {
      paletteKey = key;
      world?.setPalette(PALETTES[key]);
      renderer?.setExposure?.(world.palette.exposure ?? 1);
      applyMode();
      buildBar();
      setLabel();
    });
    return button;
  });

  bar.replaceChildren(...modeButtons, ...paletteButtons);
}

function applyMode() {
  if (!world) return;
  const m = MODES[mode];
  const base = PALETTES[paletteKey] ?? PALETTES.alpine;
  if (detail) detail.uniform.value = m.detail;
  world.terrain.setForestDensity(m.forest);
  if (world.scene.fog) {
    world.scene.fog.near = base.fogStart * m.fog;
    world.scene.fog.far = base.fogEnd * m.fog;
  }
}

async function boot() {
  assets = createAssetLibrary();
  await assets.loadAll();

  const profile = createRoadProfile(20260920);
  renderer = createRenderer(canvas, { quality: 'high', autoQuality: true });
  camera = new THREE.PerspectiveCamera(58, 1, 0.3, 4500);

  world = createWorldScene(profile, {
    seed: 20260920,
    assets,
    renderer: renderer.renderer,
    palette: PALETTES[paletteKey],
  });
  renderer.setExposure?.(world.palette.exposure ?? 1);
  detail = applyTerrainDetail(world.terrainMaterial, { amplitude: 0, frequency: 0.038, octaves: 3 });

  const centreZ = 250;
  const centreX = roadOffset(profile, centreZ);
  const groundY = roadHeight(profile, centreZ);

  buildBar();
  setLabel();
  applyMode();

  let last = performance.now();
  let frames = 0;
  let fps = 60;
  let elapsed = 0;

  let paused = false;
  const renderAt = (t) => {
    const camX = centreX + Math.cos(t) * 68;
    const camZ = centreZ - 95 + Math.sin(t * 0.7) * 42;
    const camY = groundY + 34;

    world.update(centreZ, centreX, centreZ, elapsed);
    renderer.render(world.scene, {
      x: camX,
      y: camY,
      z: camZ,
      lookX: centreX + 24,
      lookY: groundY + 6,
      lookZ: centreZ + 130,
      fov: 58,
      roll: 0,
    });
    const info = renderer.renderer.info;
    statsEl.textContent = `${fps.toFixed(0)} fps\n${info.render.calls} calls\n${(info.render.triangles / 1000).toFixed(0)}k tris`;
  };

  /** @type {any} */ (globalThis).__preview = {
    pause(v = true) { paused = v; },
    setMode(m) { mode = m; applyMode(); buildBar(); setLabel(); renderAt(0.4); },
    setPalette(k) {
      paletteKey = k;
      world?.setPalette(PALETTES[k]);
      renderer?.setExposure?.(world.palette.exposure ?? 1);
      applyMode();
      buildBar();
      setLabel();
      renderAt(0.4);
    },
    renderOnce(t = 0.4) { renderAt(t); },
  };

  const loop = () => {
    if (!paused) requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    elapsed += dt;
    frames++;
    if (frames % 20 === 0) fps = 1 / Math.max(0.001, dt);
    renderAt(elapsed * 0.14);
  };
  loop();
}

boot().catch((err) => {
  label.innerHTML = `<b>Failed to start</b><span>${String(err)}</span>`;
  console.error(err);
});
