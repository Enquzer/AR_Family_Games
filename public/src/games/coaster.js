/**
 * Roller Coaster: High-Speed Theme-Park Coaster with Physics-Based Rail Alignment,
 * Centrifugal Curve Detection, Upper-Torso Lean & Hip-Swivel Balancing,
 * Derailment Crash Physics, Chain-Lift Slow Start, and Overhead/Gap Obstacles.
 *
 * Gameplay Mechanics:
 * - Upper Torso Lean & Hip Swivel: Swivel hips & lean into high-speed banked curves to counteract
 *   centrifugal force. Failing to swivel/lean tilts the cart onto 2 wheels and causes catastrophic derailment!
 * - Overhead Steel Girders: Crouch / duck to avoid low clearance beams.
 * - Broken Track Gaps: Perform two-foot vertical jumps to trigger magnetic jump thrusters over rail gaps.
 * - Slow Chain-Lift Climb: Rises steadily up to the 34m summit before plunging down the mega drop!
 * - Avatar Sitting on Top: Avatars sit securely on cart seats, leaning and swiveling with the player's live body.
 */
import * as THREE from '/vendor/three/three.module.js';
import { BaseGame } from './base.js';
import { buildCoasterWorld } from '../engine/environments.js';
import { clamp, damp, finite } from '../shared/math.js';

const UP = new THREE.Vector3(0, 1, 0);
const SEATS = [
  [-0.55, 0.72, 0.55],
  [0.55, 0.72, 0.55],
  [-0.55, 0.72, -0.45],
  [0.55, 0.72, -0.45],
];

function makeCart() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.7, roughness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8, roughness: 0.35 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.85, roughness: 0.25 });

  // Aerodynamic coaster chassis
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.45, 3.4), bodyMat);
  base.position.y = 0.35;
  base.castShadow = true;
  g.add(base);

  // Wedge front nose cone
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.4, 4), bodyMat);
  nose.rotation.x = Math.PI / 2;
  nose.rotation.y = Math.PI / 4;
  nose.position.set(0, 0.4, 2.2);
  nose.scale.set(1.35, 1, 0.55);
  g.add(nose);

  // 4 Bucket Seats with contoured backs and safety lap bars
  for (const [x, , z] of SEATS) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.18, 0.75), darkMat);
    seat.position.set(x, 0.65, z);
    g.add(seat);

    const back = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.42, 0.12), darkMat);
    back.position.set(x, 0.86, z - 0.36);
    g.add(back);

    const lapBar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.82, 8), trimMat);
    lapBar.rotation.z = Math.PI / 2;
    lapBar.position.set(x, 0.84, z + 0.22);
    g.add(lapBar);
  }

  // Safety handrails along side edges
  for (const sx of [-0.98, 0.98]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 3.2), trimMat);
    rail.position.set(sx, 0.65, 0.1);
    g.add(rail);
  }

  // Dual high-intensity front headlights & glow point light
  const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
  for (const hx of [-0.65, 0.65]) {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), headlightMat);
    hl.position.set(hx, 0.46, 2.5);
    g.add(hl);
  }
  const headlight = new THREE.PointLight(0xffedd5, 18, 22, 1.8);
  headlight.position.set(0, 0.9, 2.8);
  g.add(headlight);

  // 4 Dual-flanged steel coaster wheels
  const wheels = [];
  for (const x of [-0.96, 0.96]) {
    for (const z of [-0.95, 0.95]) {
      const wheelGroup = new THREE.Group();
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 16), darkMat);
      wheel.rotation.z = Math.PI / 2;
      wheelGroup.add(wheel);
      const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 16), trimMat);
      flange.rotation.z = Math.PI / 2;
      flange.position.x = x > 0 ? 0.08 : -0.08;
      wheelGroup.add(flange);
      wheelGroup.position.set(x, 0.18, z);
      g.add(wheelGroup);
      wheels.push(wheelGroup);
    }
  }
  g.userData.wheels = wheels;

  // Magnetic thrusters under chassis (glow blue during jump)
  const thrusterMat = new THREE.MeshStandardMaterial({
    color: 0x0284c7,
    emissive: 0x0284c7,
    emissiveIntensity: 0.2,
  });
  const thruster = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.8), thrusterMat);
  thruster.position.set(0, 0.08, -0.6);
  g.add(thruster);
  g.userData.thrusterMat = thrusterMat;

  return g;
}

