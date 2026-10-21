#!/usr/bin/env node
/**
 * A fly through of the world.
 *
 * It renders the scene from the point of view of the car at a number of
 * places along the route and puts the frames into one sheet, so the whole
 * drive can be looked at in a single image.
 *
 *   node tools/flythrough.mjs [seed] [count] [out.png] [palette]
 */
import { writeFileSync } from 'node:fs';
import { encodePng } from './png.mjs';
import { createRoadProfile, roadOffset, roadHeight, roadHeading, surfaceHeight } from '../src/game/road.js';
import { groundColour, PALETTES } from '../src/game/palette.js';
import { fbm } from '../src/game/noise.js';

const seed = Number(process.argv[2] ?? 20260920);
const count = Number(process.argv[3] ?? 8);
const outPath = process.argv[4] ?? '.harness/shots/flythrough.png';
const palette = PALETTES[process.argv[5] ?? 'alpine'] ?? PALETTES.alpine;

const TILE_W = 300;
const TILE_H = 200;
const COLS = Math.min(4, count);
const ROWS = Math.ceil(count / COLS);
const WIDTH = TILE_W * COLS;
const HEIGHT = TILE_H * ROWS;
const sheet = Buffer.alloc(WIDTH * HEIGHT * 3);

const WATER_DROP = 9;
const FOV = (58 * Math.PI) / 180;

/**
 * @param {number} hex
 */
