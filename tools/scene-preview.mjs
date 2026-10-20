#!/usr/bin/env node
/**
 * Headless scene preview.
 *
 * Renders the world the way the game does - the same terrain, the same
 * colours, the same sun, fog and sky - but with a small software renderer
 * instead of WebGL. It is the fast way to judge the look of a change
 * without a browser.
 *
 *   node tools/scene-preview.mjs [seed] [distance] [out.png] [palette]
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import {
  createRoadProfile,
  roadOffset,
  roadHeight,
  roadHalfWidth,
  surfaceHeight,
} from '../src/game/road.js';

const WATER_DROP = 9;
import { groundColour, PALETTES } from '../src/game/palette.js';
import { fbm } from '../src/game/noise.js';

/* ------------------------------------------------------------------- setup */
const seed = Number(process.argv[2] ?? 20260920);
const distance = Number(process.argv[3] ?? 120);
const outPath = process.argv[4] ?? '.harness/shots/scene.png';
const paletteName = process.argv[5] ?? 'alpine';
const palette = PALETTES[paletteName] ?? PALETTES.alpine;

const WIDTH = 420;
const HEIGHT = 746;
const FOV = (62 * Math.PI) / 180;
const MAX_DIST = 1400;

const profile = createRoadProfile(seed);

/* --------------------------------------------------------------- PNG out */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- colours */
function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** sRGB to linear, the way the renderer works. */
function toLinear(rgb) {
  return rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
}

