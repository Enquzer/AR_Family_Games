/**
 * Dance: follow the coach, hit the beat, and match the move.
 *
 * The coach is a procedural Avatar driven by joint targets. Every two beats a
 * new target pose is demonstrated; on the second beat the player's live pose is
 * compared against that target in scale-invariant body space. The score blends
 * hand position, lean, knee lift, torso twist and overall motion energy, so
 * standing still can never score.
 */
import * as THREE from '/vendor/three/three.module.js';
import { BaseGame } from './base.js';
import { buildDanceClub } from '../engine/environments.js';
import { Avatar } from '../engine/avatar.js';
import { clamp, damp } from '../shared/math.js';

const BPM = 112;
const BEAT = 60 / BPM;
const INTRO_BEATS = 4;
const BEATS_PER_MOVE = 2;
const RESULTS_SECONDS = 8;

/**
 * Hands are expressed relative to the shoulder centre in shoulder-width units.
 * y is positive *up* (the same convention as MotionTracker.handL/handR).
 * kneeL/kneeR are 0 (standing) to 1 (high knee). lean/twist are -1..1.
 */
const MOVES = [
  { name: 'RAISE THE ROOF', hands: [[-0.75, 1.55], [0.75, 1.55]], lean: 0, kneeL: 0.1, kneeR: 0.1, twist: 0 },
  { name: 'SIDE SWAY LEFT', hands: [[-1.25, 0.55], [-0.25, 1.15]], lean: -0.85, kneeL: 0.1, kneeR: 0.3, twist: -0.35 },
  { name: 'SIDE SWAY RIGHT', hands: [[0.25, 1.15], [1.25, 0.55]], lean: 0.85, kneeL: 0.3, kneeR: 0.1, twist: 0.35 },
  { name: 'DISCO POINT', hands: [[-0.55, -0.2], [0.85, 1.55]], lean: 0.2, kneeL: 0.1, kneeR: 0.15, twist: 0.45 },
  { name: 'PUNCH THE SKY', hands: [[-0.4, 1.7], [0.4, 1.7]], lean: 0, kneeL: 0.2, kneeR: 0.2, twist: 0 },
  { name: 'ROBOT ARMS', hands: [[-1.3, 0.15], [1.3, 0.15]], lean: 0, kneeL: 0.1, kneeR: 0.1, twist: 0 },
  { name: 'TWIST IT', hands: [[-1.0, 0.35], [1.0, 0.35]], lean: 0.1, kneeL: 0.1, kneeR: 0.1, twist: 0.75 },
  { name: 'LEFT KNEE UP', hands: [[-0.75, 1.15], [0.55, 0.3]], lean: -0.25, kneeL: 0.95, kneeR: 0.05, twist: -0.2 },
  { name: 'RIGHT KNEE UP', hands: [[-0.55, 0.3], [0.75, 1.15]], lean: 0.25, kneeL: 0.05, kneeR: 0.95, twist: 0.2 },
  { name: 'CLAP CLAP', hands: [[-0.12, 0.45], [0.12, 0.45]], lean: 0, kneeL: 0.15, kneeR: 0.15, twist: 0 },
  { name: 'WAVE LEFT', hands: [[-1.15, 1.4], [0.35, 0.35]], lean: -0.45, kneeL: 0.2, kneeR: 0.1, twist: -0.3 },
  { name: 'WAVE RIGHT', hands: [[-0.35, 0.35], [1.15, 1.4]], lean: 0.45, kneeL: 0.1, kneeR: 0.2, twist: 0.3 },
  { name: 'LOW GROOVE', hands: [[-0.95, -0.35], [0.95, -0.35]], lean: 0, kneeL: 0.45, kneeR: 0.45, twist: 0 },
  { name: 'CROSS & BOUNCE', hands: [[-0.2, 0.55], [0.2, 0.55]], lean: -0.15, kneeL: 0.25, kneeR: 0.25, twist: -0.6 },
  { name: 'STAR JUMP', hands: [[-1.2, 0.95], [1.2, 0.95]], lean: 0, kneeL: 0.3, kneeR: 0.3, twist: 0 },
  { name: 'BIG FINISH', hands: [[-0.5, 1.65], [0.5, 1.65]], lean: 0, kneeL: 0.15, kneeR: 0.15, twist: 0 },
];

