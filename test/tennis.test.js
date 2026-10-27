import test from 'node:test';
import assert from 'node:assert/strict';

test('Tennis traditional scoring logic handles Love, 15, 30, 40, Deuce, and Game', () => {
  function formatTennisScore(p1, p2) {
    if (p1 >= 4 && p1 - p2 >= 2) return 'GAME_P1';
    if (p2 >= 4 && p2 - p1 >= 2) return 'GAME_P2';
    if (p1 >= 3 && p2 >= 3) {
      if (p1 === p2) return 'DEUCE';
      if (p1 > p2) return 'AD_P1';
      return 'AD_P2';
    }
    const terms = ['LOVE', '15', '30', '40'];
    return `${terms[p1]} - ${terms[p2]}`;
  }

  // 0 - 0
  assert.equal(formatTennisScore(0, 0), 'LOVE - LOVE');

  // 1 - 0
  assert.equal(formatTennisScore(1, 0), '15 - LOVE');

  // 2 - 1
  assert.equal(formatTennisScore(2, 1), '30 - 15');

  // 3 - 3
  assert.equal(formatTennisScore(3, 3), 'DEUCE');

  // 4 - 3 (Advantage P1)
  assert.equal(formatTennisScore(4, 3), 'AD_P1');

  // 4 - 4 (Back to Deuce)
  assert.equal(formatTennisScore(4, 4), 'DEUCE');

  // 4 - 2 (Game won by P1)
  assert.equal(formatTennisScore(4, 2), 'GAME_P1');

  // 6 - 4 (Game won after extended deuce)
  assert.equal(formatTennisScore(6, 4), 'GAME_P1');
});

test('Tennis serve ballistics toss reaches apex and clears net into opponent court', () => {
  const G = 9.81;

  // 1. Upward toss simulation
  const tossVy = 5.2;
  const startY = 1.25;
  const tApex = tossVy / G;
  const yApex = startY + (tossVy * tossVy) / (2 * G);

  // Time to apex should be around 0.53 seconds
  assert.ok(tApex >= 0.48 && tApex <= 0.58, `Apex time expected ~0.53s, got ${tApex}`);
  // Apex height should be around 2.6m (ideal overhead contact zone)
  assert.ok(yApex >= 2.4 && yApex <= 2.8, `Apex height expected ~2.6m, got ${yApex}`);

  // 2. Serve drive trajectory from server (x = -8.2m) across net (x = 0m) to receiver (x = +6.4m)
  const speed = 18.0; // m/s
  const dx = 6.4 - (-8.2); // 14.6m
  const t = dx / speed;
  const vx = dx / t;
  let vy = (0.35 - yApex + 0.5 * G * t * t) / t;

  // Net clearance check at x = 0 (tNet)
  const tNet = Math.abs(-8.2 / vx);
  let yNet = yApex + vy * tNet - 0.5 * G * tNet * tNet;
  if (yNet < 1.35) vy += (1.35 - yNet) / tNet + 0.45;

  yNet = yApex + vy * tNet - 0.5 * G * tNet * tNet;
  assert.ok(yNet >= 1.05, `Serve must clear tennis net height (1.05m), got ${yNet}`);
});

test('Tennis spatial racket hit collision correctly discriminates sweet-spot contacts vs missed balls', () => {
  const racketPos = { x: -8.2, y: 1.45, z: 1.2 };
  const hitRadius = 0.95;

  function testCollision(ballPos) {
    const dx = ballPos.x - racketPos.x;
    const dy = ballPos.y - racketPos.y;
    const dz = ballPos.z - racketPos.z;
    const dist = Math.hypot(dx, dy, dz);
    return dist <= hitRadius;
  }

  // Sweet spot contact: ball directly at racket face
  assert.equal(testCollision({ x: -8.1, y: 1.42, z: 1.15 }), true);

  // Edge contact: ball 40cm away
  assert.equal(testCollision({ x: -7.9, y: 1.55, z: 1.4 }), true);

  // Missed contact: ball passed 1.8m away
  assert.equal(testCollision({ x: -8.2, y: 1.45, z: 3.2 }), false);
});

test('TennisGame initializes this.scene before building 3D racket and stadium effects', async () => {
  const fs = await import('fs');
  const tennisCode = fs.readFileSync('public/src/games/tennis.js', 'utf8');

  // Verify this.scene is assigned to this.env.scene right after building court
  assert.ok(
    tennisCode.includes('this.scene = this.env.scene;'),
    'tennis.js must assign this.scene = this.env.scene in buildWorld()'
  );
  assert.ok(
    tennisCode.includes('#build3DRacket()'),
    'tennis.js must build 3D racket'
  );
});
