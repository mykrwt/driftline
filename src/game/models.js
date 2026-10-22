/**
 * Procedural low-poly 3D models.
 *
 * Every model is built from primitives at runtime: no downloads, no binary
 * assets, and the whole world fits in a handful of draw calls thanks to
 * instancing.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { createCar } from './car.js';

/**
 * Merge a list of geometries into one (position/normal/uv only).
 * Keeps the prop count low so instanced meshes stay cheap.
 *
 * @param {THREE.BufferGeometry[]} geometries
 * @returns {THREE.BufferGeometry}
 */
export function mergeGeometries(geometries) {
  const positions = [];
  const normals = [];
  const uvs = [];
  for (const geometry of geometries) {
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = nonIndexed.getAttribute('position');
    const nor = nonIndexed.getAttribute('normal');
    const uv = nonIndexed.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (nor) normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
    }
    if (nonIndexed !== geometry) nonIndexed.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  merged.computeBoundingSphere();
  return merged;
}

/**
 * @param {THREE.BufferGeometry} geometry
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {THREE.BufferGeometry}
 */
function at(geometry, x, y, z) {
  geometry.translate(x, y, z);
  return geometry;
}

/**
 * @param {THREE.BufferGeometry} geometry
 * @param {number} ry
 * @returns {THREE.BufferGeometry}
 */
function rotY(geometry, ry) {
  geometry.rotateY(ry);
  return geometry;
}

/**
 * @param {number} r
 * @param {number} h
 * @param {number} seg
 * @returns {THREE.BufferGeometry}
 */
function cyl(r, h, seg = 8) {
  return new THREE.CylinderGeometry(r, r, h, seg);
}

/**
 * Build the player's car.
 *
 * The body is lofted from cross sections so the car has a real silhouette
 * instead of a stack of boxes.
 *
 * @param {{ color: string, accent: string, shape?: string, assetKey?: string }} config
 * @param {boolean} [ghost] remote players render as translucent ghosts
 * @param {any} [assets] the asset library (optional)
 * @returns {THREE.Group}
 */
export function createCarModel(config, ghost = false, assets = null) {
  void assets;
  return createCar({ ...config, shape: config.shape || config.assetKey }, ghost);
}

/**
 * Geometry for a scenery prop, merged into a single buffer.
 *
 * @param {string} type
 * @param {number} variant
 * @returns {THREE.BufferGeometry}
 */
export function createPropGeometry(type, variant = 0) {
  switch (type) {
    case 'tree': {
      const parts = [at(cyl(0.22, 2.6, 6), 0, 1.3, 0)];
      const leafColors = [0x2f7a3d, 0x3c9149, 0x276b34, 0x469a4f];
      const canopy = new THREE.IcosahedronGeometry(1.55 + (variant % 3) * 0.2, 0);
      parts.push(at(canopy.clone(), 0, 3.4, 0));
      parts.push(at(new THREE.IcosahedronGeometry(1.05, 0), 0.75, 2.7, 0.35));
      parts.push(at(new THREE.IcosahedronGeometry(0.95, 0), -0.7, 2.9, -0.3));
      const merged = mergeGeometries(parts);
      parts.forEach((p) => p.dispose());
      merged.userData = { leafColor: leafColors[variant % leafColors.length] };
      return merged;
    }
    case 'pine': {
      const parts = [at(cyl(0.2, 1.4, 6), 0, 0.7, 0)];
      for (let i = 0; i < 3; i++) {
        const cone = new THREE.ConeGeometry(1.5 - i * 0.36, 2.4 - i * 0.35, 7);
        parts.push(at(cone, 0, 1.9 + i * 1.55, 0));
      }
      const merged = mergeGeometries(parts);
      parts.forEach((p) => p.dispose());
      merged.userData = { leafColor: 0x1f5c3a };
      return merged;
    }
    case 'palm': {
      const parts = [];
      const trunk = new THREE.CylinderGeometry(0.16, 0.3, 6.4, 6);
      trunk.translate(0, 3.2, 0);
      trunk.rotateZ(0.12);
      parts.push(trunk);
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const frond = new THREE.BoxGeometry(0.14, 0.06, 2.6);
        frond.rotateX(0.32);
        frond.rotateY(angle);
        frond.translate(Math.sin(angle) * 1.25, 6.3, Math.cos(angle) * 1.25);
        parts.push(frond);
      }
      const merged = mergeGeometries(parts);
      parts.forEach((p) => p.dispose());
      merged.userData = { leafColor: 0x2f8a45 };
      return merged;
    }
    case 'bush': {
      const parts = [
        at(new THREE.IcosahedronGeometry(0.72, 0), 0, 0.6, 0),
        at(new THREE.IcosahedronGeometry(0.52, 0), 0.6, 0.45, 0.2),
      ];
      const merged = mergeGeometries(parts);
      parts.forEach((p) => p.dispose());
      merged.userData = { leafColor: 0x2d7a3f };
      return merged;
    }
    case 'rock': {
      const geo = new THREE.IcosahedronGeometry(1.1, 0);
      const pos = geo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(
          i,
          pos.getX(i) * (0.8 + Math.random() * 0.4),
          pos.getY(i) * (0.5 + Math.random() * 0.4),
          pos.getZ(i) * (0.8 + Math.random() * 0.4),
        );
      }
      geo.computeVertexNormals();
      geo.translate(0, 0.55, 0);
      geo.userData = { leafColor: 0x8b8f99, solid: true };
      return geo;
    }
    case 'lamp': {
      const parts = [at(cyl(0.09, 5.4, 6), 0, 2.7, 0)];
      const arm = new THREE.BoxGeometry(0.9, 0.1, 0.1);
      arm.translate(0.45, 5.35, 0);
      parts.push(arm);
      const head = new THREE.BoxGeometry(0.5, 0.18, 0.3);
      head.translate(0.85, 5.24, 0);
      parts.push(head);
      const merged = mergeGeometries(parts);
      parts.forEach((p) => p.dispose());
      merged.userData = { leafColor: 0x9aa1ad, solid: true };
      return merged;
    }
    case 'sign': {
      const parts = [at(cyl(0.08, 2.6, 6), 0, 1.3, 0)];
      const board = new THREE.BoxGeometry(1.9, 1.1, 0.1);
      board.translate(0, 2.8, 0);
      parts.push(board);
      const merged = mergeGeometries(parts);
      parts.forEach((p) => p.dispose());
      merged.userData = { leafColor: 0x2f6df6, solid: true };
      return merged;
    }
    case 'building': {
      const parts = [at(new THREE.BoxGeometry(9, 7, 7), 0, 3.5, 0)];
      const merged = mergeGeometries(parts);
      parts.forEach((p) => p.dispose());
      merged.userData = { leafColor: 0x5a6273, solid: true };
      return merged;
    }
    case 'billboard': {
      const parts = [
        at(new THREE.BoxGeometry(0.18, 3.2, 0.18), -1.8, 1.6, 0),
        at(new THREE.BoxGeometry(0.18, 3.2, 0.18), 1.8, 1.6, 0),
        at(new THREE.BoxGeometry(6.4, 3.2, 0.16), 0, 4.1, 0),
      ];
      const merged = mergeGeometries(parts);
      parts.forEach((p) => p.dispose());
      merged.userData = { leafColor: 0x12213d, solid: true };
      return merged;
    }
    case 'gantry': {
      const parts = [
        at(new THREE.BoxGeometry(0.5, 6.2, 0.5), -6.4, 3.1, 0),
        at(new THREE.BoxGeometry(0.5, 6.2, 0.5), 6.4, 3.1, 0),
        at(new THREE.BoxGeometry(13.4, 1.1, 0.5), 0, 6.3, 0),
      ];
      const merged = mergeGeometries(parts);
      parts.forEach((p) => p.dispose());
      merged.userData = { leafColor: 0x232a38, solid: true };
      return merged;
    }
    default: {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      geo.userData = { leafColor: 0xffffff, solid: true };
      return geo;
    }
  }
}

