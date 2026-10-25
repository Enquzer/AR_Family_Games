/**
 * Stable multi-person tracking on top of MediaPipe's per-frame detections.
 * Uses Hungarian (Kuhn-Munkres) optimal assignment with multi-cue cost
 * (predicted position, body scale, and pose shape), crossing-mode protection,
 * tentative/confirmed track state gating, and One Euro landmark filtering.
 */
import { clamp, dist2 } from '../shared/math.js';
import { LM, mid } from '../shared/pose.js';
import { CONFIG } from '../shared/config.js';
import { hungarian } from '../shared/hungarian.js';
import { LandmarkFilter } from '../shared/oneEuro.js';

export const PLAYER_COLORS = ['#22d3ee', '#f472b6', '#fbbf24', '#a3e635', '#a78bfa', '#fb923c'];

// Key landmark indices used for shape descriptor
const SHAPE_JOINTS = [
  LM.L_SHOULDER, LM.R_SHOULDER,
  LM.L_ELBOW, LM.R_ELBOW,
  LM.L_WRIST, LM.R_WRIST,
  LM.L_KNEE, LM.R_KNEE,
  LM.L_ANKLE, LM.R_ANKLE,
];

function extractDetectionFeatures(lm, wlm = null, aspect = 16 / 9) {
  const hip = mid(lm[LM.L_HIP], lm[LM.R_HIP]);
  const sh = mid(lm[LM.L_SHOULDER], lm[LM.R_SHOULDER]);
  const ank = mid(lm[LM.L_ANKLE], lm[LM.R_ANKLE]);

  // Torso / body scale estimate
  const torsoH = Math.hypot((sh.x - hip.x) * aspect, sh.y - hip.y);
  const legH = Math.hypot((hip.x - ank.x) * aspect, hip.y - ank.y);
  const ankVis = ((lm[LM.L_ANKLE]?.visibility ?? 1) + (lm[LM.R_ANKLE]?.visibility ?? 1)) * 0.5;
  const scale = ankVis > 0.3 ? torsoH + legH * 0.5 : torsoH * 2.0;
  const safeScale = Math.max(scale, 0.05);

  // Normalized joint shape relative to hip
  const shape = [];
  for (const idx of SHAPE_JOINTS) {
    const pt = lm[idx];
    if (!pt) {
      shape.push({ x: 0, y: 0, vis: 0 });
    } else {
      shape.push({
        x: ((pt.x - hip.x) * aspect) / safeScale,
        y: (pt.y - hip.y) / safeScale,
        vis: pt.visibility ?? 1.0,
      });
    }
  }

  // Torso visibility confidence
  let conf = 0;
  for (const i of [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP]) {
    conf += lm[i]?.visibility ?? 1;
  }
  conf /= 4;

  return { lm, wlm, hip, scale: safeScale, shape, conf };
}

function computeShapeDistance(shapeA, shapeB) {
  if (!shapeA || !shapeB || shapeA.length !== shapeB.length) return 1.0;
  let totalDist = 0;
  let totalWeight = 0;
  for (let i = 0; i < shapeA.length; i++) {
    const a = shapeA[i];
    const b = shapeB[i];
    const weight = Math.min(a.vis, b.vis);
    if (weight > 0.1) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      totalDist += d * weight;
      totalWeight += weight;
    }
  }
  if (totalWeight < 0.2) return 0.5;
  return clamp(totalDist / totalWeight, 0, 1.5);
}

export class MultiPoseTracker {
  constructor({
    maxPlayers = CONFIG.tracker.maxPlayers || 4,
    smooth = 0.45,
    maxDistance = CONFIG.tracker.maxDistance || 0.28,
    maxLostMs = CONFIG.tracker.ttlMenuMs || 1500,
    tentativeHits = CONFIG.tracker.tentativeHits || 3,
    tentativeWindow = CONFIG.tracker.tentativeWindow || 5,
  } = {}) {
    this.maxPlayers = maxPlayers;
    this.smooth = smooth;
    this.maxDistance = maxDistance;
    this.maxLostMs = maxLostMs;
    this.tentativeHits = tentativeHits;
    this.tentativeWindow = tentativeWindow;
    this.tracks = new Map();
    this.nextId = 1;
    this.lastTs = 0;
  }

