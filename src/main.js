/**
 * Driftline bootstrap.
 *
 * One endless world, three cars, drift scoring and serverless peer-to-peer
 * multiplayer. The host shares a world seed with the guests so everybody
 * drives the exact same road.
 */

import { createLoop } from './core/loop.js';
import { createInput, requestTiltPermission } from './core/input.js';
import { loadState, saveState } from './core/storage.js';
import { createAudio } from './game/audio.js';
import { createMenus } from './game/menus.js';
import { createHud } from './game/hud.js';
import { createWorld } from './game/world.js';
import { createRenderer } from './game/renderer.js';
import { createAssetLibrary } from './game/assets.js';
import { createSession } from './net/session.js';

const doc = globalThis.document;
const canvas = /** @type {HTMLCanvasElement} */ (doc.getElementById('game'));
const perfEl = doc.getElementById('perf');
const rotateHint = doc.getElementById('rotate');

const persisted = loadState();
const settings = persisted.settings;
const records = persisted.records;

const DRIVER_COLORS = [
  { color: '#ff3f6d', accent: '#ffd166' },
  { color: '#31d6ff', accent: '#e9fbff' },
  { color: '#ffa02b', accent: '#fff3d6' },
  { color: '#5df2a0', accent: '#eafff4' },
  { color: '#a97bff', accent: '#f0e7ff' },
];

