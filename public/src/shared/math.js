/** Small math helpers shared by vision, engine and games. */

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
/** Keep gameplay math finite even if a tracker glitches for a frame. */
export const finite = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b - a === 0 ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => {
  t = clamp(t);
  return t * t * (3 - 2 * t);
};
export const damp = (current, target, lambda, dt) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));
export const dist2 = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
export const average = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const deg = (rad) => (rad * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

/** Exponential moving average for arrays of numbers. */
export function emaArray(prev, next, alpha) {
  if (!prev || prev.length !== next.length) return next.slice();
  for (let i = 0; i < next.length; i++) prev[i] += (next[i] - prev[i]) * alpha;
  return prev;
}

export function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(r < 10 ? 1 : 0).padStart(r < 10 ? 4 : 2, '0')}`;
}

/** Shortest angle difference, radians. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** A tiny deterministic PRNG so worlds look the same every load. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
