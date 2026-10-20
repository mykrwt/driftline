/**
 * Screen flow: title, lobby, pause, settings and results.
 *
 * The menus only talk to the game through callbacks, so they stay easy to
 * drive from tests.
 */

import { CARS } from './physics.js';
import { TRACKS } from './track.js';
import { formatTime, formatScore } from '../core/math.js';

/**
 * @param {{
 *   settings: import('../core/storage.js').Settings,
 *   records: import('../core/storage.js').Records,
 *   onStart: () => void,
 *   onHost: () => void,
 *   onJoin: () => void,
 *   onLocalRoom: () => void,
 *   onConnect: (code: string) => void,
 *   onAcceptAnswer?: (code: string) => void,
 *   onLocalHost?: () => void,
 *   onStartRace: () => void,
 *   onLeaveLobby: () => void,
 *   onResume: () => void,
 *   onRestart: () => void,
 *   onQuit: () => void,
 *   onSettingsChange: (settings: import('../core/storage.js').Settings) => void,
 *   onCopy: (text: string) => void,
 *   onShare: (text: string) => void,
 *   onNextRace: () => void,
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
    results: doc.getElementById('screen-results'),
  };

  const toastEl = doc.getElementById('toast');
  let toastTimer = 0;
  let current = /** @type {keyof typeof screens | null} */ (null);

  // ------------------------------------------------------------- pickers
  const carPicker = doc.getElementById('car-picker');
  const trackPicker = doc.getElementById('track-picker');

  function renderPickers() {
    if (carPicker) {
      carPicker.replaceChildren(
        ...CARS.map((car) => {
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
    if (trackPicker) {
      trackPicker.replaceChildren(
        ...TRACKS.map((track) => {
          const chip = doc.createElement('button');
          chip.type = 'button';
          chip.className = 'chip';
          chip.setAttribute('role', 'radio');
          chip.setAttribute('aria-checked', String(track.id === options.settings.track));
          chip.textContent = track.name;
          chip.addEventListener('click', () => {
            options.settings.track = track.id;
            options.onSettingsChange(options.settings);
            renderPickers();
          });
          return chip;
        }),
      );
    }
  }
  renderPickers();

  // ------------------------------------------------------------- settings
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
    for (const [value, label] of [
      ['low', 'Low'],
      ['medium', 'Medium'],
      ['high', 'High'],
    ]) {
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

    const units = doc.createElement('select');
    for (const [value, label] of [['metric', 'km/h'], ['imperial', 'mph']]) {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = label;
      if (s.units === value) option.selected = true;
      units.append(option);
    }
    units.addEventListener('change', () => {
      s.units = units.value;
      options.onSettingsChange(s);
    });
    parts.push(row('Speed units', null, units));

    parts.push(row('Show performance overlay', null, toggle(s.showFps, (value) => {
      s.showFps = value;
      options.onSettingsChange(s);
    })));

    settingsBody.replaceChildren(...parts);
  }

  // -------------------------------------------------------------- results
  const resultsBody = doc.getElementById('results-body');
  const resultsTitle = doc.getElementById('results-title');

  /**
   * @param {{
   *   lapTimes: number[],
   *   bestLap: number | null,
   *   bestDrift: number,
   *   raceTime: number,
   *   position?: number,
   *   peers?: { name: string, score: number }[],
   * }} data
   */
  function renderResults(data) {
    if (resultsTitle) resultsTitle.textContent = data.position ? `Finished P${data.position}` : 'Race complete';
    if (!resultsBody) return;
    const rows = [];
    /**
     * @param {string} label
     * @param {string} value
     * @param {boolean} [hero]
     */
    const add = (label, value, hero) => {
      const rowEl = doc.createElement('div');
      rowEl.className = hero ? 'result-row result-row--hero' : 'result-row';
      const l = doc.createElement('span');
      l.className = 'result-row__label';
      l.textContent = label;
      const v = doc.createElement('span');
      v.className = 'result-row__value';
      v.textContent = value;
      rowEl.append(l, v);
      rows.push(rowEl);
    };

    add('Total time', formatTime(data.raceTime));
    add('Best lap', data.bestLap ? formatTime(data.bestLap) : '--:--.--', true);
    data.lapTimes.forEach((time, index) => add(`Lap ${index + 1}`, formatTime(time)));
    add('Best drift', formatScore(data.bestDrift));
    for (const peer of data.peers || []) {
      add(peer.name, formatScore(peer.score));
    }
    resultsBody.replaceChildren(...rows);
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
          ? 'Send the invite code to a friend. The host owns the track and the traffic - there is no server in between.'
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

  /**
   * @returns {string}
   */
  function getAnswerCode() {
    return answerCode?.value?.trim() ?? '';
  }

  /**
   * @returns {string}
   */
  function getJoinCode() {
    return joinCode?.value?.trim() ?? '';
  }

  /**
   * @param {import('../net/protocol.js').PeerInfo[]} peers
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
  doc.getElementById('btn-solo')?.addEventListener('click', () => options.onStart());
  doc.getElementById('btn-host')?.addEventListener('click', () => options.onHost());
  doc.getElementById('btn-join')?.addEventListener('click', () => options.onJoin());
  doc.getElementById('btn-settings')?.addEventListener('click', () => show('settings'));
  doc.getElementById('btn-settings-close')?.addEventListener('click', () => {
    show(current === 'settings' ? 'title' : 'title');
  });
  doc.getElementById('btn-pause-settings')?.addEventListener('click', () => show('settings'));
  doc.getElementById('btn-resume')?.addEventListener('click', () => options.onResume());
  doc.getElementById('btn-restart')?.addEventListener('click', () => options.onRestart());
  doc.getElementById('btn-quit')?.addEventListener('click', () => options.onQuit());
  doc.getElementById('btn-again')?.addEventListener('click', () => options.onAgain());
  doc.getElementById('btn-menu')?.addEventListener('click', () => options.onQuit());
  doc.getElementById('btn-leave-lobby')?.addEventListener('click', () => options.onLeaveLobby());
  doc.getElementById('btn-copy-invite')?.addEventListener('click', () => {
    if (inviteCode?.value) options.onCopy(inviteCode.value);
  });
  doc.getElementById('btn-share-invite')?.addEventListener('click', () => {
    if (inviteCode?.value) options.onShare(inviteCode.value);
  });
  doc.getElementById('btn-start-race')?.addEventListener('click', () => options.onStartRace());
  doc.getElementById('btn-connect')?.addEventListener('click', () => {
    options.onConnect(getJoinCode());
  });
  doc.getElementById('btn-accept-answer')?.addEventListener('click', () => {
    options.onAcceptAnswer(getAnswerCode());
  });
  doc.getElementById('btn-local-room')?.addEventListener('click', () => options.onLocalRoom());
  doc.getElementById('btn-local-host')?.addEventListener('click', () => options.onLocalHost());

  return {
    show,
    hideAll,
    toast,
    renderResults,
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
