/**
 * Dance: Follow the Coach, Match the Groove, and Ride the Beat!
 *
 * Features:
 * - Tall, illuminated Stage Coach front-and-center on the main stage with VIP DJ headphones & stage outfit.
 * - Full-Body Kinematics Algorithm: Samba & Latin figure-8 hip rolls, Cuban pelvis tilts,
 *   Disco diagonal points, star flares, rhythmic knee bounces, shoulder shimmies, and 90-degree robot locks.
 * - Increasing Tempo Progression: 96 BPM (Warm-Up) -> 112 BPM (Samba Heat) -> 126 BPM (Disco Inferno)
 *   -> 136 BPM (Electro Robot) -> 142 BPM (Grand Finale Climax).
 * - Multi-feature scoring: Sakoe-Chiba banded DTW sequence alignment, sub-beat timing offset
 *   (Early / Perfect / Late), auto-mirror detection, and motion energy rating.
 * - Motivational Announcer & Combo Streaks (x1 to x16).
 * - 22 Arena Paparazzi Camera Flashes & Shouting Crowd Roar.
 * - Persistent Profile Wins update in localStorage and Non-Looping Podium Victory Screen!
 */
import * as THREE from '/vendor/three/three.module.js';
import { BaseGame } from './base.js';
import { buildDanceClub } from '../engine/environments.js';
import { FemaleCoachAvatar } from '../engine/femaleAvatar.js';
import { clamp, damp } from '../shared/math.js';
import { scoreDanceMove } from '../shared/dtw.js';
import { generateReferenceLandmarkFrames } from './danceLibrary.js';
import { crossfadeLandmarks } from '../shared/mocapConverter.js';

const INTRO_BEATS = 4;
const BEATS_PER_MOVE = 2;

/**
 * 20 Choreographed Full-Body Dance Moves across 5 Progressive Styles & Accelerating Tempos.
 * Hands are relative to shoulder centre in shoulder units.
 * lean: -1..1 lateral body lean. twist: -1..1 torso twist.
 * kneeL/kneeR: 0..1 knee drive. hipAmp: 0..1 figure-8 hip sway. shimmy: 0..1 shoulder shake.
 */
