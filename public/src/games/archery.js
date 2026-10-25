/**
 * Archery: Olympic Target Archery with authentic ballistic physics and 10-ring scoring.
 * 
 * Controls:
 * - Extend bow arm forward to aim crosshair at target
 * - Pull other arm back past chin to draw bow string
 * - Release draw hand forward (or open hand) to loose arrow
 * - Spacebar to loose in keyboard/demo mode
 * 
 * Features:
 * - 3D arrow ballistics with gravity and crosswind drift
 * - 122cm Olympic target face with 10-ring concentric scoring + inner X bullseye
 * - Dynamic arrow-cam tracking camera following loosed arrow to target
 * - Wind indicator with dynamic crosswind per end
 * - Stick-in-target arrow lodging with quiver vibration
 */
import * as THREE from '/vendor/three/three.module.js';
import { BaseGame } from './base.js';
import { buildArcheryRange } from '../engine/environments.js';
import { clamp, damp } from '../shared/math.js';

const TOTAL_ENDS = 3;       // 3 ends (rounds)
const ARROWS_PER_END = 3;   // 3 arrows per player per end
const TARGET_Z = -30.0;
const TARGET_Y = 1.35;
const TARGET_R = 0.614;

export class ArcheryGame extends BaseGame {
  constructor(ctx, options = {}) {
    super(ctx, options);
    this.id = 'archery';
    this.title = 'OLYMPIC ARCHERY';
    this.subtitle = 'Aim · draw · release';
    this.phase = 'waiting'; // waiting | aim | flying | impact | results | matchEnd
    this.activeIndex = 0;

    this.currentEnd = 1;
    this.arrowIndex = 1; // 1..ARROWS_PER_END
    this.playerStats = new Map();

    this.aimX = 0;
    this.aimY = TARGET_Y;
    this.targetAimX = 0;
    this.targetAimY = TARGET_Y;
    this.tension = 0;
    this.isDrawn = false;
    this.lastDrawZ = null;
    this.lastDrawTime = 0;

    this.wind = 0; // Crosswind in m/s (-3.5 to +3.5)
    this.arrows = []; // All arrows shot during match
    this.currentArrow = null;

    this.reticle = null;
    this.bow = null;
    this.results = [];
    this.matchWinner = null;
  }

  buildWorld() {
    this.env = buildArcheryRange();
    this.scene = this.env.scene;

    // Build the 3D Bow
    this.bow = this.#makeBow();
    this.scene.add(this.bow.group);

    // Build Aim Reticle HUD in 3D
    this.reticle = this.#makeReticle();
    this.scene.add(this.reticle.group);

    this.#newWind();
  }

  #makeBow() {
    const group = new THREE.Group();

