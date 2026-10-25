/**
 * Balling: hold the ball, swivel to aim, push to break the rack.
 *
 * The active player's hands control a white cue ball. Hand position sets the
 * aim, a forward push sets power, and wrist depth / torso twist adds curve. The
 * table is a real 2D physics sim: friction, cushions, pockets and elastic
 * ball-to-ball collisions. Each player gets three shots; the rack resets for
 * every shot so every player gets the same starting conditions.
 */
import * as THREE from '/vendor/three/three.module.js';
import { BaseGame } from './base.js';
import { buildBallingHall } from '../engine/environments.js';
import { clamp, damp } from '../shared/math.js';
import { PoolSim } from '../sim/pool.js';

const BALL_R = 0.14;
const SHOTS_PER_PLAYER = 3;
const CUE_START = { x: 0, z: 3.7 };
const RACK_APEX = -2.0;
const RACK_GAP = 0.292;
const MAX_SHOT_TIME = 12;
const BALL_COLORS = [
  0xfbbf24, 0x22d3ee, 0xf472b6, 0xa78bfa, 0x34d399,
  0xf87171, 0xfb923c, 0x60a5fa, 0xfacc15, 0x94a3b8,
];

const clampNum = (v, lo, hi, fallback = 0) => clamp(Number.isFinite(Number(v)) ? Number(v) : fallback, lo, hi);

export class BallingGame extends BaseGame {
  constructor(ctx, options = {}) {
    super(ctx, options);
    this.id = 'balling';
    this.title = 'BALLING';
    this.subtitle = 'Hold · swivel · push';
    this.phase = 'waiting';
    this.activeIndex = 0;
    this.scores = new Map();
    this.shots = new Map();
    this.results = [];
    this.matchWinner = null;
    this.aim = 0;
    this.curve = 0;
    this.power = 0.35;
    this.turnTime = 0;
    this.phaseTimer = 0;
    this.rollingTime = 0;
    this.settleTimer = 0;
    this.shotHits = 0;
    this.shotPockets = 0;
    this.shotPoints = 0;
    this.scratch = false;
    this.cueRespawnAt = 0;
    this.lastPushAt = 0;
    this.cueBall = null;
    this.rackBalls = [];
    this.aimDots = [];
    this.aimGhost = null;
    this.activeRing = null;
    this.rackLayout = [];
  }

