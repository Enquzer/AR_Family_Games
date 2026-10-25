/** Roller coaster: cooperative ride. Lean to steer, arms up to boost, duck to survive. */
import * as THREE from '/vendor/three/three.module.js';
import { BaseGame } from './base.js';
import { buildCoasterWorld } from '../engine/environments.js';
import { clamp, damp, finite } from '../shared/math.js';

const UP = new THREE.Vector3(0, 1, 0);
const SEATS = [
  [-0.55, 0.55, 0.55],
  [0.55, 0.55, 0.55],
  [-0.55, 0.55, -0.45],
  [0.55, 0.55, -0.45],
];

function makeCart() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.6, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b1220, metalness: 0.7, roughness: 0.35 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.45, 3.4), bodyMat);
  base.position.y = 0.35;
  base.castShadow = true;
  g.add(base);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.4, 4), bodyMat);
  nose.rotation.x = Math.PI / 2;
  nose.rotation.y = Math.PI / 4;
  nose.position.set(0, 0.4, 2.2);
  nose.scale.set(1.35, 1, 0.55);
  g.add(nose);
  for (const [x, z] of [[-0.55, 0.55], [0.55, 0.55], [-0.55, -0.45], [0.55, -0.45]]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.18, 0.75), dark);
    seat.position.set(x, 0.65, z);
    g.add(seat);
    // Low seat backs: tall ones hid the seated avatars from the chase camera.
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.32, 0.12), dark);
    back.position.set(x, 0.82, z - 0.38);
    g.add(back);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 0.12), new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.7, roughness: 0.3 }));
  bar.position.set(0, 1.05, 0.1);
  g.add(bar);
  const light = new THREE.PointLight(0xffd28a, 14, 16, 2);
  light.position.set(0, 1.1, 2.4);
  g.add(light);
  const headlight = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff3c4 })
  );
  headlight.position.set(0, 0.5, 2.9);
  g.add(headlight);
  for (const x of [-0.95, 0.95]) {
    for (const z of [-0.9, 0.9]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 12), dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.18, z);
      g.add(wheel);
    }
  }
  return g;
}

export class CoasterGame extends BaseGame {
  constructor(ctx, options = {}) {
    super(ctx, options);
    this.id = 'coaster';
    this.title = 'ROLLER COASTER';
    this.subtitle = 'Lean to steer · arms up to boost · duck';
    this.phase = 'waiting';
    this.phaseTimer = 0;
    this.u = 0;
    this.laps = 2;
    this.speed = 8;
    this.lateral = 0;
    this.coins = 0;
    this.maxCoins = 0;
    this.stage = 0;
    this.duckState = 0;
    this.boosted = false;
    this.obstacles = [];
    this.gates = [];
    this.coinList = [];
    this.riders = [];
    this.results = [];
    this.airtime = 0;
  }

