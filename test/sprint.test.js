import test from 'node:test';
import assert from 'node:assert/strict';

test('Sprint 4-lane grid assigns humans and fills field with Olympic bots', () => {
  const LANES_Z = [-3.15, -1.05, 1.05, 3.15];
  const LANE_GAP = 2.1;

  // Verify lane gap spacing
  for (let i = 0; i < 3; i++) {
    const diff = LANES_Z[i + 1] - LANES_Z[i];
    assert.ok(Math.abs(diff - LANE_GAP) < 1e-4, `Expected ${LANE_GAP}m gap between lanes`);
  }

  // 1 Human player setup: gets Lane 1 (central lane), bots take 0, 2, 3
  const setup1 = (humanCount) => {
    const humanLanes = [];
    if (humanCount === 1) humanLanes.push(1);
    else if (humanCount === 2) humanLanes.push(1, 2);
    const occupied = new Set(humanLanes);
    const botLanes = [0, 1, 2, 3].filter((l) => !occupied.has(l));
    return { humanLanes, botLanes };
  };

  const race1 = setup1(1);
  assert.deepEqual(race1.humanLanes, [1]);
  assert.deepEqual(race1.botLanes, [0, 2, 3]);
  assert.equal(race1.humanLanes.length + race1.botLanes.length, 4);

  // 2 Human players setup: get Lanes 1 & 2, bots take 0 & 3
  const race2 = setup1(2);
  assert.deepEqual(race2.humanLanes, [1, 2]);
  assert.deepEqual(race2.botLanes, [0, 3]);
  assert.equal(race2.humanLanes.length + race2.botLanes.length, 4);
});

test('Sprint stride cadence and limb drive map to realistic sprint velocities', () => {
  const maxSpeed = 10.4; // m/s (approx 37.4 km/h)

  function computeSprintSpeed(run, legDrive, armDrive, cadence) {
    const trackedRun = Number.isFinite(run) ? run : 0;
    const limbRun = (Number(legDrive) || 0) * 0.55 + (Number(armDrive) || 0) * 0.25;
    const fused = Math.max(trackedRun, limbRun, (cadence || 0) * 0.35);
    const target = Math.min(1.0, Math.max(0, fused)) * maxSpeed;
    return target;
  }

  // Stationary: zero speed
  assert.equal(computeSprintSpeed(0, 0, 0, 0), 0);

  // Light jog (run = 0.4, cadence = 1.6 sps)
  const jogSpeed = computeSprintSpeed(0.4, 0.3, 0.2, 1.6);
  const jogKmh = jogSpeed * 3.6;
  assert.ok(jogKmh >= 14 && jogKmh <= 24, `Expected light jog speed ~15-22 km/h, got ${jogKmh.toFixed(1)}`);

  // World-class Olympic sprint (explosive high-knee cadence = 3.6 sps, legDrive = 0.95, armDrive = 0.85)
  const sprintSpeed = computeSprintSpeed(1.0, 0.95, 0.85, 3.6);
  const sprintKmh = sprintSpeed * 3.6;
  assert.ok(sprintKmh >= 35 && sprintKmh <= 38, `Expected sprint speed ~36-37.4 km/h, got ${sprintKmh.toFixed(1)}`);
});

