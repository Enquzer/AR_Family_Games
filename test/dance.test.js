import test from 'node:test';
import assert from 'node:assert/strict';

test('Dance routine tempo progression accelerates smoothly across 5 styles', () => {
  const bpmProgression = [96, 96, 96, 104, 112, 112, 116, 120, 120, 126, 126, 128, 132, 134, 134, 136, 136, 138, 142, 142];

  // 1. Initial warm-up groove tempo should start moderate (~96 BPM)
  assert.equal(bpmProgression[0], 96, 'Warm-up should start at 96 BPM');

  // 2. Final climax tempo should reach high party energy (142 BPM)
  assert.equal(bpmProgression[bpmProgression.length - 1], 142, 'Finale should accelerate to 142 BPM');

  // 3. Monotonically non-decreasing tempo progression
  for (let i = 0; i < bpmProgression.length - 1; i++) {
    assert.ok(
      bpmProgression[i + 1] >= bpmProgression[i],
      `Tempo must not decelerate mid-routine: step ${i} was ${bpmProgression[i]}, step ${i + 1} was ${bpmProgression[i + 1]}`
    );
  }
});

test('Samba dance kinematics generate harmonic figure-8 hip rolls and Cuban pelvis tilt', () => {
  const bpm = 112;
  const sambaFreq = (bpm / 60) * Math.PI;

  function computeSambaHips(localTime, hipAmp = 0.95) {
    const hipX = Math.sin(localTime * sambaFreq) * 0.22 * hipAmp;
    const hipZ = Math.sin(localTime * sambaFreq * 2) * 0.12 * hipAmp;
    const pelvisTilt = Math.sin(localTime * sambaFreq) * 0.26 * hipAmp;
    return { hipX, hipZ, pelvisTilt };
  }

  // At quarter phase: maximum lateral hip sway
  const tQuarter = 0.5 / (bpm / 60);
  const qHips = computeSambaHips(tQuarter);
  assert.ok(Math.abs(qHips.hipX) > 0.15, `Expected substantial lateral hip sway, got ${qHips.hipX.toFixed(3)}m`);
  assert.ok(Math.abs(qHips.pelvisTilt) > 0.18, `Expected Cuban pelvis tilt, got ${qHips.pelvisTilt.toFixed(3)} rad`);

  // Over full cycle, front-back roll creates figure-8 (double frequency)
  const tEighth = 0.25 / (bpm / 60);
  const eHips = computeSambaHips(tEighth);
  assert.ok(Math.abs(eHips.hipZ) > 0.08, `Expected figure-8 front/back depth roll, got ${eHips.hipZ.toFixed(3)}m`);
});

test('Dance knee bounce compresses vertically on beat downbeat', () => {
  const bpm = 120;
  const beatSec = 60 / bpm; // 0.5s per beat

  function computeKneeBounce(t) {
    const beatPhase = (t / beatSec) % 1;
    const bounce = Math.abs(Math.sin(beatPhase * Math.PI));
    const bounceY = (1 - bounce) * 0.12;
    return bounceY;
  }

  // Exactly on the beat downbeat (t = 0, 0.5, 1.0): maximum knee compression
  const downbeat = computeKneeBounce(0);
  assert.ok(downbeat >= 0.11, `Expected full knee compression on beat, got ${downbeat.toFixed(3)}m`);

  // Halfway through the beat (t = 0.25s): leg extension/spring
  const upbeat = computeKneeBounce(0.25);
  assert.ok(upbeat <= 0.02, `Expected knee extension between beats, got ${upbeat.toFixed(3)}m`);
});

test('Dance scoring formula rewards energetic form and combo streaks while blocking motionless standing', () => {
  function computeDanceScore(match, energy, combo) {
    const energyFactor = Math.min(1.35, Math.max(0.25, 0.25 + energy * 1.15));
    const comboMult = 1 + Math.min(2.5, Math.max(0, combo * 0.08));
    const points = Math.round(Math.pow(Math.min(1, Math.max(0, match)), 1.3) * 220 * energyFactor * comboMult);
    return points;
  }

  // 1. Standing motionless (energy = 0): low points even if pose happens to match static target
  const stillScore = computeDanceScore(0.8, 0.0, 0);
  assert.ok(stillScore < 50, `Motionless standing must not score well: got ${stillScore}`);

  // 2. High-energy groove (energy = 0.85, match = 0.9, combo = 0): strong points
  const activeScore = computeDanceScore(0.9, 0.85, 0);
  assert.ok(activeScore > 200, `Energetic match should award high score: got ${activeScore}`);

  // 3. High combo multiplier (combo = 10 -> 1.8x multiplier)
  const comboScore = computeDanceScore(0.9, 0.85, 10);
  assert.ok(comboScore > activeScore * 1.6, `Combo multiplier should scale points: got ${comboScore} vs base ${activeScore}`);
});
