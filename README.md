# Driftline

Driftline is a **real 3D drift racer** that runs in the browser on phones and
desktops. It is inspired by [slowroads.io](https://slowroads.io) but adds a
drift scoring system, multiple tracks, mobile touch controls and **serverless
peer-to-peer multiplayer** (no game server, no backend).

## Features

- Real 3D rendering with Three.js (WebGL), procedural circuits, instanced
  scenery and a sky dome.
- Arcade drift physics: the car slides when you ask it to, scores points for
  it and never spins out.
- Three tracks (Coastal Run, Alpine Pass, Midnight Bay) and three cars
  (Vector GT, Comet RS, Bulldozer V8), each with different handling.
- Mobile touch controls: a steering pad, gas/brake/handbrake/boost buttons,
  tilt steering (with permission) and a landscape hint.
- Desktop keyboard controls: arrows/WASD drive, Space handbrake, Shift boost,
  C camera, R respawn, Esc pause, M mute.
- Peer-to-peer multiplayer over WebRTC data channels:
  - **Invite codes**: share a short deflated code over any chat.
  - **Same-device test**: two tabs on one phone or PC find each other through
    a BroadcastChannel.
  - Ghost cars (you can drive through them) and a shared drift leaderboard.
- Offline capable: a service worker caches the whole app shell.
- Runs from any static host. No build step, no backend.

## Running locally

```bash
npm install
npm start        # serves the app on http://localhost:8080
```

Open the URL on your phone (the dev server prints a LAN address) or just open
it on the same device.

## Testing

```bash
npm test         # runs the node:test suite (pure logic, no browser)
npm run typecheck
npm run verify   # typecheck + tests
```

The test suite covers the math, the RNG, track generation, physics, race rules,
storage, the wire protocol, serverless signalling, the multiplayer session and
a headless gameplay scenario.

## Project layout

```
index.html              entry point
styles/                 base + game CSS
src/core/               math, rng, loop, input, storage
src/game/               track, physics, scene, renderer, camera, effects,
                        audio, hud, menus, world, race, assets
src/net/                protocol, signalling, peer, session
tests/                  node:test suite
tools/serve.mjs         zero dependency static server
tools/run-tests.mjs     portable test runner
assets/models/          CC0 asset packs (Kenney)
vendor/three/           vendored Three.js (core + addons)
```

## Assets

All 3D models are CC0 assets by Kenney (car kit, racing kit, nature kit, city
kit roads). They are vendored in `assets/models/` so the game works offline.
Procedural fallbacks are used when an asset is missing.

## Multiplayer

The host's browser is the only "server". Guests connect directly to it over
WebRTC. To play across the internet, both sides need to exchange invite codes
(a short deflated string). On a single device, use "Same-device room" and
"Same-device test" to connect two tabs instantly.

## Controls

| Key           | Action           |
| ------------- | ---------------- |
| Arrows / WASD | Drive            |
| Space         | Handbrake (drift)|
| Shift         | Boost            |
| C             | Camera           |
| R             | Respawn          |
| Esc / P       | Pause            |
| M             | Mute             |

## License

MIT. Asset packs are CC0 by Kenney.
