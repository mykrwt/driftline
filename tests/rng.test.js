import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, createRandomHelpers, hashString } from '../src/core/rng.js';

test('the same seed always produces the same stream', () => {
  const a = createRng(1234);
  const b = createRng(1234);
  for (let i = 0; i < 50; i++) assert.equal(a(), b());
});

test('different seeds diverge', () => {
  const a = createRng(1);
  const b = createRng(2);
  const valuesA = Array.from({ length: 10 }, a);
  const valuesB = Array.from({ length: 10 }, b);
  assert.notDeepEqual(valuesA, valuesB);
});

test('the generator stays inside [0, 1)', () => {
  const rng = createRng(99);
  for (let i = 0; i < 5000; i++) {
    const value = rng();
    assert.ok(value >= 0 && value < 1, `out of range: ${value}`);
  }
});

test('the distribution is roughly uniform', () => {
  const rng = createRng(7);
  let sum = 0;
  const count = 20000;
  for (let i = 0; i < count; i++) sum += rng();
  const mean = sum / count;
  assert.ok(Math.abs(mean - 0.5) < 0.02, `mean was ${mean}`);
});

test('helpers respect their bounds', () => {
  const rng = createRng(5);
  const helpers = createRandomHelpers(rng);
  for (let i = 0; i < 500; i++) {
    const value = helpers.range(-3, 7);
    assert.ok(value >= -3 && value <= 7);
    const int = helpers.int(2, 5);
    assert.ok(Number.isInteger(int) && int >= 2 && int <= 5);
  }
});

test('shuffle keeps every item', () => {
  const helpers = createRandomHelpers(createRng(3));
  const items = [1, 2, 3, 4, 5, 6];
  const shuffled = helpers.shuffle(items);
  assert.equal(shuffled.length, items.length);
  assert.deepEqual([...shuffled].sort((a, b) => a - b), items);
});

test('hashString is stable and differs per input', () => {
  assert.equal(hashString('coast'), hashString('coast'));
  assert.notEqual(hashString('coast'), hashString('alpine'));
});
