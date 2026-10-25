/**
 * Stable multi-person tracking on top of MediaPipe's per-frame detections.
 * MediaPipe returns an unordered set of poses each frame; we match them to
 * persistent tracks by predicted hip position so each player keeps their id,
 * colour and avatar across frames.
 */
import { clamp, dist2 } from '../shared/math.js';
import { LM, mid } from '../shared/pose.js';

export const PLAYER_COLORS = ['#22d3ee', '#f472b6', '#fbbf24', '#a3e635', '#a78bfa', '#fb923c'];

export class MultiPoseTracker {
  constructor({ maxPlayers = 4, smooth = 0.45, maxDistance = 0.24, maxLostMs = 1200 } = {}) {
    this.maxPlayers = maxPlayers;
    this.smooth = smooth;
    this.maxDistance = maxDistance;
    this.maxLostMs = maxLostMs;
    this.tracks = new Map();
    this.nextId = 1;
    this.lastTs = 0;
  }

  setMaxPlayers(n) {
    this.maxPlayers = clamp(n, 1, 6);
    // drop extras, oldest first
    const entries = [...this.tracks.values()].sort((a, b) => a.lastSeen - b.lastSeen);
    while (entries.length > this.maxPlayers) {
      const t = entries.shift();
      this.tracks.delete(t.id);
    }
  }

  reset() {
    this.tracks.clear();
    this.nextId = 1;
  }

  /** Call with true when a game starts, false when returning to lobby. */
  setGameMode(active) {
    this.maxLostMs = active ? 800 : 1200;
  }

  /**
   * @param {Array<Array>} detections MediaPipe landmarks per person
   * @param {number} ts
   * @param {number} aspect
   */
  update(detections, ts, aspect = 16 / 9) {
    const now = ts || performance.now();
    const dt = this.lastTs ? clamp((now - this.lastTs) / 1000, 0.01, 0.25) : 0.05;
    this.lastTs = now;

    const dets = (detections || [])
      .filter((lm) => Array.isArray(lm) && lm.length >= 33)
      .map((lm) => {
        const hip = mid(lm[LM.L_HIP], lm[LM.R_HIP]);
        let conf = 0;
        for (const i of [11, 12, 23, 24]) conf += lm[i]?.visibility ?? 1;
        return { lm, hip, conf: conf / 4 };
      });

    const tracks = [...this.tracks.values()];
    const pairs = [];
    for (let ti = 0; ti < tracks.length; ti++) {
      const tr = tracks[ti];
      const predX = tr.hip.x + tr.vel.x * dt;
      const predY = tr.hip.y + tr.vel.y * dt;
      for (let di = 0; di < dets.length; di++) {
        const d = dist2(predX, predY, dets[di].hip.x, dets[di].hip.y);
        if (d < this.maxDistance) pairs.push({ ti, di, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);

    const usedT = new Set();
    const usedD = new Set();
    for (const { ti, di } of pairs) {
      if (usedT.has(ti) || usedD.has(di)) continue;
      usedT.add(ti);
      usedD.add(di);
      const tr = tracks[ti];
      const det = dets[di];
      this.#apply(tr, det, now, dt, aspect);
    }

    // new tracks
    for (let di = 0; di < dets.length; di++) {
      if (usedD.has(di)) continue;
      if (this.tracks.size >= this.maxPlayers) {
        const oldest = [...this.tracks.values()]
          .filter((t) => now - t.lastSeen > 350)
          .sort((a, b) => a.lastSeen - b.lastSeen)[0];
        if (oldest) this.tracks.delete(oldest.id);
        else continue;
      }
      const det = dets[di];
      if (det.conf < 0.2) continue;
      const id = this.nextId++;
      const tr = {
        id,
        name: `Player ${id}`,
        color: PLAYER_COLORS[(id - 1) % PLAYER_COLORS.length],
        lm: det.lm.map((p) => ({ ...p })),
        raw: det.lm,
        hip: { ...det.hip },
        vel: { x: 0, y: 0 },
        confidence: det.conf,
        firstSeen: now,
        lastSeen: now,
        missed: 0,
        active: true,
        aspect,
      };
      this.tracks.set(id, tr);
    }

    // age unmatched
    for (const tr of this.tracks.values()) {
      if (now - tr.lastSeen > 60) {
        tr.missed++;
        tr.active = false;
        if (now - tr.lastSeen > this.maxLostMs) this.tracks.delete(tr.id);
      }
    }

    return this.activeTracks(now);
  }

  #apply(tr, det, now, dt, aspect) {
    const alpha = clamp(this.smooth + (1 - this.smooth) * clamp(dt * 8, 0, 0.5), 0.15, 0.9);
    for (let i = 0; i < 33; i++) {
      const a = tr.lm[i];
      const b = det.lm[i];
      a.x += (b.x - a.x) * alpha;
      a.y += (b.y - a.y) * alpha;
      a.z += ((b.z || 0) - (a.z || 0)) * alpha;
      a.visibility = (a.visibility ?? 1) + ((b.visibility ?? 1) - (a.visibility ?? 1)) * alpha;
    }
    const oldX = tr.hip.x;
    const oldY = tr.hip.y;
    tr.vel.x = (det.hip.x - oldX) / Math.max(dt, 0.01);
    tr.vel.y = (det.hip.y - oldY) / Math.max(dt, 0.01);
    tr.hip.x = det.hip.x;
    tr.hip.y = det.hip.y;
    tr.raw = det.lm;
    tr.confidence = det.conf;
    tr.lastSeen = now;
    tr.missed = 0;
    tr.active = true;
    tr.aspect = aspect;
  }

  activeTracks(now = performance.now()) {
    return [...this.tracks.values()]
      .filter((t) => now - t.lastSeen < this.maxLostMs)
      .sort((a, b) => a.id - b.id);
  }

  /** Tracks currently seen (not merely remembered). */
  visibleTracks(now = performance.now()) {
    return this.activeTracks(now).filter((t) => now - t.lastSeen < 500);
  }
}