  buildWorld() {
    this.env = buildCoasterWorld();
    this.curve = this.env.curve;
    this.trackLength = this.curve.getLength();
    this.cart = makeCart();
    this.env.scene.add(this.cart);

    const coinGeo = new THREE.TorusGeometry(0.3, 0.09, 8, 18);
    const coinMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 0.9, metalness: 0.8, roughness: 0.25 });
    for (let i = 0; i < 40; i++) {
      const u = (i + 0.6) / 40;
      const p = this.curve.getPointAt(u % 1);
      const t = this.curve.getTangentAt(u % 1).normalize();
      const right = new THREE.Vector3().crossVectors(t, UP).normalize();
      const lateral = Math.sin(i * 2.7) * 0.75;
      const pos = p.clone().addScaledVector(right, lateral).addScaledVector(UP, 1.3);
      const mesh = new THREE.Mesh(coinGeo, coinMat);
      mesh.position.copy(pos);
      this.env.scene.add(mesh);
      this.coinList.push({ mesh, pos, u, collected: false });
    }
    this.maxCoins = this.coinList.length;

    for (let i = 0; i < 3; i++) {
      const u = 0.2 + i * 0.26;
      const p = this.curve.getPointAt(u);
      const t = this.curve.getTangentAt(u).normalize();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.0, 0.09, 8, 48),
        new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0891b2, emissiveIntensity: 1.1, roughness: 0.3 })
      );
      ring.position.copy(p).addScaledVector(UP, 1.4);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
      this.env.scene.add(ring);
      this.gates.push({ u, mesh: ring, passed: false });
    }

    for (let i = 0; i < 6; i++) {
      const u = 0.11 + i * 0.145;
      const p = this.curve.getPointAt(u);
      const t = this.curve.getTangentAt(u).normalize();
      const right = new THREE.Vector3().crossVectors(t, UP).normalize();
      const group = new THREE.Group();
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(3.4, 0.22, 0.22),
        new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0x7c2d12, emissiveIntensity: 0.8, metalness: 0.5, roughness: 0.4 })
      );
      beam.position.y = 1.8;
      group.add(beam);
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 1.9, 0.16),
          new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.6, roughness: 0.4 })
        );
        leg.position.set(s * 1.7, 0.95, 0);
        group.add(leg);
      }
      group.position.copy(p);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
      this.env.scene.add(group);
      this.obstacles.push({ u, group, passed: false });
    }
  }

  start() {
    if (!this.players.length) {
      this.phase = 'waiting';
      this.message = 'WAVE TO JOIN';
      this.messageSub = 'Lean, raise your arms, duck';
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
    this.speed = 8;
    this.lateral = 0;
    this.coins = 0;
    this.stage = 0;
    this.airtime = 0;
    this.boosted = false;
    this.results = [];
    this.coinList.forEach((c) => {
      c.collected = false;
      c.mesh.visible = true;
    });
    this.obstacles.forEach((o) => (o.passed = false));
    this.gates.forEach((g) => (g.passed = false));
    this.riders = [];
    this.players.forEach((p, i) => {
      p.avatar.setVisible(true);
      p.avatar.setProp('none');
      p.avatar.seated = true;
      p.avatar.followStage = false;
      this.riders.push({ p, seat: SEATS[i % SEATS.length] });
    });
    this.message = 'ALL ABOARD';
    this.messageSub = 'Lean to steer · arms up to boost';
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
      let lean = 0;
      let arms = 0;
      let duck = 0;
      let count = 0;
      for (const p of this.players) {
        if (!p.motion) continue;
        lean += finite(p.motion.lean);
        arms += finite(p.motion.armsUp);
        duck += finite(p.motion.duck);
        count++;
      }
      if (count) {
        lean /= count;
        arms /= count;
        duck /= count;
      }
      this.lateral = damp(this.lateral, clamp(lean * 0.95, -0.9, 0.9), 4, dt);
      this.duckState = damp(this.duckState, duck, 8, dt);

      const boost = arms > 0.55;
      if (boost && !this.boosted) {
        this.ctx.audio.play('boost');
        this.message = 'BOOST!';
        this.messageSub = 'Arms up!';
      }
      this.boosted = boost;
      const targetSpeed = 9 + arms * 7.5 + Math.sin(this.time * 0.7) * 0.8;
      this.speed = damp(finite(this.speed, 8), targetSpeed, 2.4, dt);
      const prevU = this.u;
      this.u += (this.speed * dt) / this.trackLength;
      if (!Number.isFinite(this.u)) this.u = 0;

      const nextStage = Math.min(2, Math.floor((this.u % 1) * 3));
      if (nextStage !== this.stage) {
        this.stage = nextStage;
        const names = ['THE JUNGLE', 'THE RIDGE', 'THE INFERNO'];
        this.message = names[this.stage];
        this.messageSub = this.stage === 2 ? 'Final stretch!' : 'Keep going!';
        this.ctx.audio.play('select');
      }

      // collect coins
      const cartPos = this.cart.position;
      for (const c of this.coinList) {
        if (c.collected) continue;
        c.mesh.rotation.y += dt * 2.5;
        c.mesh.rotation.x += dt * 1.1;
        if (cartPos.distanceTo(c.pos) < 1.7) {
          c.collected = true;
          c.mesh.visible = false;
          this.coins++;
          this.ctx.audio.play('coin');
          this.fx.burst(c.pos, '#fbbf24', 14, { speed: 2.5, life: 0.5 });
        }
      }

      // gates
      for (const g of this.gates) {
        if (g.passed) continue;
        const crossed = prevU < g.u && this.u >= g.u;
        if (crossed) {
          g.passed = true;
          if (Math.abs(this.lateral) < 1.2) {
            this.coins += 3;
            this.message = 'GATE +3';
            this.messageSub = 'Perfect line';
            this.ctx.audio.play('coin');
            this.fx.ring({ x: cartPos.x, y: cartPos.y + 1.2, z: cartPos.z }, '#22d3ee', 2, 0.5);
          } else {
            this.message = 'MISSED GATE';
            this.messageSub = 'Lean into the ring';
          }
        }
      }

      // obstacles
      for (const o of this.obstacles) {
        if (o.passed) continue;
        if (prevU < o.u && this.u >= o.u) {
          o.passed = true;
          if (this.duckState < 0.35) {
            this.speed *= 0.55;
            this.ctx.audio.play('stumble');
            this.ctx.engine.shake(0.4, 0.5);
            this.fx.burst(cartPos, '#f97316', 26, { speed: 5, life: 0.7 });
            this.message = 'OUCH! DUCK NEXT TIME';
            this.messageSub = 'Crouch as you pass under the bar';
          } else {
            this.coins += 2;
            this.message = 'NICE DUCK +2';
            this.messageSub = '';
            this.ctx.audio.play('select');
          }
        }
      }

      // park position
      const uu = this.u % 1;
      const p = this.curve.getPointAt(uu);
      const t = this.curve.getTangentAt(uu).normalize();
      const right = new THREE.Vector3().crossVectors(t, UP).normalize();
      this.cart.position.copy(p).addScaledVector(right, this.lateral);
      const heading = Math.atan2(t.x, t.z);
      this.cart.rotation.order = 'YXZ';
      this.cart.rotation.y = heading;
      this.cart.rotation.x = -Math.asin(clamp(t.y, -1, 1)) * 0.7;
      this.cart.rotation.z = -this.lateral * 0.08;

      // riders
      for (const r of this.riders) {
        const off = new THREE.Vector3(...r.seat).applyAxisAngle(UP, heading);
        const pos = this.cart.position.clone().add(off);
        this.place(r.p, pos.x, pos.z, { y: this.cart.position.y + 0.15, facing: heading, seated: true });
      }

      if (this.u >= this.laps) this.endRide();
      this.updateCamera();
    } else if (this.phase === 'results') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this.beginRide();
      this.updateCamera();
    }
  }

  endRide() {
    this.phase = 'results';
    this.phaseTimer = 9;
    this.message = 'RIDE COMPLETE';
    this.messageSub = `${this.coins} coins collected`;
    this.ctx.audio.play('cheer');
    this.fx.confetti(this.cart.position, 140);
    this.results = this.players.map((p, i) => ({
      id: p.key,
      name: p.name,
      color: p.color,
      time: null,
      rank: i + 1,
      detail: `${this.coins} coins`,
    }));
  }

  updateCamera() {
    if (!this.cart) return;
    const uu = (Number.isFinite(this.u) ? this.u : 0) % 1;
    const t = this.curve.getTangentAt(uu);
    if (!t) return;
    t.normalize();
    const pos = this.cart.position.clone().addScaledVector(t, -8.5).addScaledVector(UP, 4.3);
    const look = this.cart.position.clone().addScaledVector(t, 5.5).addScaledVector(UP, 1.25);
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return;
    this.setCamera([pos.x, pos.y, pos.z], [look.x, look.y, look.z], 55);
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
    const stageNames = ['JUNGLE', 'RIDGE', 'INFERNO'];
    return {
      title: this.title,
      subtitle: `${stageNames[this.stage]} · lap ${Math.min(this.laps, Math.floor(finite(this.u)) + 1)}/${this.laps}`,
      phase: this.phase,
      timer: null,
      message: this.message,
      messageSub: this.messageSub,
      big: null,
      players,
      results: this.results,
      queue: [],
      score: `${this.coins} / ${this.maxCoins} coins`,
      speed: this.speed,
    };
  }
}
