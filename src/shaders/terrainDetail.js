/**
 * GPU terrain detail.
 *
 * The macro shape of the mountains is generated on the CPU (so the physics and
 * the mesh agree exactly). The fine detail - the bumps, the rubble and the
 * erosion channels - is added in the vertex shader with classic 2D simplex
 * noise, which costs nothing and gives the silhouette far more definition.
 *
 * The GLSL below is the well known Ashima Arts / Stefan Gustavson simplex
 * noise implementation (MIT licensed).
 */

export const SIMPLEX_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`;

/**
 * Attach a GPU detail displacement to a terrain material.
 *
 * @param {any} material a THREE.MeshStandardMaterial
 * @param {{ amplitude?: number, frequency?: number, octaves?: number }} [options]
 * @returns {{ uniform: { value: number } }}
 */
export function applyTerrainDetail(material, options = {}) {
  const amplitude = options.amplitude ?? 1.6;
  const frequency = options.frequency ?? 0.035;
  const octaves = options.octaves ?? 3;

  const uniform = { value: amplitude };
  material.userData.detail = uniform;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = uniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `${SIMPLEX_GLSL}\nuniform float uDetail;\nvoid main() {`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
           float d = 0.0;
           float amp = 1.0;
           float freq = ${frequency.toFixed(5)};
           for (int i = 0; i < ${octaves}; i++) {
             d += snoise(wp.xz * freq) * amp;
             amp *= 0.5;
             freq *= 2.13;
           }
           transformed.y += d * uDetail;
         }`,
      );
  };
  material.needsUpdate = true;
  return { uniform };
}
