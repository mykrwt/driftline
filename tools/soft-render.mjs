/**
 * A tiny software renderer.
 *
 * It draws triangles with a z-buffer and a simple light, which is enough to
 * look at a model or a piece of terrain without a browser. It is a review
 * tool: the game itself is rendered by three.js.
 */
import { encodePng } from './png.mjs';

/**
 * @typedef {object} CameraOptions
 * @property {number[]} position [x, y, z]
 * @property {number[]} target [x, y, z]
 * @property {number} [fov] in degrees
 * @property {number} [width]
 * @property {number} [height]
 */

/**
 * A frame buffer with a depth buffer.
 */
export function createFrame(width, height, background = [0.09, 0.11, 0.16]) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = background[0] * 255;
    rgb[i * 3 + 1] = background[1] * 255;
    rgb[i * 3 + 2] = background[2] * 255;
  }
  return { width, height, rgb, depth: new Float32Array(width * height).fill(Infinity) };
}

/**
 * The camera basis and the projection.
 * @param {CameraOptions} options
 */
export function createCamera(options) {
  const [ex, ey, ez] = options.position;
  const [tx, ty, tz] = options.target;
  let fx = tx - ex;
  let fy = ty - ey;
  let fz = tz - ez;
  const flen = Math.hypot(fx, fy, fz) || 1;
  fx /= flen;
  fy /= flen;
  fz /= flen;
  // The right vector: cross(forward, up) with up = +Y.
  let rx = -fz;
  let ry = 0;
  let rz = fx;
  const rlen = Math.hypot(rx, ry, rz) || 1;
  rx /= rlen;
  ry /= rlen;
  rz /= rlen;
  // The up vector: right x forward.
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  const fov = ((options.fov ?? 45) * Math.PI) / 180;
  const scale = 1 / Math.tan(fov / 2);
  const aspect = options.width / options.height;
  return { ex, ey, ez, fx, fy, fz, rx, ry, rz, ux, uy, uz, scale, aspect };
}

/**
 * Draw a triangle with a flat colour and a z-buffer.
 * @param {any} frame
 * @param {any} camera
 * @param {number[]} a
 * @param {number[]} b
 * @param {number[]} c
 * @param {number[]} colour
 * @param {number[]} [light]
 */
export function drawTriangle(frame, camera, a, b, c, colour, light, offsetY = 0) {
  const project = (p) => {
    const dx = p[0] - camera.ex;
    const dy = p[1] - camera.ey;
    const dz = p[2] - camera.ez;
    const z = dx * camera.fx + dy * camera.fy + dz * camera.fz;
    if (z <= 0.05) return null;
    const x = dx * camera.rx + dy * camera.ry + dz * camera.rz;
    const y = dx * camera.ux + dy * camera.uy + dz * camera.uz;
    return [
      ((x / z) * camera.scale) / camera.aspect * 0.5 * frame.width + frame.width / 2,
      (-(y / z) * camera.scale) * 0.5 * frame.height + frame.height / 2,
      z,
    ];
  };
  const p0 = project(a);
  const p1 = project(b);
  const p2 = project(c);
  if (!p0 || !p1 || !p2) return;

  const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
  const maxX = Math.min(frame.width - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
  const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])) + offsetY);
  const maxY = Math.min(frame.height - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])) + offsetY);

  const area =
    (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
  if (Math.abs(area) < 1e-9) return;

  // The normal for the shading.
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  nx /= length;
  ny /= length;
  nz /= length;
  let shade = 0.35;
  if (light) shade = 0.25 + 0.75 * Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py0 = y + 0.5 - offsetY;
      const w0 = ((p1[0] - p0[0]) * (py0 - p0[1]) - (px - p0[0]) * (p1[1] - p0[1])) / area;
      const w1 = ((px - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (py0 - p0[1])) / area;
      if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
      const w2 = 1 - w0 - w1;
      const depth = p0[2] * w2 + p1[2] * w1 + p2[2] * w0;
      const index = y * frame.width + x;
      if (depth >= frame.depth[index]) continue;
      frame.depth[index] = depth;
      frame.rgb[index * 3] = Math.min(255, colour[0] * shade * 255);
      frame.rgb[index * 3 + 1] = Math.min(255, colour[1] * shade * 255);
      frame.rgb[index * 3 + 2] = Math.min(255, colour[2] * shade * 255);
    }
  }
}

/**
 * @param {any} frame
 * @param {string} path
 */
export function writeFrame(frame, path) {
  const { writeFileSync } = require_fs();
  writeFileSync(path, encodePng(frame.width, frame.height, frame.rgb));
}

/**
 * @returns {any}
 */
function require_fs() {
  return fs;
}

import fs from 'node:fs';
