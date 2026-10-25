import test from 'node:test';
import assert from 'node:assert';
import { MultiPoseTracker } from '../public/src/vision/poseTracker.js';
import { hungarian } from '../public/src/shared/hungarian.js';
import { LM } from '../public/src/shared/pose.js';

function makePersonLandmarks(hipX, hipY, shoulderWidth = 0.12, bodyHeight = 0.45) {
  const lm = Array.from({ length: 33 }, () => ({ x: hipX, y: hipY, z: 0, visibility: 0.9 }));
  lm[LM.NOSE] = { x: hipX, y: hipY - bodyHeight * 0.7, z: 0, visibility: 0.95 };
  lm[LM.L_SHOULDER] = { x: hipX - shoulderWidth * 0.5, y: hipY - bodyHeight * 0.4, z: 0, visibility: 0.95 };
  lm[LM.R_SHOULDER] = { x: hipX + shoulderWidth * 0.5, y: hipY - bodyHeight * 0.4, z: 0, visibility: 0.95 };
  lm[LM.L_HIP] = { x: hipX - 0.05, y: hipY, z: 0, visibility: 0.95 };
  lm[LM.R_HIP] = { x: hipX + 0.05, y: hipY, z: 0, visibility: 0.95 };
  lm[LM.L_KNEE] = { x: hipX - 0.05, y: hipY + bodyHeight * 0.4, z: 0, visibility: 0.9 };
  lm[LM.R_KNEE] = { x: hipX + 0.05, y: hipY + bodyHeight * 0.4, z: 0, visibility: 0.9 };
  lm[LM.L_ANKLE] = { x: hipX - 0.05, y: hipY + bodyHeight * 0.8, z: 0, visibility: 0.9 };
  lm[LM.R_ANKLE] = { x: hipX + 0.05, y: hipY + bodyHeight * 0.8, z: 0, visibility: 0.9 };
  return lm;
}

test('Hungarian algorithm finds global minimum bipartite match', () => {
  // 3x3 cost matrix
  const cost = [
    [10, 2, 8],
    [1, 9, 7],
    [6, 5, 3],
  ];
  const match = hungarian(cost);
  // Optimal: 0->1 (cost 2), 1->0 (cost 1), 2->2 (cost 3), total = 6
  assert.deepEqual(match, [1, 0, 2]);
});

test('MultiPoseTracker requires tentative confirmation hits before emitting tracks', () => {
  const tracker = new MultiPoseTracker({ tentativeHits: 3, tentativeWindow: 5 });
  const p1 = makePersonLandmarks(0.4, 0.5);

  // Frame 1: tentative (not yet confirmed)
  let active = tracker.update([p1], 1000);
  assert.equal(active.length, 0, 'Frame 1 should be tentative');

  // Frame 2: tentative (hits = 2)
  active = tracker.update([p1], 1033);
  assert.equal(active.length, 0, 'Frame 2 should still be tentative');

  // Frame 3: confirmed! (hits = 3)
  active = tracker.update([p1], 1066);
  assert.equal(active.length, 1, 'Frame 3 should confirm the track');
  assert.equal(active[0].id, 1);
});

test('MultiPoseTracker preserves track identities when two players cross', () => {
  const tracker = new MultiPoseTracker({ tentativeHits: 1 }); // Instant confirmation for crossing test

  // Player 1 moves from left (0.3) to right (0.7)
  // Player 2 moves from right (0.7) to left (0.3)
  let p1X = 0.3;
  let p2X = 0.7;
  let time = 1000;

  // Initial detection
  let tracks = tracker.update([makePersonLandmarks(p1X, 0.5), makePersonLandmarks(p2X, 0.5)], time);
  assert.equal(tracks.length, 2);
  const idLeft = tracks.find((t) => t.hip.x < 0.5).id;
  const idRight = tracks.find((t) => t.hip.x > 0.5).id;

  // Step 20 frames as they cross each other at x = 0.5
  for (let frame = 1; frame <= 20; frame++) {
    time += 33;
    p1X += 0.02; // moves right
    p2X -= 0.02; // moves left
    tracks = tracker.update([makePersonLandmarks(p1X, 0.5), makePersonLandmarks(p2X, 0.5)], time);
  }

  // After crossing: p1 is now at ~0.7, p2 is now at ~0.3
  const trackAtRight = tracks.find((t) => t.hip.x > 0.6);
  const trackAtLeft = tracks.find((t) => t.hip.x < 0.4);

  assert.ok(trackAtRight, 'Should have track at right');
  assert.ok(trackAtLeft, 'Should have track at left');
  assert.equal(trackAtRight.id, idLeft, 'Player 1 should retain original ID after crossing');
  assert.equal(trackAtLeft.id, idRight, 'Player 2 should retain original ID after crossing');
});
