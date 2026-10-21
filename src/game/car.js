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
    width: 1.78,
    height: 1.3,
    wheelRadius: 0.36,
    wheelWidth: 0.26,
    wheelbase: 1.32,
    track: 0.9,
    wing: false,
    bullbar: false,
    // The lower body: [z, halfWidth, bottom, top].
    body: [
      [-2.14, 0.52, 0.34, 0.60],
      [-1.92, 0.70, 0.26, 0.70],
      [-1.30, 0.76, 0.22, 0.76],
      [-0.55, 0.78, 0.20, 0.78],
      [0.25, 0.77, 0.19, 0.76],
      [1.00, 0.74, 0.20, 0.68],
      [1.62, 0.68, 0.23, 0.58],
      [2.02, 0.58, 0.28, 0.48],
      [2.18, 0.42, 0.34, 0.42],
    ],
    // The glasshouse: [z, halfWidth, bottom, top].
    cabin: [
      [-1.34, 0.60, 0.72, 0.80],
      [-1.08, 0.70, 0.72, 1.14],
      [-0.30, 0.72, 0.72, 1.28],
      [0.34, 0.68, 0.72, 1.16],
      [0.66, 0.54, 0.72, 0.84],
    ],
  },
  comet: {
    length: 4.1,
    width: 1.86,
    height: 1.2,
    wheelRadius: 0.35,
    wheelWidth: 0.28,
    wheelbase: 1.3,
    track: 0.93,
    wing: true,
    bullbar: false,
    body: [
      [-2.04, 0.56, 0.30, 0.56],
      [-1.80, 0.74, 0.22, 0.66],
      [-1.18, 0.80, 0.18, 0.70],
      [-0.42, 0.82, 0.17, 0.70],
      [0.38, 0.79, 0.16, 0.66],
      [1.08, 0.75, 0.18, 0.58],
      [1.70, 0.66, 0.21, 0.48],
      [2.00, 0.50, 0.26, 0.40],
    ],
    cabin: [
      [-1.00, 0.58, 0.64, 0.74],
      [-0.70, 0.68, 0.64, 1.08],
      [0.02, 0.66, 0.64, 1.18],
      [0.46, 0.56, 0.64, 0.86],
    ],
  },
  bulldozer: {
    length: 4.9,
    width: 2.0,
    height: 1.6,
    wheelRadius: 0.42,
    wheelWidth: 0.34,
    wheelbase: 1.55,
    track: 0.98,
    wing: false,
    bullbar: true,
    body: [
      [-2.44, 0.68, 0.44, 0.9],
      [-2.10, 0.86, 0.38, 1.0],
      [-1.28, 0.90, 0.34, 1.04],
      [-0.38, 0.90, 0.34, 1.04],
      [0.52, 0.88, 0.34, 1.0],
      [1.32, 0.84, 0.36, 0.9],
      [2.06, 0.76, 0.4, 0.76],
      [2.40, 0.62, 0.46, 0.68],
    ],
    cabin: [
      [-1.02, 0.80, 1.0, 1.1],
      [-0.60, 0.88, 1.0, 1.5],
      [0.34, 0.88, 1.0, 1.58],
      [0.98, 0.78, 1.0, 1.24],
      [1.26, 0.66, 1.0, 1.04],
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
    [-halfWidth * 0.58, bottom],
    [halfWidth * 0.58, bottom],
    [halfWidth, bottom + height * 0.16],
    [halfWidth, bottom + height * 0.8],
    [halfWidth * 0.93, top - height * 0.04],
    [halfWidth * 0.74, top],
    [-halfWidth * 0.74, top],
    [-halfWidth * 0.93, top - height * 0.04],
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
    color: 0x0b1424,
    roughness: 0.06,
    metalness: 0.9,
    transparent: true,
    opacity: ghost ? 0.4 : 0.94,
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

  // The roof is a shell that follows the shape of the glass, so it never
  // floats above it.
  const roofRings = shape.cabin.map(([z, halfWidth, bottom, top]) => [
    z,
    halfWidth * 1.04,
    bottom + (top - bottom) * 0.52,
    top,
  ]);
  const roof = new THREE.Mesh(loftGeometry(roofRings), bodyMat);
  roof.castShadow = true;
  group.add(roof);

  // The windows: a dark band under the roof, so the glass reads as glass.
  const windowRings = shape.cabin.map(([z, halfWidth, bottom, top]) => [
    z,
    halfWidth * 1.01,
    bottom + 0.02,
    bottom + (top - bottom) * 0.56,
  ]);
  const windows = new THREE.Mesh(loftGeometry(windowRings), glassMat);
  group.add(windows);

  // --- racing stripe -----------------------------------------------------
  const bodyTop = Math.max(...shape.body.map((ring) => ring[3]));
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, shape.length * 0.8), accentMat);
  stripe.position.set(0, bodyTop + 0.004, 0);
  group.add(stripe);

  // The mirrors sit on the widest point of the cabin.
  const cabinWide = Math.max(...shape.cabin.map((ring) => ring[1]));
  for (const side of [-1, 1]) {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.09), trimMat);
    mirror.position.set(
      side * (cabinWide + 0.06),
      shape.cabin[0][2] + (shape.cabin[0][3] - shape.cabin[0][2]) * 0.4,
      shape.cabin[shape.cabin.length - 1][0] - 0.14,
    );
    group.add(mirror);
  }

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

  // --- grille and diffuser -----------------------------------------------
  const grille = new THREE.Mesh(
    new THREE.BoxGeometry(shape.width * 0.52, 0.16, 0.08),
    trimMat,
  );
  grille.position.set(0, shape.body[shape.body.length - 2][3] - 0.14, nose - 0.02);
  group.add(grille);

  const diffuser = new THREE.Mesh(
    new THREE.BoxGeometry(shape.width * 0.7, 0.1, 0.3),
    trimMat,
  );
  diffuser.position.set(0, 0.26, tail + 0.1);
  group.add(diffuser);

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
