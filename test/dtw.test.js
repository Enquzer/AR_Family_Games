import test from 'node:test';
import assert from 'node:assert';
import { bandedDTW, scoreDanceMove } from '../public/src/shared/dtw.js';

test('Banded DTW correctly matches sequence with time warp / pace variation', () => {
  // A pattern that occurs at normal speed
  const ref = [0.1, 0.5, 0.9, 0.5, 0.1];
  // Player performs same pattern, but pauses longer at the peak (time warped)
  const player = [0.1, 0.5, 0.9, 0.9, 0.9, 0.5, 0.1];

  const distFn = (a, b) => Math.abs(a - b);
  const result = bandedDTW(player, ref, distFn, 3);

  // Normal Euclidean distance without DTW would be large due to length difference
  // DTW cost should be very low (< 0.05) because the sequence shape matches
  assert.ok(result.cost < 0.05, `DTW cost should be minimal for time-warped match, got ${result.cost}`);
});

test('scoreDanceMove detects mirror moves and awards high match score', () => {
  // Target move: Right hand raised high, left knee up
  const targetMove = {
    name: 'TEST POSE',
    hands: [[-0.5, 0.2], [0.8, 1.6]], // Left hand down, right hand up
    lean: 0.2,
    kneeL: 0.0,
    kneeR: 0.8,
    twist: 0.2,
  };

  // Mirrored player: Left hand raised high, right knee up
  const mirroredFrames = Array.from({ length: 8 }, () => ({
    handL: { x: -0.8, y: 1.6 }, // Mirror of target's right hand
    handR: { x: 0.5, y: 0.2 },  // Mirror of target's left hand
    lean: -0.2,
    kneeLiftL: 0.8,
    kneeLiftR: 0.0,
    torsoTwist: -0.2,
  }));

  const res = scoreDanceMove(mirroredFrames, targetMove);
  assert.equal(res.isMirror, true, 'Should detect that player mirrored the coach');
  assert.ok(res.match > 0.8, `Mirrored match score should be high (> 0.8), got ${res.match}`);
});

test('scoreDanceMove accurately measures early and late timing offsets', () => {
  const targetMove = {
    name: 'RAISE ROOF',
    hands: [[-0.7, 1.5], [0.7, 1.5]],
    lean: 0,
    kneeL: 0,
    kneeR: 0,
    twist: 0,
  };

  // On-time frames: peak occurs right at the center of the window (frame 5 of 10)
  const onTimeFrames = Array.from({ length: 10 }, (_, i) => {
    const isPeak = Math.abs(i - 5) <= 1;
    return {
      handL: { x: -0.7, y: isPeak ? 1.5 : 0.4 },
      handR: { x: 0.7, y: isPeak ? 1.5 : 0.4 },
      lean: 0,
      kneeLiftL: 0,
      kneeLiftR: 0,
      torsoTwist: 0,
    };
  });

  const onTimeRes = scoreDanceMove(onTimeFrames, targetMove);
  assert.ok(Math.abs(onTimeRes.timingOffsetMs) < 60, `On-time offset should be near 0ms, got ${onTimeRes.timingOffsetMs}ms`);

  // Early frames: peak occurs at frame 1 of 10
  const earlyFrames = Array.from({ length: 10 }, (_, i) => {
    const isPeak = Math.abs(i - 1) <= 1;
    return {
      handL: { x: -0.7, y: isPeak ? 1.5 : 0.4 },
      handR: { x: 0.7, y: isPeak ? 1.5 : 0.4 },
      lean: 0,
      kneeLiftL: 0,
      kneeLiftR: 0,
      torsoTwist: 0,
    };
  });

  const earlyRes = scoreDanceMove(earlyFrames, targetMove);
  assert.ok(earlyRes.timingOffsetMs < -50, `Early sequence should have negative timing offset, got ${earlyRes.timingOffsetMs}ms`);
});
