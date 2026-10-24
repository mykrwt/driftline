/**
 * Hybrid Real-Sample + Bi-Turbo Inline-6 / V6 WebAudio Engine (`GR Supra`, `M4 Competition`, `GT-R Nismo`).
 *
 * Blends compact, zero-crossing-looped real car recordings (`supra_loop.wav`, `m4_loop.wav`,
 * `gtr_loop.wav`, `shift_pop.wav` — ~208 KB total!) with live harmonic resonance,
 * turbo boost spool, JDM `stu-tu-tu` compressor flutter (Supra), and Sport+ exhaust
 * overrun burble crackles & upshift ignition cuts (M4 Competition / GT-R Nismo).
 */

import { clamp } from '../core/math.js';

const CAR_AUDIO_PROFILES = {
  // Toyota GR Supra 3.0 RZ (2JZ / B58 3.0L single-scroll / twin-scroll turbo inline-6)
  vector: {
    sample: './assets/audio/supra_loop.wav',
    baseRate: 0.62,
    rateSpan: 1.24,
    baseFreq: 56,
    freqSpan: 226,
    harmonic: 'sawtooth',
    filterBase: 640,
    filterSpan: 3100,
    turboGain: 0.052,
    flutterOnLift: true,
    burbleCount: 2,
  },
  // BMW M4 Competition GT (S58 3.0L bi-turbo high-revving Competition inline-6)
  comet: {
    sample: './assets/audio/m4_loop.wav',
    baseRate: 0.66,
    rateSpan: 1.34,
    baseFreq: 62,
    freqSpan: 248,
    harmonic: 'sawtooth',
    filterBase: 760,
    filterSpan: 3600,
    turboGain: 0.038,
    flutterOnLift: false,
    burbleCount: 4,
  },
  // Nissan GT-R Nismo GT3 (VR38DETT 3.8L twin-turbo V6)
  bulldozer: {
    sample: './assets/audio/gtr_loop.wav',
    baseRate: 0.58,
    rateSpan: 1.18,
    baseFreq: 49,
    freqSpan: 198,
    harmonic: 'sawtooth',
    filterBase: 560,
    filterSpan: 2700,
    turboGain: 0.046,
    flutterOnLift: true,
    burbleCount: 3,
  },
};