  setMaxPlayers(n) {
    this.maxPlayers = clamp(n, 1, 6);
    const entries = [...this.tracks.values()].sort((a, b) => a.lastSeen - b.lastSeen);
    while (entries.length > this.maxPlayers) {
      const t = entries.shift();
      this.tracks.delete(t.id);
    }
  }

  reset() {
    this.tracks.clear();
    this.nextId = 1;
    this.lastTs = 0;
  }

  setGameMode(active) {
    this.maxLostMs = active ? (CONFIG.tracker.ttlInGameMs || 1000) : (CONFIG.tracker.ttlMenuMs || 1500);
  }

  /**
   * @param {Array<Array>} detections MediaPipe landmarks per person
   * @param {number} ts Milliseconds timestamp
   * @param {number} aspect Video aspect ratio
   * @param {Array<Array>} worldDetections MediaPipe metric world landmarks per person
   */
  update(detections, ts, aspect = 16 / 9, worldDetections = []) {
    const now = ts || performance.now();
    const dt = this.lastTs ? clamp((now - this.lastTs) / 1000, 0.005, 0.25) : 0.033;
    this.lastTs = now;
    const tsSec = now / 1000;

    // Filter valid detections (must contain at least 33 landmarks)
    const dets = [];
    if (Array.isArray(detections)) {
      for (let i = 0; i < detections.length; i++) {
        const lm = detections[i];
        if (Array.isArray(lm) && lm.length >= 33) {
          const wlm = Array.isArray(worldDetections) && worldDetections[i]?.length >= 33 ? worldDetections[i] : null;
          dets.push(extractDetectionFeatures(lm, wlm, aspect));
        }
      }
    }

    const tracks = [...this.tracks.values()];
    const N = tracks.length;
    const M = dets.length;

    // Check crossing mode: when two predicted hips come within crossingDist
    const crossingDist = CONFIG.tracker.crossingDist || 0.12;
    for (let i = 0; i < N; i++) {
      tracks[i].crossing = false;
      const predXi = tracks[i].hip.x + tracks[i].vel.x * dt;
      const predYi = tracks[i].hip.y + tracks[i].vel.y * dt;
      for (let j = i + 1; j < N; j++) {
        const predXj = tracks[j].hip.x + tracks[j].vel.x * dt;
        const predYj = tracks[j].hip.y + tracks[j].vel.y * dt;
        if (dist2(predXi, predYi, predXj, predYj) < crossingDist) {
          tracks[i].crossing = true;
          tracks[j].crossing = true;
        }
      }
    }

    // Optimal assignment via Hungarian algorithm
    const usedT = new Set();
    const usedD = new Set();

    if (N > 0 && M > 0) {
      const K = Math.max(N, M);
      const costMatrix = Array.from({ length: K }, () => new Float32Array(K).fill(100.0));
      const weights = CONFIG.tracker.weights || { pos: 0.55, scale: 0.20, shape: 0.25 };
      const gateCost = CONFIG.tracker.gateCost || 0.95;

      for (let i = 0; i < N; i++) {
        const tr = tracks[i];
        const predX = tr.hip.x + tr.vel.x * dt;
        const predY = tr.hip.y + tr.vel.y * dt;

        for (let j = 0; j < M; j++) {
          const det = dets[j];
          const dPos = dist2(predX, predY, det.hip.x, det.hip.y);

          // Gating distance check
          if (dPos > this.maxDistance) {
            costMatrix[i][j] = 100.0;
            continue;
          }

          const normPos = dPos / this.maxDistance;
          const normScale = Math.min(1.0, Math.abs(tr.scale - det.scale) / Math.max(tr.scale, det.scale, 0.01));
          const normShape = Math.min(1.0, computeShapeDistance(tr.shape, det.shape));

          let cost = 0;
          if (tr.crossing) {
            // Emphasize scale and shape when crossing to avoid identity swap
            cost = 0.30 * normPos + 0.35 * normScale + 0.35 * normShape;
          } else {
            cost = weights.pos * normPos + weights.scale * normScale + weights.shape * normShape;
          }
          costMatrix[i][j] = cost;
        }
      }

      const match = hungarian(costMatrix);
      for (let i = 0; i < N; i++) {
        const j = match[i];
        if (j >= 0 && j < M && costMatrix[i][j] <= gateCost) {
          usedT.add(i);
          usedD.add(j);
          this.#apply(tracks[i], dets[j], now, dt, aspect, tsSec);
        }
      }
    }

    // Create new tracks for unmatched detections
    for (let di = 0; di < M; di++) {
      if (usedD.has(di)) continue;

      if (this.tracks.size >= this.maxPlayers) {
        // Prune oldest inactive track if over capacity
        const oldest = [...this.tracks.values()]
          .filter((t) => now - t.lastSeen > 350)
          .sort((a, b) => a.lastSeen - b.lastSeen)[0];
        if (oldest) this.tracks.delete(oldest.id);
        else continue;
      }

      const det = dets[di];
      if (det.conf < 0.2) continue;

      const id = this.nextId++;
      const filter = new LandmarkFilter();
      const { smooth, fast } = filter.apply(det.lm, tsSec, aspect);
      const world = det.wlm ? filter.applyWorld(det.wlm, tsSec) : null;

      const tr = {
        id,
        name: `Player ${id}`,
        color: PLAYER_COLORS[(id - 1) % PLAYER_COLORS.length],
        lm: smooth,
        smooth,
        fast,
        world,
        raw: det.lm,
        hip: { ...det.hip },
        vel: { x: 0, y: 0 },
        scale: det.scale,
        shape: det.shape,
        confidence: det.conf,
        firstSeen: now,
        lastSeen: now,
        missed: 0,
        active: true,
        aspect,
        crossing: false,
        filter,
        // Tentative track confirmation state
        state: this.tentativeHits <= 1 ? 'confirmed' : 'tentative',
        hits: 1,
        windowFrames: 1,
      };
      this.tracks.set(id, tr);
    }

    // Age unmatched tracks & handle state
    for (const tr of this.tracks.values()) {
      if (!usedT.has(tracks.indexOf(tr))) {
        tr.missed++;
        tr.active = false;
        // Coast hip position with velocity
        tr.hip.x += tr.vel.x * dt;
        tr.hip.y += tr.vel.y * dt;
        tr.windowFrames++;

        if (now - tr.lastSeen > this.maxLostMs) {
          this.tracks.delete(tr.id);
        }
      }
    }

    return this.activeTracks(now);
  }

