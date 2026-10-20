/**
 * Fixed timestep game loop.
 *
 * The simulation always advances in `step` slices so physics and netcode stay
 * deterministic regardless of display refresh rate; rendering happens once per
 * animation frame with an interpolation-friendly clock.
 */

/**
 * @typedef {object} LoopOptions
 * @property {(dt: number) => void} update  simulation step, dt is fixed
 * @property {(alpha: number, frameDt: number) => void} render
 * @property {number} [step] seconds per simulation step
 * @property {number} [maxSteps] maximum steps per frame (spiral of death guard)
 * @property {(fps: number) => void} [onFps]
 */

/**
 * @param {LoopOptions} options
 */
export function createLoop(options) {
  const step = options.step ?? 1 / 60;
  const maxSteps = options.maxSteps ?? 5;

  let rafId = 0;
  let running = false;
  let last = 0;
  let accumulator = 0;
  let fps = 60;
  let fpsAccum = 0;
  let fpsFrames = 0;

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);

    const frameDt = last ? Math.min((now - last) / 1000, 0.25) : step;
    last = now;

    fpsAccum += frameDt;
    fpsFrames++;
    if (fpsAccum >= 0.5) {
      fps = fpsFrames / fpsAccum;
      fpsAccum = 0;
      fpsFrames = 0;
      options.onFps?.(fps);
    }

    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= step && steps < maxSteps) {
      options.update(step);
      accumulator -= step;
      steps++;
    }
    if (steps === maxSteps) {
      // We could not keep up: drop the backlog instead of spiralling.
      accumulator = 0;
    }

    options.render(accumulator / step, frameDt);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = 0;
      accumulator = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
    /** @returns {boolean} */
    get running() {
      return running;
    },
    /** @returns {number} */
    get fps() {
      return fps;
    },
  };
}
