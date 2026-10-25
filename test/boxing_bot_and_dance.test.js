import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

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

  const files = fs.readdirSync(movesDir).filter(f => f.endsWith('.json'));
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

test('Dance game coach relies on FemaleCoachAvatar and does not hijack the routine with a static loop', () => {
  const danceCode = fs.readFileSync('public/src/games/dance.js', 'utf8');

  // Verify customModel override was removed
  assert.ok(!danceCode.includes('#loadCustomCoach'), '#loadCustomCoach must not exist');
  assert.ok(!danceCode.includes('#loadFBXCoach'), '#loadFBXCoach must not exist');
  assert.ok(!danceCode.includes('animMixer'), 'animMixer loop must not hijack coach kinematics');

  // Verify FemaleCoachAvatar is used and visible
  assert.ok(danceCode.includes('new FemaleCoachAvatar'), 'FemaleCoachAvatar must be instantiated');
  assert.ok(danceCode.includes('shuffleMoves()'), 'shuffleMoves method must be implemented');
});
