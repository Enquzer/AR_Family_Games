import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertSkeletonToLandmarks,
  mirrorLandmarks,
  extractDanceFeatures,
  crossfadeLandmarks,
  retimeMocapSequence,
} from '../public/src/shared/mocapConverter.js';
import { scoreDanceMove, danceFrameDistance } from '../public/src/shared/dtw.js';

test('Skeletal bone dictionary converts cleanly to normalized 33 MediaPipe landmarks', () => {
  const dummySkeleton = {
    mixamorigHead: { x: 0, y: 1.70, z: 0 },
    mixamorigHips: { x: 0, y: 0.95, z: 0 },
    mixamorigLeftArm: { x: -0.22, y: 1.45, z: 0 },
    mixamorigRightArm: { x: 0.22, y: 1.45, z: 0 },
    mixamorigLeftForeArm: { x: -0.30, y: 1.25, z: 0 },
    mixamorigRightForeArm: { x: 0.30, y: 1.25, z: 0 },
    mixamorigLeftHand: { x: -0.35, y: 1.10, z: 0.1 },
    mixamorigRightHand: { x: 0.35, y: 1.10, z: 0.1 },
    mixamorigLeftUpLeg: { x: -0.10, y: 0.90, z: 0 },
    mixamorigRightUpLeg: { x: 0.10, y: 0.90, z: 0 },
    mixamorigLeftLeg: { x: -0.10, y: 0.50, z: 0 },
    mixamorigRightLeg: { x: 0.10, y: 0.50, z: 0 },
    mixamorigLeftFoot: { x: -0.10, y: 0.08, z: 0.05 },
    mixamorigRightFoot: { x: 0.10, y: 0.08, z: 0.05 },
  };

  const lm = convertSkeletonToLandmarks(dummySkeleton, {
    targetShoulderWidth: 0.18,
    centerX: 0.5,
    centerY: 0.55,
  });

  assert.equal(lm.length, 33, 'MediaPipe landmark array must have exactly 33 landmarks');

  // Verify shoulders are normalized
  const shL = lm[11];
  const shR = lm[12];
  assert.equal(shL[3], 1.0, 'Left shoulder must be visible');
  assert.equal(shR[3], 1.0, 'Right shoulder must be visible');

  const shW = Math.hypot(shR[0] - shL[0], shR[1] - shL[1]);
  assert.ok(Math.abs(shW - 0.18) < 0.01, `Shoulder width should normalize to ~0.18, got ${shW.toFixed(3)}`);

  // Verify hands are below shoulders
  const wrL = lm[15];
  const wrR = lm[16];
  assert.ok(wrL[1] > shL[1], 'Wrist Y should be below shoulder Y in top-down screen coordinates');
  assert.ok(wrR[1] > shR[1], 'Wrist Y should be below shoulder Y in top-down screen coordinates');
});

test('Auto-mirroring inverts X coordinates and swaps bilateral left/right joints', () => {
  const dummySkeleton = {
    mixamorigLeftArm: { x: -0.20, y: 1.45, z: 0 },
    mixamorigRightArm: { x: 0.20, y: 1.45, z: 0 },
    mixamorigLeftHand: { x: -0.40, y: 1.80, z: 0 }, // Left hand raised high
    mixamorigRightHand: { x: 0.25, y: 1.00, z: 0 }, // Right hand low
  };

  const original = convertSkeletonToLandmarks(dummySkeleton, { mirror: false });
  const mirrored = mirrorLandmarks(original);

  // In original: left hand (15) was raised high (low Y in screen space)
  assert.ok(original[15][1] < original[16][1], 'Original left hand should be higher than right hand');

  // In mirrored: right hand (16) should now have the high posture previously on left hand
  assert.ok(mirrored[16][1] < mirrored[15][1], 'Mirrored right hand should now be higher than left hand');

  // Horizontal X coordinate reflection
  assert.ok(Math.abs((1.0 - original[15][0]) - mirrored[16][0]) < 1e-4, 'X coordinate must reflect across 0.5 center');
});

