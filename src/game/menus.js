/**
 * Screens: title, lobby, pause and settings.
 *
 * The world is endless, so there is no track or lap selection - just a car,
 * a button to drive, and the room for multiplayer.
 */

import { CAR_SPECS } from './vehicle.js';
import { clamp } from '../core/math.js';

/**
 * @param {{
 *   settings: any,
 *   onStart: () => void,
 *   onHost: () => void,
 *   onJoin: () => void,
 *   onLocalRoom: () => void,
 *   onLocalHost: () => void,
 *   onConnect: (code: string) => void,
 *   onAcceptAnswer: (code: string) => void,
 *   onStartRace: () => void,
 *   onLeaveLobby: () => void,
 *   onResume: () => void,
 *   onRestart: () => void,
 *   onQuit: () => void,
 *   onSettingsChange: (settings: any) => void,
 *   onCopy: (text: string) => void,
 *   onShare: (text: string) => void,
 * }} options
 */
export function createMenus(options) {
  const doc = globalThis.document;
  const app = doc.getElementById('app');

  const screens = {
    title: doc.getElementById('screen-title'),
    lobby: doc.getElementById('screen-lobby'),
    pause: doc.getElementById('screen-pause'),
    settings: doc.getElementById('screen-settings'),
  };

  const toastEl = doc.getElementById('toast');
  let toastTimer = 0;
  /** @type {keyof typeof screens | null} */
  let current = null;

  // ------------------------------------------------------------ car picker
  const carPicker = doc.getElementById('car-picker');

  function renderPickers() {
    if (!carPicker) return;
    carPicker.replaceChildren(
      ...Object.values(CAR_SPECS).map((car) => {
        const chip = doc.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.setAttribute('role', 'radio');
        chip.setAttribute('aria-checked', String(car.id === options.settings.car));
        chip.textContent = car.name;
        chip.title = car.description;
        chip.addEventListener('click', () => {
          options.settings.car = car.id;
          options.onSettingsChange(options.settings);
          renderPickers();
        });
        return chip;
      }),
    );
  }
  renderPickers();

  // -------------------------------------------------------------- settings
  const settingsBody = doc.getElementById('settings-body');

  /**
   * @param {string} label
   * @param {string} hint
   * @param {HTMLElement} control
   */
  function row(label, hint, control) {
    const wrap = doc.createElement('div');
    wrap.className = 'setting';
    const text = doc.createElement('div');
    text.className = 'setting__label';
    text.textContent = label;
    if (hint) {
      const small = doc.createElement('span');
      small.className = 'setting__hint';
      small.textContent = hint;
      text.append(small);
    }
    wrap.append(text, control);
    return wrap;
  }

  /**
   * @param {boolean} value
   * @param {(value: boolean) => void} onChange
   */
  function toggle(value, onChange) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'switch';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-checked', String(value));
    button.setAttribute('aria-label', 'toggle');
    button.addEventListener('click', () => {
      const next = button.getAttribute('aria-checked') !== 'true';
      button.setAttribute('aria-checked', String(next));
      onChange(next);
    });
    return button;
  }

  function renderSettings() {
    if (!settingsBody) return;
    const s = options.settings;
    const parts = [];

    const quality = doc.createElement('select');
    for (const [value, label] of [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]) {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = label;
      if (s.quality === value) option.selected = true;
      quality.append(option);
    }
    quality.addEventListener('change', () => {
      s.quality = quality.value;
      options.onSettingsChange(s);
    });
    parts.push(row('Graphics quality', 'Lower settings keep the frame rate high', quality));

    const volume = doc.createElement('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '1';
    volume.step = '0.05';
    volume.value = String(s.volume);
    volume.addEventListener('input', () => {
      s.volume = Number(volume.value);
      options.onSettingsChange(s);
    });
    parts.push(row('Volume', null, volume));

    parts.push(row('Mute', null, toggle(s.muted, (value) => {
      s.muted = value;
      options.onSettingsChange(s);
    })));

    parts.push(row('Adaptive resolution', 'Drops pixels automatically when frames drop', toggle(s.autoQuality, (value) => {
      s.autoQuality = value;
      options.onSettingsChange(s);
    })));

    parts.push(row('Tilt steering', 'Steer by tilting the phone (needs permission)', toggle(s.tiltSteer, (value) => {
      s.tiltSteer = value;
      options.onSettingsChange(s);
    })));

    const sensitivity = doc.createElement('input');
    sensitivity.type = 'range';
    sensitivity.min = '0.4';
    sensitivity.max = '2';
    sensitivity.step = '0.1';
    sensitivity.value = String(s.tiltSensitivity);
    sensitivity.addEventListener('input', () => {
      s.tiltSensitivity = Number(sensitivity.value);
      options.onSettingsChange(s);
    });
    parts.push(row('Tilt sensitivity', null, sensitivity));

    parts.push(row('Invert steering', null, toggle(s.invertSteer, (value) => {
      s.invertSteer = value;
      options.onSettingsChange(s);
    })));

    parts.push(row('Show performance overlay', null, toggle(s.showFps, (value) => {
      s.showFps = value;
      options.onSettingsChange(s);
    })));

    settingsBody.replaceChildren(...parts);
  }

  // ---------------------------------------------------------------- lobby
  const lobbyTitle = doc.getElementById('lobby-title');
  const lobbyLead = doc.getElementById('lobby-lead');
  const lobbyHost = doc.getElementById('lobby-host');
  const lobbyJoin = doc.getElementById('lobby-join');
  const lobbyPeers = doc.getElementById('lobby-peers');
  const inviteCode = doc.getElementById('invite-code');
  const joinCode = doc.getElementById('join-code');
  const answerCode = doc.getElementById('answer-code');
  const replyCode = doc.getElementById('reply-code');
  const replyField = doc.getElementById('reply-field');
  const btnStartRace = doc.getElementById('btn-start-race');

  /**
   * @param {{ mode: 'host' | 'join' }} config
   */
  function showLobby(config) {
    if (lobbyTitle) lobbyTitle.textContent = config.mode === 'host' ? 'Hosting a room' : 'Join a room';
    if (lobbyLead) {
      lobbyLead.textContent =
        config.mode === 'host'
          ? 'Send the invite code to a friend. You drive the same endless world - there is no server in between.'
          : 'Paste the invite code your friend sent you, then press Connect.';
    }
    if (lobbyHost) lobbyHost.hidden = config.mode !== 'host';
    if (lobbyJoin) lobbyJoin.hidden = config.mode !== 'join';
    if (btnStartRace) btnStartRace.hidden = config.mode !== 'host';
    show('lobby');
  }

  /**
   * @param {string} code
   */
  function setInviteCode(code) {
    if (inviteCode) inviteCode.value = code;
  }

  /**
   * @param {string} code
   */
  function setReplyCode(code) {
    if (replyCode) replyCode.value = code;
    if (replyField) replyField.hidden = !code;
  }

  /** @returns {string} */
  function getAnswerCode() {
    return answerCode?.value?.trim() ?? '';
  }

  /** @returns {string} */
  function getJoinCode() {
    return joinCode?.value?.trim() ?? '';
  }

  /**
   * @param {any[]} peers
   */
  function renderPeers(peers) {
    if (!lobbyPeers) return;
    lobbyPeers.replaceChildren(
      ...peers.map((peer) => {
        const rowEl = doc.createElement('div');
        rowEl.className = `peer ${peer.ready ? 'peer--ready' : 'peer--waiting'}`;
        rowEl.setAttribute('role', 'listitem');
        const dot = doc.createElement('span');
        dot.className = 'peer__dot';
        const name = doc.createElement('span');
        name.textContent = peer.name;
        const role = doc.createElement('span');
        role.className = 'peer__role';
        role.textContent = peer.id === options.settings.name ? 'you' : 'driver';
        rowEl.append(dot, name, role);
        return rowEl;
      }),
    );
  }

  // --------------------------------------------------------------- screens
  /**
   * @param {keyof typeof screens | null} name
   */
  function show(name) {
    for (const [key, element] of Object.entries(screens)) {
      if (element) element.hidden = key !== name;
    }
    current = name;
    if (app) app.dataset.phase = name ?? 'game';
    if (name === 'settings') renderSettings();
    if (name === 'title') renderPickers();
  }

  function hideAll() {
    for (const element of Object.values(screens)) {
      if (element) element.hidden = true;
    }
    current = null;
    if (app) app.dataset.phase = 'game';
  }

  /**
   * @param {string} message
   * @param {boolean} [bad]
   */
  function toast(message, bad = false) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.toggle('toast--bad', bad);
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2600);
  }

  // ---------------------------------------------------------------- wiring
  const on = (id, handler) => doc.getElementById(id)?.addEventListener('click', handler);
  on('btn-solo', () => options.onStart());
  on('btn-host', () => options.onHost());
  on('btn-join', () => options.onJoin());
  on('btn-settings', () => show('settings'));
  on('btn-settings-close', () => show('title'));
  on('btn-pause-settings', () => show('settings'));
  on('btn-resume', () => options.onResume());
  on('btn-restart', () => options.onRestart());
  on('btn-quit', () => options.onQuit());
  on('btn-leave-lobby', () => options.onLeaveLobby());
  on('btn-copy-invite', () => inviteCode?.value && options.onCopy(inviteCode.value));
  on('btn-share-invite', () => inviteCode?.value && options.onShare(inviteCode.value));
  on('btn-start-race', () => options.onStartRace());
  on('btn-connect', () => options.onConnect(getJoinCode()));
  on('btn-accept-answer', () => options.onAcceptAnswer(getAnswerCode()));
  on('btn-local-room', () => options.onLocalRoom());
  on('btn-local-host', () => options.onLocalHost());

  return {
    show,
    hideAll,
    toast,
    renderSettings,
    renderPickers,
    showLobby,
    setInviteCode,
    setReplyCode,
    getAnswerCode,
    getJoinCode,
    renderPeers,
    get current() {
      return current;
    },
  };
}
