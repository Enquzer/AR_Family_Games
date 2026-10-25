/**
 * Synthetic multi-player motion. Used for the built-in demo mode, for testing
 * without a camera, and as a fallback when the camera is unavailable.
 *
 * Produces the same landmark format as MediaPipe (33 x {x,y,z,visibility}).
 */
import { clamp, rand } from '../shared/math.js';
import { PLAYER_COLORS } from './poseTracker.js';

const SCENARIOS = {
  menu: 'idle',
  boxing: 'punch',
  tennis: 'swing',
  sprint: 'run',
  hurdles: 'runjump',
  boat: 'row',
  coaster: 'coaster',
  dance: 'dance',
  balling: 'ball',
  longjump: 'runjump',
  idle: 'idle',
};

const BASE = {
  0: [0.5, 0.205], 1: [0.484, 0.192], 2: [0.482, 0.19], 3: [0.516, 0.192], 4: [0.518, 0.19],
  5: [0.484, 0.19], 6: [0.516, 0.19], 7: [0.466, 0.203], 8: [0.534, 0.203],
  9: [0.492, 0.23], 10: [0.508, 0.23],
  11: [0.458, 0.318], 12: [0.542, 0.318],
  13: [0.443, 0.43], 14: [0.557, 0.43],
  15: [0.437, 0.535], 16: [0.563, 0.535],
  17: [0.435, 0.548], 18: [0.565, 0.548], 19: [0.433, 0.56], 20: [0.567, 0.56],
  21: [0.43, 0.548], 22: [0.57, 0.548],
  23: [0.469, 0.545], 24: [0.531, 0.545],
  25: [0.468, 0.712], 26: [0.532, 0.712],
  27: [0.466, 0.887], 28: [0.534, 0.887],
  29: [0.464, 0.907], 30: [0.536, 0.907],
  31: [0.462, 0.912], 32: [0.538, 0.912],
};

function baseLandmarks() {
  const lm = [];
  for (let i = 0; i < 33; i++) {
    const b = BASE[i] || [0.5, 0.5];
    lm.push({ x: b[0], y: b[1], z: 0, visibility: 0.92 });
  }
  return lm;
}

function shift(lm, idx, dx, dy, dz = 0) {
  lm[idx].x += dx;
  lm[idx].y += dy;
  lm[idx].z += dz;
}

export class PoseSimulator {
  constructor({ players = 2, scenario = 'idle' } = {}) {
    this.count = players;
    this.scenario = SCENARIOS[scenario] || scenario || 'idle';
    this.t = 0;
    this.punchTimer = 0;
    this.jumpTimer = 0;
    this.players = [];
    this.colors = PLAYER_COLORS;
    this.speed = 1;
    this.danceGuide = null;
    this.#rebuild();
  }

  setPlayerCount(n) {
    this.count = clamp(Math.round(n), 1, 4);
    this.#rebuild();
  }

  setScenario(gameId) {
    this.scenario = SCENARIOS[gameId] || (['idle', 'run', 'punch', 'swing', 'row', 'coaster', 'dance', 'ball', 'runjump'].includes(gameId) ? gameId : 'idle');
  }

  /** Demo dancers follow the same target pose the real coach is showing. */
  setDanceGuide(move) {
    this.danceGuide = move || null;
  }

