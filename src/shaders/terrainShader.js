/**
 * Procedural multi-biome & triplanar alpine terrain shader.
 *
 * Keeps CPU & GPU geometry 100% identical at default `uDetailAmp = 0` so tires,
 * guardrails, rocks, and trees always touch the exact drawn surface, while
 * giving every pixel world-space triplanar cliff strata, fracture normals,
 * scree couloirs, gravel shoulders, wildflower meadows, wet lakeshores, and
 * high-alpine snowfields without UV stretching or texture tiling.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { SIMPLEX_GLSL } from './terrainDetail.js';

export const TERRAIN_GLSL_COMMON = /* glsl */ `
// Precision-safe hash & value noise (never degrades far down the road).
float thash21(vec2 p) {
  vec2 q = mod(p, 2048.0);
  vec3 p3 = fract(vec3(q.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float tnoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = thash21(i);
  float b = thash21(i + vec2(1.0, 0.0));
  float c = thash21(i + vec2(0.0, 1.0));
  float d = thash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float tfbm3(vec2 p) {
  float v = 0.0;
  v += 0.5000 * tnoise2(p); p = mat2(1.62, 1.21, -1.21, 1.62) * p;
  v += 0.2500 * tnoise2(p); p = mat2(1.62, 1.21, -1.21, 1.62) * p;
  v += 0.1250 * tnoise2(p);
  return v / 0.875;
}

float tridged3(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    float n = 1.0 - abs(tnoise2(p) * 2.0 - 1.0);
    v += n * n * amp;
    p = mat2(1.71, 1.14, -1.14, 1.71) * p;
    amp *= 0.5;
  }
  return v / 0.875;
}
`;

/**
 * Enhance a MeshStandardMaterial with multi-biome world-space procedural &
 * triplanar terrain shading and micro-normal relief.
 *
 * Expects per-vertex `attribute vec4 aTerrain;` on terrain meshes:
 *   x = distance from road edge (metres)
 *   y = altitude above road level (metres)
 *   z = signed grid concavity (+ = hollow/gully, - = spur/ridge)
 *   w = signed height above local water plane (metres; <= 0 means underwater)
 *
 * @param {THREE.MeshStandardMaterial} material
 * @param {{ detailAmp?: number }} [options]
 */