export function createAudio() {
  /** @type {AudioContext | null} */
  let ctx = null;
  /** @type {GainNode | null} */
  let master = null;
  /** @type {GainNode | null} */
  let engineGain = null;
  /** @type {BiquadFilterNode | null} */
  let engineFilter = null;
  /** @type {GainNode | null} */
  let sampleGain = null;
  /** @type {AudioBufferSourceNode | null} */
  let sampleSource = null;
  /** @type {GainNode | null} */
  let turboGain = null;
  /** @type {BiquadFilterNode | null} */
  let turboFilter = null;
  /** @type {OscillatorNode | null} */
  let turboWhine = null;
  /** @type {GainNode | null} */
  let tyreGain = null;
  /** @type {BiquadFilterNode | null} */
  let tyreFilter = null;
  /** @type {GainNode | null} */
  let windGain = null;

  let muted = false;
  let volume = 0.72;
  let currentCar = 'vector';
  let lastGear = 1;
  let lastThrottle = 0;
  let spool = 0;
  let lastBurbleAt = 0;

  /** @type {OscillatorNode[]} */
  let engineOsc = [];
  /** @type {OscillatorNode | null} */
  let engineSub = null;
  /** @type {Map<string, AudioBuffer>} */
  const buffers = new Map();
  let samplesLoading = false;

  function noiseBuffer(seconds = 2) {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  async function fetchSample(key, url) {
    if (!ctx || buffers.has(key) || typeof globalThis.fetch !== 'function') return;
    try {
      const res = await globalThis.fetch(url);
      if (!res.ok) return;
      const arr = await res.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arr);
      buffers.set(key, decoded);
      if (key === currentCar) attachCarLoop();
    } catch {
      // Pure WebAudio synthesis continues seamlessly if offline/headless.
    }
  }

  function loadSamples() {
    if (samplesLoading || !ctx) return;
    samplesLoading = true;
    void fetchSample('vector', CAR_AUDIO_PROFILES.vector.sample);
    void fetchSample('comet', CAR_AUDIO_PROFILES.comet.sample);
    void fetchSample('bulldozer', CAR_AUDIO_PROFILES.bulldozer.sample);
    void fetchSample('shift_pop', './assets/audio/shift_pop.wav');
  }

  function attachCarLoop() {
    if (!ctx || !sampleGain) return;
    if (sampleSource) {
      try {
        sampleSource.stop();
        sampleSource.disconnect();
      } catch {}
      sampleSource = null;
    }
    const buf = buffers.get(currentCar);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = CAR_AUDIO_PROFILES[currentCar]?.baseRate ?? 0.65;
    src.connect(sampleGain);
    src.start();
    sampleSource = src;
  }

  function init() {
    if (ctx) return true;
    const Ctor =
      /** @type {any} */ (globalThis).AudioContext ||
      /** @type {any} */ (globalThis).webkitAudioContext;
    if (!Ctor) return false;
    ctx = new Ctor();

    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);

    // --- 1. Sampled real car loop + inline-6 harmonic body ---------------
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 1100;
    engineFilter.Q.value = 2.4;
    engineFilter.connect(master);

    sampleGain = ctx.createGain();
    sampleGain.gain.value = 0;
    sampleGain.connect(engineFilter);

    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineGain.connect(engineFilter);

    // Inline-6 3rd-order firing pair + octave rasp
    for (const [detune, mult, gainVal] of [
      [-6, 1.0, 0.5],
      [6, 1.5, 0.34],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 60 * mult;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gainVal;
      osc.connect(g);
      g.connect(engineGain);
      osc.start();
      engineOsc.push(osc);
    }

    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.value = 32;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.45;
    sub.connect(subGain);
    subGain.connect(engineGain);
    sub.start();
    engineSub = sub;

    // --- 2. Turbocharger compressor spool layer --------------------------
    const turboNoise = ctx.createBufferSource();
    turboNoise.buffer = noiseBuffer(2);
    turboNoise.loop = true;
    turboFilter = ctx.createBiquadFilter();
    turboFilter.type = 'bandpass';
    turboFilter.frequency.value = 2200;
    turboFilter.Q.value = 5.5;
    turboGain = ctx.createGain();
    turboGain.gain.value = 0;
    turboNoise.connect(turboFilter);
    turboFilter.connect(turboGain);

    turboWhine = ctx.createOscillator();
    turboWhine.type = 'sine';
    turboWhine.frequency.value = 1800;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0.22;
    turboWhine.connect(whineGain);
    whineGain.connect(turboGain);
    turboGain.connect(master);
    turboNoise.start();
    turboWhine.start();

    // --- 3. Tyre slip squeal ---------------------------------------------
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

    // --- 4. High-speed alpine wind rush ----------------------------------
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

    loadSamples();
    attachCarLoop();
    return true;
  }

  /**
   * Fire an exhaust pop / crackle (uses real `shift_pop.wav` when loaded + punchy sub thump).
   */
  function exhaustPop(intensity = 0.8, delaySec = 0, pitch = 1.0) {
    if (!ctx || !master) return;
    const t = ctx.currentTime + delaySec;
    const popBuf = buffers.get('shift_pop');
    if (popBuf) {
      const src = ctx.createBufferSource();
      src.buffer = popBuf;
      src.playbackRate.value = pitch * (0.9 + Math.random() * 0.22);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.24 * intensity, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      src.connect(g);
      g.connect(master);
      src.start(t);
      src.stop(t + 0.36);
      return;
    }

    // Crisp fallback ignition crackle
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.14);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(950 * pitch, t);
    bp.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22 * intensity, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + 0.14);
  }

  /**
   * Iconic Supra / JDM `stu-tu-tu-tu` compressor surge flutter on high-boost throttle lift!
   */
  function turboFlutter(strength = 0.8) {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.46);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 7.5;
    bp.frequency.setValueAtTime(2950, now);
    bp.frequency.exponentialRampToValueAtTime(1450, now + 0.42);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    // 5 crisp flutter pulses (`stu-tu-tu-tu-tu`)!
    const pulses = [0.02, 0.095, 0.165, 0.24, 0.32];
    pulses.forEach((offset, idx) => {
      const amp = 0.16 * strength * Math.pow(0.74, idx);
      g.gain.linearRampToValueAtTime(amp, now + offset);
      g.gain.linearRampToValueAtTime(amp * 0.18, now + offset + 0.042);
    });
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(now);
    src.stop(now + 0.46);
  }

  /**
   * @param {number} rpm 0..1
   * @param {number} load 0..1
   * @param {number} [gear] 1..5
   * @param {boolean} [boosting]
   */
  function engine(rpm, load, gear = lastGear, boosting = false) {
    if (!ctx || !engineGain) return;
    const now = ctx.currentTime;
    const profile = CAR_AUDIO_PROFILES[currentCar] ?? CAR_AUDIO_PROFILES.vector;
    const r = clamp(rpm, 0, 1);
    const l = clamp(load, 0, 1);

    // Subtle rev-limiter bounce at peak redline!
    const limiter = r > 0.965 && l > 0.5 ? (Math.sin(now * 58) > 0 ? 1.0 : 0.45) : 1.0;

    // 1. Pitch-track real recorded Supra / M4 Competition / GT-R engine loop!
    const hasSample = Boolean(sampleSource && buffers.has(currentCar));
    if (sampleSource) {
      sampleSource.playbackRate.setTargetAtTime(profile.baseRate + r * profile.rateSpan, now, 0.045);
    }
    if (sampleGain) {
      const targetSample = hasSample ? (0.14 + l * 0.2 + r * 0.12) * limiter : 0;
      sampleGain.gain.setTargetAtTime(targetSample, now, 0.06);
    }

    // 2. Warm low-end harmonic foundation (blended under sample, or full level before decode finishes)
    const freq = profile.baseFreq + r * profile.freqSpan;
    if (engineOsc[0]) engineOsc[0].frequency.setTargetAtTime(freq, now, 0.045);
    if (engineOsc[1]) engineOsc[1].frequency.setTargetAtTime(freq * 1.5, now, 0.045);
    if (engineSub) engineSub.frequency.setTargetAtTime(freq * 0.5, now, 0.045);

    engineFilter.frequency.setTargetAtTime(
      profile.filterBase + r * profile.filterSpan + l * 700 + (boosting ? 900 : 0),
      now,
      0.07,
    );
    const synthScale = hasSample ? 0.42 : 1.0;
    engineGain.gain.setTargetAtTime(
      (0.048 + l * 0.095 + r * 0.05) * synthScale * limiter,
      now,
      0.07,
    );

    // 3. Live turbocharger boost pressure spool!
    const targetSpool = clamp(l * (0.35 + r * 0.85) + (boosting ? 0.45 : 0), 0, 1.2);
    spool += (targetSpool - spool) * (targetSpool > spool ? 0.08 : 0.16);
    if (turboGain && turboFilter && turboWhine) {
      turboGain.gain.setTargetAtTime(spool * profile.turboGain, now, 0.06);
      turboFilter.frequency.setTargetAtTime(1750 + spool * 2600, now, 0.07);
      turboWhine.frequency.setTargetAtTime(1650 + spool * 3100, now, 0.07);
    }

    // 4. Upshift ignition cut bang (`shift_pop.wav`)!
    if (gear > lastGear && r > 0.35 && l > 0.35 && now - lastBurbleAt > 0.22) {
      exhaustPop(0.85, 0, currentCar === 'comet' ? 1.06 : 0.94);
      lastBurbleAt = now;
    }
    lastGear = gear;

    // 5. High-RPM throttle lift -> Supra `stu-tu-tu` flutter + M4 Competition Sport+ overrun burbles!
    if (lastThrottle > 0.55 && l < 0.14 && r > 0.48 && now - lastBurbleAt > 0.42) {
      if (profile.flutterOnLift && spool > 0.38) {
        turboFlutter(clamp(spool, 0.45, 1));
      }
      for (let i = 0; i < profile.burbleCount; i++) {
        exhaustPop(0.55 - i * 0.09, 0.05 + i * 0.085 + Math.random() * 0.03, 0.85 + Math.random() * 0.3);
      }
      lastBurbleAt = now;
    }
    lastThrottle = l;
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
    filter.Q.value = 2.4;
    filter.frequency.setValueAtTime(550, now);
    filter.frequency.exponentialRampToValueAtTime(3800, now + 0.48);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.24, now + 0.07);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.58);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(now);
    source.stop(now + 0.65);
    exhaustPop(0.75, 0.02, 1.12);
  }

  /**
   * @param {number} force 0..1
   * @param {string} [kind] 'guardrail' | 'post' | 'rock'
   */
  function impact(force, kind = 'rock') {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const amount = clamp(force, 0.08, 1);

    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(0.3);
    const filter = ctx.createBiquadFilter();
    filter.type = kind === 'rock' ? 'lowpass' : 'bandpass';
    filter.Q.value = kind === 'rock' ? 1.2 : 3.2;
    filter.frequency.setValueAtTime(kind === 'rock' ? 1500 : 2600, now);
    filter.frequency.exponentialRampToValueAtTime(kind === 'rock' ? 180 : 620, now + 0.22);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(amount * 0.38, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(now);
    source.stop(now + 0.32);

    const thump = ctx.createOscillator();
    thump.type = kind === 'rock' ? 'sine' : 'triangle';
    thump.frequency.setValueAtTime(kind === 'rock' ? 115 : 210, now);
    thump.frequency.exponentialRampToValueAtTime(kind === 'rock' ? 40 : 88, now + 0.2);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(amount * 0.45, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    thump.connect(thumpGain);
    thumpGain.connect(master);
    thump.start(now);
    thump.stop(now + 0.32);
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
          await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 250))]);
        } catch {
          return false;
        }
      }
      loadSamples();
      return true;
    },
    /** @param {string} carId */
    setCar(carId) {
      const next = CAR_AUDIO_PROFILES[carId] ? carId : 'vector';
      if (next === currentCar && sampleSource) return;
      currentCar = next;
      attachCarLoop();
    },
    /** Play a crisp showroom rev + turbo flutter / Sport+ burble when selecting a car! */
    revBlip() {
      if (!ctx || !master) return;
      const now = ctx.currentTime;
      const profile = CAR_AUDIO_PROFILES[currentCar] ?? CAR_AUDIO_PROFILES.vector;
      if (sampleSource && sampleGain) {
        sampleSource.playbackRate.cancelScheduledValues(now);
        sampleSource.playbackRate.setValueAtTime(profile.baseRate + 0.12, now);
        sampleSource.playbackRate.linearRampToValueAtTime(profile.baseRate + profile.rateSpan * 0.86, now + 0.24);
        sampleSource.playbackRate.exponentialRampToValueAtTime(profile.baseRate + 0.08, now + 0.72);
        sampleGain.gain.cancelScheduledValues(now);
        sampleGain.gain.setValueAtTime(0.32, now + 0.18);
        sampleGain.gain.exponentialRampToValueAtTime(0.06, now + 0.75);
      }
      if (profile.flutterOnLift) {
        setTimeout(() => turboFlutter(0.75), 240);
      }
      for (let i = 0; i < profile.burbleCount; i++) {
        exhaustPop(0.55 - i * 0.08, 0.26 + i * 0.09, 0.92 + i * 0.05);
      }
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
      if (sampleSource) {
        try {
          sampleSource.stop();
        } catch {}
        sampleSource = null;
      }
      if (ctx) ctx.close();
      ctx = null;
      samplesLoading = false;
    },
  };
}
