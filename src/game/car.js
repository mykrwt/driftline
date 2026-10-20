/**
 * The player car.
 *
 * The body is lofted from a handful of cross sections, which gives it a real
 * silhouette: a low nose, a wide stance over the wheels, a tapered tail and
 * a glasshouse that sits on the body instead of floating above it. The wheels
 * are separate objects so they can steer and spin with the physics.
 */

import * as THREE from '../../vendor/three/three.module.js';

/**
 * @typedef {object} CarShape
 * @property {number} length
 * @property {number} width
 * @property {number} height
 * @property {number} wheelRadius
 * @property {number} wheelWidth
 * @property {number} wheelbase
 * @property {number} track
 * @property {number[]} body     rings of the lower body: [z, halfWidth, bottom, top]
 * @property {number[]} cabin    rings of the glasshouse: [z, halfWidth, bottom, top]
 * @property {boolean} wing
 * @property {boolean} bullbar
 */

/** The three cars of the garage. */
export const CAR_SHAPES = {
  vector: {
    length: 4.3,
    width: 1.86,
    height: 1.24,
    wheelRadius: 0.34,
    wheelWidth: 0.25,
    wheelbase: 1.32,
    track: 0.87,
    wing: false,
    bullbar: false,
    body: [
      [-2.15, 0.62, 0.30, 0.60],
      [-1.95, 0.80, 0.24, 0.70],
      [-1.35, 0.90, 0.20, 0.78],
      [-0.60, 0.93, 0.18, 0.80],
      [0.20, 0.90, 0.17, 0.78],
      [0.95, 0.86, 0.18, 0.70],
      [1.60, 0.80, 0.21, 0.58],
      [2.05, 0.66, 0.26, 0.46],
      [2.18, 0.50, 0.32, 0.42],
    ],
    cabin: [
      [-1.28, 0.72, 0.74, 0.86],
      [-0.95, 0.80, 0.74, 1.14],
      [-0.10, 0.82, 0.74, 1.22],
      [0.42, 0.78, 0.72, 1.14],
      [0.72, 0.66, 0.70, 0.86],
    ],
  },
  comet: {
    length: 4.1,
    width: 1.9,
    height: 1.16,
    wheelRadius: 0.33,
    wheelWidth: 0.27,
    wheelbase: 1.3,
    track: 0.9,
    wing: true,
    bullbar: false,
    body: [
      [-2.05, 0.66, 0.26, 0.56],
      [-1.80, 0.84, 0.20, 0.66],
      [-1.20, 0.93, 0.16, 0.70],
      [-0.45, 0.95, 0.15, 0.70],
      [0.35, 0.92, 0.14, 0.66],
      [1.05, 0.86, 0.16, 0.58],
      [1.70, 0.76, 0.19, 0.48],
      [2.00, 0.58, 0.24, 0.40],
    ],
    cabin: [
      [-0.95, 0.70, 0.66, 0.78],
      [-0.62, 0.76, 0.66, 1.06],
      [0.05, 0.74, 0.66, 1.10],
      [0.45, 0.62, 0.64, 0.86],
    ],
  },
  bulldozer: {
    length: 4.9,
    width: 2.0,
    height: 1.52,
    wheelRadius: 0.4,
    wheelWidth: 0.32,
    wheelbase: 1.55,
    track: 0.92,
    wing: false,
    bullbar: true,
    body: [
      [-2.45, 0.78, 0.38, 0.86],
      [-2.10, 0.96, 0.32, 0.98],
      [-1.30, 1.00, 0.28, 1.02],
      [-0.40, 1.00, 0.28, 1.02],
      [0.50, 0.98, 0.28, 0.98],
      [1.30, 0.94, 0.30, 0.86],
      [2.05, 0.86, 0.34, 0.72],
      [2.40, 0.70, 0.40, 0.64],
    ],
    cabin: [
      [-0.95, 0.86, 0.98, 1.06],
      [-0.55, 0.92, 0.98, 1.44],
      [0.35, 0.92, 0.98, 1.50],
      [0.95, 0.82, 0.96, 1.18],
      [1.25, 0.70, 0.94, 1.00],
    ],
  },
};

/**
 * The eight points of a cross section, counter clockwise in the XY plane.
 * @param {number} halfWidth
 * @param {number} bottom
 * @param {number} top
 * @returns {number[][]}
 */