  buildWorld() {
    this.env = buildBallingHall();
    const scene = this.env.scene;
    this.table = this.env.table;

    // Decoupled continuous-collision pool physics engine
    this.sim = new PoolSim({
      tableWidth: this.table.width,
      tableLength: this.table.length,
      ballRadius: BALL_R,
      pockets: this.table.pockets,
      onBallHit: (a, b, impact) => {
        const cueHit = a.cue || b.cue;
        if (cueHit) {
          const colored = a.cue ? b.userBall : a.userBall;
          this.#onCueHit(colored, impact);
        } else if (impact > 1.2) {
          this.ctx.audio.play('ballHit', { power: Math.min(1, impact / 12) });
        }
        if (impact > 4) {
          this.fx.burst({ x: b.x, y: this.table.y + BALL_R, z: b.z }, '#e2e8f0', 5, {
            speed: 1.6,
            life: 0.25,
            gravity: -4,
          });
        }
      },
      onCushionHit: (b, impact) => {
        if (impact > 1.2) {
          this.ctx.audio.play('ballHit', { power: Math.min(1, impact / 12) });
        }
      },
      onPocket: (b) => {
        this.#pocket(b.userBall);
      },
    });

    // Triangle rack (10 balls: 1 + 2 + 3 + 4).
    let idx = 0;
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i <= row; i++) {
        this.rackLayout.push({
          x: (i - row / 2) * RACK_GAP,
          z: RACK_APEX - row * RACK_GAP * 0.88,
          color: BALL_COLORS[idx % BALL_COLORS.length],
        });
        idx++;
      }
    }

    this.cueBall = this.#makeBall(0xffffff, { cue: true });
    this.rackBalls = this.rackLayout.map((r) => this.#makeBall(r.color));
    this.#resetRack();

    // Aim guide: a dotted line that bends with the chosen curve.
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 14; i++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), dotMat.clone());
      dot.visible = false;
      scene.add(dot);
      this.aimDots.push(dot);
    }
    this.aimGhost = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.24, 28),
      new THREE.MeshBasicMaterial({
        color: 0x67e8f9,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.aimGhost.rotation.x = -Math.PI / 2;
    this.aimGhost.visible = false;
    scene.add(this.aimGhost);

    this.cueGlow = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R * 1.7, 14, 10),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.cueGlow.visible = false;
    scene.add(this.cueGlow);

    this.activeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.53, 36),
      new THREE.MeshBasicMaterial({
        color: 0x34d399,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.activeRing.rotation.x = -Math.PI / 2;
    this.activeRing.position.y = 0.025;
    scene.add(this.activeRing);
  }

  #makeBall(color, { cue = false } = {}) {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: cue ? 0.16 : 0.28,
      metalness: cue ? 0.05 : 0.12,
      emissive: color,
      emissiveIntensity: cue ? 0.42 : 0.07,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 18, 14), mat);
    mesh.castShadow = true;
    this.env.scene.add(mesh);
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(BALL_R * 0.95, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = this.table.y + 0.006;
    this.env.scene.add(shadow);

    const simBall = {
      id: cue ? 'cue' : `ball_${color}`,
      cue,
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      spin: 0,
      spinTime: 0,
      pocketed: false,
    };
    this.sim.addBall(simBall);

    const userBall = {
      cue,
      color,
      mesh,
      shadow,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      spin: 0,
      spinTime: 0,
      pocketed: false,
      hitThisShot: false,
      sim: simBall,
    };
    simBall.userBall = userBall;
    return userBall;
  }

  #resetRack() {
    this.cueBall.sim.x = CUE_START.x;
    this.cueBall.sim.z = CUE_START.z;
    this.cueBall.sim.vx = 0;
    this.cueBall.sim.vz = 0;
    this.cueBall.sim.spin = 0;
    this.cueBall.sim.spinTime = 0;
    this.cueBall.sim.pocketed = false;

    this.cueBall.pos.set(CUE_START.x, this.table.y + BALL_R, CUE_START.z);
    this.cueBall.vel.set(0, 0, 0);
    this.cueBall.spin = 0;
    this.cueBall.spinTime = 0;
    this.cueBall.pocketed = false;
    this.cueBall.hitThisShot = false;
    this.cueBall.mesh.visible = true;
    this.#syncBall(this.cueBall);

    this.rackBalls.forEach((b, i) => {
      const r = this.rackLayout[i];
      b.sim.x = r.x;
      b.sim.z = r.z;
      b.sim.vx = 0;
      b.sim.vz = 0;
      b.sim.spin = 0;
      b.sim.spinTime = 0;
      b.sim.pocketed = false;

      b.pos.set(r.x, this.table.y + BALL_R, r.z);
      b.vel.set(0, 0, 0);
      b.spin = 0;
      b.spinTime = 0;
      b.pocketed = false;
      b.hitThisShot = false;
      b.mesh.visible = true;
      this.#syncBall(b);
    });
  }

  #syncBall(b) {
    b.mesh.position.copy(b.pos);
    b.mesh.visible = !b.pocketed;
    b.shadow.position.set(b.pos.x, this.table.y + 0.006, b.pos.z);
    b.shadow.visible = !b.pocketed;
  }

  start() {
    if (!this.players.length) {
      this.phase = 'waiting';
      this.message = 'WAVE TO JOIN';
      this.messageSub = 'Wave at the camera to take a shot';
      return;
    }
    for (const p of this.players) {
      this.scores.set(p.key, 0);
      this.shots.set(p.key, 0);
      p.avatar.setProp('none');
      p.avatar.setVisible(true);
      p.avatar.seated = false;
      p.avatar.followStage = false;
    }
    this.activeIndex = 0;
    this.results = [];
    this.matchWinner = null;
    this.#beginTurn();
  }

  addPlayer(p) {
    super.addPlayer(p);
    if (!this.scores.has(p.key)) this.scores.set(p.key, 0);
    if (!this.shots.has(p.key)) this.shots.set(p.key, 0);
    p.avatar.setProp('none');
    p.avatar.setVisible(true);
    p.avatar.seated = false;
    p.avatar.followStage = false;
    if (this.phase === 'waiting' && this.players.length) this.start();
  }

  #shotsLeft(p) {
    return Math.max(0, SHOTS_PER_PLAYER - (this.shots.get(p.key) || 0));
  }

  #nextEligible(start) {
    for (let n = 0; n < this.players.length; n++) {
      const idx = (start + n) % this.players.length;
      if (this.#shotsLeft(this.players[idx]) > 0) return idx;
    }
    return -1;
  }

  #beginTurn() {
    if (!this.players.length) {
      this.phase = 'waiting';
      return;
    }
    const next = this.#nextEligible(this.activeIndex);
    if (next < 0) {
      this.#endMatch();
      return;
    }
    this.activeIndex = next;
    // Throw away pushes that happened while the previous shot was rolling or
    // while the results card was up, otherwise a stale push can auto-fire as
    // soon as the next turn becomes active.
    for (const player of this.players) this.drain(player);
    this.#resetRack();
    this.phase = 'aim';
    this.aim = 0;
    this.curve = 0;
    this.power = 0.35;
    this.turnTime = 0;
    this.phaseTimer = 0;
    this.rollingTime = 0;
    this.settleTimer = 0;
    this.shotHits = 0;
    this.shotPockets = 0;
    this.shotPoints = 0;
    this.scratch = false;
    this.cueRespawnAt = 0;
    const p = this.players[this.activeIndex];
    this.message = `${p.name.toUpperCase()}'S TURN`;
    this.messageSub = 'Hold the ball · swivel to aim · push to shoot';
    this.ctx.audio.play('cue');
    this.#placeAvatars();
  }

  #placeAvatars() {
    if (!this.players.length) return;
    const active = this.players[this.activeIndex];
    const others = this.players.filter((p) => p !== active);
    // Stand the players around the near end instead of directly behind the
    // table. The near-side centre spot is hidden by the bottom HUD cards on a
    // 16:9 TV, so the active shooter uses the near-left slot and the others
    // take the near-right / far-side slots.
    const slots = [
      { x: -2.0, z: 5.75 },
      { x: 2.0, z: 5.75 },
      { x: -3.55, z: 1.4 },
      { x: 3.55, z: 1.4 },
    ];
    others.forEach((p, i) => {
      const slot = slots[(i + 1) % slots.length];
      this.place(p, slot.x, slot.z, { y: 0, facing: 0 });
      p.avatar.setVisible(true);
      p.avatar.setProp('none');
      p.avatar.seated = false;
      p.avatar.followStage = false;
    });
    if (active) {
      const slot = slots[0];
      this.place(active, slot.x, slot.z, { y: 0, facing: Math.PI });
      active.avatar.setVisible(true);
      active.avatar.seated = false;
      active.avatar.followStage = false;
      active.avatar.setProp(this.phase === 'aim' ? 'ball' : 'none');
      this.activeRing.position.set(slot.x, 0.025, slot.z);
      this.activeRing.visible = true;
    }
  }

  update(dt) {
    this.time += dt;
    this.env.update?.(dt, this.time);
    this.turnTime += dt;

    // Only an aim-phase push should launch. Drain and ignore events while the
    // balls are rolling or the results screen is visible.
    if (this.phase !== 'aim') {
      for (const player of this.players) this.drain(player);
    }

    if (this.phase === 'waiting') {
      if (this.players.length) this.start();
      this.#placeAvatars();
      this.updateCamera();
      return;
    }

    this.#placeAvatars();

    if (this.phase === 'aim') {
      this.#updateAim(dt);
      this.#drainShots();
      this.#updateAimVisuals();
    } else if (this.phase === 'rolling') {
      this.rollingTime += dt;
      this.#stepPhysics(dt);
      this.#updateAimVisuals();
      this.#checkSettled(dt);
    } else if (this.phase === 'results') {
      this.phaseTimer -= dt;
      this.#updateAimVisuals();
      if (this.phaseTimer <= 0) {
        this.activeIndex = (this.activeIndex + 1) % this.players.length;
        this.#beginTurn();
      }
    } else if (this.phase === 'matchEnd') {
      this.phaseTimer -= dt;
      this.#updateAimVisuals();
      if (this.phaseTimer <= 0) this.start();
    }

    this.updateCamera();
  }

  #activePlayer() {
    return this.players[this.activeIndex] || null;
  }

  #updateAim(dt) {
    const p = this.#activePlayer();
    if (!p || !p.motion) return;
    const s = p.motion.state || {};
    const hL = s.handL || { x: 0, y: 0, z: 0 };
    const hR = s.handR || { x: 0, y: 0, z: 0 };
    const handsX = (hL.x + hR.x) * 0.5;
    const aimTarget = clamp(
      handsX * 0.55 + (s.torsoTwist || 0) * 0.25 + (s.lean || 0) * 0.15,
      -0.72,
      0.72
    );
    const curveTarget = clamp((hR.z - hL.z) * 1.15 + (s.torsoTwist || 0) * 0.55, -1, 1);
    this.aim = damp(this.aim, aimTarget, 7, dt);
    this.curve = damp(this.curve, curveTarget, 5, dt);
    const powerTarget = clamp(0.22 + (s.handSpeed || 0) / 14, 0.18, 1);
    this.power = damp(this.power, powerTarget, 8, dt);
  }

  #drainShots() {
    const p = this.#activePlayer();
    if (!p) return;
    for (const other of this.players) {
      const events = this.drain(other);
      if (other !== p) continue;
      for (const e of events) {
        if (e.type === 'push') {
          this.#launch(e);
          return;
        }
        // A fast forward punch also counts as a push in this game.
        if (e.type === 'punch' && (e.power || 0) > 0.55 && this.time - this.lastPushAt > 0.45) {
          this.lastPushAt = this.time;
          this.#launch({
            power: e.power,
            aim: this.aim,
            curve: this.curve,
            quality: e.quality,
          });
          return;
        }
      }
    }
  }

  #launch(ev) {
    if (this.phase !== 'aim') return;
    const p = this.#activePlayer();
    if (!p) return;
    const power = clampNum(ev.power, 0.25, 1.0, this.power);
    // Use the same smoothed aim/curve shown by the on-table guide.
    const aim = clampNum(this.aim, -0.8, 0.8, 0);
    const curve = clampNum(this.curve, -1, 1, 0);
    const speed = 7 + power * 11;

    this.cueBall.sim.vx = Math.sin(aim) * speed;
    this.cueBall.sim.vz = -Math.cos(aim) * speed;
    this.cueBall.sim.spin = curve;
    this.cueBall.sim.spinTime = 1.15;
    this.cueBall.vel.set(this.cueBall.sim.vx, 0, this.cueBall.sim.vz);
    this.cueBall.spin = curve;
    this.cueBall.spinTime = 1.15;
    this.cueBall.hitThisShot = false;

    this.phase = 'rolling';
    this.rollingTime = 0;
    this.settleTimer = 0;
    this.shotHits = 0;
    this.shotPockets = 0;
    this.shotPoints = 0;
    this.scratch = false;
    this.lastPushAt = this.time;
    p.avatar.setProp('none');
    this.message = 'BREAK!';
    this.messageSub = `${Math.min(100, Math.round(power * 100))}% power · ${
      curve < -0.12 ? 'LEFT CURVE' : curve > 0.12 ? 'RIGHT CURVE' : 'STRAIGHT'
    }`;
    this.ctx.audio.play('cue');
    this.ctx.engine.shake(0.08 + power * 0.08, 0.16);
    this.fx.ring({ x: this.cueBall.pos.x, y: this.cueBall.pos.y, z: this.cueBall.pos.z }, '#f8fafc', 1.3, 0.4);
    this.#updateAimVisuals();
  }

  #stepPhysics(dt) {
    this.sim.step(dt);

    const _rotAxis = new THREE.Vector3();
    const _rotQuat = new THREE.Quaternion();
    const all = [this.cueBall, ...this.rackBalls];

    for (const b of all) {
      b.pos.x = b.sim.x;
      b.pos.z = b.sim.z;
      b.vel.x = b.sim.vx;
      b.vel.z = b.sim.vz;
      b.pocketed = b.sim.pocketed;

      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (sp > 0.02 && !b.pocketed) {
        const rotDist = sp * dt;
        const rotAngle = rotDist / BALL_R;
        _rotAxis.set(b.vel.z, 0, -b.vel.x).normalize();
        _rotQuat.setFromAxisAngle(_rotAxis, rotAngle);
        b.mesh.quaternion.premultiply(_rotQuat);
      }
      this.#syncBall(b);
    }
  }

  #onCueHit(ball, impact) {
    if (ball.pocketed) return;
    const power = clamp(impact / 14, 0.15, 1.2);
    this.ctx.audio.play('ballHit', { power });
    if (ball.hitThisShot) return;
    ball.hitThisShot = true;
    this.shotHits++;
    const points = 15 + Math.round(clamp(impact, 0, 14) * 1.5) + Math.max(0, this.shotHits - 1) * 5;
    this.shotPoints += points;
    const p = this.#activePlayer();
    if (p) this.scores.set(p.key, (this.scores.get(p.key) || 0) + points);
    this.message = this.shotHits >= 2 ? `CHAIN x${this.shotHits}! +${points}` : `NICE HIT! +${points}`;
    this.messageSub = `${this.shotHits} ball${this.shotHits === 1 ? '' : 's'} hit this shot`;
    this.fx.burst({ x: ball.pos.x, y: this.table.y + BALL_R, z: ball.pos.z }, `#${ball.color.toString(16).padStart(6, '0')}`, 12, {
      speed: 2.4,
      life: 0.35,
      gravity: -5,
    });
    this.ctx.engine.shake(0.04 + power * 0.05, 0.12);
  }

  #pocket(b) {
    if (b.pocketed) return;
    b.pocketed = true;
    b.sim.pocketed = true;
    b.vel.set(0, 0, 0);
    b.sim.vx = 0;
    b.sim.vz = 0;
    b.mesh.visible = false;
    b.shadow.visible = false;
    const p = this.#activePlayer();
    if (b.cue) {
      this.scratch = true;
      this.cueRespawnAt = this.time + 0.8;
      this.shotPoints -= 25;
      if (p) this.scores.set(p.key, (this.scores.get(p.key) || 0) - 25);
      this.message = 'SCRATCH! -25';
      this.messageSub = 'The white ball comes back';
      this.ctx.audio.play('pocket');
      this.ctx.engine.shake(0.12, 0.2);
      return;
    }
    this.shotPockets++;
    const points = 80;
    this.shotPoints += points;
    if (p) this.scores.set(p.key, (this.scores.get(p.key) || 0) + points);
    this.message = `POCKET! +${points}`;
    this.messageSub = `${this.shotPockets} pocketed this shot`;
    this.ctx.audio.play('pocket');
    this.fx.ring({ x: b.pos.x, y: this.table.y + 0.05, z: b.pos.z }, '#34d399', 1.8, 0.5);
    this.fx.confetti({ x: b.pos.x, y: this.table.y + 0.6, z: b.pos.z }, 26);
  }

  #checkSettled(dt) {
    if (this.cueBall.pocketed && this.time >= this.cueRespawnAt) {
      this.cueBall.pocketed = false;
      this.cueBall.sim.pocketed = false;
      this.cueBall.sim.x = CUE_START.x;
      this.cueBall.sim.z = CUE_START.z;
      this.cueBall.sim.vx = 0;
      this.cueBall.sim.vz = 0;
      this.cueBall.sim.spin = 0;
      this.cueBall.sim.spinTime = 0;
      this.cueBall.pos.set(CUE_START.x, this.table.y + BALL_R, CUE_START.z);
      this.cueBall.vel.set(0, 0, 0);
      this.cueBall.spin = 0;
      this.cueBall.spinTime = 0;
      this.cueBall.mesh.visible = true;
      this.#syncBall(this.cueBall);
    }
    const moving =
      !this.cueBall.pocketed &&
      Math.hypot(this.cueBall.vel.x, this.cueBall.vel.z) > 0.06;
    const rackMoving = this.rackBalls.some(
      (b) => !b.pocketed && Math.hypot(b.vel.x, b.vel.z) > 0.06
    );
    if (!moving && !rackMoving) {
      this.settleTimer += dt;
      if (this.settleTimer > 0.55) this.#endShot();
    } else {
      this.settleTimer = 0;
    }
    if (this.rollingTime > MAX_SHOT_TIME) this.#endShot();
  }

  #endShot() {
    if (this.phase !== 'rolling') return;
    this.phase = 'results';
    this.phaseTimer = 2.6;
    const p = this.#activePlayer();
    if (p) {
      const shots = (this.shots.get(p.key) || 0) + 1;
      this.shots.set(p.key, shots);
      let bonus = 0;
      if (this.shotHits >= 4) bonus += 35;
      if (this.shotPockets >= 2) bonus += 60;
      if (bonus) {
        this.shotPoints += bonus;
        this.scores.set(p.key, (this.scores.get(p.key) || 0) + bonus);
      }
      this.message = 'SHOT COMPLETE';
      const netLabel = this.shotPoints >= 0 ? `+${this.shotPoints}` : `${this.shotPoints}`;
      this.messageSub = `${this.shotHits} hit${this.shotHits === 1 ? '' : 's'} · ${this.shotPockets} pocket${
        this.shotPockets === 1 ? '' : 's'
      } · ${netLabel} pts${this.scratch ? ' · SCRATCH' : ''}${bonus ? ` (+${bonus} bonus)` : ''}`;
      this.ctx.audio.play('bell');
    }
    this.#updateAimVisuals();
  }

  #endMatch() {
    this.phase = 'matchEnd';
    this.phaseTimer = 10;
    this.results = this.players
      .map((p) => ({
        name: p.name,
        color: p.color,
        detail: `${this.scores.get(p.key) || 0} pts · ${this.shots.get(p.key) || 0} shots`,
        gained: this.scores.get(p.key) || 0,
      }))
      .sort((a, b) => b.gained - a.gained)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    this.matchWinner = this.results[0] || null;
    this.message = this.matchWinner ? `${this.matchWinner.name.toUpperCase()} WINS!` : 'MATCH COMPLETE';
    this.messageSub = 'New match starting soon';
    this.ctx.audio.play('cheer');
    this.fx.confetti({ x: 0, y: 1.8, z: 0 }, 120);
  }

  #updateAimVisuals() {
    const show = this.phase === 'aim' && !this.cueBall.pocketed;
    this.cueGlow.visible = show;
    if (show) {
      this.cueGlow.position.copy(this.cueBall.pos);
    }
    if (!show) {
      for (const d of this.aimDots) d.visible = false;
      this.aimGhost.visible = false;
      this.activeRing.visible = this.phase === 'aim';
      return;
    }
    const dirX = Math.sin(this.aim);
    const dirZ = -Math.cos(this.aim);
    const perpX = Math.cos(this.aim);
    const perpZ = Math.sin(this.aim);
    const baseX = this.cueBall.pos.x;
    const baseZ = this.cueBall.pos.z;
    for (let i = 0; i < this.aimDots.length; i++) {
      const t = (i + 1) / this.aimDots.length;
      const dist = 0.32 + t * 4.4;
      const bend = this.curve * t * t * 0.85;
      const dot = this.aimDots[i];
      dot.position.set(
        baseX + dirX * dist + perpX * bend,
        this.table.y + 0.045,
        baseZ + dirZ * dist + perpZ * bend
      );
      dot.visible = true;
      dot.material.opacity = 0.62 - t * 0.35;
      dot.material.color.setHSL(0.52 - Math.abs(this.curve) * 0.12, 0.9, 0.65);
    }
    const aimInfo = this.sim.findAimTarget(baseX, baseZ, dirX, dirZ, 6.0);
    const ghostDist = aimInfo.hit ? aimInfo.dist : 4.9;
    const ghostBend = this.curve * (ghostDist / 4.9) * 0.85;
    this.aimGhost.position.set(
      baseX + dirX * ghostDist + perpX * ghostBend,
      this.table.y + 0.04,
      baseZ + dirZ * ghostDist + perpZ * ghostBend
    );
    this.aimGhost.visible = true;
    this.aimGhost.material.opacity = 0.5 + this.power * 0.35;
    if (aimInfo.hit) {
      this.aimGhost.material.color.setHex(0x34d399); // green target lock on object ball
    } else {
      this.aimGhost.material.color.setHex(0x67e8f9); // cyan search trajectory
    }
    this.activeRing.visible = true;
  }

  updateCamera() {
    super.updateCamera();
  }

  getHud() {
    const active = this.#activePlayer();
    const list = this.players
      .map((p) => {
        const score = this.scores.get(p.key) || 0;
        const left = this.#shotsLeft(p);
        const aiming = p === active && (this.phase === 'aim' || this.phase === 'rolling');
        return {
          id: p.key,
          name: p.name,
          color: p.color,
          value: score,
          max: 0,
          label: '',
          points: score,
          detail: `${left} shot${left === 1 ? '' : 's'} left${aiming ? ' · AIMING' : ''}`,
          active: p === active,
        };
      })
      .sort((a, b) => b.points - a.points)
      .map((x, i) => ({ ...x, rank: i + 1 }));

    const activeScore = active ? this.scores.get(active.key) || 0 : 0;
    const left = active ? this.#shotsLeft(active) : 0;
    const curveLabel = this.curve < -0.12 ? 'LEFT' : this.curve > 0.12 ? 'RIGHT' : 'STRAIGHT';
    const aimPart =
      this.phase === 'aim' || this.phase === 'rolling'
        ? ` · ${Math.round((this.aim * 180) / Math.PI)}° ${curveLabel}`
        : '';
    const scoreLine =
      active && this.phase !== 'matchEnd'
        ? `SCORE ${activeScore} · ${left} SHOT${left === 1 ? '' : 'S'}${aimPart}`
        : '';

    const queue = this.players
      .filter((p) => p !== active && this.#shotsLeft(p) > 0)
      .map((p) => ({ id: p.key, name: p.name, color: p.color }));

    return {
      title: this.title,
      subtitle: 'Hold the ball · swivel to aim · push to shoot',
      phase: this.phase,
      timer: this.phase === 'rolling' ? Math.max(0, MAX_SHOT_TIME - this.rollingTime) : null,
      score: scoreLine,
      message: this.message,
      messageSub: this.messageSub,
      big: null,
      players: list,
      results: this.phase === 'matchEnd' ? this.results : [],
      queue,
    };
  }

  dispose() {
    for (const b of [this.cueBall, ...this.rackBalls]) {
      b?.mesh?.removeFromParent();
      b?.shadow?.removeFromParent();
    }
    for (const d of this.aimDots) d.removeFromParent();
    this.aimGhost?.removeFromParent();
    this.cueGlow?.removeFromParent();
    this.activeRing?.removeFromParent();
    super.dispose();
  }
}
