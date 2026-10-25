/**
 * Mocap Converter & Move Baker Core
 *
 * Bridges 3D Humanoid Mocap (Mixamo FBX / BVH / SMPL / 3D bones)
 * and MediaPipe 33-Landmark Pose Streams.
 *
 * Capabilities:
 * 1. Bone-to-Landmark Kinematic Mapping (Mixamo / standard humanoid -> MediaPipe 33)
 * 2. Metric-to-Screen Normalization (scale-invariant by shoulder width K ≈ 0.18)
 * 3. Auto-Mirroring Transformation (horizontal flip + bilateral joint swap)
 * 4. Temporal Beat Retiming & Resampling (sync mocap BPM to game target BPM at 30 FPS)
 * 5. Move Crossfading (smooth 0.25-beat interpolation between consecutive moves)
 * 6. Automated Feature Extraction (hands, lean, torsoTwist, knees, hip amplitude)
 */
import { clamp } from './math.js';

/**
 * Standard bone naming conventions mapped to MediaPipe 33 landmark indices.
 */
export const BONE_CANDIDATES = {
  0: ['mixamorigHead', 'mixamorig:Head', 'Head', 'head', 'Neck1', 'neck'],
  11: ['mixamorigLeftArm', 'mixamorig:LeftArm', 'LeftArm', 'left_shoulder', 'shoulder_l', 'l_shoulder'],
  12: ['mixamorigRightArm', 'mixamorig:RightArm', 'RightArm', 'right_shoulder', 'shoulder_r', 'r_shoulder'],
  13: ['mixamorigLeftForeArm', 'mixamorig:LeftForeArm', 'LeftForeArm', 'left_elbow', 'elbow_l', 'l_elbow'],
  14: ['mixamorigRightForeArm', 'mixamorig:RightForeArm', 'RightForeArm', 'right_elbow', 'elbow_r', 'r_elbow'],
  15: ['mixamorigLeftHand', 'mixamorig:LeftHand', 'LeftHand', 'left_wrist', 'wrist_l', 'l_wrist'],
  16: ['mixamorigRightHand', 'mixamorig:RightHand', 'RightHand', 'right_wrist', 'wrist_r', 'r_wrist'],
  23: ['mixamorigLeftUpLeg', 'mixamorig:LeftUpLeg', 'LeftUpLeg', 'left_hip', 'hip_l', 'l_hip'],
  24: ['mixamorigRightUpLeg', 'mixamorig:RightUpLeg', 'RightUpLeg', 'right_hip', 'hip_r', 'r_hip'],
  25: ['mixamorigLeftLeg', 'mixamorig:LeftLeg', 'LeftLeg', 'left_knee', 'knee_l', 'l_knee'],
  26: ['mixamorigRightLeg', 'mixamorig:RightLeg', 'RightLeg', 'right_knee', 'knee_r', 'r_knee'],
  27: ['mixamorigLeftFoot', 'mixamorig:LeftFoot', 'LeftFoot', 'left_ankle', 'ankle_l', 'l_ankle'],
  28: ['mixamorigRightFoot', 'mixamorig:RightFoot', 'RightFoot', 'right_ankle', 'ankle_r', 'r_ankle'],
  31: ['mixamorigLeftToeBase', 'mixamorig:LeftToeBase', 'LeftToeBase', 'left_toe', 'toe_l', 'l_toe'],
  32: ['mixamorigRightToeBase', 'mixamorig:RightToeBase', 'RightToeBase', 'right_toe', 'toe_r', 'r_toe'],
};

export const BILATERAL_PAIRS = [
  [11, 12], // shoulders
  [13, 14], // elbows
  [15, 16], // wrists
  [23, 24], // hips
  [25, 26], // knees
  [27, 28], // ankles
  [31, 32], // toes
];

/**
 * Finds a bone position in a Three.js hierarchy or plain dictionary.
 */
export function findBonePosition(rootOrDict, candidates) {
  if (!rootOrDict) return null;

  // Plain dictionary input { [boneName]: {x, y, z} }
  if (typeof rootOrDict.getObjectByName !== 'function') {
    for (const name of candidates) {
      if (rootOrDict[name]) return rootOrDict[name];
    }
    return null;
  }

  // Three.js Object3D / Group hierarchy
  for (const name of candidates) {
    const obj = rootOrDict.getObjectByName(name);
    if (obj) {
      if (obj.matrixWorld && obj.matrixWorld.elements) {
        const e = obj.matrixWorld.elements;
        return { x: e[12], y: e[13], z: e[14] };
      }
      if (typeof obj.getWorldPosition === 'function') {
        const target = {
          x: 0, y: 0, z: 0,
          setFromMatrixPosition(m) {
            this.x = m.elements[12];
            this.y = m.elements[13];
            this.z = m.elements[14];
            return this;
          },
        };
        obj.getWorldPosition(target);
        return { x: target.x, y: target.y, z: target.z };
      }
      return { x: obj.position.x, y: obj.position.y, z: obj.position.z };
    }
  }
  return null;
}

