/** Sprint + hurdles: up to 4 players, running in place, three heats, points. */
import * as THREE from '/vendor/three/three.module.js';
import { BaseGame } from './base.js';
import { buildTrack } from '../engine/environments.js';
import { clamp, damp } from '../shared/math.js';

const LANE_GAP = 2.1;

export class TrackGame extends BaseGame {
  constructor(ctx, options = {}) {
    super(ctx, options);
    this.id = options.id || 'sprint';
    this.title = options.title || 'SPRINT';
    this.subtitle = options.subtitle || 'Run in place to move';
    this.distance = options.distance || 60;
    this.heats = options.heats ?? 3;
    this.hurdleXs = options.hurdles || null;
    this.maxSpeed = options.maxSpeed || 10.2;
    this.heat = 1;
    this.points = new Map();
    this.states = new Map();
    this.phase = 'waiting';
    this.phaseTimer = 0;
    this.raceTime = 0;
    this.finishOrder = [];
    this.countTick = 0;
    this.firstFinishAt = 0;
    this.results = [];
    this.dustTimers = new Map();
  }

  buildWorld() {
    this.env = buildTrack({ finish: this.distance, hurdles: this.hurdleXs, laneCount: 4 });
    // finish line on the track at the actual distance
    const lineTex = this.#checkerTexture();
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 12),
      new THREE.MeshStandardMaterial({ map: lineTex, roughness: 0.8 })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(this.distance, 0.02, 0);
    this.env.scene.add(line);
  }

  #checkerTexture() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 512;
    const ctx = c.getContext('2d');
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 4; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#0f172a' : '#f8fafc';
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  start() {
    this.heat = 1;
    this.points.clear();
    this.results = [];
    if (!this.players.length) {
      this.phase = 'waiting';
      this.message = 'WAVE TO JOIN';
      this.messageSub = 'Wave at the camera to become the controller';
      return;
    }
    this.beginHeat();
  }

  addPlayer(p) {
    super.addPlayer(p);
    // A player can walk in while a heat is already running: give them a lane
    // and state instead of leaving them without a scoreboard entry.
    if (this.phase !== 'waiting' && !this.states.has(p.key)) {
      const i = this.players.indexOf(p);
      const n = this.players.length;
      const laneZ = n === 1 ? 0 : (i - (n - 1) / 2) * LANE_GAP;
      this.states.set(p.key, {
        x: 0,
        speed: 0,
        laneZ,
        finished: false,
        time: null,
        falseStart: 0,
        stumble: 0,
        jumpWindow: 0,
        cleared: new Set(),
        rank: null,
      });
      p.avatar.setVisible(true);
      p.avatar.setProp('none');
      p.avatar.seated = false;
      p.avatar.followStage = false;
      this.place(p, 0, laneZ, { y: 0, facing: 0 });
    }
    if (this.phase === 'waiting' && this.players.length) this.start();
  }

  beginHeat() {
    this.phase = 'intro';
    this.phaseTimer = 4.2;
    this.raceTime = 0;
    this.finishOrder = [];
    this.firstFinishAt = 0;
    this.countTick = 0;
    this.states.clear();
    const n = this.players.length;
    this.players.forEach((p, i) => {
      const laneZ = n === 1 ? 0 : (i - (n - 1) / 2) * LANE_GAP;
      this.states.set(p.key, {
        x: 0,
        speed: 0,
        laneZ,
        finished: false,
        time: null,
        falseStart: 0,
        stumble: 0,
        jumpWindow: 0,
        cleared: new Set(),
        rank: null,
      });
      p.avatar.setVisible(true);
      p.avatar.setProp('none');
      p.avatar.seated = false;
      p.avatar.followStage = false;
      this.place(p, 0, laneZ, { y: 0, facing: 0 });
    });
    this.message = `HEAT ${this.heat}`;
    this.messageSub = 'Get ready';
    this.ctx.audio.play('whistle');
  }

  update(dt) {
    this.time += dt;
    if (this.phase === 'waiting') {
      if (this.players.length) this.start();
      this.updateCamera();
      return;
    }
    this.phaseTimer -= dt;

    for (const p of this.players) {
      const events = this.drain(p);
      const s = this.states.get(p.key);
      if (!s) continue;
      for (const e of events) {
        if (e.type === 'jump') {
          s.jumpWindow = 0.65;
          if (this.hurdleXs && !s.finished) {
            this.fx.ring({ x: s.x, y: 0.05, z: s.laneZ }, p.color, 1.2, 0.4);
          }
        }
      }
    }

    if (this.phase === 'intro') {
      const n = Math.ceil(this.phaseTimer - 1.0);
      if (n > 0 && n <= 3 && n !== this.countTick) {
        this.countTick = n;
        this.ctx.audio.play('count');
      }
      this.messageSub = this.phaseTimer > 1 ? `${Math.max(1, Math.ceil(this.phaseTimer - 1))}` : 'GO!';
      // false start
      for (const p of this.players) {
        const s = this.states.get(p.key);
        if (
          !this.options.demo &&
          s &&
          s.falseStart <= 0 &&
          Number.isFinite(p.motion.run) &&
          p.motion.run > 0.3 &&
          this.phaseTimer > 1.1
        ) {
          s.falseStart = 1.2;
          this.message = 'FALSE START';
          this.messageSub = `${p.name} +1s penalty`;
          this.ctx.audio.play('whistle');
        }
      }
      if (this.phaseTimer <= 1) {
        this.phase = 'race';
        this.raceTime = 0;
        this.message = 'GO!';
        this.messageSub = '';
        this.ctx.audio.play('go');
      }
      this.updateRunners(dt, true);
      this.updateCamera();
      return;
    }

    if (this.phase === 'race') {
      this.raceTime += dt;
      if (this.raceTime > 1.2 && this.message === 'GO!') {
        this.message = '';
        this.messageSub = '';
      }
      this.updateRunners(dt, false);
      const allDone = [...this.states.values()].every((s) => s.finished);
      if (allDone) this.endHeat();
      else if (this.firstFinishAt && this.raceTime - this.firstFinishAt > 10) this.endHeat();
      this.updateCamera();
      return;
    }

    if (this.phase === 'results') {
      this.updateRunners(dt, true);
      if (this.phaseTimer <= 0) {
        if (this.heat < this.heats) {
          this.heat++;
          this.beginHeat();
        } else {
          this.phase = 'final';
          this.phaseTimer = 10;
          const standings = [...this.points.entries()].sort((a, b) => b[1] - a[1]);
          const champ = standings[0];
          const name = champ ? this.players.find((p) => p.key === champ[0])?.name : null;
          this.message = name ? `${name.toUpperCase()} WINS THE SERIES!` : 'SERIES COMPLETE';
          this.messageSub = 'New series starting soon';
          this.ctx.audio.play('cheer');
          this.fx.confetti({ x: this.distance - 6, y: 3, z: 0 }, 140);
        }
      }
      this.updateCamera();
      return;
    }

    if (this.phase === 'final') {
      this.updateRunners(dt, true);
      if (this.phaseTimer <= 0) {
        this.points.clear();
        this.heat = 1;
        this.beginHeat();
      }
      this.updateCamera();
    }
  }

  updateRunners(dt, frozen) {
    for (const p of this.players) {
      const s = this.states.get(p.key);
      if (!s) continue;
      // The penalty only starts counting down once the race is actually running.
      if (!frozen && s.falseStart > 0) s.falseStart = Math.max(0, s.falseStart - dt);
      if (s.stumble > 0) s.stumble = Math.max(0, s.stumble - dt);
      if (s.jumpWindow > 0) s.jumpWindow = Math.max(0, s.jumpWindow - dt);

      let target = 0;
      if (!frozen && !s.finished && s.falseStart <= 0) {
        // The tracker fuses leg lift, knee lift, arm swing and hip bob. Keep a
        // direct fallback here so a player who runs with big arm pumps still
        // moves even if their ankles are occluded by the TV stand.
        const trackedRun = Number.isFinite(p.motion.run) ? p.motion.run : 0;
        const limbRun = (Number(p.motion.legDrive) || 0) * 0.55 + (Number(p.motion.armDrive) || 0) * 0.22;
        const run = Math.max(trackedRun, limbRun, (Number(p.motion.energy) || 0) * 0.8);
        target = clamp(run, 0, 1.4) * this.maxSpeed;
        if (s.stumble > 0) target *= 0.35;
      }
      s.speed = damp(s.speed, target, s.stumble > 0 ? 10 : 6.2, dt);

      // Footstep audio makes the running cadence feel physical without a
      // looping music track.
      if (!frozen && s.speed > 2 && p.motion.steps !== p._lastStepCount) {
        p._lastStepCount = p.motion.steps;
        this.ctx.audio.play('step');
      }
      if (!s.finished) {
        s.x += s.speed * dt;
        if (s.x >= this.distance) {
          s.x = this.distance;
          s.finished = true;
          s.time = this.raceTime;
          s.rank = this.finishOrder.length + 1;
          this.finishOrder.push(p.key);
          if (!this.firstFinishAt) this.firstFinishAt = this.raceTime;
          this.ctx.audio.play('cheer');
          this.fx.confetti({ x: this.distance, y: 1.6, z: s.laneZ }, 40);
        }
      }

      // hurdles
      if (this.hurdleXs && !s.finished) {
        for (const hx of this.hurdleXs) {
          if (s.cleared.has(hx)) continue;
          if (s.x > hx - 1.0 && s.x < hx + 0.15) {
            s.cleared.add(hx);
            if (s.jumpWindow > 0 || (Number.isFinite(p.motion.jump) && p.motion.jump > 0.2)) {
              this.fx.ring({ x: hx, y: 0.9, z: s.laneZ }, p.color, 1.4, 0.4);
            } else {
              s.stumble = 1.1;
              s.speed *= 0.42;
              this.ctx.audio.play('stumble');
              this.ctx.engine.shake(0.16, 0.3);
              this.fx.burst({ x: hx, y: 0.4, z: s.laneZ }, '#fbbf24', 18, { speed: 3, life: 0.6 });
              this.message = 'STUMBLE!';
              this.messageSub = `${p.name} clipped a hurdle`;
            }
          }
        }
      }

      const jumpY = this.hurdleXs ? clamp(Number.isFinite(p.motion.jump) ? p.motion.jump : 0, 0, 1) * 0.55 : 0;
      this.place(p, s.x, s.laneZ, { y: jumpY, facing: 0 });
      if (!frozen && s.speed > 2.5) {
        const t = (this.dustTimers.get(p.key) || 0) - dt;
        if (t <= 0) {
          this.dustTimers.set(p.key, 0.13);
          this.fx.burst({ x: s.x - 0.3, y: 0.08, z: s.laneZ }, p.color, 2, { speed: 0.9, life: 0.4, gravity: -1.5 });
        } else this.dustTimers.set(p.key, t);
      }
    }
  }

  endHeat() {
    if (this.phase !== 'race') return;
    this.phase = 'results';
    this.phaseTimer = 6;
    const order = [...this.players]
      .map((p) => ({ p, s: this.states.get(p.key) }))
      .sort((a, b) => {
        if (a.s.finished && b.s.finished) return a.s.time - b.s.time;
        if (a.s.finished) return -1;
        if (b.s.finished) return 1;
        return b.s.x - a.s.x;
      });
    const pts = [5, 3, 2, 1];
    order.forEach((o, i) => {
      o.s.rank = i + 1;
      const gained = o.s.finished ? pts[i] || 1 : 0;
      this.points.set(o.p.key, (this.points.get(o.p.key) || 0) + gained);
      o.gained = gained;
    });
    this.results = order.map((o) => ({
      id: o.p.key,
      name: o.p.name,
      color: o.p.color,
      time: o.s.time,
      rank: o.s.rank,
      gained: o.gained,
      total: this.points.get(o.p.key) || 0,
    }));
    this.message = `HEAT ${this.heat} COMPLETE`;
    this.messageSub = this.heat < this.heats ? 'Next heat coming up' : 'Final standings';
    this.ctx.audio.play('bell');
    this.fx.confetti({ x: this.distance, y: 3, z: 0 }, 100);
  }

  updateCamera() {
    let lead = 0;
    let any = false;
    for (const s of this.states.values()) {
      if (!s.finished) {
        lead = Math.max(lead, s.x);
        any = true;
      }
    }
    if (!any) lead = this.distance;
    const camX = clamp(lead + 5.2, 4, this.distance + 12);
    // A 3/4 front view instead of a near head-on view: the extra x offset makes
    // the z-separated lanes spread across the screen so runners no longer stack
    // on top of each other.
    this.setCamera([camX + 7.5, 4.4, 13.5], [camX - 0.8, 1.05, 0]);
  }

  getHud() {
    const list = this.players.map((p) => {
      const s = this.states.get(p.key) || { x: 0, speed: 0, time: null, rank: null };
      const pts = this.points.get(p.key) || 0;
      return {
        id: p.key,
        name: p.name,
        color: p.color,
        value: clamp(s.x, 0, this.distance),
        max: this.distance,
        label: 'm',
        detail:
          s.finished && s.time != null
            ? `${s.time.toFixed(2)}s`
            : `${(Number.isFinite(s.speed) ? s.speed * 3.6 : 0).toFixed(0)} km/h · ${(Number(p.motion.cadence) || 0).toFixed(1)} sps`,
        rank: s.rank,
        points: pts,
        active: true,
      };
    });
    const timer = this.phase === 'race' ? this.raceTime : null;
    return {
      title: this.title,
      subtitle: this.heats > 1 ? `Heat ${this.heat} of ${this.heats}` : this.subtitle,
      phase: this.phase,
      timer,
      message: this.message,
      messageSub: this.messageSub,
      big:
        this.phase === 'intro'
          ? { text: this.phaseTimer > 1 ? `${Math.max(1, Math.ceil(this.phaseTimer - 1))}` : 'GO!', sub: `HEAT ${this.heat}` }
          : null,
      players: list,
      results: this.results,
      queue: [],
    };
  }
}
