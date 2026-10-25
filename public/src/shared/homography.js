/**
 * Planar homography + quad utilities used by the TV calibration.
 *
 * A homography maps camera-image coordinates (normalised 0..1) onto the TV
 * screen coordinates (also normalised 0..1), given four corresponding corners.
 * It lets us place avatars on the screen exactly where the player's feet are,
 * even when the TV is seen at an angle.
 */
import { clamp, dist2 } from './math.js';

/** Solve an n x n linear system with partial pivoting. Returns null if singular. */
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    if (pivot !== col) [M[pivot], M[col]] = [M[col], M[pivot]];
    const p = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (!f) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/**
 * Four-point homography (DLT, h33 fixed to 1).
 * src/dst: arrays of [x, y]. Returns 9 numbers row-major, or null.
 */
export function solveHomography(src, dst) {
  if (src.length < 4 || dst.length < 4) return null;
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  if (!h) return null;
  return [...h, 1];
}

export function applyH(H, x, y) {
  if (!H) return { x, y };
  const w = H[6] * x + H[7] * y + H[8];
  if (Math.abs(w) < 1e-9) return { x, y };
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w,
  };
}

export function invertH(H) {
  if (!H) return null;
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    A * inv,
    -(b * i - c * h) * inv,
    (b * f - c * e) * inv,
    B * inv,
    (a * i - c * g) * inv,
    -(a * f - c * d) * inv,
    C * inv,
    -(a * h - b * g) * inv,
    (a * e - b * d) * inv,
  ];
}

/** Order 4 points as TL, TR, BR, BL (clockwise in screen space). */
export function orderQuad(points) {
  if (!points || points.length !== 4) return points;
  const cx = points.reduce((s, p) => s + p.x, 0) / 4;
  const cy = points.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = [...points].sort((p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx));
  // start at the corner closest to the top-left of the bounding box
  let start = 0;
  let best = Infinity;
  sorted.forEach((p, i) => {
    const score = p.x + p.y;
    if (score < best) {
      best = score;
      start = i;
    }
  });
  return [sorted[start], sorted[(start + 1) % 4], sorted[(start + 2) % 4], sorted[(start + 3) % 4]];
}

export function quadArea(q) {
  if (!q || q.length !== 4) return 0;
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i];
    const n = q[(i + 1) % 4];
    area += p.x * n.y - n.x * p.y;
  }
  return Math.abs(area) / 2;
}

export function pointInQuad(p, q) {
  if (!q) return false;
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = q[i].x;
    const yi = q[i].y;
    const xj = q[j].x;
    const yj = q[j].y;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function quadCenter(q) {
  return {
    x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
  };
}

/** Convex hull (Andrew monotone chain). points: [{x,y}] */
export function convexHull(points) {
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (pts.length <= 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Largest-area quadrilateral whose corners are hull vertices. */
export function maxAreaQuad(hull) {
  const n = hull.length;
  if (n < 4) return null;
  let best = null;
  let bestArea = 0;
  // hull is usually small (< 40 points); this is fast enough.
  for (let a = 0; a < n - 3; a++) {
    for (let b = a + 1; b < n - 2; b++) {
      for (let c = b + 1; c < n - 1; c++) {
        for (let d = c + 1; d < n; d++) {
          const quad = [hull[a], hull[b], hull[c], hull[d]];
          const area = quadArea(quad);
          if (area > bestArea) {
            bestArea = area;
            best = quad;
          }
        }
      }
    }
  }
  return best;
}

/** Normalise a quad from pixel coords into 0..1 image coords. */
export function normalizeQuad(quad, width, height) {
  return orderQuad(quad.map((p) => ({ x: p.x / width, y: p.y / height })));
}

export function quadToArray(q) {
  return q ? q.map((p) => [round(p.x, 4), round(p.y, 4)]) : null;
}

export function quadFromArray(a) {
  if (!Array.isArray(a) || a.length !== 4) return null;
  return a.map((p) => ({ x: p[0], y: p[1] }));
}

export function quadFromPoints(a) {
  if (!Array.isArray(a) || a.length !== 4) return null;
  return a.map((p) => ({ x: p[0], y: p[1] }));
}

const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;

export function quadRect(q) {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** How rectangular a quad is (1 = perfect rectangle). */
export function rectangularity(quad) {
  const a = quadArea(quad);
  if (a <= 0) return 0;
  const sides = quad.map((p, i) => dist2(p.x, p.y, quad[(i + 1) % 4].x, quad[(i + 1) % 4].y));
  const s = (sides[0] + sides[2]) / 2;
  const t = (sides[1] + sides[3]) / 2;
  const rectArea = s * t;
  return clamp(a / Math.max(rectArea, 1e-6), 0, 1);
}
