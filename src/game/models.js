/**
 * Procedural low-poly 3D models.
 *
 * Every model is built from primitives at runtime: no downloads, no binary
 * assets, and the whole world fits in a handful of draw calls thanks to
 * instancing.
 */

import * as THREE from '../../vendor/three/three.module.js';

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
 * @param {{ color: string, accent: string, id?: string, assetKey?: string }} config
 * @param {boolean} [ghost] remote players render as translucent ghosts
 * @param {any} [assets] the asset library (optional)
 * @returns {THREE.Group}
 */
export function createCarModel(config, ghost = false, assets = null) {
  const asset = assets && config.assetKey ? assets.car(config.assetKey) : null;
  if (asset) return buildAssetCar(asset, ghost, config);
  return buildProceduralCar(config, ghost);
}

/**
 * Use a downloaded low poly car and keep its wheels separate so they can
 * steer and spin.
 * @param {{ root: THREE.Object3D, wheels: THREE.Object3D[] }} asset
 * @param {boolean} ghost
 * @param {{ color?: string }} config
 * @returns {THREE.Group}
 */
function buildAssetCar(asset, ghost, config) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const model = asset.root.clone(true);

  /** @type {THREE.Mesh[]} */
  const wheels = [];
  /** @type {THREE.Mesh[]} */
  const frontWheels = [];
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = object.material?.clone?.() ?? new THREE.MeshStandardMaterial();
    object.material.roughness = 0.4;
    object.material.metalness = 0.3;
    if (ghost) {
      object.material.transparent = true;
      object.material.opacity = 0.55;
      object.material.depthWrite = false;
      // Tint the ghost so players can tell each other apart.
      if (config?.color) object.material.color = new THREE.Color(config.color).lerp(new THREE.Color(0xffffff), 0.35);
    }
    if (/wheel/i.test(object.name)) {
      wheels.push(object);
      if (/front/i.test(object.name)) frontWheels.push(object);
    }
  });

  body.add(model);
  root.add(body);

  // Cheap contact shadow.
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 4.6),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.renderOrder = 1;
  root.add(shadow);

  root.userData = { wheels, frontWheels, body, model, ghost };
  return root;
}

/**
 * Fallback car built from primitives (used before the assets finish loading).
 * @param {{ color: string, accent: string }} config
 * @param {boolean} ghost
 * @returns {THREE.Group}
 */
function buildProceduralCar(config, ghost) {
  const group = new THREE.Group();
  const bodyColor = new THREE.Color(config.color);
  const accentColor = new THREE.Color(config.accent);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.42,
    metalness: 0.35,
    transparent: ghost,
    opacity: ghost ? 0.55 : 1,
    depthWrite: !ghost,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.35,
    metalness: 0.2,
    transparent: ghost,
    opacity: ghost ? 0.5 : 1,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x16203a,
    roughness: 0.12,
    metalness: 0.6,
    transparent: true,
    opacity: ghost ? 0.4 : 0.92,
  });
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.95, metalness: 0 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.7, metalness: 0.2 });

  // --- body ------------------------------------------------------------
  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.42, 4.05), bodyMat);
  lower.position.y = 0.52;
  group.add(lower);

  const upper = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.34, 2.25), bodyMat);
  upper.position.set(0, 0.86, -0.15);
  group.add(upper);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.26, 0.9), bodyMat);
  nose.position.set(0, 0.58, 1.92);
  group.add(nose);

  // cabin glass
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.34, 1.85), glassMat);
  cabin.position.set(0, 1.02, -0.2);
  group.add(cabin);

  // roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.12, 1.5), bodyMat);
  roof.position.set(0, 1.2, -0.3);
  group.add(roof);

  // stripe
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 3.9), accentMat);
  stripe.position.set(0, 0.74, 0);
  group.add(stripe);

  // spoiler
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.42), trimMat);
  wing.position.set(0, 1.16, -1.95);
  group.add(wing);
  for (const side of [-1, 1]) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.14), trimMat);
    stand.position.set(side * 0.62, 0.96, -1.92);
    group.add(stand);
  }

  // lights
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff4d6,
    emissive: 0xffe9b0,
    emissiveIntensity: 0.85,
    roughness: 0.3,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xff3b52,
    emissive: 0xff2038,
    emissiveIntensity: 1.1,
    roughness: 0.4,
  });
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), headMat);
    head.position.set(side * 0.58, 0.62, 2.34);
    group.add(head);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.08), tailMat);
    tail.position.set(side * 0.56, 0.68, -2.04);
    group.add(tail);
  }

  // --- wheels ----------------------------------------------------------
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  /** @type {THREE.Mesh[]} */
  const wheels = [];
  const wheelPositions = [
    [-0.88, 0.34, 1.28],
    [0.88, 0.34, 1.28],
    [-0.88, 0.34, -1.32],
    [0.88, 0.34, -1.32],
  ];
  for (const [x, y, z] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, tyreMat);
    wheel.position.set(x, y, z);
    wheels.push(wheel);
    group.add(wheel);
  }

  // hub caps
  const hubGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.27, 8);
  hubGeo.rotateZ(Math.PI / 2);
  for (const [x, y, z] of wheelPositions) {
    const hub = new THREE.Mesh(hubGeo, accentMat);
    hub.position.set(x, y, z);
    group.add(hub);
  }

  // soft blob shadow (much cheaper than a shadow map)
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 4.8),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.renderOrder = 1;
  group.add(shadow);

  group.userData.wheels = wheels;
  group.userData.frontWheels = wheels.slice(0, 2);
  group.userData.ghost = ghost;
  group.userData.headMat = headMat;
  group.userData.tailMat = tailMat;
  group.userData.bodyMat = bodyMat;
  return group;
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
 * Asphalt texture with lane markings (tiles seamlessly along the road).
 * @param {{ road: string, lane: string, rumbleA: string, rumbleB: string }} palette
 * @returns {THREE.CanvasTexture}
 */
export function createRoadTexture(palette) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

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

  // edge lines (u = 0 and u = 1 are the road edges)
  ctx.fillStyle = palette.lane;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(6, 0, 7, size);
  ctx.fillRect(size - 13, 0, 7, size);
  ctx.globalAlpha = 1;

  // centre dashes
  ctx.fillStyle = palette.lane;
  ctx.globalAlpha = 0.75;
  for (let i = 0; i < 2; i++) {
    ctx.fillRect(size / 2 - 4, i * (size / 2), 8, size / 5);
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
