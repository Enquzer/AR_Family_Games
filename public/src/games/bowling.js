/**
 * Bowling: Ten-Pin Bowling with authentic pin cascade physics and scoring.
 * 
 * Controls:
 * - Swing arm back and forward to roll
 * - Swivel / lean to aim across the lane
 * - Twist wrist to apply hook spin
 * 
 * Features:
 * - 10 3D pins in standard triangle formation
 * - Ball-to-pin and pin-to-pin cascade collisions
 * - Gutters, oil pattern slide-to-hook transitions, and pit cushion
 * - Authentic 10-frame scoring with strikes, spares, and bonus rolls
 * - Dynamic tracking camera following the rolling ball into the pin deck
 */
import * as THREE from '/vendor/three/three.module.js';
import { BaseGame } from './base.js';
import { buildBowlingAlley } from '../engine/environments.js';
import { clamp, damp } from '../shared/math.js';

const PIN_H = 0.38;
const PIN_R = 0.07;
const BALL_R = 0.11;
const LANE_W = 1.08;
const LANE_Y = 0.05;
const PIN_DECK_Z = -18.2;
const TOTAL_FRAMES = 5; // 5-frame party match (fast & fun)

// 10-Pin standard rack layout relative to Pin 1
const PIN_LAYOUT = [
  { id: 1, row: 1, x: 0, z: PIN_DECK_Z },
  { id: 2, row: 2, x: -0.155, z: PIN_DECK_Z - 0.28 },
  { id: 3, row: 2, x: 0.155, z: PIN_DECK_Z - 0.28 },
  { id: 4, row: 3, x: -0.31, z: PIN_DECK_Z - 0.56 },
  { id: 5, row: 3, x: 0, z: PIN_DECK_Z - 0.56 },
  { id: 6, row: 3, x: 0.31, z: PIN_DECK_Z - 0.56 },
  { id: 7, row: 4, x: -0.465, z: PIN_DECK_Z - 0.84 },
  { id: 8, row: 4, x: -0.155, z: PIN_DECK_Z - 0.84 },
  { id: 9, row: 4, x: 0.155, z: PIN_DECK_Z - 0.84 },
  { id: 10, row: 4, x: 0.465, z: PIN_DECK_Z - 0.84 },
];

export class BowlingGame extends BaseGame {
  constructor(ctx, options = {}) {
    super(ctx, options);
    this.id = 'bowling';
    this.title = 'BOWLING';
    this.subtitle = 'Swing · aim · strike';
    this.phase = 'waiting'; // waiting | aim | rolling | sweep | results | matchEnd
    this.activeIndex = 0;

    this.currentFrame = 1;
    this.currentRoll = 1;
    this.playerStats = new Map();

    this.aimX = 0;
    this.hook = 0;
    this.power = 0.6;
    this.turnTime = 0;
    this.phaseTimer = 0;
    this.rollingTime = 0;
    this.settleTimer = 0;

    this.pins = [];
    this.ball = null;
    this.aimDots = [];
    this.sweeper = null;

    this.results = [];
    this.matchWinner = null;
    this.lastLaunchAt = 0;
  }

