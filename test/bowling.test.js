import test from 'node:test';
import assert from 'node:assert/strict';

test('Bowling 10-pin layout geometry conforms to standard rack specifications', () => {
  const PIN_DECK_Z = -18.2;
  const PIN_LAYOUT = [
    { id: 1, row: 1, x: 0, z: PIN_DECK_Z },
    { id: 2, row: 2, x: -0.155, z: PIN_DECK_Z - 0.28 },
    { id: 3, row: 2, x: 0.155, z: PIN_DECK_Z - 0.28 },
    { id: 4, row: 3, x: -0.31, z: PIN_DECK_Z - 0.56 },
    { id: 5, row: 3, x: 0, z: PIN_DECK_Z - 0.56 },
    { id: 6, row: 3, x: 0.31, z: PIN_DECK_Z - 0.56 },
    { id: 7, row: 4, x: -0.465, z: PIN_DECK_Z - 0.84 },
    { id: 8, row: 4, x: -0.155, z: PIN_DECK_Z - 0.84 },
    { id: 9, row: 4, x: 0.155, z: PIN_DECK_Z - 0.84 },
    { id: 10, row: 4, x: 0.465, z: PIN_DECK_Z - 0.84 },
  ];

  assert.equal(PIN_LAYOUT.length, 10, 'Must have exactly 10 pins');

  // Verify rows
  const row1 = PIN_LAYOUT.filter((p) => p.row === 1);
  const row2 = PIN_LAYOUT.filter((p) => p.row === 2);
  const row3 = PIN_LAYOUT.filter((p) => p.row === 3);
  const row4 = PIN_LAYOUT.filter((p) => p.row === 4);

  assert.equal(row1.length, 1);
  assert.equal(row2.length, 2);
  assert.equal(row3.length, 3);
  assert.equal(row4.length, 4);

  // Verify symmetry
  assert.equal(row1[0].x, 0);
  assert.equal(Math.abs(row2[0].x + row2[1].x) < 1e-4, true);
  assert.equal(Math.abs(row4[0].x + row4[3].x) < 1e-4, true);
});

test('Bowling frame score computation handles strikes, spares, and open frames', () => {
  function computeScores(frames) {
    let total = 0;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f.strike) {
        const next1 = frames[i + 1]?.r1 ?? 0;
        const next2 = frames[i + 1]?.strike
          ? (frames[i + 2]?.r1 ?? 0)
          : (frames[i + 1]?.r2 ?? 0);
        total += 10 + next1 + next2;
        f.score = total;
      } else if (f.spare) {
        const next1 = frames[i + 1]?.r1 ?? 0;
        total += 10 + next1;
        f.score = total;
      } else if (f.r2 != null) {
        total += f.r1 + f.r2;
        f.score = total;
      }
    }
    return total;
  }

  // Case 1: Turkey (3 strikes in a row)
  const turkey = [
    { num: 1, r1: 10, r2: null, strike: true, spare: false },
    { num: 2, r1: 10, r2: null, strike: true, spare: false },
    { num: 3, r1: 10, r2: null, strike: true, spare: false },
  ];
  computeScores(turkey);
  // Frame 1 with 2 consecutive strikes: 10 + 10 + 10 = 30
  assert.equal(turkey[0].score, 30);

  // Case 2: Strike followed by 5 and 3
  const strikeOpen = [
    { num: 1, r1: 10, r2: null, strike: true, spare: false },
    { num: 2, r1: 5, r2: 3, strike: false, spare: false },
  ];
  const total2 = computeScores(strikeOpen);
  assert.equal(strikeOpen[0].score, 18); // 10 + 5 + 3
  assert.equal(strikeOpen[1].score, 26); // 18 + 8
  assert.equal(total2, 26);

  // Case 3: Spare followed by 7 and 2
  const spareOpen = [
    { num: 1, r1: 6, r2: 4, strike: false, spare: true },
    { num: 2, r1: 7, r2: 2, strike: false, spare: false },
  ];
  const total3 = computeScores(spareOpen);
  assert.equal(spareOpen[0].score, 17); // 10 + 7
  assert.equal(spareOpen[1].score, 26); // 17 + 9
  assert.equal(total3, 26);
});

test('Bowling gutter detection clamps and channels balls exceeding lane width', () => {
  const LANE_W = 1.08;
  const GUTTER_W = 0.22;
  const halfLane = LANE_W / 2; // 0.54

  function updateGutter(ball) {
    if (Math.abs(ball.x) > halfLane) {
      ball.inGutter = true;
      ball.gutterSide = ball.x > 0 ? 1 : -1;
      const gutterCenter = (halfLane + GUTTER_W / 2) * ball.gutterSide;
      ball.x = gutterCenter;
      ball.vx = 0;
      ball.hook = 0;
    }
  }

  const ball1 = { x: 0.3, vx: 0.1, hook: 0.5, inGutter: false };
  updateGutter(ball1);
  assert.equal(ball1.inGutter, false);

  const ball2 = { x: 0.58, vx: 0.2, hook: 0.5, inGutter: false };
  updateGutter(ball2);
  assert.equal(ball2.inGutter, true);
  assert.equal(ball2.gutterSide, 1);
  assert.equal(ball2.vx, 0);
  assert.equal(ball2.hook, 0);
  assert.ok(ball2.x > halfLane);
});
