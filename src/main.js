/**
 * Driftline bootstrap: wires input, audio, menus, the HUD, the world and the
 * peer-to-peer session together.
 */

import { createLoop } from './core/loop.js';
import { createInput, requestTiltPermission } from './core/input.js';
import { loadState, saveState, recordResult } from './core/storage.js';
import { createAudio } from './game/audio.js';
import { createMenus } from './game/menus.js';
import { createHud } from './game/hud.js';
import { createWorld } from './game/world.js';
import { createSession } from './net/session.js';
import { TRACKS, getTrackDef } from './game/track.js';
import { formatScore } from './core/math.js';

const doc = globalThis.document;
const canvas = /** @type {HTMLCanvasElement} */ (doc.getElementById('game'));
const perfEl = doc.getElementById('perf');
const rotateHint = doc.getElementById('rotate-hint') || doc.getElementById('rotate');

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
  const a = adjectives[Math.floor(Math.random() * adjectives.length)];
  const n = nouns[Math.floor(Math.random() * nouns.length)];
  return `${a}${n}`;
}

if (!settings.name) settings.name = randomName();
const identity = DRIVER_COLORS[Math.floor(Math.random() * DRIVER_COLORS.length)];

const audio = createAudio();
audio.setVolume(settings.volume);
audio.setMuted(settings.muted);

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
let frameCounter = 0;
let lastHudUpdate = 0;
let peerScores = [];
/** @type {import('./net/protocol.js').GhostState[]} */
let lastGhosts = [];

