import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoadProfile,
  roadOffset,
  roadHeight,
  roadHeading,
  roadSlope,
  roadHalfWidth,
  roadCurvature,
  roadInfo,
  surfaceHeight,
  surfaceNormal,
  driftFactor,
  SEGMENT_LENGTH,
  ROAD_HALF_WIDTH,
} from '../src/game/road.js';

test('the same seed always builds the same world', () => {
  const a = createRoadProfile(1234);
  const b = createRoadProfile(1234);
  for (let s = 0; s < 5000; s += 137) {
    assert.equal(roadOffset(a, s), roadOffset(b, s));
    assert.equal(roadHeight(a, s), roadHeight(b, s));
    assert.equal(roadHeading(a, s), roadHeading(b, s));
  }
});

test('different seeds build different worlds', () => {
  const a = createRoadProfile(1);
  const b = createRoadProfile(2);
  let different = false;
  for (let s = 0; s < 2000; s += 211) {
    if (Math.abs(roadOffset(a, s) - roadOffset(b, s)) > 1) different = true;
  }
  assert.ok(different);
});

test('the road is smooth: no jumps in position, height or heading', () => {
  const profile = createRoadProfile(7);
  let lastOffset = roadOffset(profile, 0);
  let lastHeight = roadHeight(profile, 0);
  let lastHeading = roadHeading(profile, 0);
  for (let s = SEGMENT_LENGTH; s < 8000; s += SEGMENT_LENGTH) {
    const offset = roadOffset(profile, s);
    const height = roadHeight(profile, s);
    const heading = roadHeading(profile, s);
    assert.ok(Math.abs(offset - lastOffset) < SEGMENT_LENGTH * 0.6, `offset jump at ${s}`);
    assert.ok(Math.abs(height - lastHeight) < 2.5, `height jump at ${s}`);
    assert.ok(Math.abs(heading - lastHeading) < 0.12, `heading jump at ${s}`);
    lastOffset = offset;
    lastHeight = height;
    lastHeading = heading;
  }
});

test('the heading stays bounded so the road never loops back', () => {
  const profile = createRoadProfile(9);
  for (let s = 0; s < 50000; s += 25) {
    const heading = roadHeading(profile, s);
    assert.ok(Math.abs(heading) < 1.2, `heading ${heading} at ${s}`);
  }
});

test('the road has corners but they stay drivable', () => {
  const profile = createRoadProfile(3);
  let maxCurvature = 0;
  for (let s = 0; s < 20000; s += 10) {
    maxCurvature = Math.max(maxCurvature, Math.abs(roadCurvature(profile, s)));
  }
  assert.ok(maxCurvature > 0.002, 'the road should have real corners');
  const tightestRadius = 1 / maxCurvature;
  assert.ok(tightestRadius > 60, `the tightest corner has a radius of ${tightestRadius} m`);
});

test('the road widens into drift areas', () => {
  const profile = createRoadProfile(11);
  let widest = 0;
  let drift = 0;
  for (let s = 0; s < profile.driftSpacing * 3; s += 4) {
    widest = Math.max(widest, roadHalfWidth(profile, s));
    drift = Math.max(drift, driftFactor(profile, s));
  }
  assert.ok(drift > 0.9, 'drift areas should appear');
  assert.ok(widest > ROAD_HALF_WIDTH + 8, `widest half width ${widest}`);
});

test('the road surface is flat across its width', () => {
  const profile = createRoadProfile(5);
  const s = 1500;
  const centre = roadOffset(profile, s);
  const height = roadHeight(profile, s);
  for (const lateral of [-6, -3, 0, 3, 6]) {
    const y = surfaceHeight(profile, centre + lateral, s);
    assert.ok(Math.abs(y - height) < 0.2, `lateral ${lateral} gave ${y}`);
  }
});

test('the surface is continuous where the road meets the terrain', () => {
  const profile = createRoadProfile(5);
  const s = 1500;
  const centre = roadOffset(profile, s);
  const half = roadHalfWidth(profile, s);
  let previous = surfaceHeight(profile, centre - half - 4, s);
  for (let lateral = -half - 4; lateral <= half + 4; lateral += 0.5) {
    const y = surfaceHeight(profile, centre + lateral, s);
    assert.ok(Math.abs(y - previous) < 0.4, `step at ${lateral}: ${previous} -> ${y}`);
    previous = y;
  }
});

test('the surface normal points up', () => {
  const profile = createRoadProfile(5);
  const normal = surfaceNormal(profile, roadOffset(profile, 800), 800);
  assert.ok(normal.y > 0.9, `normal ${normal.y}`);
  assert.ok(Math.abs(Math.hypot(normal.x, normal.y, normal.z) - 1) < 1e-6);
});

test('road info reports the lateral position', () => {
  const profile = createRoadProfile(5);
  const s = 900;
  const centre = roadOffset(profile, s);
  const onRoad = roadInfo(profile, centre, s);
  assert.equal(onRoad.onRoad, true);
  assert.ok(Math.abs(onRoad.lateral) < 0.001);
  const offRoad = roadInfo(profile, centre + 40, s);
  assert.equal(offRoad.onRoad, false);
  assert.ok(offRoad.lateral > 30);
});

test('the world never runs out of road', () => {
  const profile = createRoadProfile(5);
  // Far out in the distance the road must still exist and be finite.
  for (const s of [0, 50000, 500000, 5000000]) {
    assert.ok(Number.isFinite(roadOffset(profile, s)));
    assert.ok(Number.isFinite(roadHeight(profile, s)));
  }
});
