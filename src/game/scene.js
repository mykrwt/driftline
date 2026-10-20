/**
 * Builds the Three.js world for a track: road ribbon, terrain corridor,
 * instanced scenery, sky dome, lights and the start/finish line.
 *
 * Everything is merged or instanced so the whole scene is a handful of draw
 * calls - that is what keeps it smooth on phones.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { createPropGeometry, createRoadTexture, mergeGeometries } from './models.js';
import { sampleTrack, ROAD_HALF_WIDTH, terrainHeightAt } from './track.js';

const CORRIDOR = [150, 96, 58, 32, 17, 9.5];
const CORRIDOR_NEG = [-9.5, -17, -32, -58, -96, -150];

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function smoothstep(value, min, max) {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return t * t * (3 - 2 * t);
}

/**
 * @param {import('./track.js').Track} track
 * @returns {THREE.BufferGeometry}
 */
export function buildRoadGeometry(track) {
  const count = track.segmentCount;
  const positions = new Float32Array(count * 2 * 3);
  const normals = new Float32Array(count * 2 * 3);
  const uvs = new Float32Array(count * 2 * 2);
  const indices = new Uint32Array(count * 6);
  const repeatV = Math.max(1, Math.round(track.length / 12));

  for (let i = 0; i < count; i++) {
    const h = track.heading[i];
    const nx = Math.cos(h);
    const nz = -Math.sin(h);
    const x = track.x[i];
    const z = track.z[i];
    const y = track.y[i];

    const l = i * 6;
    positions[l] = x - nx * ROAD_HALF_WIDTH;
    positions[l + 1] = y;
    positions[l + 2] = z - nz * ROAD_HALF_WIDTH;
    positions[l + 3] = x + nx * ROAD_HALF_WIDTH;
    positions[l + 4] = y;
    positions[l + 5] = z + nz * ROAD_HALF_WIDTH;

    normals[l] = 0;
    normals[l + 1] = 1;
    normals[l + 2] = 0;
    normals[l + 3] = 0;
    normals[l + 4] = 1;
    normals[l + 5] = 0;

    const u = i * 4;
    const v = (i / count) * repeatV;
    uvs[u] = 0;
    uvs[u + 1] = v;
    uvs[u + 2] = 1;
    uvs[u + 3] = v;

    const a = i * 2;
    const b = ((i + 1) % count) * 2;
    const o = i * 6;
    indices[o] = a;
    indices[o + 1] = b;
    indices[o + 2] = a + 1;
    indices[o + 3] = b;
    indices[o + 4] = b + 1;
    indices[o + 5] = a + 1;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Terrain that follows the road elevation and melts back to y = 0.
 *
 * @param {import('./track.js').Track} track
 * @returns {THREE.BufferGeometry}
 */
export function buildTerrainGeometry(track) {
  const count = track.segmentCount;
  const columns = [...CORRIDOR_NEG].reverse().concat([0], CORRIDOR);
  const rows = count;
  const positions = new Float32Array(rows * columns.length * 3);
  const normals = new Float32Array(rows * columns.length * 3);
  const uvs = new Float32Array(rows * columns.length * 2);
  const colors = new Float32Array(rows * columns.length * 3);
  const indices = [];

  for (let i = 0; i < rows; i++) {
    const h = track.heading[i];
    const nx = Math.cos(h);
    const nz = -Math.sin(h);
    for (let c = 0; c < columns.length; c++) {
      const lateral = columns[c];
      const height = terrainHeightAt(track, i * track.segmentLength, lateral);

      const index = (i * columns.length + c) * 3;
      positions[index] = track.x[i] + nx * lateral;
      positions[index + 1] = height;
      positions[index + 2] = track.z[i] + nz * lateral;
      normals[index] = 0;
      normals[index + 1] = 1;
      normals[index + 2] = 0;
      const uvIndex = (i * columns.length + c) * 2;
      uvs[uvIndex] = (track.x[i] + nx * lateral) * 0.02;
      uvs[uvIndex + 1] = (track.z[i] + nz * lateral) * 0.02;

      // Cheap colour variation so the grass is not a flat slab.
      const shade =
        0.5 +
        Math.sin(track.x[i] * 0.06 + lateral * 0.11) * 0.26 +
        Math.cos(track.z[i] * 0.05 - lateral * 0.09) * 0.22 +
        Math.sin(i * 0.21) * 0.1;
      const colourIndex = (i * columns.length + c) * 3;
      colors[colourIndex] = Math.max(0, Math.min(1, shade + 0.42));
      colors[colourIndex + 1] = Math.max(0, Math.min(1, shade + 0.5));
      colors[colourIndex + 2] = Math.max(0, Math.min(1, shade + 0.44));
    }
  }

  for (let i = 0; i < rows; i++) {
    const next = (i + 1) % rows;
    for (let c = 0; c < columns.length - 1; c++) {
      const a = i * columns.length + c;
      const b = next * columns.length + c;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * @param {import('./track.js').TrackPalette} palette
 * @returns {THREE.CanvasTexture}
 */
function createStartTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cells = 4;
  const cell = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f2f4f8' : '#1b1d24';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Sky dome with a gradient, sun and optional stars.
 *
 * @param {import('./track.js').TrackPalette} palette
 * @returns {THREE.Mesh}
 */
function createSky(palette) {
  const geometry = new THREE.SphereGeometry(2400, 24, 16);
  const material = new THREE.ShaderMaterial({
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
          float star = step(0.9975, rnd);
          float twinkle = 0.6 + 0.4 * hash(cell + 1.0);
          color += vec3(star * twinkle * stars * (0.6 + h));
        }
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}

/**
 * Distant mountains so the horizon is not empty.
 * @param {import('./track.js').Track} track
 * @param {import('./track.js').TrackPalette} palette
 * @returns {THREE.Mesh}
 */
function createMountains(track, palette) {
  const parts = [];
  const cx = (track.bounds.minX + track.bounds.maxX) / 2;
  const cz = (track.bounds.minZ + track.bounds.maxZ) / 2;
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 + 0.3;
    const radius = 1700 + ((i * 137) % 700);
    const height = 90 + ((i * 91) % 190);
    const cone = new THREE.ConeGeometry(150 + ((i * 53) % 200), height, 6);
    cone.translate(cx + Math.cos(angle) * radius, height / 2 - 25, cz + Math.sin(angle) * radius);
    parts.push(cone);
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  const mesh = new THREE.Mesh(
    merged,
    new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.fog).lerp(new THREE.Color(palette.skyTop), 0.72) }),
  );
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Which downloaded model to use for each scenery type.
 * @type {Record<string, string[]>}
 */
export const PROP_ASSET_KEYS = {
  tree: ['tree', 'treeOak'],
  pine: ['treePine'],
  palm: ['treePalm'],
  bush: ['bush'],
  rock: ['rock', 'rockSmall'],
  sign: ['sign'],
  billboard: ['billboard'],
  lamp: ['lightPost'],
  building: ['grandStand'],
  gantry: ['gantry'],
  cone: ['cone'],
  barrier: ['barrier', 'barrierWhite'],
  stump: ['stump'],
  log: ['log'],
  cactus: ['cactus'],
  grass: ['grass'],
};

/**
 * Build the full world for a track.
 *
 * @param {import('./track.js').Track} track
 * @param {{ props?: boolean, assets?: any }} [options]
 */
export function buildWorld(track, options = {}) {
  const scene = new THREE.Scene();
  const palette = track.palette;
  const showProps = options.props !== false;
  const assets = options.assets ?? null;

  scene.fog = new THREE.Fog(new THREE.Color(palette.fog), palette.fogStart, palette.fogEnd);
  scene.background = new THREE.Color(palette.fog);

  const sky = createSky(palette);
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(new THREE.Color(palette.skyBottom), new THREE.Color(palette.grass), 1.75);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(new THREE.Color(palette.sun), 1.7);
  sun.position.set(palette.sunX * 400, 260, -180);
  scene.add(sun);

  // A soft fill light from the opposite side keeps the cars readable.
  const rim = new THREE.DirectionalLight(new THREE.Color(palette.skyBottom), 0.75);
  rim.position.set(-220, 140, 240);
  scene.add(rim);

  // --- road -------------------------------------------------------------
  const roadTexture = createRoadTexture(palette);
  const roadGeometry = buildRoadGeometry(track);
  const roadMaterial = new THREE.MeshStandardMaterial({
    map: roadTexture,
    roughness: 0.92,
    metalness: 0.02,
  });
  const road = new THREE.Mesh(roadGeometry, roadMaterial);
  road.receiveShadow = false;
  scene.add(road);

  // --- terrain ----------------------------------------------------------
  const terrainGeometry = buildTerrainGeometry(track);
  const terrain = new THREE.Mesh(
    terrainGeometry,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.grass),
      roughness: 1,
      metalness: 0,
      vertexColors: true,
    }),
  );
  scene.add(terrain);

  // distant ground so the world does not end abruptly
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000, 1, 1),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.grassAlt), roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.4;
  scene.add(ground);

  scene.add(createMountains(track, palette));

  // --- start / finish line ---------------------------------------------
  const startSample = sampleTrack(track, 0);
  const startLine = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, 3),
    new THREE.MeshBasicMaterial({ map: createStartTexture() }),
  );
  startLine.rotation.x = -Math.PI / 2;
  startLine.rotation.z = -startSample.heading;
  startLine.position.set(startSample.x, startSample.y + 0.03, startSample.z);
  scene.add(startLine);

  // --- scenery ----------------------------------------------------------
  /** @type {THREE.InstancedMesh[]} */
  const propMeshes = [];
  if (showProps) {
    const dummy = new THREE.Object3D();
    /** @type {Map<string, { assetKey: string, group: number, instances: any[] }>} */
    const buckets = new Map();

    for (const prop of track.props) {
      const keys = PROP_ASSET_KEYS[prop.type];
      if (!keys) continue;
      const assetKey = keys[prop.variant % keys.length];
      const asset = assets?.prop?.(assetKey);
      if (!asset) continue;
      const sample = sampleTrack(track, prop.segment * track.segmentLength);
      const nx = Math.cos(sample.heading);
      const nz = -Math.sin(sample.heading);
      const instance = {
        x: sample.x + nx * prop.offset,
        y: sample.y,
        z: sample.z + nz * prop.offset,
        heading: sample.heading + prop.sway * 0.03,
        scale: prop.scale,
      };
      for (let group = 0; group < asset.groups.length; group++) {
        const key = `${assetKey}#${group}`;
        if (!buckets.has(key)) buckets.set(key, { assetKey, group, instances: [] });
        buckets.get(key).instances.push(instance);
      }
    }

    for (const bucket of buckets.values()) {
      const asset = assets.prop(bucket.assetKey);
      const group = asset.groups[bucket.group];
      const mesh = new THREE.InstancedMesh(group.geometry, group.material, bucket.instances.length);
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      bucket.instances.forEach((instance, index) => {
        dummy.position.set(instance.x, instance.y, instance.z);
        dummy.rotation.set(0, instance.heading, 0);
        dummy.scale.setScalar(instance.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.frustumCulled = true;
      scene.add(mesh);
      propMeshes.push(mesh);
    }
  }

  return {
    scene,
    road,
    terrain,
    startLine,
    propMeshes,
    /**
     * Keep the sky and lights centred on the camera so they never clip.
     * @param {THREE.Camera} camera
     */
    follow(camera) {
      sky.position.set(camera.position.x, 0, camera.position.z);
    },
    dispose() {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) {
          object.geometry?.dispose?.();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material?.dispose?.();
        }
      });
      roadTexture.dispose();
    },
  };
}
