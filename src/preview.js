/**
 * Terrain look comparison.
 *
 * A small harness that renders the same stretch of the endless world in three
 * different looks so they can be compared from the same camera:
 *
 *   A  CPU mountains      - the current look: chunked heightfield, vertex
 *                          coloured slopes, billboard forests, photo textures.
 *   B  GPU detail         - A plus a fine simplex displacement in the vertex
 *                          shader: crisper silhouettes for almost no cost.
 *   C  Deep forest        - A with a much denser forest and a mistier
 *                          atmosphere for the "wall of trees" look.
 */

import * as THREE from '../vendor/three/three.module.js';
import { createRenderer } from './game/renderer.js';
import { createWorldScene } from './game/scene.js';
import { createAssetLibrary } from './game/assets.js';
import { createRoadProfile, roadHeight, roadOffset } from './game/road.js';
import { applyTerrainDetail } from './shaders/terrainDetail.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('pv'));
const label = document.getElementById('pv-label');
const statsEl = document.getElementById('pv-stats');
const bar = document.getElementById('pv-bar');

const MODES = {
  a: {
    label: 'A - CPU mountains',
    text: 'Chunked heightfield, vertex coloured slopes, photo textures, billboard forests. The physics and the mesh share one height function.',
    detail: 0,
    forest: 1,
    fog: 1,
  },
  b: {
    label: 'B - GPU detail',
    text: 'Same mountains, plus a fine simplex displacement in the vertex shader. Crisper rock and rubble for free (the physics ignores the few centimetres it adds).',
    detail: 1.9,
    forest: 1,
    fog: 1,
  },
  c: {
    label: 'C - Deep forest',
    text: 'A denser forest on the slopes with a deeper haze: the "wall of trees" look.',
    detail: 0,
    forest: 2.6,
    fog: 1.5,
  },
};

let mode = 'a';
let world = null;
let renderer = null;
let camera = null;
let assets = null;
let detail = null;

function setLabel() {
  const m = MODES[mode];
  label.innerHTML = `<b>${m.label}</b><span>${m.text}</span>`;
}

function buildBar() {
  bar.replaceChildren(
    ...Object.entries(MODES).map(([key, value]) => {
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
    }),
  );
}

function applyMode() {
  const m = MODES[mode];
  if (detail) detail.uniform.value = m.detail;
  world.terrain.setForestDensity(m.forest);
  if (world.scene.fog) {
    world.scene.fog.far = 620 * m.fog;
    world.scene.fog.near = 220 * m.fog;
  }
}

async function boot() {
  assets = createAssetLibrary();
  await assets.loadAll();

  const profile = createRoadProfile(20260920);
  renderer = createRenderer(canvas, { quality: 'high', autoQuality: true });
  camera = new THREE.PerspectiveCamera(58, 1, 0.3, 4000);

  world = createWorldScene(profile, {
    seed: 20260920,
    assets,
    renderer: renderer.renderer,
  });
  detail = applyTerrainDetail(world.terrainMaterial, { amplitude: 0, frequency: 0.04, octaves: 3 });

  const centreZ = 260;
  const centreX = roadOffset(profile, centreZ);
  const groundY = roadHeight(profile, centreZ);
  camera.position.set(centreX + 90, groundY + 46, centreZ - 70);
  camera.lookAt(centreX, groundY + 4, centreZ + 40);

  buildBar();
  setLabel();
  applyMode();

  let last = performance.now();
  let frames = 0;
  let fps = 60;
  const loop = () => {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frames++;
    if (frames % 20 === 0) fps = 20 / Math.max(0.001, dt * 20);

    // A slow orbit around the valley.
    const t = now * 0.00004;
    const radius = 120;
    camera.position.x = centreX + Math.cos(t) * radius;
    camera.position.z = centreZ - 60 + Math.sin(t) * radius;
    camera.position.y = groundY + 52;
    camera.lookAt(centreX, groundY + 6, centreZ + 50);

    world.update(centreZ, centreX, centreZ);
    renderer.render(world.scene, { x: camera.position.x, y: camera.position.y, z: camera.position.z, lookX: centreX, lookY: groundY + 6, lookZ: centreZ + 50, fov: 58, roll: 0 });
    const info = renderer.renderer.info;
    statsEl.textContent = `${fps.toFixed(0)} fps\n${info.render.calls} calls\n${(info.render.triangles / 1000).toFixed(0)}k tris`;
  };
  loop();
}

boot().catch((err) => {
  label.innerHTML = `<b>Failed to start</b><span>${String(err)}</span>`;
  console.error(err);
});
