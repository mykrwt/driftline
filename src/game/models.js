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
 * Build the player's car from real compact GLB models (`GR Supra`, `M4 Competition`,
 * `GT-R Nismo`) when loaded, with a clean procedural fallback for headless unit tests.
 *
 * @param {{ color: string, accent: string, shape?: string, assetKey?: string }} config
 * @param {boolean} [ghost] remote players render as translucent ghosts
 * @param {any} [assets] the asset library (optional)
 * @returns {THREE.Group}
 */
export function createCarModel(config, ghost = false, assets = null) {
  const key = config.assetKey || config.shape || 'vector';
  const loaded = assets?.car?.(key);
  if (!loaded?.template) {
    return createCar({ ...config, shape: key }, ghost);
  }

  const root = new THREE.Group();
  const instance = loaded.template.clone(true);
  root.add(instance);

  const paintColor = new THREE.Color(config.color || '#ff2848');
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x3b040c,
    emissive: new THREE.Color(0xff142e),
    emissiveIntensity: 1.85,
    roughness: 0.2,
    metalness: 0.1,
  });
  const tailBarMat = new THREE.MeshStandardMaterial({
    color: 0x2a0308,
    emissive: new THREE.Color(0xff2238),
    emissiveIntensity: 1.15,
    roughness: 0.22,
    metalness: 0.1,
  });

  /** @type {Record<string, THREE.Object3D | null>} */
  const wheelMap = { Wheel_FL: null, Wheel_FR: null, Wheel_RL: null, Wheel_RR: null };

  instance.traverse((obj) => {
    if (obj.name in wheelMap) {
      wheelMap[obj.name] = obj;
    }
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = !ghost;
      obj.receiveShadow = !ghost;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const nextMats = mats.map((m) => {
        if (!m) return new THREE.MeshStandardMaterial();
        const matName = (m.name || '').toLowerCase();
        if (!ghost && matName.startsWith('tailight')) {
          return tailMat;
        }
        const cloned = m.clone();
        if (ghost) {
          cloned.transparent = true;
          cloned.opacity = 0.42;
          cloned.depthWrite = false;
          if (cloned.color) cloned.color.lerp(paintColor, 0.45);
        } else if (matName.startsWith('body')) {
          // Glossy metallic clearcoat paint on untextured body panels (e.g. GR Supra)!
          cloned.color.copy(paintColor);
          cloned.metalness = 0.58;
          cloned.roughness = 0.24;
        } else if (matName.startsWith('glass')) {
          cloned.color.setHex(0x0c1420);
          cloned.metalness = 0.85;
          cloned.roughness = 0.08;
        } else if (matName.startsWith('headlight')) {
          cloned.emissive = new THREE.Color(0xeef6ff);
          cloned.emissiveIntensity = 1.6;
        } else if (cloned.map) {
          cloned.roughness = Math.min(cloned.roughness ?? 0.4, 0.34);
          cloned.metalness = Math.max(cloned.metalness ?? 0.2, 0.28);
        }
        return cloned;
      });
      obj.material = Array.isArray(obj.material) ? nextMats : nextMats[0];
    }
  });

  // Measure world bounds of the normalized model to place crisp rear brake glow bars & twin boost flames!
  instance.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(instance);
  const width = bounds.max.x - bounds.min.x;
  const rearZ = bounds.min.z;

  if (!ghost) {
    // Subtle left & right outer brake light glow cores (no center bar blocking real ducktail / quad round GT-R lamps!)
    const lampGeo = new THREE.BoxGeometry(width * 0.14, 0.042, 0.036);
    for (const side of [-1, 1]) {
      const lamp = new THREE.Mesh(lampGeo, tailMat);
      lamp.position.set(side * width * 0.34, 0.715, rearZ + 0.055);
      root.add(lamp);
    }

    // Twin nitrous / anti-lag exhaust afterburner flames!
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0x5eead4,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffb703,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flameGeo = new THREE.ConeGeometry(0.085, 0.58, 8);
    flameGeo.rotateX(-Math.PI / 2);
    flameGeo.translate(0, 0, -0.26);
    const coreGeo = new THREE.ConeGeometry(0.048, 0.34, 8);
    coreGeo.rotateX(-Math.PI / 2);
    coreGeo.translate(0, 0, -0.15);

    const flames = [];
    for (const side of [-1, 1]) {
      const group = new THREE.Group();
      group.position.set(side * width * 0.25, 0.27, rearZ + 0.02);
      group.add(new THREE.Mesh(flameGeo, flameMat));
      group.add(new THREE.Mesh(coreGeo, coreMat));
      group.visible = false;
      root.add(group);
      flames.push(group);
    }
    root.userData.flames = flames;
  }

  const wheels = [wheelMap.Wheel_FL, wheelMap.Wheel_FR, wheelMap.Wheel_RL, wheelMap.Wheel_RR].filter(Boolean);
  root.userData.wheels = wheels;
  root.userData.frontWheels = wheels.slice(0, 2);
  root.userData.tailMat = tailMat;
  root.userData.tailBarMat = tailBarMat;
  return root;
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
 * Procedural alpine roadside delineator post (white shaft + black collar + retro-reflector).
 * Guides the eye around mountain bends day & night with 1 instanced draw call per chunk.
 */
