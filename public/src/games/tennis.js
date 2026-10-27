/**
 * Tennis: 3D Court Arena with Spatial Hand & Racket Tracking, Serve Toss Mechanics, and Grand Slam Presentation.
 * 
 * Features:
 * - True 3D behind-the-baseline court view (Wii Sports / Grand Slam style).
 * - Real-time 3D hand and tennis racket tracking with forehand, backhand, and overhead smash animations.
 * - Spatial ball-to-racket collision detection: clean hits rebound across the net; missed balls pass for opponent points.
 * - Realistic Serve Toss Mechanic: simulate tossing ball up with one hand and whacking it with the other to start play.
 * - Hollow tennis ball string hits and court bounce audio.
 * - Traditional Tennis Scoring (Love, 15, 30, 40, Deuce, Game).
 * - Ringside Camera Flashes & Celebratory Crowd: 22 flash points burst and crowd roars on victory.
 * - Persistent Player Profile: adds points, updates stats, and increments wins in saved profile.
 * - No Auto-Looping: halts on the podium victory screen until user chooses to rematch or exit.
 */
import * as THREE from '/vendor/three/three.module.js';
import { BaseGame } from './base.js';
import { buildCourt } from '../engine/environments.js';
import { Avatar } from '../engine/avatar.js';
import { clamp, damp, rand } from '../shared/math.js';

const G = 9.81;
const WINNING_GAMES = 3; // First to 3 games wins match
const COURT_W = 11.0;
const COURT_L = 23.77;

