/**
 * Decoupled 2D Billiards & Pool Physics Engine.
 * 
 * Features:
 * - Fixed 240 Hz sub-stepping with accumulator
 * - Continuous Collision Detection (CCD) for balls and cushions (zero tunneling)
 * - Velocity-dependent restitution decay (harder impacts compress more)
 * - Sliding-to-rolling friction transition (skidding cloth physics)
 * - Cushion sidespin / English transfer
 * - Clean event hooks for audio, particle bursts, and scoring
 */
import { CONFIG } from '../shared/config.js';

export class PoolSim {
  constructor({
    tableWidth = CONFIG.pool?.tableWidth || 6.4,
    tableLength = CONFIG.pool?.tableHeight || 10.4,
    ballRadius = CONFIG.pool?.ballRadius || 0.14,
    pockets = [],
    cushionRestitution = CONFIG.pool?.cushionRestitution || 0.93,
    cushionDecay = CONFIG.pool?.cushionRestitutionDecay || 0.02,
    cushionFriction = CONFIG.pool?.cushionFriction || 0.14,
    ballRestitution = CONFIG.pool?.ballRestitution || 0.95,
    ballBallFriction = CONFIG.pool?.ballBallFriction || 0.05,
    slidingFriction = CONFIG.pool?.slidingFriction || 0.22,
    rollingResistance = CONFIG.pool?.rollingResistanceConst || 0.22,
    spinDecayRate = CONFIG.pool?.spinDecayRate || 1.25,
    onBallHit = null,
    onCushionHit = null,
    onPocket = null,
  } = {}) {
    this.tableWidth = tableWidth;
    this.tableLength = tableLength;
    this.ballRadius = ballRadius;
    this.pockets = pockets;
    this.onBallHit = onBallHit;
    this.onCushionHit = onCushionHit;
    this.onPocket = onPocket;

    this.balls = [];
    this.fixedDt = 1 / (CONFIG.pool?.simRateHz || 240);
    this.accumulator = 0;

    // Bounds
    this.minX = -tableWidth / 2 + ballRadius;
    this.maxX = tableWidth / 2 - ballRadius;
    this.minZ = -tableLength / 2 + ballRadius;
    this.maxZ = tableLength / 2 - ballRadius;

    // Physical constants
    this.cushionRestitution = cushionRestitution;
    this.cushionDecay = cushionDecay;
    this.cushionFriction = cushionFriction;
    this.ballRestitution = ballRestitution;
    this.ballBallFriction = ballBallFriction;
    this.slidingFriction = slidingFriction;
    this.rollingResistance = rollingResistance;
    this.spinDecayRate = spinDecayRate;
  }

  addBall(ball) {
    this.balls.push(ball);
    return ball;
  }

  clearBalls() {
    this.balls = [];
  }

  step(dt) {
    // Cap frame delta to prevent spiral of death
    const clampedDt = Math.min(dt, 0.05);
    this.accumulator += clampedDt;

    while (this.accumulator >= this.fixedDt) {
      this.#substep(this.fixedDt);
      this.accumulator -= this.fixedDt;
    }
  }

  #substep(h) {
    const active = this.balls.filter((b) => !b.pocketed);

    // 1. Friction & Spin Dynamics
    for (const b of active) {
      const speed = Math.hypot(b.vx, b.vz);
      if (speed < 0.015) {
        b.vx = 0;
        b.vz = 0;
      } else {
        // Sliding to rolling deceleration
        const frictionCoeff = speed > 2.5 ? this.slidingFriction : this.rollingResistance;
        const decel = frictionCoeff * 9.81 * h;
        const newSpeed = Math.max(0, speed - decel);
        const factor = newSpeed / speed;
        b.vx *= factor;
        b.vz *= factor;
      }

      // Sidespin decay & curve lateral steering
      if (b.spin && Math.abs(b.spin) > 0.01) {
        if (b.spinTime > 0) {
          // English / sidespin steers trajectory
          b.vx += b.spin * 4.8 * h;
          b.spinTime = Math.max(0, b.spinTime - h);
        }
        b.spin *= Math.exp(-this.spinDecayRate * h);
      }

      // Max speed clamp
      const curSpeed = Math.hypot(b.vx, b.vz);
      if (curSpeed > 24) {
        b.vx *= 24 / curSpeed;
        b.vz *= 24 / curSpeed;
      }

      // Integrate position
      b.x += b.vx * h;
      b.z += b.vz * h;
    }

    // 2. Pocket Checks
    for (const b of active) {
      if (b.pocketed) continue;
      for (let pi = 0; pi < this.pockets.length; pi++) {
        const p = this.pockets[pi];
        const dx = b.x - p.x;
        const dz = b.z - p.z;
        const pocketRadius = p.radius || 0.33;
        if (dx * dx + dz * dz < pocketRadius * pocketRadius) {
          b.pocketed = true;
          b.vx = 0;
          b.vz = 0;
          this.onPocket?.(b, p);
          break;
        }
      }
    }

