import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  lerp,
  damp,
  smoothstep,
  wrapAngle,
  moveTowards,
  sign,
  formatTime,
  formatScore,
  mpsToKmh,
  isFiniteNumber,
} from '../src/core/math.js';

test('clamp keeps values inside the range', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(50, 0, 10), 10);
});

test('lerp interpolates linearly', () => {
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  assert.equal(lerp(0, 10, 0.25), 2.5);
});

test('damp is frame rate independent', () => {
  const a = damp(0, 1, 5, 1 / 60);
  const b = damp(0, 1, 5, 1 / 30);
  const c = damp(a, 1, 5, 1 / 60);
  // Two half steps must land (almost) in the same place as one full step.
  assert.ok(Math.abs(damp(a, 1, 5, 1 / 60) - b) < 1e-6);
  assert.ok(c > a);
});

test('smoothstep eases between the bounds', () => {
  assert.equal(smoothstep(-1), 0);
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(0.5), 0.5);
  assert.equal(smoothstep(1), 1);
  assert.equal(smoothstep(2), 1);
});

test('wrapAngle keeps angles in -PI..PI', () => {
  assert.ok(Math.abs(wrapAngle(0)) < 1e-9);
  assert.ok(Math.abs(Math.abs(wrapAngle(Math.PI * 3)) - Math.PI) < 1e-9);
  assert.ok(Math.abs(Math.abs(wrapAngle(-Math.PI * 3)) - Math.PI) < 1e-9);
  assert.ok(wrapAngle(Math.PI * 2 - 0.1) < 0);
});

test('moveTowards never overshoots', () => {
  assert.equal(moveTowards(0, 10, 3), 3);
  assert.equal(moveTowards(0, 1, 5), 1);
  assert.equal(moveTowards(10, 0, 5), 5);
});

test('sign returns -1, 0 or 1', () => {
  assert.equal(sign(-4), -1);
  assert.equal(sign(0), 0);
  assert.equal(sign(9), 1);
});

test('formatTime renders m:ss.cc', () => {
  assert.equal(formatTime(0), '0:00.00');
  assert.equal(formatTime(61.5), '1:01.50');
  assert.equal(formatTime(-1), '--:--.--');
  assert.equal(formatTime(Number.NaN), '--:--.--');
});

test('formatScore compacts large numbers', () => {
  assert.equal(formatScore(999), '999');
  assert.equal(formatScore(1500), '1.5k');
  assert.equal(formatScore(25000), '25k');
  assert.equal(formatScore(2_500_000), '2.5M');
});

test('mpsToKmh converts speed', () => {
  assert.equal(mpsToKmh(10), 36);
});

test('isFiniteNumber rejects junk', () => {
  assert.equal(isFiniteNumber(1), true);
  assert.equal(isFiniteNumber(Number.NaN), false);
  assert.equal(isFiniteNumber('4'), false);
});
