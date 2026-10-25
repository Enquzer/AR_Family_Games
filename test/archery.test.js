import test from 'node:test';
import assert from 'node:assert/strict';

test('Archery Olympic 10-ring scoring accurately scores concentric radial bands', () => {
  const TARGET_R = 0.614;

  function scoreShot(dist) {
    if (dist <= TARGET_R * 0.05) return { points: 10, isX: true, label: 'X' };
    if (dist <= TARGET_R * 0.1) return { points: 10, isX: false, label: '10' };
    if (dist <= TARGET_R * 0.2) return { points: 9, isX: false, label: '9' };
    if (dist <= TARGET_R * 0.3) return { points: 8, isX: false, label: '8' };
    if (dist <= TARGET_R * 0.4) return { points: 7, isX: false, label: '7' };
    if (dist <= TARGET_R * 0.5) return { points: 6, isX: false, label: '6' };
    if (dist <= TARGET_R * 0.6) return { points: 5, isX: false, label: '5' };
    if (dist <= TARGET_R * 0.7) return { points: 4, isX: false, label: '4' };
    if (dist <= TARGET_R * 0.8) return { points: 3, isX: false, label: '3' };
    if (dist <= TARGET_R * 0.9) return { points: 2, isX: false, label: '2' };
    if (dist <= TARGET_R * 1.0) return { points: 1, isX: false, label: '1' };
    return { points: 0, isX: false, label: 'MISS' };
  }

  // Bullseye X
  const sX = scoreShot(0.015);
  assert.equal(sX.points, 10);
  assert.equal(sX.isX, true);

  // 10 Ring Gold
  const s10 = scoreShot(0.045);
  assert.equal(s10.points, 10);
  assert.equal(s10.isX, false);

  // 9 Ring Gold
  const s9 = scoreShot(0.095);
  assert.equal(s9.points, 9);

  // 7 Ring Red
  const s7 = scoreShot(0.22);
  assert.equal(s7.points, 7);

  // 5 Ring Blue
  const s5 = scoreShot(0.35);
  assert.equal(s5.points, 5);

  // 3 Ring Black
  const s3 = scoreShot(0.46);
  assert.equal(s3.points, 3);

  // 1 Ring White
  const s1 = scoreShot(0.58);
  assert.equal(s1.points, 1);

  // Miss outside target boss
  const sMiss = scoreShot(0.75);
  assert.equal(sMiss.points, 0);
  assert.equal(sMiss.label, 'MISS');
});

test('Archery ballistics simulation calculates realistic flight time, drop, and wind drift', () => {
  const startZ = 0.8;
  const targetZ = -30.0;
  const speed = 46.0; // m/s
  const windX = 2.4;  // m/s crosswind to the right

  // Initial velocity
  let pos = { x: 0, y: 1.45, z: startZ };
  let vel = { x: 0, y: 3.2, z: -speed }; // Aim with slight loft
  const dt = 0.016; // 60 FPS
  let elapsed = 0;

  while (pos.z > targetZ && elapsed < 2.0) {
    vel.y -= 9.81 * dt;
    vel.x += windX * 0.45 * dt;

    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;
    elapsed += dt;
  }

  // Time to target at 30m should be approx 0.65 - 0.70 seconds
  assert.ok(elapsed >= 0.6 && elapsed <= 0.75, `Expected flight time around 0.67s, got ${elapsed}`);

  // Crosswind pushes arrow to the right (positive x, ~25cm drift across 30m)
  assert.ok(pos.x > 0.15, `Arrow should drift right due to positive wind, got ${pos.x}`);

  // Arrow drops due to gravity
  assert.ok(pos.y < 2.5 && pos.y > 0.5, `Arrow height at target should be realistic, got ${pos.y}`);
});
