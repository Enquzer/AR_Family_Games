import test from 'node:test';
import assert from 'node:assert';
import { PoolSim } from '../public/src/sim/pool.js';

test('PoolSim conserves total linear momentum in elastic head-on collision', () => {
  let hits = 0;
  const sim = new PoolSim({
    ballRestitution: 1.0, // perfectly elastic
    slidingFriction: 0.0,  // frictionless for conservation test
    rollingResistance: 0.0,
    onBallHit: () => { hits++; },
  });

  // Cue ball moving at 8 m/s toward stationary object ball
  const ballA = sim.addBall({ id: 'cue', cue: true, x: 0, z: 2.0, vx: 0, vz: -8.0, pocketed: false });
  const ballB = sim.addBall({ id: 'obj', cue: false, x: 0, z: 0.0, vx: 0, vz: 0.0, pocketed: false });

  const initialP = ballA.vz + ballB.vz; // -8.0

  // Step 0.3 seconds
  for (let i = 0; i < 20; i++) {
    sim.step(0.016);
  }

  assert.ok(hits >= 1, 'Balls should have collided');
  const finalP = ballA.vz + ballB.vz;
  assert.ok(Math.abs(finalP - initialP) < 0.01, `Momentum should be conserved (initial=${initialP}, final=${finalP})`);

  // Head-on equal mass collision should transfer nearly all velocity to ball B
  assert.ok(ballB.vz < -6.5, `Ball B should carry the momentum forward, got vz=${ballB.vz}`);
});

test('PoolSim cushion reflection reverses normal velocity and applies sidespin transfer', () => {
  let cushionHits = 0;
  const sim = new PoolSim({
    slidingFriction: 0.0,
    rollingResistance: 0.0,
    onCushionHit: () => { cushionHits++; },
  });

  // Ball with right sidespin striking left cushion (x = minX)
  const ball = sim.addBall({
    id: 'cue',
    x: sim.minX + 0.1,
    z: 0,
    vx: -5.0, // heading toward left cushion
    vz: 0.0,
    spin: 1.0, // sidespin
    pocketed: false,
  });

  // Step until cushion bounce
  for (let i = 0; i < 10; i++) {
    sim.step(0.016);
  }

  assert.ok(cushionHits >= 1, 'Ball should strike left cushion');
  assert.ok(ball.vx > 0, `Ball x-velocity should reverse positive after left cushion, got ${ball.vx}`);
  assert.ok(Math.abs(ball.vz) > 0.1, `Sidespin should transfer tangential velocity vz, got ${ball.vz}`);
});

test('PoolSim CCD prevents tunneling on high speed shot', () => {
  const sim = new PoolSim({
    slidingFriction: 0.0,
    rollingResistance: 0.0,
  });

  // High speed shot: 20 m/s toward cushion
  const ball = sim.addBall({
    id: 'cue',
    x: 0,
    z: sim.minZ + 0.5,
    vx: 0,
    vz: -20.0,
    pocketed: false,
  });

  // Step physics
  for (let i = 0; i < 20; i++) {
    sim.step(0.016);
    // Ball should never penetrate past cushion boundary minZ
    assert.ok(ball.z >= sim.minZ - 1e-4, `Ball tunneled through cushion! z=${ball.z}, minZ=${sim.minZ}`);
  }

  assert.ok(ball.vz > 0, 'Ball should have bounced off top cushion');
});

test('PoolSim sinks ball when falling into pocket', () => {
  let pocketedBall = null;
  const pockets = [{ id: 'corner', x: -3.0, z: -5.0, radius: 0.35 }];
  const sim = new PoolSim({
    pockets,
    onPocket: (b) => { pocketedBall = b; },
  });

  const ball = sim.addBall({
    id: 'ball_1',
    x: -2.8,
    z: -4.8,
    vx: -2.0,
    vz: -2.0,
    pocketed: false,
  });

  for (let i = 0; i < 15; i++) {
    sim.step(0.016);
  }

  assert.ok(ball.pocketed, 'Ball should be marked pocketed');
  assert.equal(pocketedBall?.id, 'ball_1');
});
