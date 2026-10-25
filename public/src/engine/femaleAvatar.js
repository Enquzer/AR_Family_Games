/**
 * Dedicated Female Dance Coach Avatar.
 * 
 * Features:
 * - Feminine athletic dancer silhouette: contoured hourglass torso, tapered waist, feminine hip span.
 * - Dynamic high-ponytail hairstyle with multi-joint momentum & bounce physics responding to beat movements.
 * - Stage dancer outfit: iridescent halter sports crop top, high-waist dance leggings with neon contour stripes.
 * - Glamorous dancer hoop earrings, stage DJ headphones with microphone boom, neon dance wristbands, and glowing sneakers.
 * - Full 17-joint skeletal chain with Two-Bone IK for legs and smooth kinematic target driving.
 */
import * as THREE from '/vendor/three/three.module.js';
import { clamp, damp } from '../shared/math.js';

const UP = new THREE.Vector3(0, 1, 0);
const POLE_FORWARD = new THREE.Vector3(0, 0.2, 0.98).normalize();
const _dir = new THREE.Vector3();

function solveTwoBoneIK(root, target, pole, l1, l2, outKnee) {
  const toTarget = new THREE.Vector3().subVectors(target, root);
  const totalL = l1 + l2;
  const d = Math.max(0.01, Math.min(totalL - 0.002, toTarget.length()));
  const dir = toTarget.normalize();

  const cosAlpha = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinAlpha = Math.sqrt(Math.max(0, 1 - cosAlpha * cosAlpha));

  const planeNormal = new THREE.Vector3().crossVectors(dir, pole);
  if (planeNormal.lengthSq() < 1e-4) {
    planeNormal.set(1, 0, 0);
  } else {
    planeNormal.normalize();
  }
  const bendPerp = new THREE.Vector3().crossVectors(planeNormal, dir).normalize();

  outKnee.copy(root)
    .addScaledVector(dir, l1 * cosAlpha)
    .addScaledVector(bendPerp, l1 * sinAlpha);

  return outKnee;
}

function makeLimb(material, radius) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1), material);
  mesh.userData.radius = radius;
  mesh.castShadow = true;
  return mesh;
}

function placeLimb(mesh, a, b, radius) {
  _dir.subVectors(b, a);
  const len = Math.max(_dir.length(), 0.001);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, _dir.multiplyScalar(1 / len));
  mesh.scale.set(radius, len, radius);
}

export class FemaleCoachAvatar {
  constructor(options = {}) {
    this.name = options.name || 'CHAMPION COACH';
    this.colorHex = options.color || '#f472b6';
    this.color = new THREE.Color(this.colorHex);

    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);

    this.facing = 0;
    this.facingTarget = 0;
    this.seated = false;
    this.online = true;
    this.active = true;

    // Joint positions & targets
    this.joints = {};
    this.target = {};
    for (const k of [
      'hip', 'neck', 'head', 'shL', 'shR', 'elL', 'elR',
      'wrL', 'wrR', 'hipL', 'hipR', 'knL', 'knR', 'anL', 'anR', 'ftL', 'ftR'
    ]) {
      this.joints[k] = new THREE.Vector3();
      this.target[k] = new THREE.Vector3();
    }

    // --- MATERIALS ---
    // Metallic iridescent dance crop top
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = 256;
    cropCanvas.height = 256;
    const ctx = cropCanvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#f43f5e');
    grad.addColorStop(0.5, '#ec4899');
    grad.addColorStop(1, '#8b5cf6');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    // Audio soundwave equalizer bars on chest
    const barWidth = 12;
    const heights = [30, 70, 110, 85, 125, 75, 100, 50, 115, 60];
    for (let i = 0; i < heights.length; i++) {
      ctx.fillStyle = i % 2 ? '#22d3ee' : '#ffffff';
      ctx.fillRect(36 + i * 18, 145 - heights[i], barWidth, heights[i]);
    }
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★ COACH VIP ★', 128, 185);

    this.topTexture = new THREE.CanvasTexture(cropCanvas);
    this.topTexture.colorSpace = THREE.SRGBColorSpace;

    this.topMat = new THREE.MeshStandardMaterial({
      map: this.topTexture,
      roughness: 0.28,
      metalness: 0.8,
      emissive: new THREE.Color(0x3b0764),
      emissiveIntensity: 0.7,
    });

