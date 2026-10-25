/** Tennis: swing at the ball, aim with your lean, first to 7 points. */
import * as THREE from '/vendor/three/three.module.js';
import { BaseGame } from './base.js';
import { buildCourt } from '../engine/environments.js';
import { Avatar } from '../engine/avatar.js';
import { clamp, damp, rand } from '../shared/math.js';

const G = 9.8;
const MAX_SCORE = 7;

export class TennisGame extends BaseGame {
  constructor(ctx, options = {}) {
    super(ctx, options);
    this.id = 'tennis';
    this.title = 'TENNIS';
    this.subtitle = 'Swing to return, lean to aim';
    this.score = [0, 0];
    this.server = 0;
    this.rally = 0;
    this.phase = 'waiting';
    this.phaseTimer = 0;
    this.sides = [null, null];
    this.bot = null;
    this.botAvatar = null;
    this.botZ = 0;
    this.aiCooldown = 0;
    this.hitCooldown = [0, 0];
    this.ball = null;
    this.matchWinner = null;
  }

  buildWorld() {
    this.env = buildCourt();
    const scene = this.env.scene;
    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xd9f99d, emissive: 0x84cc16, emissiveIntensity: 0.9, roughness: 0.4 })
    );
    this.ballMesh.castShadow = true;
    scene.add(this.ballMesh);
    this.ballGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xd9f99d, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    scene.add(this.ballGlow);
    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.22, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    scene.add(this.ballShadow);
    this.ball = {
      pos: new THREE.Vector3(0, 1.4, 0),
      vel: new THREE.Vector3(),
      bounces: 0,
      hitter: 0,
      lastHitAt: 0,
    };
  }

  start() {
    if (!this.players.length) {
      this.phase = 'waiting';
      this.message = 'WAVE TO JOIN';
      this.messageSub = 'Tennis needs one or two players';
      return;
    }
    this.sides = [this.players[0], this.players[1] || null];
    // Tennis is a 1v1 game: anyone beyond the first two stays on the bench.
    for (const p of this.players) p.avatar.setVisible(this.sides.includes(p));
    this.score = [0, 0];
    this.server = 0;
    this.matchWinner = null;
    if (!this.sides[1]) {
      this.botAvatar = new Avatar({ name: 'BOT', color: '#94a3b8', id: 'bot' });
      this.botAvatar.setProp('racket');
      this.botAvatar.setOnline(true);
      this.env.scene.add(this.botAvatar.group);
      this.bot = true;
    }
    this.sides.forEach((p, i) => {
      if (!p) return;
      p.avatar.setProp('racket');
      p.avatar.seated = false;
      p.avatar.followStage = false;
      p.avatar.setVisible(true);
      this.place(p, i === 0 ? -8.2 : 8.2, 0, { facing: i === 0 ? Math.PI / 2 : -Math.PI / 2 });
    });
    this.beginPoint(true);
  }

  addPlayer(p) {
    super.addPlayer(p);
    if (this.sides[0] && p !== this.sides[0] && p !== this.sides[1]) p.avatar.setVisible(false);
    if (this.phase === 'waiting' && this.players.length) this.start();
  }

  beginPoint(initial = false) {
    this.phase = 'serve';
    this.phaseTimer = initial ? 2.2 : 1.8;
    this.rally = 0;
    this.ball.bounces = 0;
    this.ball.hitter = this.server;
    this.ball.vel.set(0, 0, 0);
    const p = this.sides[this.server];
    const z = p ? p.courtZ || 0 : 0;
    this.ball.pos.set(this.server === 0 ? -7.4 : 7.4, 1.45, z);
    this.message = 'SERVE';
    this.messageSub = p ? p.name : '';
    this.updateBallMesh();
  }

  serve() {
    const targetSide = 1 - this.server;
    const targetX = targetSide === 0 ? -5.6 : 5.6;
    const targetZ = rand(-2.6, 2.6);
    const speed = 13.5;
    const dx = targetX - this.ball.pos.x;
    const t = Math.abs(dx) / speed;
    const vx = dx / t;
    const vz = (targetZ - this.ball.pos.z) / t;
    let vy = (0.35 - this.ball.pos.y + 0.5 * G * t * t) / t;
    const tNet = Math.abs(this.ball.pos.x / vx);
    const yNet = this.ball.pos.y + vy * tNet - 0.5 * G * tNet * tNet;
    if (yNet < 1.25) vy += (1.25 - yNet) / tNet + 0.4;
    this.ball.vel.set(vx, vy, vz);
    this.ball.hitter = this.server;
    this.ball.bounces = 0;
    this.phase = 'rally';
    this.message = '';
    this.messageSub = '';
    this.ctx.audio.play('hit');
  }

  update(dt) {
    this.time += dt;
    this.phaseTimer -= dt;
    if (this.phase === 'waiting') {
      if (this.players.length) this.start();
      this.updateCamera();
      return;
    }

    // players follow the ball laterally with their real-world lean / position
    for (let side = 0; side < 2; side++) {
      const p = this.sides[side];
      if (!p) continue;
      const targetZ = clamp((p.stage?.x || 0) * 0.75, -4.2, 4.2);
      p.courtZ = damp(p.courtZ ?? 0, targetZ, 5, dt);
      this.place(p, side === 0 ? -8.2 : 8.2, p.courtZ, { facing: side === 0 ? Math.PI / 2 : -Math.PI / 2 });
      const events = this.drain(p);
      if (this.phase === 'rally') {
        for (const e of events) {
          if (e.type === 'swing' || e.type === 'punch') {
            if (this.canHit(side, p)) {
              this.hit(side, e.power, p.motion.lean);
              break;
            }
          }
        }
      }
    }

    if (this.botAvatar) {
      const targetZ = this.phase === 'rally' && this.ball.pos.x > 0 ? clamp(this.ball.pos.z, -4.2, 4.2) : 0;
      this.botZ = damp(this.botZ, targetZ, 3.5, dt);
      this.botAvatar.followStage = false;
      this.botAvatar.group.position.set(8.2, 0, this.botZ);
      this.botAvatar.facingTarget = -Math.PI / 2;
      this.botAvatar.update(null, null, dt, { active: false });
      this.aiCooldown -= dt;
      if (this.phase === 'rally' && this.ball.pos.x > 0 && this.aiCooldown <= 0) {
        if (Math.abs(this.ball.pos.z - this.botZ) < 3.2 && this.ball.pos.y < 3.2) {
          this.aiCooldown = 1.1;
          if (Math.random() < 0.9) this.hit(1, 0.45 + Math.random() * 0.4, rand(-0.8, 0.8));
        }
      }
    }

    if (this.phase === 'serve') {
      if (this.phaseTimer <= 0) this.serve();
    } else if (this.phase === 'rally') {
      this.updateBall(dt);
    } else if (this.phase === 'point') {
      if (this.phaseTimer <= 0) {
        this.server = 1 - this.server;
        if (this.matchWinner != null) this.restartMatch();
        else this.beginPoint();
      }
    } else if (this.phase === 'matchEnd') {
      if (this.phaseTimer <= 0) this.restartMatch();
    }

    this.updateBallMesh();
    this.updateCamera();
  }

  canHit(side, p) {
    if (this.ball.hitter === side) return false;
    if (performance.now() - this.ball.lastHitAt < 250) return false;
    const onSide = side === 0 ? this.ball.pos.x < 0.3 : this.ball.pos.x > -0.3;
    if (!onSide) return false;
    if (this.ball.pos.y > 3.4) return false;
    return Math.abs(this.ball.pos.z - (p.courtZ || 0)) < 3.4;
  }

  hit(side, power = 0.7, aim = 0) {
    const targetSide = 1 - side;
    const targetX = (targetSide === 0 ? -7.6 : 7.6) + rand(-1.2, 1.2);
    const targetZ = clamp(aim * 3.8 + rand(-1.1, 1.1), -4.6, 4.6);
    const speed = 13.5 + power * 7;
    const dx = targetX - this.ball.pos.x;
    if (Math.abs(dx) < 0.5) return;
    const t = Math.abs(dx) / speed;
    const vx = dx / t;
    const vz = (targetZ - this.ball.pos.z) / t;
    let vy = (0.35 - this.ball.pos.y + 0.5 * G * t * t) / t;
    const tNet = Math.abs(this.ball.pos.x / vx);
    const yNet = this.ball.pos.y + vy * tNet - 0.5 * G * tNet * tNet;
    if (yNet < 1.25) vy += (1.25 - yNet) / tNet + 0.35;
    this.ball.vel.set(vx, vy, vz);
    this.ball.hitter = side;
    this.ball.bounces = 0;
    this.ball.lastHitAt = performance.now();
    this.phase = 'rally';
    this.rally++;
    this.ctx.audio.play('hit');
    this.fx.burst({ x: this.ball.pos.x, y: this.ball.pos.y, z: this.ball.pos.z }, '#d9f99d', 14, { speed: 3.5, life: 0.4 });
    this.fx.ring({ x: this.ball.pos.x, y: 0.05, z: this.ball.pos.z }, '#d9f99d', 1.2, 0.35);
    this.ctx.engine.shake(0.05, 0.12);
    this.message = this.rally >= 5 ? `RALLY x${this.rally}` : '';
    this.messageSub = '';
  }

  updateBall(dt) {
    const b = this.ball;
    const prevX = b.pos.x;
    b.vel.y -= G * dt;
    b.pos.addScaledVector(b.vel, dt);
    b.lastHitAt = b.lastHitAt || 0;

    // net collision
    if ((prevX < 0 && b.pos.x >= 0) || (prevX > 0 && b.pos.x <= 0)) {
      if (b.pos.y < 1.12 && b.pos.y > 0.1) {
        b.vel.x *= -0.18;
        b.vel.z *= 0.4;
        b.vel.y = Math.abs(b.vel.y) * 0.25 + 1;
        this.pointTo(1 - b.hitter, 'INTO THE NET');
        return;
      }
    }

    // ground bounce
    if (b.pos.y <= 0.15 && b.vel.y < 0) {
      b.pos.y = 0.15;
      b.vel.y = -b.vel.y * 0.68;
      b.vel.x *= 0.955;
      b.vel.z *= 0.955;
      b.bounces++;
      this.ctx.audio.play('bounce');
      this.fx.ring({ x: b.pos.x, y: 0.02, z: b.pos.z }, '#e2e8f0', 0.9, 0.3);
      if (b.bounces >= 2) {
        this.pointTo(1 - b.hitter, 'DOUBLE BOUNCE');
        return;
      }
    }

    if (Math.abs(b.pos.x) > 11.6 || Math.abs(b.pos.z) > 6.2) {
      this.pointTo(1 - b.hitter, 'OUT');
      return;
    }
    if (b.pos.y < -2) this.pointTo(1 - b.hitter, 'OUT');
  }

  pointTo(side, reason = '') {
    if (this.phase !== 'rally' && this.phase !== 'serve') return;
    this.score[side]++;
    this.phase = 'point';
    this.phaseTimer = 2.2;
    this.message = `${this.sides[side]?.name || 'BOT'} SCORES`;
    this.messageSub = reason;
    this.ctx.audio.play('cheer');
    const x = side === 0 ? -7.5 : 7.5;
    this.fx.confetti({ x, y: 1.6, z: 0 }, 35);
    if (this.score[side] >= MAX_SCORE) {
      this.matchWinner = side;
      this.phase = 'matchEnd';
      this.phaseTimer = 7;
      this.message = `${this.sides[side]?.name || 'BOT'} WINS THE MATCH!`;
      this.messageSub = `${this.score[0]} — ${this.score[1]}`;
      this.ctx.audio.play('ko');
      this.fx.confetti({ x, y: 2.5, z: 0 }, 120);
    }
  }

  restartMatch() {
    this.score = [0, 0];
    this.matchWinner = null;
    this.server = 0;
    this.beginPoint(true);
  }

  updateBallMesh() {
    const b = this.ball;
    this.ballMesh.position.copy(b.pos);
    this.ballGlow.position.copy(b.pos);
    this.ballShadow.position.set(b.pos.x, 0.02, b.pos.z);
    const s = clamp(1 - b.pos.y / 9, 0.25, 1);
    this.ballShadow.scale.setScalar(0.6 + s * 0.8);
    this.ballShadow.material.opacity = 0.1 + s * 0.3;
    this.ballMesh.rotation.x += 0.2;
    this.ballMesh.rotation.z += 0.15;
  }

  updateCamera() {
    const bx = this.ball?.pos.x || 0;
    this.setCamera([bx * 0.06, 6.4, 15.5], [0, 0.6, 0]);
  }

  getHud() {
    const players = [0, 1].map((side) => {
      const p = this.sides[side];
      const name = p ? p.name : side === 1 && this.bot ? 'BOT' : '—';
      const color = p ? p.color : '#94a3b8';
      return {
        id: p ? p.key : 'bot',
        name,
        color,
        value: this.score[side],
        max: MAX_SCORE,
        label: 'PTS',
        detail: this.server === side && this.phase !== 'matchEnd' ? 'SERVE' : '',
        active: true,
      };
    });
    return {
      title: this.title,
      subtitle: this.rally > 1 ? `Rally ${this.rally}` : 'First to 7',
      phase: this.phase,
      timer: null,
      message: this.message,
      messageSub: this.messageSub,
      big: null,
      players,
      queue: [],
      score: `${this.score[0]} — ${this.score[1]}`,
    };
  }

  dispose() {
    if (this.botAvatar) this.botAvatar.dispose();
    super.dispose();
  }
}
