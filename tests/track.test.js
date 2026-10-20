import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACKS,
  getTrackDef,
  createTrack,
  createTrackById,
  sampleTrack,
  projectToTrack,
  trackToWorld,
  buildMinimapPath,
  SEGMENT_LENGTH,
  ROAD_HALF_WIDTH,
} from '../src/game/track.js';

test('every track definition is complete', () => {
  for (const def of TRACKS) {
    assert.ok(def.id);
    assert.ok(def.name);
    assert.ok(def.laps >= 1);
    assert.ok(def.palette.skyTop && def.palette.road && def.palette.fog);
    assert.ok(def.props.length > 0);
    assert.equal(getTrackDef(def.id), def);
  }
});

test('the same seed builds an identical track', () => {
  const a = createTrackById('coast', 4242);
  const b = createTrackById('coast', 4242);
  assert.equal(a.segmentCount, b.segmentCount);
  assert.deepEqual(Array.from(a.x), Array.from(b.x));
  assert.deepEqual(Array.from(a.y), Array.from(b.y));
  assert.deepEqual(Array.from(a.heading), Array.from(b.heading));
});

test('different seeds build different tracks', () => {
  const a = createTrackById('coast', 1);
  const b = createTrackById('coast', 2);
  assert.notDeepEqual(Array.from(a.x), Array.from(b.x));
});

test('the centre line is a closed loop', () => {
  const track = createTrackById('coast');
  const first = sampleTrack(track, 0);
  const last = sampleTrack(track, track.length - 0.001);
  const distance = Math.hypot(first.x - last.x, first.z - last.z);
  assert.ok(distance < SEGMENT_LENGTH * 2, `loop gap was ${distance}`);
});

test('the centre line has no NaNs and a sane length', () => {
  const track = createTrackById('alpine');
  for (let i = 0; i < track.segmentCount; i++) {
    assert.ok(Number.isFinite(track.x[i]));
    assert.ok(Number.isFinite(track.y[i]));
    assert.ok(Number.isFinite(track.z[i]));
    assert.ok(Number.isFinite(track.heading[i]));
    assert.ok(Number.isFinite(track.curvature[i]));
  }
  assert.ok(track.length > 1000, `track too short: ${track.length}`);
  assert.ok(track.length < 20000, `track too long: ${track.length}`);
});

test('segments never jump', () => {
  const track = createTrackById('midnight');
  for (let i = 0; i < track.segmentCount; i++) {
    const next = (i + 1) % track.segmentCount;
    const step = Math.hypot(track.x[next] - track.x[i], track.z[next] - track.z[i]);
    assert.ok(step < SEGMENT_LENGTH * 1.6, `segment ${i} jumped ${step}`);
  }
});

test('the curvature stays drivable', () => {
  const track = createTrackById('coast');
  for (let i = 0; i < track.segmentCount; i++) {
    const radius = Math.abs(track.curvature[i]) > 1e-6 ? 1 / Math.abs(track.curvature[i]) : Infinity;
    assert.ok(radius > 18, `corner radius ${radius} at ${i}`);
  }
});

test('projectToTrack inverts trackToWorld', () => {
  const track = createTrackById('coast');
  for (const distance of [0, 120, 640, 1500, track.length - 10]) {
    const world = trackToWorld(track, distance, 2.5);
    const projected = projectToTrack(track, world.x, world.z);
    assert.ok(Math.abs(projected.distance - distance) < 1.5, `distance ${projected.distance}`);
    assert.ok(Math.abs(projected.offset - 2.5) < 0.6, `offset ${projected.offset}`);
  }
});

test('the projection reports the right side of the road', () => {
  const track = createTrackById('coast');
  const right = trackToWorld(track, 300, 5);
  const left = trackToWorld(track, 300, -5);
  assert.ok(projectToTrack(track, right.x, right.z).offset > 0);
  assert.ok(projectToTrack(track, left.x, left.z).offset < 0);
});

test('checkpoints and props are generated', () => {
  const track = createTrackById('coast');
  assert.equal(track.checkpoints.length, 3);
  assert.equal(track.checkpoints[0], 0);
  assert.ok(track.props.length > 100);
  for (const prop of track.props) {
    assert.ok(prop.segment >= 0 && prop.segment < track.segmentCount);
    assert.ok(Number.isFinite(prop.offset));
  }
});

test('the minimap path fits the canvas', () => {
  const track = createTrackById('coast');
  const path = buildMinimapPath(track, 220, 220, 10);
  assert.ok(path.points.length > 10);
  for (const point of path.points) {
    assert.ok(point.x >= 0 && point.x <= 220, `x ${point.x}`);
    assert.ok(point.y >= 0 && point.y <= 220, `y ${point.y}`);
  }
});

test('a custom track can be built from a definition', () => {
  const def = { ...TRACKS[0], id: 'custom', seed: 999 };
  const track = createTrack(def);
  assert.equal(track.id, 'custom');
  assert.equal(track.seed, 999);
  assert.ok(track.length > 0);
  assert.ok(ROAD_HALF_WIDTH > 0);
});
