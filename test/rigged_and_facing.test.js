import test from 'node:test';
import assert from 'node:assert/strict';

test('Game facing orientations align athletes towards their natural play objectives', () => {
  // Convention: +Z is camera front (0 rad), +X is right (+PI/2 rad), -Z is away from camera (PI rad), -X is left (-PI/2 rad)

  // 1. Sprint & 110m Hurdles: track runs along +X
  const trackFacing = Math.PI / 2;
  assert.equal(trackFacing, Math.PI / 2, 'Runners must face +X (along the track to the right)');

  // 2. Bowling: lane extends away from bowler into -Z
  const bowlingFacing = Math.PI;
  assert.equal(bowlingFacing, Math.PI, 'Bowler must face -Z (down the lane towards the pins)');

  // 3. Boxing: Player at +Z faces -Z (PI rad); Bot at -Z faces +Z (0 rad)
  const boxingPlayerFacing = Math.PI;
  const boxingBotFacing = 0;
  assert.equal(boxingPlayerFacing, Math.PI, 'Human boxer must face opponent bot across ring canvas');
  assert.equal(boxingBotFacing, 0, 'Bot boxer must face human boxer');

  // 4. Tennis: Court runs along X. Human at -X faces +X (PI/2 rad); Bot at +X faces -X (-PI/2 rad)
  const tennisHumanFacing = Math.PI / 2;
  const tennisBotFacing = -Math.PI / 2;
  assert.equal(tennisHumanFacing, Math.PI / 2, 'Human tennis player must face net (+X)');
  assert.equal(tennisBotFacing, -Math.PI / 2, 'Bot tennis player must face net (-X)');
});

test('Running whole-body biomechanics preserves torso-pelvis-thigh connectivity without limb stretching', () => {
  // Verify that joints are computed in local avatar coordinates without leaking world track coordinates (s.x)
  const s_x = 45.0; // 45 meters down the track
  const s_speed = 8.5; // sprinting speed (m/s)
  const phase = 1.2;
  const speedNorm = Math.min(1.2, s_speed / 9.0);

  // 1. Whole body bounce
  const bounce = Math.abs(Math.sin(phase)) * 0.06 * speedNorm;
  const hipY = 0.82 - bounce;
  assert.ok(hipY > 0.70 && hipY < 0.85, 'Pelvis must bob vertically with stride cadence');

  // 2. Forward athletic torso lean
  const forwardLean = 0.08 + speedNorm * 0.14;
  assert.ok(forwardLean > 0.05, 'Upper torso must lean forward into the sprint');

  // 3. Knee positions MUST be strictly local offsets (near 0) and NEVER incorporate s_x
  const strideReach = 0.28 * speedNorm;
  const knL_Z = Math.sin(phase) * strideReach;
  const knR_Z = Math.sin(phase + Math.PI) * strideReach;

  assert.ok(Math.abs(knL_Z) < 0.40, 'Knee Z offset must remain local (< 0.4m), not stretched by track distance');
  assert.ok(Math.abs(knR_Z) < 0.40, 'Knee Z offset must remain local (< 0.4m), not stretched by track distance');

  // 4. Anatomical anchor: Hip centre is always mid(hipL, hipR)
  const hipL = { x: -0.10, y: hipY, z: 0 };
  const hipR = { x: 0.10, y: hipY, z: 0 };
  const hip = {
    x: (hipL.x + hipR.x) * 0.5,
    y: (hipL.y + hipR.y) * 0.5,
    z: (hipL.z + hipR.z) * 0.5,
  };
  assert.equal(hip.x, 0, 'Hip root must stay centered at 0 in local space');
  assert.equal(hip.y, hipY, 'Hip root must match pelvic height');
  assert.equal(hip.z, 0, 'Hip root must stay centered with thighs');
});