test('Dance feature extraction calculates relative hand vectors, lean, and twist', () => {
  const dummySkeleton = {
    mixamorigLeftArm: { x: -0.20, y: 1.45, z: 0 },
    mixamorigRightArm: { x: 0.20, y: 1.45, z: 0 },
    mixamorigLeftHand: { x: -0.20, y: 1.81, z: 0 }, // 1 shoulder width above shoulder
    mixamorigRightHand: { x: 0.20, y: 1.09, z: 0 }, // 1 shoulder width below shoulder
  };

  const lm = convertSkeletonToLandmarks(dummySkeleton, { targetShoulderWidth: 0.18 });
  const feat = extractDanceFeatures(lm);

  assert.ok(feat.handL.y > 0.8, `Left hand should measure high positive Y elevation, got ${feat.handL.y.toFixed(2)}`);
  assert.ok(feat.handR.y < -0.8, `Right hand should measure negative Y elevation, got ${feat.handR.y.toFixed(2)}`);
});

test('Crossfade smoothly interpolates between two landmark frames over alpha [0..1]', () => {
  const frameA = Array.from({ length: 33 }, () => [0.2, 0.4, 0.1, 1]);
  const frameB = Array.from({ length: 33 }, () => [0.8, 0.8, 0.3, 1]);

  const blendedStart = crossfadeLandmarks(frameA, frameB, 0.0);
  assert.equal(blendedStart[0][0], 0.2);

  const blendedMid = crossfadeLandmarks(frameA, frameB, 0.5);
  assert.ok(Math.abs(blendedMid[0][0] - 0.5) < 1e-4);
  assert.ok(Math.abs(blendedMid[0][1] - 0.6) < 1e-4);

  const blendedEnd = crossfadeLandmarks(frameA, frameB, 1.0);
  assert.equal(blendedEnd[0][0], 0.8);
});

test('Tempo retiming resamples mocap frame sequence to match target BPM', () => {
  const sourceBpm = 100;
  const targetBpm = 120; // 20% faster
  const sourceDuration = 2.0; // 2.0 seconds at 100 BPM

  const rawFrames = [];
  for (let t = 0; t <= sourceDuration; t += 1 / 30) {
    const dummy = {
      mixamorigLeftHand: { x: Math.sin(t * Math.PI) * 0.3, y: 1.5, z: 0 },
    };
    rawFrames.push({
      t,
      landmarks: convertSkeletonToLandmarks(dummy),
    });
  }

  const resampled = retimeMocapSequence(rawFrames, sourceBpm, targetBpm, 30);
  assert.ok(resampled.length > 0, 'Resampled array must not be empty');

  // At 120 BPM, 2.0s original clip retimes to 2.0 * (100 / 120) = 1.667s
  const finalTime = resampled[resampled.length - 1].t;
  const expectedDuration = sourceDuration * (sourceBpm / targetBpm);
  assert.ok(Math.abs(finalTime - expectedDuration) < 0.05, `Retimed duration should be ~${expectedDuration.toFixed(2)}s, got ${finalTime.toFixed(2)}s`);
});

test('DTW evaluates match score against baked mocap reference frames', () => {
  const targetMove = {
    id: 'mocap_samba',
    name: 'Mocap Samba',
    bpm: 112,
    frames: [
      { features: { handL: { x: -0.8, y: 0.9 }, handR: { x: 0.4, y: 0.4 }, lean: -0.6, twist: -0.4, kneeL: 0.5, kneeR: 0.1 } },
      { features: { handL: { x: -1.0, y: 1.2 }, handR: { x: 0.5, y: 0.5 }, lean: -0.8, twist: -0.5, kneeL: 0.6, kneeR: 0.1 } },
      { features: { handL: { x: -0.8, y: 0.9 }, handR: { x: 0.4, y: 0.4 }, lean: -0.6, twist: -0.4, kneeL: 0.5, kneeR: 0.1 } },
    ],
  };

  const playerFramesGood = [
    { handL: { x: -0.75, y: 0.85 }, handR: { x: 0.42, y: 0.38 }, lean: -0.55, torsoTwist: -0.38, kneeLiftL: 0.48, kneeLiftR: 0.12 },
    { handL: { x: -0.98, y: 1.18 }, handR: { x: 0.48, y: 0.52 }, lean: -0.78, torsoTwist: -0.48, kneeLiftL: 0.58, kneeLiftR: 0.10 },
    { handL: { x: -0.76, y: 0.88 }, handR: { x: 0.41, y: 0.42 }, lean: -0.58, torsoTwist: -0.39, kneeLiftL: 0.49, kneeLiftR: 0.11 },
  ];

  const result = scoreDanceMove(playerFramesGood, targetMove);
  assert.ok(result.match > 0.80, `Well-matched player motion against baked reference should score >0.80, got ${result.match.toFixed(3)}`);
});