const menus = createMenus({
  settings,
  records,
  onStart: () => {
    void audio.unlock();
    startRace({ trackId: settings.track, laps: getTrackDef(settings.track)?.laps ?? 2 });
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
    startMultiplayerRace();
  },
  onLeaveLobby: () => {
    session?.leave();
    session = null;
    menus.show('title');
  },
  onResume: () => resumeRace(),
  onRestart: () => {
    if (world) {
      world.reset();
      phase = 'racing';
      menus.hideAll();
      hud.show();
      loop.start();
    }
  },
  onQuit: () => {
    quitToMenu();
  },
  onAgain: () => {
    if (world) {
      world.reset();
      phase = 'racing';
      menus.hideAll();
      hud.show();
      loop.start();
    } else {
      menus.show('title');
    }
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
      navigator.share({ title: 'Driftline', text: 'Join my Driftline race:', url: text }).catch(() => {});
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
 * @param {{ trackId?: string, seed?: number, laps?: number }} config
 */
function startRace(config) {
  disposeWorld();
  world = createWorld({
    canvas,
    input,
    audio,
    trackId: config.trackId ?? settings.track,
    seed: config.seed,
    carId: settings.car,
    laps: config.laps,
    quality: { quality: settings.quality, autoQuality: settings.autoQuality },
  });

  hud.setTrack(world.track);
  world.on('countdown', (value) => hud.countdown(value));
  world.on('lap', (payload) => {
    const { newLapRecord } = recordResult({ settings, records }, world.track.id, {
      lapTime: payload.lapTime,
    });
    menus.toast(
      newLapRecord ? `Lap ${payload.lap} - new best lap!` : `Lap ${payload.lap} complete`,
    );
  });
  world.on('finish', (payload) => {
    recordResult({ settings, records }, world.track.id, { drift: payload.bestDrift });
    phase = 'paused';
    loop.stop();
    menus.renderResults({
      lapTimes: payload.lapTimes,
      bestLap: payload.bestLap,
      bestDrift: payload.bestDrift,
      raceTime: payload.raceTime,
      peers: peerScores,
    });
    menus.show('results');
    hud.hide();
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
  if (phase !== 'paused') return;
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
  const created = createSession({
    name: settings.name,
    color: identity.color,
    accent: identity.accent,
    useStun: settings.useStun !== false,
    onPeers: (peers) => menus.renderPeers(peers),
    onStatus: (status) => {
      hud.setNet(status, session?.peerCount ?? 0);
      if (status === 'connected') menus.toast('Connected');
      if (status === 'disconnected' || status === 'failed') menus.toast('Connection lost', true);
    },
    onGhosts: (ghosts) => {
      lastGhosts = ghosts;
      world?.setGhosts(ghosts);
    },
    onScores: (scores) => {
      peerScores = scores;
      updateStandings();
    },
    onStart: (config) => {
      menus.toast('Race starting');
      startRace({ trackId: config.trackId, seed: config.seed, laps: config.laps });
    },
    onNotice: (message) => menus.toast(message, true),
  });
  return created;
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
    hud.setNet('waiting', 0);
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

function startMultiplayerRace() {
  if (!session) {
    menus.toast('Create a room first', true);
    return;
  }
  const trackId = settings.track;
  const seed = Math.floor(Math.random() * 0xffffff);
  session.startRace({ trackId, seed, laps: getTrackDef(trackId)?.laps ?? 2 });
}

function updateStandings() {
  const entries = [
    { id: 'me', name: settings.name, score: world?.car.driftScore ?? 0, isMe: true },
    ...peerScores.map((peer) => ({ id: peer.id, name: peer.name, score: peer.score })),
  ];
  hud.setStandings(entries);
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
      session?.sendState(world.car);
      updateStandings();
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
    frameCounter++;
    const now = performance.now();
    if (now - lastHudUpdate > 60) {
      lastHudUpdate = now;
      hud.update({
        speed: world.car.speed,
        maxSpeed: world.carConfig.maxSpeed,
        lap: world.state.lap,
        laps: world.state.laps,
        lapTime: world.state.lapTime,
        bestLap: world.state.bestLap,
        driftScore: world.car.driftScore,
        driftMultiplier: world.car.driftMultiplier,
        drifting: world.car.drifting,
        boostFuel: world.car.boostFuel,
      });
      hud.drawMinimap(world.car, lastGhosts);
    }
    if (perfEl && settings.showFps) {
      perfEl.textContent = `${loop.fps.toFixed(0)} fps\n${world.car.speed.toFixed(0)} m/s\ndpr ${rendererPixelRatio()}`;
    }
  },
  onFps: () => {},
});

function rendererPixelRatio() {
  const canvas2d = /** @type {any} */ (canvas);
  return canvas2d.width && canvas2d.height
    ? (canvas2d.width / Math.max(1, canvas2d.clientWidth)).toFixed(2)
    : '1';
}

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
  } else if (action === 'camera') {
    menus.toast('Camera follows the road');
  }
});

globalThis.addEventListener('resize', () => {
  world?.resize();
});

doc.addEventListener('visibilitychange', () => {
  if (doc.hidden && phase === 'racing') pauseRace();
});

// Prevent the page from scrolling / zooming while driving.
doc.addEventListener('gesturestart', (event) => event.preventDefault());
doc.addEventListener(
  'touchmove',
  (event) => {
    if (phase === 'racing') event.preventDefault();
  },
  { passive: false },
);
doc.addEventListener('dblclick', (event) => event.preventDefault());

// Show the touch controls on touch devices.
const touchLayer = doc.getElementById('touch');
if (touchLayer && input.hasTouch) {
  touchLayer.hidden = false;
}

// Orientation hint on small portrait screens (non blocking, fades away).
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

// Tilt steering needs a user gesture on iOS.
input.on('action', (action) => {
  if (action === 'confirm' && settings.tiltSteer) {
    void requestTiltPermission();
  }
});

// ------------------------------------------------------------------- start
menus.show('title');
applySettings();
input.setEnabled(false);

// Service worker for offline play (skipped on localhost during development).
const isLocalDev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
if ('serviceWorker' in navigator && location.protocol !== 'file:' && (!isLocalDev || location.search.includes('sw=1'))) {
  globalThis.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// Expose a tiny surface for automated tests.
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
  settings,
  records,
  startRace,
  menus,
  hud,
  input,
  audio,
  loop,
  tracks: TRACKS,
  formatScore,
};
