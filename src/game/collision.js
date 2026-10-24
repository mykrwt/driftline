/**
 * Roadside solid collision system (guardrails, boulders, lamp posts).
 *
 * Design rules:
 *   1. Continuous curved safety guardrails are represented as connected
 *      oriented line segments whose normal `(nx, nz)` always points back
 *      towards the road corridor — cars NEVER ghost or tunnel through rails,
 *      even at full boost speed.
 *   2. Glancing guardrail hits slide smoothly along the steel beam while
 *      straightening the car gently and emitting spark contact telemetry.
 *   3. Solid boulders (`rock`) and steel lamp posts (`post`) use exact 2D
 *      oriented-bounding-box (car hull) vs circle collision with realistic
 *      off-centre yaw impulse.
 *   4. Trees, bushes, and grass are intentionally NEVER added here so off-road
 *      meadow excursions pass cleanly through foliage without snagging.
 */

import { clamp } from '../core/math.js';

/**
 * @typedef {object} RailSegment
 * @property {number} ax
 * @property {number} az
 * @property {number} bx
 * @property {number} bz
 * @property {number} nx      unit normal X pointing INWARD toward the road
 * @property {number} nz      unit normal Z pointing INWARD toward the road
 * @property {number} minX
 * @property {number} maxX
 * @property {number} minZ
 * @property {number} maxZ
 * @property {number} yTop
 */

/**
 * @typedef {object} SolidObstacle
 * @property {'rock' | 'post'} kind
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} radius
 * @property {number} yTop
 */

/**
 * @typedef {object} CollisionEvent
 * @property {'guardrail' | 'rock' | 'post'} kind
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} nx
 * @property {number} nz
 * @property {number} normalSpeed
 * @property {number} slideSpeed
 */

