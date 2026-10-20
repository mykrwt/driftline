/**
 * The world scene: sky, light, fog and the materials used by the chunks.
 *
 * The world itself is streamed in by the chunk manager; this module only sets
 * up everything that surrounds it.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { createRoadTexture } from './models.js';
import { createChunkManager, createTerrainManager } from './chunks.js';
import { roadHeight } from './road.js';

/**
 * @param {import('./road.js').RoadProfile} profile
 * @param {{ seed: number, assets: any, palette?: any, renderer?: any }} options
 */
export function createWorldScene(profile, options) {
  const palette = options.palette ?? {
    skyTop: '#1f4fd8',
    skyBottom: '#8fd0ff',
    sun: '#fff6d8',
    sunGlow: 'rgba(255, 236, 180, 0.55)',
    grass: '#2f7a3d',
    grassAlt: '#2a6f38',
    road: '#4a4e58',
    lane: '#e9ecf5',
    fog: '#b6d8f7',
    fogStart: 220,
    fogEnd: 620,
    sunX: 0.78,
    sunY: 0.28,
    starAlpha: 0,
  };

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(palette.fog), palette.fogStart, palette.fogEnd);
  scene.background = new THREE.Color(palette.fog);

  // --- sky dome ----------------------------------------------------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2400, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(palette.skyTop) },
        bottomColor: { value: new THREE.Color(palette.skyBottom) },
        sunColor: { value: new THREE.Color(palette.sun) },
        sunDirection: { value: new THREE.Vector3(palette.sunX * 2 - 1, palette.sunY * 2 - 0.4, -0.6).normalize() },
        stars: { value: palette.starAlpha },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform vec3 sunColor;
        uniform vec3 sunDirection;
        uniform float stars;
        varying vec3 vDir;
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        void main() {
          vec3 dir = normalize(vDir);
          float h = dir.y;
          vec3 color = mix(bottomColor, topColor, smoothstep(-0.12, 0.62, h));
          float sun = max(dot(dir, normalize(sunDirection)), 0.0);
          color += sunColor * pow(sun, 900.0) * 2.4;
          color += sunColor * pow(sun, 12.0) * 0.16;
          if (stars > 0.01 && h > 0.02) {
            vec3 cell = floor(dir * 320.0);
            float rnd = hash(cell);
            color += vec3(step(0.9975, rnd) * stars * (0.6 + h));
          }
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  scene.add(sky);

  // --- lights ------------------------------------------------------------
  scene.add(new THREE.HemisphereLight(new THREE.Color(palette.skyBottom), new THREE.Color(palette.grass), 1.8));
  const sun = new THREE.DirectionalLight(new THREE.Color(palette.sun), 1.75);
  sun.position.set(palette.sunX * 400, 300, -180);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(new THREE.Color(palette.skyBottom), 0.6);
  fill.position.set(-220, 140, 240);
  scene.add(fill);

  // --- materials ---------------------------------------------------------
  const roadTexture = createRoadTexture(palette, options.assets?.textures?.asphalt ?? null);
  const roadMaterial = new THREE.MeshStandardMaterial({
    map: roadTexture,
    roughness: 0.94,
    metalness: 0.02,
  });
  const terrainMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });

  // Photographic ground detail, tiled across the slopes.
  const groundImage = options.assets?.textures?.ground ?? null;
  if (groundImage) {
    const groundTexture = new THREE.Texture(groundImage);
    groundTexture.wrapS = THREE.RepeatWrapping;
    groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.colorSpace = THREE.SRGBColorSpace;
    groundTexture.anisotropy = 4;
    groundTexture.needsUpdate = true;
    terrainMaterial.map = groundTexture;
  }

  const chunks = createChunkManager({
    profile,
    scene,
    assets: options.assets,
    seed: options.seed,
    roadMaterial,
    terrainMaterial,
  });

  // Billboard forests for the far mountains.
  let impostors = null;
  if (options.assets && options.renderer) {
    const tree = options.assets.impostor(options.renderer, 'tree');
    const pine = options.assets.impostor(options.renderer, 'treePine');
    if (tree || pine) impostors = { tree, pine };
  }

  const terrain = createTerrainManager({
    profile,
    scene,
    seed: options.seed,
    terrainMaterial,
    impostors,
  });

  return {
    scene,
    chunks,
    terrain,
    palette,
    /**
     * @param {number} playerS
     * @param {number} playerX
     * @param {number} playerZ
     */
    update(playerS, playerX, playerZ) {
      chunks.update(playerS);
      terrain.update(playerX, playerZ);
      sky.position.set(playerX, 0, playerZ);
      options.assets?.tick?.(performance.now() / 1000);
    },
    dispose() {
      chunks.dispose();
      terrain.dispose();
      roadTexture.dispose();
      roadMaterial.dispose();
      terrainMaterial.dispose();
    },
  };
}