  buildWorld() {
    this.env = buildBowlingAlley();
    this.scene = this.env.scene;
    this.lane = this.env.lane;

    // Build the 10 pins
    this.pins = PIN_LAYOUT.map((p) => this.#makePin(p));

    // Build the bowling ball
    this.ball = this.#makeBall();

    // Aim guide dots
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 16; i++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), dotMat.clone());
      dot.visible = false;
      this.scene.add(dot);
      this.aimDots.push(dot);
    }

    // Pinsetter sweeper bar
    const sweepMat = new THREE.MeshStandardMaterial({ color: 0x3f3f46, roughness: 0.35, metalness: 0.6 });
    this.sweeper = new THREE.Mesh(new THREE.BoxGeometry(LANE_W + 0.4, 0.08, 0.12), sweepMat);
    this.sweeper.position.set(0, 1.8, PIN_DECK_Z);
    this.sweeper.visible = false;
    this.scene.add(this.sweeper);
  }

  #makePin({ id, x, z }) {
    const pinGroup = new THREE.Group();

    // White glossy pin body
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.18,
      metalness: 0.05,
    });
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xb91c1c,
      emissiveIntensity: 0.35,
      roughness: 0.25,
    });

    // Lower belly
    const belly = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.045, 0.22, 16), bodyMat);
    belly.position.y = 0.11;
    belly.castShadow = true;
    pinGroup.add(belly);

    // Neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.065, 0.12, 16), bodyMat);
    neck.position.y = 0.28;
    neck.castShadow = true;
    pinGroup.add(neck);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.038, 14, 12), bodyMat);
    head.position.y = 0.35;
    head.castShadow = true;
    pinGroup.add(head);

    // Double red neck stripes
    const stripe1 = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.007, 8, 20), stripeMat);
    stripe1.rotation.x = Math.PI / 2;
    stripe1.position.y = 0.27;
    pinGroup.add(stripe1);

    const stripe2 = stripe1.clone();
    stripe2.position.y = 0.30;
    pinGroup.add(stripe2);

    pinGroup.position.set(x, LANE_Y, z);
    this.scene.add(pinGroup);

    // Floor shadow
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(PIN_R * 1.1, 14),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(x, LANE_Y + 0.003, z);
    this.scene.add(shadow);

    return {
      id,
      rackX: x,
      rackZ: z,
      group: pinGroup,
      shadow,
      pos: new THREE.Vector3(x, LANE_Y, z),
      vel: new THREE.Vector3(0, 0, 0),
      rot: new THREE.Vector3(0, 0, 0),
      angVel: new THREE.Vector3(0, 0, 0),
      tilt: 0,
      fallen: false,
      settled: false,
    };
  }

  #makeBall() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1e1b4b,
      roughness: 0.12,
      metalness: 0.15,
      emissive: 0x312e81,
      emissiveIntensity: 0.25,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 16), mat);
    mesh.castShadow = true;
    this.scene.add(mesh);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(BALL_R * 1.05, 18),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = LANE_Y + 0.004;
    this.scene.add(shadow);

    return {
      mesh,
      shadow,
      pos: new THREE.Vector3(0, LANE_Y + BALL_R, 3.2),
      vel: new THREE.Vector3(0, 0, 0),
      spin: 0,
      inGutter: false,
      rolled: false,
      settled: false,
    };
  }

  start() {
    if (!this.players.length) {
      this.phase = 'waiting';
      this.message = 'WAVE TO JOIN';
      this.messageSub = 'Wave at the camera to join Bowling';
      return;
    }

    for (const p of this.players) {
      this.playerStats.set(p.key, {
        totalScore: 0,
        frames: Array.from({ length: TOTAL_FRAMES }, () => ({
          r1: null,
          r2: null,
          r3: null,
          score: null,
          strike: false,
          spare: false,
        })),
        strikes: 0,
        spares: 0,
      });
      p.avatar.setProp('ball');
      p.avatar.setVisible(true);
      p.avatar.seated = false;
      p.avatar.followStage = false;
    }

    this.activeIndex = 0;
    this.currentFrame = 1;
    this.currentRoll = 1;
    this.results = [];
    this.matchWinner = null;
    this.#beginTurn();
  }

  addPlayer(p) {
    super.addPlayer(p);
    if (!this.playerStats.has(p.key)) {
      this.playerStats.set(p.key, {
        totalScore: 0,
        frames: Array.from({ length: TOTAL_FRAMES }, () => ({
          r1: null,
          r2: null,
          r3: null,
          score: null,
          strike: false,
          spare: false,
        })),
        strikes: 0,
        spares: 0,
      });
    }
    p.avatar.setProp('ball');
    p.avatar.setVisible(true);
    p.avatar.seated = false;
    p.avatar.followStage = false;
    if (this.phase === 'waiting' && this.players.length) this.start();
  }

  #beginTurn() {
    if (!this.players.length) {
      this.phase = 'waiting';
      return;
    }

    const p = this.#activePlayer();
    this.phase = 'aim';
    this.aimX = 0;
    this.hook = 0;
    this.power = 0.65;
    this.turnTime = 0;
    this.phaseTimer = 0;
    this.rollingTime = 0;
    this.settleTimer = 0;

    // Reset ball to approach position
    this.ball.pos.set(0, LANE_Y + BALL_R, 3.2);
    this.ball.vel.set(0, 0, 0);
    this.ball.spin = 0;
    this.ball.inGutter = false;
    this.ball.rolled = false;
    this.ball.settled = false;
    this.ball.mesh.visible = true;
    this.ball.shadow.visible = true;
    this.#syncBall();

    if (this.currentRoll === 1) {
      this.#resetPins(true); // Full rack of 10 pins
    } else {
      this.#clearFallenPins(); // Leave remaining standing pins
    }

    for (const pl of this.players) this.drain(pl);

    this.message = `${p.name.toUpperCase()} · FRAME ${this.currentFrame} (${this.currentRoll === 1 ? '1ST ROLL' : '2ND ROLL'})`;
    this.messageSub = 'Swing arm forward to roll · lean to aim · twist for hook';
    this.ctx.audio.play('cue');
    this.#placeAvatars();
    this.#updateAimVisuals();
  }

  #resetPins(full = true) {
    for (const pin of this.pins) {
      if (full) {
        pin.pos.set(pin.rackX, LANE_Y, pin.rackZ);
        pin.vel.set(0, 0, 0);
        pin.rot.set(0, 0, 0);
        pin.angVel.set(0, 0, 0);
        pin.tilt = 0;
        pin.fallen = false;
        pin.settled = false;
        pin.group.position.copy(pin.pos);
        pin.group.rotation.set(0, 0, 0);
        pin.group.visible = true;
        pin.shadow.visible = true;
        pin.shadow.position.set(pin.pos.x, LANE_Y + 0.003, pin.pos.z);
      }
    }
  }

  #clearFallenPins() {
    for (const pin of this.pins) {
      if (pin.fallen) {
        pin.group.visible = false;
        pin.shadow.visible = false;
      } else {
        // Reset upright position for remaining standing pins
        pin.pos.set(pin.rackX, LANE_Y, pin.rackZ);
        pin.vel.set(0, 0, 0);
        pin.rot.set(0, 0, 0);
        pin.angVel.set(0, 0, 0);
        pin.tilt = 0;
        pin.group.position.copy(pin.pos);
        pin.group.rotation.set(0, 0, 0);
        pin.group.visible = true;
        pin.shadow.visible = true;
      }
    }
  }

  #placeAvatars() {
    if (!this.players.length) return;
    const active = this.#activePlayer();
    this.players.forEach((p, i) => {
      if (p === active) {
        // Face down the bowling lane toward the pins (-Z)
        this.place(p, 0, 4.4, { y: 0, facing: Math.PI });
        p.avatar.setVisible(true);
        p.avatar.setProp(this.phase === 'aim' ? 'ball' : 'none', p.dominantHand || 'R');
      } else {
        const side = i % 2 === 0 ? -1.8 : 1.8;
        // Side bench players angle slightly inward watching lane
        this.place(p, side, 4.8, { y: 0, facing: side < 0 ? Math.PI * 0.85 : Math.PI * 1.15 });
        p.avatar.setVisible(true);
        p.avatar.setProp('none');
      }
    });
  }

  #activePlayer() {
    return this.players[this.activeIndex] || null;
  }

  update(dt) {
    this.time += dt;
    this.env.update?.(dt, this.time);
    this.turnTime += dt;

    if (this.phase === 'waiting') {
      if (this.players.length) this.start();
      this.updateCamera();
      return;
    }

    if (this.phase === 'aim') {
      this.#updateAim(dt);
      this.#drainRollGestures();
      this.#updateAimVisuals();
    } else if (this.phase === 'rolling') {
      this.rollingTime += dt;
      this.#stepPhysics(dt);
      this.#updateAimVisuals();
      this.#checkSettled(dt);
    } else if (this.phase === 'results') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.#advanceTurn();
      }
    } else if (this.phase === 'matchEnd') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this.start();
    }

    this.updateCamera();
  }

  #updateAim(dt) {
    const p = this.#activePlayer();
    if (!p || !p.motion) return;
    const s = p.motion.state || {};
    const hL = s.handL || { x: 0, y: 0, z: 0 };
    const hR = s.handR || { x: 0, y: 0, z: 0 };

    // Aim from lateral hand position + torso lean using calibrated dominant hand
    const isLeft = p.dominantHand === 'L';
    const dominantHand = isLeft ? hL : hR;
    const targetAimX = clamp(dominantHand.x * 0.45 + (s.lean || 0) * 0.22, -LANE_W * 0.42, LANE_W * 0.42);
    const targetHook = clamp((hR.z - hL.z) * 1.2 + (s.torsoTwist || 0) * 0.6, -1.2, 1.2);
    const targetPower = clamp(0.45 + (s.handSpeed || 0) / 10, 0.4, 1.0);

    this.aimX = damp(this.aimX, targetAimX, 8, dt);
    this.hook = damp(this.hook, targetHook, 6, dt);
    this.power = damp(this.power, targetPower, 7, dt);

    this.ball.pos.x = this.aimX;
    this.#syncBall();
  }

  #drainRollGestures() {
    const p = this.#activePlayer();
    if (!p) return;
    const events = this.drain(p);

    for (const e of events) {
      if (e.type === 'push' || e.type === 'swing' || (e.type === 'punch' && (e.power || 0) > 0.45)) {
        if (this.time - this.lastLaunchAt > 0.6) {
          this.lastLaunchAt = this.time;
          this.#launch(e.power || this.power);
          return;
        }
      }
    }
  }

  #launch(powerVal) {
    if (this.phase !== 'aim') return;
    const p = this.#activePlayer();
    if (!p) return;

    const power = clamp(powerVal, 0.4, 1.2);
    const speed = 9.5 + power * 6.5; // 9.5 to 16 m/s

    // Trajectory angle based on aim X and hook
    const angleX = -(this.aimX / (LANE_W * 0.5)) * 0.05 + this.hook * 0.04;
    this.ball.vel.set(Math.sin(angleX) * speed, 0, -Math.cos(angleX) * speed);
    this.ball.spin = this.hook * 2.2;
    this.ball.inGutter = false;
    this.ball.rolled = true;
    this.ball.settled = false;

    this.phase = 'rolling';
    this.rollingTime = 0;
    this.settleTimer = 0;
    p.avatar.setProp('none');

    this.message = 'ROLLING!';
    this.messageSub = `${Math.round(power * 100)}% power · ${
      this.hook < -0.15 ? 'HOOK LEFT' : this.hook > 0.15 ? 'HOOK RIGHT' : 'STRAIGHT'
    }`;

    this.ctx.audio.play('ballHit', { power: 0.8 });
    this.ctx.engine.shake(0.06, 0.15);
    this.#updateAimVisuals();
  }

  #stepPhysics(dt) {
    const b = this.ball;
    const _rotAxis = new THREE.Vector3();
    const _rotQuat = new THREE.Quaternion();

    // 1. Ball Motion & Gutter checks
    if (b.rolled && !b.settled) {
      // Gutter detection: lane half-width is 0.54m
      if (!b.inGutter && Math.abs(b.pos.x) > LANE_W / 2) {
        b.inGutter = true;
        b.vel.x = 0;
        b.spin = 0;
        b.pos.x = b.pos.x < 0 ? -LANE_W / 2 - 0.12 : LANE_W / 2 + 0.12;
        b.pos.y = LANE_Y - 0.02; // drops into gutter trough
        this.ctx.audio.play('gutter');
        this.ctx.engine.shake(0.08, 0.15);
        this.message = 'GUTTER BALL!';
        this.messageSub = 'Rolled into the gutter channel';
      }

      // Ball hook steering on dry back-end of lane (z < -8.0)
      if (!b.inGutter && b.pos.z < -8.0 && Math.abs(b.spin) > 0.05) {
        b.vel.x += b.spin * 1.8 * dt;
      }

      // Forward integration
      b.pos.x += b.vel.x * dt;
      b.pos.z += b.vel.z * dt;

      // 3D rolling ball rotation
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (sp > 0.1) {
        const rotDist = sp * dt;
        const rotAngle = rotDist / BALL_R;
        _rotAxis.set(b.vel.z, 0, -b.vel.x).normalize();
        _rotQuat.setFromAxisAngle(_rotAxis, rotAngle);
        b.mesh.quaternion.premultiply(_rotQuat);
      }

      // Reached back pit
      if (b.pos.z < PIN_DECK_Z - 1.6) {
        b.vel.set(0, 0, 0);
        b.settled = true;
      }
    }
    this.#syncBall();

    // 2. Ball-to-Pin Collisions (only if ball is on the lane, not in gutter!)
    if (!b.inGutter && b.pos.z < PIN_DECK_Z + 1.2 && b.pos.z > PIN_DECK_Z - 2.0) {
      for (const pin of this.pins) {
        if (pin.fallen) continue;
        const dx = pin.pos.x - b.pos.x;
        const dz = pin.pos.z - b.pos.z;
        const d2 = dx * dx + dz * dz;
        const hitD = BALL_R + PIN_R;

        if (d2 < hitD * hitD) {
          const d = Math.max(0.001, Math.sqrt(d2));
          const nx = dx / d;
          const nz = dz / d;

          // Ball impact impulse on pin
          const impactSpeed = Math.hypot(b.vel.x, b.vel.z);
          pin.vel.x = nx * impactSpeed * 0.85 + (Math.random() - 0.5) * 2;
          pin.vel.z = nz * impactSpeed * 0.85;
          pin.angVel.x = (Math.random() - 0.5) * 14;
          pin.angVel.z = nx * 12;
          pin.fallen = true;

          // Ball slows and deflects slightly
          b.vel.x -= nx * 1.2;
          b.vel.z *= 0.88;

          this.ctx.audio.play('pinHit', { power: Math.min(1.2, impactSpeed / 12) });
          this.ctx.engine.shake(0.08, 0.18);
          this.fx.burst({ x: pin.pos.x, y: LANE_Y + 0.15, z: pin.pos.z }, '#fef08a', 8, { speed: 2.2, life: 0.35 });
        }
      }
    }

    // 3. Pin-to-Pin Cascade Collisions (Domino reaction)
    for (let i = 0; i < this.pins.length; i++) {
      const pA = this.pins[i];
      const speedA = Math.hypot(pA.vel.x, pA.vel.z);
      if (speedA < 0.2) continue;

      for (let j = 0; j < this.pins.length; j++) {
        if (i === j) continue;
        const pB = this.pins[j];
        const dx = pB.pos.x - pA.pos.x;
        const dz = pB.pos.z - pA.pos.z;
        const d2 = dx * dx + dz * dz;
        const cascadeD = PIN_R * 2.8;

        if (d2 < cascadeD * cascadeD) {
          const d = Math.max(0.001, Math.sqrt(d2));
          const nx = dx / d;
          const nz = dz / d;

          pB.vel.x += nx * speedA * 0.75;
          pB.vel.z += nz * speedA * 0.75;
          pB.angVel.x = (Math.random() - 0.5) * 10;
          pB.angVel.z = nx * 10;
          pB.fallen = true;

          pA.vel.x *= 0.7;
          pA.vel.z *= 0.7;

          this.ctx.audio.play('pinHit', { power: 0.7 });
          this.fx.burst({ x: pB.pos.x, y: LANE_Y + 0.15, z: pB.pos.z }, '#ffffff', 5, { speed: 1.8, life: 0.25 });
        }
      }
    }

    // 4. Pin Integration & Tilt
    for (const pin of this.pins) {
      if (pin.settled) continue;

      pin.pos.x += pin.vel.x * dt;
      pin.pos.z += pin.vel.z * dt;
      pin.rot.x += pin.angVel.x * dt;
      pin.rot.z += pin.angVel.z * dt;

      // Friction & damping
      pin.vel.x *= Math.exp(-3.5 * dt);
      pin.vel.z *= Math.exp(-3.5 * dt);
      pin.angVel.x *= Math.exp(-4.0 * dt);
      pin.angVel.z *= Math.exp(-4.0 * dt);

      if (pin.fallen) {
        // Fall flat onto lane
        pin.group.rotation.x = damp(pin.group.rotation.x, Math.PI / 2, 8, dt);
        pin.group.rotation.z += pin.angVel.z * dt;
        pin.group.position.y = LANE_Y + PIN_R * 0.6;
      }

      pin.group.position.x = pin.pos.x;
      pin.group.position.z = pin.pos.z;
      pin.shadow.position.x = pin.pos.x;
      pin.shadow.position.z = pin.pos.z;

      if (Math.hypot(pin.vel.x, pin.vel.z) < 0.05 && (!pin.fallen || Math.abs(pin.group.rotation.x - Math.PI / 2) < 0.1)) {
        pin.settled = true;
      }
    }
  }

  #syncBall() {
    const b = this.ball;
    b.mesh.position.copy(b.pos);
    b.shadow.position.set(b.pos.x, LANE_Y + 0.004, b.pos.z);
  }

  #checkSettled(dt) {
    const ballDone = this.ball.settled || this.ball.pos.z < PIN_DECK_Z - 1.2;
    const pinsDone = this.pins.every((p) => p.settled || !p.fallen);

    if (ballDone && (pinsDone || this.rollingTime > 4.5)) {
      this.settleTimer += dt;
      if (this.settleTimer > 0.8) {
        this.#scoreRoll();
      }
    }
  }

  #scoreRoll() {
    this.phase = 'results';
    this.phaseTimer = 2.8;

    const p = this.#activePlayer();
    const stats = this.playerStats.get(p.key);
    const fallenPins = this.pins.filter((pin) => pin.fallen).length;

    const fIdx = this.currentFrame - 1;
    const f = stats.frames[fIdx];

    if (this.currentRoll === 1) {
      f.r1 = fallenPins;
      if (fallenPins === 10) {
        // STRIKE!
        f.strike = true;
        stats.strikes++;
        this.message = 'STRIKE! 🎳';
        this.messageSub = `${p.name} bowled a PERFECT STRIKE! +10 + bonus`;
        this.ctx.audio.play('strike');
        this.ctx.engine.shake(0.18, 0.35);
        this.fx.confetti({ x: 0, y: 1.8, z: PIN_DECK_Z }, 60);
      } else {
        this.message = `${fallenPins} PIN${fallenPins === 1 ? '' : 'S'}!`;
        this.messageSub = `${10 - fallenPins} remaining for roll 2`;
        this.ctx.audio.play('good');
      }
    } else {
      // Roll 2
      const newPins = fallenPins - (f.r1 || 0);
      f.r2 = Math.max(0, newPins);

      if (fallenPins === 10) {
        // SPARE!
        f.spare = true;
        stats.spares++;
        this.message = 'SPARE! 💥';
        this.messageSub = `${p.name} picked up the SPARE! +10 + bonus`;
        this.ctx.audio.play('bell');
        this.ctx.audio.play('cheer');
        this.ctx.engine.shake(0.12, 0.22);
        this.fx.ring({ x: 0, y: 1.2, z: PIN_DECK_Z }, '#34d399', 2.2, 0.4);
      } else {
        const frameTotal = f.r1 + f.r2;
        this.message = `${frameTotal} PINS`;
        this.messageSub = `Frame ${this.currentFrame} complete`;
        this.ctx.audio.play(frameTotal >= 7 ? 'good' : 'bad');
      }
    }

    this.#recalculateScore(stats);
  }

  #recalculateScore(stats) {
    let total = 0;
    for (let i = 0; i < stats.frames.length; i++) {
      const f = stats.frames[i];
      if (f.r1 == null) break;

      if (f.strike) {
        // 10 + next 2 rolls
        const next1 = stats.frames[i + 1]?.r1 ?? 0;
        const next2 = stats.frames[i + 1]?.strike
          ? (stats.frames[i + 2]?.r1 ?? 0)
          : (stats.frames[i + 1]?.r2 ?? 0);
        total += 10 + next1 + next2;
        f.score = total;
      } else if (f.spare) {
        // 10 + next 1 roll
        const next1 = stats.frames[i + 1]?.r1 ?? 0;
        total += 10 + next1;
        f.score = total;
      } else if (f.r2 != null) {
        total += f.r1 + f.r2;
        f.score = total;
      }
    }
    stats.totalScore = total;
  }

  #advanceTurn() {
    const p = this.#activePlayer();
    const stats = this.playerStats.get(p.key);
    const f = stats.frames[this.currentFrame - 1];

    // If strike on roll 1, or roll 2 complete: advance to next player or frame
    if (f.strike || this.currentRoll === 2) {
      this.currentRoll = 1;
      this.activeIndex++;

      if (this.activeIndex >= this.players.length) {
        this.activeIndex = 0;
        this.currentFrame++;

        if (this.currentFrame > TOTAL_FRAMES) {
          this.#endMatch();
          return;
        }
      }
    } else {
      this.currentRoll = 2;
    }

    this.#beginTurn();
  }

  #endMatch() {
    this.phase = 'matchEnd';
    this.phaseTimer = 10;
    this.results = this.players
      .map((p) => {
        const st = this.playerStats.get(p.key);
        return {
          name: p.name,
          color: p.color,
          detail: `${st.totalScore} pts · ${st.strikes} strikes · ${st.spares} spares`,
          gained: st.totalScore,
        };
      })
      .sort((a, b) => b.gained - a.gained)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    this.matchWinner = this.results[0] || null;
    this.message = this.matchWinner ? `${this.matchWinner.name.toUpperCase()} WINS!` : 'MATCH COMPLETE';
    this.messageSub = 'Great game! Starting new match soon';
    this.ctx.audio.play('cheer');
    this.fx.confetti({ x: 0, y: 1.8, z: 0 }, 140);
  }

  #updateAimVisuals() {
    const show = this.phase === 'aim';
    if (!show) {
      for (const d of this.aimDots) d.visible = false;
      return;
    }

    const startX = this.aimX;
    const startZ = 3.2;
    for (let i = 0; i < this.aimDots.length; i++) {
      const t = (i + 1) / this.aimDots.length;
      const z = startZ - t * 21.0;
      // Hook curves deeper into the pocket in back half
      const curveT = Math.max(0, t - 0.4) / 0.6;
      const x = startX + this.hook * curveT * curveT * 0.35;

      const dot = this.aimDots[i];
      dot.position.set(x, LANE_Y + 0.04, z);
      dot.visible = true;
      dot.material.opacity = 0.75 - t * 0.35;
      dot.material.color.setHSL(0.12 + Math.abs(this.hook) * 0.1, 0.95, 0.6);
    }
  }

  updateCamera() {
    const cam = this.ctx.camera;
    if (!cam) return;

    if (this.phase === 'rolling' && this.ball.rolled && !this.ball.settled) {
      // Smooth tracking camera following rolling ball
      const targetZ = this.ball.pos.z + 4.2;
      const targetY = Math.max(0.65, this.ball.pos.y + 0.95);
      cam.position.x = damp(cam.position.x, this.ball.pos.x * 0.65, 8, 0.016);
      cam.position.y = damp(cam.position.y, targetY, 6, 0.016);
      cam.position.z = damp(cam.position.z, targetZ, 7, 0.016);
      cam.lookAt(this.ball.pos.x * 0.5, LANE_Y + 0.2, this.ball.pos.z - 5.0);
    } else {
      // Standard approach perspective
      cam.position.x = damp(cam.position.x, 0, 4, 0.016);
      cam.position.y = damp(cam.position.y, 1.95, 4, 0.016);
      cam.position.z = damp(cam.position.z, 5.2, 4, 0.016);
      cam.lookAt(0, 0.45, -12.0);
    }
  }

  getHud() {
    const active = this.#activePlayer();
    const list = this.players.map((p) => {
      const st = this.playerStats.get(p.key) || { totalScore: 0 };
      return {
        id: p.key,
        name: p.name,
        color: p.color,
        value: st.totalScore,
        max: 0,
        label: '',
        points: st.totalScore,
        detail: `Frame ${this.currentFrame}/${TOTAL_FRAMES} · ${st.strikes}X ${st.spares}/`,
        active: p === active,
      };
    });

    const activeScore = active ? this.playerStats.get(active.key)?.totalScore || 0 : 0;
    const scoreLine = active && this.phase !== 'matchEnd'
      ? `SCORE ${activeScore} · FRAME ${this.currentFrame}/${TOTAL_FRAMES} (${this.currentRoll === 1 ? 'ROLL 1' : 'ROLL 2'})`
      : '';

    return {
      title: this.title,
      subtitle: 'Swing arm forward to roll · lean to aim · twist for hook',
      phase: this.phase,
      timer: null,
      score: scoreLine,
      message: this.message,
      messageSub: this.messageSub,
      big: null,
      players: list,
      results: this.phase === 'matchEnd' ? this.results : [],
    };
  }

  dispose() {
    for (const pin of this.pins) {
      pin.group?.removeFromParent();
      pin.shadow?.removeFromParent();
    }
    this.ball?.mesh?.removeFromParent();
    this.ball?.shadow?.removeFromParent();
    for (const d of this.aimDots) d.removeFromParent();
    this.sweeper?.removeFromParent();
    super.dispose();
  }
}