  #rebuild() {
    const old = this.players;
    this.players = [];
    for (let i = 0; i < this.count; i++) {
      this.players.push({
        id: i + 1,
        name: old[i]?.name || `Player ${i + 1}`,
        color: this.colors[i % this.colors.length],
        lm: baseLandmarks(),
      });
    }
  }

  update(dt) {
    this.t += dt;
    this.punchTimer += dt;
    this.jumpTimer += dt;

    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const lm = baseLandmarks();
      const phase = this.t * 1.7 + i * 1.9;
      const bob = Math.sin(phase * 1.3) * 0.006;

      // horizontal spread so players do not overlap
      const spread = (i - (this.players.length - 1) / 2) * 0.14;
      for (const k of Object.keys(lm)) {
        lm[k].x += spread;
        lm[k].y += bob + Math.sin(phase + i) * 0.002;
        lm[k].z += Math.sin(phase * 0.7 + i) * 0.01;
      }

      switch (this.scenario) {
        case 'run':
          this.#run(lm, phase, i);
          break;
        case 'runjump':
          this.#run(lm, phase, i);
          this.#periodicJump(lm, i, 2.4);
          break;
        case 'punch':
          this.#punch(lm, i);
          break;
        case 'swing':
          this.#swing(lm, phase, i);
          break;
        case 'row':
          this.#row(lm, phase, i);
          break;
        case 'coaster':
          this.#coaster(lm, phase, i);
          break;
        case 'dance':
          this.#dance(lm, phase, i);
          break;
        case 'ball':
          this.#ball(lm, phase, i);
          break;
        default:
          this.#idle(lm, phase, i);
      }

      // tiny sensor noise
      for (let k = 0; k < lm.length; k++) {
        lm[k].x += rand(-0.0015, 0.0015);
        lm[k].y += rand(-0.0015, 0.0015);
      }
      p.lm = lm;
    }
    return this.players;
  }

  #idle(lm, phase, i) {
    const sway = Math.sin(phase * 0.9 + i) * 0.006;
    shift(lm, 11, sway, 0);
    shift(lm, 12, sway, 0);
    shift(lm, 15, sway * 1.4, Math.sin(phase) * 0.004);
    shift(lm, 16, sway * 1.4, -Math.sin(phase) * 0.004);
    shift(lm, 25, sway * 0.4, 0);
    shift(lm, 26, sway * 0.4, 0);
  }

  #run(lm, phase, i) {
    // A brisk demo cadence (~3 steps/s) so running games actually progress.
    const runPhase = this.t * 9 + i * 1.9;
    const swing = Math.sin(runPhase);
    const swing2 = Math.cos(runPhase);
    // legs alternate; knees lift toward the camera
    const liftL = Math.max(0, swing) * 0.115;
    const liftR = Math.max(0, -swing) * 0.115;
    shift(lm, 25, -0.012 - swing * 0.012, -liftL * 0.55, -liftL * 0.5);
    shift(lm, 27, -0.008 - swing * 0.02, -liftL, -liftL * 0.9);
    shift(lm, 29, -0.006, -liftL, -liftL * 0.9);
    shift(lm, 31, -0.01, -liftL, -liftL * 0.9);
    shift(lm, 26, 0.012 + swing * 0.012, -liftR * 0.55, liftR * 0.5);
    shift(lm, 28, 0.008 + swing * 0.02, -liftR, liftR * 0.9);
    shift(lm, 30, 0.006, -liftR, liftR * 0.9);
    shift(lm, 32, 0.01, -liftR, liftR * 0.9);
    // arms opposite the legs
    shift(lm, 13, 0.01, swing * 0.055, swing * 0.06);
    shift(lm, 15, 0.012, swing * 0.13, swing * 0.1);
    shift(lm, 14, -0.01, -swing * 0.055, -swing * 0.06);
    shift(lm, 16, -0.012, -swing * 0.13, -swing * 0.1);
    // torso bob + lean forward
    const b = -Math.abs(swing2) * 0.012;
    for (const k of [0, 11, 12, 13, 14, 23, 24]) shift(lm, k, 0, b);
    shift(lm, 0, 0, 0.004);
  }

  #periodicJump(lm, i, period) {
    const p = (this.t + i * 0.7) % period;
    if (p < 0.62) {
      const h = Math.sin((p / 0.62) * Math.PI) * 0.14;
      for (let k = 0; k < lm.length; k++) lm[k].y -= h;
      shift(lm, 27, 0, -h * 0.25);
      shift(lm, 28, 0, -h * 0.25);
      shift(lm, 15, 0, -h * 0.2);
      shift(lm, 16, 0, -h * 0.2);
    }
  }

  #punch(lm, i) {
    // alternate a left/right punch roughly every 0.9s
    const p = (this.t * 1.15 + i * 0.5) % 1.8;
    const pulse = p < 0.42 ? Math.sin((p / 0.42) * Math.PI) : 0;
    const left = Math.floor((this.t * 1.15 + i * 0.5) / 1.8) % 2 === 0;
    const shoulder = left ? 11 : 12;
    const elbow = left ? 13 : 14;
    const wrist = left ? 15 : 16;
    const sign = left ? 1 : -1;
    const guardWrist = left ? 16 : 15;
    const guardElbow = left ? 14 : 13;

    // guard hand stays up
    shift(lm, guardElbow, -sign * 0.012, -0.055, -0.04);
    shift(lm, guardWrist, -sign * 0.025, -0.16, -0.08);
    shift(lm, shoulder, sign * 0.008, -0.008, 0);
    shift(lm, elbow, sign * 0.02 * pulse, -0.02 - 0.05 * pulse, -0.16 * pulse);
    shift(lm, wrist, sign * 0.045 * pulse, -0.02 - 0.11 * pulse, -0.26 * pulse);
    // torso rotates into the punch
    for (const k of [11, 12, 23, 24, 0]) shift(lm, k, -sign * 0.006 * pulse, 0, 0);
    // bounce
    const b = Math.sin(this.t * 8) * 0.004;
    for (const k of [0, 11, 12, 23, 24, 15, 16]) shift(lm, k, 0, b);
  }

  #swing(lm, phase, i) {
    const p = (this.t * 1.4 + i * 0.6) % 2.1;
    const pulse = p < 0.5 ? Math.sin((p / 0.5) * Math.PI) : 0;
    const left = Math.floor((this.t * 1.4 + i * 0.6) / 2.1) % 2 === 0;
    const wrist = left ? 15 : 16;
    const elbow = left ? 13 : 14;
    const sign = left ? 1 : -1;
    // swing across the body, from out wide to the opposite shoulder
    shift(lm, elbow, -sign * 0.02 - sign * 0.03 * pulse, -0.08 - 0.02 * pulse, -0.1 * pulse);
    shift(lm, wrist, -sign * 0.06 - sign * 0.14 * pulse, -0.16 + 0.02 * pulse, -0.18 * pulse);
    // other hand in front
    shift(lm, left ? 16 : 15, (left ? -1 : 1) * 0.01, -0.08, -0.06);
    for (const k of [11, 12, 23, 24]) shift(lm, k, sign * 0.006 * pulse, 0, 0);
  }

  #row(lm, phase, i) {
    const p = (this.t * 2.2 + i * 0.8) % 1;
    const pull = (Math.cos(p * Math.PI * 2) + 1) / 2; // 1 = at chest
    // both hands pull from extended to the chest
    for (const [sh, el, wr, sign] of [[11, 13, 15, 1], [12, 14, 16, -1]]) {
      shift(lm, el, sign * (0.012 + 0.012 * pull), -0.02 - 0.03 * pull, -0.13 + 0.1 * pull);
      shift(lm, wr, sign * (0.02 + 0.02 * pull), -0.1 + 0.09 * pull, -0.24 + 0.2 * pull);
    }
    // lean back on the drive
    shift(lm, 11, 0, 0.01 * pull);
    shift(lm, 12, 0, 0.01 * pull);
    shift(lm, 23, 0, 0.005 * pull);
    shift(lm, 24, 0, 0.005 * pull);
    shift(lm, 0, 0, 0.012 * pull);
    // legs brace
    shift(lm, 25, -0.01, 0.01, 0.02);
    shift(lm, 26, 0.01, 0.01, 0.02);
  }

  #dance(lm, phase, i) {
    // In demo mode the dancers copy the coach's current target pose. This makes
    // the demo read like a real follow-the-coach routine instead of a separate
    // animation that only accidentally matches the game's scoring targets.
    const guide = this.danceGuide;
    const t = this.t * 1.7 + i * 0.9;
    const bounce = Math.sin(t * 5.0) * 0.012;
    const sway = Math.sin(t * 2.2) * 0.03;

    if (guide) {
      // Keep a little life in the pose so energy never drops to zero.
      for (const k of [0, 11, 12, 13, 14, 15, 16, 23, 24]) shift(lm, k, sway, bounce * 0.5);
      const lean = clamp(Number(guide.lean) || 0, -1, 1);
      const twist = clamp(Number(guide.twist) || 0, -1, 1);

      // Lean is measured from the shoulder centre to the ankle centre.
      shift(lm, 11, lean * 0.12, 0, 0);
      shift(lm, 12, lean * 0.12, 0, 0);
      shift(lm, 23, -lean * 0.04, 0, 0);
      shift(lm, 24, -lean * 0.04, 0, 0);
      shift(lm, 27, -lean * 0.02, 0, 0);
      shift(lm, 28, -lean * 0.02, 0, 0);

      // Torso twist comes from the difference between shoulder and hip spans.
      shift(lm, 23, twist * 0.022, 0, 0);
      shift(lm, 24, -twist * 0.022, 0, 0);
      shift(lm, 11, 0, 0, -twist * 0.035);
      shift(lm, 12, 0, 0, twist * 0.035);
      shift(lm, 23, 0, 0, twist * 0.025);
      shift(lm, 24, 0, 0, -twist * 0.025);

      const cx = (lm[11].x + lm[12].x) * 0.5;
      const cy = (lm[11].y + lm[12].y) * 0.5;
      const sw = Math.max(0.06, Math.abs(lm[12].x - lm[11].x));
      for (const k of [25, 26, 27, 28, 29, 30, 31, 32]) shift(lm, k, sway * 0.35, bounce * 0.25, 0);
      const setWrist = (idx, target, side) => {
        const tx = Number(target?.[0]) || 0;
        const ty = Number(target?.[1]) || 0;
        lm[idx].x = cx + tx * sw + sway * 0.5;
        lm[idx].y = cy - ty * sw + Math.sin(t * 6.1 + side) * 0.006;
        lm[idx].z = -0.02 - Math.abs(ty) * 0.018 + (side ? twist * 0.02 : -twist * 0.02);
      };
      setWrist(15, guide.hands?.[0], 0);
      setWrist(16, guide.hands?.[1], 1);
      lm[13].x = (lm[11].x + lm[15].x) * 0.5;
      lm[13].y = (lm[11].y + lm[15].y) * 0.5;
      lm[13].z = (lm[11].z + lm[15].z) * 0.5;
      lm[14].x = (lm[12].x + lm[16].x) * 0.5;
      lm[14].y = (lm[12].y + lm[16].y) * 0.5;
      lm[14].z = (lm[12].z + lm[16].z) * 0.5;

      const liftL = clamp(Number(guide.kneeL) || 0, 0, 1);
      const liftR = clamp(Number(guide.kneeR) || 0, 0, 1);
      const liftLeg = (knee, ankle, foot, lift, side) => {
        shift(lm, knee, side * 0.006, -lift * 0.135, -lift * 0.1);
        shift(lm, ankle, side * 0.008, -lift * 0.055, -lift * 0.08);
        shift(lm, foot, side * 0.008, -lift * 0.045, -lift * 0.08);
      };
      liftLeg(25, 27, 29, liftL, -1);
      liftLeg(26, 28, 30, liftR, 1);
      return;
    }

    // Fallback routine when there is no game guide (e.g. the attract screen).
    const up = Math.sin(t * 2.0);
    const alt = Math.sin(t * 2.0 + Math.PI / 2);
    for (const k of [0, 11, 12, 13, 14, 15, 16, 23, 24]) shift(lm, k, sway * 1.7, bounce);
    shift(lm, 11, sway * 3, 0, sway * 3.4);
    shift(lm, 12, sway * 3, 0, -sway * 3.4);
    shift(lm, 23, sway * 1.7, 0, -sway * 2.1);
    shift(lm, 24, sway * 1.7, 0, sway * 2.1);
    shift(lm, 0, sway * 2.1, 0, 0);

    const leftUp = Math.max(0, up);
    const rightUp = Math.max(0, -up);
    shift(lm, 15, -0.035 + sway * 4.2 - leftUp * 0.03, -0.06 - leftUp * 0.38, -0.08 - leftUp * 0.12);
    shift(lm, 16, 0.035 + sway * 4.2 + rightUp * 0.03, -0.06 - rightUp * 0.38, -0.08 - rightUp * 0.12);
    shift(lm, 13, -0.02 + sway * 2.5, -0.04 - leftUp * 0.16, -0.03 - leftUp * 0.06);
    shift(lm, 14, 0.02 + sway * 2.5, -0.04 - rightUp * 0.16, -0.03 - rightUp * 0.06);

    const liftL = Math.max(0, alt) * 0.22;
    const liftR = Math.max(0, -alt) * 0.22;
    shift(lm, 25, -0.012, -liftL * 0.55, -liftL * 0.55);
    shift(lm, 27, -0.012, -liftL, -liftL * 0.95);
    shift(lm, 29, -0.01, -liftL, -liftL * 0.95);
    shift(lm, 31, -0.014, -liftL, -liftL * 0.95);
    shift(lm, 26, 0.012, -liftR * 0.55, -liftR * 0.55);
    shift(lm, 28, 0.012, -liftR, -liftR * 0.95);
    shift(lm, 30, 0.01, -liftR, -liftR * 0.95);
    shift(lm, 32, 0.014, -liftR, -liftR * 0.95);
  }

  #ball(lm, phase, i) {
    // Hold the ball with both hands, swivel left/right to aim, then push the
    // hands forward every couple of seconds. The forward burst is what the
    // MotionTracker turns into a 'push' event.
    const t = this.t * 1.35 + i * 0.63;
    const sway = Math.sin(t * 0.85);
    const cycle = ((this.t * 0.5 + i * 0.19) % 1 + 1) % 1;
    const push = cycle < 0.24 ? Math.sin((cycle / 0.24) * Math.PI) : 0;
    const bob = Math.sin(t * 3.1) * 0.006;

    for (const k of [0, 11, 12, 23, 24, 25, 26, 27, 28]) shift(lm, k, sway * 0.012, bob);
    shift(lm, 11, sway * 0.012, 0, 0);
    shift(lm, 12, sway * 0.012, 0, 0);
    shift(lm, 23, sway * 0.008, 0, 0);
    shift(lm, 24, sway * 0.008, 0, 0);
    shift(lm, 0, sway * 0.02, 0, 0);

    // Both hands are held in front at chest height and pushed toward the TV.
    // Keep the swivel moderate: the aim is scaled from shoulder-width units,
    // so a small hand shift already produces a readable left/right angle.
    shift(lm, 15, sway * 0.012 + 0.02, -0.11 - push * 0.02, -0.1 - push * 0.12);
    shift(lm, 16, sway * 0.012 - 0.02, -0.11 - push * 0.02, -0.1 - push * 0.12);
    shift(lm, 13, sway * 0.008 + 0.012, -0.05 - push * 0.01, -0.05 - push * 0.06);
    shift(lm, 14, sway * 0.008 - 0.012, -0.05 - push * 0.01, -0.05 - push * 0.06);

    const lift = Math.max(0, Math.sin(t * 1.7)) * 0.035;
    shift(lm, 27, -0.008, -lift, -lift * 0.3);
    shift(lm, 29, -0.008, -lift, -lift * 0.3);
    shift(lm, 28, 0.008, -lift, -lift * 0.3);
    shift(lm, 30, 0.008, -lift, -lift * 0.3);
  }

  #coaster(lm, phase, i) {
    const lean = Math.sin(this.t * 0.8 + i * 0.5) * 0.9;
    for (const k of [11, 12, 13, 14, 15, 16, 0]) shift(lm, k, lean * 0.035, 0, 0);
    const up = Math.sin(this.t * 0.7 + i) > 0.45;
    if (up) {
      shift(lm, 13, -0.02, -0.15, 0.02);
      shift(lm, 15, -0.02, -0.3, 0.02);
      shift(lm, 14, 0.02, -0.15, 0.02);
      shift(lm, 16, 0.02, -0.3, 0.02);
    }
    // seated: knees up
    shift(lm, 25, -0.01, 0.02, -0.08);
    shift(lm, 27, -0.02, 0.02, -0.16);
    shift(lm, 26, 0.01, 0.02, -0.08);
    shift(lm, 28, 0.02, 0.02, -0.16);
    shift(lm, 29, -0.02, 0.02, -0.16);
    shift(lm, 30, 0.02, 0.02, -0.16);
  }
}