export class CoasterGame extends BaseGame {
  constructor(ctx, options = {}) {
    super(ctx, options);
    this.id = 'coaster';
    this.title = 'ROLLER COASTER';
    this.subtitle = 'Lean & Swivel Hips Into Curves · Jump · Duck';
    this.phase = 'waiting';
    this.phaseTimer = 0;

    // Track progression & Physics
    this.u = 0;
    this.laps = 2;
    this.speed = 5.5; // Starts slow on chain-lift hill!
    this.targetSpeed = 5.5;
    this.lateral = 0;
    this.trackLength = 400;

    // Curve balancing & Derailment physics
    this.derailRisk = 0;      // 0 = balanced, 1.0 = catastrophic derailment!
    this.currentTurn = 0;     // signed lateral turn curvature
    this.playerBank = 0;      // combined torso lean + hip swivel
    this.cartRoll = 0;        // dynamic roll angle of cart
    this.cartTilt = 0;        // 2-wheel danger tilt when failing to balance
    this.balanceStatus = 'BALANCED';
    this.derailVel = new THREE.Vector3();
    this.derailRotVel = new THREE.Vector3();

    // Jump physics
    this.isJumping = false;
    this.jumpY = 0;
    this.jumpVy = 0;

    // Duck physics
    this.duckState = 0;

    // Scores & Entities
    this.coins = 0;
    this.maxCoins = 0;
    this.combo = 0;
    this.stage = 0;
    this.boosted = false;
    this.obstacles = [];     // overhead girders (DUCK)
    this.trackGaps = [];     // broken rail gaps (JUMP)
    this.gates = [];         // boost rings
    this.coinList = [];
    this.riders = [];
    this.results = [];
    this.lastRatchetSound = 0;
  }

