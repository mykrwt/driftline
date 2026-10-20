/**
 * The world scene: sky, light, fog and the materials used by the chunks.
 *
 * The world itself is streamed in by the chunk manager; this module only sets
 * up everything that surrounds it.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { createRoadTexture } from './models.js';
import { createChunkManager } from './chunks.js';
import { createTerrainManager } from './terrain.js';
import { roadHeight } from './road.js';
import { PALETTES } from './palette.js';
import { createWaterMaterial } from './water.js';

/**
 * @param {import('./road.js').RoadProfile} profile
 * @param {{ seed: number, assets: any, palette?: any, renderer?: any }} options
 */
export function createWorldScene(profile, options) {
  const palette = { ...PALETTES.alpine, ...(options.palette ?? {}) };

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(palette.fog), palette.fogStart, palette.fogEnd);
  scene.background = new THREE.Color(palette.fog);

  // --- sky dome ----------------------------------------------------------
  const skyUniforms = {
    topColor: { value: new THREE.Color(palette.skyTop) },
    horizonColor: { value: new THREE.Color(palette.skyHorizon) },
    groundColor: { value: new THREE.Color(palette.skyGround) },
    sunColor: { value: new THREE.Color(palette.sun) },
    sunDirection: {
      value: new THREE.Vector3(palette.sunX * 2 - 1, palette.sunY * 2 - 0.35, -0.62).normalize(),
    },
    stars: { value: palette.starAlpha },
    cloudAmount: { value: palette.cloud },
    time: { value: 0 },
  };

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: skyUniforms,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 groundColor;
        uniform vec3 sunColor;
        uniform vec3 sunDirection;
        uniform float stars;
        uniform float cloudAmount;
        uniform float time;
        varying vec3 vDir;

        float hash(vec2 p) {
          // A hash without sin(): the sine trick loses its precision on
          // mobile GPUs and collapses into a flat noise.
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.5;
          for (int i = 0; i < 5; i++) {
            value += noise(p) * amplitude;
            p *= 2.07;
            amplitude *= 0.5;
          }
          return value;
        }

        void main() {
          vec3 dir = normalize(vDir);
          float h = dir.y;

          // The gradient: a deep zenith, a bright horizon and a hazy ground.
          vec3 color = mix(horizonColor, topColor, smoothstep(-0.02, 1.05, h));
          color = mix(groundColor, color, smoothstep(-0.22, 0.03, h));

          // The sun: a small disc, a tight glow and a wide halo.
          float sun = max(dot(dir, normalize(sunDirection)), 0.0);
          color += sunColor * pow(sun, 2200.0) * 6.0;
          color += sunColor * pow(sun, 30.0) * 0.35;
          color += sunColor * pow(sun, 4.0) * 0.10;

          // Clouds: layered noise flattened towards the horizon.
          if (h > 0.0) {
            vec2 cloudUv = dir.xz / max(h + 0.1, 0.1);
            float drift = time * 0.004;
            float base = fbm(cloudUv * 0.42 + vec2(drift, drift * 0.4));
            float detail = fbm(cloudUv * 1.35 - vec2(drift * 1.6, 0.0));
            float clouds = smoothstep(0.44, 0.78, base * 0.75 + detail * 0.35);
            clouds *= smoothstep(0.02, 0.3, h) * cloudAmount;
            // The clouds catch the light near the sun.
            float lit = pow(sun, 2.5) * 0.7 + 0.3;
            vec3 cloudColor = mix(vec3(0.58, 0.63, 0.72), sunColor, lit * 0.6);
            color = mix(color, cloudColor, clouds * 0.85);
          }

          if (stars > 0.01 && h > 0.0) {
            vec3 cell = floor(dir * 420.0);
            float rnd = hash(cell.xy + cell.z * 7.0);
            float twinkle = 0.55 + 0.45 * sin(time * 2.0 + rnd * 40.0);
            color += vec3(step(0.9975, rnd) * stars * twinkle * (0.5 + h));
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
  const hemi = new THREE.HemisphereLight(
    new THREE.Color(palette.skyHorizon),
    new THREE.Color(palette.ambient),
    palette.hemiIntensity,
  );
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(new THREE.Color(palette.sun), palette.sunIntensity);
  sun.position.set(palette.sunX * 400, 300, -180);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 460;
  // A tight box around the car keeps the shadows crisp; the distance is
  // covered by the fog.
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.bias = -0.0009;
  sun.shadow.normalBias = 0.45;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(new THREE.Color(palette.skyHorizon), palette.fillIntensity);
  fill.position.set(-220, 140, 240);
  scene.add(fill);

  // --- materials ---------------------------------------------------------
  const roadTexture = createRoadTexture(palette, options.assets?.textures?.asphalt ?? null);
  const roadMaterial = new THREE.MeshStandardMaterial({
    map: roadTexture,
    color: 0xe4e8ee,
    roughness: 0.8,
    metalness: 0.02,
  });

  const terrainMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });

  // The photographic ground tile is used as a *detail* layer: it modulates
  // the vertex colour instead of replacing it, which keeps the palette
  // readable instead of turning everything into mud.
  const groundImage = options.assets?.textures?.ground ?? null;
  if (groundImage) {
    const groundTexture = new THREE.Texture(groundImage);
    groundTexture.wrapS = THREE.RepeatWrapping;
    groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.colorSpace = THREE.SRGBColorSpace;
    groundTexture.anisotropy = 4;
    groundTexture.needsUpdate = true;
    terrainMaterial.map = groundTexture;
    terrainMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        #ifdef USE_MAP
          vec4 detailTexel = texture2D( map, vMapUv );
          // The tile is a detail layer: it breaks up the flat vertex colour
          // without taking the palette away.
          vec3 detail = mix( vec3( 1.0 ), detailTexel.rgb * 3.4, 0.62 );
          diffuseColor.rgb *= detail;
        #endif
        `,
      );
    };
  }

  const chunks = createChunkManager({
    profile,
    scene,
    assets: options.assets,
    seed: options.seed,
    roadMaterial,
    terrainMaterial,
  });

  // The trees are billboards: the model is baked into a texture once and
  // drawn with crossed quads afterwards. They are baked on demand, because a
  // race can start before the assets have finished loading.
  /** @type {Record<string, any>} */
  const impostors = {};
  const getImpostor = (key) => {
    if (impostors[key]) return impostors[key];
    if (!options.assets || !options.renderer) return null;
    const impostor = options.assets.impostor(options.renderer, key, { size: 256 });
    if (impostor) impostors[key] = impostor;
    return impostor;
  };

  // The lakes in the valley.
  const water = createWaterMaterial({
    fog: palette.fog,
    sky: palette.skyHorizon,
    deep: palette.waterDeep ?? '#17475f',
    shallow: palette.waterShallow ?? '#3d8ba4',
    sun: palette.sun,
    sunDirection: new THREE.Vector3(
      palette.sunX * 2 - 1,
      palette.sunY * 1.6 + 0.25,
      -0.55,
    ).normalize(),
  });
  water.uniforms.uFogNear.value = palette.fogStart;
  water.uniforms.uFogFar.value = palette.fogEnd;

  const terrain = createTerrainManager({
    profile,
    scene,
    seed: options.seed,
    terrainMaterial,
    assets: options.assets,
    getImpostor,
    waterMaterial: water.material,
  });

  return {
    scene,
    chunks,
    terrain,
    palette,
    sun,
    /**
     * Change the mood of the world without rebuilding it.
     * @param {any} next
     */
    setPalette(next) {
      Object.assign(palette, next);
      const fog = scene.fog;
      fog.color = new THREE.Color(palette.fog);
      fog.near = palette.fogStart;
      fog.far = palette.fogEnd;
      scene.background = new THREE.Color(palette.fog);
      skyUniforms.topColor.value = new THREE.Color(palette.skyTop);
      skyUniforms.horizonColor.value = new THREE.Color(palette.skyHorizon);
      skyUniforms.groundColor.value = new THREE.Color(palette.skyGround);
      skyUniforms.sunColor.value = new THREE.Color(palette.sun);
      skyUniforms.stars.value = palette.starAlpha;
      skyUniforms.cloudAmount.value = palette.cloud;
      water.uniforms.uSky.value = new THREE.Color(palette.skyHorizon);
      water.uniforms.uFogColor.value = new THREE.Color(palette.fog);
      water.uniforms.uFogNear.value = palette.fogStart;
      water.uniforms.uFogFar.value = palette.fogEnd;
      sun.color = new THREE.Color(palette.sun);
      sun.intensity = palette.sunIntensity;
      hemi.color = new THREE.Color(palette.skyHorizon);
      hemi.groundColor = new THREE.Color(palette.ambient);
      hemi.intensity = palette.hemiIntensity;
      fill.color = new THREE.Color(palette.skyHorizon);
      fill.intensity = palette.fillIntensity;
    },
    /**
     * @param {number} playerS
     * @param {number} playerX
     * @param {number} playerZ
     */
    update(playerS, playerX, playerZ, elapsed = 0) {
      chunks.update(playerS);
      terrain.update(playerS);
      water.update(elapsed);
      sky.position.set(playerX, 0, playerZ);
      skyUniforms.time.value = elapsed;
      // Keep the shadow frustum around the player.
      const sunDistance = 220;
      sun.position.set(
        playerX + sunDistance * (palette.sunX * 2 - 1) * 0.8,
        sunDistance * (palette.sunY * 1.6 + 0.25),
        playerZ - sunDistance * 0.55,
      );
      sun.target.position.set(playerX, roadHeight(profile, playerZ), playerZ);
      sun.target.updateMatrixWorld();
      options.assets?.tick?.(elapsed);
    },
    dispose() {
      chunks.dispose();
      terrain.dispose();
      water.dispose();
      roadTexture.dispose();
      roadMaterial.dispose();
      terrainMaterial.dispose();
    },
  };
}