function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
const toLinear = (rgb) => rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
const toSrgb = (v) => {
  const c = Math.max(0, Math.min(1, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
};
const aces = (x) => {
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  return Math.max(0, Math.min(1, (x * (a * x + b)) / (x * (c * x + d) + e)));
};

const SKY_TOP = toLinear(hexToRgb(palette.skyTop));
const SKY_HORIZON = toLinear(hexToRgb(palette.skyHorizon));
const SKY_GROUND = toLinear(hexToRgb(palette.skyGround));
const SUN = toLinear(hexToRgb(palette.sun));
const FOG = toLinear(hexToRgb(palette.fog));
const HEMI = toLinear(hexToRgb(palette.skyHorizon));
const WATER_DEEP = toLinear(hexToRgb('#17475f'));

const sunDir = (() => {
  const x = palette.sunX * 2 - 1;
  const y = palette.sunY * 1.6 + 0.25;
  const z = -0.55;
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
})();

const profile = createRoadProfile(seed);

// The route: the car drives down the middle of the road.
const route = [];
for (let i = 0; i < count; i++) {
  const s = 60 + i * 420;
  route.push({
    x: roadOffset(profile, s),
    y: roadHeight(profile, s),
    z: s,
    heading: roadHeading(profile, s),
  });
}

for (const [index, spot] of route.entries()) {
  const camX = spot.x - Math.sin(spot.heading) * 8.4;
  const camZ = spot.z - Math.cos(spot.heading) * 8.4;
  const camY = spot.y + 3.4;
  const lookX = spot.x + Math.sin(spot.heading) * 22;
  const lookZ = spot.z + Math.cos(spot.heading) * 22;
  const lookY = spot.y + 1.2;

  let fx = lookX - camX;
  let fy = lookY - camY;
  let fz = lookZ - camZ;
  const flen = Math.hypot(fx, fy, fz) || 1;
  fx /= flen;
  fy /= flen;
  fz /= flen;
  const rx = -fz;
  const rz = fx;
  const ux = -fz * fy;
  const uy = fz * fx - rx * fz;
  const uz = rx * fy;
  const scale = 1 / Math.tan(FOV / 2);
  const aspect = TILE_W / TILE_H;
  const tileX = (index % COLS) * TILE_W;
  const tileY = Math.floor(index / COLS) * TILE_H;

  const groundAt = (x, z) => {
    const lateral = x - roadOffset(profile, z);
    return surfaceHeight(profile, x, z) - roadHeight(profile, z);
  };

  for (let py = 0; py < TILE_H; py++) {
    for (let px = 0; px < TILE_W; px++) {
      const ndcX = (2 * (px + 0.5)) / TILE_W - 1;
      const ndcY = 1 - (2 * (py + 0.5)) / TILE_H;
      let dx = ndcX * scale * aspect;
      let dy = ndcY * scale;
      let dz = 1;
      const len = Math.hypot(dx, dy, dz);
      dx /= len;
      dy /= len;
      dz /= len;

      let t = 1.2;
      let hit = false;
      let hitX = 0;
      let hitY = 0;
      let hitZ = 0;
      let waterHit = false;
      while (t < 1600) {
        const step = Math.max(1.6, t * 0.035);
        t += step;
        const x = camX + dx * t;
        const y = camY + dy * t;
        const z = camZ + dz * t;
        const ground = groundAt(x, z);
        const level = groundAt(x, z) + roadHeight(profile, z) - WATER_DROP;
        if (!waterHit && y < level && level < ground + roadHeight(profile, z)) {
          waterHit = true;
          hit = true;
          hitX = x;
          hitY = level;
          hitZ = z;
          break;
        }
        if (y < ground + roadHeight(profile, z)) {
          let low = t - step;
          let high = t;
          for (let k = 0; k < 6; k++) {
            const mid = (low + high) / 2;
            const mx = camX + dx * mid;
            const my = camY + dy * mid;
            const mz = camZ + dz * mid;
            if (my < groundAt(mx, mz) + roadHeight(profile, mz)) low = mid;
            else high = mid;
          }
          const mid = (low + high) / 2;
          hit = true;
          hitX = camX + dx * mid;
          hitY = camY + dy * mid;
          hitZ = camZ + dz * mid;
          t = mid;
          break;
        }
      }

      const index2 = ((tileY + py) * WIDTH + tileX + px) * 3;
      if (!hit) {
        const h = dy;
        const t2 = Math.max(0, Math.min(1, (h + 0.22) / 0.25));
        const colour = [0, 0, 0];
        for (let c = 0; c < 3; c++) colour[c] = SKY_GROUND[c] + (SKY_HORIZON[c] - SKY_GROUND[c]) * t2;
        const up = Math.max(0, Math.min(1, h / 0.9));
        for (let c = 0; c < 3; c++) colour[c] += (SKY_TOP[c] - colour[c]) * up * up;
        const sunDot = dx * sunDir[0] + dy * sunDir[1] + dz * sunDir[2];
        if (sunDot > 0) {
          const disc = Math.pow(sunDot, 2200) * 6;
          const glow = Math.pow(sunDot, 30) * 0.35;
          for (let c = 0; c < 3; c++) colour[c] += SUN[c] * (disc + glow);
        }
        sheet[index2] = toSrgb(aces(colour[0] * palette.exposure)) * 255;
        sheet[index2 + 1] = toSrgb(aces(colour[1] * palette.exposure)) * 255;
        sheet[index2 + 2] = toSrgb(aces(colour[2] * palette.exposure)) * 255;
        continue;
      }

      const eps = 1.4;
      const hx = groundAt(hitX + eps, hitZ) - groundAt(hitX - eps, hitZ);
      const hz = groundAt(hitX, hitZ + eps) - groundAt(hitX, hitZ - eps);
      let nx = -hx;
      let ny = 2 * eps;
      let nz = -hz;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;

      let colour;
      if (waterHit) {
        const fres = 0.25 + 0.5 * (1 - Math.abs(dy));
        colour = [
          WATER_DEEP[0] * 0.8 + SKY_HORIZON[0] * fres,
          WATER_DEEP[1] * 0.8 + SKY_HORIZON[1] * fres,
          WATER_DEEP[2] * 0.8 + SKY_HORIZON[2] * fres,
        ];
      } else {
        const centre = roadOffset(profile, hitZ);
        const lateral = hitX - centre;
        const half = 7;
        if (Math.abs(lateral) <= half) {
          const across = Math.abs(lateral) / half;
          const value = 0.12 + (fbm(hitX * 1.7, hitZ * 1.7, 2, seed + 3) * 0.5 + 0.5) * 0.07;
          const edge = Math.abs(across - 0.93) < 0.06 ? 0.72 : 0;
          const dash = Math.abs(across) < 0.035 && Math.floor(hitZ / 3) % 2 === 0 ? 0.62 : 0;
          const v = Math.max(value, edge, dash);
          colour = [v, v * 1.01, v * 1.06];
        } else {
          const slope = Math.min(1, Math.hypot(nx, nz) / Math.max(0.001, ny) / 1.9);
          const altitude = hitY - roadHeight(profile, hitZ);
          const dist = Math.abs(lateral) - half;
          const patch = fbm(hitX * 0.013, hitZ * 0.013, 3, seed + 17) * 0.5 + 0.5;
          const rockPatch = fbm(hitX * 0.011, hitZ * 0.011, 3, seed + 61) * 0.5 + 0.5;
          colour = groundColour(slope, altitude, dist, patch, rockPatch, [0, 0, 0]);
          for (let c = 0; c < 3; c++) colour[c] = toLinear([colour[c]])[0];
        }
      }

      const diffuse = Math.max(0, nx * sunDir[0] + ny * sunDir[1] + nz * sunDir[2]);
      const sky = 0.5 + 0.5 * ny;
      const sun = palette.sunIntensity * diffuse;
      const ambient = palette.hemiIntensity * sky;
      let r = colour[0] * (sun * SUN[0] + ambient * HEMI[0]);
      let g = colour[1] * (sun * SUN[1] + ambient * HEMI[1]);
      let b = colour[2] * (sun * SUN[2] + ambient * HEMI[2]);

      const fogAmount = Math.max(0, Math.min(1, (t - palette.fogStart) / (palette.fogEnd - palette.fogStart)));
      const fogMix = fogAmount * fogAmount * (3 - 2 * fogAmount);
      r += (FOG[0] - r) * fogMix;
      g += (FOG[1] - g) * fogMix;
      b += (FOG[2] - b) * fogMix;

      sheet[index2] = toSrgb(aces(r * palette.exposure)) * 255;
      sheet[index2 + 1] = toSrgb(aces(g * palette.exposure)) * 255;
      sheet[index2 + 2] = toSrgb(aces(b * palette.exposure)) * 255;
    }
  }
  process.stdout.write(`frame ${index + 1}/${count} at ${Math.round(spot.z)} m\n`);
}

writeFileSync(outPath, encodePng(WIDTH, HEIGHT, sheet));
console.log(`fly through -> ${outPath} (${WIDTH}x${HEIGHT})`);
