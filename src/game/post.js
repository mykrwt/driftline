/**
 * Post processing.
 *
 * The scene is rendered into an offscreen target and then finished with a
 * small chain: a bright pass, a separable blur for the bloom and a final
 * pass that adds the bloom, grades the colour, adds a vignette and a touch
 * of chromatic aberration at the edges of the screen.
 *
 * It is the difference between "a 3D scene" and "a game": the sun blooms,
 * the shadows stay readable and the whole image feels graded.
 */

import * as THREE from '../../vendor/three/three.module.js';

const QUAD_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BRIGHT_FRAGMENT = `
uniform sampler2D tScene;
uniform float threshold;
uniform float knee;
varying vec2 vUv;
void main() {
  vec3 color = texture2D(tScene, vUv).rgb;
  float brightness = max(color.r, max(color.g, color.b));
  // A soft knee keeps the bloom from switching on and off.
  float soft = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 0.0001);
  float contribution = max(soft, brightness - threshold) / max(brightness, 0.0001);
  gl_FragColor = vec4(color * contribution, 1.0);
}
`;

const BLUR_FRAGMENT = `
uniform sampler2D tSource;
uniform vec2 direction;
varying vec2 vUv;
void main() {
  vec4 sum = texture2D(tSource, vUv) * 0.227027;
  sum += texture2D(tSource, vUv + direction * 1.3846153846) * 0.3162162162;
  sum += texture2D(tSource, vUv - direction * 1.3846153846) * 0.3162162162;
  sum += texture2D(tSource, vUv + direction * 3.2307692308) * 0.0702702703;
  sum += texture2D(tSource, vUv - direction * 3.2307692308) * 0.0702702703;
  gl_FragColor = sum;
}
`;