function randomName() {
  const adjectives = ['Swift', 'Neon', 'Turbo', 'Ghost', 'Rally', 'Midnight', 'Wild', 'Silent'];
  const nouns = ['Comet', 'Falcon', 'Viper', 'Rider', 'Drifter', 'Wolf', 'Racer', 'Bandit'];
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]}${
    nouns[Math.floor(Math.random() * nouns.length)]
  }`;
}

if (!settings.name) settings.name = randomName();
const identity = DRIVER_COLORS[Math.floor(Math.random() * DRIVER_COLORS.length)];

const audio = createAudio();
audio.setVolume(settings.volume);
audio.setMuted(settings.muted);

const assets = createAssetLibrary();
// One renderer for the whole app: a canvas can only hold a single WebGL
// context, so the worlds share it.
const renderer = createRenderer(canvas, {
  quality: settings.quality,
  autoQuality: settings.autoQuality,
});

const input = createInput({
  steerElement: doc.getElementById('touch-steer'),
  knobElement: doc.getElementById('touch-knob'),
  buttons: {
    gas: doc.getElementById('btn-gas'),
    brake: doc.getElementById('btn-brake'),
    hand: doc.getElementById('btn-hand'),
    boost: doc.getElementById('btn-boost'),
  },
  tiltEnabled: settings.tiltSteer,
  tiltSensitivity: settings.tiltSensitivity,
  invertSteer: settings.invertSteer,
});

const hud = createHud();

/** @type {ReturnType<typeof createWorld> | null} */
let world = null;
/** @type {ReturnType<typeof createSession> | null} */
let session = null;
/** @type {'menu' | 'racing' | 'paused'} */
let phase = 'menu';
let lastHudUpdate = 0;
let peerScores = [];
let worldSeed = (Math.random() * 0xffffff) | 0;

const menus = createMenus({
  settings,
  onStart: () => {
    void audio.unlock();
    startRace({ seed: worldSeed });
  },
  onHost: () => {
    void audio.unlock();
    void hostRoom();
  },
  onJoin: () => {
    void audio.unlock();
    menus.showLobby({ mode: 'join' });
  },
  onLocalRoom: () => {
    void audio.unlock();
    void localRoom();
  },
  onLocalHost: () => {
    void audio.unlock();
    void localHostRoom();
  },
  onConnect: (code) => {
    void connectWithCode(code);
  },
  onAcceptAnswer: (code) => {
    void acceptAnswer(code);
  },
  onStartRace: () => {
    if (!session) {
      menus.toast('Create a room first', true);
      return;
    }
    worldSeed = (Math.random() * 0xffffff) | 0;
    session.startRace({ seed: worldSeed });
  },
  onLeaveLobby: () => {
    session?.leave();
    session = null;
    menus.show('title');
  },
  onResume: () => resumeRace(),
  onRestart: () => {
    world?.respawn();
    resumeRace();
  },
  onQuit: () => {
    quitToMenu();
  },
  onSettingsChange: (next) => {
    Object.assign(settings, next);
    saveState({ settings, records });
    applySettings();
  },
  onCopy: (text) => {
    void copyText(text, 'Invite code copied');
  },
  onShare: (text) => {
    void copyText(text, 'Invite code ready to share');
    if (navigator.share) {
      navigator.share({ title: 'Driftline', text: 'Join my Driftline run:', url: text }).catch(() => {});
    }
  },
});

/**
 * @param {string} text
 * @param {string} message
 */
async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    menus.toast(message);
  } catch {
    menus.toast('Copy failed - select the code manually', true);
  }
}

/**
 * @param {{ seed?: number }} config
 */
function startRace(config) {
  disposeWorld();
  world = createWorld({
    canvas,
    input,
    audio,
    assets,
    renderer,
    seed: config.seed ?? worldSeed,
    carId: settings.car,
    quality: { quality: settings.quality, autoQuality: settings.autoQuality },
  });

  world.on('respawn', () => hud.flash());

  menus.hideAll();
  hud.show();
  input.setEnabled(true);
  phase = 'racing';
  updateOrientationHint();
  loop.start();
}

function disposeWorld() {
  if (!world) return;
  world.dispose();
  world = null;
}

function pauseRace() {
  if (phase !== 'racing') return;
  phase = 'paused';
  loop.stop();
  menus.show('pause');
  input.setEnabled(false);
}

function resumeRace() {
  if (phase !== 'racing' && phase !== 'paused') return;
  menus.hideAll();
  hud.show();
  phase = 'racing';
  input.setEnabled(true);
  loop.start();
}

function quitToMenu() {
  loop.stop();
  phase = 'menu';
  input.setEnabled(false);
  hud.hide();
  disposeWorld();
  session?.leave();
  session = null;
  menus.show('title');
}

// --------------------------------------------------------------- multiplayer
function makeSession() {
  return createSession({
    name: settings.name,
    color: identity.color,
    accent: identity.accent,
    useStun: settings.useStun !== false,
    onPeers: (peers) => menus.renderPeers(peers),
    onStatus: (status) => {
      hud.setNet?.(status, session?.peerCount ?? 0);
      if (status === 'connected') menus.toast('Connected');
      if (status === 'disconnected' || status === 'failed') menus.toast('Connection lost', true);
    },
    onGhosts: (ghosts) => {
      world?.setGhosts(ghosts);
    },
    onScores: (scores) => {
      peerScores = scores;
      updateStandings();
    },
    onStart: (config) => {
      menus.toast('Starting the world');
      startRace({ seed: config.seed });
    },
    onNotice: (message) => menus.toast(message, true),
  });
}

async function hostRoom() {
  session?.leave();
  session = makeSession();
  menus.showLobby({ mode: 'host' });
  try {
    const code = await session.host();
    menus.setInviteCode(code);
    menus.toast('Room created - send the code to a friend');
  } catch (err) {
    menus.toast(`Could not create the room: ${err}`, true);
  }
}

async function localHostRoom() {
  session?.leave();
  session = makeSession();
  menus.showLobby({ mode: 'host' });
  try {
    await session.hostLocal();
    menus.toast('Same-device room open - open a second tab and join');
  } catch (err) {
    menus.toast(`Same-device room failed: ${err}`, true);
  }
}

async function localRoom() {
  session?.leave();
  session = makeSession();
  try {
    await session.joinLocal();
    menus.toast('Waiting for a host on this device...');
  } catch (err) {
    menus.toast(`Could not join: ${err}`, true);
  }
}

async function connectWithCode(code) {
  if (!code) {
    menus.toast('Paste an invite code first', true);
    return;
  }
  session?.leave();
  session = makeSession();
  try {
    const reply = await session.join(code);
    menus.setReplyCode(reply);
    menus.toast('Send the reply code back to the host');
  } catch (err) {
    menus.toast(`Could not join: ${err}`, true);
  }
}

async function acceptAnswer(code) {
  if (!session || !code) {
    menus.toast('Paste the reply code first', true);
    return;
  }
  try {
    await session.acceptAnswer(code);
    menus.toast('Connecting...');
  } catch (err) {
    menus.toast(`Could not connect: ${err}`, true);
  }
}

function updateStandings() {
  const entries = [
    { id: 'me', name: settings.name, score: world?.vehicle.driftScore ?? 0, isMe: true },
    ...peerScores.map((peer) => ({ id: peer.id, name: peer.name, score: peer.score })),
  ];
  hud.setPeers(entries);
}

// ------------------------------------------------------------------ settings
function applySettings() {
  audio.setVolume(settings.volume);
  audio.setMuted(settings.muted);
  input.setTiltEnabled(settings.tiltSteer);
  input.setTiltSensitivity(settings.tiltSensitivity);
  input.setInvertSteer(settings.invertSteer);
  world?.setQuality(settings.quality);
  world?.setAutoQuality(settings.autoQuality);
  if (perfEl) perfEl.hidden = !settings.showFps;
}

// --------------------------------------------------------------------- loop
const loop = createLoop({
  step: 1 / 60,
  maxSteps: 5,
  update(dt) {
    if (phase !== 'racing' || !world) return;
    try {
      input.update(dt);
      world.update(dt);
      session?.sendState(world.vehicle);
    } catch (err) {
      globalThis.__driftlineError = String((err && /** @type {any} */ (err).stack) || err);
      console.error('[driftline] update failed', err);
      loop.stop();
    }
  },
  render(dt) {
    if (!world) return;
    try {
      world.render(dt);
    } catch (err) {
      globalThis.__driftlineError = String((err && /** @type {any} */ (err).stack) || err);
      console.error('[driftline] render failed', err);
    }
    const now = performance.now();
    if (now - lastHudUpdate > 60) {
      lastHudUpdate = now;
      const status = world.status;
      hud.update({
        speed: status.speed,
        kmh: status.kmh,
        drift: status.drift,
        multiplier: status.multiplier,
        drifting: world.vehicle.drifting,
        boost: status.boost,
        distance: status.s,
      });
      updateStandings();
    }
    if (perfEl && settings.showFps) {
      const stats = world.stats;
      perfEl.textContent = `${loop.fps.toFixed(0)} fps\n${stats.calls} calls\n${(stats.triangles / 1000).toFixed(0)}k tris`;
    }
  },
});

// ------------------------------------------------------------------ events
input.on('action', (action) => {
  if (action === 'pause') {
    if (phase === 'racing') pauseRace();
    else if (phase === 'paused' && menus.current === 'pause') resumeRace();
  } else if (action === 'respawn') {
    if (phase === 'racing') world?.respawn();
  } else if (action === 'mute') {
    settings.muted = !settings.muted;
    saveState({ settings, records });
    applySettings();
    menus.toast(settings.muted ? 'Muted' : 'Unmuted');
  }
});

globalThis.addEventListener('resize', () => {
  world?.resize();
});

doc.addEventListener('visibilitychange', () => {
  if (doc.hidden && phase === 'racing') pauseRace();
});

doc.addEventListener('gesturestart', (event) => event.preventDefault());
doc.addEventListener(
  'touchmove',
  (event) => {
    if (phase === 'racing') event.preventDefault();
  },
  { passive: false },
);
doc.addEventListener('dblclick', (event) => event.preventDefault());

const touchLayer = doc.getElementById('touch');
if (touchLayer && input.hasTouch) touchLayer.hidden = false;

let hintTimer = 0;
function updateOrientationHint() {
  if (!rotateHint) return;
  const small = Math.min(globalThis.innerWidth, globalThis.innerHeight) < 520;
  const portrait = globalThis.innerHeight > globalThis.innerWidth;
  const shouldShow = small && portrait && phase === 'racing';
  rotateHint.hidden = !shouldShow;
  if (shouldShow) {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      rotateHint.hidden = true;
    }, 6000);
  }
}
globalThis.addEventListener('resize', updateOrientationHint);

input.on('action', (action) => {
  if (action === 'confirm' && settings.tiltSteer) {
    void requestTiltPermission();
  }
});

// ------------------------------------------------------------------- start
menus.show('title');
applySettings();
input.setEnabled(false);

const loadingEl = doc.getElementById('loading');
const loadingBar = doc.getElementById('loading-bar');
const loadingLabel = doc.getElementById('loading-label');
const finishLoading = () => {
  loadingEl?.setAttribute('hidden', '');
  loadingEl?.classList.add('is-done');
};
assets
  .loadAll((loaded, total) => {
    if (loadingBar) loadingBar.style.width = `${Math.round((loaded / total) * 100)}%`;
    if (loadingLabel) loadingLabel.textContent = `Loading world ${loaded}/${total}`;
  })
  .then(() => finishLoading())
  .catch((err) => {
    console.error('[driftline] asset load failed', err);
    if (loadingLabel) loadingLabel.textContent = 'Some assets failed to load - using fallback shapes';
    setTimeout(finishLoading, 1200);
  });
setTimeout(finishLoading, 12000);

const isLocalDev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
if ('serviceWorker' in navigator && location.protocol !== 'file:' && (!isLocalDev || location.search.includes('sw=1'))) {
  globalThis.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// A tiny surface for automated tests.
globalThis.__driftline = {
  get world() {
    return world;
  },
  get phase() {
    return phase;
  },
  get session() {
    return session;
  },
  assets,
  settings,
  records,
  startRace,
  menus,
  hud,
  input,
  audio,
  loop,
};
