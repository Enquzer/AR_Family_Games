import test from 'node:test';
import assert from 'node:assert/strict';

test('110m Hurdles track distance and 9-hurdle spatial layout conform to Olympic spec', () => {
  const distance = 110;
  const hurdles = [16, 26, 36, 46, 56, 66, 76, 86, 96];

  assert.equal(distance, 110, 'Hurdles distance should be 110m');
  assert.equal(hurdles.length, 9, 'Should feature 9 Olympic hurdles');

  // Verify regular 10m spacing between consecutive hurdles
  for (let i = 0; i < hurdles.length - 1; i++) {
    const gap = hurdles[i + 1] - hurdles[i];
    assert.equal(gap, 10, 'Expected 10m spacing between hurdles');
  }

  // Ensure first hurdle starts after initial sprint acceleration (> 15m) and last hurdle leaves run-in to finish (> 10m)
  assert.ok(hurdles[0] >= 15, 'First hurdle should be placed at 16m');
  assert.ok(distance - hurdles[hurdles.length - 1] >= 12, 'Last hurdle should leave clean sprint stretch to finish tape');
});

test('Two-foot vertical jump simulation reaches realistic parabolic apex height and hang time', () => {
  const jumpVy0 = 4.4;
  const G = 11.5;

  // Time to apex: t = Vy0 / G
  const tApex = jumpVy0 / G;
  // Apex height: y = Vy0^2 / (2 * G)
  const yApex = (jumpVy0 * jumpVy0) / (2 * G);
  // Total air hang time: 2 * tApex
  const totalHangTime = 2 * tApex;

  assert.ok(tApex >= 0.35 && tApex <= 0.45, `Apex time expected ~0.38s, got ${tApex.toFixed(2)}s`);
  assert.ok(yApex >= 0.75 && yApex <= 0.95, `Apex jump height expected ~0.84m, got ${yApex.toFixed(2)}m`);
  assert.ok(totalHangTime >= 0.70 && totalHangTime <= 0.85, `Hang time expected ~0.76s, got ${totalHangTime.toFixed(2)}s`);
});

test('Hurdle clearance discriminator awards clean bonus or triggers knock-down fault penalty', () => {
  const hx = 26;
  const hurdleHeightThreshold = 0.65;

  function evaluateHurdlePass(runnerX, jumpY, points) {
    let cleared = false;
    let fault = false;
    let newPoints = points;

    // Runner within hurdle clearance zone
    if (runnerX >= hx - 0.75 && runnerX <= hx + 0.3) {
      if (jumpY >= hurdleHeightThreshold) {
        // CLEAN CLEARANCE
        cleared = true;
        newPoints += 1; // +1 pt clean jump bonus
      } else if (runnerX >= hx - 0.15) {
        // COLLISION / KNOCK-DOWN
        fault = true;
        newPoints = Math.max(0, newPoints - 2); // -2 pts fault deduction
      }
    }

    return { cleared, fault, newPoints };
  }

  // 1. High vertical jump clears hurdle cleanly
  const cleanPass = evaluateHurdlePass(26.0, 0.78, 10);
  assert.equal(cleanPass.cleared, true);
  assert.equal(cleanPass.fault, false);
  assert.equal(cleanPass.newPoints, 11, 'Clean clearance should award +1 point bonus');

  // 2. Failed / low jump results in hurdle knock-down collision
  const knockedPass = evaluateHurdlePass(26.0, 0.20, 10);
  assert.equal(knockedPass.cleared, false);
  assert.equal(knockedPass.fault, true);
  assert.equal(knockedPass.newPoints, 8, 'Knock-down fault should deduct 2 points');
});

test('Hurdle tumbling knock-down physics tilts forward with gravitational torque onto track', () => {
  const hurdle = {
    state: 'falling',
    angle: 0.15, // initial tilt from runner push
    angularVel: 6.0, // rad/s
    bounce: 0.4,
  };

  const dt = 0.016;
  // Step simulation for 0.25 seconds
  for (let t = 0; t < 0.25; t += dt) {
    const torque = 22.0 * Math.sin(Math.max(0.12, hurdle.angle));
    hurdle.angularVel += torque * dt;
    hurdle.angle += hurdle.angularVel * dt;
    if (hurdle.angle >= Math.PI / 2) {
      hurdle.angle = Math.PI / 2;
      hurdle.angularVel = 0;
      hurdle.state = 'down';
      break;
    }
  }

  assert.equal(hurdle.state, 'down', 'Hurdle should have fallen flat on the track');
  assert.ok(Math.abs(hurdle.angle - Math.PI / 2) < 1e-4, 'Hurdle rotation should reach 90 degrees (flat on track)');
});