const COMPOSITE_FRAGMENT = `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float bloomStrength;
uniform float vignette;
uniform float saturation;
uniform float contrast;
uniform float speed;
uniform vec2 sunPosition;
uniform float sunVisible;
uniform vec2 resolution;
varying vec2 vUv;

void main() {
  vec2 uv = vUv;
  vec2 centred = uv - 0.5;
  float radius = length(centred);

  // At speed the edges of the screen smear outwards, which reads as velocity
  // without touching the physics.
  vec3 color;
  if (speed > 0.01) {
    float amount = speed * 0.022 * radius * radius;
    color = vec3(0.0);
    for (int i = 0; i < 5; i++) {
      float t = float(i) / 4.0;
      vec2 offset = centred * amount * t;
      float weight = 1.0 - t * 0.6;
      color.r += texture2D(tScene, uv + offset).r * weight;
      color.g += texture2D(tScene, uv + offset).g * weight;
      color.b += texture2D(tScene, uv + offset).b * weight;
    }
    color /= 2.2;
  } else {
    color = texture2D(tScene, uv).rgb;
  }

  // A little chromatic aberration towards the edges of the screen.
  float amount = 0.0016 * radius * radius;
  color.r = mix(color.r, texture2D(tScene, uv + centred * amount).r, 0.5);
  color.b = mix(color.b, texture2D(tScene, uv - centred * amount).b, 0.5);

  vec3 bloom = texture2D(tBloom, uv).rgb;
  color += bloom * bloomStrength;

  // The grade: a little more contrast and saturation.
  color = mix(vec3(dot(color, vec3(0.299, 0.587, 0.114))), color, saturation);
  color = (color - 0.5) * contrast + 0.5;

  // The vignette.
  float vig = smoothstep(0.95, 0.28, radius);
  color *= mix(1.0, vig, vignette);

  // The sun: a glow and a few ghosts of it when it is in front of the camera.
  if (sunVisible > 0.001) {
    vec2 delta = (uv - sunPosition) * vec2(resolution.x / resolution.y, 1.0);
    float d = length(delta);
    float glow = exp(-d * 5.0) * 0.55 + exp(-d * 22.0) * 0.8;
    color += vec3(1.0, 0.92, 0.75) * glow * sunVisible;
    for (int i = 1; i <= 3; i++) {
      float scale = 1.0 + float(i) * 0.55;
      vec2 ghost = sunPosition + (sunPosition - uv) * scale;
      float gd = length((uv - ghost) * vec2(resolution.x / resolution.y, 1.0));
      color += vec3(0.6, 0.75, 1.0) * exp(-gd * 26.0) * 0.16 * sunVisible;
    }
  }

  // Linear to sRGB, because the target is a linear buffer.
  color = max(color, vec3(0.0));
  color = pow(color, vec3(1.0 / 2.2));
  gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * @param {{ width: number, height: number, pixelRatio: number, enabled?: boolean }} options
 */
export function createPost(options) {
  const state = {
    enabled: options.enabled !== false,
    bloom: 0.55,
    vignette: 0.55,
    saturation: 1.12,
    contrast: 1.06,
  };

  const width = Math.max(1, Math.round(options.width * options.pixelRatio));
  const height = Math.max(1, Math.round(options.height * options.pixelRatio));
  const bloomWidth = Math.max(1, Math.round(width / 4));
  const bloomHeight = Math.max(1, Math.round(height / 4));

  const targetOptions = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  };

  const sceneTarget = new THREE.WebGLRenderTarget(width, height, targetOptions);
  const brightTarget = new THREE.WebGLRenderTarget(bloomWidth, bloomHeight, {
    ...targetOptions,
    depthBuffer: false,
  });
  const blurTarget = new THREE.WebGLRenderTarget(bloomWidth, bloomHeight, {
    ...targetOptions,
    depthBuffer: false,
  });

  const quadGeometry = new THREE.PlaneGeometry(2, 2);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const brightMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: sceneTarget.texture },
      threshold: { value: 0.72 },
      knee: { value: 0.28 },
    },
    vertexShader: QUAD_VERTEX,
    fragmentShader: BRIGHT_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });

  const blurMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tSource: { value: brightTarget.texture },
      direction: { value: new THREE.Vector2(1 / bloomWidth, 0) },
    },
    vertexShader: QUAD_VERTEX,
    fragmentShader: BLUR_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });

  const compositeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: sceneTarget.texture },
      tBloom: { value: blurTarget.texture },
      bloomStrength: { value: state.bloom },
      vignette: { value: state.vignette },
      saturation: { value: state.saturation },
      contrast: { value: state.contrast },
      speed: { value: 0 },
      sunPosition: { value: new THREE.Vector2(0.5, 0.9) },
      sunVisible: { value: 0 },
      sunDirection: { value: new THREE.Vector3(0.4, 0.7, -0.5) },
      resolution: { value: new THREE.Vector2(width, height) },
    },
    vertexShader: QUAD_VERTEX,
    fragmentShader: COMPOSITE_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });

  const quad = new THREE.Mesh(quadGeometry, brightMaterial);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} sceneToRender
   * @param {THREE.Camera} cameraToUse
   */
  function render(renderer, sceneToRender, cameraToUse) {
    if (!state.enabled) {
      renderer.setRenderTarget(null);
      renderer.render(sceneToRender, cameraToUse);
      return;
    }

    renderer.setRenderTarget(sceneTarget);
    renderer.clear();
    renderer.render(sceneToRender, cameraToUse);
    const sceneCalls = renderer.info.render.calls;
    const sceneTriangles = renderer.info.render.triangles;

    // Where is the sun on the screen? The camera matrices are up to date now.
    const sun = compositeMaterial.uniforms.sunDirection.value;
    const view = sun.clone().applyMatrix4(cameraToUse.matrixWorldInverse);
    if (view.z < -0.05) {
      const depth = -view.z;
      const tanHalf = Math.tan(((cameraToUse.fov ?? 60) * Math.PI) / 360);
      const ndcX = view.x / depth / (tanHalf * (cameraToUse.aspect ?? 1));
      const ndcY = view.y / depth / tanHalf;
      compositeMaterial.uniforms.sunPosition.value.set(ndcX * 0.5 + 0.5, ndcY * 0.5 + 0.5);
      const inside = Math.abs(ndcX) < 1.35 && Math.abs(ndcY) < 1.35;
      compositeMaterial.uniforms.sunVisible.value = inside ? 1 : 0;
    } else {
      compositeMaterial.uniforms.sunVisible.value = 0;
    }

    // The bright pass.
    quad.material = brightMaterial;
    renderer.setRenderTarget(brightTarget);
    renderer.render(scene, camera);

    // The blur, horizontal then vertical.
    quad.material = blurMaterial;
    blurMaterial.uniforms.tSource.value = brightTarget.texture;
    blurMaterial.uniforms.direction.value.set(1 / bloomWidth, 0);
    renderer.setRenderTarget(blurTarget);
    renderer.render(scene, camera);

    blurMaterial.uniforms.tSource.value = blurTarget.texture;
    blurMaterial.uniforms.direction.value.set(0, 1 / bloomHeight);
    renderer.setRenderTarget(brightTarget);
    renderer.render(scene, camera);

    // The composite.
    quad.material = compositeMaterial;
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    renderer.info.render.calls = sceneCalls;
    renderer.info.render.triangles = sceneTriangles;
  }

  return {
    state,
    render,
    /**
     * @param {number} value 0 = parked, 1 = flat out
     */
    setSpeed(value) {
      compositeMaterial.uniforms.speed.value = value;
    },
    /**
     * Where the sun is on the screen, and how much of it is in view.
     * @param {number} x 0..1
     * @param {number} y 0..1
     * @param {number} visible 0..1
     */
    setSun(x, y, visible) {
      compositeMaterial.uniforms.sunPosition.value.set(x, y);
      compositeMaterial.uniforms.sunVisible.value = visible;
    },
    /**
     * The direction of the sun in world space.
     * @param {THREE.Vector3} direction
     */
    setSunDirection(direction) {
      compositeMaterial.uniforms.sunDirection.value.copy(direction);
    },
    /**
     * @param {number} w @param {number} h @param {number} ratio
     */
    setSize(w, h, ratio) {
      const pw = Math.max(1, Math.round(w * ratio));
      const ph = Math.max(1, Math.round(h * ratio));
      sceneTarget.setSize(pw, ph);
      const bw = Math.max(1, Math.round(pw / 4));
      const bh = Math.max(1, Math.round(ph / 4));
      brightTarget.setSize(bw, bh);
      blurTarget.setSize(bw, bh);
      compositeMaterial.uniforms.resolution.value.set(pw, ph);
    },
    /**
     * @param {boolean} value
     */
    setEnabled(value) {
      state.enabled = value;
    },
    dispose() {
      sceneTarget.dispose();
      brightTarget.dispose();
      blurTarget.dispose();
      quadGeometry.dispose();
      brightMaterial.dispose();
      blurMaterial.dispose();
      compositeMaterial.dispose();
    },
  };
}
