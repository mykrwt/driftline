/**
 * Water.
 *
 * The valley floor is not always above the road: in the low parts the ground
 * dips below the water line and a lake appears. The surface is a ribbon that
 * follows the road, the same way the terrain does, and the parts that are
 * above the water are simply not drawn.
 *
 * The shader is cheap on purpose: two scrolling wave layers, a fresnel mix
 * between the deep colour and the sky, and a sun highlight.
 */

import * as THREE from '../../vendor/three/three.module.js';

/** How far below the road the water sits. */
export const WATER_DROP = 9;

/**
 * @param {{ fog?: string, sky?: string, deep?: string, sun?: string, sunDirection?: THREE.Vector3 }} palette
 */
export function createWaterMaterial(palette) {
  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(palette.deep ?? '#1d4f6b') },
    uShallow: { value: new THREE.Color(palette.shallow ?? '#3f8fa8') },
    uSky: { value: new THREE.Color(palette.sky ?? '#a9cdec') },
    uSun: { value: new THREE.Color(palette.sun ?? '#fff3d2') },
    uSunDirection: { value: palette.sunDirection ?? new THREE.Vector3(0.4, 0.6, -0.5).normalize() },
    uFogColor: { value: new THREE.Color(palette.fog ?? '#b3d1ea') },
    uFogNear: { value: 200 },
    uFogFar: { value: 1000 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // The surface lies within a few centimetres of the land on the shallow
    // shelf around a lake, and two coplanar surfaces fight for the depth
    // buffer: the lake came out covered in fine stripes. Pulling the water
    // towards the camera fixes that without moving the shoreline.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    vertexShader: `
      attribute float aDepth;
      varying float vDepth;
      varying vec3 vWorld;
      varying vec3 vView;
      uniform float uTime;
      void main() {
        vDepth = aDepth;
        vec3 pos = position;
        // The waves are small, they only have to catch the light.
        float wave = sin(pos.x * 0.35 + uTime * 1.1) * 0.05
                   + sin(pos.z * 0.27 - uTime * 0.8) * 0.05
                   + sin((pos.x + pos.z) * 0.11 + uTime * 0.5) * 0.04;
        pos.y += wave * smoothstep(0.0, 1.5, aDepth);
        vec4 world = modelMatrix * vec4(pos, 1.0);
        vWorld = world.xyz;
        vec4 view = viewMatrix * world;
        vView = view.xyz;
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: `
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uSky;
      uniform vec3 uSun;
      uniform vec3 uSunDirection;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform float uTime;
      varying float vDepth;
      varying vec3 vWorld;
      varying vec3 vView;

      void main() {
        // The shore is faded out instead of cut away. A hard cut on a grid
        // leaves a sawtooth edge around the lake, and the triangles at the
        // waterline show up as stripes across the whole surface.
        float shore = smoothstep(0.0, 2.6, vDepth);
        if (shore <= 0.001) discard;

        // The normal comes from two crossing wave trains. They are gentle on
        // purpose: a sharper set of waves is a moire pattern at a distance,
        // not water.
        float dx = cos(vWorld.x * 0.14 + uTime * 0.7) * 0.035
                 + cos((vWorld.x + vWorld.z) * 0.05 + uTime * 0.35) * 0.015;
        float dz = cos(vWorld.z * 0.11 - uTime * 0.5) * 0.035
                 + cos((vWorld.x + vWorld.z) * 0.05 + uTime * 0.35) * 0.015;
        vec3 normal = normalize(vec3(-dx * 1.6, 1.0, -dz * 1.6));

        vec3 viewDir = normalize(-vView);
        float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);

        // The colour: shallow near the shore, deep in the middle.
        vec3 color = mix(uShallow, uDeep, smoothstep(0.0, 4.0, vDepth));
        color = mix(color, uSky, clamp(fresnel * 0.75, 0.0, 0.6));

        // The sun on the water.
        vec3 halfDir = normalize(viewDir + uSunDirection);
        float spec = pow(max(dot(normal, halfDir), 0.0), 60.0);
        color += uSun * spec * 0.9;

        float alpha = mix(0.5, 0.92, smoothstep(0.0, 2.5, vDepth));
        alpha = max(alpha, fresnel * 0.9);
        alpha *= shore;

        // The fog, so the far end of the lake melts into the horizon.
        float distance = length(vView);
        float fog = smoothstep(uFogNear, uFogFar, distance);
        color = mix(color, uFogColor, fog);

        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  return {
    material,
    uniforms,
    /**
     * @param {number} time
     */
    update(time) {
      uniforms.uTime.value = time;
    },
    dispose() {
      material.dispose();
    },
  };
}
