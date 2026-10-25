/** MediaPipe pose landmark indices + compact wire format. */

export const LM = {
  NOSE: 0,
  L_EYE: 2,
  R_EYE: 5,
  L_EAR: 7,
  R_EAR: 8,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
  L_HEEL: 29,
  R_HEEL: 30,
  L_FOOT: 31,
  R_FOOT: 32,
};

export const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28], [27, 31], [28, 32], [0, 11], [0, 12],
];

const r = (v, n) => Math.round(v * 10 ** n) / 10 ** n;

export function packPose(lm) {
  if (!lm) return null;
  return lm.map((p) => [r(p.x, 4), r(p.y, 4), r(p.z, 4), r(p.visibility ?? 1, 2)]);
}

export function unpackPose(arr) {
  if (!Array.isArray(arr)) return null;
  return arr.map((p) => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] ?? 1 }));
}

export function visible(lm, idx, threshold = 0.35) {
  return lm && lm[idx] && (lm[idx].visibility ?? 1) >= threshold;
}

export function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 };
}

/** Ground contact point: ankles when visible, otherwise an estimate from the hips. */
export function groundPoint(lm) {
  if (!lm) return { x: 0.5, y: 0.9, z: 0 };
  const a = lm[LM.L_ANKLE];
  const b = lm[LM.R_ANKLE];
  const av = (a?.visibility ?? 1) + (b?.visibility ?? 1);
  if (av > 0.7) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 };
  }
  const h = mid(lm[LM.L_HIP], lm[LM.R_HIP]);
  return { x: h.x, y: Math.min(0.98, h.y + 0.33), z: h.z };
}

/** Body metrics in "square" image units (x scaled by aspect). */
export function bodyMetrics(lm, aspect = 16 / 9) {
  if (!lm) return null;
  const sh = mid(lm[LM.L_SHOULDER], lm[LM.R_SHOULDER]);
  const hip = mid(lm[LM.L_HIP], lm[LM.R_HIP]);
  const ank = mid(lm[LM.L_ANKLE], lm[LM.R_ANKLE]);
  const shoulderW = Math.hypot(
    (lm[LM.L_SHOULDER].x - lm[LM.R_SHOULDER].x) * aspect,
    lm[LM.L_SHOULDER].y - lm[LM.R_SHOULDER].y
  );
  const bodyH = Math.hypot((sh.x - ank.x) * aspect, sh.y - ank.y);
  return {
    shoulder: sh,
    hip,
    ankle: ank,
    shoulderW: Math.max(shoulderW, 0.02),
    bodyH: Math.max(bodyH, 0.05),
    aspect,
  };
}

export function packPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    lm: packPose(p.lm),
    score: p.score ?? 0,
  };
}
