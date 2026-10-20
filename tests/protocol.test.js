import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG, packState, unpackState, encode, decode, isValidMessage } from '../src/net/protocol.js';

test('car state packs into a small array', () => {
  const vehicle = {
    position: { x: 12.345, y: 0.51, z: -67.891 },
    quaternion: { x: 0, y: 0.382, z: 0, w: 0.924 },
    speed: 22.5,
    slipAngle: -0.0987,
  };
  const packed = packState(vehicle);
  assert.equal(packed.length, 9);
  assert.ok(JSON.stringify(packed).length < 80);
});

test('car state survives a round trip', () => {
  const vehicle = {
    position: { x: 12.345, y: 0.51, z: -67.891 },
    quaternion: { x: 0.1, y: 0.382, z: 0, w: 0.924 },
    speed: 22.5,
    slipAngle: -0.0987,
  };
  const state = unpackState(packState(vehicle));
  assert.ok(Math.abs(state.x - vehicle.position.x) < 0.01);
  assert.ok(Math.abs(state.y - vehicle.position.y) < 0.01);
  assert.ok(Math.abs(state.z - vehicle.position.z) < 0.01);
  assert.ok(Math.abs(state.qy - vehicle.quaternion.y) < 0.002);
  assert.ok(Math.abs(state.speed - vehicle.speed) < 0.01);
  assert.ok(Math.abs(state.slip - vehicle.slipAngle) < 0.002);
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
