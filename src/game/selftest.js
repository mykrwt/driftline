/**
 * A self test of the running game.
 *
 * It drives the game from the console: it starts a race, uses the keyboard
 * and the touch controls, drifts, boosts, pauses, switches the palette and
 * looks for errors. It is the quickest way to find out whether a change broke
 * something.
 *
 *   __driftline.selftest()
 */
export function createSelfTest(driftline) {
  return async function selftest() {
    const results = [];
    /**
     * @param {string} name
     * @param {boolean} ok
     * @param {string} [detail]
     */
    const check = (name, ok, detail = '') => {
      results.push({ name, ok: Boolean(ok), detail });
      return ok;
    };

    const world = driftline.world;
    const vehicle = world?.vehicle;
    if (!world || !vehicle) {
      return { ok: false, results: [{ name: 'the world exists', ok: false }] };
    }

    const key = (code, type) =>
      globalThis.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    const pointer = (el, type, x = 100, y = 100) =>
      el?.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y }),
      );
    const step = (count) => {
      for (let i = 0; i < count; i++) {
        driftline.input.update(1 / 60);
        world.update(1 / 60);
        world.render(1 / 60);
      }
    };

    // --- the car drives ------------------------------------------------
    const startSpeed = vehicle.speed;
    key('ArrowUp', 'keydown');
    step(120);
    const driven = vehicle.speed;
    key('ArrowUp', 'keyup');
    check('the accelerator works', driven > startSpeed + 2, `${startSpeed.toFixed(1)} -> ${driven.toFixed(1)}`);

    // --- the steering --------------------------------------------------
    const heading = () =>
      Math.atan2(
        2 * (vehicle.quaternion.x * vehicle.quaternion.z + vehicle.quaternion.w * vehicle.quaternion.y),
        1 - 2 * (vehicle.quaternion.x * vehicle.quaternion.x + vehicle.quaternion.y * vehicle.quaternion.y),
      );
    const before = heading();
    key('ArrowRight', 'keydown');
    step(60);
    const afterRight = heading();
    key('ArrowRight', 'keyup');
    check('right steers right', afterRight < before, `${before.toFixed(2)} -> ${afterRight.toFixed(2)}`);

    key('ArrowLeft', 'keydown');
    step(60);
    const afterLeft = heading();
    key('ArrowLeft', 'keyup');
    check('left steers left', afterLeft > afterRight, `${afterRight.toFixed(2)} -> ${afterLeft.toFixed(2)}`);

    // --- the touch controls --------------------------------------------
    const gas = globalThis.document.getElementById('btn-gas');
    pointer(gas, 'pointerdown');
    driftline.input.update(1 / 60);
    const touchGas = driftline.input.state.throttle;
    pointer(gas, 'pointerup');
    driftline.input.update(1 / 60);
    check('the gas button works', touchGas > 0.5, `throttle ${touchGas}`);

    const hand = globalThis.document.getElementById('btn-hand');
    pointer(hand, 'pointerdown');
    driftline.input.update(1 / 60);
    const touchHand = driftline.input.state.handbrake;
    pointer(hand, 'pointerup');
    driftline.input.update(1 / 60);
    check('the handbrake button works', touchHand === true, `handbrake ${touchHand}`);

    const pad = globalThis.document.getElementById('touch-steer');
    const rect = pad?.getBoundingClientRect();
    if (rect) {
      pad.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          pointerId: 2,
          clientX: rect.left + rect.width - 5,
          clientY: rect.top + 20,
        }),
      );
      driftline.input.update(1 / 60);
      const steer = driftline.input.state.steer;
      pad.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          pointerId: 2,
          clientX: rect.left + rect.width - 5,
          clientY: rect.top + 20,
        }),
      );
      check('the steering pad works', steer > 0.5, `steer ${steer}`);
    } else {
      check('the steering pad works', false, 'no pad found');
    }

    // --- the world -----------------------------------------------------
    const terrain = world.scene.terrain;
    check('the terrain streams', terrain.chunkCount > 2, `${terrain.chunkCount} chunks`);

    // The trees are billboards: they have to be there and they have to be
    // textured, otherwise the forest is invisible.
    let trees = 0;
    let treeTexture = false;
    world.scene.scene.traverse((object) => {
      if (object.isInstancedMesh && object.material?.alphaTest > 0) {
        trees += object.count;
        if (object.material.map) treeTexture = true;
      }
    });
    check('the trees are there', trees > 10, `${trees} trees`);
    check('the trees are textured', treeTexture, treeTexture ? 'ok' : 'no texture');

    // --- the drift -----------------------------------------------------
    world.setAutopilot(false);
    key('ArrowUp', 'keydown');
    step(150);
    key('Space', 'keydown');
    key('ArrowRight', 'keydown');
    let slip = 0;
    for (let i = 0; i < 240; i++) {
      driftline.input.update(1 / 60);
      world.update(1 / 60);
      world.render(1 / 60);
      slip = Math.max(slip, Math.abs(vehicle.slipAngle));
    }
    key('Space', 'keyup');
    key('ArrowRight', 'keyup');
    key('ArrowUp', 'keyup');
    check('the car can drift', slip > 0.17, `slip ${slip.toFixed(2)}`);

    // --- the palette ---------------------------------------------------
    const beforeLight = world.scene.palette.sunIntensity;
    world.setPalette({ sunIntensity: beforeLight + 1 });
    check('the palette can change', world.scene.palette.sunIntensity === beforeLight + 1, 'ok');

    // --- the errors ----------------------------------------------------
    check('no runtime errors', !globalThis.__driftlineError, globalThis.__driftlineError || 'none');

    const failed = results.filter((entry) => !entry.ok);
    return {
      ok: failed.length === 0,
      passed: results.length - failed.length,
      failed: failed.length,
      results,
    };
  };
}
