/**
 * Track & Field: 100m Sprint & 110m Hurdles with 4-Lane Olympic Arena Grid,
 * Dynamic AI Bots with distinct stamina curves, True Parabolic Jump Physics,
 * Hurdle Knock-Down Tumbling Physics with Fault Deductions, Physical Snapping Finish Tape,
 * Side-Tracking Olympic Railcam with Photo-Finish Zoom, 22 Stadium Camera Flashes,
 * Running Jersey & Shorts Uniforms, Stride Frequency Speed Gauge, and Persistent Profile Wins.
 */
import * as THREE from '/vendor/three/three.module.js';
import { BaseGame } from './base.js';
import { buildTrack } from '../engine/environments.js';
import { Avatar } from '../engine/avatar.js';
import { clamp, damp } from '../shared/math.js';

const LANE_COUNT = 4;
const LANE_GAP = 2.1;
// Lane centers: Lane 0 = -3.15, Lane 1 = -1.05, Lane 2 = +1.05, Lane 3 = +3.15
const LANES_Z = [-3.15, -1.05, 1.05, 3.15];

const OLYMPIC_BOT_ROSTER = [
  {
    id: 'bot_lightning',
    name: 'LIGHTNING',
    country: 'JAM',
    color: '#f59e0b',
    shortsColor: '#0f172a',
    bib: 1,
    style: 'explosive', // High acceleration out of the blocks, early lead, fades slightly in final stretch
    baseSpeed: 9.8,
    accel: 4.8,
  },
  {
    id: 'bot_titan',
    name: 'TITAN',
    country: 'USA',
    color: '#06b6d4',
    shortsColor: '#1e1b4b',
    bib: 3,
    style: 'pacer', // Steady high-cadence pacer, pushes human player shoulder-to-shoulder
    baseSpeed: 10.0,
    accel: 3.8,
  },
  {
    id: 'bot_phoenix',
    name: 'PHOENIX',
    country: 'GBR',
    color: '#f43f5e',
    shortsColor: '#18181b',
    bib: 4,
    style: 'surge', // Conserves energy in first half, explosive closing kick in the final 25m
    baseSpeed: 10.2,
    accel: 3.2,
  },
];