export function applyProceduralTerrainShader(material, options = {}) {
  const uniforms = {
    uDetailAmp: { value: options.detailAmp ?? 0 },
    uSnowBoost: { value: 1.0 },
    uWetTint: { value: new THREE.Color('#3b3932') },
    uRockTint: { value: new THREE.Color('#7d828c') },
    uRockWarm: { value: new THREE.Color('#9c8e7b') },
    uScreeTint: { value: new THREE.Color('#a8a59c') },
    uSnowTint: { value: new THREE.Color('#eef4fc') },
  };

  material.userData.terrainUniforms = uniforms;
  material.userData.detail = uniforms.uDetailAmp;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        ${SIMPLEX_GLSL}
        attribute vec4 aTerrain;
        uniform float uDetailAmp;
        varying vec3 vTerrainWorld;
        varying vec3 vTerrainNormal;
        varying vec4 vTerrainData;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTerrainData = aTerrain;
        vTerrainNormal = normalize(mat3(modelMatrix) * objectNormal);
        {
          vec3 wp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
          if (uDetailAmp > 0.001) {
            float d = 0.0;
            float amp = 1.0;
            float freq = 0.038;
            vec2 sp = mod(wp0.xz, 578.0);
            for (int i = 0; i < 3; i++) {
              d += snoise(sp * freq) * amp;
              amp *= 0.5;
              freq *= 2.13;
            }
            float edgeSafe = smoothstep(1.5, 9.0, aTerrain.x);
            transformed.y += d * uDetailAmp * edgeSafe;
          }
          vTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        }`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${TERRAIN_GLSL_COMMON}
        uniform vec3 uWetTint;
        uniform vec3 uRockTint;
        uniform vec3 uRockWarm;
        uniform vec3 uScreeTint;
        uniform vec3 uSnowTint;
        uniform float uSnowBoost;
        varying vec3 vTerrainWorld;
        varying vec3 vTerrainNormal;
        varying vec4 vTerrainData;
        float vMicroHeight;
        float vRoughnessMod;
        float vCavityAO;`,
      )
      .replace(
        '#include <map_fragment>',
        `
        {
          vec3 wp = vTerrainWorld;
          vec3 wn = normalize(vTerrainNormal);
          float distRoad = vTerrainData.x;
          float alt = vTerrainData.y;
          float concavity = vTerrainData.z;
          float aboveWater = vTerrainData.w;
          float viewDist = length(vViewPosition);

          // Anti-shimmer fade weights by viewing distance.
          float nearFade = 1.0 - smoothstep(28.0, 140.0, viewDist);
          float midFade  = 1.0 - smoothstep(85.0, 420.0, viewDist);
          float farFade  = 1.0 - smoothstep(260.0, 950.0, viewDist);

          // True geometric slope: 0 = flat, 1 = vertical cliff.
          float upness = clamp(wn.y, 0.0, 1.0);
          float cliffMask = smoothstep(0.24, 0.62, 1.0 - upness);
          float steepRock = smoothstep(0.16, 0.48, 1.0 - upness);

          // Triplanar blend weights for steep rock faces (zero UV stretching!).
          vec3 triW = pow(abs(wn), vec3(4.0));
          triW /= max(triW.x + triW.y + triW.z, 0.0001);

          // World-space multi-scale coordinates.
          vec2 pMacro = wp.xz * 0.014;
          vec2 pMid   = wp.xz * 0.075;
          vec2 pFine  = wp.xz * 0.42;

          float macroVar = tfbm3(pMacro);
          float midVar   = tfbm3(pMid);
          float fineVar  = tnoise2(pFine);

          // --- 1. Photographic dual-scale anti-tiled detail -----------------
          vec3 photoDetail = vec3(1.0);
          #ifdef USE_MAP
            vec2 uvGroundA = wp.xz * 0.145;
            vec2 uvGroundB = mat2(0.80, -0.60, 0.60, 0.80) * (wp.xz * 0.033);
            vec3 texPlanar = mix(
              texture2D(map, uvGroundB).rgb,
              texture2D(map, uvGroundA).rgb,
              0.55 * nearFade + 0.2
            );
            // Triplanar rock sample on steep cliff walls so cliffs NEVER stretch!
            vec3 texX = texture2D(map, wp.zy * 0.085).rgb;
            vec3 texZ = texture2D(map, wp.xy * 0.085).rgb;
            vec3 texTri = texX * triW.x + texPlanar * triW.y + texZ * triW.z;
            vec3 texCombined = mix(texPlanar, texTri, cliffMask);
            photoDetail = mix(vec3(1.0), texCombined * 3.15, 0.68 * midFade + 0.16);
          #endif

          // Base colour starts from rich biome vertex colours + anti-tiled photo detail.
          vec3 col = diffuseColor.rgb * photoDetail;

          // --- 2. Lush alpine meadow micro-variation & wildflower flecks -----
          float grassZone = (1.0 - steepRock) * smoothstep(1.2, 6.5, distRoad) * smoothstep(-0.3, 1.6, aboveWater);
          // Sun-warmed fescue vs lush clover patches.
          vec3 lushTurf = vec3(0.115, 0.245, 0.072);
          vec3 warmFescue = vec3(0.285, 0.275, 0.105);
          col = mix(col, col * 0.72 + lushTurf * 0.55, grassZone * smoothstep(0.45, 0.82, midVar) * 0.45 * farFade);
          col = mix(col, col * 0.78 + warmFescue * 0.48, grassZone * smoothstep(0.58, 0.9, macroVar) * 0.36 * farFade);

          // Subtle wildflowers scattered in sunlit low-altitude pastures up close.
          float flowerField = smoothstep(0.55, 0.85, macroVar) * (1.0 - smoothstep(45.0, 95.0, alt));
          float flowerDot = smoothstep(0.84, 0.95, tnoise2(wp.xz * 1.65));
          vec3 flowerCol = mix(vec3(0.95, 0.82, 0.18), vec3(0.92, 0.90, 0.96), step(0.5, thash21(floor(wp.xz * 1.65))));
          col = mix(col, flowerCol, grassZone * flowerField * flowerDot * nearFade * 0.55);

          // --- 3. Geological dipping cliff strata, crags & scree couloirs ----
          // Domain-warped granitic/sedimentary rock ledges so bands never look like smooth horizontal stripes!
          float strataWarp = macroVar * 13.5 + midVar * 4.8;
          float dip = wp.y * 0.28 + wp.x * 0.045 - wp.z * 0.032 + strataWarp;
          float bandMajor = sin(dip * 1.65);
          float bandMinor = sin(dip * 5.4 + midVar * 3.8);
          float strataLedge = smoothstep(-0.32, 0.52, bandMajor * 0.62 + bandMinor * 0.38);

          // Triplanar rock fracture network on steep faces.
          float fracX = tridged3(wp.zy * vec2(0.095, 0.068));
          float fracZ = tridged3(wp.xy * vec2(0.095, 0.068));
          float fracture = fracX * (triW.x / max(triW.x + triW.z, 0.001))
                         + fracZ * (triW.z / max(triW.x + triW.z, 0.001));

          float rockPresence = clamp(steepRock + smoothstep(0.48, 0.78, macroVar) * smoothstep(14.0, 50.0, alt) * 0.78, 0.0, 1.0);
          vec3 rockBase = mix(uRockTint * 0.34, uRockWarm * 0.50, strataLedge);
          rockBase *= mix(0.58, 1.32, fracture);
          // Dark vertical water-seep streaks in cliff gullies.
          float seep = smoothstep(0.15, 0.65, concavity) * cliffMask;
          rockBase *= mix(1.0, 0.52, seep * 0.75);
          col = mix(col, rockBase * photoDetail * 1.25, rockPresence * (0.68 * farFade + 0.24));

          // Pale limestone/granite scree & talus cones collecting in gullies & below cliffs.
          float screeMask = clamp(
            smoothstep(0.12, 0.55, concavity) * smoothstep(12.0, 55.0, alt) * (1.0 - cliffMask * 0.65),
            0.0,
            1.0
          );
          float pebble = tnoise2(wp.xz * 1.15);
          vec3 screeCol = uScreeTint * (0.34 + pebble * 0.22 * nearFade + midVar * 0.16);
          col = mix(col, screeCol, screeMask * 0.62 * farFade);

          // --- 4. Engineered road gravel shoulder & drainage cut -------------
          float gravelBand = (1.0 - smoothstep(0.35, 3.1, distRoad)) * (1.0 - cliffMask * 0.4);
          float grit = tnoise2(wp.xz * 2.6) * 0.5 + tnoise2(wp.xz * 0.75) * 0.5;
          vec3 shoulderCol = vec3(0.245, 0.232, 0.208) * (0.82 + grit * 0.45 * nearFade);
          shoulderCol *= mix(0.74, 1.05, smoothstep(0.0, 0.9, distRoad));
          col = mix(col, shoulderCol, gravelBand * 0.86);

          // --- 5. Natural wet pebble/sand lakeshore & submerged bed ----------
          float shoreZone = 1.0 - smoothstep(-2.5, 2.2, aboveWater);
          float wetRim = (1.0 - smoothstep(-0.35, 0.85, aboveWater)) * smoothstep(-3.0, -0.8, aboveWater);
          vec3 shoreSand = vec3(0.225, 0.208, 0.176) * (0.80 + pebble * 0.42 * nearFade);
          col = mix(col, shoreSand, shoreZone * 0.78);
          col *= mix(1.0, 0.58, wetRim);

          // --- 6. High alpine snowfields, summit cornices & gully névé -------
          float snowLine = 92.0 - concavity * 48.0 - macroVar * 24.0;
          float snowHold = 1.0 - smoothstep(0.42, 0.78, 1.0 - upness - concavity * 0.24);
          float snowAmt = (smoothstep(snowLine, snowLine + 40.0, alt) * snowHold
                         + smoothstep(138.0, 190.0, alt) * 0.42) * uSnowBoost;
          vec3 snowCol = uSnowTint * (0.84 + 0.13 * midVar + 0.05 * fineVar * nearFade);
          col = mix(col, snowCol, clamp(snowAmt, 0.0, 0.96));

          // --- 7. Micro-height scalar field for crisp screen-space normals ---
          float rockRelief = (strataLedge * 0.55 + fracture * 0.75) * rockPresence;
          float turfRelief = (midVar * 0.35 + fineVar * 0.22) * grassZone;
          float gritRelief = (grit * 0.42) * max(gravelBand, shoreZone * 0.7);
          vMicroHeight = (rockRelief * 0.85 * midFade + turfRelief * 0.28 * nearFade + gritRelief * 0.32 * nearFade)
                       * (1.0 - clamp(snowAmt, 0.0, 1.0) * 0.65);

          // Dynamic surface roughness: wet shoreline gleams, snow softly glints, grass stays matte.
          vRoughnessMod = mix(0.95, 0.84, rockPresence);
          vRoughnessMod = mix(vRoughnessMod, 0.68, clamp(snowAmt, 0.0, 1.0));
          vRoughnessMod = mix(vRoughnessMod, 0.34, wetRim);

          // Cavity AO: gullies & cliff bases hold cool sky shadow, ridges pop cleanly.
          vCavityAO = clamp(1.0 - concavity * 0.34, 0.62, 1.12);

          diffuseColor.rgb = col;
        }
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * vRoughnessMod, 0.18, 1.0);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // Analytic screen-space bump derivatives from vMicroHeight (clamped to never shimmer).
          vec3 dpdx = dFdx(vViewPosition);
          vec3 dpdy = dFdy(vViewPosition);
          float dhdx = clamp(dFdx(vMicroHeight), -0.35, 0.35);
          float dhdy = clamp(dFdy(vMicroHeight), -0.35, 0.35);
          vec3 r1 = cross(dpdy, normal);
          vec3 r2 = cross(normal, dpdx);
          float det = dot(dpdx, r1);
          if (abs(det) > 1e-6) {
            vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
            normal = normalize(abs(det) * normal - grad * 1.35);
          }
        }`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= vCavityAO;`,
      );
  };

  material.customProgramCacheKey = () => 'driftline-procedural-terrain-v2';
  material.needsUpdate = true;
  return uniforms;
}