/** Linear back to sRGB for the file. */
function toSrgb(value) {
  const c = Math.max(0, Math.min(1, value));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** The ACES filmic curve, like the renderer. */
function aces(x) {
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  return Math.max(0, Math.min(1, (x * (a * x + b)) / (x * (c * x + d) + e)));
}

const SKY_TOP = toLinear(hexToRgb(palette.skyTop));
const SKY_HORIZON = toLinear(hexToRgb(palette.skyHorizon));
const SKY_GROUND = toLinear(hexToRgb(palette.skyGround));
const SUN_COLOUR = toLinear(hexToRgb(palette.sun));
const FOG = toLinear(hexToRgb(palette.fog));
const HEMI_SKY = toLinear(hexToRgb(palette.skyHorizon));
const HEMI_GROUND = toLinear(hexToRgb(palette.ambient));

/* ----------------------------------------------------------------- camera */
const camS = 40 + distance;
const camCentre = roadOffset(profile, camS);
const camY = roadHeight(profile, camS) + 3.9;
const heading = 0;
// The camera sits behind the car and looks down the road.
const camX = camCentre;
const camZ = camS - 9.2;

/** The sun direction, matching the scene. */
const sunDir = (() => {
  const x = palette.sunX * 2 - 1;
  const y = palette.sunY * 1.6 + 0.25;
  const z = -0.55;
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
})();

/* ------------------------------------------------------- height field grid */
const GRID_STEP = 2.5;
const GRID_S0 = camS - 120;
const GRID_S1 = camS + 1500;
const GRID_LAT = 620;
const GRID_STEP_LAT = 2.5;
const gridW = Math.ceil((GRID_S1 - GRID_S0) / GRID_STEP) + 1;
const gridH = Math.ceil((GRID_LAT * 2) / GRID_STEP_LAT) + 1;
const heights = new Float32Array(gridW * gridH);
const centres = new Float32Array(gridW);

for (let i = 0; i < gridW; i++) {
  const s = GRID_S0 + i * GRID_STEP;
  const centre = roadOffset(profile, s);
  centres[i] = centre;
  for (let j = 0; j < gridH; j++) {
    const lateral = -GRID_LAT + j * GRID_STEP_LAT;
    heights[i * gridH + j] = surfaceHeight(profile, centre + lateral, s);
  }
}

/**
 * The height of the ground at a world position, from the grid.
 * @param {number} x
 * @param {number} z
 */
function groundAt(x, z) {
  const s = z;
  const centre = roadOffset(profile, s);
  const lateral = x - centre;
  const fi = (s - GRID_S0) / GRID_STEP;
  const fj = (lateral + GRID_LAT) / GRID_STEP_LAT;
  if (fi < 0 || fj < 0 || fi >= gridW - 1 || fj >= gridH - 1) {
    return surfaceHeight(profile, x, z);
  }
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  const tx = fi - i;
  const ty = fj - j;
  const h00 = heights[i * gridH + j];
  const h10 = heights[(i + 1) * gridH + j];
  const h01 = heights[i * gridH + j + 1];
  const h11 = heights[(i + 1) * gridH + j + 1];
  return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
}

/* ----------------------------------------------------------------- render */
const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
const depth = new Float32Array(WIDTH * HEIGHT).fill(Infinity);
const ground = [0, 0, 0];
const skyColour = [0, 0, 0];

const aspect = WIDTH / HEIGHT;
const tanHalf = Math.tan(FOV / 2);

for (let py = 0; py < HEIGHT; py++) {
  const ndcY = 1 - (2 * (py + 0.5)) / HEIGHT;
  for (let px = 0; px < WIDTH; px++) {
    const ndcX = (2 * (px + 0.5)) / WIDTH - 1;
    // The camera looks along +Z with a slight downward tilt.
    const dirX = ndcX * tanHalf * aspect;
    const dirY = ndcY * tanHalf;
    const dirZ = 1;
    const length = Math.hypot(dirX, dirY, dirZ);
    const dx = dirX / length;
    const dy = dirY / length;
    const dz = dirZ / length;

    // --- march the ray --------------------------------------------------
    let t = 1.2;
    let hit = false;
    let waterHit = false;
    let hitX = 0;
    let hitY = 0;
    let hitZ = 0;
    let previous = camY + dy * t - groundAt(camX + dx * t, camZ + dz * t);
    while (t < MAX_DIST) {
      const step = Math.max(1.6, t * 0.035);
      t += step;
      const x = camX + dx * t;
      const y = camY + dy * t;
      const z = camZ + dz * t;
      const ground = groundAt(x, z);
      const level = roadHeight(profile, z) - WATER_DROP;
      if (!waterHit && y < level && level < ground) {
        waterHit = true;
        hit = true;
        hitX = x;
        hitY = level;
        hitZ = z;
        break;
      }
      const diff = y - ground;
      if (diff <= 0) {
        // Refine the crossing.
        let low = t - step;
        let high = t;
        for (let k = 0; k < 6; k++) {
          const mid = (low + high) / 2;
          const mx = camX + dx * mid;
          const my = camY + dy * mid;
          const mz = camZ + dz * mid;
          if (my - groundAt(mx, mz) > 0) low = mid;
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
      previous = diff;
    }
    void previous;

    const index = (py * WIDTH + px) * 3;
    if (!hit) {
      // --- the sky ------------------------------------------------------
      const h = dy;
      const t = Math.max(0, Math.min(1, (h + 0.22) / 0.25));
      for (let c = 0; c < 3; c++) {
        skyColour[c] = SKY_GROUND[c] + (SKY_HORIZON[c] - SKY_GROUND[c]) * t;
      }
      const up = Math.max(0, Math.min(1, (h - 0.0) / 0.85));
      for (let c = 0; c < 3; c++) {
        skyColour[c] += (SKY_TOP[c] - skyColour[c]) * up * up;
      }
      const sunDot = dx * sunDir[0] + dy * sunDir[1] + dz * sunDir[2];
      if (sunDot > 0) {
        const disc = Math.pow(sunDot, 2200) * 6;
        const glow = Math.pow(sunDot, 30) * 0.35;
        for (let c = 0; c < 3; c++) skyColour[c] += SUN_COLOUR[c] * (disc + glow);
      }
      rgb[index] = toSrgb(aces(skyColour[0] * palette.exposure)) * 255;
      rgb[index + 1] = toSrgb(aces(skyColour[1] * palette.exposure)) * 255;
      rgb[index + 2] = toSrgb(aces(skyColour[2] * palette.exposure)) * 255;
      continue;
    }

    if (waterHit) {
      // --- the water ----------------------------------------------------
      const fres = 0.25 + 0.55 * (1 - Math.abs(dy));
      const deep = toLinear(hexToRgb('#17475f'));
      const sky = toLinear(hexToRgb(palette.skyHorizon));
      const sun = toLinear(hexToRgb(palette.sun));
      const spec = Math.pow(Math.max(0, dy * 0.8 + sunDir[1] * 0.6), 24) * 0.9;
      let r = deep[0] * (0.55 + 0.45 * palette.hemiIntensity) + sky[0] * fres;
      let g = deep[1] * (0.55 + 0.45 * palette.hemiIntensity) + sky[1] * fres;
      let b = deep[2] * (0.55 + 0.45 * palette.hemiIntensity) + sky[2] * fres;
      r += sun[0] * spec;
      g += sun[1] * spec;
      b += sun[2] * spec;
      const fogAmount = Math.max(0, Math.min(1, (t - palette.fogStart) / (palette.fogEnd - palette.fogStart)));
      const fogMix = fogAmount * fogAmount * (3 - 2 * fogAmount);
      r += (FOG[0] - r) * fogMix;
      g += (FOG[1] - g) * fogMix;
      b += (FOG[2] - b) * fogMix;
      rgb[index] = toSrgb(aces(r * palette.exposure)) * 255;
      rgb[index + 1] = toSrgb(aces(g * palette.exposure)) * 255;
      rgb[index + 2] = toSrgb(aces(b * palette.exposure)) * 255;
      depth[py * WIDTH + px] = t;
      continue;
    }

    // --- the ground ----------------------------------------------------
    const eps = 1.2;
    const hx = groundAt(hitX + eps, hitZ) - groundAt(hitX - eps, hitZ);
    const hz = groundAt(hitX, hitZ + eps) - groundAt(hitX, hitZ - eps);
    let nx = -hx;
    let nz = -hz;
    let ny = 2 * eps;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;

    const centre = roadOffset(profile, hitZ);
    const lateral = hitX - centre;
    const half = roadHalfWidth(profile, hitZ);
    const onRoad = Math.abs(lateral) <= half;

    if (onRoad) {
      // Asphalt, with the painted lines.
      const across = Math.abs(lateral) / half;
      let value = 0.12 + (fbm(hitX * 1.7, hitZ * 1.7, 2, seed + 3) * 0.5 + 0.5) * 0.07;
      const edge = Math.abs(across - 0.93) < 0.06 ? 0.72 : 0;
      const dash = Math.abs(across) < 0.035 && Math.floor(hitZ / 3) % 2 === 0 ? 0.62 : 0;
      value = Math.max(value, edge, dash);
      ground[0] = value;
      ground[1] = value * 1.01;
      ground[2] = value * 1.06;
    } else {
      const slope = Math.min(1, Math.hypot(nx, nz) / Math.max(0.001, ny) / 1.9);
      const altitude = hitY - roadHeight(profile, hitZ);
      const dist = Math.abs(lateral) - half;
      const patch = fbm(hitX * 0.013, hitZ * 0.013, 3, seed + 17) * 0.5 + 0.5;
      const rockPatch = fbm(hitX * 0.0055, hitZ * 0.0055, 3, seed + 61) * 0.5 + 0.5;
      groundColour(slope, altitude, dist, patch, rockPatch, ground);
      for (let c = 0; c < 3; c++) ground[c] = toLinear([ground[c]])[0];
    }

    // --- lighting ------------------------------------------------------
    const diffuse = Math.max(0, nx * sunDir[0] + ny * sunDir[1] + nz * sunDir[2]);
    const sky = 0.5 + 0.5 * ny;
    const sun = palette.sunIntensity * diffuse;
    const ambient = palette.hemiIntensity * sky;    let r = ground[0] * (sun * SUN_COLOUR[0] + ambient * HEMI_SKY[0]);
    let g = ground[1] * (sun * SUN_COLOUR[1] + ambient * HEMI_SKY[1]);
    let b = ground[2] * (sun * SUN_COLOUR[2] + ambient * HEMI_SKY[2]);

    // The fog blends into the horizon.
    const fogAmount = Math.max(0, Math.min(1, (t - palette.fogStart) / (palette.fogEnd - palette.fogStart)));
    const fogMix = fogAmount * fogAmount * (3 - 2 * fogAmount);
    r += (FOG[0] - r) * fogMix;
    g += (FOG[1] - g) * fogMix;
    b += (FOG[2] - b) * fogMix;

    rgb[index] = toSrgb(aces(r * palette.exposure)) * 255;
    rgb[index + 1] = toSrgb(aces(g * palette.exposure)) * 255;
    rgb[index + 2] = toSrgb(aces(b * palette.exposure)) * 255;
    depth[py * WIDTH + px] = t;
  }
}

writeFileSync(outPath, encodePng(WIDTH, HEIGHT, rgb));
console.log(`scene preview -> ${outPath} (${WIDTH}x${HEIGHT}) at ${distance} m, palette ${paletteName}`);
