/**
 * The world scene: sky dome, distant 360° alpine mountain horizon rings,
 * lights, shadows, procedural PBR terrain shader, and chunk streamers.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { createRoadTexture, createGroundNormalMap } from './models.js';
import { createChunkManager } from './chunks.js';
import { createTerrainManager, VEGETATION_KEYS } from './terrain.js';
import { createCollisionWorld } from './collision.js';
import { roadHeight } from './road.js';
import { PALETTES, resolvePalette } from './palette.js';
import { createWaterMaterial } from './water.js';
import { applyProceduralTerrainShader } from '../shaders/terrainShader.js';
import { ridged, fbm } from './noise.js';

/**
 * Build two ultra-lightweight concentric 360° distant mountain panorama rings
 * so the valley never terminates in a blank sky cutoff ahead of streamed chunks.
 *
 * @param {number} seed
 * @param {any} palette
 */
function createHorizonPanorama(seed, palette) {
  const uniforms = {
    uFogColor: { value: new THREE.Color(palette.fog) },
    uNearColor: { value: new THREE.Color(palette.horizonNear ?? '#7f9fc2') },
    uFarColor: { value: new THREE.Color(palette.horizonFar ?? '#9dbbd9') },
    uSnowColor: { value: new THREE.Color(palette.horizonSnow ?? '#eef6ff') },
    uSunColor: { value: new THREE.Color(palette.sun) },
    uSunDir: { value: new THREE.Vector3(0.4, 0.4, -0.6).normalize() },
  };

  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms,
    vertexShader: `
      attribute float aLayer;
      attribute float aHeightNorm;
      varying float vLayer;
      varying float vHeightNorm;
      varying vec3 vDir;

      void main() {
        vLayer = aLayer;
        vHeightNorm = aHeightNorm;
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uFogColor;
      uniform vec3 uNearColor;
      uniform vec3 uFarColor;
      uniform vec3 uSnowColor;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      varying float vLayer;
      varying float vHeightNorm;
      varying vec3 vDir;

      void main() {
        vec3 base = mix(uNearColor, uFarColor, vLayer);
        // Subtle sunlit snow caps along high distant summits & arêtes.
        float snow = smoothstep(0.54, 0.92, vHeightNorm);
        vec3 col = mix(base, uSnowColor, snow * (vLayer > 0.5 ? 0.42 : 0.58));

        // Warm atmospheric forward scatter towards the sun.
        float sunAlign = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
        col = mix(col, uSunColor, pow(sunAlign, 5.0) * 0.22);

        // Melt base seamlessly into horizon haze; keep upper crests crisp against sky.
        col = mix(uFogColor, col, smoothstep(0.02, 0.72, vHeightNorm));
        float alpha = smoothstep(0.0, 0.16, vHeightNorm) * (vLayer > 0.5 ? 0.78 : 0.9);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const group = new THREE.Group();
  const rings = [
    { radius: 1750, baseY: -65, peakScale: 370, layer: 0, segs: 128, seedOff: 701 },
    { radius: 2650, baseY: -90, peakScale: 560, layer: 1, segs: 128, seedOff: 977 },
  ];

  for (const ring of rings) {
    const positions = [];
    const layers = [];
    const heights = [];
    const indices = [];

    for (let i = 0; i <= ring.segs; i++) {
      const theta = (i / ring.segs) * Math.PI * 2;
      const cx = Math.cos(theta);
      const cz = Math.sin(theta);
      const r1 = ridged(cx * 3.1 + 4.2, cz * 3.1 - 2.7, 4, seed + ring.seedOff);
      const r2 = ridged(cx * 7.4 - 1.3, cz * 7.4 + 5.9, 3, seed + ring.seedOff + 19);
      const broad = fbm(cx * 1.9, cz * 1.9, 3, seed + ring.seedOff + 41) * 0.5 + 0.5;
      const hNorm = Math.min(1, Math.max(0.06, Math.pow(r1, 1.35) * 0.72 + r2 * 0.22 + broad * 0.24));
      const topY = ring.baseY + hNorm * ring.peakScale;

      // Bottom vertex
      positions.push(cx * ring.radius, ring.baseY, cz * ring.radius);
      layers.push(ring.layer);
      heights.push(0);

      // Crest vertex
      positions.push(cx * ring.radius, topY, cz * ring.radius);
      layers.push(ring.layer);
      heights.push(hNorm);
    }

    for (let i = 0; i < ring.segs; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aLayer', new THREE.Float32BufferAttribute(layers, 1));
    geo.setAttribute('aHeightNorm', new THREE.Float32BufferAttribute(heights, 1));
    geo.setIndex(indices);
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -950 + ring.layer * -10;
    group.add(mesh);
  }

  return {
    group,
    uniforms,
    dispose() {
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.geometry.dispose();
      });
      material.dispose();
    },
  };
}

/**
 * @param {import('./road.js').RoadProfile} profile
 * @param {{ seed: number, assets: any, palette?: any, renderer?: any }} options
 */
export function createWorldScene(profile, options) {
  const palette = { ...PALETTES.alpine, ...resolvePalette(options.palette) };

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(palette.fog), palette.fogStart, palette.fogEnd);
  scene.background = new THREE.Color(palette.fog);

  const computeSunDir = (p) =>
    new THREE.Vector3(p.sunX * 2 - 1, p.sunY * 1.85 + 0.12, -0.62).normalize();

  // --- sky dome ----------------------------------------------------------
  const skyUniforms = {
    topColor: { value: new THREE.Color(palette.skyTop) },
    horizonColor: { value: new THREE.Color(palette.skyHorizon) },
    groundColor: { value: new THREE.Color(palette.skyGround) },
    sunColor: { value: new THREE.Color(palette.sun) },
    sunDirection: { value: computeSunDir(palette) },
    stars: { value: palette.starAlpha },
    cloudAmount: { value: palette.cloud },
    time: { value: 0 },
  };

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3400, 36, 24),
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

        float fbm3(vec2 p) {
          float value = 0.0;
          float amplitude = 0.5;
          for (int i = 0; i < 3; i++) {
            value += noise(p) * amplitude;
            p = mat2(1.64, 1.18, -1.18, 1.64) * p;
            amplitude *= 0.5;
          }
          return value;
        }

        void main() {
          vec3 dir = normalize(vDir);
          float h = dir.y;
          vec3 sDir = normalize(sunDirection);

          vec3 color = mix(horizonColor, topColor, pow(clamp(smoothstep(-0.02, 0.92, h), 0.0, 1.0), 0.78));
          color = mix(groundColor, color, smoothstep(-0.22, 0.03, h));

          float sun = max(dot(dir, sDir), 0.0);
          float horizonBand = exp(-max(h, 0.0) * 6.5);
          color += sunColor * pow(sun, 3.0) * horizonBand * 0.18;
          color += sunColor * pow(sun, 1900.0) * 6.5;
          color += sunColor * pow(sun, 34.0) * 0.34;
          color += sunColor * pow(sun, 5.0) * 0.09;

          if (h > 0.005) {
            vec2 cloudUv = dir.xz / max(h + 0.13, 0.13);
            float drift = time * 0.0035;
            float base = fbm3(cloudUv * 0.36 + vec2(drift, drift * 0.35));
            float detail = noise(cloudUv * 1.15 - vec2(drift * 1.5, 0.0)) * 0.65
                         + noise(cloudUv * 2.35 + vec2(0.0, drift)) * 0.35;
            float cirrus = fbm3(cloudUv * vec2(0.22, 0.95) + vec2(drift * 0.7, 0.0));

            float puff = smoothstep(0.47, 0.84, base * 0.74 + detail * 0.34);
            float wisps = smoothstep(0.62, 0.90, cirrus) * 0.34;
            float clouds = clamp(puff + wisps, 0.0, 1.0) * smoothstep(0.02, 0.28, h) * cloudAmount;

            float skyLum = clamp(dot(horizonColor, vec3(0.299, 0.587, 0.114)) * 1.35, 0.02, 1.0);
            float lit = pow(sun, 2.2) * 0.65 + 0.35;
            vec3 shadowTint = mix(topColor * 0.85, horizonColor * 0.82, 0.55);
            vec3 highlightTint = mix(vec3(0.96, 0.98, 1.0) * skyLum, sunColor * (0.35 + 0.75 * skyLum), 0.45);
            vec3 cloudColor = mix(shadowTint, highlightTint, clamp(lit * 0.62 + detail * 0.42, 0.0, 1.0));
            color = mix(color, cloudColor, clouds * 0.82);
          }

          if (stars > 0.01 && h > 0.0) {
            vec3 cell = floor(dir * 430.0);
            float rnd = hash(cell.xy + cell.z * 7.0);
            float twinkle = 0.55 + 0.45 * sin(time * 2.1 + rnd * 40.0);
            color += vec3(0.88, 0.93, 1.0) * (step(0.9968, rnd) * stars * twinkle * (0.45 + h) * 0.65);
            float band = exp(-abs(dir.x * 0.62 + dir.z * 0.45 - 0.15) * 4.2);
            color += vec3(0.012, 0.020, 0.042) * band * stars * smoothstep(0.06, 0.55, h);
          }

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  scene.add(sky);

  const horizon = createHorizonPanorama(options.seed, palette);
  horizon.uniforms.uSunDir.value.copy(computeSunDir(palette));
  scene.add(horizon.group);

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
  sun.shadow.camera.far = 480;
  sun.shadow.camera.left = -78;
  sun.shadow.camera.right = 78;
  sun.shadow.camera.top = 78;
  sun.shadow.camera.bottom = -78;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.42;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(new THREE.Color(palette.skyHorizon), palette.fillIntensity);
  fill.position.set(-220, 150, 240);
  scene.add(fill);

  // Sync tree billboard mood to initial palette.
  options.assets?.setPaletteMood?.(palette.foliageTint ?? '#ffffff', palette.foliageEmissive ?? 0.56);

  // --- materials ---------------------------------------------------------
  const roadTexture = createRoadTexture(palette, options.assets?.textures?.asphalt ?? null);
  const roadMaterial = new THREE.MeshStandardMaterial({
    map: roadTexture,
    color: 0xeaeef5,
    roughness: 0.76,
    metalness: 0.03,
  });

  const terrainMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0,
    vertexColors: true,
  });

  const groundNormal = createGroundNormalMap(256, 2.0);
  groundNormal.repeat.set(1, 1);
  terrainMaterial.normalMap = groundNormal;
  terrainMaterial.normalScale = new THREE.Vector2(0.72, 0.72);

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

  applyProceduralTerrainShader(terrainMaterial);

  const collisions = createCollisionWorld();

  /** @type {Record<string, any>} */
  const impostors = {};
  const getImpostor = (key) => {
    if (impostors[key]) return impostors[key];
    if (!options.assets || !options.renderer) return null;
    const impostor = options.assets.impostor(options.renderer, key, { size: 256 });
    if (impostor) impostors[key] = impostor;
    return impostor;
  };
  const getAtlas = () => {
    if (!options.assets || !options.renderer) return null;
    return options.assets.vegetationAtlas?.(options.renderer, VEGETATION_KEYS) ?? null;
  };

  const water = createWaterMaterial({
    fog: palette.fog,
    sky: palette.skyHorizon,
    deep: palette.waterDeep ?? '#06263d',
    shallow: palette.waterShallow ?? '#167a8a',
    sun: palette.sun,
    sunDirection: computeSunDir(palette),
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
    getAtlas,
    waterMaterial: water.material,
    collisions,
  });

  const chunks = createChunkManager({
    profile,
    scene,
    assets: options.assets,
    seed: options.seed,
    roadMaterial,
    terrainMaterial,
    collisions,
    groundHeight: (s, lateral) => terrain.sampleHeight(s, lateral),
    groundCell: (s, lateral) => terrain.sampleCell(s, lateral),
  });

  return {
    scene,
    chunks,
    terrain,
    collisions,
    palette,
    sun,
    terrainMaterial,
    roadMaterial,
    waterMaterial: water.material,
    /**
     * Change time-of-day / weather mood live without rebuilding geometry.
     * Accepts preset names ('alpine', 'golden', 'midnight', 'sunset', 'night') or partial objects.
     * @param {any} next
     */
    setPalette(next) {
      Object.assign(palette, resolvePalette(next));
      const sDir = computeSunDir(palette);

      const fog = scene.fog;
      fog.color = new THREE.Color(palette.fog);
      fog.near = palette.fogStart;
      fog.far = palette.fogEnd;
      scene.background = new THREE.Color(palette.fog);

      skyUniforms.topColor.value = new THREE.Color(palette.skyTop);
      skyUniforms.horizonColor.value = new THREE.Color(palette.skyHorizon);
      skyUniforms.groundColor.value = new THREE.Color(palette.skyGround);
      skyUniforms.sunColor.value = new THREE.Color(palette.sun);
      skyUniforms.sunDirection.value.copy(sDir);
      skyUniforms.stars.value = palette.starAlpha;
      skyUniforms.cloudAmount.value = palette.cloud;

      horizon.uniforms.uFogColor.value = new THREE.Color(palette.fog);
      horizon.uniforms.uNearColor.value = new THREE.Color(palette.horizonNear ?? '#7f9fc2');
      horizon.uniforms.uFarColor.value = new THREE.Color(palette.horizonFar ?? '#9dbbd9');
      horizon.uniforms.uSnowColor.value = new THREE.Color(palette.horizonSnow ?? '#eef6ff');
      horizon.uniforms.uSunColor.value = new THREE.Color(palette.sun);
      horizon.uniforms.uSunDir.value.copy(sDir);

      water.uniforms.uDeep.value = new THREE.Color(palette.waterDeep ?? '#12405e');
      water.uniforms.uShallow.value = new THREE.Color(palette.waterShallow ?? '#2d93a3');
      water.uniforms.uSky.value = new THREE.Color(palette.skyHorizon);
      water.uniforms.uSun.value = new THREE.Color(palette.sun);
      water.uniforms.uSunDirection.value.copy(sDir);
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

      options.assets?.setPaletteMood?.(
        palette.foliageTint ?? '#ffffff',
        palette.foliageEmissive ?? 0.56,
      );
    },
    /**
     * @param {number} playerS
     * @param {number} playerX
     * @param {number} playerZ
     * @param {number} [elapsed]
     */
    update(playerS, playerX, playerZ, elapsed = 0) {
      const refined = terrain.update(playerS);
      if (refined) chunks.rebuildAll(playerS);
      else chunks.update(playerS);

      water.update(elapsed);
      const baseRoadY = roadHeight(profile, playerZ);
      sky.position.set(playerX, 0, playerZ);
      horizon.group.position.set(playerX, baseRoadY, playerZ);
      skyUniforms.time.value = elapsed;

      const sunDistance = 240;
      sun.position.set(
        playerX + sunDistance * (palette.sunX * 2 - 1) * 0.85,
        baseRoadY + sunDistance * (palette.sunY * 1.65 + 0.22),
        playerZ - sunDistance * 0.58,
      );
      sun.target.position.set(playerX, baseRoadY, playerZ);
      sun.target.updateMatrixWorld();
      options.assets?.tick?.(elapsed);
    },
    dispose() {
      chunks.dispose();
      terrain.dispose();
      water.dispose();
      horizon.dispose();
      groundNormal.dispose();
      roadTexture.dispose();
      roadMaterial.dispose();
      terrainMaterial.dispose();
    },
  };
}
