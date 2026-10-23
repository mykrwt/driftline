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
      uLightTint: { value: new THREE.Color(0xffffff) },
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
        gl_PointSize = min(115.0, aSize * (340.0 / max(0.1, -mv.z)));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec3 uLightTint;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vec2 uv = gl_PointCoord;
        vec4 tex = texture2D(map, uv);
        float radial = 1.0 - smoothstep(0.12, 0.5, length(uv - 0.5));
        float alpha = tex.a * radial * vAlpha;
        if (alpha < 0.006) discard;
        gl_FragColor = vec4(vColor * uLightTint * tex.rgb, alpha);
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
  const skidPositions = new Float32Array(MAX_MARKS * 6 * 3);
  const skidGeometry = new THREE.BufferGeometry();
  skidGeometry.setAttribute('position', new THREE.BufferAttribute(skidPositions, 3));
  skidGeometry.setDrawRange(0, 0);
  const skidMaterial = new THREE.MeshBasicMaterial({
    color: 0x090a0d,
    transparent: true,
    opacity: 0.42,
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
  /** The last point of every mark stream, so the marks form ribbons. */
  const skidStreams = new Map();

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
   * Lay down a strip of rubber.
   *
   * The strip connects the last point of the stream with the new one, so the
   * marks form a continuous ribbon behind the tyre instead of dots.
   *
   * @param {number} id the stream (the wheel index)
   * @param {number} x @param {number} y @param {number} z
   * @param {number} width
   */
  function addSkid(id, x, y, z, width) {
    const last = skidStreams.get(id);
    if (!last) {
      skidStreams.set(id, { x, y, z });
      return;
    }
    const dx = x - last.x;
    const dz = z - last.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.12) return;
    // The ribbon runs across the direction of travel.
    const sx = (-dz / length) * (width / 2);
    const sz = (dx / length) * (width / 2);
    const index = markCursor;
    markCursor = (markCursor + 1) % MAX_MARKS;
    markCount = Math.min(MAX_MARKS, markCount + 1);
    const o = index * 18;
    const y0 = last.y + 0.02;
    const y1 = y + 0.02;
    const set = (slot, px, py, pz) => {
      skidPositions[o + slot * 3] = px;
      skidPositions[o + slot * 3 + 1] = py;
      skidPositions[o + slot * 3 + 2] = pz;
    };
    set(0, last.x + sx, y0, last.z + sz);
    set(1, last.x - sx, y0, last.z - sz);
    set(2, x - sx, y1, z - sz);
    set(3, last.x + sx, y0, last.z + sz);
    set(4, x - sx, y1, z - sz);
    set(5, x + sx, y1, z + sz);
    skidGeometry.attributes.position.needsUpdate = true;
    skidGeometry.setDrawRange(0, markCount * 6);
    last.x = x;
    last.y = y;
    last.z = z;
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
      sizes[i] = p.size * (0.55 + t * 1.65);
      alphas[i] = Math.max(0, Math.pow(1 - t, 1.75) * 0.28);
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
    skidStreams.clear();
    skidGeometry.setDrawRange(0, 0);
  }

  return {
    smoke,
    skid,
    emitSmoke,
    addSkid,
    update,
    reset,
    setLightTint(hex, scale = 1) {
      smokeMaterial.uniforms.uLightTint.value.set(hex).multiplyScalar(scale);
    },
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