const DANCE_ROUTINE = [
  // --- SECTION 1: WARM-UP GROOVE (96 BPM) ---
  {
    name: 'SIDE SWAY LEFT',
    style: 'groove',
    bpm: 96,
    hands: [[-1.2, 0.65], [-0.3, 1.15]],
    lean: -0.75,
    twist: -0.3,
    kneeL: 0.1,
    kneeR: 0.35,
    hipAmp: 0.6,
    shimmy: 0.2,
    tip: 'Sway your body to the left!',
  },
  {
    name: 'SIDE SWAY RIGHT',
    style: 'groove',
    bpm: 96,
    hands: [[0.3, 1.15], [1.2, 0.65]],
    lean: 0.75,
    twist: 0.3,
    kneeL: 0.35,
    kneeR: 0.1,
    hipAmp: 0.6,
    shimmy: 0.2,
    tip: 'Sway smooth to the right!',
  },
  {
    name: 'CHEST ROLL & BOUNCE',
    style: 'groove',
    bpm: 96,
    hands: [[-0.85, 0.35], [0.85, 0.35]],
    lean: 0,
    twist: 0.45,
    kneeL: 0.3,
    kneeR: 0.3,
    hipAmp: 0.7,
    shimmy: 0.3,
    tip: 'Roll your chest and bounce!',
  },
  {
    name: 'STEP & CLAP',
    style: 'groove',
    bpm: 104,
    hands: [[-0.12, 0.55], [0.12, 0.55]],
    lean: 0.25,
    twist: 0.2,
    kneeL: 0.25,
    kneeR: 0.25,
    hipAmp: 0.5,
    shimmy: 0.1,
    tip: 'Step and clap together on beat!',
  },

  // --- SECTION 2: SAMBA & LATIN HEAT (112 - 120 BPM) ---
  {
    name: 'SAMBA HIP ROLL L',
    style: 'samba',
    bpm: 112,
    hands: [[-1.15, 1.45], [0.45, 0.55]],
    lean: -0.85,
    twist: -0.55,
    kneeL: 0.55,
    kneeR: 0.15,
    hipAmp: 0.95,
    shimmy: 0.65,
    tip: 'Roll your hips in a figure-8!',
  },
  {
    name: 'SAMBA HIP ROLL R',
    style: 'samba',
    bpm: 112,
    hands: [[-0.45, 0.55], [1.15, 1.45]],
    lean: 0.85,
    twist: 0.55,
    kneeL: 0.15,
    kneeR: 0.55,
    hipAmp: 0.95,
    shimmy: 0.65,
    tip: 'Shake those hips to the right!',
  },
  {
    name: 'LATIN SHIMMY SHAKE',
    style: 'samba',
    bpm: 116,
    hands: [[-0.75, 0.85], [0.75, 0.85]],
    lean: 0.15,
    twist: 0.65,
    kneeL: 0.45,
    kneeR: 0.45,
    hipAmp: 0.8,
    shimmy: 1.0,
    tip: 'Rapid shoulder shimmy shake!',
  },
  {
    name: 'SALSA CROSS & POP',
    style: 'samba',
    bpm: 120,
    hands: [[-0.65, 0.25], [1.25, 1.35]],
    lean: 0.6,
    twist: 0.5,
    kneeL: 0.2,
    kneeR: 0.7,
    hipAmp: 0.9,
    shimmy: 0.5,
    tip: 'Cross-step and reach with flair!',
  },
  {
    name: 'MAMBO GROOVE',
    style: 'samba',
    bpm: 120,
    hands: [[-0.95, 0.85], [0.95, 0.85]],
    lean: 0,
    twist: 0.4,
    kneeL: 0.6,
    kneeR: 0.2,
    hipAmp: 0.85,
    shimmy: 0.4,
    tip: 'Rock forward and back to the mambo!',
  },

  // --- SECTION 3: DISCO INFERNO (126 - 134 BPM) ---
  {
    name: 'DISCO POINT RIGHT',
    style: 'disco',
    bpm: 126,
    hands: [[-0.55, -0.25], [1.35, 1.75]],
    lean: 0.75,
    twist: 0.65,
    kneeL: 0.15,
    kneeR: 0.5,
    hipAmp: 0.75,
    shimmy: 0.3,
    tip: 'Classic Travolta point to the sky!',
  },
  {
    name: 'DISCO POINT LEFT',
    style: 'disco',
    bpm: 126,
    hands: [[-1.35, 1.75], [0.55, -0.25]],
    lean: -0.75,
    twist: -0.65,
    kneeL: 0.5,
    kneeR: 0.15,
    hipAmp: 0.75,
    shimmy: 0.3,
    tip: 'Point sharp to the high left!',
  },
  {
    name: 'SATURDAY NIGHT FEVER',
    style: 'disco',
    bpm: 128,
    hands: [[-0.45, 0.95], [0.45, 0.95]],
    lean: 0.3,
    twist: 0.45,
    kneeL: 0.4,
    kneeR: 0.4,
    hipAmp: 0.8,
    shimmy: 0.4,
    tip: 'Roll hands and thrust with energy!',
  },
  {
    name: 'YMCA POWER REACH',
    style: 'disco',
    bpm: 132,
    hands: [[-1.25, 1.65], [1.25, 1.65]],
    lean: 0,
    twist: 0,
    kneeL: 0.45,
    kneeR: 0.45,
    hipAmp: 0.6,
    shimmy: 0.2,
    tip: 'Throw both hands high in a V!',
  },
  {
    name: 'STAR JUMP FLARE',
    style: 'disco',
    bpm: 134,
    hands: [[-1.45, 1.35], [1.45, 1.35]],
    lean: 0,
    twist: 0,
    kneeL: 0.65,
    kneeR: 0.65,
    hipAmp: 0.5,
    shimmy: 0.2,
    tip: 'Full-body explosive star flare!',
  },
  {
    name: 'DOUBLE CLAP SNAP',
    style: 'disco',
    bpm: 134,
    hands: [[-0.15, 0.45], [0.15, 0.45]],
    lean: -0.2,
    twist: -0.3,
    kneeL: 0.55,
    kneeR: 0.55,
    hipAmp: 0.7,
    shimmy: 0.3,
    tip: 'Low groove bounce and clap snap!',
  },

  // --- SECTION 4: ROBOT & POPPING / ELECTRO (136 - 138 BPM) ---
  {
    name: 'ROBOT 90 LOCK',
    style: 'robot',
    bpm: 136,
    hands: [[-1.35, 0.2], [1.35, 0.2]],
    lean: 0,
    twist: 0.7,
    kneeL: 0.1,
    kneeR: 0.1,
    hipAmp: 0.1,
    shimmy: 0,
    tip: 'Lock your arms at sharp 90 angles!',
  },
  {
    name: 'ELECTRIC WAVE',
    style: 'robot',
    bpm: 136,
    hands: [[-1.25, 1.25], [0.65, 0.25]],
    lean: -0.4,
    twist: -0.45,
    kneeL: 0.2,
    kneeR: 0.3,
    hipAmp: 0.3,
    shimmy: 0.2,
    tip: 'Send an electric wave through your arms!',
  },
  {
    name: 'PUNCH THE SKY',
    style: 'robot',
    bpm: 138,
    hands: [[-0.45, 1.8], [0.45, 1.8]],
    lean: 0,
    twist: 0,
    kneeL: 0.65,
    kneeR: 0.15,
    hipAmp: 0.4,
    shimmy: 0.3,
    tip: 'Pump your fists high into the air!',
  },

  // --- SECTION 5: GRAND FINALE CLIMAX (142 BPM) ---
  {
    name: 'FREESTYLE CLIMAX',
    style: 'climax',
    bpm: 142,
    hands: [[-1.3, 1.6], [1.3, 1.6]],
    lean: 0.2,
    twist: 0.5,
    kneeL: 0.8,
    kneeR: 0.8,
    hipAmp: 1.0,
    shimmy: 0.8,
    tip: 'Unleash everything! Jump and groove!',
  },
  {
    name: 'CHAMPION VICTORY POSE',
    style: 'climax',
    bpm: 142,
    hands: [[-0.95, 1.75], [0.95, 1.75]],
    lean: 0,
    twist: 0,
    kneeL: 0.2,
    kneeR: 0.2,
    hipAmp: 0.2,
    shimmy: 0,
    tip: 'Hold the grand champion victory pose!',
  },
];

const JOINT_KEYS = [
  'hip', 'neck', 'head', 'shL', 'shR', 'elL', 'elR',
  'wrL', 'wrR', 'hipL', 'hipR', 'knL', 'knR', 'anL', 'anR', 'ftL', 'ftR'
];