function ringPoints(halfWidth, bottom, top) {
  const height = top - bottom;
  return [
    [-halfWidth * 0.64, bottom],
    [halfWidth * 0.64, bottom],
    [halfWidth, bottom + height * 0.28],
    [halfWidth, bottom + height * 0.7],
    [halfWidth * 0.84, top],
    [-halfWidth * 0.84, top],
    [-halfWidth, bottom + height * 0.7],
    [-halfWidth, bottom + height * 0.28],
  ];
}

/**
 * Loft a surface from a list of cross sections.
 * @param {number[][]} rings [z, halfWidth, bottom, top]
 * @returns {THREE.BufferGeometry}
 */
export function loftGeometry(rings) {
  const sides = 8;
  const positions = [];
  const indices = [];

  for (const [z, halfWidth, bottom, top] of rings) {
    for (const [x, y] of ringPoints(halfWidth, bottom, top)) {
      positions.push(x, y, z);
    }
  }

  for (let r = 0; r < rings.length - 1; r++) {
    for (let k = 0; k < sides; k++) {
      const next = (k + 1) % sides;
      const a = r * sides + k;
      const b = r * sides + next;
      const c = (r + 1) * sides + k;
      const d = (r + 1) * sides + next;
      indices.push(a, b, c, b, d, c);
    }
  }

  // The caps: the rear one faces backwards, the front one forwards.
  const rear = rings.length - 1;
  const front = (rings.length - 1) * sides;
  for (let k = 1; k < sides - 1; k++) {
    indices.push(0, k + 1, k);
    indices.push(front, front + k, front + k + 1);
  }
  void rear;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A soft round shadow, shared by every car.
 * @returns {THREE.CanvasTexture}
 */
let shadowTexture = null;
export function getShadowTexture() {
  if (shadowTexture) return shadowTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  shadowTexture = new THREE.CanvasTexture(canvas);
  shadowTexture.needsUpdate = true;
  return shadowTexture;
}

/**
 * Build the car.
 *
 * @param {{ color: string, accent: string, shape?: string }} config
 * @param {boolean} [ghost] remote players render as translucent ghosts
 * @returns {THREE.Group}
 */
export function createCar(config, ghost = false) {
  const shape = CAR_SHAPES[config.shape || 'vector'] || CAR_SHAPES.vector;
  const group = new THREE.Group();
  const bodyColor = new THREE.Color(config.color);
  const accentColor = new THREE.Color(config.accent);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.34,
    metalness: 0.45,
    transparent: ghost,
    opacity: ghost ? 0.5 : 1,
    depthWrite: !ghost,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.3,
    metalness: 0.25,
    transparent: ghost,
    opacity: ghost ? 0.5 : 1,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x101a2c,
    roughness: 0.08,
    metalness: 0.75,
    transparent: true,
    opacity: ghost ? 0.35 : 0.78,
  });
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 0.95, metalness: 0 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1b1e25, roughness: 0.6, metalness: 0.35 });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xb9c0cc,
    roughness: 0.25,
    metalness: 0.85,
    transparent: ghost,
    opacity: ghost ? 0.5 : 1,
  });

  // --- shell -------------------------------------------------------------
  const shell = new THREE.Mesh(loftGeometry(shape.body), bodyMat);
  shell.castShadow = true;
  group.add(shell);

  // --- glasshouse --------------------------------------------------------
  const glass = new THREE.Mesh(loftGeometry(shape.cabin), glassMat);
  glass.castShadow = true;
  group.add(glass);

  // The roof panel and the pillars give the cabin a real shape.
  const roofFront = shape.cabin[Math.max(0, shape.cabin.length - 3)];
  const roofRear = shape.cabin[0];
  const roofZ = (roofFront[0] + roofRear[0]) / 2;
  const roofLength = Math.abs(roofFront[0] - roofRear[0]);
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(shape.cabin[Math.floor(shape.cabin.length / 2)][1] * 1.5, 0.06, roofLength * 0.72),
    bodyMat,
  );
  roof.position.set(0, shape.height - 0.03, roofZ + (roofFront[0] > roofRear[0] ? 0.12 : -0.12));
  roof.castShadow = true;
  group.add(roof);

  // --- racing stripe -----------------------------------------------------
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, shape.length * 0.82), accentMat);
  stripe.position.set(0, shape.body[3][3] + 0.005, 0);
  group.add(stripe);

  // --- skirts and splitter ----------------------------------------------
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(shape.width * 1.02, 0.12, shape.length * 0.42), trimMat);
  skirt.position.set(0, 0.2, 0.05);
  group.add(skirt);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(shape.width * 0.94, 0.06, 0.42), trimMat);
  splitter.position.set(0, 0.24, shape.length * 0.47);
  group.add(splitter);

  // --- lights -----------------------------------------------------------
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff6e2,
    emissive: 0xffeec2,
    emissiveIntensity: 1.1,
    roughness: 0.25,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xff3b52,
    emissive: 0xff1f38,
    emissiveIntensity: 1.4,
    roughness: 0.35,
  });
  const nose = shape.body[shape.body.length - 1][0];
  const tail = shape.body[0][0];
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.13, 0.1), headMat);
    head.position.set(side * shape.width * 0.33, shape.body[shape.body.length - 2][3] - 0.08, nose - 0.04);
    group.add(head);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.08), tailMat);
    tail.position.set(side * shape.width * 0.33, shape.body[1][3] - 0.06, tail + 0.03);
    group.add(tail);
  }

  // --- wing --------------------------------------------------------------
  if (shape.wing) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(shape.width * 0.94, 0.07, 0.4), trimMat);
    wing.position.set(0, shape.body[1][3] + 0.34, tail + 0.16);
    wing.castShadow = true;
    group.add(wing);
    for (const side of [-1, 1]) {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.16), trimMat);
      stand.position.set(side * shape.width * 0.36, shape.body[1][3] + 0.16, tail + 0.16);
      group.add(stand);
    }
  }
  if (shape.bullbar) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(shape.width * 0.9, 0.12, 0.12), trimMat);
    bar.position.set(0, 0.78, nose + 0.08);
    group.add(bar);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), trimMat);
      post.position.set(side * shape.width * 0.34, 0.55, nose + 0.04);
      group.add(post);
    }
  }

  // --- exhaust -----------------------------------------------------------
  /** @type {THREE.Mesh[]} */
  const exhausts = [];
  for (const side of [-1, 1]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 8), rimMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(side * 0.34, 0.3, tail - 0.06);
    group.add(pipe);
    exhausts.push(pipe);
  }

  // --- wheels ------------------------------------------------------------
  const tyreGeo = new THREE.CylinderGeometry(shape.wheelRadius, shape.wheelRadius, shape.wheelWidth, 18);
  tyreGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(shape.wheelRadius * 0.58, shape.wheelRadius * 0.58, shape.wheelWidth * 1.02, 12);
  rimGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(shape.wheelRadius * 0.2, shape.wheelRadius * 0.2, shape.wheelWidth * 1.06, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(shape.wheelWidth * 1.04, shape.wheelRadius * 1.02, 0.07);

  /** @type {THREE.Mesh[]} */
  const wheels = [];
  const wheelPositions = [
    [-shape.track, shape.wheelRadius, shape.wheelbase],
    [shape.track, shape.wheelRadius, shape.wheelbase],
    [-shape.track, shape.wheelRadius, -shape.wheelbase],
    [shape.track, shape.wheelRadius, -shape.wheelbase],
  ];
  for (const [x, y, z] of wheelPositions) {
    const wheel = new THREE.Group();
    const tyre = new THREE.Mesh(tyreGeo, tyreMat);
    tyre.castShadow = true;
    wheel.add(tyre);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    wheel.add(rim);
    const hub = new THREE.Mesh(hubGeo, accentMat);
    wheel.add(hub);
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(spokeGeo, rimMat);
      spoke.rotation.x = (i / 5) * Math.PI;
      wheel.add(spoke);
    }
    wheel.position.set(x, y, z);
    wheels.push(wheel);
    group.add(wheel);
  }

  // The wheels are spun and steered by the physics, so they have to be
  // separate objects with their own rotation order.
  for (const wheel of wheels) {
    wheel.rotation.order = 'YXZ';
  }

  // --- contact shadow ----------------------------------------------------
  // A soft blob under the car. The shadow map does the real work, this only
  // keeps the car anchored when the map is off.
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(shape.width * 1.35, shape.length * 1.02),
    new THREE.MeshBasicMaterial({
      map: getShadowTexture(),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.renderOrder = 1;
  group.add(shadow);

  group.userData.wheels = wheels;
  group.userData.frontWheels = wheels.slice(0, 2);
  group.userData.ghost = ghost;
  group.userData.shape = shape;
  group.userData.headMat = headMat;
  group.userData.tailMat = tailMat;
  group.userData.exhaust = exhausts;
  return group;
}
