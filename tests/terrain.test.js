import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import {
  createRoadProfile,
  roadHeight,
  roadOffset,
  surfaceHeight,
  terrainRelief,
  lakeMask,
} from '../src/game/road.js';
import { WATER_DROP } from '../src/game/water.js';
import { createTerrainManager } from '../src/game/terrain.js';
import { PALETTES, resolvePalette, groundColour } from '../src/game/palette.js';
import { applyProceduralTerrainShader } from '../src/shaders/terrainShader.js';
import { applyTerrainDetail } from '../src/shaders/terrainDetail.js';

describe('procedural alpine terrain, hydrology & grounding', () => {
  const seed = 20260920;
  const profile = createRoadProfile(seed);

  it('keeps terrain relief zero on the paved road while raising towering 2D alpine peaks outside', () => {
    let maxPeak = 0;
    for (let s = 0; s <= 2400; s += 20) {
      const roadY = roadHeight(profile, s);
      const centre = roadOffset(profile, s);
      assert.equal(terrainRelief(profile, 0, 1, centre, s, seed), 0);
      assert.ok(Math.abs(surfaceHeight(profile, centre, s) - roadY) < 0.15);
      for (const lateral of [-320, -180, 180, 320]) {
        const h = surfaceHeight(profile, centre + lateral, s) - roadY;
        assert.ok(Number.isFinite(h));
        if (h > maxPeak) maxPeak = h;
      }
    }
    assert.ok(maxPeak > 95, `expected high alpine summits > 95m, got ${maxPeak.toFixed(1)}m`);
  });

  it('carves deterministic glacial lake basins below WATER_DROP including the opening scenic basin', () => {
    let minBed = Infinity;
    for (let s = 120; s <= 460; s += 25) {
      const centre = roadOffset(profile, s);
      const waterY = roadHeight(profile, s) - WATER_DROP;
      for (const side of [-1, 1]) {
        const m = lakeMask(profile, s, side, seed);
        assert.ok(m >= 0 && m <= 1);
        const bed = surfaceHeight(profile, centre + side * 64, s);
        minBed = Math.min(minBed, bed - waterY);
      }
    }
    assert.ok(minBed < -2.0, `expected deep submerged glacial basin < -2m below water, got ${minBed.toFixed(2)}m`);
  });

  it('grounds terrain mesh queries on exact built triangles and upgrades chunk LOD smoothly', () => {
    const scene = new THREE.Scene();
    const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true });
    const terrain = createTerrainManager({
      profile,
      scene,
      seed,
      terrainMaterial,
      assets: null,
    });

    terrain.update(100);
    assert.equal(terrain.chunkCount, 9);

    for (let s = 40; s <= 900; s += 37) {
      for (const lateral of [-140, -45, -16, 16, 45, 140]) {
        const h = terrain.sampleHeight(s, lateral);
        const cell = terrain.sampleCell(s, lateral);
        assert.ok(Number.isFinite(h));
        assert.ok(Math.abs(h - cell.height) < 1e-4);
        assert.ok(cell.spread >= 0);
      }
    }

    const refined = terrain.update(900);
    assert.equal(refined, true);
    terrain.dispose();
  });

  it('composes procedural multi-biome shader + GPU vertex detail cleanly and resolves palette moods', () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const uniforms = applyProceduralTerrainShader(mat);
    const detail = applyTerrainDetail(mat, { amplitude: 1.5 });
    assert.equal(detail.uniform, uniforms.uDetailAmp);
    assert.equal(uniforms.uDetailAmp.value, 1.5);
    assert.equal(typeof mat.onBeforeCompile, 'function');

    assert.equal(resolvePalette('golden').id, 'golden');
    assert.equal(resolvePalette('night').id, 'midnight');
    assert.equal(resolvePalette(PALETTES.alpine).id, 'alpine');

    const rgb = [0, 0, 0];
    groundColour(0.3, 140, 90, 0.5, 0.4, rgb, 0.5);
    assert.ok(rgb.every((c) => c >= 0 && c <= 1));
  });
});
