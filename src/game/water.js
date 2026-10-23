/**
 * Alpine glacial lakes (`s`-streamed basin water planes).
 *
 * Uses true per-vertex metric water depth (`attribute float aDepth` from
 * `terrain.js`) for organic sub-triangle shoreline clipping, crystal-clear
 * turquoise shallows grading into deep sapphire-cobalt basins, multi-directional
 * wind ripples, dark mountain reflection, sun/moon glitter, and lapping foam.
 */

import * as THREE from '../../vendor/three/three.module.js';

export const WATER_DROP = 6.5;

/**
 * @param {{
 *   fog: string,
 *   sky: string,
 *   deep?: string,
 *   shallow?: string,
 *   sun?: string,
 *   sunDirection?: THREE.Vector3,
 * }} palette
 */
export function createWaterMaterial(palette) {
  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(palette.deep ?? '#06263d') },
    uShallow: { value: new THREE.Color(palette.shallow ?? '#167a8a') },
    uSky: { value: new THREE.Color(palette.sky) },
    uSun: { value: new THREE.Color(palette.sun ?? '#fff4d8') },
    uSunDirection: {
      value: (palette.sunDirection ?? new THREE.Vector3(0.4, 0.45, -0.6)).clone().normalize(),
    },
    uFogColor: { value: new THREE.Color(palette.fog) },
    uFogNear: { value: 300 },
    uFogFar: { value: 1380 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
    vertexShader: `
      attribute float aDepth;
      varying float vDepth;
      varying vec3 vWorld;
      varying float vFogDepth;

      void main() {
        vDepth = aDepth;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mv = viewMatrix * world;
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uSky;
      uniform vec3 uSun;
      uniform vec3 uSunDirection;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      varying float vDepth;
      varying vec3 vWorld;
      varying float vFogDepth;

      float whash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      float wnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = whash(i);
        float b = whash(i + vec2(1.0, 0.0));
        float c = whash(i + vec2(0.0, 1.0));
        float d = whash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      float waveHeight(vec2 p, float t) {
        float w = 0.0;
        w += sin(dot(p, vec2(0.85, 0.42)) + t * 1.45) * 0.34;
        w += sin(dot(p, vec2(-0.52, 0.96)) + t * 1.15) * 0.28;
        w += (wnoise(p * 0.62 + vec2(t * 0.26, -t * 0.16)) - 0.5) * 0.72;
        w += (wnoise(p * 1.35 - vec2(t * 0.36, t * 0.24)) - 0.5) * 0.45;
        return w;
      }

      void main() {
        // Organic animated shoreline lapping right where lake depth meets the pebble bank!
        float lap = 0.045 * sin(vWorld.z * 0.22 + uTime * 1.65) + 0.025 * sin(vWorld.x * 0.31 - uTime * 1.1);
        float effDepth = vDepth + lap;
        if (effDepth < 0.015) discard;

        vec2 p = vWorld.xz;
        float distFade = 1.0 - smoothstep(95.0, 620.0, vFogDepth);
        float eps = 0.28;
        float h0 = waveHeight(p, uTime);
        float hx = waveHeight(p + vec2(eps, 0.0), uTime);
        float hz = waveHeight(p + vec2(0.0, eps), uTime);

        vec3 normal = normalize(vec3(
          -(hx - h0) / eps * 0.36 * distFade,
          1.0,
          -(hz - h0) / eps * 0.36 * distFade
        ));

        vec3 viewDir = normalize(cameraPosition - vWorld);
        float grazing = 1.0 - clamp(viewDir.y, 0.0, 1.0);

        // True metric optical absorption: turquoise glacier shallows -> deep cobalt basin!
        float depthNorm = smoothstep(0.18, 4.8, effDepth);
        vec3 base = mix(uShallow, uDeep, depthNorm);

        // Silky subtle wind ripples around the optical depth colour (zero egg-carton speckle!).
        float crest = smoothstep(-0.45, 0.45, h0) * distFade;
        float chopStrength = mix(0.035, 0.12, pow(grazing, 1.5));
        base *= mix(1.0 - chopStrength, 1.0 + chopStrength, crest);

        // Smooth dark alpine mountain reflection band across deep water.
        float mtnBand = smoothstep(3.6, 6.6, effDepth + wnoise(vec2(vWorld.z * 0.014, 2.7)) * 1.4);
        base = mix(base, uDeep * 0.56 + uSky * 0.03, mtnBand * 0.40);

        // Pure physical Fresnel reflection from perturbed surface normal!
        float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 4.2);
        float waveSky = clamp(fresnel * 0.34, 0.02, 0.26);
        vec3 color = mix(base, uSky * 0.58, waveSky);

        // True normal-driven sun / moon specular glitter along the reflection path!
        vec3 sunDir = normalize(uSunDirection);
        vec3 halfVec = normalize(sunDir + viewDir);
        float specTight = pow(max(dot(normal, halfVec), 0.0), 160.0);
        float specBroad = pow(max(dot(normal, halfVec), 0.0), 18.0);
        float skyLum = clamp(dot(uSky, vec3(0.299, 0.587, 0.114)) * 1.4, 0.16, 1.0);
        color += uSun * (specTight * 2.0 * distFade + specBroad * 0.16 * skyLum);

        // Delicate white shoreline surf foam ONLY in the shallowest 0.02..0.34m rim!
        float foam = (1.0 - smoothstep(0.02, 0.34, effDepth)) * (0.35 + 0.35 * skyLum);
        color = mix(color, mix(vec3(0.76, 0.86, 0.92) * skyLum, uSun * 0.85, 0.25), foam);

        float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
        color = mix(color, uFogColor, fogFactor);

        float alpha = mix(0.45, 0.985, smoothstep(0.02, 0.85, effDepth));
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  return {
    material,
    uniforms,
    /** @param {number} elapsed */
    update(elapsed) {
      uniforms.uTime.value = elapsed;
    },
    dispose() {
      material.dispose();
    },
  };
}