export class TrackGame extends BaseGame {
  constructor(ctx, options = {}) {
    super(ctx, options);
    this.id = options.id || 'sprint';
    this.title = options.title || '200m SPRINT';
    this.subtitle = options.subtitle || 'Olympic Track & Field · 3 Heats';
    this.distance = options.distance || 200;
    this.heats = options.heats ?? 3;
    this.hurdleXs = options.hurdles || null;
    this.maxSpeed = options.maxSpeed || (this.hurdleXs ? 9.8 : 10.4);

    this.heat = 1;
    this.points = new Map();
    this.states = new Map();
    this.phase = 'waiting';
    this.phaseTimer = 0;
    this.raceTime = 0;
    this.finishOrder = [];
    this.countTick = 0;
    this.firstFinishAt = 0;
    this.results = [];
    this.dustTimers = new Map();

    // 4-Lane Competitor Grid (Humans + Olympic AI Bots)
    this.laneAssignments = new Map(); // key -> laneIndex
    this.bots = [];                   // active bot instances

    // 3D Physical Dynamic Hurdles with Knock-Down Physics
    this.dynamicHurdles = [];

    // 3D Physical Finish Line Ribbon Tape & Posts
    this.tape = {
      broken: false,
      breakTime: 0,
      meshL: null,
      meshR: null,
    };

    // 22 Arena Paparazzi Camera Flashes
    this.cameraFlashes = [];
    this.seriesWinner = null;

    // Key listener for Rematch / series restart & jump testing
    this.onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        if (this.phase === 'final' || this.phase === 'podium') {
          this.points.clear();
          this.heat = 1;
          this.beginHeat();
        } else if (this.phase === 'race' && this.players.length) {
          const s = this.states.get(this.players[0].key);
          if (s) s.jumpWindow = 0.75;
        }
      }
    };
    window.addEventListener('keydown', this.onKey);
  }

  buildWorld() {
    this.env = buildTrack({ finish: this.distance, hurdles: null, laneCount: LANE_COUNT });
    this.scene = this.env.scene;
    const scene = this.scene;

    // Finish line ground checkerboard plane
    const lineTex = this.#checkerTexture();
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 11),
      new THREE.MeshStandardMaterial({ map: lineTex, roughness: 0.8 })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(this.distance, 0.02, 0);
    scene.add(line);

    // 3D Dynamic Hurdles with Individual Lane Knock-Down Physics
    if (this.hurdleXs && this.hurdleXs.length) {
      this.#buildDynamicHurdles(scene);
    }

    // 3D Physical Finish Posts & Finish Ribbon Tape
    this.#buildFinishTape(scene);

    // 22 Arena Paparazzi Camera Flashes in the stadium stands
    this.cameraFlashes = this.#createCameraFlashes(scene);
  }

  #checkerTexture() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 512;
    const ctx = c.getContext('2d');
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 4; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#0f172a' : '#f8fafc';
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  #hurdleBarTexture() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 64;
    const ctx = c.getContext('2d');

    // Olympic Gold & Black diagonal warning stripes
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = '#0f172a';
    for (let x = -64; x < 576; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 24, 0);
      ctx.lineTo(x - 8, 64);
      ctx.lineTo(x - 32, 64);
      ctx.closePath();
      ctx.fill();
    }
    // High-visibility border lines
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 508, 60);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  #buildDynamicHurdles(scene) {
    const footMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.35 });
    const uprightMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.25 });
    const barMat = new THREE.MeshStandardMaterial({
      map: this.#hurdleBarTexture(),
      roughness: 0.35,
      metalness: 0.15,
    });

    this.dynamicHurdles = [];

    for (const hx of this.hurdleXs) {
      for (let lane = 0; lane < LANE_COUNT; lane++) {
        const laneZ = LANES_Z[lane] ?? 0;

        const hurdleGroup = new THREE.Group();
        hurdleGroup.position.set(hx, 0, laneZ);

        // Ground feet rails (parallel to running track, base on track at y = 0.02)
        for (const dz of [-0.75, 0.75]) {
          const foot = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.04, 0.08), footMat);
          foot.position.set(0, 0.02, dz);
          foot.castShadow = true;
          hurdleGroup.add(foot);

          const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.042, 0.95, 10), uprightMat);
          upright.position.set(0, 0.475, dz);
          upright.castShadow = true;
          hurdleGroup.add(upright);
        }

        // Crossbar at y = 0.95m
        const crossbar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 1.7), barMat);
        crossbar.position.set(0, 0.95, 0);
        crossbar.castShadow = true;
        hurdleGroup.add(crossbar);

        scene.add(hurdleGroup);

        this.dynamicHurdles.push({
          hx,
          lane,
          laneZ,
          group: hurdleGroup,
          state: 'standing', // standing | falling | down
          angle: 0,
          angularVel: 0,
          bounce: 0.4,
        });
      }
    }
  }

  #buildFinishTape(scene) {
    const postMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.85, roughness: 0.25 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.9, roughness: 0.2 });

    // Left and Right Finish Posts
    for (const z of [-4.8, 4.8]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.4, 16), postMat);
      post.position.set(this.distance, 1.2, z);
      post.castShadow = true;
      scene.add(post);

      const finial = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), goldMat);
      finial.position.set(this.distance, 2.45, z);
      scene.add(finial);
    }

    // Official Olympic Finish Ribbon Texture
    const tapeCanvas = document.createElement('canvas');
    tapeCanvas.width = 512;
    tapeCanvas.height = 64;
    const tctx = tapeCanvas.getContext('2d');
    tctx.fillStyle = '#ef4444';
    tctx.fillRect(0, 0, 512, 64);
    tctx.fillStyle = '#ffffff';
    tctx.fillRect(0, 24, 512, 16);
    tctx.fillStyle = '#0f172a';
    tctx.font = 'bold 22px system-ui, sans-serif';
    tctx.textAlign = 'center';
    tctx.textBaseline = 'middle';
    tctx.fillText('FINISH ★ AR OLYMPICS ★ FINISH', 256, 32);

    const tapeTex = new THREE.CanvasTexture(tapeCanvas);
    tapeTex.colorSpace = THREE.SRGBColorSpace;
    const tapeMat = new THREE.MeshStandardMaterial({
      map: tapeTex,
      side: THREE.DoubleSide,
      roughness: 0.45,
    });

    // Two ribbon halves meeting at center z = 0, y = 1.15 (chest height)
    const tapeGeoL = new THREE.PlaneGeometry(4.8, 0.15);
    tapeGeoL.translate(2.4, 0, 0); // pivot at post z = -4.8
    const meshL = new THREE.Mesh(tapeGeoL, tapeMat);
    meshL.rotation.y = Math.PI / 2;
    meshL.position.set(this.distance, 1.15, -4.8);
    scene.add(meshL);

    const tapeGeoR = new THREE.PlaneGeometry(4.8, 0.15);
    tapeGeoR.translate(-2.4, 0, 0); // pivot at post z = +4.8
    const meshR = new THREE.Mesh(tapeGeoR, tapeMat);
    meshR.rotation.y = Math.PI / 2;
    meshR.position.set(this.distance, 1.15, 4.8);
    scene.add(meshR);

    this.tape = {
      broken: false,
      breakTime: 0,
      meshL,
      meshR,
    };
  }

  #createCameraFlashes(scene) {
    const flashes = [];
    for (let i = 0; i < 22; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 28);
      const frac = i / 22;
      const x = -10 + frac * (this.distance + 25) + (Math.random() - 0.5) * 6;
      const y = 4.2 + Math.random() * 4.5;
      const z = -14 - Math.random() * 8;
      light.position.set(x, y, z);
      scene.add(light);
      flashes.push({ light, flashTimer: 0 });
    }
    return flashes;
  }

  start() {
    this.heat = 1;
    this.points.clear();
    this.results = [];
    this.seriesWinner = null;
    if (!this.players.length) {
      this.phase = 'waiting';
      this.message = 'WAVE TO JOIN';
      this.messageSub = 'Step onto the track to enter the race';
      return;
    }
    this.beginHeat();
  }

  addPlayer(p) {
    super.addPlayer(p);
    if (this.phase !== 'waiting' && !this.states.has(p.key)) {
      this.setupCompetitors();
    }
    if (this.phase === 'waiting' && this.players.length) this.start();
  }

  /**
   * Sets up 4 lanes with human players and Olympic AI Bots.
   */
  setupCompetitors() {
    // Clear old bots
    for (const b of this.bots) {
      if (b.avatar) b.avatar.dispose();
    }
    this.bots = [];
    this.laneAssignments.clear();

    const humanCount = Math.min(this.players.length, 4);

    // Assign lanes: Humans get central positions (Lane 1 if 1 human; Lanes 1 & 2 if 2 humans)
    const humanLanes = [];
    if (humanCount === 1) humanLanes.push(1);
    else if (humanCount === 2) humanLanes.push(1, 2);
    else if (humanCount === 3) humanLanes.push(0, 1, 2);
    else humanLanes.push(0, 1, 2, 3);

    this.players.slice(0, humanCount).forEach((p, idx) => {
      const lane = humanLanes[idx];
      this.laneAssignments.set(p.key, lane);
      p.avatar.setVisible(true);
      p.avatar.setProp('none');
      p.avatar.seated = false;
      p.avatar.followStage = false;
      // Dress human player avatar in running jersey & shorts with bib number!
      p.avatar.setAthleticOutfit({
        bibNumber: lane + 1,
        jerseyColor: p.color,
        shortsColor: '#0f172a',
      });
    });

    // Populate remaining lanes with Olympic AI Bots
    const occupiedLanes = new Set(humanLanes);
    const availableLanes = [0, 1, 2, 3].filter((l) => !occupiedLanes.has(l));

    let botIdx = 0;
    for (const lane of availableLanes) {
      const template = OLYMPIC_BOT_ROSTER[botIdx % OLYMPIC_BOT_ROSTER.length];
      botIdx++;

      const botAvatar = new Avatar({ name: template.name, color: template.color, id: template.id });
      botAvatar.setAthleticOutfit({
        bibNumber: lane + 1,
        jerseyColor: template.color,
        shortsColor: template.shortsColor,
      });
      botAvatar.setOnline(true);
      botAvatar.followStage = false;
      this.env.scene.add(botAvatar.group);

      const bot = {
        key: template.id,
        name: template.name,
        color: template.color,
        isBot: true,
        style: template.style,
        baseSpeed: template.baseSpeed,
        accel: template.accel,
        avatar: botAvatar,
        lane,
        motion: { cadence: 0, steps: 0 },
      };

      this.bots.push(bot);
      this.laneAssignments.set(bot.key, lane);
    }
  }

  beginHeat() {
    this.phase = 'intro';
    this.phaseTimer = 4.2;
    this.raceTime = 0;
    this.finishOrder = [];
    this.firstFinishAt = 0;
    this.countTick = 0;
    this.states.clear();

    // Reset 3D physical finish ribbon tape
    this.tape.broken = false;
    this.tape.breakTime = 0;
    if (this.tape.meshL && this.tape.meshR) {
      this.tape.meshL.rotation.y = Math.PI / 2;
      this.tape.meshL.rotation.z = 0;
      this.tape.meshL.position.set(this.distance, 1.15, -4.8);

      this.tape.meshR.rotation.y = Math.PI / 2;
      this.tape.meshR.rotation.z = 0;
      this.tape.meshR.position.set(this.distance, 1.15, 4.8);
    }

    // Reset all dynamic hurdles in all lanes to standing upright
    for (const h of this.dynamicHurdles) {
      h.state = 'standing';
      h.angle = 0;
      h.angularVel = 0;
      h.bounce = 0.4;
      h.group.rotation.z = 0;
      h.group.position.x = h.hx;
      h.group.position.y = 0;
    }

    this.setupCompetitors();

    // Initialize all competitors (Human + Bots)
    const allCompetitors = [...this.players.slice(0, 4), ...this.bots];
    for (const c of allCompetitors) {
      const lane = this.laneAssignments.get(c.key) ?? 0;
      const laneZ = LANES_Z[lane] ?? 0;

      this.states.set(c.key, {
        x: 0,
        speed: 0,
        targetSpeed: 0,
        laneZ,
        lane,
        finished: false,
        time: null,
        falseStart: 0,
        stumble: 0,
        jumpWindow: 0,
        isJumping: false,
        jumpVy: 0,
        jumpY: 0,
        cleared: new Set(),
        cleanJumps: 0,
        faults: 0,
        rank: null,
        topSpeed: 0,
        stridePhase: Math.random() * Math.PI * 2,
        botHurdleDecisions: new Map(),
      });

      if (!c.isBot) {
        this.place(c, 0, laneZ, { y: 0, facing: Math.PI / 2 });
      } else {
        c.avatar.group.position.set(0, 0, laneZ);
        c.avatar.facing = Math.PI / 2;
        c.avatar.facingTarget = Math.PI / 2;
      }
    }

    const heatNames = ['QUALIFIERS', 'SEMIFINALS', 'OLYMPIC FINAL'];
    const currentHeatName = heatNames[this.heat - 1] || `HEAT ${this.heat}`;
    this.message = `HEAT ${this.heat} · ${currentHeatName}`;
    this.messageSub = this.hurdleXs ? 'Run and jump over hurdles!' : 'Runners take your marks';
    this.ctx.audio.play('whistle');
  }

  #knockDownHurdle(lane, hx, speed) {
    const h = this.dynamicHurdles.find((x) => x.lane === lane && Math.abs(x.hx - hx) < 0.6);
    if (h && h.state === 'standing') {
      h.state = 'falling';
      h.angularVel = clamp(speed * 0.85, 5.0, 12.0);
      h.bounce = 0.4;
    }
  }

  #updateHurdlesPhysics(dt) {
    if (!this.dynamicHurdles.length) return;

    for (const h of this.dynamicHurdles) {
      if (h.state === 'falling') {
        // Gravitational torque accelerates the forward tilt onto the track
        const torque = 22.0 * Math.sin(Math.max(0.12, h.angle));
        h.angularVel += torque * dt;
        h.angle += h.angularVel * dt;

        // Hurdle hits the ground flat (rotation reaches 90 degrees)
        if (h.angle >= Math.PI / 2) {
          h.angle = Math.PI / 2;
          if (Math.abs(h.angularVel) > 2.5) {
            // Small mechanical rebound bounce
            h.angularVel = -h.angularVel * h.bounce;
            h.bounce *= 0.35;
          } else {
            h.state = 'down';
            h.angularVel = 0;
          }
        }
        h.group.rotation.z = -h.angle;
      }
    }
  }

  update(dt) {
    this.time += dt;
    if (this.phase === 'waiting') {
      if (this.players.length) this.start();
      this.updateCamera();
      return;
    }

    this.phaseTimer -= dt;

    // Process human player inputs
    for (const p of this.players) {
      const events = this.drain(p);
      const s = this.states.get(p.key);
      if (!s) continue;
      for (const e of events) {
        if (e.type === 'jump') {
          s.jumpWindow = 0.75;
        }
      }
    }

    if (this.phase === 'intro') {
      const n = Math.ceil(this.phaseTimer - 1.0);
      if (n > 0 && n <= 3 && n !== this.countTick) {
        this.countTick = n;
        this.ctx.audio.play('count');
      }
      this.messageSub = this.phaseTimer > 1 ? `SET · ${Math.max(1, Math.ceil(this.phaseTimer - 1))}` : 'GO!';

      // False start check for human runners
      for (const p of this.players) {
        const s = this.states.get(p.key);
        if (
          !this.options.demo &&
          s &&
          s.falseStart <= 0 &&
          Number.isFinite(p.motion.run) &&
          p.motion.run > 0.35 &&
          this.phaseTimer > 1.1
        ) {
          s.falseStart = 1.2;
          this.message = 'FALSE START';
          this.messageSub = `${p.name} +1.2s penalty`;
          this.ctx.audio.play('whistle');
        }
      }

      if (this.phaseTimer <= 1) {
        this.phase = 'race';
        this.raceTime = 0;
        this.message = 'GO!';
        this.messageSub = this.hurdleXs ? 'JUMP OVER HURDLES!' : 'PUMP ARMS & HIGH KNEES!';
        this.ctx.audio.play('go');
      }
      this.updateRunners(dt, true);
      this.updateCamera();
      return;
    }

    if (this.phase === 'race') {
      this.raceTime += dt;
      if (this.raceTime > 1.4 && this.message === 'GO!') {
        this.message = '';
        this.messageSub = '';
      }
      this.updateRunners(dt, false);
      this.#updateHurdlesPhysics(dt);
      this.#updateTapeFlutter(dt);

      const allDone = [...this.states.values()].every((s) => s.finished);
      if (allDone) this.endHeat();
      else if (this.firstFinishAt && this.raceTime - this.firstFinishAt > 10) this.endHeat();
      this.updateCamera();
      return;
    }

    if (this.phase === 'results') {
      this.updateRunners(dt, true);
      this.#updateHurdlesPhysics(dt);
      this.#updateTapeFlutter(dt);
      if (this.phaseTimer <= 0) {
        if (this.heat < this.heats) {
          this.heat++;
          this.beginHeat();
        } else {
          this.endSeries();
        }
      }
      this.updateCamera();
      return;
    }

    if (this.phase === 'final' || this.phase === 'podium') {
      this.updateRunners(dt, true);
      this.#updateHurdlesPhysics(dt);
      this.#updateCameraFlashes(dt);
      this.#updateTapeFlutter(dt);
      this.updateCamera();
    }
  }

  updateRunners(dt, frozen) {
    const allCompetitors = [...this.players.slice(0, 4), ...this.bots];

    // Find current human leader position for dynamic AI bot pacing
    let humanLeadX = 0;
    for (const p of this.players) {
      const s = this.states.get(p.key);
      if (s) humanLeadX = Math.max(humanLeadX, s.x);
    }

    // Heat difficulty scaling: Heat 1 (Qualifiers) -> Heat 2 (Semifinals) -> Heat 3 (Olympic Final)
    const heatSpeedScale = this.heat === 1 ? 0.90 : this.heat === 2 ? 0.96 : 1.02;

    for (const c of allCompetitors) {
      const s = this.states.get(c.key);
      if (!s) continue;

      if (!frozen && s.falseStart > 0) s.falseStart = Math.max(0, s.falseStart - dt);
      if (s.stumble > 0) s.stumble = Math.max(0, s.stumble - dt);
      if (s.jumpWindow > 0) s.jumpWindow = Math.max(0, s.jumpWindow - dt);

      let target = 0;

      if (!c.isBot) {
        // --- HUMAN RUNNER KINEMATICS ---
        if (!frozen && !s.finished && s.falseStart <= 0) {
          const trackedRun = Number.isFinite(c.motion.run) ? c.motion.run : 0;
          const cadence = Number(c.motion.cadence) || 0;
          const limbRun = (Number(c.motion.legDrive) || 0) * 0.55 + (Number(c.motion.armDrive) || 0) * 0.25;
          const run = Math.max(trackedRun, limbRun, (Number(c.motion.energy) || 0) * 0.8, cadence * 0.35);
          target = clamp(run, 0, 1.0) * this.maxSpeed;
          if (s.stumble > 0) target *= 0.35;
        }
        s.speed = damp(s.speed, target, s.stumble > 0 ? 10 : 6.2, dt);

        if (!frozen && s.speed > 2 && c.motion.steps !== c._lastStepCount) {
          c._lastStepCount = c.motion.steps;
          this.ctx.audio.play('step');
        }

        // --- TWO-FOOT VERTICAL JUMP TRAJECTORY PHYSICS (Hurdles Only) ---
        let effectiveJumpY = 0;
        if (this.hurdleXs) {
          const jumpInput = Math.max(Number(c.motion.jump) || 0, s.jumpWindow > 0 ? 0.8 : 0);
          if (jumpInput > 0.45 && !s.isJumping) {
            s.isJumping = true;
            s.jumpVy = 4.4 * clamp(jumpInput * 1.35, 0.85, 1.35);
            s.jumpY = 0.05;
          }

          if (s.isJumping) {
            s.jumpVy -= 11.5 * dt;
            s.jumpY += s.jumpVy * dt;
            if (s.jumpY <= 0) {
              s.jumpY = 0;
              s.jumpVy = 0;
              s.isJumping = false;
            }
          }
          effectiveJumpY = s.jumpY;
        }

        // --- HURDLE PASSING & KNOCK-DOWN COLLISION ---
        if (this.hurdleXs && !s.finished) {
          for (const hx of this.hurdleXs) {
            if (s.cleared.has(hx)) continue;

            if (s.x >= hx - 0.75 && s.x <= hx + 0.3) {
              if (effectiveJumpY >= 0.65) {
                // CLEAN JUMP OVER HURDLE!
                s.cleared.add(hx);
                s.cleanJumps = (s.cleanJumps || 0) + 1;
                this.points.set(c.key, (this.points.get(c.key) || 0) + 1); // +1 point bonus!
                this.fx.ring({ x: hx, y: 1.05, z: s.laneZ }, c.color, 1.5, 0.4);
                this.ctx.audio.play('whistle');
                this.message = 'CLEAN JUMP!';
                this.messageSub = `${c.name} +1 pt clearance bonus`;
              } else if (s.x >= hx - 0.15) {
                // FAILED JUMP: KNOCK-DOWN COLLISION & PUSH!
                s.cleared.add(hx);
                s.faults = (s.faults || 0) + 1;
                s.stumble = 1.1;
                s.speed *= 0.48;
                // Fault penalty: -2 points deducted!
                const curPts = this.points.get(c.key) || 0;
                this.points.set(c.key, Math.max(0, curPts - 2));
                this.#knockDownHurdle(s.lane, hx, s.speed);
                this.ctx.audio.play('stumble');
                this.ctx.engine.shake(0.22, 0.35);
                this.fx.burst({ x: hx, y: 0.6, z: s.laneZ }, '#fbbf24', 20, { speed: 3.5, life: 0.5 });
                this.message = 'HURDLE DOWN!';
                this.messageSub = `${c.name} fault: -2 pts deduction`;
              }
            }
          }
        }

        // Place human avatar facing forward along track (+X)
        this.place(c, s.x, s.laneZ, { y: effectiveJumpY, facing: Math.PI / 2 });
      } else {
        // --- OLYMPIC BOT AI KINEMATICS & STAMINA PROFILES ---
        if (!frozen && !s.finished) {
          let botTarget = c.baseSpeed * heatSpeedScale;

          if (c.style === 'explosive') {
            // LIGHTNING: Blazing early acceleration (0-25m), slight fatigue in final 15m
            if (s.x < 25) botTarget *= 1.06;
            else if (s.x > this.distance - 15) botTarget *= 0.94;
          } else if (c.style === 'pacer') {
            // TITAN: Steady contender, pushes shoulder-to-shoulder with human leader
            if (Math.abs(s.x - humanLeadX) < 3.0) {
              botTarget = Math.max(botTarget, (this.states.get(this.players[0]?.key)?.speed || 8.5) + 0.15);
            }
          } else if (c.style === 'surge') {
            // PHOENIX: Conserves in first 30m, explosive closing kick in the final 25m!
            if (s.x < 30) botTarget *= 0.92;
            else if (s.x > this.distance - 25) botTarget *= 1.10;
          }

          s.speed = damp(s.speed, botTarget, c.accel, dt);
          c.motion.cadence = clamp(s.speed / 2.3, 1.2, 4.4);
        } else if (frozen) {
          s.speed = damp(s.speed, 0, 4, dt);
        }

        // --- BOT HURDLE JUMP & FAULT COLLISION ---
        let botJumpY = 0;
        if (this.hurdleXs && !s.finished) {
          for (const hx of this.hurdleXs) {
            if (s.cleared.has(hx)) continue;

            if (s.x >= hx - 1.35 && s.x <= hx + 0.3) {
              if (!s.botHurdleDecisions.has(hx)) {
                const cleanRate = this.heat === 1 ? 0.82 : this.heat === 2 ? 0.90 : 0.96;
                s.botHurdleDecisions.set(hx, Math.random() < cleanRate);
              }

              if (s.botHurdleDecisions.get(hx)) {
                // Bot clean parabolic jump
                const prog = clamp((s.x - (hx - 1.35)) / 1.6, 0, 1);
                botJumpY = Math.sin(prog * Math.PI) * 0.82;
                if (s.x >= hx + 0.15 && !s.cleared.has(hx)) {
                  s.cleared.add(hx);
                  s.cleanJumps = (s.cleanJumps || 0) + 1;
                  this.points.set(c.key, (this.points.get(c.key) || 0) + 1);
                  this.fx.ring({ x: hx, y: 1.05, z: s.laneZ }, c.color, 1.2, 0.35);
                }
              } else {
                // Bot clips/knocks hurdle
                botJumpY = 0.25;
                if (s.x >= hx - 0.15 && !s.cleared.has(hx)) {
                  s.cleared.add(hx);
                  s.faults = (s.faults || 0) + 1;
                  s.stumble = 0.9;
                  s.speed *= 0.52;
                  const curPts = this.points.get(c.key) || 0;
                  this.points.set(c.key, Math.max(0, curPts - 2));
                  this.#knockDownHurdle(s.lane, hx, s.speed);
                  this.ctx.audio.play('stumble');
                  this.fx.burst({ x: hx, y: 0.6, z: s.laneZ }, '#fbbf24', 16, { speed: 3.0, life: 0.4 });
                }
              }
            }
          }
        }

        // Whole-body running biomechanics: spine bob, athletic lean, counter-pumping arms & driving knees
        s.stridePhase += dt * (s.speed / 1.7) * Math.PI * 2;
        const phase = s.stridePhase;
        const speedNorm = clamp(s.speed / 9.0, 0, 1.2);

        // 1. Vertical bounce of whole body (hips, spine, head) at 2x stride frequency
        const bounce = Math.abs(Math.sin(phase)) * 0.06 * speedNorm;
        const hipY = 0.82 - bounce;

        // 2. Forward athletic lean of torso (spine leans forward into sprint in local +Z)
        const forwardLean = 0.08 + speedNorm * 0.14;

        // 3. Stride kinematics for knees, ankles, feet
        const strideReach = 0.28 * speedNorm;
        const kneeLift = 0.35 * speedNorm;

        const legPhaseL = phase;
        const legPhaseR = phase + Math.PI;

        const knL_Z = Math.sin(legPhaseL) * strideReach;
        const knL_Y = 0.44 + Math.max(0, Math.sin(legPhaseL)) * kneeLift;
        const anL_Z = Math.sin(legPhaseL - 0.35) * strideReach * 1.15;
        const anL_Y = Math.max(0.04, 0.16 + Math.max(0, Math.sin(legPhaseL)) * kneeLift * 0.7);

        const knR_Z = Math.sin(legPhaseR) * strideReach;
        const knR_Y = 0.44 + Math.max(0, Math.sin(legPhaseR)) * kneeLift;
        const anR_Z = Math.sin(legPhaseR - 0.35) * strideReach * 1.15;
        const anR_Y = Math.max(0.04, 0.16 + Math.max(0, Math.sin(legPhaseR)) * kneeLift * 0.7);

        // 4. Arms pump counter to opposite leg
        const armSwing = 0.26 * speedNorm;
        const wrL_Z = Math.sin(legPhaseR) * armSwing;
        const wrL_Y = 0.85 + Math.sin(legPhaseR) * 0.14;
        const wrR_Z = Math.sin(legPhaseL) * armSwing;
        const wrR_Y = 0.85 + Math.sin(legPhaseL) * 0.14;

        // 5. Torso counter-twist: shoulders rotate counter to pelvis
        const torsoTwist = Math.sin(phase) * 0.06 * speedNorm;

        c.avatar.update(null, { x: s.x, z: s.laneZ }, dt, {
          poseTargets: {
            hip: [0, hipY, 0],
            neck: [0, hipY + 0.46, forwardLean],
            head: [0, hipY + 0.65, forwardLean + 0.03],
            shL: [-0.18 + torsoTwist, hipY + 0.42, forwardLean - torsoTwist],
            shR: [0.18 - torsoTwist, hipY + 0.42, forwardLean + torsoTwist],
            elL: [-0.22, hipY + 0.22, -wrL_Z * 0.4 - 0.05],
            elR: [0.22, hipY + 0.22, -wrR_Z * 0.4 - 0.05],
            wrL: [-0.20, wrL_Y, wrL_Z],
            wrR: [0.20, wrR_Y, wrR_Z],
            hipL: [-0.10, hipY, 0],
            hipR: [0.10, hipY, 0],
            knL: [-0.10, knL_Y, knL_Z],
            knR: [0.10, knR_Y, knR_Z],
            anL: [-0.10, anL_Y, anL_Z],
            anR: [0.10, anR_Y, anR_Z],
            ftL: [-0.10, Math.max(0.02, anL_Y - 0.04), anL_Z + 0.08],
            ftR: [0.10, Math.max(0.02, anR_Y - 0.04), anR_Z + 0.08],
          },
          poseLambda: 24,
        });
        c.avatar.group.position.set(s.x, botJumpY, s.laneZ);
        c.avatar.facing = Math.PI / 2;
        c.avatar.facingTarget = Math.PI / 2;

      }

      s.topSpeed = Math.max(s.topSpeed, s.speed);

      // Advance competitor along the track (X-axis)
      if (!s.finished) {
        s.x += s.speed * dt;

        // Finish Line Crossing Detection
        if (s.x >= this.distance) {
          s.x = this.distance;
          s.finished = true;
          s.time = this.raceTime;
          s.rank = this.finishOrder.length + 1;
          this.finishOrder.push(c.key);

          if (!this.firstFinishAt) {
            this.firstFinishAt = this.raceTime;
            // First runner snaps the physical finish line tape!
            this.#snapFinishTape(s.laneZ);
          }

          this.ctx.audio.play('cheer');
          this.fx.confetti({ x: this.distance, y: 1.8, z: s.laneZ }, 45);
        }
      }

      // Dust bursts under sprinting feet
      if (!frozen && s.speed > 2.5) {
        const t = (this.dustTimers.get(c.key) || 0) - dt;
        if (t <= 0) {
          this.dustTimers.set(c.key, 0.14);
          this.fx.burst({ x: s.x - 0.35, y: 0.08, z: s.laneZ }, c.color, 2, { speed: 0.9, life: 0.4, gravity: -1.5 });
        } else this.dustTimers.set(c.key, t);
      }
    }
  }

  #snapFinishTape(winnerLaneZ) {
    this.tape.broken = true;
    this.tape.breakTime = this.raceTime;
    this.ctx.audio.play('cheer');
    this.fx.ring({ x: this.distance, y: 1.15, z: winnerLaneZ }, '#ef4444', 2.2, 0.4);
    this.fx.burst({ x: this.distance, y: 1.15, z: winnerLaneZ }, '#ef4444', 24, { speed: 3.5, life: 0.6 });
  }

  #updateTapeFlutter(dt) {
    if (!this.tape.broken || !this.tape.meshL || !this.tape.meshR) return;

    const elapsed = this.raceTime - this.tape.breakTime;
    const swing = Math.min(1.45, elapsed * 4.2);
    const flutter = Math.sin(elapsed * 22) * 0.12;

    // Left ribbon swings and flutters backward (+X)
    this.tape.meshL.rotation.y = Math.PI / 2 + swing + flutter;
    this.tape.meshL.rotation.z = -Math.sin(elapsed * 18) * 0.08;
    this.tape.meshL.position.x = this.distance + Math.sin(swing) * 0.8;

    // Right ribbon swings and flutters backward (+X)
    this.tape.meshR.rotation.y = Math.PI / 2 - swing - flutter;
    this.tape.meshR.rotation.z = Math.sin(elapsed * 18) * 0.08;
    this.tape.meshR.position.x = this.distance + Math.sin(swing) * 0.8;
  }

  endHeat() {
    if (this.phase !== 'race') return;
    this.phase = 'results';
    this.phaseTimer = 6;

    const allCompetitors = [...this.players.slice(0, 4), ...this.bots];
    const order = allCompetitors
      .map((c) => ({ c, s: this.states.get(c.key) }))
      .sort((a, b) => {
        if (a.s.finished && b.s.finished) return a.s.time - b.s.time;
        if (a.s.finished) return -1;
        if (b.s.finished) return 1;
        return b.s.x - a.s.x;
      });

    const pts = [10, 6, 4, 2];
    order.forEach((o, i) => {
      o.s.rank = i + 1;
      const gained = o.s.finished ? pts[i] || 1 : 0;
      this.points.set(o.c.key, (this.points.get(o.c.key) || 0) + gained);
      o.gained = gained;
    });

    this.results = order.map((o) => ({
      id: o.c.key,
      name: o.c.name,
      color: o.c.color,
      time: o.s.time,
      rank: o.s.rank,
      gained: o.gained,
      total: this.points.get(o.c.key) || 0,
      detail:
        o.s.time != null
          ? `${o.s.time.toFixed(2)}s · ${o.s.cleanJumps || 0} Cleared · ${o.s.faults || 0} Faults`
          : `${(o.s.topSpeed * 3.6).toFixed(0)} km/h`,
    }));

    this.message = `HEAT ${this.heat} COMPLETE`;
    this.messageSub = this.heat < this.heats ? 'Next heat coming up' : 'Olympic Final Standings!';
    this.ctx.audio.play('bell');
    this.fx.confetti({ x: this.distance, y: 3, z: 0 }, 100);
  }

  endSeries() {
    this.phase = 'podium';
    this.phaseTimer = 9999; // DO NOT AUTO-LOOP! Halts on victory podium until user rematches!

    const allCompetitors = [...this.players.slice(0, 4), ...this.bots];
    const standings = allCompetitors
      .map((c) => ({
        c,
        points: this.points.get(c.key) || 0,
        s: this.states.get(c.key),
      }))
      .sort((a, b) => b.points - a.points);

    standings.forEach((st, i) => {
      if (st.s) st.s.rank = i + 1;
      // Face audience & paparazzi camera flashes on podium
      if (st.c.avatar) {
        st.c.avatar.facing = 0;
        st.c.avatar.facingTarget = 0;
      }
    });

    const champ = standings[0];
    this.seriesWinner = champ.c.name;
    const medals = ['🥇 GOLD', '🥈 SILVER', '🥉 BRONZE', '4TH'];

    this.results = standings.map((st, i) => ({
      id: st.c.key,
      name: `${medals[i] || `#${i + 1}`} ${st.c.name}`,
      color: st.c.color,
      rank: i + 1,
      total: st.points,
      detail: `${st.points} PTS · Top ${(st.s.topSpeed * 3.6).toFixed(0)} km/h · ${st.s.cleanJumps || 0} Cleared`,
    }));

    this.message = `🏆 ${champ.c.name.toUpperCase()} WINS OLYMPIC GOLD!`;
    this.messageSub = 'Match won! Halting on podium · Press Space or Rematch to race again';
    this.ctx.audio.play('cheer');
    this.fx.confetti({ x: this.distance - 2, y: 3.5, z: 0 }, 180);

    // Record win in persistent player profile if human player wins series
    if (!champ.c.isBot && champ.c.profile) {
      const prof = champ.c.profile;
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
  }

  #updateCameraFlashes(dt) {
    if (this.phase !== 'final' && this.phase !== 'podium') {
      for (const f of this.cameraFlashes) f.light.intensity = 0;
      return;
    }

    for (const f of this.cameraFlashes) {
      if (f.flashTimer > 0) {
        f.flashTimer -= dt;
        f.light.intensity = Math.max(0, f.flashTimer * 18);
      } else if (Math.random() < 0.08) {
        f.flashTimer = 0.12 + Math.random() * 0.08;
        f.light.intensity = 3.8;
      }
    }
  }

  /**
   * Professional Olympic Tracking Railcam:
   * Smoothly tracks sprinters alongside the track at chest height (+Z rail),
   * showing athletes sprinting to the right with crowd in background stands,
   * transitioning to photo-finish angle at the tape.
   */
  updateCamera() {
    let lead = 0;
    let any = false;
    for (const s of this.states.values()) {
      if (!s.finished) {
        lead = Math.max(lead, s.x);
        any = true;
      }
    }
    if (!any) lead = this.distance;

    if (this.phase === 'podium' || this.phase === 'final') {
      // Podium Victory View
      this.setCamera([this.distance - 3.5, 2.5, 7.5], [this.distance - 0.5, 1.15, 0], 52);
    } else if (lead > this.distance - 8) {
      // Photo-Finish Camera View right at the tape
      const camX = this.distance + 2.8;
      const camY = 1.65;
      const camZ = 5.0;
      this.setCamera([camX, camY, camZ], [this.distance, 1.15, 0], 50);
    } else {
      // Professional Side-Tracking Railcam
      const camX = clamp(lead + 0.8, 3.5, this.distance - 2.5);
      const camY = 2.3;
      const camZ = 7.2;
      this.setCamera([camX, camY, camZ], [camX + 1.2, 1.15, 0], 54);
    }
  }

  getHud() {
    const allCompetitors = [...this.players.slice(0, 4), ...this.bots];

    const list = allCompetitors.map((c) => {
      const s = this.states.get(c.key) || { x: 0, speed: 0, time: null, rank: null, lane: 0, faults: 0, cleanJumps: 0 };
      const pts = this.points.get(c.key) || 0;
      const cadence = Number(c.motion.cadence) || (s.speed > 0 ? s.speed / 2.3 : 0);

      const statusDetail = this.hurdleXs
        ? (s.finished && s.time != null
            ? `🏁 ${s.time.toFixed(2)}s · ${s.cleanJumps || 0} Cleared`
            : `${(s.speed * 3.6).toFixed(0)} km/h · ${s.faults ? `${s.faults} Faults` : `${cadence.toFixed(1)} sps`}`)
        : (s.finished && s.time != null
            ? `🏁 ${s.time.toFixed(2)}s`
            : `${(s.speed * 3.6).toFixed(0)} km/h · ${cadence.toFixed(1)} sps`);

      return {
        id: c.key,
        name: `L${s.lane + 1} · ${c.name}`,
        color: c.color,
        value: clamp(s.x, 0, this.distance),
        max: this.distance,
        label: 'm',
        detail: statusDetail,
        rank: s.rank,
        points: pts,
        active: true,
      };
    });

    const timer = this.phase === 'race' ? this.raceTime : null;
    const humanWinner = this.players[0] && this.seriesWinner === this.players[0].name;

    return {
      title: this.title,
      subtitle:
        this.phase === 'podium' || this.phase === 'final'
          ? 'Olympic Victory Ceremony · Series Complete'
          : `Heat ${this.heat} of ${this.heats} · ${this.hurdleXs ? '110m Hurdles' : '200m Sprint'}`,
      phase: this.phase,
      timer,
      message: this.message,
      messageSub: this.messageSub,
      winnerId: humanWinner ? this.players[0].id : null,
      big:
        this.phase === 'intro'
          ? { text: this.phaseTimer > 1 ? `${Math.max(1, Math.ceil(this.phaseTimer - 1))}` : 'GO!', sub: `HEAT ${this.heat}` }
          : null,
      players: list,
      results: this.results,
      queue: [],
    };
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    for (const b of this.bots) {
      if (b.avatar) b.avatar.dispose();
    }
    this.bots = [];
    super.dispose();
  }
}