const JOINT_KEYS = ['hip', 'neck', 'head', 'shL', 'shR', 'elL', 'elR', 'wrL', 'wrR', 'hipL', 'hipR', 'knL', 'knR', 'anL', 'anR', 'ftL', 'ftR'];

function blankDance() {
  return {
    score: 0,
    combo: 0,
    bestCombo: 0,
    perfects: 0,
    greats: 0,
    goods: 0,
    misses: 0,
    attempts: 0,
    matchTotal: 0,
    lastMatch: 0,
    energy: 0,
    grade: '',
  };
}

export class DanceGame extends BaseGame {
  constructor(ctx, options = {}) {
    super(ctx, options);
    this.id = 'dance';
    this.title = 'DANCE';
    this.subtitle = 'Follow the coach · match the move';
    this.phase = 'waiting';
    this.bpm = BPM;
    this.routineStart = 0;
    this.danceEnd = 0;
    this.lastBeat = -1;
    this.currentMove = MOVES[0];
    this.coach = null;
    this.coachPose = {};
    this.lastGrade = '';
    this.lastPoints = 0;
    this.resultsEnd = 0;
    this.feedbackTimer = 0;
    this.envPulse = 0;
  }

  buildWorld() {
    this.env = buildDanceClub();
    // The coach stands on a small side podium instead of directly behind the
    // players. A centre-stage coach is hidden by the middle player at normal
    // living-room camera angles, which makes the dance moves hard to copy.
    this.coachHome = new THREE.Vector3(-4.15, 0.18, -1.55);
    const podium = new THREE.Mesh(
      new THREE.CylinderGeometry(1.02, 1.12, 0.18, 36),
      new THREE.MeshStandardMaterial({ color: 0x120a22, roughness: 0.32, metalness: 0.78 })
    );
    podium.position.set(this.coachHome.x, 0.09, this.coachHome.z);
    this.env.scene.add(podium);
    const podiumRim = new THREE.Mesh(
      new THREE.TorusGeometry(1.03, 0.028, 8, 48),
      new THREE.MeshStandardMaterial({
        color: 0xf472b6,
        emissive: 0xf472b6,
        emissiveIntensity: 2.4,
        roughness: 0.3,
      })
    );
    podiumRim.rotation.x = -Math.PI / 2;
    podiumRim.position.set(this.coachHome.x, 0.19, this.coachHome.z);
    this.env.scene.add(podiumRim);
    const coachLight = new THREE.PointLight(0xf472b6, 20, 10, 2);
    coachLight.position.set(this.coachHome.x, 3.1, this.coachHome.z + 0.7);
    this.env.scene.add(coachLight);

    this.coach = new Avatar({ name: 'COACH', color: '#f472b6', id: 'coach' });
    this.coach.setProp('none');
    this.coach.setOnline(true);
    this.coach.followStage = false;
    this.coach.seated = false;
    this.coach.group.position.copy(this.coachHome);
    this.coach.facingTarget = 0.42;
    this.env.scene.add(this.coach.group);
    for (const k of JOINT_KEYS) this.coachPose[k] = new THREE.Vector3();
  }

  start() {
    if (!this.players.length) {
      this.phase = 'waiting';
      this.message = 'WAVE TO JOIN';
      this.messageSub = 'Wave at the camera to join the dance floor';
      return;
    }
    this.#beginRoutine();
  }

  addPlayer(p) {
    if (p.joined === false) return;
    super.addPlayer(p);
    p.avatar.setProp('none');
    p.avatar.seated = false;
    p.avatar.followStage = false;
    p.avatar.setVisible(true);
    p.dance = p.dance || blankDance();
    this.#placePlayers();
  }

