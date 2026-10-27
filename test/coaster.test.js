import test from 'node:test';
import assert from 'node:assert/strict';
import { CatmullRomCurve3, Vector3 } from 'three';

// 18-point elevated Theme-Park Roller Coaster track curve
const points = [
  [0, 8.0, 16],
  [12, 10.5, 6],
  [22, 15.0, -10],
  [32, 23.0, -28],
  [40, 34.0, -50],
  [36, 18.0, -78],
  [24, 7.5, -95],
  [2, 9.0, -105],
  [-22, 14.0, -96],
  [-38, 22.5, -74],
  [-46, 8.0, -48],
  [-52, 9.5, -20],
  [-42, 13.0, 10],
  [-24, 18.0, 32],
  [-2, 12.0, 42],
  [18, 7.2, 38],
  [28, 9.0, 24],
  [16, 8.0, 20],
].map((p) => new Vector3(...p));

const curve = new CatmullRomCurve3(points, true, 'catmullrom', 0.5);
const UP = new Vector3(0, 1, 0);

test('Roller Coaster track maintains complete ground clearance with zero terrain penetration', () => {
  // Max terrain valley height is -0.5m
  const maxTerrainY = -0.5;

  let minTrackY = 999;
  let maxTrackY = -999;

  for (let i = 0; i <= 200; i++) {
    const p = curve.getPointAt(i / 200);
    if (p.y < minTrackY) minTrackY = p.y;
    if (p.y > maxTrackY) maxTrackY = p.y;
  }

  // 1. Min track height must stay comfortably above terrain
  assert.ok(minTrackY > 6.8, `Lowest track point must be elevated > 6.8m, was ${minTrackY.toFixed(2)}m`);
  assert.ok(minTrackY - maxTerrainY > 7.0, 'Track must maintain at least 7.0m vertical clearance above terrain');

  // 2. Summit peak must reach thrilling mega-drop height (>30m)
  assert.ok(maxTrackY > 30.0, `Summit crest peak must exceed 30m, reached ${maxTrackY.toFixed(2)}m`);
});

test('Centrifugal curve detection discriminates left vs right curves along the track', () => {
  function computeCurvature(u) {
    const du = 0.006;
    const t0 = curve.getTangentAt((u - du + 1) % 1).normalize();
    const t1 = curve.getTangentAt((u + du) % 1).normalize();
    const tCurrent = curve.getTangentAt(u).normalize();
    const right = new Vector3().crossVectors(tCurrent, UP).normalize();
    const dt = new Vector3().subVectors(t1, t0);
    return dt.dot(right);
  }

  // Station turn out at u = 0.00 should turn right
  const k0 = computeCurvature(0.00);
  assert.ok(k0 > 0.05, `Expected sharp right turn out of station, got ${k0.toFixed(3)}`);

  // Hairpin turn at u = 0.35 should curve left
  const k35 = computeCurvature(0.35);
  assert.ok(k35 < -0.05, `Expected high-speed left curve, got ${k35.toFixed(3)}`);
});

test('Hip swivel and torso lean balance mechanics prevent derailment when matched', () => {
  const curveLateral = -0.16; // Sharp curve turning left
  const speed = 20.0; // High speed (m/s)

  // Required bank to balance: leftward lean (-1.0)
  const requiredBank = Math.max(-1.0, Math.min(1.0, curveLateral * (speed / 12) * 2.2));
  assert.ok(requiredBank < -0.5, 'Left curve must require substantial leftward banking');

  // Case A: Player swivels hips and leans into curve
  const goodLean = -0.8;
  const goodSwivel = -0.7;
  const goodPlayerBank = goodLean * 0.70 + goodSwivel * 0.45;
  const goodError = Math.abs(goodPlayerBank - requiredBank);
  assert.ok(goodError < 0.35, `Balanced banking error should be small (<0.35), got ${goodError.toFixed(3)}`);

  // Case B: Player fails to swivel hips or leans opposite direction
  const badLean = 0.6; // Leaning opposite
  const badSwivel = 0;
  const badPlayerBank = badLean * 0.70 + badSwivel * 0.45;
  const badError = Math.abs(badPlayerBank - requiredBank);
  assert.ok(badError > 0.9, 'Failing to lean into curve must generate severe banking error (>0.9)');

  // Derailment risk accumulation under sustained bad balance
  let derailRisk = 0;
  const dt = 0.016;
  for (let step = 0; step < 60; step++) {
    derailRisk += dt * (badError - 0.35) * (speed / 14) * 1.5;
  }
  assert.ok(derailRisk > 0.8, 'Sustained failure to swivel hips in sharp curve must push derailment risk near 1.0');
});

test('Magnetic jump thruster physics reaches apex height to clear broken rail gaps', () => {
  let jumpY = 0;
  let jumpVy = 5.2; // Initial vertical thruster impulse
  const g = 12.5; // Gravity
  let apexY = 0;

  for (let step = 0; step < 40; step++) {
    const dt = 0.016;
    jumpY += jumpVy * dt;
    jumpVy -= g * dt;
    if (jumpY > apexY) apexY = jumpY;
    if (jumpY <= 0) break;
  }

  // Apex height must comfortably clear broken track gap (threshold > 0.45m)
  assert.ok(apexY >= 0.85, `Jump apex must exceed 0.85m to sail over track gaps, reached ${apexY.toFixed(2)}m`);
});

test('Slow chain-lift hill ascends to summit before triggering gravity mega-drop acceleration', () => {
  // First 22% of track is the slow mechanical chain-lift
  const uAscent = 0.10;
  const isChainLift = uAscent < 0.22;
  assert.equal(isChainLift, true, 'Early track section must be designated as chain-lift climb');

  const pSummit = curve.getPointAt(0.19);
  const pDropBottom = curve.getPointAt(0.34);

  // Vertical drop difference
  const dropHeight = pSummit.y - pDropBottom.y;
  assert.ok(dropHeight > 24.0, `Mega drop must plunge > 24 meters, plunged ${dropHeight.toFixed(1)}m`);
});

test('Coaster tangent vectors and curve calculations are defined across chain-lift and high-speed sections', () => {
  // Test across all track fractions from chain-lift (u < 0.22) to high-speed run
  for (let step = 0; step <= 100; step++) {
    const uu = step / 100;
    const pCurrent = curve.getPointAt(uu);
    const tCurrent = curve.getTangentAt(uu).normalize();

    assert.ok(pCurrent && typeof pCurrent.x === 'number', `Point at u=${uu} must be valid Vector3`);
    assert.ok(tCurrent && typeof tCurrent.x === 'number', `Tangent at u=${uu} must be valid Vector3`);

    const rightVec = new Vector3().crossVectors(tCurrent || UP, UP).normalize();
    assert.ok(rightVec && typeof rightVec.x === 'number', `Right vector at u=${uu} must be valid Vector3`);
    assert.ok(!Number.isNaN(rightVec.length()), `Right vector length at u=${uu} must not be NaN`);
  }
});