export function createCollisionWorld() {
  /** @type {Map<string | number, { rails: RailSegment[], obstacles: SolidObstacle[] }>} */
  const groups = new Map();

  function ensureGroup(key) {
    let g = groups.get(key);
    if (!g) {
      g = { rails: [], obstacles: [] };
      groups.set(key, g);
    }
    return g;
  }

  return {
    /**
     * Remove all colliders belonging to a chunk key.
     * @param {string | number} key
     */
    clearGroup(key) {
      groups.delete(key);
    },

    clearAll() {
      groups.clear();
    },

    /**
     * Register a continuous guardrail polyline.
     * Each point is `{ x, y, z, roadX, roadZ }` so the inward road-facing
     * unit normal is guaranteed unambiguous around any curve.
     *
     * @param {string | number} key
     * @param {{ x: number, y: number, z: number, roadX: number, roadZ: number }[]} points
     * @param {number} [railHeight]
     */
    addGuardrailRun(key, points, railHeight = 0.92) {
      if (!points || points.length < 2) return;
      const bucket = ensureGroup(key);
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        let nx = -dz / len;
        let nz = dx / len;
        const midX = (a.x + b.x) * 0.5;
        const midZ = (a.z + b.z) * 0.5;
        const toRoadX = (a.roadX + b.roadX) * 0.5 - midX;
        const toRoadZ = (a.roadZ + b.roadZ) * 0.5 - midZ;
        if (nx * toRoadX + nz * toRoadZ < 0) {
          nx = -nx;
          nz = -nz;
        }
        bucket.rails.push({
          ax: a.x,
          az: a.z,
          bx: b.x,
          bz: b.z,
          nx,
          nz,
          minX: Math.min(a.x, b.x) - 3.5,
          maxX: Math.max(a.x, b.x) + 3.5,
          minZ: Math.min(a.z, b.z) - 3.5,
          maxZ: Math.max(a.z, b.z) + 3.5,
          yTop: Math.max(a.y, b.y) + railHeight,
        });
      }
    },

    /**
     * Register a solid non-tree obstacle (`'rock'` or `'post'`).
     *
     * @param {string | number} key
     * @param {'rock' | 'post'} kind
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} radius
     * @param {number} [height]
     */
    addObstacle(key, kind, x, y, z, radius, height = 1.6) {
      if (kind !== 'rock' && kind !== 'post') return;
      ensureGroup(key).obstacles.push({
        kind,
        x,
        y,
        z,
        radius,
        yTop: y + height,
      });
    },

    /**
     * Resolve vehicle chassis collisions against active guardrails & solid obstacles.
     * Designed to run inside the fixed physics sub-step loop with zero heap churn.
     *
     * @param {any} vehicle
     * @param {number} prevX
     * @param {number} prevZ
     * @param {(ev: CollisionEvent) => void} [onHit]
     * @returns {boolean} true if any collision occurred this step
     */
    resolveVehicle(vehicle, prevX, prevZ, onHit) {
      const px = vehicle.position.x;
      const py = vehicle.position.y;
      const pz = vehicle.position.z;

      // Horizontal forward & right basis vectors from vehicle quaternion.
      const q = vehicle.quaternion;
      let fx = 2 * (q.x * q.z + q.w * q.y);
      let fz = 1 - 2 * (q.x * q.x + q.y * q.y);
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl;
      fz /= fl;
      const rx = fz;
      const rz = -fx;

      const halfWidth = (vehicle.spec?.trackWidth ?? 1.6) * 0.56 + 0.1;
      const halfLength = (vehicle.spec?.wheelbase ?? 2.6) * 0.8 + 0.12;
      const beamThickness = 0.22;

      let hitAny = false;
      let corrX = 0;
      let corrZ = 0;

      // 1. Continuous safety guardrails (anti-tunneling + hull perimeter check)
      for (const group of groups.values()) {
        const rails = group.rails;
        for (let i = 0; i < rails.length; i++) {
          const seg = rails[i];
          if (
            px < seg.minX && prevX < seg.minX ||
            px > seg.maxX && prevX > seg.maxX ||
            pz < seg.minZ && prevZ < seg.minZ ||
            pz > seg.maxZ && prevZ > seg.maxZ
          ) {
            continue;
          }
          // Allow cars jumping clean over a low barrier only if >1.1m above rail top.
          if (py - 0.35 > seg.yTop + 0.9) continue;

          const sdx = seg.bx - seg.ax;
          const sdz = seg.bz - seg.az;
          const segLenSq = sdx * sdx + sdz * sdz;

          // Project chassis centre onto segment parameter t in [0, 1].
          const relX = px + corrX - seg.ax;
          const relZ = pz + corrZ - seg.az;
          const t = clamp((relX * sdx + relZ * sdz) / segLenSq, 0, 1);
          const cx = seg.ax + sdx * t;
          const cz = seg.az + sdz * t;

          // Support extent of the oriented car rectangle along inward normal (nx, nz):
          // the furthest outward corner has projection `-extent` relative to chassis centre.
          const extent =
            Math.abs(fx * seg.nx + fz * seg.nz) * halfLength +
            Math.abs(rx * seg.nx + rz * seg.nz) * halfWidth;

          const centreSigned = (px + corrX - cx) * seg.nx + (pz + corrZ - cz) * seg.nz;
          const prevSigned = (prevX - cx) * seg.nx + (prevZ - cz) * seg.nz;

          // Check longitudinal overlap including halfLength margin at segment ends.
          const along = ((px + corrX - seg.ax) * sdx + (pz + corrZ - seg.az) * sdz) / Math.sqrt(segLenSq);
          const segLen = Math.sqrt(segLenSq);
          if (along < -halfLength * 0.65 || along > segLen + halfLength * 0.65) continue;

          // Ignore if car was already deep behind the wrong side of an isolated rail (> 2.6m outside)
          // UNLESS it crossed through from the road side during this step!
          if (prevSigned < -2.6 && centreSigned < -2.6) continue;

          const minAllowed = extent + beamThickness;
          const penetration = minAllowed - centreSigned;
          if (penetration <= 0) continue;

          // Push car cleanly back onto the road side of the steel rail!
          corrX += seg.nx * penetration;
          corrZ += seg.nz * penetration;
          hitAny = true;

          // Velocity response: cancel outward component + slight steel bounce, smooth slide along rail!
          const vn = vehicle.velocity.x * seg.nx + vehicle.velocity.z * seg.nz;
          const tx = -seg.nz;
          const tz = seg.nx;
          const vt = vehicle.velocity.x * tx + vehicle.velocity.z * tz;

          if (vn < 0) {
            const impactSpeed = -vn;
            const restitution = 0.16;
            const dvNormal = impactSpeed * (1 + restitution);
            vehicle.velocity.x += seg.nx * dvNormal;
            vehicle.velocity.z += seg.nz * dvNormal;

            // Gentle wall-scrape friction proportional to impact angle (glancing scrapes barely slow you down!).
            const scrapeLoss = clamp(0.012 + (impactSpeed / (Math.abs(vt) + 4)) * 0.12, 0.01, 0.22);
            vehicle.velocity.x -= tx * vt * scrapeLoss;
            vehicle.velocity.z -= tz * vt * scrapeLoss;

            // Prevent upward launch off rail contact.
            if (vehicle.velocity.y > 1.8) vehicle.velocity.y = 1.8;

            // Gently align chassis yaw toward the rail tangent in direction of travel!
            const dirSign = vt >= 0 ? 1 : -1;
            const goalX = tx * dirSign;
            const goalZ = tz * dirSign;
            const crossYaw = fx * goalZ - fz * goalX;
            vehicle.angularVelocity.y = clamp(
              vehicle.angularVelocity.y * 0.55 - crossYaw * clamp(impactSpeed * 0.16 + 0.8, 0.6, 3.4),
              -4.2,
              4.2,
            );

            // Contact point on the side of the car scraping the W-beam rail.
            const hitX = px + corrX - seg.nx * extent;
            const hitZ = pz + corrZ - seg.nz * extent;
            onHit?.({
              kind: 'guardrail',
              x: hitX,
              y: py + 0.35,
              z: hitZ,
              nx: seg.nx,
              nz: seg.nz,
              normalSpeed: impactSpeed,
              slideSpeed: Math.abs(vt),
            });
          }
        }

        // 2. Solid roadside boulders & steel light posts (exact 2D OBB vs circle)
        const obstacles = group.obstacles;
        for (let i = 0; i < obstacles.length; i++) {
          const obs = obstacles[i];
          const dx = px + corrX - obs.x;
          const dz = pz + corrZ - obs.z;
          const maxReach = halfLength + obs.radius + 0.5;
          if (Math.abs(dx) > maxReach || Math.abs(dz) > maxReach) continue;
          if (py - 0.35 > obs.yTop) continue;

          // Transform circle centre into car local horizontal coordinates (localRight, localFwd).
          const localR = -(dx * rx + dz * rz);
          const localF = -(dx * fx + dz * fz);
          const clampedR = clamp(localR, -halfWidth, halfWidth);
          const clampedF = clamp(localF, -halfLength, halfLength);

          const diffR = localR - clampedR;
          const diffF = localF - clampedF;
          const distSq = diffR * diffR + diffF * diffF;
          if (distSq >= obs.radius * obs.radius) continue;

          const dist = Math.sqrt(distSq);
          let nx;
          let nz;
          let pen;
          if (dist > 1e-4) {
            // Normal points from obstacle out toward car!
            const localNx = -diffR / dist;
            const localNz = -diffF / dist;
            nx = rx * localNx + fx * localNz;
            nz = rz * localNx + fz * localNz;
            pen = obs.radius - dist;
          } else {
            const centerLen = Math.hypot(dx, dz) || 1;
            nx = dx / centerLen;
            nz = dz / centerLen;
            pen = obs.radius + 0.25;
          }

          corrX += nx * pen;
          corrZ += nz * pen;
          hitAny = true;

          const vn = vehicle.velocity.x * nx + vehicle.velocity.z * nz;
          if (vn < 0) {
            const impactSpeed = -vn;
            const restitution = obs.kind === 'post' ? 0.22 : 0.28;
            vehicle.velocity.x += nx * impactSpeed * (1 + restitution);
            vehicle.velocity.z += nz * impactSpeed * (1 + restitution);
            vehicle.velocity.x *= 0.92;
            vehicle.velocity.z *= 0.92;
            if (vehicle.velocity.y > 1.6) vehicle.velocity.y = 1.6;

            // Off-centre lever arm produces realistic corner-clip spin!
            const contactWorldX = px + corrX + rx * clampedR + fx * clampedF;
            const contactWorldZ = pz + corrZ + rz * clampedR + fz * clampedF;
            const armX = contactWorldX - (px + corrX);
            const armZ = contactWorldZ - (pz + corrZ);
            const torqueSign = armX * nz - armZ * nx;
            vehicle.angularVelocity.y = clamp(
              vehicle.angularVelocity.y - torqueSign * clamp(impactSpeed * 0.14, 0.2, 2.8),
              -4.5,
              4.5,
            );

            onHit?.({
              kind: obs.kind,
              x: contactWorldX,
              y: py + 0.3,
              z: contactWorldZ,
              nx,
              nz,
              normalSpeed: impactSpeed,
              slideSpeed: vehicle.speed,
            });
          }
        }
      }

      if (hitAny) {
        vehicle.position.x += corrX;
        vehicle.position.z += corrZ;
        vehicle.speed = vehicle.velocity.length();
      }
      return hitAny;
    },

    get stats() {
      let rails = 0;
      let obstacles = 0;
      for (const g of groups.values()) {
        rails += g.rails.length;
        obstacles += g.obstacles.length;
      }
      return { groups: groups.size, rails, obstacles };
    },
  };
}
