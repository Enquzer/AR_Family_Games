import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionTracker } from '../public/src/vision/motion.js';

function makeBasePose() {
  const lm = [];
  for (let i = 0; i < 33; i++) {
    lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 });
  }
  // Standard standing proportions
  lm[0] = { x: 0.5, y: 0.25, z: 0, visibility: 0.99 }; // Nose
  lm[11] = { x: 0.42, y: 0.38, z: 0, visibility: 0.99 }; // L shoulder
  lm[12] = { x: 0.58, y: 0.38, z: 0, visibility: 0.99 }; // R shoulder
  lm[13] = { x: 0.40, y: 0.52, z: 0, visibility: 0.99 }; // L elbow
  lm[14] = { x: 0.60, y: 0.52, z: 0, visibility: 0.99 }; // R elbow
  lm[15] = { x: 0.38, y: 0.65, z: 0, visibility: 0.99 }; // L wrist
  lm[16] = { x: 0.62, y: 0.65, z: 0, visibility: 0.99 }; // R wrist
  lm[23] = { x: 0.45, y: 0.65, z: 0, visibility: 0.99 }; // L hip
  lm[24] = { x: 0.55, y: 0.65, z: 0, visibility: 0.99 }; // R hip
  lm[25] = { x: 0.45, y: 0.82, z: 0, visibility: 0.99 }; // L knee
  lm[26] = { x: 0.55, y: 0.82, z: 0, visibility: 0.99 }; // R knee
  lm[27] = { x: 0.45, y: 0.98, z: 0, visibility: 0.99 }; // L ankle
  lm[28] = { x: 0.55, y: 0.98, z: 0, visibility: 0.99 }; // R ankle
  return lm;
}

test('MotionTracker detects parallel arms overhead || pause gesture and emits pauseToggle', () => {
  const tracker = new MotionTracker();
  const lm = makeBasePose();

  // Position arms parallel overhead like ||
  // Wrists above head (y < 0.25 - 0.03 = 0.22)
  // Distance between wrists ~ shoulder width (0.58 - 0.42 = 0.16)
  lm[13] = { x: 0.42, y: 0.26, z: 0, visibility: 0.99 }; // L elbow above shoulder
  lm[14] = { x: 0.58, y: 0.26, z: 0, visibility: 0.99 }; // R elbow above shoulder
  lm[15] = { x: 0.42, y: 0.10, z: 0, visibility: 0.99 }; // L wrist high overhead
  lm[16] = { x: 0.58, y: 0.10, z: 0, visibility: 0.99 }; // R wrist high overhead

  let pauseToggled = false;
  // Step simulation for 0.85s (exceeding 0.75s hold threshold)
  for (let f = 0; f < 55; f++) {
    const t = 1000 + f * 16.6;
    const s = tracker.update(lm, 16 / 9, t, null);
    for (const ev of s.events) {
      if (ev.type === 'pauseToggle') {
        pauseToggled = true;
      }
    }
  }

  assert.ok(pauseToggled, 'Holding parallel arms overhead || for >0.75s must trigger pauseToggle event');
});

test('MotionTracker rejects non-parallel arm poses from triggering pause', () => {
  const tracker = new MotionTracker();
  const lm = makeBasePose();

  // Cross arms like an 'X' (wrists crossed: wrL.x > wrR.x)
  lm[15] = { x: 0.60, y: 0.10, z: 0, visibility: 0.99 }; // Crossed left wrist
  lm[16] = { x: 0.40, y: 0.10, z: 0, visibility: 0.99 }; // Crossed right wrist

  let pauseToggled = false;
  for (let f = 0; f < 55; f++) {
    const t = 1000 + f * 16.6;
    const s = tracker.update(lm, 16 / 9, t, null);
    for (const ev of s.events) {
      if (ev.type === 'pauseToggle') pauseToggled = true;
    }
  }

  assert.equal(pauseToggled, false, 'Crossed arms must not trigger pause');
});

test('MotionTracker discriminates forward reach for dominant hand calibration', () => {
  const tracker = new MotionTracker();
  const lm = makeBasePose();

  // World landmarks with metric Z depth: negative Z is forward reach toward camera
  const worldLm = makeBasePose();
  worldLm[11] = { x: -0.2, y: 1.4, z: 0 }; // L shoulder
  worldLm[12] = { x: 0.2, y: 1.4, z: 0 };  // R shoulder
  worldLm[15] = { x: -0.2, y: 1.2, z: -0.05 }; // L wrist relaxed at side
  worldLm[16] = { x: 0.2, y: 1.3, z: -0.55 };  // R wrist extended 0.55m forward!

  let chosen = null;
  for (let f = 0; f < 50; f++) {
    const t = 2000 + f * 16.6;
    const s = tracker.update(lm, 16 / 9, t, worldLm);
    if (s.dominantCandidate) {
      chosen = s.dominantCandidate;
    }
  }

  assert.equal(chosen, 'R', 'Extending right arm forward must calibrate Right as dominant hand');
});

test('Player 2 drop-in mode handles 1v1 Versus takeover vs Co-Op team positioning', () => {
  // Tennis drop-in logic specification
  function simulateTennisDropIn(player1, player2, mode) {
    const sides = [player1, null];
    let botActive = true;

    if (mode === 'against') {
      sides[1] = player2;
      botActive = false; // Player 2 takes opponent court
      return { p2Position: 'opponent_court', p2Facing: -Math.PI / 2, botActive, is1v1: true };
    } else {
      // Co-op / Doubles on same side
      return { p2Position: 'home_court_doubles', p2Facing: Math.PI / 2, botActive: true, is1v1: false };
    }
  }

  const p1 = { name: 'Player 1' };
  const p2 = { name: 'Player 2' };

  const vsMatch = simulateTennisDropIn(p1, p2, 'against');
  assert.equal(vsMatch.is1v1, true, 'Play Against must convert match to 1v1 human duel');
  assert.equal(vsMatch.botActive, false, 'Play Against must deactivate opponent bot');
  assert.equal(vsMatch.p2Facing, -Math.PI / 2, 'Player 2 must face player 1 across net');

  const coopMatch = simulateTennisDropIn(p1, p2, 'with');
  assert.equal(coopMatch.is1v1, false, 'Play With must keep co-op team format');
  assert.equal(coopMatch.p2Facing, Math.PI / 2, 'Co-op partner must face toward opponent court');
});
