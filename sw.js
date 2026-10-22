/**
 * Driftline service worker.
 *
 * Strategy:
 *   - app code (html/js/css): network first, so a new deploy is picked up
 *     immediately, with the cache as an offline fallback.
 *   - big immutable files (models, vendor bundle): cache first.
 *
 * The cache name carries a version, so a new deploy drops the old cache.
 */

const VERSION = 'driftline-v5';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-maskable.svg',
  './styles/base.css',
  './styles/game.css',
  './src/main.js',
  './src/core/math.js',
  './src/core/rng.js',
  './src/core/loop.js',
  './src/core/input.js',
  './src/core/storage.js',
  './src/game/road.js',
  './src/game/noise.js',
  './src/game/palette.js',
  './src/game/terrain.js',
  './src/game/chunks.js',
  './src/game/camera.js',
  './src/game/car.js',
  './src/game/models.js',
  './src/game/scene.js',
  './src/game/renderer.js',
  './src/game/effects.js',
  './src/game/audio.js',
  './src/game/hud.js',
  './src/game/menus.js',
  './src/game/world.js',
  './src/game/autopilot.js',
  './src/game/assets.js',
  './src/net/protocol.js',
  './src/net/signal.js',
  './src/net/peer.js',
  './src/net/session.js',
  './vendor/three/three.module.js',
  './vendor/three/three.core.js',
  './vendor/three/addons/loaders/GLTFLoader.js',
  './vendor/three/addons/utils/BufferGeometryUtils.js',
  './vendor/three/addons/utils/SkeletonUtils.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(CORE))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      // A new build is live: tell the open pages to reload, so nobody keeps
      // playing the old one.
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        for (const client of clients) client.postMessage({ type: 'driftline:update' });
      }),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isAppCode = /\.(?:html|js|css|webmanifest)$/.test(url.pathname);

  if (isAppCode) {
    // Network first: always try to serve the newest build. The cache is
    // bypassed, because the browser would otherwise answer with its own
    // (possibly stale) copy of the module.
    event.respondWith(
      fetch(request, { cache: 'reload' })
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html'))),
    );
    return;
  }

  // Cache first for the heavy immutable files.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => cached);
    }),
  );
});
