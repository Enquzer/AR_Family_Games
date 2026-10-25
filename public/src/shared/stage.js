/**
 * TV calibration + virtual stage mapping.
 *
 * The host camera finds the TV's four corners while the TV flashes white.
 * Those corners give a homography from camera space to TV space. We use it to
 * place each player's avatar at the same lateral position they occupy in front
 * of the TV, and to derive a matching render FOV / horizon roll so the world on
 * the TV continues the perspective of the room.
 */
import {
  solveHomography,
  applyH,
  orderQuad,
  quadArea,
  quadCenter,
  quadRect,
  quadFromArray,
  quadFromPoints,
} from './homography.js';
import { clamp, lerp, rad, deg } from './math.js';
import { LM, mid, groundPoint } from './pose.js';

/** Where the virtual stage camera sits. Shared by renderer + mapper. */
export const STAGE_CAM = {
  pos: [0, 1.55, 6.5],
  look: [0, 1.02, -1.0],
  fov: 46,
  nearZ: 0.8,
  farZ: -4.2,
  maxZ: 2.0,
};

/** A sensible quad when the TV is not visible (TV in upper-centre of frame). */
export const DEFAULT_QUAD = [
  [0.19, 0.1],
  [0.81, 0.1],
  [0.81, 0.7],
  [0.19, 0.7],
];

export function defaultCalibration(opts = {}) {
  return makeCalibration(DEFAULT_QUAD, { ...opts, synthetic: true });
}

/**
 * @param {Array} quadInput  [[x,y]x4] in camera-image space (0..1, y down)
 * @param {object} opts      { camFov, tvInches, mirror, synthetic }
 */
export function makeCalibration(quadInput, opts = {}) {
  let quad = null;
  if (Array.isArray(quadInput) && quadInput.length === 4) {
    quad = typeof quadInput[0]?.x === 'number' ? orderQuad(quadInput) : quadFromPoints(quadInput);
  }
  if (!quad || quadArea(quad) < 0.001) quad = quadFromPoints(DEFAULT_QUAD);

  const H = solveHomography(
    quad.map((p) => [p.x, p.y]),
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
  );

  const center = quadCenter(quad);
  const rect = quadRect(quad);
  const camFov = clamp(Number(opts.camFov) || 55, 25, 100);
  // angular height of the TV as seen by the camera
  const tvAngle = 2 * Math.atan(clamp(rect.h, 0.02, 1.2) * Math.tan(rad(camFov) / 2));
  // comfortable game FOV that still echoes the room's perspective
  const fov = clamp(deg(tvAngle) * 1.65, 40, 60);
  const roll = Math.atan2(quad[1].y - quad[0].y, quad[1].x - quad[0].x);
  const topW = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
  const botW = Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y);
  const persp = clamp(topW / Math.max(botW, 1e-4), 0.35, 1.6);
  const tvInches = Number(opts.tvInches) || 55;
  const tvHeightM = (tvInches * 0.0254 * 9) / Math.sqrt(16 * 16 + 9 * 9);
  const distance = tvHeightM / 2 / Math.tan(Math.max(tvAngle, rad(6)) / 2);

  return {
    quad,
    H,
    center,
    rect,
    fov,
    roll: clamp(roll, -0.3, 0.3),
    camFov,
    tvAngle: deg(tvAngle),
    persp,
    distance,
    tvInches,
    mirror: opts.mirror !== false,
    synthetic: !!opts.synthetic,
    createdAt: Date.now(),
    confidence: opts.confidence ?? (opts.synthetic ? 0 : 1),
  };
}

/** Rebuild from the compact form sent over the network. */
export function calibrationFromMessage(msg) {
  if (!msg) return defaultCalibration();
  const quad = quadFromArray(msg.quad);
  return makeCalibration(quad, {
    camFov: msg.camFov,
    tvInches: msg.tvInches,
    mirror: msg.mirror,
    synthetic: msg.synthetic,
    confidence: msg.confidence,
  });
}

export function calibrationToMessage(cal) {
  if (!cal) return null;
  return {
    quad: cal.quad.map((p) => [round(p.x, 4), round(p.y, 4)]),
    camFov: cal.camFov,
    tvInches: cal.tvInches,
    mirror: cal.mirror,
    synthetic: cal.synthetic,
    confidence: cal.confidence,
  };
}

const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;