  buildWorld() {
    this.env = buildCoasterWorld();
    this.scene = this.env.scene;
    this.curve = this.env.curve;
    this.trackLength = this.curve.getLength();
    this.cart = makeCart();
    this.env.scene.add(this.cart);

    // Floating Gold Coins placed along the dual rail path
    const coinGeo = new THREE.TorusGeometry(0.32, 0.09, 8, 20);
    const coinMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.95,
      metalness: 0.85,
      roughness: 0.2,
    });
    for (let i = 0; i < 48; i++) {
      const u = (i + 0.5) / 48;
      const p = this.curve.getPointAt(u % 1);
      const t = this.curve.getTangentAt(u % 1).normalize();
      const right = new THREE.Vector3().crossVectors(t, UP).normalize();
      const lateral = Math.sin(i * 2.8) * 0.72;
      const pos = p.clone().addScaledVector(right, lateral).addScaledVector(UP, 1.45);
      const mesh = new THREE.Mesh(coinGeo, coinMat);
      mesh.position.copy(pos);
      this.env.scene.add(mesh);
      this.coinList.push({ mesh, pos, u, collected: false });
    }
    this.maxCoins = this.coinList.length;

    // Boost Rings (Neon Cyan Torus Gates)
    for (let i = 0; i < 4; i++) {
      const u = 0.26 + i * 0.22;
      const p = this.curve.getPointAt(u);
      const t = this.curve.getTangentAt(u).normalize();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.2, 0.10, 8, 48),
        new THREE.MeshStandardMaterial({
          color: 0x22d3ee,
          emissive: 0x0891b2,
          emissiveIntensity: 1.2,
          roughness: 0.25,
        })
      );
      ring.position.copy(p).addScaledVector(UP, 1.55);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
      this.env.scene.add(ring);
      this.gates.push({ u, mesh: ring, passed: false });
    }

    // Overhead Warning Girders (DUCK HAZARDS)
    // Placed at thrilling high-speed locations: u = 0.36, 0.60, 0.78
    const duckU = [0.36, 0.60, 0.78];
    for (const u of duckU) {
      const p = this.curve.getPointAt(u);
      const t = this.curve.getTangentAt(u).normalize();
      const group = new THREE.Group();

      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(3.6, 0.26, 0.26),
        new THREE.MeshStandardMaterial({
          color: 0xf97316,
          emissive: 0x9a3412,
          emissiveIntensity: 0.9,
          metalness: 0.6,
          roughness: 0.35,
        })
      );
      beam.position.y = 1.85; // Low overhead clearance!
      group.add(beam);

      // Warning sign on beam
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.22, 0.04),
        new THREE.MeshBasicMaterial({ color: 0xfef08a })
      );
      sign.position.set(0, 1.85, 0.15);
      group.add(sign);

      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 2.0, 0.18),
          new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.4 })
        );
        leg.position.set(s * 1.8, 1.0, 0);
        group.add(leg);
      }

      group.position.copy(p);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
      this.env.scene.add(group);
      this.obstacles.push({ u, group, passed: false });
    }

    // Broken Track Gaps (JUMP HAZARDS)
    // Placed at u = 0.48 and u = 0.85
    const gapU = [0.48, 0.85];
    for (const u of gapU) {
      const p = this.curve.getPointAt(u);
      const t = this.curve.getTangentAt(u).normalize();
      const group = new THREE.Group();

      // Flashing red laser barrier across track gap
      const laser = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 2.4, 8),
        new THREE.MeshBasicMaterial({ color: 0xef4444 })
      );
      laser.rotation.z = Math.PI / 2;
      laser.position.y = 0.45;
      group.add(laser);

      for (const s of [-1, 1]) {
        const beacon = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.14, 0.7, 8),
          new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x991b1b, emissiveIntensity: 1.0 })
        );
        beacon.position.set(s * 1.25, 0.35, 0);
        group.add(beacon);
      }

      group.position.copy(p);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
      this.env.scene.add(group);
      this.trackGaps.push({ u, group, passed: false });
    }
  }

  start() {
    if (!this.players.length) {
      this.phase = 'waiting';
      this.message = 'WAVE TO JOIN';
      this.messageSub = 'Swivel hips into curves · Jump · Duck';
      return;
    }
    this.beginRide();
  }

  addPlayer(p) {
    super.addPlayer(p);
    if (this.phase === 'waiting' && this.players.length) this.start();
  }

  beginRide() {
    this.phase = 'ride';
    this.phaseTimer = 0;
    this.u = 0;
    this.speed = 5.5; // Initial slow chain-lift speed
    this.targetSpeed = 5.5;
    this.lateral = 0;
    this.derailRisk = 0;
    this.cartRoll = 0;
    this.cartTilt = 0;
    this.balanceStatus = 'BALANCED';
    this.isJumping = false;
    this.jumpY = 0;
    this.jumpVy = 0;
    this.coins = 0;
    this.combo = 0;
    this.stage = 0;
    this.boosted = false;
    this.results = [];

    this.coinList.forEach((c) => {
      c.collected = false;
      c.mesh.visible = true;
    });
    this.obstacles.forEach((o) => (o.passed = false));
    this.trackGaps.forEach((g) => (g.passed = false));
    this.gates.forEach((g) => (g.passed = false));

    this.riders = [];
    this.players.forEach((p, i) => {
      p.avatar.setVisible(true);
      p.avatar.setProp('none');
      p.avatar.seated = true;
      p.avatar.followStage = false;
      this.riders.push({ p, seat: SEATS[i % SEATS.length] });
    });

    this.message = 'CHAIN LIFT CLIMB';
    this.messageSub = 'Ascending to summit · Swivel hips into curves!';
    this.ctx.audio.play('bell');
  }

  update(dt) {
    this.time += dt;

    if (this.phase === 'waiting') {
      if (this.players.length) this.start();
      this.updateCamera();
      return;
    }

    for (const p of this.players) this.drain(p);

    if (this.phase === 'ride') {
      // 1. Gather player full-body inputs (Torso Lean, Hip Swivel, Jump, Duck, Arms Up)
      let lean = 0;
      let hipSwivel = 0;
      let arms = 0;
      let duck = 0;
      let jump = 0;
      let count = 0;

      for (const p of this.players) {
        if (!p.motion) continue;
        const s = p.motion.state || {};
        lean += finite(s.lean, 0);
        hipSwivel += finite(s.torsoTwist, 0);
        arms += finite(s.armsUp, 0);
        duck += finite(s.duck, 0);
        jump += finite(s.jump, 0);
        count++;
      }
      if (count > 0) {
        lean /= count;
        hipSwivel /= count;
        arms /= count;
        duck /= count;
        jump /= count;
      }

      this.playerBank = damp(this.playerBank, clamp(lean * 0.70 + hipSwivel * 0.45, -1.0, 1.0), 9, dt);
      this.lateral = damp(this.lateral, clamp(lean * 0.85, -0.85, 0.85), 6, dt);
      this.duckState = damp(this.duckState, duck, 10, dt);

      // 2. Parabolic Jump Physics (Magnetic Jump Thrusters over Broken Rail Gaps)
      if (jump > 0.32 && !this.isJumping) {
        this.isJumping = true;
        this.jumpVy = 5.2;
        this.ctx.audio.play('whistle');
        this.cart.userData.thrusterMat.emissiveIntensity = 1.6;
        this.fx.burst(this.cart.position, '#38bdf8', 18, { speed: 4.0, life: 0.45 });
      }
      if (this.isJumping) {
        this.jumpY += this.jumpVy * dt;
        this.jumpVy -= 12.5 * dt;
        if (this.jumpY <= 0) {
          this.jumpY = 0;
          this.jumpVy = 0;
          this.isJumping = false;
          this.cart.userData.thrusterMat.emissiveIntensity = 0.2;
          this.ctx.audio.play('stumble'); // hydraulic landing thump!
        }
      }

      // 3. Thrill Boost (Arms Raised Overhead)
      const boost = arms > 0.55;
      if (boost && !this.boosted) {
        this.ctx.audio.play('boost');
        this.message = '🚀 THRILL BOOST!';
        this.messageSub = 'Arms high in the air!';
      }
      this.boosted = boost;

      // 4. Speed Profile & Slow Start Chain-Lift Hill
      const uu = this.u % 1;
      const isChainLift = uu < 0.22 && Math.floor(this.u) === 0;
      const pCurrent = this.curve.getPointAt(uu);
      const tCurrent = this.curve.getTangentAt(uu).normalize();

      if (isChainLift) {
        // Slow mechanical chain-lift hill climbing up to 34m summit
        this.targetSpeed = 5.5 + arms * 2.5;
        if (this.time - this.lastRatchetSound > 0.28) {
          this.lastRatchetSound = this.time;
          this.ctx.audio.play('tick');
        }
        if (Math.floor(this.time * 2) % 2 === 0) {
          this.message = 'CHAIN LIFT CLIMB';
          this.messageSub = 'Summit in sight · Prepare for the Mega Drop!';
        }
      } else {
        // High-Speed Theme-Park Coaster Run (16 - 26 m/s) with gravity acceleration
        // Gravity acceleration: slope down increases speed, slope up slows down
        const slopeGain = -tCurrent.y * 12.0;
        this.targetSpeed = clamp(17.5 + slopeGain + (boost ? 6.5 : 0), 11.0, 27.5);
      }

      this.speed = damp(this.speed, this.targetSpeed, isChainLift ? 4.0 : 2.2, dt);
      const prevU = this.u;
      this.u += (this.speed * dt) / this.trackLength;
      if (!Number.isFinite(this.u)) this.u = 0;

      // Spin wheels with travel speed
      if (this.cart.userData.wheels) {
        for (const w of this.cart.userData.wheels) {
          w.rotation.x += dt * this.speed * 4.2;
        }
      }

      // 5. Centrifugal Curve Detection & Upper-Torso/Hip Swivel Balance
      const du = 0.006;
      const t0 = this.curve.getTangentAt((uu - du + 1) % 1).normalize();
      const t1 = this.curve.getTangentAt((uu + du) % 1).normalize();
      const dtVec = new THREE.Vector3().subVectors(t1, t0);
      const rightVec = new THREE.Vector3().crossVectors(tCurrent || UP, UP).normalize();
      const curveLateral = dtVec.dot(rightVec);
      this.currentTurn = curveLateral;

      const isSharpCurve = Math.abs(curveLateral) > 0.028;
      if (isSharpCurve && !isChainLift) {
        // Required banking direction to cancel centrifugal force
        // curveLateral > 0: turning right -> push is left -> player must lean right (+1)
        // curveLateral < 0: turning left -> push is right -> player must lean left (-1)
        const requiredBank = clamp(curveLateral * (this.speed / 12) * 2.2, -1.0, 1.0);
        const bankError = Math.abs(this.playerBank - requiredBank);

        if (bankError > 0.42 && this.speed > 12.0) {
          // Centrifugal tilt warning! Cart lifts onto 2 outer wheels!
          this.balanceStatus = 'TILT WARNING';
          this.cartTilt = damp(this.cartTilt, -Math.sign(requiredBank) * 0.38, 8, dt);
          this.derailRisk += dt * (bankError - 0.35) * (this.speed / 14) * 1.5;
          this.message = '⚠️ DANGER: LEAN INTO CURVE!';
          this.messageSub = requiredBank > 0 ? 'Swivel hips RIGHT! ➡' : '⬅ Swivel hips LEFT!';
          this.ctx.audio.play('tick');
          this.fx.burst(this.cart.position, '#ef4444', 6, { speed: 3.5, life: 0.3 });

          // Catastrophic Derailment Check!
          if (this.derailRisk >= 1.0) {
            this.#triggerDerailment(tCurrent, rightVec, requiredBank);
            return;
          }
        } else {
          // Perfect bank balance through curve
          this.balanceStatus = 'BALANCED';
          this.cartTilt = damp(this.cartTilt, 0, 10, dt);
          this.derailRisk = Math.max(0, this.derailRisk - dt * 2.4);
          this.coins += Math.floor(dt * 6);
          this.fx.burst(this.cart.position, '#22c55e', 2, { speed: 1.5, life: 0.2 });
        }
      } else {
        this.balanceStatus = 'BALANCED';
        this.cartTilt = damp(this.cartTilt, 0, 8, dt);
        this.derailRisk = Math.max(0, this.derailRisk - dt * 2.0);
      }

      // 6. Stage Progression
      const nextStage = Math.min(2, Math.floor((this.u % 1) * 3));
      if (nextStage !== this.stage) {
        this.stage = nextStage;
        const names = ['THE JUNGLE SUMMIT', 'ALPINE RIDGE', 'INFERNO HELIX'];
        this.message = names[this.stage];
        this.messageSub = this.stage === 2 ? 'Final stretch · Hold on tight!' : 'High-speed curves ahead!';
        this.ctx.audio.play('select');
      }

      // 7. Coin Collection
      const cartPos = this.cart.position;
      for (const c of this.coinList) {
        if (c.collected) continue;
        c.mesh.rotation.y += dt * 3.0;
        if (cartPos.distanceTo(c.pos) < 2.0) {
          c.collected = true;
          c.mesh.visible = false;
          this.coins += 1;
          this.ctx.audio.play('coin');
          this.fx.burst(c.pos, '#fbbf24', 16, { speed: 3.0, life: 0.5 });
        }
      }

      // 8. Boost Gates
      for (const g of this.gates) {
        if (g.passed) continue;
        if (prevU < g.u && this.u >= g.u) {
          g.passed = true;
          if (Math.abs(this.lateral) < 1.1) {
            this.coins += 3;
            this.message = 'BOOST GATE +3';
            this.messageSub = 'Clean racing line';
            this.ctx.audio.play('coin');
            this.fx.ring({ x: cartPos.x, y: cartPos.y + 1.2, z: cartPos.z }, '#22d3ee', 2.2, 0.5);
          }
        }
      }

      // 9. Overhead Clearance Girders (DUCK HAZARDS)
      for (const o of this.obstacles) {
        if (o.passed) continue;
        if (prevU < o.u && this.u >= o.u) {
          o.passed = true;
          if (this.duckState < 0.36) {
            this.speed *= 0.52;
            this.coins = Math.max(0, this.coins - 2);
            this.ctx.audio.play('stumble');
            this.ctx.engine.shake(0.45, 0.5);
            this.fx.burst(cartPos, '#f97316', 28, { speed: 5.5, life: 0.7 });
            this.message = '💥 OUCH! HEAD STRIKE';
            this.messageSub = 'Duck/crouch under overhead beams!';
          } else {
            this.coins += 2;
            this.message = '✓ PERFECT DUCK +2';
            this.messageSub = 'Clean clearance under beam';
            this.ctx.audio.play('select');
          }
        }
      }

      // 10. Broken Track Gaps (JUMP HAZARDS)
      for (const g of this.trackGaps) {
        if (g.passed) continue;
        if (prevU < g.u && this.u >= g.u) {
          g.passed = true;
          if (this.jumpY > 0.45) {
            this.coins += 5;
            this.message = '🚀 GAP JUMP CLEARED +5';
            this.messageSub = 'Magnetic jump thrusters engaged!';
            this.ctx.audio.play('whistle');
            this.fx.burst(cartPos, '#38bdf8', 24, { speed: 5.0, life: 0.6 });
          } else {
            this.speed *= 0.45;
            this.coins = Math.max(0, this.coins - 3);
            this.ctx.audio.play('stumble');
            this.ctx.engine.shake(0.55, 0.6);
            this.fx.burst(cartPos, '#ef4444', 32, { speed: 6.0, life: 0.8 });
            this.message = '⚠️ BROKEN RAIL IMPACT';
            this.messageSub = 'Jump vertically to trigger thrusters!';
          }
        }
      }

      // 11. Cart Position & Rail Alignment Physics (NO GROUND CLIPPING!)
      const p = this.curve.getPointAt(uu);
      const t = this.curve.getTangentAt(uu).normalize();
      const right = new THREE.Vector3().crossVectors(t, UP).normalize();
      const trackUp = new THREE.Vector3().crossVectors(right, t).normalize();

      // Offset along trackUp (+0.40m) ensures wheels sit exactly on top of rails
      this.cart.position.copy(p)
        .addScaledVector(trackUp, 0.40 + this.jumpY)
        .addScaledVector(right, this.lateral);

      const heading = Math.atan2(t.x, t.z);
      this.cart.rotation.order = 'YXZ';
      this.cart.rotation.y = heading;
      this.cart.rotation.x = -Math.asin(clamp(t.y, -1, 1));
      // Combined roll from curve banking + player body swivel + 2-wheel tilt warning
      this.cartRoll = -this.playerBank * 0.22 + this.cartTilt;
      this.cart.rotation.z = this.cartRoll;

      // 12. Position Riders On Top of Cart Seats (Moving and Swiveling with Body Motion)
      for (const r of this.riders) {
        const off = new THREE.Vector3(...r.seat).applyAxisAngle(UP, heading);
        const pos = this.cart.position.clone().add(off);
        this.place(r.p, pos.x, pos.z, {
          y: this.cart.position.y + 0.72 + (this.duckState > 0.35 ? -0.22 : 0),
          facing: heading,
          seated: true,
        });

        // Rider avatar rolls with the cart and leans with live body posture
        r.p.avatar.group.rotation.x = this.cart.rotation.x;
        r.p.avatar.group.rotation.z = this.cart.rotation.z;
      }

      if (this.u >= this.laps) this.endRide();
      this.updateCamera();

    } else if (this.phase === 'derailed') {
      // 13. Dynamic Derailment Crash Physics (Slow-mo tumble into space)
      this.phaseTimer -= dt;
      this.derailVel.y -= 14.0 * dt;
      this.cart.position.addScaledVector(this.derailVel, dt);
      this.cart.rotation.x += this.derailRotVel.x * dt;
      this.cart.rotation.y += this.derailRotVel.y * dt;
      this.cart.rotation.z += this.derailRotVel.z * dt;

      for (const r of this.riders) {
        this.place(r.p, this.cart.position.x, this.cart.position.z, {
          y: this.cart.position.y + 0.5,
          facing: this.cart.rotation.y,
          seated: false,
        });
        r.p.avatar.group.rotation.copy(this.cart.rotation);
      }

      if (this.phaseTimer <= 0) {
        this.beginRide();
      }
      this.updateCamera();

    } else if (this.phase === 'results') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this.beginRide();
      this.updateCamera();
    }
  }

  #triggerDerailment(t, right, bankDir) {
    this.phase = 'derailed';
    this.phaseTimer = 4.2;
    // Ejected outward by centrifugal force
    const outDir = bankDir > 0 ? -1 : 1;
    this.derailVel.copy(t).multiplyScalar(this.speed * 0.7)
      .addScaledVector(right, outDir * 8.5)
      .addScaledVector(UP, 5.2);
    this.derailRotVel.set((Math.random() - 0.5) * 5.0, (Math.random() - 0.5) * 4.0, 7.5);

    this.ctx.audio.play('stumble');
    this.ctx.engine.shake(0.7, 0.8);
    this.fx.burst(this.cart.position, '#ef4444', 45, { speed: 7.0, life: 1.2 });
    this.message = '💥 DERAILMENT CRASH!';
    this.messageSub = 'Cart flew off the rails! Swivel your hips into curves to stay balanced!';
  }

  endRide() {
    this.phase = 'results';
    this.phaseTimer = 9;
    this.message = '🏆 RIDE COMPLETE!';
    this.messageSub = `${this.coins} coins collected · Incredible balance!`;
    this.ctx.audio.play('cheer');
    this.fx.confetti(this.cart.position, 160);
    this.results = this.players.map((p, i) => ({
      id: p.key,
      name: p.name,
      color: p.color,
      time: null,
      rank: i + 1,
      detail: `${this.coins} coins · ${this.combo} combo`,
    }));
  }

  updateCamera() {
    if (!this.cart) return;

    if (this.phase === 'derailed') {
      // Cinematic crash chase camera
      const camPos = this.cart.position.clone().add(new THREE.Vector3(0, 4.0, 9.0));
      this.setCamera([camPos.x, camPos.y, camPos.z], [this.cart.position.x, this.cart.position.y, this.cart.position.z], 60);
      return;
    }

    const uu = (Number.isFinite(this.u) ? this.u : 0) % 1;
    const t = this.curve.getTangentAt(uu);
    if (!t) return;
    t.normalize();

    // High dynamic chase camera following cart angle and bank
    const pos = this.cart.position.clone()
      .addScaledVector(t, -8.2)
      .addScaledVector(UP, 3.8);
    const look = this.cart.position.clone()
      .addScaledVector(t, 5.0)
      .addScaledVector(UP, 1.1);

    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return;
    this.setCamera([pos.x, pos.y, pos.z], [look.x, look.y, look.z], 54);
  }

  getHud() {
    const players = this.players.map((p) => ({
      id: p.key,
      name: p.name,
      color: p.color,
      value: 0,
      max: 0,
      label: '',
      detail: 'RIDER',
      active: true,
    }));
    const stageNames = ['JUNGLE SUMMIT', 'ALPINE RIDGE', 'INFERNO HELIX'];

    return {
      title: this.title,
      subtitle: `${stageNames[this.stage]} · Lap ${Math.min(this.laps, Math.floor(finite(this.u)) + 1)}/${this.laps}`,
      phase: this.phase,
      timer: null,
      message: this.message,
      messageSub: this.messageSub,
      big: null,
      players,
      results: this.results,
      queue: [],
      score: `${this.coins} / ${this.maxCoins} coins · ${(this.speed * 3.6).toFixed(0)} km/h`,
      speed: this.speed,
      derailRisk: this.derailRisk,
      balanceStatus: this.balanceStatus,
    };
  }
}
