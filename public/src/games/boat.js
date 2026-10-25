/** Rowing race: row with your arms, lean to steer, first across the lake. */
import * as THREE from '/vendor/three/three.module.js';
import { BaseGame } from './base.js';
import { buildLake } from '../engine/environments.js';
import { clamp, damp, finite } from '../shared/math.js';

const DISTANCE = 190;
const LANE_GAP = 4.4;

function makeBoat(color) {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.5, metalness: 0.5 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.5, 1.15), hullMat);
  hull.position.y = 0.28;
  hull.castShadow = true;
  g.add(hull);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.4, 4), hullMat);
  nose.rotation.z = -Math.PI / 2;
  nose.rotation.y = Math.PI / 4;
  nose.position.set(2.0, 0.3, 0);
  nose.scale.z = 0.85;
  g.add(nose);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 1.0), darkMat);
  seat.position.set(-0.4, 0.55, 0);
  g.add(seat);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 1.18), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }));
  stripe.position.set(0.1, 0.52, 0);
  g.add(stripe);
  const wake = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1.8),
    new THREE.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide })
  );
  wake.rotation.x = -Math.PI / 2;
  wake.position.set(-2.3, 0.02, 0);
  g.add(wake);
  const oars = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.1, 0.5, side * 0.5);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.6, 6), darkMat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = side * 1.2;
    pivot.add(shaft);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.7), new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.5 }));
    blade.position.z = side * 2.4;
    pivot.add(blade);
    g.add(pivot);
    oars.push({ pivot, side });
  }
  g.userData.oars = oars;
  return g;
}

export class BoatGame extends BaseGame {
  constructor(ctx, options = {}) {
    super(ctx, options);
    this.id = 'boat';
    this.title = 'ROWING';
    this.subtitle = 'Row with both arms, lean to steer';
    this.phase = 'waiting';
    this.phaseTimer = 0;
    this.raceTime = 0;
    this.states = new Map();
    this.boats = new Map();
    this.finishOrder = [];
    this.firstFinishAt = 0;
    this.results = [];
    this.checkpoint = 0;
    this.splashTimers = new Map();
  }