/**
 * Converts a single 3D skeletal posture into a normalized MediaPipe 33-landmark frame.
 * @param {Object} skeleton Root object or dictionary of joint positions
 * @param {Object} options Configuration
 * @returns {Array<Array<number>>} 33 landmarks [x, y, z, visibility]
 */
export function convertSkeletonToLandmarks(skeleton, options = {}) {
  const targetShoulderW = options.targetShoulderWidth ?? 0.18;
  const centerX = options.centerX ?? 0.5;
  const centerY = options.centerY ?? 0.55;
  const mirror = options.mirror ?? false;

  // Extract raw world positions for all candidate joints
  const jointWorld = {};
  for (const [idxStr, names] of Object.entries(BONE_CANDIDATES)) {
    const idx = parseInt(idxStr, 10);
    const pos = findBonePosition(skeleton, names);
    if (pos) jointWorld[idx] = pos;
  }

  // Hip root anchor (fallback to midpoint between hips or origin)
  const hipL = jointWorld[23];
  const hipR = jointWorld[24];
  const rootHips = findBonePosition(skeleton, ['mixamorigHips', 'mixamorig:Hips', 'Hips', 'hips']) ||
    (hipL && hipR ? {
      x: (hipL.x + hipR.x) * 0.5,
      y: (hipL.y + hipR.y) * 0.5,
      z: (hipL.z + hipR.z) * 0.5,
    } : { x: 0, y: 0, z: 0 });

  // Compute physical shoulder width for scale invariance
  const shL = jointWorld[11];
  const shR = jointWorld[12];
  let physicalW = 0.40;
  if (shL && shR) {
    const dx = shR.x - shL.x;
    const dy = shR.y - shL.y;
    const dz = shR.z - shL.z;
    physicalW = Math.hypot(dx, dy, dz);
    if (physicalW < 0.05) physicalW = 0.40;
  }

  const scale = targetShoulderW / physicalW;

  // Allocate 33 landmarks [x, y, z, vis]
  const landmarks = Array.from({ length: 33 }, () => [centerX, centerY, 0, 0]);

  for (let i = 0; i < 33; i++) {
    const p = jointWorld[i];
    if (!p) continue;

    // Delta relative to hip root
    const dx = (p.x - rootHips.x) * scale;
    const dy = (p.y - rootHips.y) * scale;
    const dz = (p.z - rootHips.z) * scale;

    // MediaPipe: X right (0..1), Y down (0..1), Z negative towards camera
    const lx = centerX + dx;
    const ly = centerY - dy;
    const lz = -dz;

    landmarks[i] = [lx, ly, lz, 1.0];
  }

  // Synthesize missing torso / nose if needed
  if (landmarks[0][3] === 0 && landmarks[11][3] > 0 && landmarks[12][3] > 0) {
    // Nose approx 0.12 units above shoulder mid
    landmarks[0] = [
      (landmarks[11][0] + landmarks[12][0]) * 0.5,
      (landmarks[11][1] + landmarks[12][1]) * 0.5 - 0.12,
      (landmarks[11][2] + landmarks[12][2]) * 0.5,
      0.9,
    ];
  }

  return mirror ? mirrorLandmarks(landmarks) : landmarks;
}

/**
 * Applies horizontal mirror reflection and swaps bilateral joint pairs.
 */
export function mirrorLandmarks(landmarks) {
  const mirrored = landmarks.map(lm => [1.0 - lm[0], lm[1], lm[2], lm[3]]);

  for (const [leftIdx, rightIdx] of BILATERAL_PAIRS) {
    const temp = mirrored[leftIdx];
    mirrored[leftIdx] = mirrored[rightIdx];
    mirrored[rightIdx] = temp;
  }

  return mirrored;
}

/**
 * Extracts high-level dance features from a normalized 33-landmark frame.
 * Formatted identically to MotionTracker state for DTW and instantaneous matching.
 */
