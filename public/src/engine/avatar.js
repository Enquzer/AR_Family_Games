/**
 * Procedural AR athlete avatar.
 * A stylised hologram body whose joints are driven directly by pose landmarks.
 * No model files, no skinning, no downloads - just primitives that look good
 * with emissive materials, rim light and a floor ring.
 */
import * as THREE from '/vendor/three/three.module.js';
import { clamp, damp, lerp } from '../shared/math.js';
import { LM, mid } from '../shared/pose.js';

const UP = new THREE.Vector3(0, 1, 0);
const POLE_FORWARD = new THREE.Vector3(0, 0.2, 0.98).normalize();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
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

let shadowTexture = null;
function getShadowTexture() {
  if (shadowTexture) return shadowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  shadowTexture = new THREE.CanvasTexture(c);
  shadowTexture.colorSpace = THREE.SRGBColorSpace;
  return shadowTexture;
}

function makeLimb(material, radius) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1), material);
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

function makeNameSprite(name, color, online = true) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 96;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: true })
  );
  sprite.scale.set(1.5, 0.375, 1);
  const draw = (label, col, on) => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 384, 96);
    ctx.fillStyle = 'rgba(8, 12, 24, 0.72)';
    ctx.beginPath();
    ctx.roundRect(8, 14, 368, 68, 34);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = on ? col : '#64748b';
    ctx.beginPath();
    ctx.arc(52, 48, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 40px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.slice(0, 16), 78, 50);
    tex.needsUpdate = true;
  };
  draw(name, color, online);
  return { sprite, draw };
}

