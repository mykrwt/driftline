/**
 * Unified input: keyboard, touch (steering pad + buttons), gamepad and device tilt.
 *
 * The rest of the game only ever reads `input.state`, which is a normalised
 * control set:
 *   steer    -1 (left) .. 1 (right)
 *   throttle 0..1
 *   brake    0..1
 *   handbrake boolean
 *   boost    boolean
 */

import { clamp } from './math.js';

/**
 * @typedef {object} InputState
 * @property {number} steer
 * @property {number} throttle
 * @property {number} brake
 * @property {boolean} handbrake
 * @property {boolean} boost
 */

const KEY_MAP = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'handbrake',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
  KeyC: 'camera',
  KeyR: 'respawn',
  Escape: 'pause',
  KeyP: 'pause',
  KeyM: 'mute',
  Enter: 'confirm',
};

/**
 * @typedef {object} InputOptions
 * @property {HTMLElement | null} [steerElement]
 * @property {HTMLElement | null} [knobElement]
 * @property {Record<string, HTMLElement | null>} [buttons]
 * @property {boolean} [tiltEnabled]
 * @property {number} [tiltSensitivity]
 * @property {boolean} [invertSteer]
 */

/**
 * @param {InputOptions} options
 */
export function createInput(options = {}) {
  const state = /** @type {InputState} */ ({
    steer: 0,
    throttle: 0,
    brake: 0,
    handbrake: false,
    boost: false,
  });

  /** @type {Map<string, Set<(value: any) => void>>} */
  const listeners = new Map();

  /** @type {Record<string, boolean>} */
  const keys = Object.create(null);

  let touchSteer = 0;
  let touchThrottle = 0;
  let touchBrake = 0;
  let touchHandbrake = false;
  let touchBoost = false;
  let tiltSteer = 0;
  let gamepadSteer = 0;
  let gamepadThrottle = 0;
  let gamepadBrake = 0;
  let gamepadHandbrake = false;
  let gamepadBoost = false;
  let enabled = true;
  let invertSteer = options.invertSteer ?? false;
  let tiltEnabled = options.tiltEnabled ?? false;
  let tiltSensitivity = options.tiltSensitivity ?? 1;
  /** @type {number | null} */
  let steerPointer = null;
  let steerOriginX = 0;
  let steerHalfWidth = 100;

  /**
   * @param {string} event
   * @param {(value: any) => void} handler
   */
  function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => listeners.get(event)?.delete(handler);
  }

  /**
   * @param {string} event
   * @param {any} [value]
   */
  function emit(event, value) {
    const set = listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(value);
      } catch (err) {
        console.error('[input] listener failed', err);
      }
    }
  }

  // ------------------------------------------------------------- keyboard
  /** @param {KeyboardEvent} event */
  function onKeyDown(event) {
    const action = KEY_MAP[event.code];
    if (!action) return;
    if (event.repeat) {
      if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
        event.preventDefault();
      }
      return;
    }
    keys[action] = true;
    if (action === 'up' || action === 'down' || action === 'left' || action === 'right' || action === 'space') {
      event.preventDefault();
    }
    emit('action', action);
  }

  /** @param {KeyboardEvent} event */
  function onKeyUp(event) {
    const action = KEY_MAP[event.code];
    if (!action) return;
    keys[action] = false;
  }

  /** @param {Window} win */
  function attachKeyboard(win) {
    win.addEventListener('keydown', onKeyDown, { passive: false });
    win.addEventListener('keyup', onKeyUp);
    win.addEventListener('blur', () => {
      for (const k of Object.keys(keys)) keys[k] = false;
    });
  }

  // --------------------------------------------------------------- touch
  /**
   * @param {HTMLElement} el
   * @param {string} action
   */
  function attachButton(el, action) {
    if (!el) return;
    const down = (/** @type {PointerEvent} */ event) => {
      event.preventDefault();
      el.classList.add('is-down');
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        /* not fatal */
      }
      emit('touch', action);
    };
    const up = (/** @type {PointerEvent} */ event) => {
      event.preventDefault();
      el.classList.remove('is-down');
      emit('touch', `${action}:up`);
    };
    el.addEventListener('pointerdown', down, { passive: false });
    el.addEventListener('pointerup', up, { passive: false });
    el.addEventListener('pointercancel', up, { passive: false });
    el.addEventListener('pointerleave', up, { passive: false });
    el.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  /**
   * @param {HTMLElement} el
   */
  function attachSteerPad(el) {
    if (!el) return;
    const knob = options.knobElement ?? null;

    const apply = (/** @type {number} */ value) => {
      touchSteer = clamp(value, -1, 1);
      if (knob) knob.style.transform = `translateX(${touchSteer * (steerHalfWidth - 36)}px)`;
      el.setAttribute('aria-valuenow', String(Math.round(touchSteer * 100)));
    };

    const onMove = (/** @type {PointerEvent} */ event) => {
      if (steerPointer !== event.pointerId) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      steerOriginX = rect.left + rect.width / 2;
      steerHalfWidth = rect.width / 2;
      apply((event.clientX - steerOriginX) / (steerHalfWidth - 12));
    };

    el.addEventListener(
      'pointerdown',
      (/** @type {PointerEvent} */ event) => {
        event.preventDefault();
        steerPointer = event.pointerId;
        const rect = el.getBoundingClientRect();
        steerOriginX = rect.left + rect.width / 2;
        steerHalfWidth = rect.width / 2;
        try {
          el.setPointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
        apply((event.clientX - steerOriginX) / (steerHalfWidth - 12));
      },
      { passive: false },
    );
    el.addEventListener('pointermove', onMove, { passive: false });
    const release = (/** @type {PointerEvent} */ event) => {
      if (steerPointer !== event.pointerId) return;
      steerPointer = null;
      apply(0);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  // ---------------------------------------------------------------- tilt
  /** @param {DeviceOrientationEvent} event */
  function onOrientation(event) {
    if (!tiltEnabled) return;
    const gamma = event.gamma ?? 0;
    // gamma is the left/right tilt in degrees; +-25deg maps to full lock.
    tiltSteer = clamp((gamma / 25) * tiltSensitivity, -1, 1);
  }

  // ------------------------------------------------------------- gamepad
  function pollGamepad() {
    const nav = /** @type {any} */ (globalThis).navigator;
    if (!nav || !nav.getGamepads) return;
    const pads = nav.getGamepads();
    let pad = null;
    for (const candidate of pads) {
      if (candidate && candidate.connected) {
        pad = candidate;
        break;
      }
    }
    if (!pad) {
      gamepadSteer = 0;
      gamepadThrottle = 0;
      gamepadBrake = 0;
      gamepadHandbrake = false;
      gamepadBoost = false;
      return;
    }
    const axis = pad.axes[0] ?? 0;
    gamepadSteer = Math.abs(axis) < 0.12 ? 0 : axis;
    const rt = pad.buttons[7]?.value ?? 0;
    const lt = pad.buttons[6]?.value ?? 0;
    gamepadThrottle = rt;
    gamepadBrake = lt;
    gamepadHandbrake = Boolean(pad.buttons[0]?.pressed);
    gamepadBoost = Boolean(pad.buttons[1]?.pressed);
  }

  // ------------------------------------------------------------- update
  /**
   * Merge every source into `state`. Called once per simulation step.
   * @param {number} dt
   */
  function update(dt) {
    if (!enabled) {
      state.steer = 0;
      state.throttle = 0;
      state.brake = 0;
      state.handbrake = false;
      state.boost = false;
      return;
    }
    pollGamepad();

    const keyLeft = keys.left ? 1 : 0;
    const keyRight = keys.right ? 1 : 0;
    let keySteer = keyRight - keyLeft;
    if (keySteer === 0) {
      // Ease the wheel back to centre so keyboard driving feels analog.
      state.steer += (0 - state.steer) * Math.min(1, dt * 9);
    } else {
      const rate = keySteer * state.steer > 0 ? 6.5 : 9;
      state.steer += (keySteer - state.steer) * Math.min(1, dt * rate);
    }

    let steer = state.steer;
    if (Math.abs(touchSteer) > 0.001) steer = touchSteer;
    if (Math.abs(tiltSteer) > 0.001) steer = tiltSteer;
    if (Math.abs(gamepadSteer) > 0.001) steer = gamepadSteer;
    if (invertSteer) steer = -steer;
    state.steer = clamp(steer, -1, 1);

    state.throttle = clamp(Math.max(keys.up ? 1 : 0, touchThrottle, gamepadThrottle), 0, 1);
    state.brake = clamp(Math.max(keys.down ? 1 : 0, touchBrake, gamepadBrake), 0, 1);
    state.handbrake = Boolean(keys.handbrake || touchHandbrake || gamepadHandbrake);
    state.boost = Boolean(keys.boost || touchBoost || gamepadBoost);
  }

  // --------------------------------------------------------- public API
  const api = {
    state,
    on,
    update,
    /** @param {boolean} value */
    setEnabled(value) {
      enabled = value;
      if (!value) {
        touchSteer = 0;
        touchThrottle = 0;
        touchBrake = 0;
        touchHandbrake = false;
        touchBoost = false;
        state.steer = 0;
        state.throttle = 0;
        state.brake = 0;
        state.handbrake = false;
        state.boost = false;
      }
    },
    /** @param {boolean} value */
    setTiltEnabled(value) {
      tiltEnabled = value;
      if (!value) tiltSteer = 0;
    },
    /** @param {number} value */
    setTiltSensitivity(value) {
      tiltSensitivity = value;
    },
    /** @param {boolean} value */
    setInvertSteer(value) {
      invertSteer = value;
    },
    /** True when the device is likely a touch device. */
    get hasTouch() {
      return (
        typeof globalThis.matchMedia === 'function' &&
        globalThis.matchMedia('(pointer: coarse)').matches
      );
    },
    destroy() {
      globalThis.removeEventListener?.('keydown', onKeyDown);
      globalThis.removeEventListener?.('keyup', onKeyUp);
      globalThis.removeEventListener?.('deviceorientation', onOrientation);
    },
  };

  // Wire the DOM controls.
  const buttons = options.buttons || {};
  attachButton(buttons.gas || null, 'gas');
  attachButton(buttons.brake || null, 'brake');
  attachButton(buttons.hand || null, 'hand');
  attachButton(buttons.boost || null, 'boost');
  attachSteerPad(options.steerElement || null);
  attachKeyboard(globalThis);
  globalThis.addEventListener?.('deviceorientation', onOrientation);

  api.on('touch', (action) => {
    if (action === 'gas') touchThrottle = 1;
    else if (action === 'gas:up') touchThrottle = 0;
    else if (action === 'brake') touchBrake = 1;
    else if (action === 'brake:up') touchBrake = 0;
    else if (action === 'hand') touchHandbrake = true;
    else if (action === 'hand:up') touchHandbrake = false;
    else if (action === 'boost') touchBoost = true;
    else if (action === 'boost:up') touchBoost = false;
  });

  return api;
}

/**
 * Ask for device orientation permission (iOS needs an explicit user gesture).
 * @returns {Promise<boolean>}
 */
export async function requestTiltPermission() {
  const anyOrientation = /** @type {any} */ (globalThis).DeviceOrientationEvent;
  if (anyOrientation && typeof anyOrientation.requestPermission === 'function') {
    try {
      const result = await anyOrientation.requestPermission();
      return result === 'granted';
    } catch {
      return false;
    }
  }
  return true;
}