/**
 * Soft round sprite used for smoke particles.
 * @returns {THREE.CanvasTexture}
 */
export function createSmokeTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * A tiling normal map for the ground.
 *
 * The terrain is one huge surface, so it needs something under the sun
 * besides a flat colour. The map is built from a tileable value noise: the
 * height of every texel becomes a normal, which makes the grass and the
 * rock catch the light.
 *
 * @param {number} [size]
 * @param {number} [scale] how strong the bumps are
 * @returns {THREE.CanvasTexture}
 */
export function createGroundNormalMap(size = 256, scale = 2.4) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;

  // A tileable value noise: the lattice wraps, so the texture repeats.
  const lattice = 16;
  const grid = new Float32Array(lattice * lattice);
  for (let i = 0; i < grid.length; i++) grid[i] = Math.random();
  const at = (x, y) =>
    grid[
      (((y % lattice) + lattice) % lattice) * lattice +
        (((x % lattice) + lattice) % lattice)
    ];
  const smooth = (t) => t * t * (3 - 2 * t);
  const height = (u, v) => {
    const x = u * lattice;
    const y = v * lattice;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = smooth(x - xi);
    const ty = smooth(y - yi);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  const field = (u, v) =>
    height(u, v) * 0.7 + height(u * 4, v * 4) * 0.3 + height(u * 11, v * 11) * 0.12;

  const e = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let nx = -(field(u + e, v) - field(u - e, v)) * scale;
      let ny = -(field(u, v + e) - field(u, v - e)) * scale;
      let nz = 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      const index = (y * size + x) * 4;
      data[index] = (nx * 0.5 + 0.5) * 255;
      data[index + 1] = (ny * 0.5 + 0.5) * 255;
      data[index + 2] = (nz * 0.5 + 0.5) * 255;
      data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Asphalt texture with lane markings (tiles seamlessly along the road).
 * @param {{ road: string, lane: string, rumbleA: string, rumbleB: string }} palette
 * @param {HTMLImageElement | null} [baseImage] an optional photographic asphalt base
 * @returns {THREE.CanvasTexture}
 */
export function createRoadTexture(palette, baseImage = null) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (baseImage) {
    // Photographic asphalt. It is lifted and cooled a little, because the
    // photo is almost black and the tarmac has to read as grey.
    ctx.drawImage(baseImage, 0, 0, size, size);
    ctx.fillStyle = 'rgba(206, 212, 222, 0.45)';
    ctx.fillRect(0, 0, size, size);
  } else {
    ctx.fillStyle = palette.road;
    ctx.fillRect(0, 0, size, size);

    // asphalt speckle
    const image = ctx.getImageData(0, 0, size, size);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      data[i] = Math.max(0, Math.min(255, data[i] + n));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
    }
    ctx.putImageData(image, 0, 0);
  }

  // edge lines (u = 0 and u = 1 are the road edges)
  ctx.fillStyle = '#eef2ff';
  ctx.globalAlpha = 0.92;
  ctx.fillRect(7, 0, 10, size);
  ctx.fillRect(size - 17, 0, 10, size);
  ctx.globalAlpha = 1;

  // centre dashes
  ctx.fillStyle = '#eef2ff';
  ctx.globalAlpha = 0.8;
  for (let i = 0; i < 2; i++) {
    ctx.fillRect(size / 2 - 5, i * (size / 2) + size * 0.12, 10, size / 7);
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
