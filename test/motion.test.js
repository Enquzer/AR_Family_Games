import test from 'node:test';
import assert from 'node:assert';
import { MotionTracker } from '../public/src/vision/motion.js';
import { LM } from '../public/src/shared/pose.js';

function makeBasePose(wristLx = 0.4, wristLy = 0.45, wristRx = 0.6, wristRy = 0.45, z = 0) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
  lm[LM.NOSE] = { x: 0.5, y: 0.25, z: 0, visibility: 0.95 };
  lm[LM.L_SHOULDER] = { x: 0.4, y: 0.35, z: 0, visibility: 0.95 };
  lm[LM.R_SHOULDER] = { x: 0.6, y: 0.35, z: 0, visibility: 0.95 };
  lm[LM.L_HIP] = { x: 0.45, y: 0.55, z: 0, visibility: 0.95 };
  lm[LM.R_HIP] = { x: 0.55, y: 0.55, z: 0, visibility: 0.95 };
  lm[LM.L_WRIST] = { x: wristLx, y: wristLy, z, visibility: 0.95 };
  lm[LM.R_WRIST] = { x: wristRx, y: wristRy, z, visibility: 0.95 };
  lm[LM.L_ANKLE] = { x: 0.45, y: 0.9, z: 0, visibility: 0.9 };
  lm[LM.R_ANKLE] = { x: 0.55, y: 0.9, z: 0, visibility: 0.9 };
  return lm;
}

test('MotionTracker detects metric worldLandmarks forward punch', () => {
  const mt = new MotionTracker();
  let time = 1000;

  // Frame 1: player at rest
  const baseLm = makeBasePose();
  const worldAtRest = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.95 }));
  mt.update(baseLm, 16 / 9, time, worldAtRest);

  // Frame 2: Right arm shoots forward with full extension toward camera
  time += 33;
  const punchLm1 = makeBasePose(0.4, 0.45, 0.85, 0.36, -0.25);
  const worldPunch1 = Array.from({ length: 33 }, (_, i) => i === LM.R_WRIST ? { x: 0.4, y: 0.05, z: -0.5, visibility: 0.95 } : { x: 0, y: 0, z: 0, visibility: 0.95 });
  mt.update(punchLm1, 16 / 9, time, worldPunch1);

  // Frame 3: Peak impact
  time += 33;
  const punchLm2 = makeBasePose(0.4, 0.45, 0.88, 0.36, -0.32);
  const worldPunch2 = Array.from({ length: 33 }, (_, i) => i === LM.R_WRIST ? { x: 0.45, y: 0.05, z: -0.65, visibility: 0.95 } : { x: 0, y: 0, z: 0, visibility: 0.95 });
  mt.update(punchLm2, 16 / 9, time, worldPunch2);

  const events = mt.takeEvents();
  const punchEv = events.find((e) => e.type === 'punch' && e.hand === 'R');

  assert.ok(punchEv, 'Should detect forward metric punch event');
  assert.ok(punchEv.power > 0.4, `Punch power should be solid, got ${punchEv.power}`);
});

test('MotionTracker detects wave-to-join oscillation and locks out phantom strikes', () => {
  const mt = new MotionTracker();
  let time = 1000;

  // Sweep right
  for (let i = 0; i < 6; i++) {
    time += 33;
    const lm = makeBasePose(0.4, 0.45, 0.5 + i * 0.05, 0.15);
    mt.update(lm, 16 / 9, time);
  }

  // Sweep left
  for (let i = 0; i < 8; i++) {
    time += 33;
    const lm = makeBasePose(0.4, 0.45, 0.75 - i * 0.05, 0.15);
    mt.update(lm, 16 / 9, time);
  }

  // Sweep right again
  for (let i = 0; i < 8; i++) {
    time += 33;
    const lm = makeBasePose(0.4, 0.45, 0.4 + i * 0.05, 0.15);
    mt.update(lm, 16 / 9, time);
  }

  assert.ok(mt.waveAt > 0, 'Wave-to-join should be recognized');
  assert.ok(mt.waveProgress >= 1.0, 'Wave progress should reach 100%');

  // Verify that during wave lockout, no phantom punch events are emitted
  const events = mt.takeEvents();
  assert.ok(events.some((e) => e.type === 'wave'), 'Events should include wave');
  assert.ok(!events.some((e) => e.type === 'punch'), 'Wave should lock out punch');
});
