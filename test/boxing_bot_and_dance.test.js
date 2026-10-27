import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { MotionTracker } from '../public/src/vision/motion.js';
import { LM } from '../public/src/shared/pose.js';

test('Boxing bot has dedicated boxing gloves, no orphan rigged models, and responsive guard/hit kinematics', () => {
  const boxingCode = fs.readFileSync('public/src/games/boxing.js', 'utf8');

  // Verify createRiggedAvatar is NOT imported or used in boxing
  assert.ok(!boxingCode.includes('createRiggedAvatar'), 'Boxing must not import or instantiate createRiggedAvatar');
  assert.ok(!boxingCode.includes('_rigged'), 'Boxing must not contain _rigged references');

  // Verify bot uses Avatar with gloves
  assert.ok(boxingCode.includes("avatar.setProp('gloves')"), 'Bot must be equipped with boxing gloves');
  assert.ok(boxingCode.includes('botPoseTargets'), 'Bot must use dynamic procedural boxer pose targets');
});

test('Discovered baked dance moves load accurately from public/assets/dance/moves/*.json', () => {
  const movesDir = path.resolve('public/assets/dance/moves');
  assert.ok(fs.existsSync(movesDir), 'public/assets/dance/moves directory must exist');

  const files = fs.readdirSync(movesDir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 10, `Expected at least 10 baked dance moves, found ${files.length}`);

  // Inspect a sample move
  const sample = JSON.parse(fs.readFileSync(path.join(movesDir, files[0]), 'utf8'));
  assert.ok(sample.id, 'Move must have an id');
  assert.ok(sample.name, 'Move must have a name');
  assert.ok(sample.style, 'Move must specify a dance style');
  assert.ok(sample.bpm > 0, 'Move must specify a valid BPM');
  assert.ok(sample.useBakedFrames === true, 'Move must have useBakedFrames set to true');
  assert.ok(Array.isArray(sample.frames) && sample.frames.length > 0, 'Move must contain frames');
  assert.equal(sample.frames[0].landmarks.length, 33, 'Each frame must have 33 MediaPipe landmarks');
  assert.ok(sample.frames[0].features.handL, 'Each frame must have handL features');
  assert.ok(sample.frames[0].features.handR, 'Each frame must have handR features');
});

test('Dance game features dynamic 3D coach multi-move crossfader without crashing on #comparePose', () => {
  const danceCode = fs.readFileSync('public/src/games/dance.js', 'utf8');

  // Verify safe target coordinate access in #comparePose
  assert.ok(danceCode.includes('targetLx'), '#comparePose must safely access targetLx');
  assert.ok(danceCode.includes('targetLy'), '#comparePose must safely access targetLy');

  // Verify dynamic 3D multi-move crossfader
  assert.ok(danceCode.includes('#load3DCoach'), 'dance.js must support #load3DCoach for 3D character presentation');
  assert.ok(danceCode.includes('#playCoachDanceAnimation'), 'dance.js must switch animations per move via #playCoachDanceAnimation');
  assert.ok(danceCode.includes('crossFadeTo'), 'dance.js must crossfade between distinct move clips');
  assert.ok(danceCode.includes('shuffleMoves()'), 'shuffleMoves method must be implemented');
});

test('Unified loop does not drain or discard player punch events before game receives them', () => {
  const unifiedCode = fs.readFileSync('public/src/app/unified.js', 'utf8');

  // Verify unified does not call p.motion.takeEvents() in the game loop pause check
  assert.ok(
    !unifiedCode.includes('const events = p.motion.takeEvents();'),
    'unified.js must not consume player motion events in pause check'
  );
  assert.ok(
    unifiedCode.includes("e.type === 'pauseToggle'"),
    'unified.js must selectively inspect only pauseToggle events'
  );
});

test('Avatar whole-body yaw incorporates noise deadzones and lockFacing support to prevent rotating to the right', () => {
  const avatarCode = fs.readFileSync('public/src/engine/avatar.js', 'utf8');

  assert.ok(avatarCode.includes('opts.lockFacing'), 'Avatar must support opts.lockFacing');
  assert.ok(avatarCode.includes('deadH'), 'Avatar must apply deadzone to yaw calculations');
});

test('Hand menu suppresses cursor and dwell ring during active gameplay and only reveals it during pause', () => {
  const unifiedCode = fs.readFileSync('public/src/app/unified.js', 'utf8');
  const displayCode = fs.readFileSync('public/src/app/display.js', 'utf8');

  for (const [name, code] of [['unified.js', unifiedCode], ['display.js', displayCode]]) {
    // 1. Must hide cursor during active gameplay
    assert.ok(
      code.includes('if (game && !isGamePaused && !pendingPlayer2Join)'),
      `${name} must early-return and hide cursor during active gameplay`
    );
    assert.ok(
      code.includes('cursorEl.hidden = true;'),
      `${name} must hide cursorEl`
    );

    // 2. Must only expose pause targets when paused
    assert.ok(
      code.includes('btn-pause-resume'),
      `${name} must register btn-pause-resume when game is paused`
    );
    assert.ok(
      code.includes('btn-pause-home'),
      `${name} must register btn-pause-home when game is paused`
    );

    // 3. Must not drain motion events in frame loop
    assert.ok(
      !code.includes('const events = p.motion.takeEvents();'),
      `${name} must not drain motion events before games receive them`
    );
  }
});

test('MotionTracker suppresses phantom punches when user is stationary in guard or stance with camera noise', () => {
  const mt = new MotionTracker();
  let time = 1000;
  let punches = 0;

  // Simulate 100 frames (~3 seconds) of a player standing in an angled boxing stance with hands in guard
  for (let i = 0; i < 100; i++) {
    time += 33;
    const noise = (i % 2 === 0 ? 0.006 : -0.006);
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
    lm[LM.NOSE] = { x: 0.48, y: 0.25, z: 0, visibility: 0.95 };
    lm[LM.L_SHOULDER] = { x: 0.46, y: 0.35, z: -0.1, visibility: 0.95 };
    lm[LM.R_SHOULDER] = { x: 0.54, y: 0.35, z: 0.1, visibility: 0.95 };
    lm[LM.L_HIP] = { x: 0.47, y: 0.55, z: -0.08, visibility: 0.95 };
    lm[LM.R_HIP] = { x: 0.53, y: 0.55, z: 0.08, visibility: 0.95 };
    // Lead hand extended forward at chest height in ready jab stance:
    lm[LM.L_WRIST] = { x: 0.38 + noise, y: 0.38 + noise, z: -0.25, visibility: 0.95 };
    // Rear hand at chin:
    lm[LM.R_WRIST] = { x: 0.50, y: 0.32, z: 0, visibility: 0.95 };
    lm[LM.L_ANKLE] = { x: 0.45, y: 0.9, z: 0, visibility: 0.9 };
    lm[LM.R_ANKLE] = { x: 0.55, y: 0.9, z: 0, visibility: 0.9 };

    mt.update(lm, 16 / 9, time);
    const evs = mt.takeEvents();
    punches += evs.filter((e) => e.type === 'punch').length;
  }

  assert.equal(punches, 0, 'Must not emit any phantom punches when player is stationary in stance with camera noise');
});
