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
 *
 * Three rules keep the controls predictable:
 *
 *   - keys are only collected while the game is enabled, and never while the
 *     player is typing in a text field, so a text box can never drive the car;
 *   - the analogue sources (touch, tilt, pad) are merged by strength instead
 *     of by priority, so a resting pad or a phone held at a slight angle can
 *     never cancel a key that is actually held;
 *   - a touch button stays down until its own pointer is released, even if
 *     the finger slides off it, and every source is cleared when the window
 *     loses focus, so nothing can get stuck on.
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
 * Fallback for browsers that hand out an empty or unusual `event.code`
 * (some mobile keyboards and remote layouts do).
 * @type {Record<string, string>}
 */
const KEY_FALLBACK = {
  arrowup: 'up',
  w: 'up',
  arrowdown: 'down',
  s: 'down',
  arrowleft: 'left',
  a: 'left',
  arrowright: 'right',
  d: 'right',
  ' ': 'handbrake',
  spacebar: 'handbrake',
  shift: 'boost',
  c: 'camera',
  r: 'respawn',
  escape: 'pause',
  esc: 'pause',
  p: 'pause',
  m: 'mute',
  enter: 'confirm',
};

/** The keys that only make sense while driving. */
const DRIVING_ACTIONS = new Set(['up', 'down', 'left', 'right', 'handbrake', 'boost']);

/**
 * @param {KeyboardEvent} event
 * @returns {string | null}
 */
function resolveAction(event) {
  if (event.code && KEY_MAP[event.code]) return KEY_MAP[event.code];
  const key = String(event.key || '').toLowerCase();
  return KEY_FALLBACK[key] ?? null;
}

/**
 * Is the event coming from something the player is typing into?
 * @param {any} target
 */
