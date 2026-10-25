/**
 * Curated Dance Move Library
 *
 * Contains pre-baked landmark sequences for signature dance routines,
 * as well as the dynamic loader for external mocap-baked move files.
 */
import { convertSkeletonToLandmarks, retimeMocapSequence, extractDanceFeatures } from '../shared/mocapConverter.js';

/**
 * Procedurally generates 30 FPS baked landmark stream for a dance move
 * if no external FBX mocap file has been baked yet.
 */
export function generateReferenceLandmarkFrames(moveDef, targetFps = 30) {
  const bpm = moveDef.bpm || 112;
  const beats = moveDef.beats || 2;
  const duration = beats * (60 / bpm);
  const totalFrames = Math.round(duration * targetFps);
  const frames = [];

  const hands = moveDef.hands || [[-0.8, 0.5], [0.8, 0.5]];
  const lean = moveDef.lean || 0;
  const twist = moveDef.twist || 0;
  const kneeL = moveDef.kneeL || 0;
  const kneeR = moveDef.kneeR || 0;
  const hipAmp = moveDef.hipAmp || 0.5;

  for (let i = 0; i < totalFrames; i++) {
    const t = (i / targetFps);
    const phase = (t / (60 / bpm)) % 1.0;
    const pulse = Math.sin(phase * Math.PI * 2);
    const bounce = Math.abs(Math.sin(phase * Math.PI));

    // Synthetic 3D skeleton posture for standard humanoid
    const skeleton = {
      mixamorigHead: { x: 0, y: 1.68 - bounce * 0.04, z: 0 },
      mixamorigHips: { x: (lean * 0.12) + Math.sin(t * (bpm / 60) * Math.PI) * 0.08 * hipAmp, y: 0.95 - bounce * 0.05, z: 0 },
      mixamorigLeftArm: { x: -0.20 + twist * 0.04, y: 1.45, z: -twist * 0.06 },
      mixamorigRightArm: { x: 0.20 - twist * 0.04, y: 1.45, z: twist * 0.06 },
      mixamorigLeftForeArm: { x: -0.28, y: 1.25, z: 0.05 },
      mixamorigRightForeArm: { x: 0.28, y: 1.25, z: 0.05 },
      mixamorigLeftHand: {
        x: -0.20 + hands[0][0] * 0.28,
        y: 1.45 + hands[0][1] * 0.28 + pulse * 0.03,
        z: 0.15,
      },
      mixamorigRightHand: {
        x: 0.20 + hands[1][0] * 0.28,
        y: 1.45 + hands[1][1] * 0.28 - pulse * 0.03,
        z: 0.15,
      },
      mixamorigLeftUpLeg: { x: -0.10, y: 0.90, z: 0 },
      mixamorigRightUpLeg: { x: 0.10, y: 0.90, z: 0 },
      mixamorigLeftLeg: { x: -0.10, y: 0.50 + kneeL * 0.18, z: kneeL * 0.12 },
      mixamorigRightLeg: { x: 0.10, y: 0.50 + kneeR * 0.18, z: kneeR * 0.12 },
      mixamorigLeftFoot: { x: -0.10, y: 0.08, z: 0.05 },
      mixamorigRightFoot: { x: 0.10, y: 0.08, z: 0.05 },
    };

    const landmarks = convertSkeletonToLandmarks(skeleton, {
      targetShoulderWidth: 0.18,
      centerX: 0.5,
      centerY: 0.55,
      mirror: false,
    });

    const features = extractDanceFeatures(landmarks);

    frames.push({
      t: Number(t.toFixed(4)),
      landmarks,
      features,
    });
  }

  return frames;
}

/**
 * Move library catalog with support for pre-baked landmark frames.
 */
export const MOVE_CATALOG = {
  samba_hip_roll: {
    id: 'samba_hip_roll',
    name: 'SAMBA HIP ROLL',
    style: 'samba',
    bpm: 112,
    beats: 2,
    hands: [[-1.15, 1.45], [0.45, 0.55]],
    lean: -0.85,
    twist: -0.55,
    kneeL: 0.55,
    kneeR: 0.15,
    hipAmp: 0.95,
    tip: 'Roll your hips in a figure-8 groove!',
  },
  disco_hustle: {
    id: 'disco_hustle',
    name: 'DISCO POINT HIGH',
    style: 'disco',
    bpm: 126,
    beats: 2,
    hands: [[-1.35, 1.75], [0.55, 0.25]],
    lean: -0.7,
    twist: -0.65,
    kneeL: 0.7,
    kneeR: 0.2,
    hipAmp: 0.8,
    tip: 'Saturday Night Fever high point!',
  },
  salsa_cross: {
    id: 'salsa_cross',
    name: 'SALSA CROSS BODY',
    style: 'samba',
    bpm: 116,
    beats: 2,
    hands: [[-0.85, 0.95], [0.85, 0.95]],
    lean: 0.45,
    twist: 0.6,
    kneeL: 0.4,
    kneeR: 0.6,
    hipAmp: 0.85,
    tip: 'Step across and swing your hips!',
  },
  electric_wave: {
    id: 'electric_wave',
    name: 'ELECTRIC WAVE',
    style: 'robot',
    bpm: 136,
    beats: 2,
    hands: [[-1.25, 1.25], [0.65, 0.25]],
    lean: -0.4,
    twist: -0.45,
    kneeL: 0.2,
    kneeR: 0.3,
    hipAmp: 0.3,
    tip: 'Send an electric wave through your arms!',
  },
};