export class TennisGame extends BaseGame {
  constructor(ctx, options = {}) {
    super(ctx, options);
    this.id = 'tennis';
    this.title = 'TENNIS';
    this.subtitle = 'Grand slam court arena';

    // Tennis Traditional Match Scoring: Games & Points
    this.games = [0, 0];      // Games won by side 0 and side 1
    this.points = [0, 0];     // Points within current game (0, 1, 2, 3...)
    this.server = 0;          // 0 = Player 1, 1 = Bot / Player 2
    this.rally = 0;
    this.aces = [0, 0];
    this.winners = [0, 0];

    this.phase = 'waiting';   // waiting | serve | rally | point | matchEnd
    this.phaseTimer = 0;
    this.sides = [null, null];
    this.bot = null;
    this.botAvatar = null;
    this.botZ = 0;
    this.aiCooldown = 0;

    // Ball & Physics
    this.ball = null;
    this.ballMesh = null;
    this.ballGlow = null;
    this.ballShadow = null;

    // Serve Toss State Machine
    this.serveStage = 'ready'; // ready | tossed | served | faulted
    this.tossTime = 0;
    this.tossPeak = false;

    // 3D Player Racket & Hand Tracking
    this.racketGroup = null;
    this.racketMesh = null;
    this.racketPos = new THREE.Vector3(-8.2, 1.2, 0);
    this.swingAnim = { active: false, timer: 0, type: 'forehand' };

    // Arena Camera Flashes
    this.cameraFlashes = [];
    this.matchWinner = null;
    this.results = [];

    this.onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space' && this.phase === 'serve') {
        if (this.serveStage === 'ready') this.#tossBall();
        else if (this.serveStage === 'tossed') this.#whackServe(1.2);
      }
    };
    window.addEventListener('keydown', this.onKey);
  }

  buildWorld() {
    this.env = buildCourt();
    this.scene = this.env.scene;
    const scene = this.scene;

    // Felt Tennis Ball with subtle optic yellow glow
    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 20, 16),
      new THREE.MeshStandardMaterial({
        color: 0xccff00, // Optic yellow
        emissive: 0x84cc16,
        emissiveIntensity: 0.45,
        roughness: 0.65,
      })
    );
    this.ballMesh.castShadow = true;
    scene.add(this.ballMesh);

    this.ballGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 12, 8),
      new THREE.MeshBasicMaterial({
        color: 0xd9f99d,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    scene.add(this.ballGlow);

    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.24, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false })
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    scene.add(this.ballShadow);

    this.ball = {
      pos: new THREE.Vector3(-8.2, 1.2, 0),
      vel: new THREE.Vector3(),
      bounces: 0,
      hitter: 0,
      lastHitAt: 0,
      lastBouncePos: null,
    };

    // Build prominent 3D Tennis Racket
    this.#build3DRacket();

    // Build 22 stadium paparazzi camera flashes
    this.cameraFlashes = this.#createCameraFlashes();
  }

  #build3DRacket() {
    this.racketGroup = new THREE.Group();

    // Racket Oval Head Rim
    const curve = new THREE.EllipseCurve(0, 0.48, 0.22, 0.30, 0, 2 * Math.PI, false, 0);
    const points = curve.getPoints(36);
    const frameGeo = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p.x, p.y, 0)));
    const frameMat = new THREE.LineBasicMaterial({ color: 0x0284c7, linewidth: 4 });
    const frame = new THREE.LineLoop(frameGeo, frameMat);
    this.racketGroup.add(frame);

    // Thick frame tube
    const tubeCurve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, p.y, 0)), true);
    const tubeGeo = new THREE.TubeGeometry(tubeCurve, 32, 0.018, 8, true);
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.5, roughness: 0.3 });
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    this.racketGroup.add(tube);

    // String Grid
    const stringMat = new THREE.LineBasicMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.65 });
    for (let i = -6; i <= 6; i++) {
      const x = i * 0.028;
      const maxY = Math.sqrt(Math.max(0, 1 - (x / 0.22) ** 2)) * 0.30;
      const vLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(x, 0.48 - maxY, 0),
          new THREE.Vector3(x, 0.48 + maxY, 0),
        ]),
        stringMat
      );
      this.racketGroup.add(vLine);
    }
    for (let j = -8; j <= 8; j++) {
      const yOff = j * 0.028;
      const maxX = Math.sqrt(Math.max(0, 1 - (yOff / 0.30) ** 2)) * 0.22;
      const hLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-maxX, 0.48 + yOff, 0),
          new THREE.Vector3(maxX, 0.48 + yOff, 0),
        ]),
        stringMat
      );
      this.racketGroup.add(hLine);
    }

    // Throat & Handle Grip
    const throatGeo = new THREE.CylinderGeometry(0.02, 0.03, 0.16, 8);
    const throatMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 });
    const throat = new THREE.Mesh(throatGeo, throatMat);
    throat.position.set(0, 0.12, 0);
    this.racketGroup.add(throat);

    const gripGeo = new THREE.CylinderGeometry(0.024, 0.026, 0.26, 8);
    const gripMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.position.set(0, -0.09, 0);
    this.racketGroup.add(grip);

    this.racketMesh = this.racketGroup;
    this.scene.add(this.racketGroup);
  }

  #createCameraFlashes() {
    const flashes = [];
    for (let i = 0; i < 22; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 26);
      const a = (i / 22) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const r = 16.0 + Math.random() * 8.0;
      const y = 3.8 + Math.random() * 5.0;
      light.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      this.scene.add(light);
      flashes.push({ light, flashTimer: 0 });
    }
    return flashes;
  }

  start() {
    if (!this.players.length) {
      this.phase = 'waiting';
      this.message = 'WAVE TO JOIN';
      this.messageSub = 'Stand in camera view to enter the court';
      return;
    }
    this.sides = [this.players[0], this.players[1] || null];
    for (const p of this.players) p.avatar.setVisible(this.sides.includes(p));

    this.games = [0, 0];
    this.points = [0, 0];
    this.server = 0;
    this.matchWinner = null;
    this.results = [];

    if (!this.sides[1]) {
      this.botAvatar = new Avatar({ name: 'ROBO-PRO', color: '#94a3b8', id: 'bot' });
      this.botAvatar.setProp('racket');
      this.botAvatar.setOnline(true);
      this.scene.add(this.botAvatar.group);
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

  addPlayer(p, mode = 'against') {
    super.addPlayer(p);
    if (mode === 'against' && (!this.sides[1] || this.bot)) {
      this.sides[1] = p;
      if (this.botAvatar) this.botAvatar.setVisible(false);
      this.bot = false;
      this.place(p, 8.2, 0, { facing: -Math.PI / 2 });
    } else if (this.sides[0] && p !== this.sides[0] && p !== this.sides[1]) {
      // Doubles / Co-op: partner joins on home baseline
      this.place(p, -8.2, 2.2, { facing: Math.PI / 2 });
    }
    p.avatar.setProp('racket', p.dominantHand || 'R');
    if (this.phase === 'waiting' && this.players.length) this.start();
  }

  beginPoint(initial = false) {
    this.phase = 'serve';
    this.serveStage = 'ready';
    this.phaseTimer = initial ? 2.5 : 1.8;
    this.rally = 0;
    this.ball.bounces = 0;
    this.ball.hitter = this.server;
    this.ball.vel.set(0, 0, 0);

    const p = this.sides[this.server];
    const serverZ = p ? p.courtZ || 0 : 0;
    const serverX = this.server === 0 ? -8.2 : 8.2;

    this.ball.pos.set(serverX + (this.server === 0 ? 0.4 : -0.4), 1.25, serverZ);

    if (this.server === 0) {
      this.message = 'YOUR SERVE';
      this.messageSub = 'Raise toss hand up · Whack overhead with racket!';
    } else {
      this.message = 'BOT SERVING';
      this.messageSub = 'Ready your return stance';
    }
    this.updateBallMesh();
  }

  #tossBall() {
    if (this.phase !== 'serve' || this.serveStage !== 'ready') return;
    this.serveStage = 'tossed';
    this.tossTime = performance.now();
    this.ball.vel.set(0, 5.2, 0); // Toss ball straight up
    this.ctx.audio.play('toss');
    this.message = 'BALL IN AIR!';
    this.messageSub = 'WHACK OVERHEAD NOW!';
  }

  #whackServe(power = 1.0) {
    if (this.phase !== 'serve' || this.serveStage !== 'tossed') return;
    this.serveStage = 'served';

    const p = this.sides[0];
    const aimLean = p?.motion?.lean || 0;
    const targetZ = clamp(aimLean * 3.4 + rand(-0.8, 0.8), -3.8, 3.8);

    const targetX = 6.4;
    const speed = 17.5 + power * 5.5; // High speed serve!
    const dx = targetX - this.ball.pos.x;
    const t = Math.abs(dx) / speed;
    const vx = dx / t;
    const vz = (targetZ - this.ball.pos.z) / t;
    let vy = (0.35 - this.ball.pos.y + 0.5 * G * t * t) / t;

    // Clear net safely
    const tNet = Math.abs(this.ball.pos.x / vx);
    const yNet = this.ball.pos.y + vy * tNet - 0.5 * G * tNet * tNet;
    if (yNet < 1.35) vy += (1.35 - yNet) / tNet + 0.45;

    this.ball.vel.set(vx, vy, vz);
    this.ball.hitter = 0;
    this.ball.bounces = 0;
    this.ball.lastHitAt = performance.now();
    this.phase = 'rally';
    this.message = power > 1.2 ? '⚡ ACE SERVE!' : 'SERVED!';
    this.messageSub = `${Math.round(speed * 3.6)} km/h`;

    this.ctx.audio.play('tennisHit', { power: 1.3 });
    this.fx.burst(this.ball.pos, '#ccff00', 16, { speed: 4.2, life: 0.4 });
    this.fx.ring(this.ball.pos, '#ccff00', 1.4, 0.35);
    this.ctx.engine.shake(0.08, 0.15);
  }

  update(dt) {
    this.time += dt;
    this.phaseTimer -= dt;

    if (this.phase === 'waiting') {
      if (this.players.length) this.start();
      this.updateCamera();
      return;
    }

    // 1. Track player 3D court position & Racket location
    const p1 = this.sides[0];
    if (p1) {
      // Map lateral room motion directly to court baseline position
      const targetZ = clamp((p1.stage?.x || 0) * 4.6, -4.6, 4.6);
      p1.courtZ = damp(p1.courtZ ?? 0, targetZ, 7.5, dt);
      this.place(p1, -8.2, p1.courtZ, { facing: Math.PI / 2 });

      this.#updatePlayerRacketAndGestures(p1, dt);
    }

    // 2. Bot AI movement & returns
    if (this.botAvatar) {
      this.#updateBot(dt);
    }

    // 3. Game state loop
    if (this.phase === 'serve') {
      this.#updateServePhase(dt);
    } else if (this.phase === 'rally') {
      this.updateBall(dt);
    } else if (this.phase === 'point') {
      if (this.phaseTimer <= 0) {
        if (this.matchWinner != null) {
          this.endMatch();
        } else {
          this.beginPoint();
        }
      }
    } else if (this.phase === 'matchEnd') {
      this.#updateCameraFlashes(dt);
    }

    this.updateBallMesh();
    this.updateCamera();
  }

  #updatePlayerRacketAndGestures(p, dt) {
    const lm = p.lm;
    const isLeft = p.dominantHand === 'L';

    // Select dominant racket arm vs non-dominant toss arm
    const wrRacket = isLeft ? (lm?.[15] || { x: 0.4, y: 0.45, z: 0 }) : (lm?.[16] || { x: 0.6, y: 0.45, z: 0 });
    const wrToss = isLeft ? (lm?.[16] || { x: 0.6, y: 0.55, z: 0 }) : (lm?.[15] || { x: 0.4, y: 0.55, z: 0 });
    const shRacket = isLeft ? (lm?.[11] || { x: 0.45, y: 0.35, z: 0 }) : (lm?.[12] || { x: 0.55, y: 0.35, z: 0 });
    const shToss = isLeft ? (lm?.[12] || { x: 0.55, y: 0.35, z: 0 }) : (lm?.[11] || { x: 0.45, y: 0.35, z: 0 });

    const mirror = this.ctx.calibration?.mirror !== false;
    const racketHandX = mirror ? 1 - wrRacket.x : wrRacket.x;

    // Track Racket position in 3D relative to player
    const armExtX = (racketHandX - (mirror ? 1 - shRacket.x : shRacket.x)) * 3.5;
    const armHeightY = (shRacket.y - wrRacket.y) * 2.8;

    this.racketPos.set(
      -8.2 + 0.6 + clamp((wrRacket.z || 0) * -1.8, -0.4, 0.8),
      clamp(1.15 + armHeightY, 0.4, 2.6),
      p.courtZ + clamp(armExtX, -1.8, 1.8)
    );

    if (this.racketMesh) {
      this.racketMesh.position.copy(this.racketPos);

      // Swing animation
      if (this.swingAnim.active) {
        this.swingAnim.timer -= dt * 6.5;
        const prog = Math.sin(this.swingAnim.timer * Math.PI);
        const sign = isLeft ? -1 : 1;
        this.racketMesh.rotation.z = prog * sign * (this.swingAnim.type === 'backhand' ? -1.6 : 1.6);
        this.racketMesh.rotation.y = prog * 0.9 * sign;
        if (this.swingAnim.timer <= 0) this.swingAnim.active = false;
      } else {
        this.racketMesh.rotation.set(0.35, Math.PI / 2, isLeft ? -0.2 : 0.2);
      }
    }

    // Serve Toss Detection
    if (this.phase === 'serve' && this.server === 0) {
      if (this.serveStage === 'ready') {
        // Toss gesture with non-dominant hand: wrist upward above shoulder
        if (wrToss.y < shToss.y - 0.08) {
          this.#tossBall();
        }
      } else if (this.serveStage === 'tossed') {
        // Ball in air: dominant hand swings overhead to whack serve!
        if (wrRacket.y < shRacket.y - 0.05 && this.ball.pos.y > 1.6) {
          const power = clamp((shRacket.y - wrRacket.y) * 3.2, 0.8, 1.4);
          this.#whackServe(power);
        }
      }
    }

    // Drain gestures for active rally swings
    const events = this.drain(p);
    if (this.phase === 'rally') {
      for (const e of events) {
        if (e.type === 'swing' || e.type === 'punch') {
          this.swingAnim.active = true;
          this.swingAnim.timer = 1.0;
          this.swingAnim.type = e.hand === 'L' ? 'backhand' : 'forehand';

          if (this.canHit(0, p)) {
            this.hit(0, e.power || 0.85, p.motion?.lean || 0);
            break;
          }
        }
      }

      // Proximity spatial hit: if ball enters racket sweet spot zone
      if (this.canHit(0, p)) {
        const ballDist = this.ball.pos.distanceTo(this.racketPos);
        if (ballDist < 0.85) {
          this.swingAnim.active = true;
          this.swingAnim.timer = 1.0;
          this.hit(0, 0.9, p.motion?.lean || 0);
        }
      }
    }
  }

  #updateServePhase(dt) {
    if (this.server === 1) {
      // Bot Serve
      if (this.phaseTimer <= 0) {
        this.#serveBot();
      }
    } else {
      // Player Serve
      if (this.serveStage === 'tossed') {
        // Ball rises and falls under gravity
        this.ball.vel.y -= G * dt;
        this.ball.pos.y += this.ball.vel.y * dt;

        // If player didn't whack in time, ball bounces and resets
        if (this.ball.pos.y <= 0.15) {
          this.ctx.audio.play('tennisBounce');
          this.serveStage = 'ready';
          this.ball.pos.set(-7.8, 1.25, this.sides[0]?.courtZ || 0);
          this.ball.vel.set(0, 0, 0);
          this.message = 'FAULT';
          this.messageSub = 'Toss ball up & whack overhead to serve';
        }
      } else if (this.serveStage === 'ready' && (this.options.demo || this.phaseTimer <= -4.0)) {
        // Auto-toss fallback for demo mode / keyboard
        this.#tossBall();
        setTimeout(() => this.#whackServe(1.0), 450);
      }
    }
  }

  #serveBot() {
    const targetZ = rand(-3.2, 3.2);
    const targetX = -6.4;
    const speed = 14.5;
    const dx = targetX - this.ball.pos.x;
    const t = Math.abs(dx) / speed;
    const vx = dx / t;
    const vz = (targetZ - this.ball.pos.z) / t;
    let vy = (0.35 - this.ball.pos.y + 0.5 * G * t * t) / t;

    const tNet = Math.abs(this.ball.pos.x / vx);
    const yNet = this.ball.pos.y + vy * tNet - 0.5 * G * tNet * tNet;
    if (yNet < 1.3) vy += (1.3 - yNet) / tNet + 0.35;

    this.ball.vel.set(vx, vy, vz);
    this.ball.hitter = 1;
    this.ball.bounces = 0;
    this.ball.lastHitAt = performance.now();
    this.phase = 'rally';
    this.message = 'RETURN IT!';
    this.messageSub = 'Move left/right and swing your racket!';
    this.ctx.audio.play('tennisHit', { power: 1.0 });
  }

  #updateBot(dt) {
    const targetZ = this.phase === 'rally' && this.ball.pos.x > 0 ? clamp(this.ball.pos.z, -4.5, 4.5) : 0;
    this.botZ = damp(this.botZ, targetZ, 4.2, dt);
    this.botAvatar.followStage = false;
    this.botAvatar.group.position.set(8.2, 0, this.botZ);
    this.botAvatar.facingTarget = -Math.PI / 2;
    this.botAvatar.update(null, null, dt, { active: false });

    this.aiCooldown -= dt;
    if (this.phase === 'rally' && this.ball.pos.x > 0 && this.aiCooldown <= 0) {
      if (Math.abs(this.ball.pos.z - this.botZ) < 2.8 && this.ball.pos.y < 3.0 && this.ball.pos.x > 5.5) {
        this.aiCooldown = 1.1;
        // Bot returns ball with 88% consistency
        if (Math.random() < 0.88) {
          this.hit(1, 0.5 + Math.random() * 0.45, rand(-0.75, 0.75));
        }
      }
    }
  }

  canHit(side, p) {
    if (this.ball.hitter === side) return false;
    if (performance.now() - (this.ball.lastHitAt || 0) < 250) return false;
    const onSide = side === 0 ? this.ball.pos.x < 0.5 : this.ball.pos.x > -0.5;
    if (!onSide) return false;
    if (this.ball.pos.y > 3.4 || this.ball.pos.y < 0.1) return false;

    if (side === 0) {
      // Check spatial distance to player 3D racket or court baseline
      const dx = Math.abs(this.ball.pos.x - (-8.2));
      const dz = Math.abs(this.ball.pos.z - (p.courtZ || 0));
      return dx < 2.6 && dz < 3.2;
    }
    return Math.abs(this.ball.pos.z - this.botZ) < 3.2;
  }

  hit(side, power = 0.8, aim = 0) {
    const targetSide = 1 - side;
    const targetX = (targetSide === 0 ? -7.5 : 7.5) + rand(-0.8, 0.8);
    const targetZ = clamp(aim * 3.6 + rand(-0.9, 0.9), -4.4, 4.4);
    const speed = 14.5 + power * 7.5;
    const dx = targetX - this.ball.pos.x;
    if (Math.abs(dx) < 0.5) return;

    const t = Math.abs(dx) / speed;
    const vx = dx / t;
    const vz = (targetZ - this.ball.pos.z) / t;
    let vy = (0.35 - this.ball.pos.y + 0.5 * G * t * t) / t;

    const tNet = Math.abs(this.ball.pos.x / vx);
    const yNet = this.ball.pos.y + vy * tNet - 0.5 * G * tNet * tNet;
    if (yNet < 1.3) vy += (1.3 - yNet) / tNet + 0.35;

    this.ball.vel.set(vx, vy, vz);
    this.ball.hitter = side;
    this.ball.bounces = 0;
    this.ball.lastHitAt = performance.now();
    this.phase = 'rally';
    this.rally++;

    // Audio & Visual Effects
    this.ctx.audio.play('tennisHit', { power });
    this.fx.burst(this.ball.pos, '#ccff00', 16, { speed: 3.8, life: 0.38 });
    this.fx.ring(this.ball.pos, '#ccff00', 1.2, 0.32);
    this.ctx.engine.shake(0.06, 0.14);

    if (this.rally >= 4) {
      this.message = `RALLY x${this.rally}!`;
      this.messageSub = `${Math.round(speed * 3.6)} km/h`;
    }
  }

  updateBall(dt) {
    const b = this.ball;
    const prevX = b.pos.x;

    b.vel.y -= G * dt;
    b.pos.addScaledVector(b.vel, dt);

    // 1. Net collision (at x = 0)
    if ((prevX < 0 && b.pos.x >= 0) || (prevX > 0 && b.pos.x <= 0)) {
      if (b.pos.y < 1.15 && b.pos.y > 0.1) {
        b.vel.x *= -0.18;
        b.vel.z *= 0.4;
        b.vel.y = Math.abs(b.vel.y) * 0.25 + 1;
        this.ctx.audio.play('tennisHit', { power: 0.4 });
        this.pointTo(1 - b.hitter, 'INTO THE NET');
        return;
      }
    }

    // 2. Ground bounce
    if (b.pos.y <= 0.14 && b.vel.y < 0) {
      b.pos.y = 0.14;
      b.vel.y = -b.vel.y * 0.72; // Elastic court rebound
      b.vel.x *= 0.96;
      b.vel.z *= 0.96;
      b.bounces++;

      this.ctx.audio.play('tennisBounce');
      this.fx.ring({ x: b.pos.x, y: 0.02, z: b.pos.z }, '#ffffff', 0.95, 0.3);

      if (b.bounces >= 2) {
        this.pointTo(1 - b.hitter, 'DOUBLE BOUNCE');
        return;
      }
    }

    // 3. Out of bounds check
    if (Math.abs(b.pos.x) > 12.2 || Math.abs(b.pos.z) > 6.4) {
      this.pointTo(1 - b.hitter, 'OUT OF BOUNDS');
      return;
    }
    if (b.pos.y < -2) {
      this.pointTo(1 - b.hitter, 'OUT');
    }
  }

  pointTo(winnerSide, reason = '') {
    if (this.phase !== 'rally' && this.phase !== 'serve') return;
    this.phase = 'point';
    this.phaseTimer = 2.4;

    this.points[winnerSide]++;
    const p1Pts = this.points[0];
    const p2Pts = this.points[1];

    let gameWon = false;
    let scoreDisplay = '';

    // Tennis Traditional Game Point Scoring
    if (p1Pts >= 4 && p1Pts - p2Pts >= 2) {
      this.games[0]++;
      this.points = [0, 0];
      gameWon = true;
      scoreDisplay = 'GAME TO PLAYER 1!';
    } else if (p2Pts >= 4 && p2Pts - p1Pts >= 2) {
      this.games[1]++;
      this.points = [0, 0];
      gameWon = true;
      scoreDisplay = 'GAME TO BOT!';
    } else if (p1Pts >= 3 && p2Pts >= 3) {
      if (p1Pts === p2Pts) scoreDisplay = 'DEUCE (40-40)';
      else if (p1Pts > p2Pts) scoreDisplay = 'ADVANTAGE PLAYER 1';
      else scoreDisplay = 'ADVANTAGE BOT';
    } else {
      const terms = ['LOVE', '15', '30', '40'];
      scoreDisplay = `${terms[p1Pts] || '40'} — ${terms[p2Pts] || '40'}`;
    }

    const winnerName = this.sides[winnerSide]?.name || (winnerSide === 1 ? 'BOT' : 'PLAYER');
    this.message = gameWon ? scoreDisplay : `${winnerName.toUpperCase()} SCORES`;
    this.messageSub = `${reason} · Game Score: ${this.games[0]} - ${this.games[1]} (${scoreDisplay})`;

    this.ctx.audio.play('cheer');
    const burstX = winnerSide === 0 ? -7.5 : 7.5;
    this.fx.confetti({ x: burstX, y: 1.8, z: 0 }, 40);

    // Check Match Win (first to 3 games)
    if (this.games[winnerSide] >= WINNING_GAMES) {
      this.matchWinner = winnerSide;
      this.phase = 'matchEnd';
      this.phaseTimer = 9999; // Do NOT auto-loop! Stay at victory celebration!
      this.message = winnerSide === 0 ? '🏆 CHAMPION! MATCH WON!' : 'BOT WINS MATCH!';
      this.messageSub = `Final: ${this.games[0]} — ${this.games[1]} Games · Crowd roaring!`;

      this.ctx.audio.play('cheer');
      this.fx.confetti({ x: 0, y: 2.5, z: 0 }, 150);

      // Record win in persistent player profile!
      if (winnerSide === 0 && this.sides[0]?.profile) {
        const prof = this.sides[0].profile;
        prof.wins = (prof.wins || 0) + 1;
        prof.games = (prof.games || 0) + 1;
        prof.level = Math.floor(prof.wins / 3) + 1;

        try {
          const key = 'arfg_profiles_v2';
          const raw = localStorage.getItem(key);
          if (raw) {
            const list = JSON.parse(raw);
            const found = list.find((x) => x.id === prof.id);
            if (found) {
              found.wins = prof.wins;
              found.games = prof.games;
              found.level = prof.level;
              localStorage.setItem(key, JSON.stringify(list));
            }
          }
        } catch {}
      }

      this.results = [
        {
          name: this.sides[0]?.name || 'Player 1',
          color: this.sides[0]?.color || '#22d3ee',
          detail: `${this.games[0]} Games · Best Rally x${this.rally}`,
          rank: winnerSide === 0 ? 1 : 2,
          gained: this.games[0] * 120,
        },
        {
          name: this.sides[1]?.name || 'BOT',
          color: this.sides[1]?.color || '#94a3b8',
          detail: `${this.games[1]} Games`,
          rank: winnerSide === 1 ? 1 : 2,
          gained: this.games[1] * 120,
        },
      ].sort((a, b) => a.rank - b.rank);
    }
  }

  #updateCameraFlashes(dt) {
    if (this.phase !== 'matchEnd' || this.matchWinner == null) {
      for (const f of this.cameraFlashes) f.light.intensity = 0;
      return;
    }

    for (const f of this.cameraFlashes) {
      if (f.flashTimer > 0) {
        f.flashTimer -= dt;
        f.light.intensity = Math.max(0, f.flashTimer * 18);
      } else if (Math.random() < 0.08) {
        f.flashTimer = 0.12 + Math.random() * 0.08;
        f.light.intensity = 3.6;
      }
    }
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
    const p1 = this.sides[0];
    const playerZ = p1?.courtZ || 0;

    // Authentic Grand Slam behind-the-baseline court view:
    // Standing behind player, looking down court over net at opponent!
    const camX = -13.5;
    const camY = 3.6;
    const camZ = damp(this.ctx.camera?.position?.z || 0, playerZ * 0.5, 6, 0.016);
    this.setCamera([camX, camY, camZ], [3.5, 1.15, 0], 54);
  }

  getHud() {
    const terms = ['0', '15', '30', '40'];
    const p1Term = terms[this.points[0]] || '40';
    const p2Term = terms[this.points[1]] || '40';
    let ptsLine = `${p1Term} - ${p2Term}`;
    if (this.points[0] >= 3 && this.points[1] >= 3) {
      if (this.points[0] === this.points[1]) ptsLine = 'DEUCE';
      else if (this.points[0] > this.points[1]) ptsLine = 'ADVANTAGE P1';
      else ptsLine = 'ADVANTAGE BOT';
    }

    const players = [0, 1].map((side) => {
      const p = this.sides[side];
      const name = p ? p.name : side === 1 && this.bot ? 'ROBO-PRO' : '—';
      const color = p ? p.color : '#94a3b8';
      return {
        id: p ? p.key : 'bot',
        name,
        color,
        value: this.games[side],
        max: WINNING_GAMES,
        label: 'GAMES',
        points: this.games[side] * 100,
        detail: this.server === side && this.phase !== 'matchEnd' ? 'SERVE' : '',
        active: true,
      };
    });

    return {
      title: this.title,
      subtitle: `Games: ${this.games[0]} — ${this.games[1]} · Points: ${ptsLine}`,
      phase: this.phase,
      timer: null,
      message: this.message,
      messageSub: this.messageSub,
      winnerId: this.matchWinner === 0 ? this.sides[0]?.id : null,
      big: null,
      players,
      queue: [],
      score: `GAMES ${this.games[0]} - ${this.games[1]} (${ptsLine})`,
      results: this.phase === 'matchEnd' ? this.results : [],
    };
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    if (this.botAvatar) this.botAvatar.dispose();
    this.racketGroup?.removeFromParent();
    for (const cf of this.cameraFlashes) {
      cf.light?.removeFromParent();
    }
    super.dispose();
  }
}