function isEditable(target) {
  if (!target || typeof target !== 'object') return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

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
  /** The keyboard steering, eased so it feels analogue. */
  let keySteer = 0;
  let enabled = true;
  let invertSteer = options.invertSteer ?? false;
  let tiltEnabled = options.tiltEnabled ?? false;
  let tiltSensitivity = options.tiltSensitivity ?? 1;
  /** @type {Array<() => void>} */
  const releases = [];

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

  /** Drop every held control. */
  function clearAll() {
    for (const key of Object.keys(keys)) keys[key] = false;
    keySteer = 0;
    touchSteer = 0;
    touchThrottle = 0;
    touchBrake = 0;
    touchHandbrake = false;
    touchBoost = false;
    gamepadSteer = 0;
    gamepadThrottle = 0;
    gamepadBrake = 0;
    gamepadHandbrake = false;
    gamepadBoost = false;
    tiltSteer = 0;
    for (const release of releases) release();
  }

  // ------------------------------------------------------------- keyboard
  /** @param {KeyboardEvent} event */
  function onKeyDown(event) {
    // Never swallow the browser's own shortcuts, and never read keys that
    // are being typed into a field.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isEditable(event.target)) return;
    const action = resolveAction(event);
    if (!action) return;

    const driving = DRIVING_ACTIONS.has(action);
    if (driving && !enabled) {
      // The menu is up: do not latch the throttle on the way into the game.
      keys[action] = false;
      return;
    }

    if (enabled) {
      // This also keeps a focused menu button from being re-activated by
      // Space or Enter in the middle of a drift.
      event.preventDefault();
    }
    if (event.repeat) return;
    keys[action] = true;
    emit('action', action);
  }

  /** @param {KeyboardEvent} event */
  function onKeyUp(event) {
    const action = resolveAction(event);
    if (!action) return;
    keys[action] = false;
  }

  /** @param {Window} win */
  function attachKeyboard(win) {
    if (!win || typeof win.addEventListener !== 'function') return;
    win.addEventListener('keydown', onKeyDown, { passive: false });
    win.addEventListener('keyup', onKeyUp);
    win.addEventListener('blur', () => clearAll());
  }

  // --------------------------------------------------------------- touch
  /**
   * @param {boolean} pressed
   * @param {string} action
   */
  function setTouch(action, pressed) {
    if (action === 'gas') touchThrottle = pressed ? 1 : 0;
    else if (action === 'brake') touchBrake = pressed ? 1 : 0;
    else if (action === 'hand') touchHandbrake = pressed;
    else if (action === 'boost') touchBoost = pressed;
    emit('touch', pressed ? action : `${action}:up`);
  }

  /**
   * @param {HTMLElement} el
   * @param {string} action
   */
  function attachButton(el, action) {
    if (!el || typeof el.addEventListener !== 'function') return;
    /** @type {number | null} */
    let pointerId = null;

    const release = () => {
      pointerId = null;
      el.classList?.remove('is-down');
      el.setAttribute?.('aria-pressed', 'false');
      setTouch(action, false);
    };

    const down = (/** @type {PointerEvent} */ event) => {
      event.preventDefault();
      pointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
      el.classList?.add('is-down');
      el.setAttribute?.('aria-pressed', 'true');
      // Capture keeps the button held even when the finger slides off it.
      // Browsers without pointer capture fall back to the document release
      // below, so the button still never gets stuck.
      if (pointerId !== null && typeof el.setPointerCapture === 'function') {
        try {
          el.setPointerCapture(pointerId);
        } catch {
          /* not fatal */
        }
      }
      setTouch(action, true);
    };

    const up = (/** @type {PointerEvent} */ event) => {
      if (event && typeof event.pointerId === 'number' && pointerId !== null) {
        if (event.pointerId !== pointerId) return;
      }
      event?.preventDefault?.();
      release();
    };

    el.addEventListener('pointerdown', down, { passive: false });
    el.addEventListener('pointerup', up, { passive: false });
    el.addEventListener('pointercancel', up, { passive: false });
    el.addEventListener('lostpointercapture', release);
    el.addEventListener(
      'pointerleave',
      (/** @type {PointerEvent} */ event) => {
        // While the pointer is captured the browser may report a leave even
        // though the finger is still on the button. Only a real leave - on a
        // browser without pointer capture - releases it.
        if (pointerId !== null && el.hasPointerCapture?.(pointerId)) return;
        up(event);
      },
      { passive: false },
    );
    el.addEventListener('contextmenu', (event) => event.preventDefault());
    releases.push(release);
  }

  /**
   * @param {HTMLElement} el
   */
  function attachSteerPad(el) {
    if (!el || typeof el.addEventListener !== 'function') return;
    const knob = options.knobElement ?? null;
    /** @type {number | null} */
    let pointerId = null;
    let originX = 0;
    let halfWidth = 120;

    const apply = (/** @type {number} */ value) => {
      touchSteer = clamp(value, -1, 1);
      if (knob) knob.style.transform = `translateX(${touchSteer * (halfWidth - 36)}px)`;
      el.setAttribute?.('aria-valuenow', String(Math.round(touchSteer * 100)));
    };

    const track = (/** @type {PointerEvent} */ event) => {
      const rect = el.getBoundingClientRect?.();
      if (!rect || !rect.width) return;
      originX = rect.left + rect.width / 2;
      halfWidth = rect.width / 2;
      apply((event.clientX - originX) / Math.max(12, halfWidth - 12));
    };

    el.addEventListener(
      'pointerdown',
      (/** @type {PointerEvent} */ event) => {
        event.preventDefault();
        pointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
        if (pointerId !== null && typeof el.setPointerCapture === 'function') {
          try {
            el.setPointerCapture(pointerId);
          } catch {
            /* ignore */
          }
        }
        track(event);
      },
      { passive: false },
    );

    el.addEventListener(
      'pointermove',
      (/** @type {PointerEvent} */ event) => {
        if (pointerId === null || event.pointerId !== pointerId) return;
        event.preventDefault();
        track(event);
      },
      { passive: false },
    );

    const release = (/** @type {PointerEvent} */ event) => {
      if (event && typeof event.pointerId === 'number' && pointerId !== null) {
        if (event.pointerId !== pointerId) return;
      }
      pointerId = null;
      apply(0);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener(
      'pointerleave',
      (/** @type {PointerEvent} */ event) => {
        if (pointerId !== null && el.hasPointerCapture?.(pointerId)) return;
        release(event);
      },
      { passive: false },
    );
    el.addEventListener('lostpointercapture', release);
    el.addEventListener('contextmenu', (event) => event.preventDefault());
    releases.push(() => {
      pointerId = null;
      touchSteer = 0;
      apply(0);
    });
  }

  // ---------------------------------------------------------------- tilt
  /** @param {DeviceOrientationEvent} event */
  function onOrientation(event) {
    if (!tiltEnabled) return;
    const gamma = event.gamma ?? 0;
    // gamma is the left/right tilt in degrees; +-25deg maps to full lock.
    const raw = clamp((gamma / 25) * tiltSensitivity, -1, 1);
    // A deadzone keeps a phone held "straight" from steering on its own.
    tiltSteer = Math.abs(raw) < 0.06 ? 0 : raw;
  }

  // ------------------------------------------------------------- gamepad
  function pollGamepad() {
    const nav = /** @type {any} */ (globalThis).navigator;
    if (!nav || typeof nav.getGamepads !== 'function') return;
    const pads = nav.getGamepads() || [];
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
    const axis = pad.axes?.[0] ?? 0;
    gamepadSteer = Math.abs(axis) < 0.18 ? 0 : axis;
    gamepadThrottle = pad.buttons?.[7]?.value ?? 0;
    gamepadBrake = pad.buttons?.[6]?.value ?? 0;
    gamepadHandbrake = Boolean(pad.buttons?.[0]?.pressed);
    gamepadBoost = Boolean(pad.buttons?.[1]?.pressed);
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

    // Keyboard steering eases in and springs back, so it drives like an
    // analogue stick instead of a switch.
    const keyDirection = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (keyDirection === 0) {
      keySteer += (0 - keySteer) * Math.min(1, dt * 9);
    } else {
      const rate = keyDirection * keySteer > 0 ? 6.5 : 9;
      keySteer += (keyDirection - keySteer) * Math.min(1, dt * rate);
    }

    // Merge by strength: whichever control is asking for more steering wins.
    // A faint tilt or a pad at rest can never cancel a held key.
    let steer = keySteer;
    let strength = Math.abs(keySteer);
    for (const value of [gamepadSteer, touchSteer, tiltSteer]) {
      const magnitude = Math.abs(value);
      if (magnitude > Math.max(0.08, strength)) {
        steer = value;
        strength = magnitude;
      }
    }
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
        clearAll();
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
      // A touchscreen laptop reports `pointer: fine` but still wants the
      // buttons, so ask about the hardware first.
      const navigatorLike = /** @type {any} */ (globalThis).navigator;
      if ((navigatorLike?.maxTouchPoints ?? 0) > 0) return true;
      if (
        typeof globalThis.matchMedia === 'function' &&
        globalThis.matchMedia('(pointer: coarse)').matches
      ) {
        return true;
      }
      return typeof /** @type {any} */ (globalThis).ontouchstart !== 'undefined';
    },
    /** The state of one key, for tests and the self test. */
    clear() {
      clearAll();
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
  globalThis.document?.addEventListener?.('visibilitychange', () => clearAll());

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