    // Curved recurve bow riser and limbs
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.72, -0.06),
      new THREE.Vector3(0, 0.45, 0.05),
      new THREE.Vector3(0, 0, 0.08),
      new THREE.Vector3(0, -0.45, 0.05),
      new THREE.Vector3(0, -0.72, -0.06),
    ]);
    const bowGeo = new THREE.TubeGeometry(curve, 32, 0.022, 8, false);
    const bowMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7, // Olympic electric blue
      metalness: 0.3,
      roughness: 0.4,
    });
    const bowMesh = new THREE.Mesh(bowGeo, bowMat);
    group.add(bowMesh);

    // Bowstring
    const stringMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
    const stringGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.72, -0.06),
      new THREE.Vector3(0, 0, -0.06),
      new THREE.Vector3(0, -0.72, -0.06),
    ]);
    const bowString = new THREE.Line(stringGeo, stringMat);
    group.add(bowString);

    // Nocked arrow preview
    const arrowGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.78, 8);
    const arrowMat = new THREE.MeshLambertMaterial({ color: 0x1f2937 });
    const previewArrow = new THREE.Mesh(arrowGeo, arrowMat);
    previewArrow.rotation.x = Math.PI / 2;
    previewArrow.position.set(0, 0, 0.28);
    group.add(previewArrow);

    group.position.set(0, 1.45, 0.5);
    return { group, bowMesh, bowString, previewArrow };
  }

  #makeReticle() {
    const group = new THREE.Group();

    // Outer circle
    const ringGeo = new THREE.RingGeometry(0.12, 0.135, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    group.add(ring);

    // Inner crosshairs
    const lineMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.85 });
    const hLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.18, 0, 0), new THREE.Vector3(0.18, 0, 0)]),
      lineMat
    );
    const vLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.18, 0), new THREE.Vector3(0, 0.18, 0)]),
      lineMat
    );
    group.add(hLine);
    group.add(vLine);

    // Center precision dot
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), ringMat);
    group.add(dot);

    group.position.set(0, TARGET_Y, -5.0);
    return { group, ring, dot };
  }

  #newWind() {
    // Generate realistic crosswind: between -3.2 and +3.2 m/s
    this.wind = Number(((Math.random() - 0.5) * 6.4).toFixed(1));
  }

  addPlayer(p) {
    super.addPlayer(p);
    if (!this.playerStats.has(p.key)) {
      this.playerStats.set(p.key, {
        totalScore: 0,
        tens: 0,
        xs: 0,
        shots: [],
      });
    }
  }

  start() {
    super.start();
    this.phase = 'aim';
    this.currentEnd = 1;
    this.arrowIndex = 1;
    this.activeIndex = 0;
    this.#beginShot();
  }

  #activePlayer() {
    return this.players[this.activeIndex] || null;
  }

  #beginShot() {
    this.phase = 'aim';
    this.tension = 0;
    this.isDrawn = false;
    this.targetAimX = 0;
    this.targetAimY = TARGET_Y;
    this.bow.group.visible = true;
    this.reticle.group.visible = true;
    this.bow.previewArrow.visible = true;

    const p = this.#activePlayer();
    this.message = p ? `${p.name.toUpperCase()}'S SHOT` : 'AIM & DRAW';
    this.messageSub = `End ${this.currentEnd}/${TOTAL_ENDS} · Arrow ${this.arrowIndex}/${ARROWS_PER_END} · Wind: ${Math.abs(this.wind)}m/s ${this.wind >= 0 ? '→' : '←'}`;
  }

  update(dt) {
    super.update(dt);
    this.env.update(dt, this.wind);

    if (this.phase === 'aim') {
      this.#updateAiming(dt);
    } else if (this.phase === 'flying') {
      this.#updateBallistics(dt);
    } else if (this.phase === 'impact') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.#advanceTurn();
      }
    } else if (this.phase === 'matchEnd') {
      this.phaseTimer -= dt;
    }
  }

  #updateAiming(dt) {
    const p = this.#activePlayer();
    if (!p) return;

    let targetAimX = 0;
    let targetAimY = TARGET_Y;
    let measuredTension = 0;

    if (this.options.demo || !p.lm) {
      // Demo mode synthetic targeting and draw cycle
      const t = this.time * 1.5;
      targetAimX = Math.sin(t * 0.8) * 0.35;
      targetAimY = TARGET_Y + Math.cos(t * 0.6) * 0.25;
      measuredTension = clamp(Math.sin(t * 0.5) * 0.8 + 0.3, 0, 1);

      if (measuredTension > 0.85 && Math.random() < 0.02) {
        this.#looseArrow();
        return;
      }
    } else {
      const lm = p.lm;
      const lWrist = lm[15];
      const rWrist = lm[16];
      const lSh = lm[11];
      const rSh = lm[12];
      const nose = lm[0];

      if (lWrist && rWrist && lSh && rSh) {
        // Determine bow arm from calibrated dominant hand (or forward reach)
        const mirror = this.ctx.calibration?.mirror !== false;
        const bowArmLeft = p.dominantHand ? p.dominantHand === 'R' : (lWrist.z || 0) < (rWrist.z || 0);

        const bowWrist = bowArmLeft ? lWrist : rWrist;
        const drawWrist = bowArmLeft ? rWrist : lWrist;
        const bowSh = bowArmLeft ? lSh : rSh;

        // Steering aim with bow arm vector
        const bX = mirror ? 1 - bowWrist.x : bowWrist.x;
        const sX = mirror ? 1 - bowSh.x : bowSh.x;
        const reachX = (bX - sX) * 3.8;
        const reachY = (bowSh.y - bowWrist.y) * 4.2;

        targetAimX = clamp(reachX, -1.8, 1.8);
        targetAimY = clamp(TARGET_Y + reachY, 0.4, 2.4);

        // Draw tension: distance between bow hand and draw hand
        const span = Math.hypot(lSh.x - rSh.x, lSh.y - rSh.y) * 2.2;
        const drawDist = Math.hypot(lWrist.x - rWrist.x, lWrist.y - rWrist.y);
        measuredTension = clamp((drawDist - 0.22) / Math.max(0.2, span), 0, 1);

        // Detect forward loose gesture: rapid forward release
        const currentDrawZ = drawWrist.z || 0;
        if (this.lastDrawZ != null && this.tension > 0.55) {
          const deltaZ = currentDrawZ - this.lastDrawZ; // Moving forward toward camera
          if (deltaZ > 0.045 && performance.now() - this.lastDrawTime < 250) {
            this.#looseArrow();
            return;
          }
        }
        this.lastDrawZ = currentDrawZ;
        this.lastDrawTime = performance.now();
      }
    }

    // Smooth aim point
    this.aimX = damp(this.aimX, targetAimX, 10, dt);
    this.aimY = damp(this.aimY, targetAimY, 10, dt);

    const prevTension = this.tension;
    this.tension = damp(this.tension, measuredTension, 8, dt);

    // Audio feedback on drawing string
    if (this.tension > 0.2 && Math.abs(this.tension - prevTension) > 0.06) {
      this.ctx.audio.play('bowDraw', { tension: this.tension });
    }

    // Update 3D Reticle
    const aimDistZ = 6.0;
    this.reticle.group.position.set(this.aimX * 0.2, this.aimY, -aimDistZ);
    // Reticle shrinks as bow stabilizes at full draw
    const scale = 1.0 - this.tension * 0.45;
    this.reticle.group.scale.set(scale, scale, scale);
    this.reticle.ring.material.color.setHSL(0.12 + this.tension * 0.25, 1.0, 0.55);

    // Position Bow in front of camera
    this.bow.group.position.set(this.aimX * 0.12 - 0.15, this.aimY - 0.08, 0.8);
    this.bow.group.rotation.y = -this.aimX * 0.06;
    this.bow.group.rotation.x = (this.aimY - TARGET_Y) * 0.06;

    // Pull back bowstring and nocked arrow with tension
    const pullBack = this.tension * 0.22;
    const pts = this.bow.bowString.geometry.attributes.position.array;
    pts[4] = -0.06 - pullBack; // Center string vertex pulls back
    this.bow.bowString.geometry.attributes.position.needsUpdate = true;
    this.bow.previewArrow.position.z = 0.28 - pullBack;
  }

  #looseArrow() {
    if (this.phase !== 'aim') return;

    this.phase = 'flying';
    this.bow.previewArrow.visible = false;
    this.reticle.group.visible = false;

    // Ballistic launch parameters
    const startPos = new THREE.Vector3(this.aimX * 0.12 - 0.15, this.aimY - 0.08, 0.8);
    const speed = 46.0 * Math.max(0.55, this.tension); // Initial arrow velocity in m/s

    // Trajectory direction pointing toward aim target
    const targetPoint = new THREE.Vector3(this.aimX, this.aimY + 0.15, TARGET_Z);
    const dir = new THREE.Vector3().subVectors(targetPoint, startPos).normalize();

    const velocity = dir.multiplyScalar(speed);

    // Build physical 3D arrow mesh
    const arrow = this.#createArrowMesh();
    arrow.position.copy(startPos);
    this.scene.add(arrow);

    this.currentArrow = {
      mesh: arrow,
      pos: startPos.clone(),
      vel: velocity,
      wind: this.wind,
      settled: false,
    };
    this.arrows.push(this.currentArrow);

    this.ctx.audio.play('bowRelease');
  }

  #createArrowMesh() {
    const group = new THREE.Group();

    // Carbon shaft
    const shaftGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.82, 8);
    const shaftMat = new THREE.MeshLambertMaterial({ color: 0x111827 });
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.rotation.x = Math.PI / 2;
    group.add(shaft);

    // Steel arrowhead tip
    const tipGeo = new THREE.ConeGeometry(0.012, 0.05, 8);
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.8, roughness: 0.2 });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -0.43;
    group.add(tip);

    // Bright fletching feathers (3 vanes)
    const vaneGeo = new THREE.PlaneGeometry(0.035, 0.1);
    const vaneMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Mesh(vaneGeo, vaneMat);
      v.rotation.z = (i * Math.PI * 2) / 3;
      v.position.z = 0.35;
      group.add(v);
    }

    return group;
  }

  #updateBallistics(dt) {
    if (!this.currentArrow || this.currentArrow.settled) return;

    const arr = this.currentArrow;

    // Apply gravity and crosswind drift
    arr.vel.y -= 9.81 * dt;
    arr.vel.x += arr.wind * 0.45 * dt;

    // Integrate position
    arr.pos.x += arr.vel.x * dt;
    arr.pos.y += arr.vel.y * dt;
    arr.pos.z += arr.vel.z * dt;

    arr.mesh.position.copy(arr.pos);

    // Orient arrow along its velocity vector
    const lookTarget = arr.pos.clone().add(arr.vel);
    arr.mesh.lookAt(lookTarget);

    // Impact detection with target plane at TARGET_Z
    if (arr.pos.z <= TARGET_Z + 0.15) {
      this.#handleTargetImpact(arr);
    }
  }

  #handleTargetImpact(arr) {
    arr.settled = true;
    arr.pos.z = TARGET_Z + 0.08; // Lodge in target face
    arr.mesh.position.copy(arr.pos);

    // Calculate distance from target center
    const dx = arr.pos.x - 0;
    const dy = arr.pos.y - TARGET_Y;
    const dist = Math.hypot(dx, dy);

    // Olympic 10-Ring Scoring Calculation
    let points = 0;
    let label = 'MISS';
    let isX = false;

    if (dist <= TARGET_R * 0.05) {
      points = 10;
      isX = true;
      label = 'BULLSEYE! (X - 10 PTS)';
    } else if (dist <= TARGET_R * 0.1) {
      points = 10;
      label = '10 RING (GOLD)';
    } else if (dist <= TARGET_R * 0.2) {
      points = 9;
      label = '9 RING (GOLD)';
    } else if (dist <= TARGET_R * 0.3) {
      points = 8;
      label = '8 RING (RED)';
    } else if (dist <= TARGET_R * 0.4) {
      points = 7;
      label = '7 RING (RED)';
    } else if (dist <= TARGET_R * 0.5) {
      points = 6;
      label = '6 RING (BLUE)';
    } else if (dist <= TARGET_R * 0.6) {
      points = 5;
      label = '5 RING (BLUE)';
    } else if (dist <= TARGET_R * 0.7) {
      points = 4;
      label = '4 RING (BLACK)';
    } else if (dist <= TARGET_R * 0.8) {
      points = 3;
      label = '3 RING (BLACK)';
    } else if (dist <= TARGET_R * 0.9) {
      points = 2;
      label = '2 RING (WHITE)';
    } else if (dist <= TARGET_R * 1.0) {
      points = 1;
      label = '1 RING (WHITE)';
    } else {
      points = 0;
      label = 'MISS';
    }

    const p = this.#activePlayer();
    if (p) {
      const stats = this.playerStats.get(p.key);
      stats.totalScore += points;
      if (points === 10) stats.tens++;
      if (isX) stats.xs++;
      stats.shots.push({ end: this.currentEnd, arrow: this.arrowIndex, points, isX, dist });
    }

    this.phase = 'impact';
    this.phaseTimer = 2.4; // Pause to admire the shot

    this.message = label;
    this.messageSub = points > 0 ? `+${points} POINTS` : 'No score';

    if (points === 10) {
      this.ctx.audio.play('bullseye');
      this.fx.confetti(arr.pos, 70);
    } else if (points > 0) {
      this.ctx.audio.play('arrowHit', { power: points / 10 });
    } else {
      this.ctx.audio.play('hit');
    }
  }

  #advanceTurn() {
    this.arrowIndex++;
    if (this.arrowIndex > ARROWS_PER_END) {
      this.arrowIndex = 1;
      this.activeIndex++;

      if (this.activeIndex >= this.players.length) {
        this.activeIndex = 0;
        this.currentEnd++;
        this.#newWind(); // Change wind for the new end

        if (this.currentEnd > TOTAL_ENDS) {
          this.#endMatch();
          return;
        }
      }
    }

    this.#beginShot();
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
          detail: `${st.totalScore} pts · ${st.tens} Tens (${st.xs} Xs)`,
          gained: st.totalScore,
        };
      })
      .sort((a, b) => b.gained - a.gained)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    this.matchWinner = this.results[0] || null;
    this.message = this.matchWinner ? `${this.matchWinner.name.toUpperCase()} WINS!` : 'MATCH COMPLETE';
    this.messageSub = 'Olympic podium celebration';
    this.ctx.audio.play('cheer');
    this.fx.confetti({ x: 0, y: 1.8, z: 0 }, 140);
  }

  updateCamera() {
    const cam = this.ctx.camera;
    if (!cam) return;

    if (this.phase === 'flying' && this.currentArrow && !this.currentArrow.settled) {
      // Dynamic Arrow-Cam: smoothly tracks 1.4m behind the flying arrow
      const targetPos = this.currentArrow.pos.clone().add(new THREE.Vector3(0, 0.35, 1.6));
      cam.position.x = damp(cam.position.x, targetPos.x, 14, 0.016);
      cam.position.y = damp(cam.position.y, targetPos.y, 14, 0.016);
      cam.position.z = damp(cam.position.z, targetPos.z, 16, 0.016);
      cam.lookAt(this.currentArrow.pos.x, this.currentArrow.pos.y, this.currentArrow.pos.z - 4.0);
    } else if (this.phase === 'impact' && this.currentArrow) {
      // Close-up zoomed inspection of the target impact
      cam.position.x = damp(cam.position.x, this.currentArrow.pos.x * 0.4, 6, 0.016);
      cam.position.y = damp(cam.position.y, TARGET_Y + 0.2, 6, 0.016);
      cam.position.z = damp(cam.position.z, TARGET_Z + 3.2, 6, 0.016);
      cam.lookAt(0, TARGET_Y, TARGET_Z);
    } else {
      // Archer third-person approach view
      cam.position.x = damp(cam.position.x, 0.45, 6, 0.016);
      cam.position.y = damp(cam.position.y, 1.68, 6, 0.016);
      cam.position.z = damp(cam.position.z, 2.4, 6, 0.016);
      cam.lookAt(0, TARGET_Y, TARGET_Z * 0.4);
    }
  }

  getHud() {
    const active = this.#activePlayer();
    const list = this.players.map((p) => {
      const st = this.playerStats.get(p.key) || { totalScore: 0, tens: 0, xs: 0 };
      return {
        id: p.key,
        name: p.name,
        color: p.color,
        value: st.totalScore,
        max: 0,
        label: '',
        points: st.totalScore,
        detail: `End ${this.currentEnd}/${TOTAL_ENDS} · ${st.tens} (10s) · ${st.xs} (Xs)`,
        active: p === active,
      };
    });

    const activeScore = active ? this.playerStats.get(active.key)?.totalScore || 0 : 0;
    const scoreLine = active && this.phase !== 'matchEnd'
      ? `SCORE ${activeScore} · END ${this.currentEnd}/${TOTAL_ENDS} (ARROW ${this.arrowIndex}/${ARROWS_PER_END})`
      : '';

    return {
      title: this.title,
      subtitle: 'Extend arm to aim · pull back to draw · release forward to loose',
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
    for (const arr of this.arrows) {
      arr.mesh?.removeFromParent();
    }
    this.bow?.group?.removeFromParent();
    this.reticle?.group?.removeFromParent();
    super.dispose();
  }
}