/** Half-width of the render view at a given stage depth. */
export function halfWidthAt(z, fov, aspect) {
  return Math.tan(rad(fov) / 2) * Math.max(STAGE_CAM.pos[2] - z, 0.5) * aspect;
}

/* ------------------------------------------------------------------ */
/* Player distance / view-angle rig                                    */
/* ------------------------------------------------------------------ */

/**
 * Average standing height used for the trig distance estimate. The exact
 * number does not matter for relative depth, but it keeps the absolute
 * distance readout useful for the calibration UI.
 */
export const PERSON_HEIGHT_M = 1.72;
const SHOULDER_HEIGHT_FRAC = 0.82;
const NOSE_HEIGHT_FRAC = 0.87;

/**
 * Apparent full-body height as a fraction of the camera image height.
 * Uses both shoulder->ankle and nose->ankle spans so a raised arm or a
 * slightly bent head does not throw the estimate off.
 */
export function bodyHeightNorm(lm, aspect = 16 / 9) {
  if (!lm || lm.length < 33) return 0;
  const sh = mid(lm[LM.L_SHOULDER], lm[LM.R_SHOULDER]);
  const nose = lm[LM.NOSE];
  const ank = mid(lm[LM.L_ANKLE], lm[LM.R_ANKLE]);
  if (![sh.x, sh.y, nose.x, nose.y, ank.x, ank.y].every(Number.isFinite)) return 0;
  const shoulderAnkle = Math.hypot((sh.x - ank.x) * aspect, sh.y - ank.y);
  const noseAnkle = Math.hypot((nose.x - ank.x) * aspect, nose.y - ank.y);
  const h = Math.max(shoulderAnkle / SHOULDER_HEIGHT_FRAC, noseAnkle / NOSE_HEIGHT_FRAC);
  return clamp(h, 0, 0.98);
}

/**
 * Pinhole-camera distance from apparent body size.
 *
 *   h = H / (2 * D * tan(camFov / 2))   ->   D = H / (2 * h * tan(camFov / 2))
 *
 * h is the body height as a fraction of the image height, so this works with
 * any webcam resolution as long as the vertical FOV is roughly known.
 */
export function estimatePlayerDistance(lm, aspect, cal, opts = {}) {
  const heightNorm = bodyHeightNorm(lm, aspect);
  const camFov = clamp(Number(cal?.camFov) || 55, 25, 100);
  if (!heightNorm) {
    return { distance: null, heightNorm: 0, camFov, angle: null, angleDeg: 0, confidence: 0 };
  }
  const height = opts.height || PERSON_HEIGHT_M;
  const distance = height / (2 * heightNorm * Math.tan(rad(camFov) / 2));
  const g = groundPoint(lm);
  const xAtUnit = (g.x - 0.5) * 2 * Math.tan(rad(camFov) / 2) * aspect;
  const angle = Math.atan(xAtUnit);
  const confidence = clamp(
    ((lm[LM.L_SHOULDER]?.visibility ?? 1) +
      (lm[LM.R_SHOULDER]?.visibility ?? 1) +
      (lm[LM.L_ANKLE]?.visibility ?? 1) +
      (lm[LM.R_ANKLE]?.visibility ?? 1)) / 4,
    0,
    1
  );
  return {
    distance: clamp(distance, 0.8, 12),
    heightNorm,
    camFov,
    angle,
    angleDeg: deg(angle),
    confidence,
  };
}

/**
 * Solve the camera's vertical FOV from a person standing at a known distance.
 * This is the inverse of estimatePlayerDistance and is what the controller's
 * "Calibrate FOV" button uses.
 */
export function estimateCameraFovFromDistance(lm, aspect, knownDistance, opts = {}) {
  const h = bodyHeightNorm(lm, aspect);
  const d = Number(knownDistance);
  if (!h || !Number.isFinite(d) || d <= 0.2) return null;
  const height = opts.height || PERSON_HEIGHT_M;
  const fov = 2 * Math.atan(height / (2 * d * h));
  return clamp(deg(fov), 30, 85);
}

/**
 * Pick a render FOV that keeps the whole player group comfortably in view.
 * Wider groups and players standing close to the camera get a little more FOV;
 * the value never narrows below the TV-calibrated base.
 */
