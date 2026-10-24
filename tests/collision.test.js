import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import { createCollisionWorld } from '../src/game/collision.js';
import { createVehicle, stepVehicle, CAR_SPECS } from '../src/game/vehicle.js';
import { createRoadProfile, surfaceHeight, roadOffset, roadHalfWidth } from '../src/game/road.js';
import { createTerrainManager } from '../src/game/terrain.js';
import { createChunkManager } from '../src/game/chunks.js';

describe('roadside guardrails & solid non-tree collisions', () => {
  it('blocks high-speed cars from passing through continuous guardrails while preserving smooth slide', () => {
    const collisions = createCollisionWorld();
    const run = [];
    for (let z = 0; z <= 80; z += 4) {
      run.push({ x: -7.5, y: 0, z, roadX: 0, roadZ: z });
    }
    collisions.addGuardrailRun('test-rail', run, 0.92);

    const vehicle = createVehicle(CAR_SPECS.vector);
    vehicle.position.set(-4.0, 0.65, 20);
    // Launch diagonally towards the guardrail at ~145 km/h!
    vehicle.velocity.set(-22, 0, 34);

    let sparks = 0;
    const flatGround = () => 0;
    for (let i = 0; i < 90; i++) {
      const prevX = vehicle.position.x;
      const prevZ = vehicle.position.z;
      stepVehicle(vehicle, { throttle: 0.8, steer: -0.6, brake: 0, handbrake: false, boost: false }, flatGround, 1 / 120);
      collisions.resolveVehicle(vehicle, prevX, prevZ, (ev) => {
        if (ev.kind === 'guardrail') sparks++;
      });
      // Chassis centre must NEVER cross past the guardrail line at x = -7.5!
      assert.ok(vehicle.position.x > -7.0, `car passed guardrail at x=${vehicle.position.x.toFixed(2)}`);
    }

    assert.ok(sparks > 0, 'expected guardrail scrape contact events');
    assert.ok(vehicle.position.z > 35, `expected car to slide smoothly forward along rail, got z=${vehicle.position.z.toFixed(1)}`);
  });

  it('collides solidly with boulders & lamp posts without allowing pass-through, and ignores trees completely', () => {
    const collisions = createCollisionWorld();
    collisions.addObstacle('chunk0', 'rock', 0, 0, 25, 1.5, 2.2);
    collisions.addObstacle('chunk0', 'post', 4.5, 0, 40, 0.4, 4.2);
    // Non-obstacle foliage kinds must never register solid colliders!
    // @ts-expect-error testing runtime rejection of tree colliders
    collisions.addObstacle('chunk0', 'tree', 0, 0, 10, 1.2, 8.0);
    assert.equal(collisions.stats.obstacles, 2);

    const vehicle = createVehicle(CAR_SPECS.vector);
    vehicle.position.set(0.35, 0.65, 18);
    vehicle.velocity.set(0, 0, 24);

    let rockHits = 0;
    const flatGround = () => 0;
    for (let i = 0; i < 60; i++) {
      const prevX = vehicle.position.x;
      const prevZ = vehicle.position.z;
      stepVehicle(vehicle, { throttle: 0.5, steer: 0, brake: 0, handbrake: false, boost: false }, flatGround, 1 / 120);
      collisions.resolveVehicle(vehicle, prevX, prevZ, (ev) => {
        if (ev.kind === 'rock') rockHits++;
      });
      const distToBoulder = Math.hypot(vehicle.position.x - 0, vehicle.position.z - 25);
      assert.ok(distToBoulder > 1.45, `car penetrated inside boulder center: dist=${distToBoulder.toFixed(2)}`);
    }
    assert.ok(rockHits > 0, 'expected solid rock impact event');
  });

  it('wires continuous lake/cliff guardrails & rock colliders via chunks + terrain with zero tree colliders', () => {
    const seed = 20260920;
    const profile = createRoadProfile(seed);
    const scene = new THREE.Scene();
    const collisions = createCollisionWorld();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });

    const dummyGeo = new THREE.BoxGeometry(1, 1, 1);
    const dummyAsset = { groups: [{ geometry: dummyGeo, material: mat }] };
    const mockAssets = {
      prop(key) {
        return dummyAsset;
      },
    };

    const terrain = createTerrainManager({
      profile,
      scene,
      seed,
      terrainMaterial: mat,
      assets: mockAssets,
      collisions,
    });
    const chunks = createChunkManager({
      profile,
      scene,
      assets: mockAssets,
      seed,
      roadMaterial: mat,
      terrainMaterial: mat,
      collisions,
      groundHeight: (s, l) => terrain.sampleHeight(s, l),
      groundCell: (s, l) => terrain.sampleCell(s, l),
    });

    terrain.update(180);
    chunks.update(180);

    // Hundreds of guardrail segments along lakes/cliffs + only rock/post obstacles, zero trees!
    assert.ok(collisions.stats.rails > 40, `expected >40 guardrail segments, got ${collisions.stats.rails}`);
    assert.ok(collisions.stats.obstacles > 10, `expected solid rock/post colliders, got ${collisions.stats.obstacles}`);
    // Far fewer solid colliders than total scattered trees (~2,800 trees remain 100% pass-through!).
    assert.ok(collisions.stats.obstacles < 400, `trees must not register colliders! got ${collisions.stats.obstacles}`);

    // Test real car crashing into lake guardrail at s ~ 200m on actual terrain heightfield!
    const groundAt = (x, z, out) => {
      const centre = roadOffset(profile, z);
      const half = roadHalfWidth(profile, z);
      if (out) out.onRoad = Math.abs(x - centre) <= half;
      return surfaceHeight(profile, x, z);
    };
    const car = createVehicle(CAR_SPECS.comet);
    const s0 = 200;
    const c0 = roadOffset(profile, s0);
    car.position.set(c0 - 2.0, surfaceHeight(profile, c0 - 2.0, s0) + 0.65, s0);
    car.velocity.set(-18, 0, 26);

    let railSavedCar = false;
    for (let i = 0; i < 120; i++) {
      const px = car.position.x;
      const pz = car.position.z;
      stepVehicle(car, { throttle: 1, steer: -1, brake: 0, handbrake: false, boost: false }, groundAt, 1 / 120);
      if (collisions.resolveVehicle(car, px, pz)) railSavedCar = true;
    }
    assert.equal(railSavedCar, true, 'expected lake guardrail to catch & deflect car safely on road');

    chunks.dispose();
    terrain.dispose();
    assert.equal(collisions.stats.rails, 0);
    assert.equal(collisions.stats.obstacles, 0);
  });
});
