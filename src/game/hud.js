/**
 * Heads-up display: speed, drift score, boost and the player list.
 *
 * Deliberately small: an endless world only needs a handful of numbers.
 */

import { clamp, formatScore } from '../core/math.js';

/**
 * @param {{ document?: Document }} [options]
 */
export function createHud(options = {}) {
  const doc = options.document ?? globalThis.document;

  const el = {
    hud: doc.getElementById('hud'),
    speed: doc.getElementById('hud-speed'),
    speedUnit: doc.getElementById('hud-speed-unit'),
    speedoFill: doc.getElementById('speedo-fill'),
    boost: doc.getElementById('boost-fill'),
    distance: doc.getElementById('hud-distance'),
    driftMeter: doc.getElementById('drift-meter'),
    driftScore: doc.getElementById('drift-score'),
    driftMult: doc.getElementById('drift-mult'),
    driftRing: doc.getElementById('drift-ring'),
    peers: doc.getElementById('peer-list'),
    flash: doc.getElementById('fx-flash'),
  };

  /**
   * @param {number} value 0..1
   */
  function setSpeedArc(value) {
    if (!el.speedoFill) return;
    const length = 245;
    const dash = length * clamp(value, 0, 1);
    el.speedoFill.style.strokeDasharray = `${dash} ${327 - dash}`;
    el.speedoFill.style.stroke = value > 0.82 ? 'var(--accent-2)' : 'var(--accent)';
  }

  /**
   * @param {{
   *   speed: number,
   *   kmh: number,
   *   drift: number,
   *   multiplier: number,
   *   drifting: boolean,
   *   boost: number,
   *   distance: number,
   * }} state
   */
  function update(state) {
    if (el.speed) el.speed.textContent = String(Math.round(state.kmh));
    setSpeedArc(state.kmh / 320);
    if (el.distance) el.distance.textContent = `${(state.distance / 1000).toFixed(2)} km`;

    if (el.boost) {
      el.boost.style.width = `${clamp(state.boost, 0, 1) * 100}%`;
      el.boost.classList.toggle('is-ready', state.boost > 0.95);
    }
    if (el.driftMeter) el.driftMeter.classList.toggle('is-active', state.drifting);
    if (el.driftScore) el.driftScore.textContent = formatScore(state.drift);
    if (el.driftMult) el.driftMult.textContent = `x${state.multiplier.toFixed(1)}`;
    if (el.driftRing) {
      el.driftRing.style.setProperty('--drift-arc', `${clamp(state.multiplier / 5, 0, 1) * 100}%`);
    }
  }

  /**
   * @param {{ name: string, score: number, isMe?: boolean }[]} entries
   */
  function setPeers(entries) {
    if (!el.peers) return;
    el.peers.replaceChildren(
      ...entries.map((entry) => {
        const row = doc.createElement('div');
        row.className = entry.isMe ? 'standing standing--me' : 'standing';
        const name = doc.createElement('span');
        name.textContent = entry.name;
        const score = doc.createElement('span');
        score.className = 'standing__pos';
        score.textContent = formatScore(entry.score);
        row.append(name, score);
        return row;
      }),
    );
  }

  function show() {
    el.hud?.classList.add('is-visible');
    el.hud?.removeAttribute('aria-hidden');
  }

  function hide() {
    el.hud?.classList.remove('is-visible');
    el.hud?.setAttribute('aria-hidden', 'true');
  }

  function flash() {
    if (!el.flash) return;
    el.flash.classList.remove('is-hit');
    void el.flash.offsetWidth;
    el.flash.classList.add('is-hit');
  }

  return { el, update, setPeers, show, hide, flash };
}