function blankDance() {
  return {
    score: 0,
    combo: 0,
    bestCombo: 0,
    perfects: 0,
    greats: 0,
    goods: 0,
    misses: 0,
    attempts: 0,
    matchTotal: 0,
    lastMatch: 0,
    energy: 0,
    grade: '',
  };
}

export class DanceGame extends BaseGame {
  constructor(ctx, options = {}) {
    super(ctx, options);
    this.id = 'dance';
    this.title = 'DANCE';
    this.subtitle = 'Rhythm Club · Follow the Coach';
    this.phase = 'waiting';

    let customMoves = [];
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('ar_custom_dance_moves');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            customMoves = parsed.map(m => {
              m.useBakedFrames = true;
              return m;
            });
          }
        }
      }
    } catch {}

    const defaultMoves = DANCE_ROUTINE.map(m => {
      if (!m.frames) {
        m.frames = generateReferenceLandmarkFrames(m, 30);
      }
      return m;
    });

    this.moves = [...customMoves, ...defaultMoves];
    this.moveIndex = 0;
    this.currentMove = this.moves[0];
    this.prevMove = null;
    this.moveStartTime = 0;
    this.bpm = this.currentMove.bpm;

    this.routineStart = 0;
    this.danceEnd = 0;
    this.lastBeat = -1;
    this.lastStep = -1;
    this.resultsEnd = 0;
    this.feedbackTimer = 0;

    // Stage Coach
    this.coach = null;
    this.coachHome = new THREE.Vector3(0, 0.83, -2.4); // Tall & at center on main illuminated stage
    this.coachPose = {};
    for (const k of JOINT_KEYS) this.coachPose[k] = new THREE.Vector3();

    // 22 Arena Paparazzi Camera Flashes
    this.cameraFlashes = [];
    this.winner = null;

    // Key listener for rematch / space
    this.onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space' && (this.phase === 'results' || this.phase === 'podium')) {
        this.#beginRoutine();
      }
    };
    window.addEventListener('keydown', this.onKey);
  }

  buildWorld() {
    this.env = buildDanceClub();
    const scene = this.env.scene;

    // The Female Coach stands tall and commanding front-and-center on the illuminated elevated stage
    this.coach = new FemaleCoachAvatar({ name: 'CHAMPION COACH', color: '#f472b6' });
    this.coach.group.scale.set(1.18, 1.18, 1.18);
    this.coach.group.position.copy(this.coachHome);
    this.coach.facing = 0;
    this.coach.facingTarget = 0;
    this.coach.setOnline(true);
    scene.add(this.coach.group);

    // Optional Rigged 3D Model support: GLB/GLTF or Mixamo FBX (e.g. coach.glb, coach.fbx, Excited.fbx)
    this.#loadCustomCoach(scene);

    // Dedicated overhead follow spotlight on the Coach
    const coachSpot = new THREE.SpotLight(0xf472b6, 38, 16, Math.PI / 5, 0.45);
    coachSpot.position.set(0, 6.4, -1.0);
    coachSpot.target.position.set(0, 1.5, -2.4);
    scene.add(coachSpot);
    scene.add(coachSpot.target);

    // 22 Arena Paparazzi Camera Flashes
    this.cameraFlashes = this.#createCameraFlashes(scene);
  }

  async #loadCustomCoach(scene) {
    // 1. Try GLTF/GLB (/models/coach.glb)
    try {
      const { GLTFLoader } = await import('/vendor/three/GLTFLoader.js');
      const loader = new GLTFLoader();
      loader.load(
        '/models/coach.glb',
        (gltf) => {
          if (!gltf || !gltf.scene) return;
          this.#setupCustomCoachModel(scene, gltf.scene, gltf.animations, 1.18);
        },
        undefined,
        () => {
          // GLB not found, fallback to checking FBX
          this.#loadFBXCoach(scene);
        }
      );
    } catch {
      this.#loadFBXCoach(scene);
    }
  }

  async #loadFBXCoach(scene) {
    try {
      const { FBXLoader } = await import('/vendor/three/FBXLoader.js');
      const loader = new FBXLoader();
      const candidates = ['/models/coach.fbx', '/models/Excited.fbx'];

      const tryCandidate = (idx) => {
        if (idx >= candidates.length) return;
        loader.load(
          candidates[idx],
          (fbx) => {
            if (!fbx) return;
            // Measure bounding box to normalize FBX (Mixamo cm) to ~2.05m tall
            const box = new THREE.Box3().setFromObject(fbx);
            const size = new THREE.Vector3();
            box.getSize(size);
            const scale = size.y > 0 ? 2.05 / size.y : 0.0118;
            this.#setupCustomCoachModel(scene, fbx, fbx.animations, scale);
          },
          undefined,
          () => tryCandidate(idx + 1)
        );
      };

      tryCandidate(0);
    } catch (err) {
      // Fallback silently to built-in FemaleCoachAvatar
    }
  }

  #setupCustomCoachModel(scene, model, animations, scaleFactor = 1.0) {
    if (!model) return;
    this.coach.setVisible(false);
    this.customModel = model;
    this.customModel.position.copy(this.coachHome);
    this.customModel.scale.setScalar(scaleFactor);
    this.customModel.rotation.y = 0; // face toward front audience

    this.customModel.traverse((child) => {
      if (child.isMesh || child.isSkinnedMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    scene.add(this.customModel);

    if (animations && animations.length > 0) {
      this.animMixer = new THREE.AnimationMixer(this.customModel);
      const clip = animations.find((a) => a.tracks && a.tracks.length > 0) || animations[0];
      const action = this.animMixer.clipAction(clip);
      action.play();
    }
  }

  #createCameraFlashes(scene) {
    const flashes = [];
    for (let i = 0; i < 22; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 24);
      const frac = i / 22;
      const angle = frac * Math.PI * 2;
      const r = 9.5 + Math.random() * 3.5;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r - 1.5;
      const y = 2.8 + Math.random() * 3.8;
      light.position.set(x, y, z);
      scene.add(light);
      flashes.push({ light, flashTimer: 0 });
    }
    return flashes;
  }

  start() {
    if (!this.players.length) {
      this.phase = 'waiting';
      this.message = 'WAVE TO JOIN';
      this.messageSub = 'Step onto the dance floor to begin!';
      return;
    }
    this.#beginRoutine();
  }

  addPlayer(p) {
    if (p.joined === false) return;
    super.addPlayer(p);
    p.avatar.setProp('none');
    p.avatar.seated = false;
    p.avatar.followStage = false;
    p.avatar.setVisible(true);
    p.dance = p.dance || blankDance();
    this.#placePlayers();
  }

  #beginRoutine() {
    this.phase = 'intro';
    this.routineStart = this.time;
    this.moveIndex = 0;
    this.currentMove = this.moves[0];
    this.bpm = this.currentMove.bpm;

    // Total beats calculation
    const totalMoveBeats = this.moves.length * BEATS_PER_MOVE;
    this.danceEnd = (INTRO_BEATS + totalMoveBeats) * (60 / this.bpm);

    this.lastBeat = -1;
    this.resultsEnd = 0;
    this.feedbackTimer = 0;
    this.winner = null;

    this.message = 'GET READY!';
    this.messageSub = 'Stand tall · Watch the coach at center stage';
    for (const p of this.players) p.dance = blankDance();

    this.#placePlayers();
    this.ctx.audio?.unlock?.();
    this.ctx.audio?.playMusicTrack?.({ loop: true, volume: 0.7 });
    this.ctx.audio.play('danceStart');
  }

  /**
   * Positions human players on the dance floor in front of the stage.
   * If single player: placed slightly to the right so center coach is 100% visible!
   */
  #placePlayers() {
    const n = this.players.length;
    if (n === 1) {
      this.place(this.players[0], 1.25, 1.25, { y: 0, facing: 0 });
      this.players[0].avatar.setVisible(true);
    } else {
      const spacing = Math.min(1.7, 5.4 / (n - 1));
      this.players.forEach((p, i) => {
        const x = (i - (n - 1) / 2) * spacing;
        this.place(p, x, 1.35, { y: 0, facing: 0 });
        p.avatar.setVisible(true);
      });
    }
  }

  update(dt) {
    this.time += dt;
    this.feedbackTimer = Math.max(0, this.feedbackTimer - dt);

    if (this.phase === 'waiting') {
      if (this.players.length) this.start();
      this.updateCamera();
      return;
    }

    this.env.update?.(dt, this.time);
    this.#placePlayers();

    const localTime = Math.max(0, this.time - this.routineStart);

    // Dynamic Tempo Calculation & Beat Progression
    const beatSec = 60 / this.bpm;
    const beat = Math.floor(localTime / beatSec);

    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      this.#onBeat(beat, localTime);
    }

    // Step 16th-note procedural genre-specific dance music
    if (this.phase === 'dance') {
      const sixteenthSec = beatSec * 0.25;
      const currentStep = Math.floor(localTime / sixteenthSec);
      if (currentStep !== this.lastStep) {
        this.lastStep = currentStep;
        const style = this.currentMove?.style || 'samba';
        this.ctx.audio?.stepDanceMusic?.({ style, bpm: this.bpm, step: currentStep });
      }
    }

    // Step continuous full-body dance kinematics for the Coach
    this.#updateCoachKinematics(dt, localTime);
    if (this.animMixer) {
      this.animMixer.update(dt * (this.bpm / 120));
    }

    // Track real-time motion frames for players
    if (this.phase === 'dance') {
      for (const p of this.players) {
        if (!p.motion) continue;
        p.danceFrames = p.danceFrames || [];
        const s = p.motion.state || {};
        p.danceFrames.push({
          handL: { x: s.handL?.x || 0, y: s.handL?.y || 0 },
          handR: { x: s.handR?.x || 0, y: s.handR?.y || 0 },
          lean: s.lean || 0,
          kneeLiftL: s.kneeLiftL || 0,
          kneeLiftR: s.kneeLiftR || 0,
          torsoTwist: s.torsoTwist || 0,
          energy: s.energy || 0,
        });
        if (p.danceFrames.length > 50) p.danceFrames.shift();
      }
    }

    if (this.phase === 'dance' && this.moveIndex >= this.moves.length) {
      this.#endDance();
    }

    if (this.phase === 'podium' || this.phase === 'results') {
      this.#updateCameraFlashes(dt);
    }

    if (this.feedbackTimer <= 0 && this.phase === 'dance') {
      this.message = this.currentMove?.name || 'FEEL THE BEAT';
      this.messageSub = `${this.bpm} BPM · ${this.currentMove?.tip || 'Follow the coach'}`;
    }

    this.updateCamera();
  }

  #onBeat(beat, localTime) {
    if (this.phase === 'intro') {
      const count = INTRO_BEATS - beat;
      if (count > 0) {
        this.message = `${count}`;
        this.messageSub = 'GET READY';
        this.ctx.audio.play('count');
      }
      if (beat >= INTRO_BEATS - 1) {
        this.phase = 'dance';
        this.message = 'DANCE!';
        this.messageSub = 'Follow the coach at center stage!';
        this.ctx.audio.play('go');
      }
      return;
    }

    if (this.phase !== 'dance') return;

    const danceBeat = beat - INTRO_BEATS;
    if (danceBeat < 0) return;

    const moveIdx = Math.floor(danceBeat / BEATS_PER_MOVE);
    const moveBeat = danceBeat % BEATS_PER_MOVE;

    // Dynamic Tempo Acceleration: update BPM to match current move
    if (moveIdx < this.moves.length && moveIdx !== this.moveIndex) {
      this.prevMove = this.moves[this.moveIndex];
      this.moveIndex = moveIdx;
      this.currentMove = this.moves[moveIdx];
      this.bpm = this.currentMove.bpm;
      this.moveStartTime = localTime;
    }

    // Play dynamic rhythmic percussion
    this.ctx.audio.play('beat', { accent: beat % 4 === 0 });
    if (beat % 4 === 2) this.ctx.audio.play('clap');
    if (beat % 8 === 0) this.ctx.audio.play('bass');

    if (moveIdx >= this.moves.length) {
      this.#endDance();
      return;
    }

    if (moveBeat === 0) {
      // Announce move onset
      this.message = this.currentMove.name;
      this.messageSub = `${this.bpm} BPM · ${this.currentMove.tip}`;
      this.feedbackTimer = 0.5;
      return;
    }

    // Move evaluation on 2nd beat: measures DTW trajectory and sub-beat timing
    this.#evaluate(moveIdx);
  }

  /**
   * Full-Body Dancing Kinematics Algorithm:
   * Generates continuous natural dance mechanics including Samba figure-8 hip rolls,
   * Cuban pelvis tilts, disco attitude points, rhythmic knee bounces, and shoulder shimmies.
   */
  #updateCoachKinematics(dt, localTime) {
    if (!this.coach) return;

    const move = this.currentMove || this.moves[0];
    const beatSec = 60 / this.bpm;
    const p = this.coachPose;

    // Optional baked mocap landmark stream playback with 0.25-beat crossfading
    if (move.useBakedFrames && move.frames && move.frames.length > 0) {
      const moveDuration = (move.beats || BEATS_PER_MOVE) * beatSec;
      const timeInMove = Math.max(0, localTime - (this.moveStartTime || 0));
      const normalizedTime = timeInMove % moveDuration;
      const frameIdx = Math.min(move.frames.length - 1, Math.floor((normalizedTime / moveDuration) * move.frames.length));
      let currentLm = move.frames[frameIdx].landmarks;

      // 0.25-beat crossfading from previous move
      const crossfadeDuration = 0.25 * beatSec;
      if (this.prevMove?.frames?.length && timeInMove < crossfadeDuration) {
        const alpha = timeInMove / crossfadeDuration;
        const prevLastLm = this.prevMove.frames[this.prevMove.frames.length - 1].landmarks;
        currentLm = crossfadeLandmarks(prevLastLm, currentLm, alpha);
      }

      const lmToWorld = (lm) => ({
        x: (lm[0] - 0.5) * 1.8,
        y: (0.95 - lm[1]) * 1.8,
        z: (lm[2] || 0) * 1.5,
      });

      const h = lmToWorld(currentLm[0]);
      p.head.set(h.x, h.y + 0.08, h.z);
      const sL = lmToWorld(currentLm[11]);
      const sR = lmToWorld(currentLm[12]);
      p.shL.set(sL.x, sL.y, sL.z);
      p.shR.set(sR.x, sR.y, sR.z);
      p.neck.set((sL.x + sR.x) * 0.5, (sL.y + sR.y) * 0.5, (sL.z + sR.z) * 0.5);

      const eL = lmToWorld(currentLm[13]);
      const eR = lmToWorld(currentLm[14]);
      p.elL.set(eL.x, eL.y, eL.z);
      p.elR.set(eR.x, eR.y, eR.z);

      const wL = lmToWorld(currentLm[15]);
      const wR = lmToWorld(currentLm[16]);
      p.wrL.set(wL.x, wL.y, wL.z);
      p.wrR.set(wR.x, wR.y, wR.z);

      const hpL = lmToWorld(currentLm[23]);
      const hpR = lmToWorld(currentLm[24]);
      p.hipL.set(hpL.x, hpL.y, hpL.z);
      p.hipR.set(hpR.x, hpR.y, hpR.z);
      p.hip.set((hpL.x + hpR.x) * 0.5, (hpL.y + hpR.y) * 0.5, (hpL.z + hpR.z) * 0.5);

      const kL = lmToWorld(currentLm[25]);
      const kR = lmToWorld(currentLm[26]);
      p.knL.set(kL.x, kL.y, kL.z);
      p.knR.set(kR.x, kR.y, kR.z);

      const aL = lmToWorld(currentLm[27]);
      const aR = lmToWorld(currentLm[28]);
      p.anL.set(aL.x, aL.y, aL.z);
      p.anR.set(aR.x, aR.y, aR.z);

      const fL = lmToWorld(currentLm[31]);
      const fR = lmToWorld(currentLm[32]);
      p.ftL.set(fL.x, Math.max(0.04, fL.y), fL.z);
      p.ftR.set(fR.x, Math.max(0.04, fR.y), fR.z);

      this.coach.facing = 0;
      this.coach.facingTarget = 0;
      this.coach.group.position.copy(this.coachHome);
      this.coach.update(null, null, dt, {
        active: false,
        poseTargets: this.coachPose,
        poseLambda: 18,
      });
      return;
    }

    const beatPhase = (localTime / beatSec) % 1;
    const beatPulse = Math.sin(beatPhase * Math.PI * 2);
    const bounce = Math.abs(Math.sin(beatPhase * Math.PI)); // Vertical knee compression on beat

    const p = this.coachPose;
    const style = move.style || 'groove';

    // 1. HIP & PELVIS KINEMATICS ENGINE
    let hipX = 0;
    let hipZ = 0;
    let pelvisTilt = 0;
    let torsoTwist = 0;
    let shimmy = 0;

    if (style === 'samba') {
      // Samba / Latin figure-8 hip roll & Cuban motion
      const sambaFreq = (this.bpm / 60) * Math.PI;
      hipX = Math.sin(localTime * sambaFreq) * 0.22 * (move.hipAmp || 0.8);
      hipZ = Math.sin(localTime * sambaFreq * 2) * 0.12 * (move.hipAmp || 0.8);
      pelvisTilt = Math.sin(localTime * sambaFreq) * 0.26 * (move.hipAmp || 0.8);
      torsoTwist = -Math.sin(localTime * sambaFreq) * 0.35;
      shimmy = Math.sin(localTime * sambaFreq * 4) * 0.04 * (move.shimmy || 0.5);
    } else if (style === 'disco') {
      // High-paced Disco hip pops & diagonal lunges
      hipX = (move.lean || 0) * 0.26 + beatPulse * 0.08;
      hipZ = Math.sin(beatPhase * Math.PI * 2) * 0.08;
      pelvisTilt = (move.lean || 0) * 0.22;
      torsoTwist = (move.twist || 0) * 0.45;
      shimmy = Math.sin(beatPhase * Math.PI * 4) * 0.025;
    } else if (style === 'robot') {
      // 90-degree mechanical popping & quantized ticks
      const quantized = Math.floor(beatPhase * 4) / 4;
      hipX = (move.lean || 0) * 0.15;
      hipZ = 0;
      pelvisTilt = 0;
      torsoTwist = (move.twist || 0) * 0.6;
      shimmy = 0;
    } else {
      // Groove / Climax
      hipX = (move.lean || 0) * 0.2 + beatPulse * 0.06;
      hipZ = Math.sin(localTime * 4.0) * 0.06;
      pelvisTilt = (move.lean || 0) * 0.16;
      torsoTwist = (move.twist || 0) * 0.35;
      shimmy = Math.sin(localTime * 12.0) * 0.02;
    }

    // Vertical bounce: knees compress on downbeat (0.12m dynamic bounce)
    const bounceY = (1 - bounce) * 0.12;
    const hipY = 0.94 - bounceY;

    p.hip.set(hipX, hipY, hipZ);
    p.hipL.set(-0.12 + hipX * 0.4, hipY + pelvisTilt * 0.07, hipZ - torsoTwist * 0.04);
    p.hipR.set(0.12 + hipX * 0.4, hipY - pelvisTilt * 0.07, hipZ + torsoTwist * 0.04);

    // 2. SPINE, TORSO & SHOULDER ENGINE
    const shBaseY = 1.38 - bounceY * 0.7;
    p.neck.set(hipX * 0.3 - (move.lean || 0) * 0.06, 1.44 - bounceY * 0.6, torsoTwist * 0.05);
    p.head.set(hipX * 0.2 - (move.lean || 0) * 0.08, 1.66 - bounceY * 0.5 + beatPulse * 0.015, torsoTwist * 0.08);

    // Counter-tilt shoulders for natural athletic dancer line
    p.shL.set(-0.22 + hipX * 0.3, shBaseY - pelvisTilt * 0.07 + shimmy, torsoTwist * 0.08);
    p.shR.set(0.22 + hipX * 0.3, shBaseY + pelvisTilt * 0.07 - shimmy, -torsoTwist * 0.08);

    // 3. EXPRESSIVE 3D ARM & WRIST REACH ENGINE (Full-scale arm extensions)
    const armReach = 0.68;
    const targetL = move.hands[0];
    const targetR = move.hands[1];

    p.wrL.set(
      p.shL.x + targetL[0] * armReach,
      p.shL.y + targetL[1] * armReach,
      0.1 + (targetL[2] || 0) - torsoTwist * 0.05
    );
    p.wrR.set(
      p.shR.x + targetR[0] * armReach,
      p.shR.y + targetR[1] * armReach,
      0.1 + (targetR[2] || 0) + torsoTwist * 0.05
    );

    // Elbows flex naturally between shoulders and wrists
    p.elL.set(
      p.shL.x + (p.wrL.x - p.shL.x) * 0.52,
      p.shL.y + (p.wrL.y - p.shL.y) * 0.52 - 0.06,
      0.06
    );
    p.elR.set(
      p.shR.x + (p.wrR.x - p.shR.x) * 0.52,
      p.shR.y + (p.wrR.y - p.shR.y) * 0.52 - 0.06,
      0.06
    );

    // 4. LEG, KNEE & FOOT KINEMATICS ENGINE
    const kneeLiftL = clamp(move.kneeL || 0, 0, 1);
    const kneeLiftR = clamp(move.kneeR || 0, 0, 1);

    p.knL.set(
      p.hipL.x - 0.02,
      0.50 - bounceY * 0.5 + kneeLiftL * 0.35,
      0.04 + kneeLiftL * 0.22
    );
    p.knR.set(
      p.hipR.x + 0.02,
      0.50 - bounceY * 0.5 + kneeLiftR * 0.35,
      0.04 + kneeLiftR * 0.22
    );

    p.anL.set(p.hipL.x - 0.03, 0.08 + kneeLiftL * 0.38, 0.02 + kneeLiftL * 0.24);
    p.anR.set(p.hipR.x + 0.03, 0.08 + kneeLiftR * 0.38, 0.02 + kneeLiftR * 0.24);

    p.ftL.set(p.anL.x, Math.max(0.04, p.anL.y - 0.04), p.anL.z + 0.1);
    p.ftR.set(p.anR.x, Math.max(0.04, p.anR.y - 0.04), p.anR.z + 0.1);

    // Update Coach Avatar
    this.coach.facing = 0;
    this.coach.facingTarget = 0;
    this.coach.group.position.copy(this.coachHome);
    this.coach.update(null, null, dt, {
      active: false,
      poseTargets: this.coachPose,
      poseLambda: 18,
    });
  }

  #evaluate(moveIndex) {
    const move = this.moves[moveIndex];
    if (!move) return;
    let best = null;

    for (const p of this.players) {
      if (!p.motion) continue;
      const state = p.motion.state || {};

      // DTW windowed sequence evaluation with mirror detection & timing offset
      const dtw = scoreDanceMove(p.danceFrames, move);
      p.danceFrames = []; // reset window

      // Instantaneous posture match at peak
      const instantMatch = this.#comparePose(state, move);
      const match = clamp(dtw.match * 0.72 + instantMatch * 0.28, 0, 1);
      const energy = clamp(Number(state.energy) || 0, 0, 1);

      const d = (p.dance = p.dance || blankDance());
      d.attempts++;
      d.matchTotal += match;
      d.lastMatch = match;
      d.energy = energy;
      d.timingOffsetMs = dtw.timingOffsetMs;
      d.timingLabel = dtw.timingLabel;
      d.isMirror = dtw.isMirror;

      // Energy factor prevents scoring from standing still
      const energyFactor = clamp(0.25 + energy * 1.15, 0.25, 1.35);

      // Combo Multiplier: x1.0, x1.5, x2.0, x2.5 ...
      const comboMult = 1 + clamp(d.combo * 0.08, 0, 2.5);
      const points = Math.round(Math.pow(clamp(match, 0, 1), 1.3) * 220 * energyFactor * comboMult);

      let grade = 'MISS';
      if (match >= 0.80 && energy > 0.14) grade = 'PERFECT';
      else if (match >= 0.62) grade = 'GREAT';
      else if (match >= 0.40) grade = 'GOOD';

      d.grade = grade;
      if (grade === 'MISS') {
        d.misses++;
        d.combo = 0;
      } else {
        d.score += points;
        d.combo++;
        d.bestCombo = Math.max(d.bestCombo, d.combo);
        if (grade === 'PERFECT') d.perfects++;
        else if (grade === 'GREAT') d.greats++;
        else d.goods++;
      }

      if (!best || points > best.points) best = { p, d, match, energy, points, grade, dtw };
    }

    if (!best) return;
    this.feedbackTimer = 1.0;

    const mirrorTag = best.dtw?.isMirror ? ' [MIRROR]' : '';
    const timingTag = best.dtw?.timingLabel ? ` · ${best.dtw.timingLabel}` : '';

    if (best.grade === 'PERFECT') {
      this.message = `PERFECT!! +${best.points}`;
      this.messageSub = `${best.p.name} · ${Math.round(best.match * 100)}% groove${timingTag}${mirrorTag}`;
      this.ctx.audio.play('perfect');
      this.ctx.engine.shake(0.14, 0.22);
      this.fx.ring({ x: best.p.avatar.group.position.x, y: 1.3, z: best.p.avatar.group.position.z }, '#fbbf24', 2.0, 0.45);
      this.fx.burst({ x: best.p.avatar.group.position.x, y: 1.3, z: best.p.avatar.group.position.z }, '#fbbf24', 36, { speed: 4.5, life: 0.55 });
    } else if (best.grade === 'GREAT') {
      this.message = `GREAT! +${best.points}`;
      this.messageSub = `${best.p.name} · ${Math.round(best.match * 100)}% form${timingTag}${mirrorTag}`;
      this.ctx.audio.play('great');
      this.fx.ring({ x: best.p.avatar.group.position.x, y: 1.2, z: best.p.avatar.group.position.z }, '#22d3ee', 1.4, 0.35);
    } else if (best.grade === 'GOOD') {
      this.message = `GOOD! +${best.points}`;
      this.messageSub = `${best.p.name} · ${Math.round(best.match * 100)}% form${timingTag}${mirrorTag}`;
      this.ctx.audio.play('good');
    } else {
      this.message = 'MISS!';
      this.messageSub = `${best.p.name} · ${move.tip || 'Follow the coach'}`;
      this.ctx.audio.play('bad');
    }
  }

  #comparePose(state, move) {
    const hL = state.handL || { x: 0, y: 0 };
    const hR = state.handR || { x: 0, y: 0 };
    const targetL = move.hands[0];
    const targetR = move.hands[1];

    const dL = Math.hypot(hL.x - targetL[0], hL.y - targetL[1]);
    const dR = Math.hypot(hR.x - targetR[0], hR.y - targetR[1]);
    const handScore = 1 - clamp((dL + dR) / 2 / 1.75, 0, 1);

    const leanScore = 1 - clamp(Math.abs((state.lean || 0) - (move.lean || 0)) / 1.55, 0, 1);
    const kneeScore =
      1 -
      clamp(
        (Math.abs((state.kneeLiftL || 0) - (move.kneeL || 0)) +
          Math.abs((state.kneeLiftR || 0) - (move.kneeR || 0))) / 2,
        0,
        1
      );
    const twistScore = 1 - clamp(Math.abs((state.torsoTwist || 0) - (move.twist || 0)) / 1.8, 0, 1);

    return clamp(handScore * 0.55 + leanScore * 0.15 + kneeScore * 0.2 + twistScore * 0.1, 0, 1);
  }

  #endDance() {
    if (this.phase === 'podium' || this.phase === 'results') return;
    this.ctx.audio?.stopMusicTrack?.();
    this.phase = 'podium';
    this.resultsEnd = this.time + 9999; // NO AUTO-LOOP! Halts on victory podium until user rematches!

    const ranked = [...this.players].sort((a, b) => (b.dance?.score || 0) - (a.dance?.score || 0));
    const champ = ranked[0];
    this.winner = champ?.name || null;

    // Performance Rank
    const avgAccuracy = champ?.dance?.attempts
      ? Math.round((champ.dance.matchTotal / champ.dance.attempts) * 100)
      : 0;

    let rankTitle = 'PARTY DANCER';
    if (avgAccuracy >= 90) rankTitle = '🌟 SSS DANCE GOD';
    else if (avgAccuracy >= 80) rankTitle = '⭐ S GROOVE MASTER';
    else if (avgAccuracy >= 70) rankTitle = '🥇 A DISCO LEGEND';
    else if (avgAccuracy >= 55) rankTitle = '🥈 B RHYTHM STAR';

    this.message = champ ? `🏆 ${champ.name.toUpperCase()} OWNS THE FLOOR!` : 'ROUTINE COMPLETE';
    this.messageSub = `${rankTitle} · Halting on podium · Press Space or Rematch to dance again`;

    this.ctx.audio.play('cheer');
    this.ctx.audio.play('danceEnd');
    this.fx.confetti({ x: 0, y: 2.4, z: -1.2 }, 180);
    this.ctx.engine.shake(0.2, 0.4);

    // Persistent Profile Update in localStorage
    if (champ && champ.profile) {
      const prof = champ.profile;
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

  updateCamera() {
    // Camera looks from slightly elevated angle capturing both the foreground dancers and the tall center coach
    this.setCamera([0, 2.45, 7.8], [0, 1.35, -0.8], 50);
  }

  getHud() {
    const localTime = Math.max(0, this.time - this.routineStart);
    const list = this.players
      .map((p) => {
        const d = p.dance || blankDance();
        const accuracy = d.attempts ? Math.round((d.matchTotal / d.attempts) * 100) : 0;
        return {
          id: p.key,
          name: p.name,
          color: p.color,
          value: d.score,
          max: 0,
          label: '',
          points: d.score,
          detail: `Combo x${d.combo} · ${accuracy}% groove · ${Math.round(d.energy * 100)}% energy`,
          rank: null,
          active: true,
        };
      })
      .sort((a, b) => b.points - a.points)
      .map((x, i) => ({ ...x, rank: i + 1 }));

    const best = list[0];
    const scoreLine = best
      ? `SCORE ${Math.round(best.points).toLocaleString()} · ${best.detail}`
      : '';

    const results =
      this.phase === 'results' || this.phase === 'podium'
        ? list.map((p) => ({
            name: p.name,
            color: p.color,
            detail: p.detail,
            rank: p.rank,
            gained: p.points,
          }))
        : [];

    const beatSec = 60 / this.bpm;
    const introBeat = Math.floor(localTime / beatSec);

    return {
      title: this.title,
      subtitle: `${this.bpm} BPM · ${this.currentMove?.style?.toUpperCase() || 'GROOVE'} · Move ${this.moveIndex + 1} of ${this.moves.length}`,
      phase: this.phase,
      timer: this.phase === 'dance' ? Math.max(0, this.danceEnd - localTime) : null,
      score: scoreLine,
      message: this.message,
      messageSub: this.messageSub,
      winnerId: best && this.winner === best.name ? this.players[0]?.id : null,
      big:
        this.phase === 'intro'
          ? { text: `${Math.max(1, INTRO_BEATS - introBeat)}`, sub: 'GET READY!' }
          : null,
      players: list,
      results,
      queue: [],
    };
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    if (this.customModel) {
      this.customModel.removeFromParent();
      this.customModel = null;
    }
    this.animMixer = null;
    if (this.coach) {
      this.coach.dispose();
      this.coach = null;
    }
    super.dispose();
  }
}