  buildWorld() {
    this.env = buildLake();
    const bannerTex = this.#bannerTexture();
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 2.6),
      new THREE.MeshStandardMaterial({ map: bannerTex, emissive: 0x1a3a4a, emissiveIntensity: 0.5, side: THREE.DoubleSide })
    );
    banner.position.set(DISTANCE + 2, 4.5, 0);
    this.env.scene.add(banner);
    for (const z of [-9, 9]) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 4.5, 8),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.6, roughness: 0.4 })
      );
      pole.position.set(DISTANCE + 2, 2.25, z);
      this.env.scene.add(pole);
    }
  }

  #bannerTexture() {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 160;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, 1024, 160);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 7;
    ctx.strokeRect(5, 5, 1014, 150);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 78px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FINISH', 512, 84);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  start() {
    if (!this.players.length) {
      this.phase = 'waiting';
      this.message = 'WAVE TO JOIN';
      this.messageSub = 'Row with both arms';
      return;
    }
    this.beginRace();
  }

  addPlayer(p) {
    super.addPlayer(p);
    if (this.phase === 'waiting' && this.players.length) this.start();
  }

  beginRace() {
    this.phase = 'intro';
    this.phaseTimer = 4.2;
    this.raceTime = 0;
    this.finishOrder = [];
    this.firstFinishAt = 0;
    this.results = [];
    this.checkpoint = 0;
    for (const boat of this.boats.values()) boat.group.removeFromParent();
    this.boats.clear();
    this.states.clear();
    const n = this.players.length;
    this.players.forEach((p, i) => {
      const laneZ = n === 1 ? 0 : (i - (n - 1) / 2) * LANE_GAP;
      const boat = makeBoat(p.color);
      boat.position.set(-2, 0, laneZ);
      this.env.scene.add(boat);
      this.boats.set(p.key, { group: boat, oars: boat.userData.oars });
      this.states.set(p.key, {
        x: 0,
        speed: 0,
        laneZ,
        baseZ: laneZ,
        z: laneZ,
        phase: Math.random() * Math.PI * 2,
        finished: false,
        time: null,
        rank: null,
      });
      p.avatar.setVisible(true);
      p.avatar.setProp('none');
      p.avatar.seated = true;
      p.avatar.followStage = false;
      p.avatar.group.position.set(0, 0.55, laneZ);
    });
    this.message = 'ROW!';
    this.messageSub = 'Pull both arms back together';
    this.ctx.audio.play('whistle');
  }

  update(dt) {
    this.time += dt;
    this.phaseTimer -= dt;
    if (this.phase === 'waiting') {
      if (this.players.length) this.start();
      this.updateCamera();
      return;
    }

    for (const p of this.players) {
      const s = this.states.get(p.key);
      if (!s) continue;
      const events = this.drain(p);
      for (const e of events) {
        if (e.type === 'stroke' && this.phase === 'race') {
          s.speed += 0.7 + e.power * 0.9;
          this.ctx.audio.play('splash');
          this.fx.splash({ x: s.x - 1.8, y: 0.1, z: s.z }, '#a5f3fc', 8);
        }
      }
    }

    if (this.phase === 'intro') {
      this.messageSub = this.phaseTimer > 1 ? `${Math.max(1, Math.ceil(this.phaseTimer - 1))}` : 'ROW!';
      if (this.phaseTimer <= 1) {
        this.phase = 'race';
        this.raceTime = 0;
        this.message = 'GO!';
        this.messageSub = '';
        this.ctx.audio.play('go');
      }
      this.updateBoats(dt, true);
      this.updateCamera();
      return;
    }

    if (this.phase === 'race') {
      this.raceTime += dt;
      this.updateBoats(dt, false);
      const cp = this.checkpoint;
      const lead = Math.max(...[...this.states.values()].map((s) => s.x));
      if (lead > DISTANCE / 3 && cp < 1) {
        this.checkpoint = 1;
        this.message = 'ONE THIRD';
        this.messageSub = 'Keep the rhythm';
      } else if (lead > (DISTANCE * 2) / 3 && cp < 2) {
        this.checkpoint = 2;
        this.message = 'FINAL THIRD';
        this.messageSub = 'Sprint to the finish';
      }
      if ([...this.states.values()].every((s) => s.finished) || (this.firstFinishAt && this.raceTime - this.firstFinishAt > 10)) {
        this.endRace();
      }
      this.updateCamera();
      return;
    }

    if (this.phase === 'results') {
      this.updateBoats(dt, true);
      if (this.phaseTimer <= 0) this.beginRace();
      this.updateCamera();
    }
  }

  updateBoats(dt, frozen) {
    for (const p of this.players) {
      const s = this.states.get(p.key);
      const boat = this.boats.get(p.key);
      if (!s || !boat) continue;

      const rowPower = finite(p.motion.rowPower);
      const lean = finite(p.motion.lean);

      if (!frozen && !s.finished) {
        // continuous pull + stroke impulses
        s.speed += rowPower * 12 * dt;
        s.speed *= Math.exp(-0.62 * dt);
        s.speed = clamp(s.speed, 0, 13);
        s.x += s.speed * dt;
        const targetZ = s.baseZ + clamp(lean * 1.7, -1.7, 1.7);
        s.z = damp(s.z, targetZ, 3, dt);
        if (s.x >= DISTANCE) {
          s.x = DISTANCE;
          s.finished = true;
          s.time = this.raceTime;
          s.rank = this.finishOrder.length + 1;
          this.finishOrder.push(p.key);
          if (!this.firstFinishAt) this.firstFinishAt = this.raceTime;
          this.ctx.audio.play('cheer');
          this.fx.confetti({ x: DISTANCE, y: 2, z: s.z }, 40);
        }
      } else {
        s.speed = damp(s.speed, 0, 2, dt);
      }

      s.phase += (0.7 + s.speed * 0.55 + rowPower * 5) * dt;
      boat.group.position.set(s.x - 2, 0.02 + Math.sin(s.phase) * 0.02, s.z);
      boat.group.rotation.z = Math.sin(s.phase * 0.5) * 0.015;
      boat.group.rotation.x = Math.sin(s.phase) * 0.01;
      for (const oar of boat.oars) {
        oar.pivot.rotation.y = Math.sin(s.phase) * 0.45 * oar.side;
        oar.pivot.rotation.z = Math.sin(s.phase + 1.2) * 0.12;
      }

      const facing = Math.PI / 2;
      this.place(p, s.x - 2.2, s.z, { y: 0.55, facing, seated: true });
      p.avatar.group.rotation.z = Math.sin(s.phase) * 0.02;
      if (s.speed > 2) {
        const t = (this.splashTimers.get(p.key) || 0) - dt;
        if (t <= 0) {
          this.splashTimers.set(p.key, 0.12);
          this.fx.splash({ x: s.x - 4.2, y: 0.05, z: s.z }, '#67e8f9', 2);
        } else this.splashTimers.set(p.key, t);
      }
    }
  }

  endRace() {
    if (this.phase !== 'race') return;
    this.phase = 'results';
    this.phaseTimer = 8;
    const order = [...this.players]
      .map((p) => ({ p, s: this.states.get(p.key) }))
      .sort((a, b) => {
        if (a.s.finished && b.s.finished) return a.s.time - b.s.time;
        if (a.s.finished) return -1;
        if (b.s.finished) return 1;
        return b.s.x - a.s.x;
      });
    order.forEach((o, i) => (o.s.rank = i + 1));
    this.results = order.map((o) => ({
      id: o.p.key,
      name: o.p.name,
      color: o.p.color,
      time: o.s.time,
      rank: o.s.rank,
    }));
    this.message = 'RACE COMPLETE';
    this.messageSub = `${this.results[0]?.name || ''} takes the win`;
    this.ctx.audio.play('bell');
    this.fx.confetti({ x: DISTANCE, y: 3, z: 0 }, 120);
  }

  updateCamera() {
    let lead = 0;
    for (const s of this.states.values()) lead = Math.max(lead, finite(s.x));
    const camX = clamp(lead + 8, 8, DISTANCE + 8);
    this.setCamera([camX, 4.6, 17], [camX - 4, 0.9, 0]);
  }

  getHud() {
    const list = this.players.map((p) => {
      const s = this.states.get(p.key) || { x: 0, speed: 0, time: null, rank: null };
      return {
        id: p.key,
        name: p.name,
        color: p.color,
        value: clamp(finite(s.x), 0, DISTANCE),
        max: DISTANCE,
        label: 'm',
        detail: s.finished && s.time != null ? `${s.time.toFixed(2)}s` : `${(finite(s.speed) * 1.94).toFixed(0)} kn`,
        rank: s.rank,
        active: true,
      };
    });
    return {
      title: this.title,
      subtitle: 'First to the finish line',
      phase: this.phase,
      timer: this.phase === 'race' ? this.raceTime : null,
      message: this.message,
      messageSub: this.messageSub,
      big: this.phase === 'intro' ? { text: this.phaseTimer > 1 ? `${Math.max(1, Math.ceil(this.phaseTimer - 1))}` : 'ROW!', sub: 'ROWING RACE' } : null,
      players: list,
      results: this.results,
      queue: [],
    };
  }

  dispose() {
    for (const b of this.boats.values()) b.group.removeFromParent();
    super.dispose();
  }
}