export function extractDanceFeatures(landmarks) {
  const shL = landmarks[11] || [0.4, 0.4, 0, 1];
  const shR = landmarks[12] || [0.6, 0.4, 0, 1];
  const wrL = landmarks[15] || [0.3, 0.6, 0, 1];
  const wrR = landmarks[16] || [0.7, 0.6, 0, 1];
  const hipL = landmarks[23] || [0.45, 0.65, 0, 1];
  const hipR = landmarks[24] || [0.55, 0.65, 0, 1];
  const knL = landmarks[25] || [0.45, 0.82, 0, 1];
  const knR = landmarks[26] || [0.55, 0.82, 0, 1];

  const shMidX = (shL[0] + shR[0]) * 0.5;
  const shMidY = (shL[1] + shR[1]) * 0.5;
  const shoulderW = Math.max(0.08, Math.hypot(shR[0] - shL[0], shR[1] - shL[1]));

  // Hands relative to shoulder center in shoulder units
  // Y inverted so +1 is above shoulders (up)
  const handL = [
    (wrL[0] - shMidX) / shoulderW,
    -(wrL[1] - shMidY) / shoulderW,
  ];
  const handR = [
    (wrR[0] - shMidX) / shoulderW,
    -(wrR[1] - shMidY) / shoulderW,
  ];

  // Lateral lean from spine tilt (mid-hip to mid-shoulder)
  const hipMidX = (hipL[0] + hipR[0]) * 0.5;
  const lean = clamp((shMidX - hipMidX) / (shoulderW * 0.6), -1.2, 1.2);

  // Torso twist (yaw angle difference between shoulders and hips)
  const shYaw = Math.atan2(shR[2] - shL[2], shR[0] - shL[0]);
  const hipYaw = Math.atan2(hipR[2] - hipL[2], hipR[0] - hipL[0]);
  const torsoTwist = clamp((shYaw - hipYaw) * 1.2, -1.2, 1.2);

  // Knee lift (upward displacement relative to standing hip)
  const kneeL = clamp((hipL[1] + 0.35 - knL[1]) / 0.25, 0, 1.2);
  const kneeR = clamp((hipR[1] + 0.35 - knR[1]) / 0.25, 0, 1.2);

  // Hip amplitude (lateral displacement from center)
  const hipAmp = clamp(Math.abs(hipMidX - 0.5) / (shoulderW * 0.4), 0, 1.2);

  return {
    handL: { x: handL[0], y: handL[1] },
    handR: { x: handR[0], y: handR[1] },
    hands: [handL, handR],
    lean,
    torsoTwist,
    kneeL,
    kneeR,
    hipAmp,
  };
}

/**
 * Crossfades smoothly between two sets of 33 landmarks over alpha [0..1].
 */
export function crossfadeLandmarks(lmA, lmB, alpha) {
  const t = clamp(alpha, 0, 1);
  const invT = 1.0 - t;
  const out = [];

  for (let i = 0; i < 33; i++) {
    const a = lmA[i] || [0.5, 0.5, 0, 0];
    const b = lmB[i] || [0.5, 0.5, 0, 0];

    out.push([
      a[0] * invT + b[0] * t,
      a[1] * invT + b[1] * t,
      a[2] * invT + b[2] * t,
      Math.max(a[3], b[3]),
    ]);
  }
  return out;
}

/**
 * Retimes and resamples a sequence of mocap frames to match game target BPM at targetFps.
 * @param {Array<{t: number, landmarks: Array}>} rawFrames 
 * @param {number} sourceBpm 
 * @param {number} targetBpm 
 * @param {number} targetFps 
 * @returns {Array<{t: number, landmarks: Array, features: Object}>}
 */
export function retimeMocapSequence(rawFrames, sourceBpm, targetBpm, targetFps = 30) {
  if (!rawFrames || rawFrames.length === 0) return [];

  const timeRatio = sourceBpm / targetBpm;
  const durationOriginal = rawFrames[rawFrames.length - 1].t - rawFrames[0].t;
  const targetDuration = durationOriginal * timeRatio;
  const totalFrames = Math.max(2, Math.round(targetDuration * targetFps));
  const dt = targetDuration / (totalFrames - 1);

  const resampled = [];

  for (let i = 0; i < totalFrames; i++) {
    const tTarget = i * dt;
    const tOriginal = tTarget / timeRatio + rawFrames[0].t;

    // Linear interpolation between surrounding original frames
    let idx = rawFrames.findIndex(f => f.t >= tOriginal);
    if (idx === -1) idx = rawFrames.length - 1;
    if (idx === 0) idx = 1;

    const f0 = rawFrames[idx - 1];
    const f1 = rawFrames[idx];
    const span = Math.max(1e-5, f1.t - f0.t);
    const alpha = clamp((tOriginal - f0.t) / span, 0, 1);

    const blendedLm = crossfadeLandmarks(f0.landmarks, f1.landmarks, alpha);
    const features = extractDanceFeatures(blendedLm);

    resampled.push({
      t: Number(tTarget.toFixed(4)),
      landmarks: blendedLm,
      features,
    });
  }

  return resampled;
}