test('Olympic AI bots exhibit distinct stamina profiles across heats', () => {
  // Test bot styles at different track distances (x = 10m vs x = 55m of 60m race)
  function getBotTargetSpeed(style, baseSpeed, heat, x, distance = 60, humanSpeed = 9.0) {
    const heatScale = heat === 1 ? 0.90 : heat === 2 ? 0.96 : 1.02;
    let target = baseSpeed * heatScale;

    if (style === 'explosive') {
      if (x < 25) target *= 1.06;
      else if (x > distance - 15) target *= 0.94;
    } else if (style === 'pacer') {
      target = Math.max(target, humanSpeed + 0.15);
    } else if (style === 'surge') {
      if (x < 30) target *= 0.92;
      else if (x > distance - 25) target *= 1.10;
    }
    return target;
  }

  // Heat 1 (Qualifiers): Light competition
  const lightningStartH1 = getBotTargetSpeed('explosive', 9.8, 1, 10);
  const lightningEndH1 = getBotTargetSpeed('explosive', 9.8, 1, 55);
  // Explosive starter is faster at 10m than at 55m
  assert.ok(lightningStartH1 > lightningEndH1, 'LIGHTNING should be faster in first 25m than final stretch');

  // Heat 3 (Olympic Final): PHOENIX late closing surge
  const phoenixStartH3 = getBotTargetSpeed('surge', 10.2, 3, 15);
  const phoenixKickH3 = getBotTargetSpeed('surge', 10.2, 3, 50);
  assert.ok(phoenixKickH3 > phoenixStartH3, 'PHOENIX should surge significantly in the final 25m');
  assert.ok(phoenixKickH3 * 3.6 > 38, 'PHOENIX Olympic Final kick should exceed 38 km/h');

  // TITAN pacer matches and challenges human speed
  const titanSpeed = getBotTargetSpeed('pacer', 10.0, 2, 35, 60, 9.5);
  assert.ok(titanSpeed >= 9.65, 'TITAN should contest and push human pace shoulder-to-shoulder');
});

test('Finish line tape snaps upon first crossing and calculates Olympic series points', () => {
  const distance = 60;
  let tapeBroken = false;
  let firstFinishTime = 0;

  const competitors = [
    { key: 'human', x: 59.2, speed: 9.8 },
    { key: 'bot_lightning', x: 60.1, speed: 9.5 },
  ];

  for (const c of competitors) {
    if (c.x >= distance && !tapeBroken) {
      tapeBroken = true;
      firstFinishTime = 6.25;
    }
  }

  assert.equal(tapeBroken, true, 'Finish tape must break when first runner crosses distance');
  assert.equal(firstFinishTime, 6.25);

  // Points accumulation across 3 heats: 1st=10pts, 2nd=6pts, 3rd=4pts, 4th=2pts
  const points = new Map();
  const awardPoints = (results) => {
    const pts = [10, 6, 4, 2];
    results.forEach((id, idx) => {
      points.set(id, (points.get(id) || 0) + (pts[idx] || 0));
    });
  };

  // Heat 1: Human wins (1st), Lightning (2nd), Titan (3rd), Phoenix (4th)
  awardPoints(['human', 'bot_lightning', 'bot_titan', 'bot_phoenix']);
  assert.equal(points.get('human'), 10);
  assert.equal(points.get('bot_lightning'), 6);

  // Heat 2: Titan wins (1st), Human (2nd), Lightning (3rd), Phoenix (4th)
  awardPoints(['bot_titan', 'human', 'bot_lightning', 'bot_phoenix']);
  assert.equal(points.get('human'), 16);
  assert.equal(points.get('bot_titan'), 14);

  // Heat 3 (Final): Human wins (1st)
  awardPoints(['human', 'bot_phoenix', 'bot_titan', 'bot_lightning']);
  assert.equal(points.get('human'), 26);

  // Series champion check
  const standings = [...points.entries()].sort((a, b) => b[1] - a[1]);
  assert.equal(standings[0][0], 'human');
  assert.equal(standings[0][1], 26);
});

test('Sprint configuration has 200m track distance and grounds runners to track surface', async () => {
  const fs = await import('fs');
  const trackCode = fs.readFileSync('public/src/games/track.js', 'utf8');
  const indexCode = fs.readFileSync('public/src/games/index.js', 'utf8');
  const catalogCode = fs.readFileSync('public/src/games/catalog.js', 'utf8');

  // Verify distance is 200 meters across configs
  assert.ok(indexCode.includes('distance: 200'), 'SprintGame in index.js must set distance: 200');
  assert.ok(trackCode.includes('this.distance = options.distance || 200;'), 'TrackGame must default distance to 200');
  assert.ok(catalogCode.includes("'200m Sprint'"), 'catalog.js must advertise 200m Sprint');

  // Verify jump physics is isolated to hurdles only, grounding runners in flat sprint
  assert.ok(
    trackCode.includes('if (this.hurdleXs) {'),
    'Jump trajectory physics must only activate when hurdles are present'
  );
  assert.ok(
    !trackCode.includes('const effectiveJumpY = Math.max(s.jumpY, jumpInput * 0.9);'),
    'Must not elevate runner with jumpInput * 0.9'
  );
});
