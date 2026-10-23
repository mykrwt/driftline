import test from 'node:test';
import assert from 'node:assert/strict';
import { createInput } from '../src/core/input.js';

// The input module talks to `globalThis` the way a browser page does. Node has
// no window, so a tiny event target stands in for one.
const bus = new EventTarget();
const original = {
  addEventListener: globalThis.addEventListener,
  removeEventListener: globalThis.removeEventListener,
  dispatchEvent: globalThis.dispatchEvent,
};
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);

test.after(() => {
  Object.assign(globalThis, original);
  delete globalThis.addEventListener;
  delete globalThis.removeEventListener;
  delete globalThis.dispatchEvent;
});

/**
 * @param {string} type
 * @param {Record<string, any>} [props]
 */
function keyEvent(type, props = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code: '', key: '', repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...props });
  return event;
}

/**
 * @param {string} type
 * @param {Record<string, any>} [props]
 */
function pointerEvent(type, props = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: 1, clientX: 0, clientY: 0, ...props });
  return event;
}

function fakeElement() {
  const el = new EventTarget();
  const classes = new Set();
  el.classList = {
    add: (name) => classes.add(name),
    remove: (name) => classes.delete(name),
    contains: (name) => classes.has(name),
  };
  el.attributes = {};
  el.style = {};
  el.setAttribute = (key, value) => {
    el.attributes[key] = value;
  };
  el.captured = new Set();
  el.setPointerCapture = (id) => el.captured.add(id);
  el.hasPointerCapture = (id) => el.captured.has(id);
  el.releasePointerCapture = (id) => el.captured.delete(id);
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 90, right: 240, bottom: 90 });
  return el;
}

/** Only one input lives at a time: they all listen on the same global. */
let current = null;

/** A fresh input, wired to fresh fake DOM elements. */
function makeInput(options = {}) {
  current?.destroy();
  const gas = fakeElement();
  const brake = fakeElement();
  const hand = fakeElement();
  const boost = fakeElement();
  const pad = fakeElement();
  const knob = fakeElement();
  const input = createInput({
    steerElement: pad,
    knobElement: knob,
    buttons: { gas, brake, hand, boost },
    ...options,
  });
  current = input;
  return { input, gas, brake, hand, boost, pad, knob };
}

/** Simulate several simulation steps. */
function steps(input, count, dt = 1 / 60) {
  for (let i = 0; i < count; i++) input.update(dt);
}

test('the keyboard drives the car', () => {
  const { input } = makeInput();
  input.setEnabled(true);

  globalThis.dispatchEvent(keyEvent('keydown', { code: 'KeyW', key: 'w' }));
  steps(input, 4);
  assert.equal(input.state.throttle, 1);
  globalThis.dispatchEvent(keyEvent('keyup', { code: 'KeyW', key: 'w' }));
  steps(input, 2);
  assert.equal(input.state.throttle, 0);

  globalThis.dispatchEvent(keyEvent('keydown', { code: 'KeyD', key: 'd' }));
  steps(input, 20);
  assert.ok(input.state.steer > 0.6, `steer ${input.state.steer}`);
  globalThis.dispatchEvent(keyEvent('keyup', { code: 'KeyD', key: 'd' }));
  steps(input, 30);
  assert.ok(Math.abs(input.state.steer) < 0.05, `steer ${input.state.steer}`);
});

test('the handbrake key is Space, and it does not click a focused button', () => {
  const { input } = makeInput();
  input.setEnabled(true);
  const event = keyEvent('keydown', { code: 'Space', key: ' ' });
  globalThis.dispatchEvent(event);
  steps(input, 2);
  assert.equal(input.state.handbrake, true);
  assert.equal(event.defaultPrevented, true, 'Space must not scroll or re-click a button');
  globalThis.dispatchEvent(keyEvent('keyup', { code: 'Space', key: ' ' }));
  steps(input, 2);
  assert.equal(input.state.handbrake, false);
});

test('keys that arrive while the menu is up are ignored', () => {
  const { input } = makeInput();
  input.setEnabled(false);
  const event = keyEvent('keydown', { code: 'KeyW', key: 'w' });
  globalThis.dispatchEvent(event);
  input.setEnabled(true);
  steps(input, 4);
  assert.equal(input.state.throttle, 0, 'the throttle must not be latched from the menu');
  assert.equal(event.defaultPrevented, false, 'the menu keeps its own keyboard');
});

test('typing in a text field never drives the car', () => {
  const { input } = makeInput();
  input.setEnabled(true);
  const textarea = { tagName: 'TEXTAREA' };
  const event = keyEvent('keydown', { code: 'KeyW', key: 'w' });
  Object.defineProperty(event, 'target', { value: textarea });
  globalThis.dispatchEvent(event);
  steps(input, 4);
  assert.equal(input.state.throttle, 0);

  const field = { tagName: 'DIV', isContentEditable: true };
  const second = keyEvent('keydown', { code: 'KeyD', key: 'd' });
  Object.defineProperty(second, 'target', { value: field });
  globalThis.dispatchEvent(second);
  steps(input, 4);
  assert.equal(input.state.steer, 0);
});