export function computeViewRig(cal, stages, aspect = 16 / 9) {
  const valid = (stages || []).filter(
    (s) => s && Number.isFinite(s.distance) && Number.isFinite(s.angle)
  );
  const baseFov = clamp(Number(cal?.fov) || STAGE_CAM.fov, 35, 70);
  if (!valid.length) {
    return { fov: baseFov, avgDistance: null, angle: 0, spread: 0, count: 0 };
  }
  let sum = 0;
  let minAngle = Infinity;
  let maxAngle = -Infinity;
  for (const s of valid) {
    sum += s.distance;
    minAngle = Math.min(minAngle, s.angle);
    maxAngle = Math.max(maxAngle, s.angle);
  }
  const avgDistance = sum / valid.length;
  const halfAngle = Math.max(Math.abs(minAngle), Math.abs(maxAngle)) + rad(5);
  const requiredFov = deg(2 * halfAngle);
  const closeBoost = clamp((2.6 - avgDistance) * 6.5, 0, 10);
  const fov = clamp(Math.max(baseFov, requiredFov * 0.72) + closeBoost, baseFov, 70);
  return {
    fov,
    avgDistance,
    angle: deg((minAngle + maxAngle) / 2),
    spread: deg(maxAngle - minAngle),
    count: valid.length,
  };
}

/**
 * Map a tracked player's feet into the virtual stage.
 * @param {object} cal
 * @param {Array} lm      landmarks (normalized)
 * @param {number} aspect video aspect
 * @param {object} opts   { mirror }
 * @returns {{x:number,z:number,t:number,u:number,v:number,half:number,visible:boolean}}
 */
export function mapGroundToStage(cal, lm, aspect = 16 / 9, opts = {}) {
  const g = groundPoint(lm);
  const mirror = opts.mirror ?? cal.mirror;
  const uRaw = applyH(cal.H, g.x, g.y).x;
  const u = mirror ? 1 - uRaw : uRaw;

  const bottom = Math.max(cal.quad[3].y, cal.quad[2].y);
  const span = Math.max(0.97 - bottom, 0.12);
  const tImage = clamp((g.y - bottom + 0.015) / span, 0, 1);

  // Depth is primarily driven by the trig distance estimate, which is stable
  // when the camera is tilted or the player crouches. Image-y is blended in
  // as a tie-breaker so avatars still line up with the TV's floor.
  const metrics = estimatePlayerDistance(lm, aspect, cal);
  let t = tImage;
  if (Number.isFinite(metrics.distance)) {
    const near = 1 - clamp((metrics.distance - 1.4) / 4.8, 0, 1);
    t = clamp(near * 0.68 + tImage * 0.32, 0, 1);
  }

  const z = lerp(STAGE_CAM.farZ, STAGE_CAM.nearZ, t);
  const half = halfWidthAt(z, cal.fov, aspect);
  const x = clamp((u - 0.5) * 2 * half * 0.97, -half * 1.15, half * 1.15);
  const expectedBodyH = Number.isFinite(metrics.distance)
    ? (PERSON_HEIGHT_M * SHOULDER_HEIGHT_FRAC) /
      (2 * metrics.distance * Math.tan(rad(metrics.camFov) / 2))
    : null;

  return {
    x,
    z,
    t,
    u,
    v: g.y,
    half,
    visible: uRaw > -0.25 && uRaw < 1.25 && g.y < 1.05,
    distance: metrics.distance,
    angle: metrics.angle,
    angleDeg: metrics.angleDeg,
    heightNorm: metrics.heightNorm,
    expectedBodyH,
    camFov: metrics.camFov,
    confidence: metrics.confidence,
  };
}

/** Map any camera-image point onto TV screen coordinates (for AR overlays). */
export function mapToScreen(cal, x, y, mirror = cal.mirror) {
  const p = applyH(cal.H, x, y);
  return { x: mirror ? 1 - p.x : p.x, y: p.y };
}

/** Camera FOV / roll for the 3D renderer. */
export function viewFromCalibration(cal, aspect = 16 / 9) {
  return {
    fov: cal.fov || STAGE_CAM.fov,
    roll: cal.roll || 0,
    aspect,
  };
}

/** The stage camera pose, optionally nudged by calibration. */
export function stageCameraPose(cal) {
  return {
    pos: STAGE_CAM.pos,
    look: STAGE_CAM.look,
    fov: cal?.fov || STAGE_CAM.fov,
    roll: cal?.roll || 0,
  };
}

/** A soft guide rectangle in world space for the AR preview. */
export function quadToSvgPoints(quad, width, height) {
  return quad.map((p) => `${(p.x * width).toFixed(1)},${(p.y * height).toFixed(1)}`).join(' ');
}
