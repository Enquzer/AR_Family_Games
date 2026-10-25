/**
 * One Euro Filter for adaptive low-pass signal smoothing (Casiez, Roussel, Vogel).
 * 
 * High smoothing when velocity is low (eliminates stationary jitter/tremor).
 * Low smoothing when velocity is high (eliminates perceived lag on strikes & gestures).
 */
const TAU = 2 * Math.PI;

function alphaOf(cutoff, dt) {
  const r = TAU * cutoff * dt;
  return r / (r + 1);
}

export class OneEuro {
  constructor(minCutoff = 1.2, beta = 5.0, dCutoff = 1.5) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;
    this.dx = 0;
    this.t = null;
  }

  filter(val, timestampSec, confidence = 1.0) {
    if (this.x === null || this.t === null) {
      this.x = val;
      this.dx = 0;
      this.t = timestampSec;
      return val;
    }

    const dt = Math.min(0.2, Math.max(0.001, timestampSec - this.t));
    this.t = timestampSec;

    // Severe occlusion handling: hold last known value, decay derivative
    if (confidence < 0.15) {
      this.dx *= 0.85;
      return this.x;
    }

    // Estimate derivative (rate of change)
    const rawDx = (val - this.x) / dt;
    const alphaD = alphaOf(this.dCutoff, dt);
    this.dx += alphaD * (rawDx - this.dx);

    // Scale cutoff frequency dynamically by velocity and confidence
    const confFactor = 0.25 + 0.75 * Math.min(1.0, Math.max(0.0, confidence));
    const dynamicCutoff = (this.minCutoff + this.beta * Math.abs(this.dx)) * confFactor;
    const alphaV = alphaOf(dynamicCutoff, dt);

    this.x += alphaV * (val - this.x);
    return this.x;
  }

  reset() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }
}

/**
 * 3D Landmark Filter supporting:
 * - Dual stream: 'smooth' for visual rendering, 'fast' for gesture onset
 * - Metric world landmarks filtering
 * - Direct filtered velocity readouts (dx, dy, dz)
 */
export class LandmarkFilter {
  constructor({
    xy = [1.2, 5.0, 1.5],
    z = [0.6, 2.0, 1.2],
    fastXy = [2.2, 14.0, 2.0],
    fastZ = [1.0, 6.0, 1.5],
  } = {}) {
    // 33 landmarks, each with [x, y, z] OneEuro instances
    this.smoothFilters = Array.from({ length: 33 }, () => [
      new OneEuro(...xy),
      new OneEuro(...xy),
      new OneEuro(...z),
    ]);

    this.fastFilters = Array.from({ length: 33 }, () => [
      new OneEuro(...fastXy),
      new OneEuro(...fastXy),
      new OneEuro(...fastZ),
    ]);

    this.worldFilters = Array.from({ length: 33 }, () => [
      new OneEuro(1.4, 4.5, 1.5),
      new OneEuro(1.4, 4.5, 1.5),
      new OneEuro(1.0, 3.5, 1.2),
    ]);
  }

  /**
   * Applies dual-stream filtering on MediaPipe normalized landmarks.
   * @param {Array} rawLandmarks 33 landmarks [x, y, z, visibility]
   * @param {number} timestampSec Monotonically increasing seconds
   * @param {number} aspect Video aspect ratio
   * @returns {{ smooth: Array, fast: Array }}
   */
  apply(rawLandmarks, timestampSec, aspect = 16 / 9) {
    if (!rawLandmarks || !rawLandmarks.length) {
      return { smooth: rawLandmarks, fast: rawLandmarks };
    }

    const smooth = [];
    const fast = [];

    for (let i = 0; i < rawLandmarks.length; i++) {
      const pt = rawLandmarks[i];
      if (!pt) {
        smooth.push(null);
        fast.push(null);
        continue;
      }

      const x = pt.x ?? pt[0];
      const y = pt.y ?? pt[1];
      const z = pt.z ?? pt[2] ?? 0;
      const vis = pt.visibility ?? pt[3] ?? 1.0;

      // Aspect scaling applied so x and y share normalized scale
      const [sx, sy, sz] = this.smoothFilters[i];
      const fxSmooth = sx.filter(x * aspect, timestampSec, vis) / aspect;
      const fySmooth = sy.filter(y, timestampSec, vis);
      const fzSmooth = sz.filter(z, timestampSec, vis);

      const [fx, fy, fz] = this.fastFilters[i];
      const fxFast = fx.filter(x * aspect, timestampSec, vis) / aspect;
      const fyFast = fy.filter(y, timestampSec, vis);
      const fzFast = fz.filter(z, timestampSec, vis);

      smooth.push({ x: fxSmooth, y: fySmooth, z: fzSmooth, visibility: vis });
      fast.push({ x: fxFast, y: fyFast, z: fzFast, visibility: vis });
    }

    return { smooth, fast };
  }

  /**
   * Filter MediaPipe metric world landmarks (in 3D meters).
   */
  applyWorld(rawWorldLandmarks, timestampSec) {
    if (!rawWorldLandmarks || !rawWorldLandmarks.length) return rawWorldLandmarks;

    const filtered = [];
    for (let i = 0; i < rawWorldLandmarks.length; i++) {
      const pt = rawWorldLandmarks[i];
      if (!pt) {
        filtered.push(null);
        continue;
      }

      const x = pt.x ?? pt[0];
      const y = pt.y ?? pt[1];
      const z = pt.z ?? pt[2] ?? 0;
      const vis = pt.visibility ?? pt[3] ?? 1.0;

      const [wx, wy, wz] = this.worldFilters[i];
      filtered.push({
        x: wx.filter(x, timestampSec, vis),
        y: wy.filter(y, timestampSec, vis),
        z: wz.filter(z, timestampSec, vis),
        visibility: vis,
      });
    }
    return filtered;
  }

  /**
   * Returns filtered velocity vector (dx, dy, dz) for joint i in normalized units/sec.
   */
  getVelocity(jointIndex, stream = 'fast') {
    const filters = stream === 'fast' ? this.fastFilters : this.smoothFilters;
    const f = filters[jointIndex];
    if (!f) return { x: 0, y: 0, z: 0 };
    return { x: f[0].dx, y: f[1].dx, z: f[2].dx };
  }

  reset() {
    for (let i = 0; i < 33; i++) {
      this.smoothFilters[i].forEach((f) => f.reset());
      this.fastFilters[i].forEach((f) => f.reset());
      this.worldFilters[i].forEach((f) => f.reset());
    }
  }
}
