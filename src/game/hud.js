/**
 * DOM heads-up display: speed, lap, timer, drift meter, boost, minimap and
 * the live standings. Text lives in the DOM (crisp on every DPI) while the
 * minimap uses a small 2D canvas.
 */

import { clamp, formatScore, formatTime, mpsToKmh } from '../core/math.js';
import { buildMinimapPath } from './track.js';

/**
 * @param {{ document?: Document }} [options]
 */
export function createHud(options = {}) {
  const doc = options.document ?? globalThis.document;

  const el = {
    hud: doc.getElementById('hud'),
    lap: doc.getElementById('hud-lap'),
    laps: doc.getElementById('hud-laps'),
    time: doc.getElementById('hud-time'),
    best: doc.getElementById('hud-best'),
    speed: doc.getElementById('hud-speed'),
    speedUnit: doc.getElementById('hud-speed-unit'),
    speedoFill: doc.getElementById('speedo-fill'),
    boost: doc.getElementById('boost-fill'),
    driftMeter: doc.getElementById('drift-meter'),
    driftScore: doc.getElementById('drift-score'),
    driftMult: doc.getElementById('drift-mult'),
    driftRing: doc.getElementById('drift-ring'),
    countdown: doc.getElementById('countdown'),
    minimap: doc.getElementById('minimap'),
    standings: doc.getElementById('standings'),
    netChip: doc.getElementById('hud-net-chip'),
    netDot: doc.getElementById('hud-net-dot'),
    net: doc.getElementById('hud-net'),
    flash: doc.getElementById('fx-flash'),
  };

  const minimapCtx = el.minimap?.getContext?.('2d') ?? null;
  /** @type {ReturnType<typeof buildMinimapPath> | null} */
  let minimapPath = null;

  /**
   * @param {import('./track.js').Track} track
   */
  function setTrack(track) {
    if (!el.minimap) return;
    const width = el.minimap.width;
    const height = el.minimap.height;
    minimapPath = buildMinimapPath(track, width, height, 14);
  }

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
   *   maxSpeed: number,
   *   lap: number,
   *   laps: number,
   *   lapTime: number,
   *   bestLap: number | null,
   *   driftScore: number,
   *   driftMultiplier: number,
   *   drifting: boolean,
   *   boostFuel: number,
   * }} state
   */
  function update(state) {
    const kmh = Math.round(mpsToKmh(state.speed));
    if (el.speed) el.speed.textContent = String(kmh);
    setSpeedArc(kmh / 340);
    if (el.lap) el.lap.textContent = String(Math.min(state.lap, state.laps));
    if (el.laps) el.laps.textContent = String(state.laps);
    if (el.time) el.time.textContent = formatTime(state.lapTime);
    if (el.best) el.best.textContent = state.bestLap ? formatTime(state.bestLap) : '--:--.--';

    if (el.boost) {
      el.boost.style.width = `${clamp(state.boostFuel, 0, 1) * 100}%`;
      el.boost.classList.toggle('is-ready', state.boostFuel > 0.95);
    }

    if (el.driftMeter) el.driftMeter.classList.toggle('is-active', state.drifting);
    if (el.driftScore) el.driftScore.textContent = formatScore(state.driftScore);
    if (el.driftMult) el.driftMult.textContent = `x${state.driftMultiplier.toFixed(1)}`;
    if (el.driftRing) {
      const arc = clamp(state.driftMultiplier / 5, 0, 1) * 100;
      el.driftRing.style.setProperty('--drift-arc', `${arc}%`);
    }
  }

  /**
   * @param {number} value
   */
  function countdown(value) {
    if (!el.countdown) return;
    if (value <= 0) {
      el.countdown.hidden = true;
      return;
    }
    el.countdown.hidden = false;
    el.countdown.textContent = value > 0 ? String(value) : 'GO!';
    // restart the animation
    el.countdown.style.animation = 'none';
    void el.countdown.offsetWidth;
    el.countdown.style.animation = '';
  }

  /**
   * @param {string} status
   * @param {number} peerCount
   */
  function setNet(status, peerCount) {
    if (!el.netChip) return;
    el.netChip.hidden = false;
    if (el.net) el.net.textContent = peerCount > 0 ? `${peerCount} peer${peerCount > 1 ? 's' : ''}` : status;
    if (el.netDot) {
      el.netDot.classList.toggle('is-on', status === 'connected');
      el.netDot.classList.toggle('is-wait', status === 'connecting' || status === 'waiting');
      el.netDot.classList.toggle('is-bad', status === 'disconnected' || status === 'failed');
    }
  }

  /**
   * @param {{ id: string, name: string, score: number, isMe?: boolean }[]} entries
   */
  function setStandings(entries) {
    if (!el.standings) return;
    const sorted = entries.slice().sort((a, b) => b.score - a.score).slice(0, 5);
    el.standings.replaceChildren(
      ...sorted.map((entry, index) => {
        const row = doc.createElement('div');
        row.className = entry.isMe ? 'standing standing--me' : 'standing';
        const pos = doc.createElement('span');
        pos.className = 'standing__pos';
        pos.textContent = `${index + 1}`;
        const name = doc.createElement('span');
        name.textContent = entry.name;
        const score = doc.createElement('span');
        score.className = 'standing__pos';
        score.textContent = formatScore(entry.score);
        row.append(pos, name, score);
        return row;
      }),
    );
  }

  /**
   * Draw the minimap.
   * @param {{ x: number, z: number, heading: number }} player
   * @param {{ id: string, x: number, z: number, color?: string }[]} ghosts
   */
  function drawMinimap(player, ghosts = []) {
    if (!minimapCtx || !minimapPath) return;
    const { width, height } = el.minimap;
    minimapCtx.clearRect(0, 0, width, height);

    minimapCtx.lineWidth = 7;
    minimapCtx.strokeStyle = 'rgba(255,255,255,0.14)';
    minimapCtx.lineJoin = 'round';
    minimapCtx.beginPath();
    for (let i = 0; i < minimapPath.points.length; i++) {
      const p = minimapPath.points[i];
      if (i === 0) minimapCtx.moveTo(p.x, p.y);
      else minimapCtx.lineTo(p.x, p.y);
    }
    minimapCtx.closePath();
    minimapCtx.stroke();

    minimapCtx.lineWidth = 3;
    minimapCtx.strokeStyle = 'rgba(65,224,255,0.75)';
    minimapCtx.stroke();

    for (const ghost of ghosts) {
      const p = mapPoint(ghost.x, ghost.z);
      if (!p) continue;
      minimapCtx.fillStyle = ghost.color || '#ff4d8d';
      minimapCtx.beginPath();
      minimapCtx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
      minimapCtx.fill();
    }

    const me = mapPoint(player.x, player.z);
    if (me) {
      minimapCtx.fillStyle = '#ffffff';
      minimapCtx.strokeStyle = '#41e0ff';
      minimapCtx.lineWidth = 2;
      minimapCtx.beginPath();
      minimapCtx.arc(me.x, me.y, 4.6, 0, Math.PI * 2);
      minimapCtx.fill();
      minimapCtx.stroke();
    }
  }

  /**
   * @param {number} x
   * @param {number} z
   */
  function mapPoint(x, z) {
    if (!minimapPath) return null;
    return {
      x: (x - minimapPath.minX) * minimapPath.scale + minimapPath.offsetX,
      y: (z - minimapPath.minZ) * minimapPath.scale + minimapPath.offsetY,
    };
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

  return {
    el,
    setTrack,
    update,
    countdown,
    setNet,
    setStandings,
    drawMinimap,
    show,
    hide,
    flash,
  };
}