  #apply(tr, det, now, dt, aspect, tsSec) {
    // Apply dual-stream One Euro filtering
    const { smooth, fast } = tr.filter.apply(det.lm, tsSec, aspect);
    tr.smooth = smooth;
    tr.fast = fast;
    tr.lm = smooth; // Backwards compatibility

    if (det.wlm) {
      tr.world = tr.filter.applyWorld(det.wlm, tsSec);
    }

    // Update velocity of hip
    const oldX = tr.hip.x;
    const oldY = tr.hip.y;
    tr.vel.x = (det.hip.x - oldX) / Math.max(dt, 0.01);
    tr.vel.y = (det.hip.y - oldY) / Math.max(dt, 0.01);
    tr.hip.x = det.hip.x;
    tr.hip.y = det.hip.y;

    // Freeze appearance templates during crossing to prevent ID bleeding
    if (!tr.crossing) {
      tr.scale = tr.scale * 0.85 + det.scale * 0.15;
      tr.shape = det.shape;
    }

    tr.raw = det.lm;
    tr.confidence = det.conf;
    tr.lastSeen = now;
    tr.missed = 0;
    tr.active = true;
    tr.aspect = aspect;

    // Confirmation logic
    if (tr.state === 'tentative') {
      tr.hits++;
      tr.windowFrames++;
      if (tr.hits >= this.tentativeHits) {
        tr.state = 'confirmed';
      } else if (tr.windowFrames >= this.tentativeWindow && tr.hits < this.tentativeHits) {
        // Did not meet hit ratio within window
        this.tracks.delete(tr.id);
      }
    }
  }

  /** Return tracks that are confirmed and currently active. */
  activeTracks(now = performance.now()) {
    return [...this.tracks.values()]
      .filter((t) => t.state === 'confirmed' && now - t.lastSeen < this.maxLostMs)
      .sort((a, b) => a.id - b.id);
  }

  /** Tracks currently seen (not merely coasted/remembered). */
  visibleTracks(now = performance.now()) {
    return this.activeTracks(now).filter((t) => now - t.lastSeen < 500);
  }
}
