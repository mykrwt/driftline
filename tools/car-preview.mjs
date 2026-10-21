#!/usr/bin/env node
/**
 * A preview of the car.
 *
 * It builds the same model the game builds and draws it with the software
 * renderer, so the silhouette can be checked without a browser.
 *
 *   node tools/car-preview.mjs [carId] [out.png]
 */
import { writeFileSync } from 'node:fs';
import { createFrame, createCamera, drawTriangle } from './soft-render.mjs';
import { encodePng } from './png.mjs';
import { createCar, CAR_SHAPES } from '../src/game/car.js';
import * as THREE from '../vendor/three/three.module.js';

const carId = process.argv[2] ?? 'vector';
const outPath = process.argv[3] ?? `.harness/shots/car-${carId}.png`;

const WIDTH = 520;
const HEIGHT = 260;
const COLORS = {
  vector: ['#ff3f6d', '#ffd166'],
  comet: ['#31d6ff', '#e9fbff'],
  bulldozer: ['#ffa02b', '#fff3d6'],
};
const [bodyHex, accentHex] = COLORS[carId] ?? COLORS.vector;

const car = createCar({ color: bodyHex, accent: accentHex, shape: carId });

// Collect the triangles of the model in world space.
const triangles = [];
car.updateMatrixWorld(true);
car.traverse((object) => {
  if (!object.isMesh) return;
  const geometry = object.geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const material = object.material;
  const hex = material.color?.getHexString?.() ?? 'ffffff';
  const colour = new THREE.Color(`#${hex}`);
  const isGlass = material.opacity < 0.99;
  const base = isGlass ? [0.09, 0.13, 0.2] : [colour.r, colour.g, colour.b];
  const count = index ? index.count : position.count;
  for (let i = 0; i < count; i += 3) {
    const tri = [];
    for (let k = 0; k < 3; k++) {
      const vi = index ? index.getX(i + k) : i + k;
      const v = new THREE.Vector3(position.getX(vi), position.getY(vi), position.getZ(vi));
      v.applyMatrix4(object.matrixWorld);
      tri.push([v.x, v.y, v.z]);
    }
    triangles.push({ tri, colour: base });
  }
});

// Three views: from the side, from the front and from three quarters.
const views = {
  side: { position: [11, 1.2, 0], target: [0, 0.6, 0] },
  front: { position: [0, 1.2, 11], target: [0, 0.6, 0] },
  'three-quarter': { position: [7.6, 3.2, 7.6], target: [0, 0.5, 0] },
};

const light = [0.45, 0.78, 0.44];
const frame = createFrame(WIDTH, HEIGHT * Object.keys(views).length, [0.08, 0.1, 0.14]);
// Three views, one above the other.
for (const [index, name] of Object.keys(views).entries()) {
  const view = views[name];
  const camera = createCamera({
    position: view.position,
    target: view.target,
    fov: 46,
    width: WIDTH,
    height: HEIGHT,
  });
  const offset = index * HEIGHT;
  for (const triangle of triangles) {
    drawTriangle(frame, camera, triangle.tri[0], triangle.tri[1], triangle.tri[2], triangle.colour, light, offset);
  }
}

writeFileSync(outPath, encodePng(frame.width, frame.height, frame.rgb));
console.log(`car preview -> ${outPath} (${triangles.length} triangles, shape ${carId})`);
