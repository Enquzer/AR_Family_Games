/** Particle bursts, confetti, splashes and expanding rings. */
import * as THREE from '/vendor/three/three.module.js';

let dotTexture = null;
function getDotTexture() {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  dotTexture = new THREE.CanvasTexture(c);
  return dotTexture;
}

const MAX = 900;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.positions = new Float32Array(MAX * 3);
    this.colors = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.gravity = new Float32Array(MAX);
    this.baseColor = new Float32Array(MAX * 3);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.14,
        map: getDotTexture(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      })
    );
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.rings = [];
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 0.72, 48),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.rings.push({ mesh: m, life: 0, max: 1, scale: 1 });
    }
    this.flash = 0;
  }

  burst(pos, color = '#22d3ee', count = 26, { speed = 4, gravity = -9, life = 0.8, spread = 1, up = 0.3 } = {}) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this.positions[idx * 3] = pos.x + Math.cos(a) * r * 0.2;
      this.positions[idx * 3 + 1] = pos.y + Math.random() * 0.2;
      this.positions[idx * 3 + 2] = pos.z + Math.sin(a) * r * 0.2;
      const s = speed * (0.35 + Math.random() * 0.9);
      this.vel[idx * 3] = Math.cos(a) * s * 0.55;
      this.vel[idx * 3 + 1] = s * (0.5 + Math.random()) + up * 3;
      this.vel[idx * 3 + 2] = Math.sin(a) * s * 0.55;
      this.life[idx] = this.maxLife[idx] = life * (0.6 + Math.random() * 0.7);
      this.gravity[idx] = gravity;
      const tint = c.clone().offsetHSL((Math.random() - 0.5) * 0.08, 0, (Math.random() - 0.5) * 0.25);
      this.baseColor[idx * 3] = tint.r;
      this.baseColor[idx * 3 + 1] = tint.g;
      this.baseColor[idx * 3 + 2] = tint.b;
      this.colors[idx * 3] = tint.r;
      this.colors[idx * 3 + 1] = tint.g;
      this.colors[idx * 3 + 2] = tint.b;
    }
  }

  confetti(pos, count = 90) {
    const cols = ['#22d3ee', '#f472b6', '#fbbf24', '#a3e635', '#a78bfa', '#ffffff'];
    for (let i = 0; i < count; i++) {
      const color = cols[Math.floor(Math.random() * cols.length)];
      this.burst(
        { x: pos.x + (Math.random() - 0.5) * 8, y: pos.y + 3 + Math.random() * 3, z: pos.z + (Math.random() - 0.5) * 8 },
        color,
        1,
        { speed: 2.2, gravity: -3.2, life: 2.4, spread: 1.5, up: 0.5 }
      );
    }
  }

  splash(pos, color = '#67e8f9', count = 30) {
    this.burst(pos, color, count, { speed: 3.4, gravity: -11, life: 0.7, spread: 1.2, up: 0.8 });
  }

  ring(pos, color = '#22d3ee', scale = 1.6, life = 0.55) {
    const r = this.rings.find((x) => x.life <= 0);
    if (!r) return;
    r.mesh.position.set(pos.x, (pos.y || 0) + 0.03, pos.z);
    r.mesh.material.color.set(color);
    r.mesh.material.opacity = 0.9;
    r.mesh.scale.setScalar(0.2);
    r.mesh.visible = true;
    r.life = r.max = life;
    r.scale = scale;
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.colors[i * 3] = this.colors[i * 3 + 1] = this.colors[i * 3 + 2] = 0;
        continue;
      }
      this.vel[i * 3 + 1] += this.gravity[i] * dt;
      this.positions[i * 3] += this.vel[i * 3] * dt;
      this.positions[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = Math.min(1, this.life[i] / (this.maxLife[i] * 0.7));
      this.colors[i * 3] = this.baseColor[i * 3] * f;
      this.colors[i * 3 + 1] = this.baseColor[i * 3 + 1] * f;
      this.colors[i * 3 + 2] = this.baseColor[i * 3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - r.life / r.max;
      r.mesh.scale.setScalar(0.2 + t * r.scale);
      r.mesh.material.opacity = (1 - t) * 0.9;
      if (r.life <= 0) r.mesh.visible = false;
    }
    this.flash = Math.max(0, this.flash - dt * 2);
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.points.removeFromParent();
    for (const r of this.rings) {
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
      r.mesh.removeFromParent();
    }
  }
}
