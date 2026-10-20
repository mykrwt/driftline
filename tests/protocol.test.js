import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG, packState, unpackState, encode, decode, isValidMessage } from '../src/net/protocol.js';

test('car state packs into a small array', () => {
  const car = { x: 12.345, z: -67.891, heading: 1.2345, slip: -0.0987, boosting: true };
  const packed = packState(car);
  assert.equal(packed.length, 5);
  assert.ok(JSON.stringify(packed).length < 60);
});

test('car state survives a round trip', () => {
  const car = { x: 12.345, z: -67.891, heading: 1.2345, slip: -0.0987, boosting: false };
  const state = unpackState(packState(car));
  assert.ok(Math.abs(state.x - car.x) < 0.01);
  assert.ok(Math.abs(state.z - car.z) < 0.01);
  assert.ok(Math.abs(state.heading - car.heading) < 0.002);
  assert.ok(Math.abs(state.drift - car.slip) < 0.002);
  assert.equal(state.boost, false);
});

test('messages encode and decode', () => {
  const raw = encode(MSG.HELLO, { id: 'abc', name: 'Swift' });
  const message = decode(raw);
  assert.equal(message.t, MSG.HELLO);
  assert.equal(message.id, 'abc');
  assert.equal(message.name, 'Swift');
});

test('a message without a type is rejected', () => {
  assert.equal(decode('{"foo":1}'), null);
  assert.equal(decode('not json'), null);
  assert.equal(isValidMessage({ t: 'x' }), true);
  assert.equal(isValidMessage(null), false);
});

test('every message type is unique', () => {
  const types = Object.values(MSG);
  assert.equal(new Set(types).size, types.length);
});