  #beginRoutine() {
    this.phase = 'intro';
    this.routineStart = this.time;
    this.danceEnd = (INTRO_BEATS + MOVES.length * BEATS_PER_MOVE) * BEAT;
    this.lastBeat = -1;
    this.currentMove = MOVES[0];
    this.lastGrade = '';
    this.lastPoints = 0;
    this.resultsEnd = 0;
    this.message = 'GET READY';
    this.messageSub = 'Follow the coach · hit every move';
    for (const p of this.players) p.dance = blankDance();
    this.#placePlayers();
    this.ctx.audio.play('danceStart');
  }

  #placePlayers() {
    const n = this.players.length;
    const spacing = n <= 1 ? 0 : Math.min(1.65, 5.3 / (n - 1));
    this.players.forEach((p, i) => {
      const x = (i - (n - 1) / 2) * spacing;
      this.place(p, x, 1.35, { y: 0, facing: 0 });
      p.avatar.setVisible(true);
      p.avatar.setProp('none');
      p.avatar.seated = false;
      p.avatar.followStage = false;
    });
  }

  update(dt) {
    this.time += dt;
    this.feedbackTimer = Math.max(0, this.feedbackTimer - dt);

    if (this.phase === 'waiting') {
      if (this.players.length) this.start();
      this.updateCamera();
      return;
    }

    this.env.update?.(dt, this.time);
    this.#placePlayers();
    this.#updateCoach(dt);

    const localTime = this.time - this.routineStart;
    const beat = Math.floor(localTime / BEAT);
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      this.#onBeat(beat, localTime);
    }

    if (this.phase === 'dance' && localTime >= this.danceEnd) {
      this.#endDance();
    } else if (this.phase === 'results' && this.time >= this.resultsEnd) {
      this.#beginRoutine();
    }

    // Keep the feedback line visible for a moment, then fall back to the
    // current move name so the coach always has a caption.
    if (this.feedbackTimer <= 0 && this.phase === 'dance') {
      this.message = this.currentMove?.name || 'KEEP GROOVE';
      this.messageSub = 'Match the coach · stay on the beat';
    }

    this.updateCamera();
  }

  #onBeat(beat, localTime) {
    if (this.phase === 'intro') {
      const count = INTRO_BEATS - beat;
      if (count > 0) {
        this.message = `${count}`;
        this.messageSub = 'GET READY';
        this.ctx.audio.play('count');
      }
      if (beat >= INTRO_BEATS - 1) {
        this.phase = 'dance';
        this.message = 'DANCE!';
        this.messageSub = 'Follow the coach';
        this.ctx.audio.play('go');
      }
      return;
    }

    if (this.phase !== 'dance') return;

    const danceBeat = beat - INTRO_BEATS;
    if (danceBeat < 0) return;
    const moveIndex = Math.floor(danceBeat / BEATS_PER_MOVE);
    const moveBeat = danceBeat % BEATS_PER_MOVE;

    this.ctx.audio.play('beat', { accent: beat % 4 === 0 });
    if (beat % 4 === 2) this.ctx.audio.play('clap');
    if (beat % 8 === 0) this.ctx.audio.play('bass');

    if (moveIndex >= MOVES.length) {
      this.#endDance();
      return;
    }

    if (moveBeat === 0) {
      this.currentMove = MOVES[moveIndex];
      this.message = this.currentMove.name;
      this.messageSub = 'Watch the coach · follow the move';
      this.feedbackTimer = 0.45;
      return;
    }

    // Second beat of the move: the player has had one beat to copy it.
    this.currentMove = MOVES[moveIndex];
    this.#evaluate(moveIndex);
  }

  #evaluate(moveIndex) {
    const move = MOVES[moveIndex];
    if (!move) return;
    let best = null;

    for (const p of this.players) {
      if (!p.motion) continue;
      const state = p.motion.state || {};
      const match = this.#comparePose(state, move);
      const energy = clamp(Number(state.energy) || 0, 0, 1);
      const d = (p.dance = p.dance || blankDance());
      d.attempts++;
      d.matchTotal += match;
      d.lastMatch = match;
      d.energy = energy;

      // Standing still should not earn points even if the target happens to be
      // close to the idle pose.
      const energyFactor = clamp(0.3 + energy * 1.05, 0.3, 1.3);
      const points = Math.round(Math.pow(clamp(match, 0, 1), 1.35) * 150 * energyFactor * (1 + d.combo * 0.06));

      let grade = 'MISS';
      if (match >= 0.82 && energy > 0.16) grade = 'PERFECT';
      else if (match >= 0.64) grade = 'GREAT';
      else if (match >= 0.42) grade = 'GOOD';

      d.grade = grade;
      if (grade === 'MISS') {
        d.misses++;
        d.combo = 0;
      } else {
        d.score += points;
        d.combo++;
        d.bestCombo = Math.max(d.bestCombo, d.combo);
        if (grade === 'PERFECT') d.perfects++;
        else if (grade === 'GREAT') d.greats++;
        else d.goods++;
      }

      if (!best || points > best.points) best = { p, d, match, energy, points, grade };
    }

    if (!best) return;
    this.lastGrade = best.grade;
    this.lastPoints = best.grade === 'MISS' ? 0 : best.points;
    this.feedbackTimer = 0.95;

    if (best.grade === 'PERFECT') {
      this.message = `PERFECT! +${best.points}`;
      this.messageSub = `${best.p.name} · ${Math.round(best.match * 100)}% match`;
      this.ctx.audio.play('perfect');
      this.ctx.engine.shake(0.12, 0.2);
      this.fx.ring({ x: best.p.avatar.group.position.x, y: 1.3, z: best.p.avatar.group.position.z }, '#fbbf24', 1.8, 0.45);
      this.fx.burst({ x: best.p.avatar.group.position.x, y: 1.3, z: best.p.avatar.group.position.z }, '#fbbf24', 34, { speed: 4.2, life: 0.55 });
    } else if (best.grade === 'GREAT') {
      this.message = `GREAT! +${best.points}`;
      this.messageSub = `${best.p.name} · ${Math.round(best.match * 100)}% match`;
      this.ctx.audio.play('great');
      this.fx.ring({ x: best.p.avatar.group.position.x, y: 1.2, z: best.p.avatar.group.position.z }, '#22d3ee', 1.3, 0.35);
    } else if (best.grade === 'GOOD') {
      this.message = `GOOD +${best.points}`;
      this.messageSub = `${best.p.name} · keep the groove`;
      this.ctx.audio.play('good');
    } else {
      this.message = 'MISS!';
      this.messageSub = `${best.p.name} · follow the coach`;
      this.ctx.audio.play('bad');
    }
  }

  #comparePose(state, move) {
    const hL = state.handL || { x: 0, y: 0 };
    const hR = state.handR || { x: 0, y: 0 };
    const targetL = move.hands[0];
    const targetR = move.hands[1];
    const dL = Math.hypot(hL.x - targetL[0], hL.y - targetL[1]);
    const dR = Math.hypot(hR.x - targetR[0], hR.y - targetR[1]);
    const handScore = 1 - clamp((dL + dR) / 2 / 1.75, 0, 1);
    const leanScore = 1 - clamp(Math.abs((state.lean || 0) - (move.lean || 0)) / 1.55, 0, 1);
    const kneeScore =
      1 -
      clamp(
        (Math.abs((state.kneeLiftL || 0) - (move.kneeL || 0)) +
          Math.abs((state.kneeLiftR || 0) - (move.kneeR || 0))) /
          2,
        0,
        1
      );
    const twistScore = 1 - clamp(Math.abs((state.torsoTwist || 0) - (move.twist || 0)) / 1.8, 0, 1);
    return clamp(handScore * 0.55 + leanScore * 0.15 + kneeScore * 0.2 + twistScore * 0.1, 0, 1);
  }

  #updateCoach(dt) {
    if (!this.coach) return;
    const localTime = this.time - this.routineStart;
    const beatPhase = ((localTime / BEAT) % 1 + 1) % 1;
    const pulse = Math.sin(beatPhase * Math.PI * 2);
    const move = this.currentMove || MOVES[0];
    this.#setCoachPose(move, pulse, localTime);
    this.coach.facingTarget = 0.42;
    this.coach.group.position.copy(this.coachHome);
    this.coach.update(null, null, dt, {
      active: false,
      poseTargets: this.coachPose,
      poseLambda: 14,
    });
  }

  #setCoachPose(move, pulse, localTime) {
    const bob = Math.sin(localTime * 6.2) * 0.01 + pulse * 0.006;
    const lean = Number(move.lean) || 0;
    const twist = Number(move.twist) || 0;
    const p = this.coachPose;

    const hipY = 0.93 + bob;
    const shY = 1.37 + bob;
    p.hip.set(-lean * 0.035, hipY, 0);
    p.hipL.set(-0.1 - lean * 0.02, hipY - 0.01, -twist * 0.04);
    p.hipR.set(0.1 - lean * 0.02, hipY - 0.01, twist * 0.04);
    p.neck.set(lean * 0.05, 1.42 + bob, twist * 0.025);
    p.head.set(lean * 0.08, 1.65 + bob, twist * 0.04);
    p.shL.set(-0.2 + lean * 0.06, shY, twist * 0.055);
    p.shR.set(0.2 + lean * 0.06, shY, -twist * 0.055);

    const armScale = 0.4;
    const hand = (sh, target, side) => {
      const wx = sh.x + target[0] * armScale;
      const wy = sh.y + target[1] * armScale;
      const wz = 0.055 + (side === 'L' ? -twist * 0.035 : twist * 0.035);
      return { wx, wy, wz };
    };
    const l = hand(p.shL, move.hands[0], 'L');
    const r = hand(p.shR, move.hands[1], 'R');
    p.wrL.set(l.wx, l.wy, l.wz);
    p.wrR.set(r.wx, r.wy, r.wz);
    p.elL.set(p.shL.x + (p.wrL.x - p.shL.x) * 0.52, p.shL.y + (p.wrL.y - p.shL.y) * 0.52 - 0.035, 0.025);
    p.elR.set(p.shR.x + (p.wrR.x - p.shR.x) * 0.52, p.shR.y + (p.wrR.y - p.shR.y) * 0.52 - 0.035, 0.025);

    const setLeg = (hipJ, kn, an, ft, lift) => {
      const lf = clamp(Number(lift) || 0, 0, 1);
      kn.set(hipJ.x + (hipJ.x < 0 ? -0.02 : 0.02), 0.52 + lf * 0.22 + bob * 0.4, 0.02 + lf * 0.18);
      an.set(hipJ.x + (hipJ.x < 0 ? -0.03 : 0.03), 0.08 + lf * 0.34 + bob * 0.2, 0.02 + lf * 0.2);
      ft.set(an.x, Math.max(0.04, an.y - 0.04), an.z + 0.1);
    };
    setLeg(p.hipL, p.knL, p.anL, p.ftL, move.kneeL);
    setLeg(p.hipR, p.knR, p.anR, p.ftR, move.kneeR);
  }

  #endDance() {
    if (this.phase === 'results') return;
    this.phase = 'results';
    this.resultsEnd = this.time + RESULTS_SECONDS;
    const ranked = [...this.players].sort((a, b) => (b.dance?.score || 0) - (a.dance?.score || 0));
    const winner = ranked[0];
    this.message = winner ? `${winner.name.toUpperCase()} OWNS THE FLOOR!` : 'DANCE COMPLETE';
    this.messageSub = 'Next routine starting soon';
    this.ctx.audio.play('danceEnd');
    this.fx.confetti({ x: 0, y: 2.2, z: -1.2 }, 140);
    this.ctx.engine.shake(0.18, 0.35);
  }

  updateCamera() {
    super.updateCamera();
  }

  getHud() {
    const localTime = Math.max(0, this.time - this.routineStart);
    const list = this.players
      .map((p) => {
        const d = p.dance || blankDance();
        const accuracy = d.attempts ? Math.round((d.matchTotal / d.attempts) * 100) : 0;
        return {
          id: p.key,
          name: p.name,
          color: p.color,
          value: d.score,
          max: 0,
          label: '',
          points: d.score,
          detail: `x${d.combo} · ${accuracy}% groove · ${Math.round(d.energy * 100)}% energy`,
          rank: null,
          active: true,
        };
      })
      .sort((a, b) => b.points - a.points)
      .map((x, i) => ({ ...x, rank: i + 1 }));

    const best = list[0];
    const scoreLine = best
      ? `SCORE ${Math.round(best.points).toLocaleString()} · ${best.detail}`
      : '';

    const results =
      this.phase === 'results'
        ? list.map((p) => ({
            name: p.name,
            color: p.color,
            detail: p.detail,
            rank: p.rank,
            gained: p.points,
          }))
        : [];

    const introBeat = Math.floor(localTime / BEAT);
    return {
      title: this.title,
      subtitle: `${this.bpm} BPM · follow the coach`,
      phase: this.phase,
      timer: this.phase === 'dance' ? Math.max(0, this.danceEnd - localTime) : null,
      score: scoreLine,
      message: this.message,
      messageSub: this.messageSub,
      big:
        this.phase === 'intro'
          ? { text: `${Math.max(1, INTRO_BEATS - introBeat)}`, sub: 'GET READY' }
          : null,
      players: list,
      results,
      queue: [],
    };
  }

  dispose() {
    if (this.coach) {
      this.coach.dispose();
      this.coach = null;
    }
    super.dispose();
  }
}
