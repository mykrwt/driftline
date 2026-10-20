/**
 * Driftline service worker.
 *
 * Caches the app shell so the game keeps working offline. The vendor bundle is
 * cached forever, the game files use a stale-while-revalidate strategy.
 */

const VERSION = 'driftline-v1';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-maskable.svg',
  './styles/base.css',
  './styles/game.css',
  './vendor/three/three.module.js',
  './vendor/three/three.core.js',
  './src/main.js',
  './src/core/math.js',
  './src/core/rng.js',
  './src/core/loop.js',
  './src/core/input.js',
  './src/core/storage.js',
  './src/game/track.js',
  './src/game/physics.js',
  './src/game/camera.js',
  './src/game/models.js',
  './src/game/scene.js',
  './src/game/renderer.js',
  './src/game/effects.js',
  './src/game/audio.js',
  './src/game/hud.js',
  './src/game/menus.js',
  './src/game/world.js',
  './src/net/protocol.js',
  './src/net/signal.js',
  './src/net/peer.js',
  './src/net/session.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
