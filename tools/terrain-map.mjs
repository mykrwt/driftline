#!/usr/bin/env node
/**
 * Terrain map preview.
 *
 * Renders the world from the top down with the same colour rules as the game
 * and writes a PNG, plus a height profile of the road. It is the fast way to
 * judge the shape of the land without starting the browser.
 *
 *   node tools/terrain-map.mjs [seed] [length] [out.png]
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { createRoadProfile, roadOffset, roadHeight, roadHalfWidth, surfaceHeight } from '../src/game/road.js';
import { groundColour } from '../src/game/palette.js';
import { fbm } from '../src/game/noise.js';

const seed = Number(process.argv[2] ?? 20260920);
const length = Number(process.argv[3] ?? 4000);
const outPath = process.argv[4] ?? '.harness/shots/terrain-map.png';

const profile = createRoadProfile(seed);

/* --------------------------------------------------------------- PNG writer */
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

/**
 * @param {number} width
 * @param {number} height
 * @param {Buffer} rgb  width * height * 3
 * @returns {Buffer}
 */
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
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------- render */
const PX = 2; // metres per pixel
const LATERAL = 520; // metres to each side
const width = Math.ceil(length / PX);
const heightPx = Math.ceil((LATERAL * 2) / PX);
const rgb = Buffer.alloc(width * heightPx * 3);
const colour = [0, 0, 0];

for (let px = 0; px < width; px++) {
  const s = px * PX;
  const centre = roadOffset(profile, s);
  const roadY = roadHeight(profile, s);
  const half = roadHalfWidth(profile, s);
  for (let py = 0; py < heightPx; py++) {
    const lateral = (py - heightPx / 2) * PX;
    const x = centre + lateral;
    const y = surfaceHeight(profile, x, s);
    const hx = surfaceHeight(profile, x + 3, s) - surfaceHeight(profile, x - 3, s);
    const hz = surfaceHeight(profile, x, s + 3) - surfaceHeight(profile, x, s - 3);
    const slope = Math.min(1, Math.hypot(hx, hz) / 6 / 1.9);
    const altitude = y - roadY;
    const dist = Math.abs(lateral) - half;
    const patch = fbm(x * 0.013, s * 0.013, 3, seed + 17) * 0.5 + 0.5;
    const rockPatch = fbm(x * 0.0055, s * 0.0055, 3, seed + 61) * 0.5 + 0.5;
    groundColour(slope, altitude, dist, patch, rockPatch, colour);
    // A simple hill shade so the relief is readable.
    const shade = 1 - Math.min(0.55, Math.hypot(hx, hz) / 6) * 0.5;
    const i = (py * width + px) * 3;
    rgb[i] = Math.max(0, Math.min(255, colour[0] * 255 * shade));
    rgb[i + 1] = Math.max(0, Math.min(255, colour[1] * 255 * shade));
    rgb[i + 2] = Math.max(0, Math.min(255, colour[2] * 255 * shade));
  }
}

writeFileSync(outPath, encodePng(width, heightPx, rgb));

/* ------------------------------------------------------------------ profile */
const stats = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
const step = 10;
for (let s = 0; s < length; s += step) {
  const centre = roadOffset(profile, s);
  for (let lateral = -400; lateral <= 400; lateral += 20) {
    const y = surfaceHeight(profile, centre + lateral, s) - roadHeight(profile, s);
    stats.min = Math.min(stats.min, y);
    stats.max = Math.max(stats.max, y);
    stats.sum += y;
    stats.count++;
  }
}
console.log(`terrain map -> ${outPath} (${width}x${heightPx})`);
console.log(
  `relief: min ${stats.min.toFixed(1)}m  max ${stats.max.toFixed(1)}m  mean ${(stats.sum / stats.count).toFixed(1)}m`,
);