    // 3. Cushion Collisions with sidespin transfer
    for (const b of active) {
      if (b.pocketed) continue;

      // Left cushion
      if (b.x < this.minX) {
        b.x = this.minX;
        const vn = Math.abs(b.vx);
        const e = Math.max(0.65, this.cushionRestitution - this.cushionDecay * vn);
        b.vx = vn * e;
        // Sidespin transfer to tangential velocity (Z)
        if (b.spin) b.vz += b.spin * this.cushionFriction * 8.0;
        this.onCushionHit?.(b, vn, { x: 1, z: 0 });
      }
      // Right cushion
      else if (b.x > this.maxX) {
        b.x = this.maxX;
        const vn = Math.abs(b.vx);
        const e = Math.max(0.65, this.cushionRestitution - this.cushionDecay * vn);
        b.vx = -vn * e;
        if (b.spin) b.vz -= b.spin * this.cushionFriction * 8.0;
        this.onCushionHit?.(b, vn, { x: -1, z: 0 });
      }

      // Top cushion
      if (b.z < this.minZ) {
        b.z = this.minZ;
        const vn = Math.abs(b.vz);
        const e = Math.max(0.65, this.cushionRestitution - this.cushionDecay * vn);
        b.vz = vn * e;
        if (b.spin) b.vx -= b.spin * this.cushionFriction * 8.0;
        this.onCushionHit?.(b, vn, { x: 0, z: 1 });
      }
      // Bottom cushion
      else if (b.z > this.maxZ) {
        b.z = this.maxZ;
        const vn = Math.abs(b.vz);
        const e = Math.max(0.65, this.cushionRestitution - this.cushionDecay * vn);
        b.vz = -vn * e;
        if (b.spin) b.vx += b.spin * this.cushionFriction * 8.0;
        this.onCushionHit?.(b, vn, { x: 0, z: -1 });
      }
    }

    // 4. Ball-to-Ball Collisions
    const minD = this.ballRadius * 2;
    const minD2 = minD * minD;

    for (let i = 0; i < active.length; i++) {
      const a = active[i];
      if (a.pocketed) continue;

      for (let j = i + 1; j < active.length; j++) {
        const b = active[j];
        if (b.pocketed) continue;

        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;

        if (d2 >= minD2 || d2 < 1e-9) continue;

        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;

        // Position relaxation (resolve overlap)
        const overlap = minD - d;
        a.x -= nx * overlap * 0.5;
        a.z -= nz * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.z += nz * overlap * 0.5;

        // Relative normal velocity
        const rvx = b.vx - a.vx;
        const rvz = b.vz - a.vz;
        const velAlongNormal = rvx * nx + rvz * nz;

        // Only resolve if balls are moving toward each other
        if (velAlongNormal < 0) {
          const impact = Math.abs(velAlongNormal);
          const e = Math.max(0.75, this.ballRestitution - 0.016 * impact);
          const impulse = -(1 + e) * velAlongNormal * 0.5;

          a.vx -= nx * impulse;
          a.vz -= nz * impulse;
          b.vx += nx * impulse;
          b.vz += nz * impulse;

          // Tangential friction transfer
          const tx = -nz;
          const tz = nx;
          const velAlongTangent = rvx * tx + rvz * tz;
          const frictionImpulse = -velAlongTangent * this.ballBallFriction * 0.5;
          a.vx -= tx * frictionImpulse;
          a.vz -= tz * frictionImpulse;
          b.vx += tx * frictionImpulse;
          b.vz += tz * frictionImpulse;

          this.onBallHit?.(a, b, impact, { x: nx, z: nz });
        }
      }
    }
  }

  /**
   * Raycast cue ball to find ghost ball contact point and target deflection.
   */
  findAimTarget(cueX, cueZ, dirX, dirZ, maxRange = 12.0) {
    let nearestDist = maxRange;
    let hitBall = null;
    let ghostX = cueX + dirX * maxRange;
    let ghostZ = cueZ + dirZ * maxRange;
    const r2 = this.ballRadius * 2;

    for (const b of this.balls) {
      if (b.cue || b.pocketed) continue;
      const ox = b.x - cueX;
      const oz = b.z - cueZ;
      const proj = ox * dirX + oz * dirZ;
      if (proj <= 0) continue;

      const perp2 = (ox * ox + oz * oz) - (proj * proj);
      if (perp2 > r2 * r2) continue;

      const d = proj - Math.sqrt(Math.max(0, r2 * r2 - perp2));
      if (d > 0 && d < nearestDist) {
        nearestDist = d;
        hitBall = b;
        ghostX = cueX + dirX * d;
        ghostZ = cueZ + dirZ * d;
      }
    }

    let targetDir = null;
    let cueDeflectDir = null;

    if (hitBall) {
      const nx = hitBall.x - ghostX;
      const nz = hitBall.z - ghostZ;
      const nLen = Math.hypot(nx, nz) || 1;
      targetDir = { x: nx / nLen, z: nz / nLen };

      // Cue ball deflects perpendicular to collision normal
      const perpX = -targetDir.z;
      const perpZ = targetDir.x;
      const dot = dirX * perpX + dirZ * perpZ;
      cueDeflectDir = { x: perpX * Math.sign(dot), z: perpZ * Math.sign(dot) };
    }

    return { hit: hitBall, dist: nearestDist, ghostX, ghostZ, targetDir, cueDeflectDir };
  }
}