    // Sleek high-waist dance leggings
    this.leggingsMat = new THREE.MeshStandardMaterial({
      color: 0x0f0720,
      roughness: 0.35,
      metalness: 0.65,
    });

    // Athletic feminine skin / mesh tone
    this.skinMat = new THREE.MeshStandardMaterial({
      color: 0x221338,
      roughness: 0.5,
      metalness: 0.3,
      emissive: this.color.clone().multiplyScalar(0.08),
    });

    // Vibrant neon accents (visor, earrings, wristbands)
    this.neonMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x22d3ee,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });

    this.magentaMat = new THREE.MeshStandardMaterial({
      color: 0xf472b6,
      emissive: 0xf472b6,
      emissiveIntensity: 1.8,
      roughness: 0.25,
    });

    this.hairMat = new THREE.MeshStandardMaterial({
      color: 0x0a0514,
      roughness: 0.45,
      metalness: 0.7,
    });

    // --- MESH HIERARCHY ---
    // 1. Torso: Tapered feminine hourglass shape
    this.torso = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.05, 1, 16), this.topMat);
    this.torso.castShadow = true;
    this.body.add(this.torso);

    this.chest = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.16, 0.17), this.topMat);
    this.chest.castShadow = true;
    this.body.add(this.chest);

    // 2. Head, Ponytail & Accessories
    this.headGroup = new THREE.Group();
    this.body.add(this.headGroup);

    this.headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.108, 20, 16), this.skinMat);
    this.headMesh.scale.set(0.96, 1.15, 1.0);
    this.headMesh.castShadow = true;
    this.headGroup.add(this.headMesh);

    // Chic swept-back hair cap
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.114, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), this.hairMat);
    hairCap.rotation.x = -0.25;
    this.headGroup.add(hairCap);

    // Dynamic High-Ponytail with Hair Physics
    this.ponytailGroup = new THREE.Group();
    this.ponytailGroup.position.set(0, 0.08, -0.11);
    this.headGroup.add(this.ponytailGroup);

    // Ponytail base scrunchie band
    const scrunchie = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.012, 8, 16), this.magentaMat);
    this.ponytailGroup.add(scrunchie);

    // Segmented flowing ponytail locks
    this.ponytailSegments = [];
    let parentNode = this.ponytailGroup;
    for (let s = 0; s < 3; s++) {
      const segGroup = new THREE.Group();
      segGroup.position.set(0, -0.065, -0.035);
      const rad = 0.024 - s * 0.005;
      const segMesh = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 0.75, 0.11, 8), this.hairMat);
      segMesh.position.y = -0.055;
      segGroup.add(segMesh);
      parentNode.add(segGroup);
      this.ponytailSegments.push(segGroup);
      parentNode = segGroup;
    }
    this.hairVel = new THREE.Vector3();
    this.hairAngle = 0;

    // Glowing Hoop Earrings
    for (const sx of [-0.125, 0.125]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.005, 8, 24), this.neonMat);
      hoop.position.set(sx, -0.01, 0.01);
      hoop.rotation.y = Math.PI / 2;
      this.headGroup.add(hoop);
    }

    // Visor / VIP Stage Shades
    this.visor = new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.042, 0.03), this.neonMat);
    this.visor.position.set(0, 0.015, 0.10);
    this.headGroup.add(this.visor);

    // Stage DJ Headset with Mic Boom
    const hpBand = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.014, 8, 24, Math.PI), this.hairMat);
    hpBand.position.set(0, 0.06, 0);
    this.headGroup.add(hpBand);

    for (const sx of [-0.125, 0.125]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.03, 14), this.magentaMat);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(sx, 0.045, 0);
      this.headGroup.add(cup);
    }

    const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.11, 6), this.hairMat);
    mic.rotation.x = -Math.PI / 3;
    mic.position.set(-0.11, 0.02, 0.07);
    this.headGroup.add(mic);

    // 3. Limbs: Feminine Athletic proportions
    this.limbs = {};
    for (const [k, r] of [
      ['neck', 0.038],
      ['neckBase', 0.034],
      ['shoulders', 0.032],
      ['upperArmL', 0.036],
      ['upperArmR', 0.036],
      ['foreArmL', 0.030],
      ['foreArmR', 0.030],
      ['thighL', 0.052],
      ['thighR', 0.052],
      ['shinL', 0.042],
      ['shinR', 0.042],
    ]) {
      const isLeg = k.startsWith('thigh') || k.startsWith('shin');
      const m = makeLimb(isLeg ? this.leggingsMat : this.skinMat, r);
      this.limbs[k] = m;
      this.body.add(m);
    }

    // Shoulder & knee joint caps
    this.caps = {};
    for (const [k, r] of [
      ['shL', 0.054], ['shR', 0.054],
      ['elL', 0.038], ['elR', 0.038],
      ['knL', 0.048], ['knR', 0.048]
    ]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), this.magentaMat);
      this.caps[k] = m;
      this.body.add(m);
    }

    // Hands with glowing wristbands
    this.pivotL = new THREE.Group();
    this.pivotR = new THREE.Group();
    this.body.add(this.pivotL, this.pivotR);

    this.handL = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), this.skinMat);
    this.handR = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), this.skinMat);
    this.pivotL.add(this.handL);
    this.pivotR.add(this.handR);

    for (const pvt of [this.pivotL, this.pivotR]) {
      const wristband = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.012, 8, 16), this.neonMat);
      wristband.rotation.x = Math.PI / 2;
      wristband.position.y = -0.02;
      pvt.add(wristband);
    }

    // High-top dance sneakers with luminous soles
    const sneakerMat = new THREE.MeshStandardMaterial({ color: 0x0a0515, roughness: 0.35, metalness: 0.7 });
    this.footL = new THREE.Group();
    this.footR = new THREE.Group();
    this.body.add(this.footL, this.footR);

    for (const [ftGroup, isLeft] of [[this.footL, true], [this.footR, false]]) {
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.24), sneakerMat);
      shoe.position.set(0, 0.035, 0.03);
      shoe.castShadow = true;
      ftGroup.add(shoe);

      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.025, 0.25), this.neonMat);
      sole.position.set(0, 0.01, 0.03);
      ftGroup.add(sole);
    }

    // Illuminated Floor Stage Ring
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.55, 40),
      new THREE.MeshBasicMaterial({
        color: this.color,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.group.add(this.ring);

    // Initial idle setup
    this.#setInitialPose();
    this.#applyJoints();
  }

  #setInitialPose() {
    this.target = {
      hip: new THREE.Vector3(0, 0.94, 0),
      neck: new THREE.Vector3(0, 1.44, 0),
      head: new THREE.Vector3(0, 1.66, 0),
      shL: new THREE.Vector3(-0.21, 1.38, 0),
      shR: new THREE.Vector3(0.21, 1.38, 0),
      elL: new THREE.Vector3(-0.28, 1.12, 0.04),
      elR: new THREE.Vector3(0.28, 1.12, 0.04),
      wrL: new THREE.Vector3(-0.32, 0.88, 0.08),
      wrR: new THREE.Vector3(0.32, 0.88, 0.08),
      hipL: new THREE.Vector3(-0.11, 0.93, 0),
      hipR: new THREE.Vector3(0.11, 0.93, 0),
      knL: new THREE.Vector3(-0.12, 0.50, 0.02),
      knR: new THREE.Vector3(0.12, 0.50, 0.02),
      anL: new THREE.Vector3(-0.12, 0.08, 0),
      anR: new THREE.Vector3(0.12, 0.08, 0),
      ftL: new THREE.Vector3(-0.12, 0.04, 0.08),
      ftR: new THREE.Vector3(0.12, 0.04, 0.08),
    };
    for (const k of Object.keys(this.joints)) {
      this.joints[k].copy(this.target[k]);
    }
  }

  setOnline(online) {
    this.online = online;
    this.neonMat.emissiveIntensity = online ? 2.2 : 0.4;
    this.ring.material.opacity = online ? 0.65 : 0.15;
  }

  setProp() {}
  setVisible(v) { this.group.visible = v; }

  update(lm, stage, dt, opts = {}) {
    if (opts.poseTargets) {
      for (const [k, v] of Object.entries(opts.poseTargets)) {
        if (this.target[k]) {
          if (Array.isArray(v)) this.target[k].set(v[0], v[1], v[2] ?? 0);
          else if (v.isVector3) this.target[k].copy(v);
        }
      }
    }

    const lambda = opts.poseLambda || 18;
    for (const k of Object.keys(this.joints)) {
      this.joints[k].x = damp(this.joints[k].x, this.target[k].x, lambda, dt);
      this.joints[k].y = damp(this.joints[k].y, this.target[k].y, lambda, dt);
      this.joints[k].z = damp(this.joints[k].z, this.target[k].z, lambda, dt);
    }

    // Solve Two-Bone IK for legs
    solveTwoBoneIK(this.joints.hipL, this.joints.anL, POLE_FORWARD, 0.44, 0.42, this.joints.knL);
    solveTwoBoneIK(this.joints.hipR, this.joints.anR, POLE_FORWARD, 0.44, 0.42, this.joints.knR);

    this.facing += (this.facingTarget - this.facing) * (1 - Math.exp(-12 * dt));
    this.body.rotation.y = this.facing;

    this.#applyJoints();

    // High-Ponytail Dynamic Hair Momentum Physics
    const headSpeedX = (this.joints.head.x - (this._prevHeadX || 0)) / Math.max(dt, 0.001);
    this._prevHeadX = this.joints.head.x;

    const targetHairAngle = clamp(-headSpeedX * 0.18, -0.65, 0.65);
    this.hairAngle = damp(this.hairAngle, targetHairAngle, 8.5, dt);

    for (let i = 0; i < this.ponytailSegments.length; i++) {
      const seg = this.ponytailSegments[i];
      seg.rotation.z = this.hairAngle * (0.8 + i * 0.35);
      seg.rotation.x = 0.15 + Math.sin(performance.now() * 0.008 + i) * 0.08;
    }

    // Stage floor ring pulsing
    this.ring.rotation.z += dt * 0.5;
  }

  #applyJoints() {
    const j = this.joints;

    placeLimb(this.limbs.neck, j.neck, j.head, 0.038);
    const midSh = new THREE.Vector3().copy(j.shL).add(j.shR).multiplyScalar(0.5);
    placeLimb(this.limbs.neckBase, midSh, j.neck, 0.034);
    placeLimb(this.limbs.shoulders, j.shL, j.shR, 0.032);

    this.headGroup.position.copy(j.head);

    placeLimb(this.limbs.upperArmL, j.shL, j.elL, 0.036);
    placeLimb(this.limbs.upperArmR, j.shR, j.elR, 0.036);
    placeLimb(this.limbs.foreArmL, j.elL, j.wrL, 0.030);
    placeLimb(this.limbs.foreArmR, j.elR, j.wrR, 0.030);

    placeLimb(this.limbs.thighL, j.hipL, j.knL, 0.052);
    placeLimb(this.limbs.thighR, j.hipR, j.knR, 0.052);
    placeLimb(this.limbs.shinL, j.knL, j.anL, 0.042);
    placeLimb(this.limbs.shinR, j.knR, j.anR, 0.042);

    // Contoured feminine hourglass torso
    const torsoDir = new THREE.Vector3().subVectors(j.neck, j.hip);
    const torsoLen = Math.max(torsoDir.length(), 0.1);
    const shW = Math.max(Math.abs(j.shL.x - j.shR.x), 0.20);

    this.torso.position.copy(j.hip).add(j.neck).multiplyScalar(0.5);
    this.torso.quaternion.setFromUnitVectors(UP, torsoDir.normalize());
    this.torso.scale.set(shW * 0.48, torsoLen, 0.17);

    this.chest.position.copy(j.neck).add(j.hip).multiplyScalar(0.5);
    this.chest.position.y += torsoLen * 0.11;
    this.chest.quaternion.copy(this.torso.quaternion);
    this.chest.scale.set(clamp(shW / 0.38, 0.75, 1.3), 1, 1);

    this.caps.shL.position.copy(j.shL);
    this.caps.shR.position.copy(j.shR);
    this.caps.elL.position.copy(j.elL);
    this.caps.elR.position.copy(j.elR);
    this.caps.knL.position.copy(j.knL);
    this.caps.knR.position.copy(j.knR);

    this.pivotL.position.copy(j.wrL);
    this.pivotR.position.copy(j.wrR);

    this.footL.position.copy(j.ftL);
    this.footR.position.copy(j.ftR);
  }

  dispose() {
    if (this.topTexture) this.topTexture.dispose();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
    this.group.removeFromParent();
  }
}