test('a phone held at a slight angle does not cancel the steering keys', () => {
  const { input } = makeInput({ tiltEnabled: true });
  input.setEnabled(true);
  globalThis.dispatchEvent(keyEvent('keydown', { code: 'KeyD', key: 'd' }));
  // A small tilt, plus a resting gamepad with a noisy stick.
  const nav = globalThis.navigator;
  const stubbed = { getGamepads: () => [{ connected: true, axes: [0.16, 0], buttons: [] }] };
  Object.defineProperty(globalThis, 'navigator', { value: stubbed, configurable: true, writable: true });
  try {
    const tilt = new Event('deviceorientation');
    Object.assign(tilt, { gamma: 3, beta: 0 });
    globalThis.dispatchEvent(tilt);
    steps(input, 30);
    assert.ok(input.state.steer > 0.5, `steer ${input.state.steer}`);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
    globalThis.dispatchEvent(keyEvent('keyup', { code: 'KeyD', key: 'd' }));
  }
});

test('a real gamepad can still take over from the keyboard', () => {
  const { input } = makeInput();
  input.setEnabled(true);
  const nav = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => [{ connected: true, axes: [-0.9, 0], buttons: [] }] },
    configurable: true,
    writable: true,
  });
  try {
    steps(input, 2);
    assert.ok(input.state.steer < -0.85, `steer ${input.state.steer}`);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  }
});

test('the touch buttons hold while the finger slides off them', () => {
  const { input, gas, hand } = makeInput();
  input.setEnabled(true);

  gas.dispatchEvent(pointerEvent('pointerdown'));
  steps(input, 2);
  assert.equal(input.state.throttle, 1);

  // With pointer capture the browser may report a leave even though the
  // finger is still down: the throttle must stay on.
  gas.dispatchEvent(pointerEvent('pointerleave'));
  steps(input, 2);
  assert.equal(input.state.throttle, 1, 'the gas must not cut out mid-throttle');

  hand.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2 }));
  steps(input, 2);
  assert.equal(input.state.handbrake, true);

  // Releasing one button leaves the other one alone.
  hand.dispatchEvent(pointerEvent('pointerup', { pointerId: 2 }));
  steps(input, 2);
  assert.equal(input.state.handbrake, false);
  assert.equal(input.state.throttle, 1);

  gas.dispatchEvent(pointerEvent('pointerup'));
  steps(input, 2);
  assert.equal(input.state.throttle, 0);
});

test('a browser without pointer capture still releases a button', () => {
  const { input, brake } = makeInput();
  input.setEnabled(true);
  brake.setPointerCapture = undefined;
  brake.hasPointerCapture = undefined;

  brake.dispatchEvent(pointerEvent('pointerdown'));
  steps(input, 2);
  assert.equal(input.state.brake, 1);
  // Without capture, sliding off the button is a real release.
  brake.dispatchEvent(pointerEvent('pointerleave'));
  steps(input, 2);
  assert.equal(input.state.brake, 0);
});

test('losing the window releases every control', () => {
  const { input, gas, hand } = makeInput();
  input.setEnabled(true);
  globalThis.dispatchEvent(keyEvent('keydown', { code: 'KeyW', key: 'w' }));
  gas.dispatchEvent(pointerEvent('pointerdown', { pointerId: 3 }));
  hand.dispatchEvent(pointerEvent('pointerdown', { pointerId: 4 }));
  steps(input, 2);
  assert.equal(input.state.throttle, 1);
  assert.equal(input.state.handbrake, true);

  bus.dispatchEvent(new Event('blur'));
  steps(input, 2);
  assert.equal(input.state.throttle, 0);
  assert.equal(input.state.handbrake, false);
});

test('the steering pad is analogue and springs back', () => {
  const { input, pad } = makeInput();
  input.setEnabled(true);
  pad.dispatchEvent(pointerEvent('pointerdown', { clientX: 235, clientY: 45 }));
  steps(input, 2);
  assert.ok(input.state.steer > 0.8, `steer ${input.state.steer}`);
  pad.dispatchEvent(pointerEvent('pointerup', { clientX: 235, clientY: 45 }));
  steps(input, 2);
  assert.equal(input.state.steer, 0);

  pad.dispatchEvent(pointerEvent('pointerdown', { clientX: 30, clientY: 45 }));
  steps(input, 2);
  assert.ok(input.state.steer < -0.5, `steer ${input.state.steer}`);
  pad.dispatchEvent(pointerEvent('pointercancel'));
  steps(input, 2);
  assert.equal(input.state.steer, 0);
});