export class Avatar {
  constructor({ color = '#22d3ee', name = 'Player', id = 1 } = {}) {
    this.id = id;
    this.name = name;
    this.colorHex = color;
    this.color = new THREE.Color(color);
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.followStage = true;
    this.stageOverride = null;
    this.facing = 0;
    this.facingTarget = 0;
    this.poseYaw = 0;
    this.poseYawTarget = 0;
    this.seated = false;
    this.online = true;
    this.active = true;
    this.lostFor = 0;
    this.prop = 'none';
    this.lastStage = { x: 0, z: 0 };
    this.group.position.set(0, 0, 0);

    this.suitMat = new THREE.MeshStandardMaterial({
      color: 0x111a2e,
      roughness: 0.48,
      metalness: 0.35,
      emissive: this.color.clone().multiplyScalar(0.06),
    });
    this.accentMat = new THREE.MeshStandardMaterial({
      color: this.color.clone().multiplyScalar(0.7),
      emissive: this.color,
      emissiveIntensity: 0.9,
      roughness: 0.3,
      metalness: 0.5,
    });
    this.darkMat = new THREE.MeshStandardMaterial({ color: 0x05070f, roughness: 0.35, metalness: 0.6 });
    this.visorMat = new THREE.MeshStandardMaterial({
      color: 0x0b1220,
      emissive: this.color,
      emissiveIntensity: 1.4,
      roughness: 0.2,
      metalness: 0.7,
    });

    // joints
    this.joints = {};
    for (const k of ['hip', 'neck', 'head', 'shL', 'shR', 'elL', 'elR', 'wrL', 'wrR', 'hipL', 'hipR', 'knL', 'knR', 'anL', 'anR', 'ftL', 'ftR']) {
      this.joints[k] = new THREE.Vector3();
    }

    // Foot planting state machine (hysteresis to prevent foot skating)
    this.footPlant = {
      L: { state: 'plant', plantPos: new THREE.Vector3(-0.11, 0.04, 0.09), prevPos: new THREE.Vector3(-0.11, 0.04, 0.09) },
      R: { state: 'plant', plantPos: new THREE.Vector3(0.11, 0.04, 0.09), prevPos: new THREE.Vector3(0.11, 0.04, 0.09) },
    };

    this.torso = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 14, 1), this.suitMat);
    this.torso.castShadow = true;
    this.body.add(this.torso);

    this.chest = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.18), this.accentMat);
    this.chest.castShadow = true;
    this.body.add(this.chest);

    this.headGroup = new THREE.Group();
    this.body.add(this.headGroup);
    this.headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 14), this.suitMat);
    this.headMesh.scale.set(1, 1.14, 1.02);
    this.headMesh.castShadow = true;
    this.headGroup.add(this.headMesh);
    this.visor = new THREE.Mesh(new THREE.BoxGeometry(0.175, 0.048, 0.03), this.visorMat);
    this.visor.position.set(0, 0.015, 0.1);
    this.headGroup.add(this.visor);
    this.earL = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), this.accentMat);
    this.earL.position.set(-0.115, 0.005, 0);
    this.earR = this.earL.clone();
    this.earR.position.x = 0.115;
    this.headGroup.add(this.earL, this.earR);

    this.limbs = {};
    for (const [k, r] of [
      ['neck', 0.045],
      ['neckBase', 0.04],
      ['shoulders', 0.036],
      ['upperArmL', 0.043],
      ['upperArmR', 0.043],
      ['foreArmL', 0.037],
      ['foreArmR', 0.037],
      ['thighL', 0.062],
      ['thighR', 0.062],
      ['shinL', 0.05],
      ['shinR', 0.05],
    ]) {
      const m = makeLimb(this.suitMat, r);
      this.limbs[k] = m;
      this.body.add(m);
    }

    // shoulders / knees / elbows glow caps
    this.caps = {};
    for (const [k, r] of [['shL', 0.062], ['shR', 0.062], ['elL', 0.045], ['elR', 0.045], ['knL', 0.058], ['knR', 0.058]]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), this.accentMat);
      this.caps[k] = m;
      this.body.add(m);
    }

    // hands (with pivots for props)
    this.pivotL = new THREE.Group();
    this.pivotR = new THREE.Group();
    this.body.add(this.pivotL, this.pivotR);
    this.handL = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), this.suitMat);
    this.handR = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), this.suitMat);
    this.gloveL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), this.accentMat);
    this.gloveR = this.gloveL.clone();
    this.gloveL.visible = this.gloveR.visible = false;
    this.pivotL.add(this.handL, this.gloveL);
    this.pivotR.add(this.handR, this.gloveR);

    // Glowing ball held in the right hand (Balling).
    this.ballProp = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 16, 12),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xf8fafc,
        emissiveIntensity: 1.1,
        roughness: 0.18,
        metalness: 0.05,
      })
    );
    this.ballProp.position.set(0, 0.12, 0.02);
    this.ballProp.visible = false;
    this.pivotR.add(this.ballProp);

    // feet
    this.footL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.27), this.darkMat);
    this.footR = this.footL.clone();
    this.footL.castShadow = this.footR.castShadow = true;
    this.body.add(this.footL, this.footR);

    // racket
    this.racket = this.#makeRacket();
    this.racket.visible = false;
    this.pivotR.add(this.racket);

    // oar
    this.oar = this.#makeOar();
    this.oar.visible = false;
    this.pivotR.add(this.oar);
    this.oarL = this.#makeOar();
    this.oarL.visible = false;
    this.pivotL.add(this.oarL);

    // floor shadow + hologram ring
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 1.15),
      new THREE.MeshBasicMaterial({ map: getShadowTexture(), transparent: true, depthWrite: false, opacity: 0.7 })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.012;
    this.group.add(this.shadow);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.4, 40),
      new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.group.add(this.ring);

    const { sprite, draw } = makeNameSprite(name, color, true);
    this.nameSprite = sprite;
    this.nameSprite.position.y = 2.02;
    this.drawName = draw;
    this.group.add(this.nameSprite);

    this.#setIdleTargets(0);
    for (const k of Object.keys(this.joints)) {
      this.joints[k].copy(this.target[k]);
    }
    this.#applyJoints();
  }

  #makeRacket() {
    const g = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.34, 8), this.darkMat);
    handle.position.y = 0.17;
    g.add(handle);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.017, 8, 24), this.accentMat);
    frame.position.y = 0.55;
    g.add(frame);
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(0.155, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false })
    );
    face.position.y = 0.55;
    g.add(face);
    g.position.y = 0.03;
    return g;
  }

  #makeOar() {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.35, 8), this.darkMat);
    shaft.position.y = 0.6;
    g.add(shaft);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.4, 0.03), this.accentMat);
    blade.position.y = 1.32;
    g.add(blade);
    g.position.y = 0.03;
    return g;
  }

  #setIdleTargets(t) {
    const bob = Math.sin(t * 1.6) * 0.006;
    this.target = {
      hip: new THREE.Vector3(0, 0.93 + bob, 0),
      neck: new THREE.Vector3(0, 1.42 + bob, 0),
      head: new THREE.Vector3(0, 1.65 + bob, 0),
      shL: new THREE.Vector3(-0.2, 1.37 + bob, 0),
      shR: new THREE.Vector3(0.2, 1.37 + bob, 0),
      elL: new THREE.Vector3(-0.24, 1.12 + bob, 0.02),
      elR: new THREE.Vector3(0.24, 1.12 + bob, 0.02),
      wrL: new THREE.Vector3(-0.26, 0.87 + bob, 0.05),
      wrR: new THREE.Vector3(0.26, 0.87 + bob, 0.05),
      hipL: new THREE.Vector3(-0.1, 0.92 + bob, 0),
      hipR: new THREE.Vector3(0.1, 0.92 + bob, 0),
      knL: new THREE.Vector3(-0.11, 0.5 + bob, 0.01),
      knR: new THREE.Vector3(0.11, 0.5 + bob, 0.01),
      anL: new THREE.Vector3(-0.11, 0.07, 0),
      anR: new THREE.Vector3(0.11, 0.07, 0),
      ftL: new THREE.Vector3(-0.11, 0.04, 0.09),
      ftR: new THREE.Vector3(0.11, 0.04, 0.09),
    };
    if (this.seated) {
      this.target.hip.set(0, 0.52, -0.02);
      this.target.hipL.set(-0.1, 0.52, -0.02);
      this.target.hipR.set(0.1, 0.52, -0.02);
      this.target.knL.set(-0.13, 0.58, 0.3);
      this.target.knR.set(0.13, 0.58, 0.3);
      this.target.anL.set(-0.14, 0.2, 0.52);
      this.target.anR.set(0.14, 0.2, 0.52);
      this.target.ftL.set(-0.14, 0.16, 0.6);
      this.target.ftR.set(0.14, 0.16, 0.6);
      this.target.neck.set(0, 1.02, -0.02);
      this.target.head.set(0, 1.25, -0.02);
      this.target.shL.set(-0.2, 0.97, -0.02);
      this.target.shR.set(0.2, 0.97, -0.02);
      this.target.elL.set(-0.26, 0.76, 0.05);
      this.target.elR.set(0.26, 0.76, 0.05);
      this.target.wrL.set(-0.3, 0.6, 0.15);
      this.target.wrR.set(0.3, 0.6, 0.15);
    }
  }

  setName(name) {
    this.name = name;
    this.drawName(name, this.colorHex, this.online);
  }

  setColor(color) {
    this.colorHex = color;
    this.color.set(color);
    this.accentMat.color.copy(this.color).multiplyScalar(0.7);
    this.accentMat.emissive.copy(this.color);
    this.visorMat.emissive.copy(this.color);
    this.ring.material.color.copy(this.color);
    this.drawName(this.name, color, this.online);
  }

  setOnline(online) {
    if (this.online === online) return;
    this.online = online;
    this.drawName(this.name, this.colorHex, online);
    this.accentMat.emissiveIntensity = online ? 0.9 : 0.15;
    this.visorMat.emissiveIntensity = online ? 1.4 : 0.2;
    this.ring.material.opacity = online ? 0.55 : 0.12;
  }

  /**
   * Flash the accent material briefly for gesture feedback.
   */
  flash(color, duration = 0.18) {
    const c = new THREE.Color(color);
    const orig = this.accentMat.emissive.clone();
    const origI = this.accentMat.emissiveIntensity;
    this.accentMat.emissive.copy(c);
    this.accentMat.emissiveIntensity = 2.5;
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      this.accentMat.emissive.copy(orig);
      this.accentMat.emissiveIntensity = origI;
    }, duration * 1000);
  }

  /**
   * Flash the visor only (head highlight for block/guard feedback).
   */
  flashVisor(duration = 0.15) {
    const origI = this.visorMat.emissiveIntensity;
    this.visorMat.emissiveIntensity = 3.5;
    clearTimeout(this._visorTimer);
    this._visorTimer = setTimeout(() => {
      this.visorMat.emissiveIntensity = origI;
    }, duration * 1000);
  }

  setProp(prop, dominantHand = 'R') {
    this.prop = prop;
    this.dominantHand = dominantHand;
    const gloves = prop === 'gloves';
    this.gloveL.visible = this.gloveR.visible = gloves;
    this.handL.visible = this.handR.visible = !gloves;

    // Attach props to the player's calibrated dominant hand
    const targetPivot = dominantHand === 'L' ? this.pivotL : this.pivotR;
    if (this.racket.parent !== targetPivot) {
      targetPivot.add(this.racket);
      this.racket.rotation.y = dominantHand === 'L' ? Math.PI : 0;
    }
    if (this.ballProp.parent !== targetPivot) {
      targetPivot.add(this.ballProp);
    }

    this.racket.visible = prop === 'racket';
    this.oar.visible = this.oarL.visible = prop === 'oars';
    this.ballProp.visible = prop === 'ball';
  }

  /**
   * Athletic uniform with running jersey, race bib number, and athletic shorts.
   * @param {{ bibNumber?: number|string, jerseyColor?: string, shortsColor?: string }|null} outfit
   */
  setAthleticOutfit(outfit = null) {
    if (!outfit) {
      if (this._customJerseyTex) {
        this._customJerseyTex.dispose();
        this._customJerseyTex = null;
      }
      if (this._customJerseyMat) {
        this._customJerseyMat.dispose();
        this._customJerseyMat = null;
      }
      if (this._customShortsMat) {
        this._customShortsMat.dispose();
        this._customShortsMat = null;
      }
      this.torso.material = this.suitMat;
      this.chest.material = this.accentMat;
      this.limbs.thighL.material = this.suitMat;
      this.limbs.thighR.material = this.suitMat;
      return;
    }

    const bib = outfit.bibNumber ?? '1';
    const jColor = outfit.jerseyColor || this.colorHex || '#22d3ee';
    const sColor = outfit.shortsColor || '#0f172a';

    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');

    // Jersey base color
    ctx.fillStyle = jColor;
    ctx.fillRect(0, 0, 256, 256);

    // Athletic side stripe accents
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(24, 0, 28, 256);
    ctx.fillRect(204, 0, 28, 256);

    // Race bib badge
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(44, 65, 168, 126);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 5;
    ctx.strokeRect(44, 65, 168, 126);

    // Bib Olympic banner header
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(47, 68, 162, 30);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('AR OLYMPICS', 128, 83);

    // Bib number
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 72px system-ui, sans-serif';
    ctx.fillText(String(bib), 128, 142);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._customJerseyTex = tex;

    this._customJerseyMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.52,
      metalness: 0.18,
    });

    this._customShortsMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(sColor),
      roughness: 0.65,
      metalness: 0.15,
    });

    this.torso.material = this._customJerseyMat;
    this.chest.material = this._customJerseyMat;
    this.limbs.thighL.material = this._customShortsMat;
    this.limbs.thighR.material = this._customShortsMat;
  }

  /**
   * VIP Dance Coach Outfit: holographic iridescent stage jacket, soundwave equalizer,
   * neon sneakers, and stage DJ headphones with mic boom.
   */
  setCoachDancerOutfit() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');

    // Deep metallic indigo/purple gradient
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#1e1035');
    grad.addColorStop(0.5, '#2e1065');
    grad.addColorStop(1, '#0f051d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    // Neon soundwave equalizer bars on chest
    const barWidth = 14;
    const heights = [35, 75, 115, 90, 130, 80, 105, 55, 120, 65];
    for (let i = 0; i < heights.length; i++) {
      const bx = 34 + i * 19;
      const h = heights[i];
      ctx.fillStyle = i % 2 ? '#f472b6' : '#22d3ee';
      ctx.fillRect(bx, 155 - h, barWidth, h);
    }

    // VIP Coach Gold Badge
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★ DANCE COACH ★', 128, 195);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._customDancerTex = tex;

    this._customDancerMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.28,
      metalness: 0.82,
      emissive: new THREE.Color(0x3b0764),
      emissiveIntensity: 0.7,
    });

    const dancePantsMat = new THREE.MeshStandardMaterial({
      color: 0x090514,
      roughness: 0.35,
      metalness: 0.65,
    });

    this.torso.material = this._customDancerMat;
    this.chest.material = this._customDancerMat;
    this.limbs.thighL.material = dancePantsMat;
    this.limbs.thighR.material = dancePantsMat;
    this.limbs.shinL.material = dancePantsMat;
    this.limbs.shinR.material = dancePantsMat;

    // Glowing neon stage sneakers
    const sneakerMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x22d3ee,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });
    this.footL.material = sneakerMat;
    this.footR.material = sneakerMat;

    // DJ Stage Headphones on headGroup
    if (!this._headphones) {
      const hpGroup = new THREE.Group();
      const bandMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8, roughness: 0.2 });
      const cupMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, emissive: 0xf472b6, emissiveIntensity: 1.8 });

      // Arc band
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.016, 8, 24, Math.PI), bandMat);
      band.position.set(0, 0.06, 0);
      hpGroup.add(band);

      // Ear Cups
      const cupL = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 16), cupMat);
      cupL.rotation.z = Math.PI / 2;
      cupL.position.set(-0.13, 0.05, 0);
      const cupR = cupL.clone();
      cupR.position.x = 0.13;
      hpGroup.add(cupL, cupR);

      // Microphone boom
      const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 6), bandMat);
      mic.rotation.x = -Math.PI / 3;
      mic.position.set(-0.11, 0.02, 0.07);
      hpGroup.add(mic);

      this.headGroup.add(hpGroup);
      this._headphones = hpGroup;
    }
  }

  /**
   * @param {Array|null} lm landmarks
   * @param {{x:number,z:number}} stage
   * @param {number} dt
   * @param {{active?:boolean,seated?:boolean}} opts
   */
  update(lm, stage, dt, opts = {}) {
    const now = performance.now() / 1000;
    const active = opts.active !== false && !!lm;
    this.seated = !!opts.seated || this.seated;
    if (active) this.lostFor = 0;
    else this.lostFor += dt;
    this.setOnline(active || this.lostFor < 1.2);

    if (stage) {
      this.lastStage = stage;
      if (this.followStage) {
        this.group.position.x = damp(this.group.position.x, stage.x, 10, dt);
        this.group.position.z = damp(this.group.position.z, stage.z, 10, dt);
      }
    }

    this.#setIdleTargets(now);
    this.poseYawTarget = 0;
    if (opts.poseTargets) this.#applyPoseTargets(opts.poseTargets);
    if (active) this.#poseFromLandmarks(lm, opts);

    const lambda = active ? 20 : opts.poseLambda || 6;
    for (const k of Object.keys(this.joints)) {
      this.joints[k].x = damp(this.joints[k].x, this.target[k].x, lambda, dt);
      this.joints[k].y = damp(this.joints[k].y, this.target[k].y, lambda, dt);
      this.joints[k].z = damp(this.joints[k].z, this.target[k].z, lambda, dt);
    }

    this.facing += (this.facingTarget - this.facing) * (1 - Math.exp(-10 * dt));
    // Pose yaw is the player's real shoulder/hip rotation relative to the
    // camera. It is added to the game's base facing so the avatar turns its
    // whole body when the player turns, instead of only sliding limbs around.
    this.poseYaw = damp(this.poseYaw, this.poseYawTarget, active ? 9 : 5, dt);
    this.body.rotation.y = this.facing + this.poseYaw;
    this.#applyJoints();

    // idle bob for the name tag / ring
    const pulse = 0.5 + Math.sin(now * 2.2) * 0.08;
    this.ring.material.opacity = (this.online ? 0.42 : 0.1) * pulse + 0.1;
    this.ring.rotation.z += dt * 0.4;
    this.nameSprite.position.y = this.seated ? 1.55 : 2.02;
  }

  /**
   * Drive a bot/coach directly from procedural joint targets. Each value can
   * be a THREE.Vector3 or an [x,y,z] array. This is used by the dance coach,
   * which needs to demonstrate moves rather than mirror a camera pose.
   */
  #applyPoseTargets(targets) {
    for (const [key, value] of Object.entries(targets)) {
      const target = this.target[key];
      if (!target || !value) continue;
      if (Array.isArray(value)) target.set(value[0] ?? target.x, value[1] ?? target.y, value[2] ?? target.z);
      else if (value.isVector3) target.copy(value);
      else if (typeof value.x === 'number' && typeof value.y === 'number') {
        target.set(value.x, value.y, value.z ?? target.z);
      }
    }
  }

  #poseFromLandmarks(lm, opts = {}) {
    const aspect = this.aspect || 16 / 9;
    const hipC = mid(lm[LM.L_HIP], lm[LM.R_HIP]);
    const ankC = mid(lm[LM.L_ANKLE], lm[LM.R_ANKLE]);
    const shC = mid(lm[LM.L_SHOULDER], lm[LM.R_SHOULDER]);
    const bodyH = Math.hypot((shC.x - ankC.x) * aspect, shC.y - ankC.y);
    if (bodyH < 0.04) return;
    // Blend the measured body span with the trig distance prediction. This
    // keeps limb proportions stable when a leg is occluded or the player
    // crouches, without hiding genuine motion.
    const expected = this.lastStage?.expectedBodyH;
    const rigH = Number.isFinite(expected) ? lerp(bodyH, expected, 0.35) : bodyH;
    const scale = clamp(1.45 / Math.max(rigH, 0.04), 1.2, 5.5);
    const mirror = -1;
    const hipY = clamp((ankC.y - hipC.y) * scale, 0.62, 1.1);
    const P = (i) => {
      const p = lm[i];
      return new THREE.Vector3(
        (p.x - hipC.x) * aspect * scale * mirror,
        hipY - (p.y - hipC.y) * scale,
        // MediaPipe z is negative toward the camera. The avatar's front is +z,
        // so invert it: a hand reaching toward the camera moves forward, and a
        // shoulder that turns away from the camera moves back.
        clamp(-(p.z - (hipC.z || 0)) * aspect * scale * 0.5, -0.4, 0.4)
      );
    };

    this.target.hip.set(0, hipY, 0);
    this.target.neck.copy(P(LM.L_SHOULDER)).add(P(LM.R_SHOULDER)).multiplyScalar(0.5);
    this.target.neck.y += 0.03;
    this.target.head.copy(P(LM.NOSE));
    this.target.head.y += 0.08;
    this.target.head.z += 0.02;
    this.target.shL.copy(P(LM.L_SHOULDER));
    this.target.shR.copy(P(LM.R_SHOULDER));
    this.target.elL.copy(P(LM.L_ELBOW));
    this.target.elR.copy(P(LM.R_ELBOW));
    this.target.wrL.copy(P(LM.L_WRIST));
    this.target.wrR.copy(P(LM.R_WRIST));
    this.target.hipL.copy(P(LM.L_HIP));
    this.target.hipR.copy(P(LM.R_HIP));
    this.target.knL.copy(P(LM.L_KNEE));
    this.target.knR.copy(P(LM.R_KNEE));
    this.target.anL.copy(P(LM.L_ANKLE));
    this.target.anR.copy(P(LM.R_ANKLE));
    this.target.ftL.copy(P(LM.L_FOOT)).add(new THREE.Vector3(0, -0.01, 0.05));
    this.target.ftR.copy(P(LM.R_FOOT)).add(new THREE.Vector3(0, -0.01, 0.05));

    // Estimate whole-body yaw from the 3D shoulder and hip lines. When the
    // player faces the camera the lines are almost parallel to x; as they turn,
    // one side moves toward the camera and the other moves away, which rotates
    // the avatar's whole body (not just the arms).
    const dxS = this.target.shR.x - this.target.shL.x;
    const dzS = this.target.shR.z - this.target.shL.z;
    const dxH = this.target.hipR.x - this.target.hipL.x;
    const dzH = this.target.hipR.z - this.target.hipL.z;
    const shoulderSpan = Math.hypot(dxS, dzS);
    const hipSpan = Math.hypot(dxH, dzH);
    if (shoulderSpan > 0.1 && hipSpan > 0.055 && !opts.lockFacing) {
      const yawS = Math.atan2(-dzS, dxS);
      const yawH = Math.atan2(-dzH, dxH);
      // Deadzone of ~0.08 rad filters out camera depth sensor asymmetry when standing straight.
      // Weight hips over shoulders so punching forward does not rotate the whole avatar sideways.
      const deadS = Math.abs(yawS) > 0.12 ? yawS : 0;
      const deadH = Math.abs(yawH) > 0.08 ? yawH : 0;
      this.poseYawTarget = clamp(deadH * 0.72 + deadS * 0.28, -0.85, 0.85);
    } else if (opts.lockFacing) {
      this.poseYawTarget = 0;
    }

    if (this.seated) {
      const hipBase = this.target.hip;
      this.target.hipL.copy(hipBase).add(new THREE.Vector3(-0.1, 0, 0));
      this.target.hipR.copy(hipBase).add(new THREE.Vector3(0.1, 0, 0));
      this.target.knL.set(-0.13, hipBase.y + 0.06, 0.3);
      this.target.knR.set(0.13, hipBase.y + 0.06, 0.3);
      this.target.anL.set(-0.14, 0.2, 0.52);
      this.target.anR.set(0.14, 0.2, 0.52);
      this.target.ftL.set(-0.14, 0.16, 0.6);
      this.target.ftR.set(0.14, 0.16, 0.6);
    } else {
      // Foot planting state machine (prevents jitter / foot skating)
      const FLOOR_Y = 0.04;
      const updateFootPlant = (side, targetFoot, targetAnkle) => {
        const fp = this.footPlant[side];
        const speed = targetFoot.distanceTo(fp.prevPos);
        fp.prevPos.copy(targetFoot);

        if (fp.state === 'plant') {
          if (targetFoot.y > FLOOR_Y + 0.08 || speed > 0.05) {
            fp.state = 'swing';
          } else {
            targetFoot.x = fp.plantPos.x;
            targetFoot.z = fp.plantPos.z;
            targetFoot.y = FLOOR_Y;
            targetAnkle.x = fp.plantPos.x;
            targetAnkle.z = fp.plantPos.z - 0.08;
            targetAnkle.y = FLOOR_Y + 0.04;
          }
        } else {
          if (targetFoot.y <= FLOOR_Y + 0.04 && speed < 0.035) {
            fp.state = 'plant';
            fp.plantPos.copy(targetFoot);
            fp.plantPos.y = FLOOR_Y;
          }
        }
        targetFoot.y = Math.max(targetFoot.y, FLOOR_Y);
        targetAnkle.y = Math.max(targetAnkle.y, FLOOR_Y + 0.03);
      };

      updateFootPlant('L', this.target.ftL, this.target.anL);
      updateFootPlant('R', this.target.ftR, this.target.anR);

      // Pelvis root pull: prevent hyperextension popping when squatting or crouching
      const distL = this.target.hipL.distanceTo(this.target.anL);
      const distR = this.target.hipR.distanceTo(this.target.anR);
      const maxLeg = 0.85;
      const overL = Math.max(0, distL - maxLeg);
      const overR = Math.max(0, distR - maxLeg);
      const maxOver = Math.max(overL, overR);
      if (maxOver > 0.001) {
        this.target.hip.y -= maxOver * 0.9;
        this.target.hipL.y -= maxOver * 0.9;
        this.target.hipR.y -= maxOver * 0.9;
      }

      // Analytic Two-Bone IK for legs
      solveTwoBoneIK(this.target.hipL, this.target.anL, POLE_FORWARD, 0.44, 0.42, this.target.knL);
      solveTwoBoneIK(this.target.hipR, this.target.anR, POLE_FORWARD, 0.44, 0.42, this.target.knR);
    }
  }

  #applyJoints() {
    const j = this.joints;

    // Dynamically lock hip root to midpoint of left and right hips
    // so pelvis, torso, and legs are physically anchored as one continuous biomechanical body
    j.hip.x = (j.hipL.x + j.hipR.x) * 0.5;
    j.hip.y = (j.hipL.y + j.hipR.y) * 0.5;
    j.hip.z = (j.hipL.z + j.hipR.z) * 0.5;

    // Proper skeleton chain: hip -> torso -> neck -> head, with a clavicle bar
    // joining the two shoulders. This makes the head/neck/shoulder structure
    // read as a body instead of a triangle floating above the arms.
    placeLimb(this.limbs.neck, j.neck, j.head, 0.045);
    _b.copy(j.shL).add(j.shR).multiplyScalar(0.5);
    placeLimb(this.limbs.neckBase, _b, j.neck, 0.04);
    placeLimb(this.limbs.shoulders, j.shL, j.shR, 0.036);
    this.headGroup.position.copy(j.head);
    placeLimb(this.limbs.upperArmL, j.shL, j.elL, 0.043);
    placeLimb(this.limbs.upperArmR, j.shR, j.elR, 0.043);
    placeLimb(this.limbs.foreArmL, j.elL, j.wrL, 0.037);
    placeLimb(this.limbs.foreArmR, j.elR, j.wrR, 0.037);
    placeLimb(this.limbs.thighL, j.hipL, j.knL, 0.062);
    placeLimb(this.limbs.thighR, j.hipR, j.knR, 0.062);
    placeLimb(this.limbs.shinL, j.knL, j.anL, 0.05);
    placeLimb(this.limbs.shinR, j.knR, j.anR, 0.05);

    // torso: between hip centre and neck, width from the shoulders
    const torsoDir = _a.subVectors(j.neck, j.hip);
    const torsoLen = Math.max(torsoDir.length(), 0.1);
    const shW = Math.max(Math.abs(j.shL.x - j.shR.x), 0.22);
    this.torso.position.copy(j.hip).add(j.neck).multiplyScalar(0.5);
    this.torso.quaternion.setFromUnitVectors(UP, torsoDir.multiplyScalar(1 / torsoLen));
    this.torso.scale.set(shW * 0.52, torsoLen, 0.19);

    this.chest.position.copy(j.neck).add(j.hip).multiplyScalar(0.5);
    this.chest.position.y += torsoLen * 0.12;
    this.chest.quaternion.copy(this.torso.quaternion);
    this.chest.scale.set(clamp(shW / 0.4, 0.7, 1.35), 1, 1);

    this.caps.shL.position.copy(j.shL);
    this.caps.shR.position.copy(j.shR);
    this.caps.elL.position.copy(j.elL);
    this.caps.elR.position.copy(j.elR);
    this.caps.knL.position.copy(j.knL);
    this.caps.knR.position.copy(j.knR);

    // hands + props
    this.pivotL.position.copy(j.wrL);
    this.pivotR.position.copy(j.wrR);
    _dir.subVectors(j.wrL, j.elL);
    if (_dir.lengthSq() > 1e-6) this.pivotL.quaternion.setFromUnitVectors(UP, _dir.normalize());
    _dir.subVectors(j.wrR, j.elR);
    if (_dir.lengthSq() > 1e-6) this.pivotR.quaternion.setFromUnitVectors(UP, _dir.normalize());

    this.footL.position.copy(j.ftL);
    this.footR.position.copy(j.ftR);
    _dir.subVectors(j.ftL, j.anL);
    if (_dir.lengthSq() > 1e-6) this.footL.quaternion.setFromUnitVectors(UP, _dir.normalize());
    _dir.subVectors(j.ftR, j.anR);
    if (_dir.lengthSq() > 1e-6) this.footR.quaternion.setFromUnitVectors(UP, _dir.normalize());
  }

  setVisible(v) {
    this.group.visible = v;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.map && m.map !== shadowTexture) m.map.dispose();
          m.dispose();
        }
      }
    });
    this.group.removeFromParent();
  }
}
