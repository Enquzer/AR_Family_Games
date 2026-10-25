import test from 'node:test';
import assert from 'node:assert';
import { OneEuro, LandmarkFilter } from '../public/src/shared/oneEuro.js';

test('OneEuro filter reduces jitter on noisy stationary signal', () => {
  const filter = new OneEuro(1.2, 5.0, 1.5);
  const groundTruth = 0.5;
  const noisyInputs = [];
  const outputs = [];

  for (let i = 0; i < 60; i++) {
    const t = i * 0.016; // 60 FPS
    const noise = (Math.sin(i * 12.3) * 0.02) + (Math.cos(i * 4.7) * 0.015);
    const val = groundTruth + noise;
    noisyInputs.push(val);
    outputs.push(filter.filter(val, t, 1.0));
  }

  // Calculate variances
  const meanNoise = noisyInputs.reduce((a, b) => a + b) / noisyInputs.length;
  const inVariance = noisyInputs.reduce((a, b) => a + Math.pow(b - meanNoise, 2), 0) / noisyInputs.length;

  const meanOut = outputs.reduce((a, b) => a + b) / outputs.length;
  const outVariance = outputs.reduce((a, b) => a + Math.pow(b - meanOut, 2), 0) / outputs.length;

  // Filter should reduce variance significantly (> 50% jitter reduction)
  assert.ok(outVariance < inVariance * 0.5, `Output variance (${outVariance}) should be much smaller than input (${inVariance})`);
});

test('OneEuro filter quickly tracks fast strike onset with minimal lag', () => {
  const filter = new OneEuro(1.2, 5.0, 1.5);
  let t = 0;

  // Settle at 0.0
  for (let i = 0; i < 30; i++) {
    t += 0.016;
    filter.filter(0.0, t, 1.0);
  }

  // Fast forward punch burst
  t += 0.016;
  const punchVal = 1.0;
  const filteredPunch = filter.filter(punchVal, t, 1.0);

  // Beta responds to high derivative: should follow quickly (> 0.5 on frame 1)
  assert.ok(filteredPunch > 0.45, `Filtered punch onset (${filteredPunch}) should respond promptly to rapid strike`);
});

test('OneEuro filter holds value when joint is severely occluded', () => {
  const filter = new OneEuro(1.2, 5.0, 1.5);
  let t = 0;

  for (let i = 0; i < 10; i++) {
    t += 0.016;
    filter.filter(0.75, t, 1.0);
  }

  // Severe occlusion: confidence = 0.05
  t += 0.016;
  const occludedOutput = filter.filter(0.1, t, 0.05);

  // Filter should hold last known reliable value (~0.75) instead of jumping to 0.1
  assert.ok(Math.abs(occludedOutput - 0.75) < 0.05, `Filter should hold position during occlusion, got ${occludedOutput}`);
});

test('LandmarkFilter applies dual stream smooth and fast', () => {
  const lmf = new LandmarkFilter();
  const fakeLandmarks = Array.from({ length: 33 }, (_, i) => ({
    x: 0.5 + i * 0.01,
    y: 0.5,
    z: 0.0,
    visibility: 0.9,
  }));

  const res1 = lmf.apply(fakeLandmarks, 1.0, 16 / 9);
  assert.equal(res1.smooth.length, 33);
  assert.equal(res1.fast.length, 33);

  // Step with fast wrist motion
  const movedLandmarks = fakeLandmarks.map((p, i) => i === 16 ? { ...p, x: p.x + 0.3 } : p);
  const res2 = lmf.apply(movedLandmarks, 1.033, 16 / 9);

  // Fast stream should lead smooth stream on the moving joint
  assert.ok(res2.fast[16].x > res2.smooth[16].x, 'Fast stream should have higher responsiveness than smooth stream');
});
