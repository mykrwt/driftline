/**
 * In-world effects: tyre smoke, dust and skid marks.
 *
 * Both systems are pooled: no allocation happens while driving, which keeps
 * the garbage collector quiet and the frame time flat.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { createSmokeTexture } from './models.js';

const MAX_PARTICLES = 420;
const MAX_MARKS = 900;

/**
 * @returns {{
 *   smoke: THREE.Points,
 *   skid: THREE.Mesh,
 *   emitSmoke: (x: number, y: number, z: number, vx: number, vz: number, intensity: number, tint?: number[]) => void,
 *   addSkid: (x: number, y: number, z: number, nx: number, nz: number, width: number, alpha: number) => void,
 *   update: (dt: number) => void,
 *   reset: () => void,
 *   dispose: () => void,
 * }}
 */
export function createEffects(scene) {
  // ---------------------------------------------------------------- smoke
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const sizes = new Float32Array(MAX_PARTICLES);
  const alphas = new Float32Array(MAX_PARTICLES);
  const colors = new Float32Array(MAX_PARTICLES * 3);
  const smokeGeometry = new THREE.BufferGeometry();
  smokeGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  smokeGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  smokeGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  smokeGeometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  smokeGeometry.setDrawRange(0, MAX_PARTICLES);

  const smokeTexture = createSmokeTexture();
  const smokeMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      map: { value: smokeTexture },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      attribute vec3 aColor;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vAlpha = aAlpha;
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = min(180.0, aSize * (420.0 / max(0.1, -mv.z)));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vec4 tex = texture2D(map, gl_PointCoord);
        float alpha = tex.a * vAlpha;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vColor * tex.rgb, alpha);
      }
    `,
  });
  const smoke = new THREE.Points(smokeGeometry, smokeMaterial);
  smoke.frustumCulled = false;
  smoke.renderOrder = 5;
  scene.add(smoke);

  /** @type {{x:number,y:number,z:number,vx:number,vy:number,vz:number,life:number,max:number,size:number,tint:number[]}[]} */
  const particles = [];
  for (let i = 0; i < MAX_PARTICLES; i++) {
    particles.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, tint: [1, 1, 1] });
    alphas[i] = 0;
    sizes[i] = 0;
  }
  let particleCursor = 0;

  // ----------------------------------------------------------------- skid
  const skidPositions = new Float32Array(MAX_MARKS * 4 * 3);
  const skidGeometry = new THREE.BufferGeometry();
  skidGeometry.setAttribute('position', new THREE.BufferAttribute(skidPositions, 3));
  const skidIndices = new Uint16Array(MAX_MARKS * 6);
  for (let i = 0; i < MAX_MARKS; i++) {
    const v = i * 4;
    const o = i * 6;
    skidIndices[o] = v;
    skidIndices[o + 1] = v + 2;
    skidIndices[o + 2] = v + 1;
    skidIndices[o + 3] = v + 1;
    skidIndices[o + 4] = v + 2;
    skidIndices[o + 5] = v + 3;
  }
  skidGeometry.setIndex(new THREE.BufferAttribute(skidIndices, 1));
  skidGeometry.setDrawRange(0, 0);
  const skidMaterial = new THREE.MeshBasicMaterial({
    color: 0x0a0a0c,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const skid = new THREE.Mesh(skidGeometry, skidMaterial);
  skid.frustumCulled = false;
  skid.renderOrder = 2;
  scene.add(skid);
  let markCursor = 0;
  let markCount = 0;

  /**
   * @param {number} x @param {number} y @param {number} z
   * @param {number} vx @param {number} vz
   * @param {number} intensity 0..1
   * @param {number[]} [tint]
   */
  function emitSmoke(x, y, z, vx, vz, intensity, tint) {
    const p = particles[particleCursor];
    particleCursor = (particleCursor + 1) % MAX_PARTICLES;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx * 0.12 + (Math.random() - 0.5) * 1.6;
    p.vy = 0.7 + Math.random() * 1.1;
    p.vz = vz * 0.12 + (Math.random() - 0.5) * 1.6;
    p.max = 0.7 + Math.random() * 0.9;
    p.life = p.max;
    p.size = 0.9 + Math.random() * 1.1 + intensity * 1.4;
    p.tint = tint || [0.92, 0.92, 0.95];
  }

  /**
   * @param {number} x @param {number} y @param {number} z
   * @param {number} nx normal x
   * @param {number} nz normal z
   * @param {number} width
   * @param {number} alpha
   */
  function addSkid(x, y, z, nx, nz, width, alpha) {
    const index = markCursor;
    markCursor = (markCursor + 1) % MAX_MARKS;
    markCount = Math.min(MAX_MARKS, markCount + 1);
    const half = width / 2;
    const o = index * 12;
    skidPositions[o] = x + nx * half;
    skidPositions[o + 1] = y + 0.015;
    skidPositions[o + 2] = z + nz * half;
    skidPositions[o + 3] = x - nx * half;
    skidPositions[o + 4] = y + 0.015;
    skidPositions[o + 5] = z - nz * half;
    skidPositions[o + 6] = skidPositions[o];
    skidPositions[o + 7] = skidPositions[o + 1];
    skidPositions[o + 8] = skidPositions[o + 2];
    skidPositions[o + 9] = skidPositions[o + 3];
    skidPositions[o + 10] = skidPositions[o + 4];
    skidPositions[o + 11] = skidPositions[o + 5];
    skidGeometry.attributes.position.needsUpdate = true;
    skidGeometry.setDrawRange(0, markCount * 6);
    void alpha;
  }

  /**
   * @param {number} dt
   */
  function update(dt) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particles[i];
      if (p.life <= 0) {
        alphas[i] = 0;
        continue;
      }
      p.life -= dt;
      const t = 1 - p.life / p.max;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy *= 0.985;
      p.vx *= 0.96;
      p.vz *= 0.96;
      const o = i * 3;
      positions[o] = p.x;
      positions[o + 1] = p.y;
      positions[o + 2] = p.z;
      sizes[i] = p.size * (0.7 + t * 2.1);
      alphas[i] = Math.max(0, (1 - t) * 0.55);
      colors[o] = p.tint[0];
      colors[o + 1] = p.tint[1];
      colors[o + 2] = p.tint[2];
    }
    smokeGeometry.attributes.position.needsUpdate = true;
    smokeGeometry.attributes.aSize.needsUpdate = true;
    smokeGeometry.attributes.aAlpha.needsUpdate = true;
    smokeGeometry.attributes.aColor.needsUpdate = true;
  }

  function reset() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      particles[i].life = 0;
      alphas[i] = 0;
    }
    smokeGeometry.attributes.aAlpha.needsUpdate = true;
    markCount = 0;
    markCursor = 0;
    skidGeometry.setDrawRange(0, 0);
  }

  return {
    smoke,
    skid,
    emitSmoke,
    addSkid,
    update,
    reset,
    dispose() {
      scene.remove(smoke);
      scene.remove(skid);
      smokeGeometry.dispose();
      smokeMaterial.dispose();
      skidGeometry.dispose();
      skidMaterial.dispose();
      smokeTexture.dispose();
    },
  };
}