export function createDelineatorAsset() {
  const shaft = new THREE.BoxGeometry(0.11, 0.96, 0.06);
  shaft.translate(0, 0.48, 0);
  const cap = new THREE.BoxGeometry(0.125, 0.16, 0.07);
  cap.translate(0, 0.86, 0);
  const refl = new THREE.BoxGeometry(0.085, 0.12, 0.078);
  refl.translate(0, 0.86, 0);

  const paintWhite = (geo, r, g, b) => {
    const g2 = geo.index ? geo.toNonIndexed() : geo;
    const count = g2.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    g2.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g2;
  };

  const parts = [
    paintWhite(shaft, 0.92, 0.94, 0.97),
    paintWhite(cap, 0.14, 0.16, 0.2),
    paintWhite(refl, 1.0, 0.42, 0.18),
  ];

  const positions = [];
  const normals = [];
  const colors = [];
  for (const p of parts) {
    const pos = p.getAttribute('position');
    const nor = p.getAttribute('normal');
    const col = p.getAttribute('color');
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      colors.push(col.getX(i), col.getY(i), col.getZ(i));
    }
    p.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.05,
    emissive: new THREE.Color('#22140c'),
    emissiveIntensity: 0.45,
  });
  return { groups: [{ geometry, material }] };
}

/**
 * Asphalt texture with realistic aggregate grain, wheel-track polish, shoulder
 * transition, and crisp mountain highway markings.
 * @param {any} palette
 * @param {HTMLImageElement | null} [baseImage]
 * @returns {THREE.CanvasTexture}
 */
export function createRoadTexture(palette, baseImage = null) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (baseImage && baseImage.width > 0) {
    ctx.drawImage(baseImage, 0, 0, size, size);
    // Tint into rich cool alpine slate asphalt instead of chalky pale grey.
    ctx.fillStyle = 'rgba(116, 124, 138, 0.34)';
    ctx.fillRect(0, 0, size, size);
  } else {
    ctx.fillStyle = palette?.road || '#3f4552';
    ctx.fillRect(0, 0, size, size);
    const image = ctx.getImageData(0, 0, size, size);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const n = (Math.random() - 0.5) * 18;
      data[i] = Math.max(0, Math.min(255, data[i] + n));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
    }
    ctx.putImageData(image, 0, 0);
  }

  // Subtle polished tyre wear tracks down both lanes + darker centre/edge bitumen.
  for (const trackCenter of [0.27, 0.73]) {
    const gx = ctx.createLinearGradient(size * (trackCenter - 0.13), 0, size * (trackCenter + 0.13), 0);
    gx.addColorStop(0, 'rgba(255, 255, 255, 0)');
    gx.addColorStop(0.5, 'rgba(218, 226, 240, 0.10)');
    gx.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gx;
    ctx.fillRect(size * (trackCenter - 0.13), 0, size * 0.26, size);
  }

  // Subtle dusty gravel lip outside the white edge lines so tarmac melts into the shoulder.
  const leftEdge = ctx.createLinearGradient(0, 0, 26, 0);
  leftEdge.addColorStop(0, 'rgba(134, 128, 114, 0.78)');
  leftEdge.addColorStop(1, 'rgba(134, 128, 114, 0)');
  ctx.fillStyle = leftEdge;
  ctx.fillRect(0, 0, 26, size);

  const rightEdge = ctx.createLinearGradient(size - 26, 0, size, 0);
  rightEdge.addColorStop(0, 'rgba(134, 128, 114, 0)');
  rightEdge.addColorStop(1, 'rgba(134, 128, 114, 0.78)');
  ctx.fillStyle = rightEdge;
  ctx.fillRect(size - 26, 0, 26, size);

  // Crisp alpine edge lines (u = 0.042 and u = 0.958).
  ctx.fillStyle = '#f2f5ff';
  ctx.globalAlpha = 0.93;
  ctx.fillRect(20, 0, 12, size);
  ctx.fillRect(size - 32, 0, 12, size);

  // Clean dashed centre line.
  ctx.fillStyle = '#f5f7ff';
  ctx.globalAlpha = 0.85;
  for (let i = 0; i < 2; i++) {
    ctx.fillRect(size / 2 - 6, i * (size / 2) + Math.round(size * 0.11), 12, Math.round(size * 0.19));
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
