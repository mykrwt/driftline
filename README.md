# Driftline

An endless 3D driving world. Real vehicle physics, drift scoring and
serverless peer-to-peer multiplayer - no backend, no build step.

![car](assets/icon.svg)

## What it is

- **One infinite world.** The road is generated on the fly from a seed:
  curves, hills, changing width and dedicated drift areas. The land around
  it is a valley that rises into a mountain range, so the drive constantly
  opens into wide plains and squeezes back between rock walls.
- **Real driving physics.** A rigid body chassis with four independent
  raycast wheels, springs, dampers, weight transfer, a tyre model with a
  friction circle and counter steering. One wheel rolling over a rock lifts
  that corner only - the car never launches into the air and never sinks.
- **Three cars** with different mass, power, grip and suspension, each with
  its own lofted body.
- **Three times of day.** Alpine day, golden hour and midnight change the
  sky, the fog, the sun and the colour of the whole world.
- **Peer-to-peer multiplayer.** WebRTC data channels, manual invite codes or a
  same-device BroadcastChannel. Other players are ghosts: they never block
  you. Everyone shares the same world seed, so the road is identical
  everywhere.
- **Mobile and desktop.** Touch controls with an analog steering pad, tilt
  steering, full keyboard and gamepad support.

## Running it

```bash
npm install
npm start        # http://localhost:8080
```

The dev server prints a LAN address, so you can open it on a phone. Any static
host works - there is no server side component at all.

## Tests

```bash
npm test           # node:test suite, no browser needed
npm run check:imports   # every import of the game resolves
npm run typecheck
npm run verify     # imports + tests
```

The suite covers the math, the RNG, the road generator and the shape of the
land, the vehicle physics (suspension, weight transfer, one wheel on a step,
handbrake recovery), the driving bot, the race-free world streaming, the wire
protocol, the serverless signalling, the multiplayer session and a head-less
bot that drives the road for minutes without leaving it.

## Tools

The game is a browser app, so looking at it needs a browser. These tools make
that painless:

```bash
npm run terrain:map -- 20260920 4000 out.png   # top down map of the land
npm run scene:preview -- 20260920 120 out.png   # a software render of the scene
npm run flythrough -- 20260920 8 out.png        # the drive, frame by frame
npm run car:preview -- vector out.png           # the car, from three angles
npm run bot:bench -- 4 90                      # how well the bot drives
```

- `terrain:map` draws the world from above with the same colour rules as the
  game, plus a summary of the relief. It is the fastest way to judge the
  shape of the land.
- `scene:preview` renders the actual scene - terrain, road, sky, sun, fog -
  with a small software renderer, so a change can be judged in seconds
  without a browser.
- `flythrough` renders the drive from the point of view of the car and puts
  the frames into one sheet.
- `car:preview` builds the same model the game builds and draws it with the
  software renderer, so the silhouette of a car can be checked without a
  browser.
- `bot:bench` runs the driving bot over several seeds and reports how far it
  gets and how much time it spends off the road.

The game itself can be captured from the inside: open it with `?capture=1`
and the console gets `__driftline.snap()` (paints the frame over the page),
`__driftline.simulate({ seconds })` (drives the world with the bot and stores
the frames on the dev server) and `__driftline.contactSheet(names)`.

`__driftline.selftest()` drives the game from the console: it uses the
keyboard and the touch controls, drifts, changes the palette and looks for
errors. It is the quickest way to find out whether a change broke something.

## Controls

| Action | Keys | Touch |
| --- | --- | --- |
| Steer | arrows / A D | steering pad |
| Accelerate | up / W | GAS |
| Brake / reverse | down / S | BRAKE |
| Handbrake | space | DRIFT |
| Boost | shift | BOOST |
| Camera | C | - |
| Respawn | R | - |
| Pause | Esc | - |
| Mute | M | - |

On a phone: the steering pad on the left, gas/brake/drift/boost on the right.

## Rendering

- **A terrain ribbon.** The land is not a square grid but a ribbon that
  follows the road: every cross section is anchored to the road at that
  point, so the ground always meets the tarmac exactly, the verge is finely
  tessellated and the mountains rise out of the valley the road runs through.
  The row spacing grows with the distance, so the vertex count stays flat
  however far you drive.
- **Lakes.** The valley floor dips below the water line in places, and the
  water follows the road as a second ribbon, so the lakes appear and
  disappear along the drive.
- **One height function.** The mesh and the physics read the same
  `surfaceHeight`, so the wheels always touch the ground.
- **Layered vegetation**: the trees are billboards - the model is baked into
  a texture once and drawn with crossed quads - while the rocks and the
  bushes stay real models. Everything is GPU instanced and shadow casting.
- **Sun and shadows**: a directional sun with a tight shadow map that follows
  the car, a hemisphere fill for the shade and a soft contact shadow under
  the car.
- **A procedural sky**: a gradient with a sun disc, a halo and drifting
  clouds, all in one shader.
- **Photographic textures** (asphalt, ground) from Poly Haven, CC0. The
  ground tile is used as a detail layer, so the vertex colours stay in
  charge of the palette.
- **Atmosphere**: distance fog that matches the horizon, aerial perspective
  on the far mountains and a filmic tone curve.

## Layout

```
index.html              entry point
styles/                 base + game CSS
src/core/               math, rng, loop, input, storage
src/game/               road, terrain, vehicle, chunks, scene, renderer, camera,
                        effects, audio, hud, menus, world, car, models, palette,
                        noise, autopilot
src/net/                protocol, signalling, peer, session
tests/                  node:test suite
tools/serve.mjs         zero dependency static server
tools/terrain-map.mjs   top down map of the world
tools/scene-preview.mjs software renderer for the scene
tools/flythrough.mjs    the drive, frame by frame
tools/soft-render.mjs   the little software renderer
tools/car-preview.mjs   the car, from three angles
tools/png.mjs           a small PNG writer
tools/bot-bench.mjs     driving bot benchmark
tools/check-imports.mjs import checker
assets/models/          CC0 asset packs (Kenney)
vendor/three/           vendored Three.js (core + addons)
```

## Assets

The scenery is CC0 models by Kenney, vendored in `assets/models/` so the
game works offline. The asphalt and ground textures are CC0 from Poly Haven.
The cars are built procedurally at runtime, so nothing has to be downloaded
for them.

## License

MIT. Asset packs are CC0 by Kenney.
