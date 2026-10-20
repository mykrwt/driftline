/**
 * Procedural audio.
 *
 * No sample files: the engine, tyres, wind and impacts are synthesised with
 * WebAudio so the game stays a tiny static download and works offline.
 */

import { clamp } from '../core/math.js';

/**
 * @returns {{
 *   unlock: () => Promise<boolean>,
 *   setVolume: (value: number) => void,
 *   setMuted: (value: boolean) => void,
 *   engine: (rpm: number, load: number) => void,
 *   tyre: (slip: number, speed: number) => void,
 *   wind: (speed: number) => void,
 *   boost: () => void,
 *   impact: (force: number) => void,
 *   beep: (frequency?: number, duration?: number) => void,
 *   countdown: (final: boolean) => void,
 *   dispose: () => void,
 * }}
 */
export function createAudio() {
  /** @type {AudioContext | null} */
  let ctx = null;
  let master = null;
  let engineGain = null;
  let engineFilter = null;
  let tyreGain = null;
  let tyreFilter = null;
  let windGain = null;
  let started = false;
  let muted = false;
  let volume = 0.7;
  /** @type {OscillatorNode[]} */
  let engineOsc = [];
  /** @type {OscillatorNode | null} */
  let engineSub = null;

  function noiseBuffer(seconds = 2) {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function init() {
    if (ctx) return true;
    const Ctor = /** @type {any} */ (globalThis).AudioContext || /** @type {any} */ (globalThis).webkitAudioContext;
    if (!Ctor) return false;
    ctx = new Ctor();

    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);

    // --- engine: two detuned saws through a low-pass -------------------
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 900;
    engineFilter.Q.value = 3;
    engineGain.connect(engineFilter);
    engineFilter.connect(master);

    for (const detune of [-8, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 60;
      osc.detune.value = detune;
      osc.connect(engineGain);
      osc.start();
      engineOsc.push(osc);
    }
    // sub layer
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = 30;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.35;
    sub.connect(subGain);
    subGain.connect(engineGain);
    sub.start();
    engineSub = sub;

    // --- tyre squeal ----------------------------------------------------
    const tyreSource = ctx.createBufferSource();
    tyreSource.buffer = noiseBuffer(2);
    tyreSource.loop = true;
    tyreFilter = ctx.createBiquadFilter();
    tyreFilter.type = 'bandpass';
    tyreFilter.frequency.value = 1400;
    tyreFilter.Q.value = 6;
    tyreGain = ctx.createGain();
    tyreGain.gain.value = 0;
    tyreSource.connect(tyreFilter);
    tyreFilter.connect(tyreGain);
    tyreGain.connect(master);
    tyreSource.start();

    // --- wind -----------------------------------------------------------
    const windSource = ctx.createBufferSource();
    windSource.buffer = noiseBuffer(2);
    windSource.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 700;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    windSource.start();

    return true;
  }

  /**
   * @param {number} rpm 0..1
   * @param {number} load 0..1
   */
  function engine(rpm, load) {
    if (!ctx || !engineGain) return;
    const now = ctx.currentTime;
    const frequency = 48 + rpm * 210;
    for (const osc of engineOsc) osc.frequency.setTargetAtTime(frequency, now, 0.05);
    if (engineSub) engineSub.frequency.setTargetAtTime(frequency * 0.5, now, 0.05);
    engineFilter.frequency.setTargetAtTime(500 + rpm * 2400 + load * 500, now, 0.08);
    engineGain.gain.setTargetAtTime(0.055 + load * 0.1 + rpm * 0.05, now, 0.08);
  }

  /**
   * @param {number} slip 0..1
   * @param {number} speed m/s
   */
  function tyre(slip, speed) {
    if (!ctx || !tyreGain) return;
    const now = ctx.currentTime;
    const amount = clamp(slip, 0, 1) * clamp(speed / 18, 0, 1);
    tyreGain.gain.setTargetAtTime(amount * 0.16, now, 0.05);
    tyreFilter.frequency.setTargetAtTime(900 + amount * 1400, now, 0.08);
  }

  /**
   * @param {number} speed m/s
   */
  function wind(speed) {
    if (!ctx || !windGain) return;
    const now = ctx.currentTime;
    windGain.gain.setTargetAtTime(clamp(speed / 80, 0, 1) * 0.07, now, 0.15);
  }

  function boost() {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(0.6);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(3200, now + 0.5);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(now);
    source.stop(now + 0.7);
  }

  /**
   * @param {number} force 0..1
   */
  function impact(force) {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const amount = clamp(force, 0.1, 1);

    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(0.3);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, now);
    filter.frequency.exponentialRampToValueAtTime(200, now + 0.25);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(amount * 0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(now);
    source.stop(now + 0.35);

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(120, now);
    thump.frequency.exponentialRampToValueAtTime(42, now + 0.22);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(amount * 0.5, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    thump.connect(thumpGain);
    thumpGain.connect(master);
    thump.start(now);
    thump.stop(now + 0.35);
  }

  /**
   * @param {number} [frequency]
   * @param {number} [duration]
   */
  function beep(frequency = 660, duration = 0.12) {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  /**
   * @param {boolean} final
   */
  function countdown(final) {
    beep(final ? 1040 : 620, final ? 0.4 : 0.16);
  }

  return {
    async unlock() {
      if (!init()) return false;
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          return false;
        }
      }
      started = true;
      return true;
    },
    /** @param {number} value */
    setVolume(value) {
      volume = clamp(value, 0, 1);
      if (master && !muted) master.gain.value = volume;
    },
    /** @param {boolean} value */
    setMuted(value) {
      muted = value;
      if (master) master.gain.value = muted ? 0 : volume;
    },
    engine,
    tyre,
    wind,
    boost,
    impact,
    beep,
    countdown,
    dispose() {
      if (ctx) ctx.close();
      ctx = null;
      started = false;
    },
  };
}
