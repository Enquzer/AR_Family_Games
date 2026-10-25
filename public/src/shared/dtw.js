/**
 * Dynamic Time Warping (DTW) with Sakoe-Chiba band for real-time dance gesture scoring.
 * 
 * Accurately separates form accuracy (how well you did the move)
 * from timing offset (how early or late you hit the beat).
 * Also supports auto-mirror detection (scoring players who mirror the coach on screen).
 */
import { clamp } from './math.js';

/**
 * Computes Euclidean feature distance between two dance frame states.
 */
export function danceFrameDistance(a, b, mirror = false) {
  const targetL = b.hands ? b.hands[0] : (b.handL || [0, 0]);
  const targetR = b.hands ? b.hands[1] : (b.handR || [0, 0]);

  let expLx, expLy, expRx, expRy;
  let expLean, expKneeL, expKneeR, expTwist;

  if (mirror) {
    // In mirror mode, left and right are swapped and horizontal X / lean / twist are inverted
    expLx = -(targetR.x ?? targetR[0]);
    expLy = targetR.y ?? targetR[1];
    expRx = -(targetL.x ?? targetL[0]);
    expRy = targetL.y ?? targetL[1];

    expLean = -(b.lean ?? 0);
    expKneeL = b.kneeR ?? 0;
    expKneeR = b.kneeL ?? 0;
    expTwist = -(b.twist ?? 0);
  } else {
    expLx = targetL.x ?? targetL[0];
    expLy = targetL.y ?? targetL[1];
    expRx = targetR.x ?? targetR[0];
    expRy = targetR.y ?? targetR[1];

    expLean = b.lean ?? 0;
    expKneeL = b.kneeL ?? 0;
    expKneeR = b.kneeR ?? 0;
    expTwist = b.twist ?? 0;
  }

  const dL = Math.hypot((a.handL?.x ?? 0) - expLx, (a.handL?.y ?? 0) - expLy);
  const dR = Math.hypot((a.handR?.x ?? 0) - expRx, (a.handR?.y ?? 0) - expRy);
  const handDist = (dL + dR) * 0.5;

  const leanDist = Math.abs((a.lean || 0) - expLean);
  const kneeDist = (Math.abs((a.kneeLiftL || 0) - expKneeL) + Math.abs((a.kneeLiftR || 0) - expKneeR)) * 0.5;
  const twistDist = Math.abs((a.torsoTwist || 0) - expTwist);

  return handDist * 0.55 + leanDist * 0.15 + kneeDist * 0.20 + twistDist * 0.10;
}

/**
 * Sakoe-Chiba Banded DTW Algorithm.
 * @param {Array} seqA Player sequence
 * @param {Array} seqB Reference sequence
 * @param {Function} distFn Distance between two elements
 * @param {number} band Radius around main diagonal
 */
export function bandedDTW(seqA, seqB, distFn, band = 5) {
  const n = seqA.length;
  const m = seqB.length;
  if (n === 0 || m === 0) return { cost: Infinity, path: [] };

  // Cost matrix with Infinity padding
  const D = Array.from({ length: n + 1 }, () => new Float32Array(m + 1).fill(Infinity));
  D[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    const minJ = Math.max(1, Math.floor((i * m) / n) - band);
    const maxJ = Math.min(m, Math.floor((i * m) / n) + band);

    for (let j = minJ; j <= maxJ; j++) {
      const d = distFn(seqA[i - 1], seqB[j - 1]);
      D[i][j] = d + Math.min(D[i - 1][j], D[i][j - 1], D[i - 1][j - 1]);
    }
  }

  // Backtrack optimal warping path
  let i = n;
  let j = m;
  const path = [[i - 1, j - 1]];

  while (i > 1 || j > 1) {
    if (i === 1) {
      j--;
    } else if (j === 1) {
      i--;
    } else {
      const diag = D[i - 1][j - 1];
      const left = D[i][j - 1];
      const up = D[i - 1][j];
      if (diag <= left && diag <= up) {
        i--;
        j--;
      } else if (left <= up) {
        j--;
      } else {
        i--;
      }
    }
    path.push([i - 1, j - 1]);
  }
  path.reverse();

  const totalCost = D[n][m];
  const normalizedCost = totalCost / Math.max(n, m);
  return { cost: normalizedCost, path };
}

/**
 * Evaluates a window of dance motion frames against a target move.
 * Automatically tests both normal and mirrored postures and measures sub-beat lead/lag.
 */
export function scoreDanceMove(playerFrames, targetMove, dtPerFrameSec = 0.033) {
  if (!playerFrames || playerFrames.length === 0) {
    return { score: 0, timingOffsetMs: 0, isMirror: false, grade: 'MISS' };
  }

  // Build reference sequence: use baked mocap frames if available, or generate standard 4-frame trajectory
  let refSeq;
  if (targetMove.frames && targetMove.frames.length > 0) {
    refSeq = targetMove.frames.map(f => f.features || f);
  } else {
    const targetL = targetMove.hands ? targetMove.hands[0] : [0, 0];
    const targetR = targetMove.hands ? targetMove.hands[1] : [0, 0];
    const lowHands = [
      [targetL[0], targetL[1] * 0.35],
      [targetR[0], targetR[1] * 0.35],
    ];

    refSeq = [
      { hands: lowHands, lean: (targetMove.lean || 0) * 0.3, kneeL: (targetMove.kneeL || 0) * 0.3, kneeR: (targetMove.kneeR || 0) * 0.3, twist: (targetMove.twist || 0) * 0.3 },
      targetMove,
      targetMove,
      { hands: lowHands, lean: (targetMove.lean || 0) * 0.3, kneeL: (targetMove.kneeL || 0) * 0.3, kneeR: (targetMove.kneeR || 0) * 0.3, twist: (targetMove.twist || 0) * 0.3 },
    ];
  }

  // Test regular
  const regular = bandedDTW(playerFrames, refSeq, (a, b) => danceFrameDistance(a, b, false), 4);
  // Test mirror
  const mirror = bandedDTW(playerFrames, refSeq, (a, b) => danceFrameDistance(a, b, true), 4);

  const isMirror = mirror.cost < regular.cost * 0.88;
  const chosen = isMirror ? mirror : regular;

  // Convert normalized cost to 0..1 match score
  // Cost 0.15 is near perfect, cost 0.85 is complete miss
  const formMatch = clamp(1 - (chosen.cost - 0.12) / 0.72, 0, 1);

  // Calculate timing offset: find centroid of player frames matching the peak move frames
  const matchedP = [];
  for (const [pIdx, rIdx] of chosen.path) {
    if (rIdx === 1 || rIdx === 2) matchedP.push(pIdx);
  }
  const peakPlayerIdx = matchedP.length > 0 ? (matchedP[0] + matchedP[matchedP.length - 1]) * 0.5 : Math.floor(playerFrames.length * 0.5);

  const expectedPeakIdx = (playerFrames.length - 1) * 0.5;
  const timingOffsetMs = Math.round((peakPlayerIdx - expectedPeakIdx) * dtPerFrameSec * 1000);

  let timingLabel = 'PERFECT TIMING';
  if (timingOffsetMs < -75) timingLabel = `EARLY (${Math.abs(timingOffsetMs)}ms)`;
  else if (timingOffsetMs > 75) timingLabel = `LATE (+${timingOffsetMs}ms)`;

  return {
    match: formMatch,
    timingOffsetMs,
    timingLabel,
    isMirror,
  };
}
