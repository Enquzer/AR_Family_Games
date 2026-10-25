/**
 * Boxing: First-Person & Facing Immersive 1v1 Arena.
 * 
 * Features:
 * - Face-to-face combat orientation with 3D opponent bot in front of you.
 * - Distinct hit kinetics: Head shots snap head back & twist; Torso body shots hunch & buckle.
 * - High Guard Face Block: covering face with both gloves forms peek-a-boo shield, blocking all damage.
 * - Elbow Extension & Power Hits: extended haymakers trigger "HARD HIT!" with extra bounce & pounding sound.
 * - Comic Dizzy Stars: 3D cartoon spinning stars orbit boxer's head when life <= 25% (75% damaged).
 * - Elastic Bounce: hits bounce boxers realistically across ring canvas.
 * - Bot AI Telegraph: bot winds up with visual/audio warning tell, ending autonomous self-play.
 * - Ringside Camera Flashes & Celebratory Crowd: flashes burst and crowd cheers on player victory.
 * - Persistent Player Profile: adds points, updates stats, and increments wins in saved profile.
 */
import * as THREE from '/vendor/three/three.module.js';
import { BaseGame } from './base.js';
import { buildArena } from '../engine/environments.js';
import { Avatar } from '../engine/avatar.js';
import { createRiggedAvatar } from '../engine/riggedModel.js';
import { clamp, damp, lerp } from '../shared/math.js';

const MAX_HP = 100;
const ROUND_TIME = 45;
const ROUNDS_TO_WIN = 2;

export class BoxingGame extends BaseGame {
  constructor(ctx, options = {}) {
    super(ctx, options);
    this.id = 'boxing';
    this.title = 'BOXING';
    this.subtitle = 'First-person fight night';
    this.round = 1;
    this.phaseTimer = 0;
    this.fighters = [];
    this.queue = [];
    this.matchWinner = null;
    this.combo = 0;
    this.lastComboAt = 0;
    this.bot = null;

    // Bot AI state machine
    this.botState = 'idle'; // 'idle' | 'windup' | 'recovery'
    this.botWindupTimer = 0;
    this.botRecoveryTimer = 0;
    this.botNextPunch = 2.8;
    this.botBlockUntil = 0;

    this.introTick = 0;
    this.results = [];

    // View & Kinematics
    this.viewMode = 'fp'; // 'fp' (First Person POV) | 'chase' (Over-The-Shoulder)
    this.overrideCamera = true;
    this.camRecoilZ = 0;
    this.camRecoilRot = 0;
    this.fpGroup = null;
    this.fpGloveL = null;
    this.fpGloveR = null;

    // Arena Effects
    this.cameraFlashes = [];

    this.onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'v' || e.key === 'V' || e.key === 'p' || e.key === 'P') {
        this.toggleView();
      }
    };
    window.addEventListener('keydown', this.onKey);
  }

  buildWorld() {
    this.env = buildArena();
    this.scene = this.env.scene;
    this.#buildFirstPersonGloves();
    this.cameraFlashes = this.#createCameraFlashes();
  }

  #buildFirstPersonGloves() {
    this.fpGroup = new THREE.Group();

    const makeGlove = (colorHex) => {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.35,
        metalness: 0.25,
        emissive: colorHex,
        emissiveIntensity: 0.35,
      });

      // Main padded fist
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 14), mat);
      fist.scale.set(1.05, 1.25, 1.4);
      g.add(fist);

      // Thumb
      const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), mat);
      thumb.position.set(0.08, -0.02, 0.03);
      g.add(thumb);

      // Wrist strap & cuff
      const cuff = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.1, 0.1, 14),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 })
      );
      cuff.position.set(0, -0.11, 0.06);
      g.add(cuff);

      return { group: g, mat, punchT: 0, restPos: new THREE.Vector3() };
    };

    this.fpGloveL = makeGlove(0xef4444);
    this.fpGloveR = makeGlove(0xef4444);

    this.fpGloveL.restPos.set(-0.24, -0.25, -0.62);
    this.fpGloveR.restPos.set(0.24, -0.25, -0.62);

    this.fpGroup.add(this.fpGloveL.group);
    this.fpGroup.add(this.fpGloveR.group);
    this.scene.add(this.fpGroup);
  }

  #createCameraFlashes() {
    const flashes = [];
    for (let i = 0; i < 22; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 22);
      const angle = (i / 22) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const radius = 7.5 + Math.random() * 4.5;
      const y = 2.8 + Math.random() * 4.5;
      light.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      this.scene.add(light);
      flashes.push({ light, flashTimer: 0 });
    }
    return flashes;
  }

  #createDizzyStars() {
    const group = new THREE.Group();
    const starGeo = new THREE.OctahedronGeometry(0.08, 0);
    const starMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.9,
      roughness: 0.2,
      metalness: 0.1,
    });

    const stars = [];
    for (let i = 0; i < 4; i++) {
      const star = new THREE.Mesh(starGeo, starMat);
      star.scale.set(1.2, 0.6, 1.2);
      group.add(star);
      stars.push(star);
    }
    group.rotation.x = 0.28;
    group.visible = false;
    this.scene.add(group);
    return { group, stars };
  }

  toggleView() {
    this.viewMode = this.viewMode === 'fp' ? 'chase' : 'fp';
    if (this.fpGroup) {
      this.fpGroup.visible = this.viewMode === 'fp';
    }
    const f0 = this.fighters[0];
    if (f0 && f0.avatar) {
      f0.avatar.setVisible(this.viewMode === 'chase');
    }
    this.message = this.viewMode === 'fp' ? 'FIRST-PERSON POV' : 'OVER-THE-SHOULDER VIEW';
  }

  start() {
    this.queue = [...this.players];
    this.matchWinner = null;
    this.beginMatch();
  }

  addPlayer(p, mode = 'against') {
    if (p.joined === false) return;
    super.addPlayer(p);
    if (this.phase === 'idle' || this.phase === 'waiting') {
      if (!this.queue.find((x) => x.key === p.key)) this.queue.push(p);
      if (this.queue.length >= 1) this.beginMatch();
    } else if (mode === 'against' && this.fighters[1]?.isBot) {
      // Player 2 takes over opponent corner from bot
      if (this.bot) this.bot.setVisible(false);
      if (this.bot?._rigged) this.bot._rigged.setVisible(false);
      this.fighters[1] = this.#makeFighter(p, 1);
      this.fighters[1].isBot = false;
      this.message = '1V1 MATCH!';
      this.messageSub = `${p.name} joined as Opponent!`;
    } else if (!this.fighters.find((f) => f.p === p)) {
      if (!this.queue.find((x) => x.key === p.key)) this.queue.push(p);
      p.avatar.setVisible(false);
    }
  }

  beginMatch() {
    const real = this.queue.filter((p) => p && p.active !== false && p.joined !== false);
    this.queue = [];
    if (!real.length) {
      this.phase = 'waiting';
      this.message = 'WAVE TO JOIN';
      this.messageSub = 'Stand in view & wave your hand to enter the ring';
      return;
    }
    for (const p of this.players) p.avatar.setVisible(false);
    if (this.bot) {
      this.bot.dispose();
      this.bot = null;
    }
    const p1 = real.shift();
    let p2 = real.shift() || null;
    this.queue = real;
    if (!p2) this.bot = this.#makeBot();

    this.fighters = [
      this.#makeFighter(p1, 0), // Player 1 (Near side, facing opponent)
      p2 ? this.#makeFighter(p2, 1) : this.#makeBotFighter(this.bot, 1), // Opponent
    ];

    // Colorize first-person gloves with player 1's color
    if (this.fpGloveL && this.fpGloveR && p1.color) {
      this.fpGloveL.mat.color.set(p1.color);
      this.fpGloveL.mat.emissive.set(p1.color);
      this.fpGloveR.mat.color.set(p1.color);
      this.fpGloveR.mat.emissive.set(p1.color);
    }

    this.fighters[0].avatar.setVisible(this.viewMode === 'chase');
    this.fighters[1].avatar.setVisible(true);

    for (const p of this.queue) p.avatar.setVisible(false);
    this.round = 1;
    this.results = [];
    this.fighters.forEach((f) => {
      f.roundWins = 0;
      this.#resetStats(f);
    });
    this.matchWinner = null;
    this.beginRound();
  }

  #makeBot() {
    const avatar = new Avatar({ name: 'IRON BOT', color: '#94a3b8', id: 'bot' });
    avatar.setProp('gloves');
    avatar.setOnline(true);
    this.scene.add(avatar.group);

    createRiggedAvatar({
      scene: this.scene,
      color: '#94a3b8',
      height: 1.95,
      facing: 0,
      autoPlay: true,
    })
      .then((rigged) => {
        if (!rigged) return;
        avatar._rigged = rigged;
        avatar.setVisible(false);
      })
      .catch(() => {});

    return avatar;
  }

  #makeFighter(p, side) {
    const isPlayer = side === 0;
    const f = {
      p,
      id: p.key,
      name: p.name,
      color: p.color,
      avatar: p.avatar,
      side,
      baseX: 0,
      baseZ: isPlayer ? 0.95 : -1.25,
      x: 0,
      z: isPlayer ? 0.95 : -1.25,
      facing: isPlayer ? Math.PI : 0,
      hp: MAX_HP,
      stamina: 100,
      roundWins: 0,
      blocking: 0,
      isBot: false,
      lastHitAt: 0,
      lunge: 0,
      flash: 0,
      recoil: { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0 },
      bounceVelZ: 0,
      bounceT: 0,
      dizzyStars: this.#createDizzyStars(),
      dizzyAngle: 0,
      koProgress: 0,
      punchAnim: { active: false, hand: 'R', timer: 0 },
      score: 0,
      punches: 0,
      hits: 0,
      misses: 0,
      blocked: 0,
      damage: 0,
      combo: 0,
      bestCombo: 0,
      accuracy: 0,
    };
    p.avatar.setProp('gloves');
    p.avatar.seated = false;
    p.avatar.followStage = false;
    return f;
  }

  #makeBotFighter(avatar, side) {
    return {
      p: null,
      id: 'bot',
      name: 'IRON BOT',
      color: '#94a3b8',
      avatar,
      side,
      baseX: 0,
      baseZ: -1.25,
      x: 0,
      z: -1.25,
      facing: 0,
      hp: MAX_HP,
      stamina: 100,
      roundWins: 0,
      blocking: 0,
      isBot: true,
      lastHitAt: 0,
      lunge: 0,
      flash: 0,
      recoil: { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0 },
      bounceVelZ: 0,
      bounceT: 0,
      dizzyStars: this.#createDizzyStars(),
      dizzyAngle: 0,
      koProgress: 0,
      punchAnim: { active: false, hand: 'R', timer: 0 },
      score: 0,
      punches: 0,
      hits: 0,
      misses: 0,
      blocked: 0,
      damage: 0,
      combo: 0,
      bestCombo: 0,
      accuracy: 0,
    };
  }

  #resetStats(f) {
    f.score = 0;
    f.punches = 0;
    f.hits = 0;
    f.misses = 0;
    f.blocked = 0;
    f.damage = 0;
    f.combo = 0;
    f.bestCombo = 0;
    f.accuracy = 0;
  }

  #refreshAccuracy(f) {
    f.accuracy = f.punches ? Math.round((f.hits / f.punches) * 100) : 0;
  }

  beginRound() {
    this.phase = 'intro';
    this.phaseTimer = 3.2;
    this.introTick = 0;
    this.message = `ROUND ${this.round}`;
    this.messageSub = 'Raise your gloves · High guard';
    this.botState = 'idle';
    this.botNextPunch = 2.6;

    this.fighters.forEach((f) => {
      f.hp = MAX_HP;
      f.stamina = 100;
      f.x = f.baseX;
      f.z = f.baseZ;
      f.lunge = 0;
      f.blocking = 0;
      f.recoil = { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0 };
      f.bounceVelZ = 0;
      f.bounceT = 0;
      f.koProgress = 0;
      f.punchAnim = { active: false, hand: 'R', timer: 0 };
      f.combo = 0;
      f.lastHitAt = 0;
    });
    this.ctx.audio.play('bell');
  }

  beginFight() {
    this.phase = 'fight';
    this.phaseTimer = ROUND_TIME;
    this.message = 'FIGHT!';
    this.messageSub = 'Cover face to block · snap punches through!';
    this.ctx.audio.play('go');
    this.ctx.engine.shake(0.12, 0.25);
  }

  endRound(winner, reason = '') {
    if (this.phase === 'roundEnd' || this.phase === 'matchEnd') return;
    this.phase = 'roundEnd';
    this.phaseTimer = 4.2;
    if (winner) winner.roundWins++;
    this.message = winner ? `${winner.name.toUpperCase()} TAKES THE ROUND` : 'DRAW';
    this.messageSub = reason;
    this.ctx.audio.play('bell');
    this.ctx.engine.shake(0.25, 0.5);

    const win = winner || this.fighters[0];
    this.fx.confetti({ x: win.x, y: 1.5, z: win.z }, 50);
    if (winner) {
      this.matchWinner = winner.roundWins >= ROUNDS_TO_WIN ? winner : null;
    }
  }

  endMatch() {
    const winner = this.fighters.find((f) => f.roundWins >= ROUNDS_TO_WIN) || this.fighters[0];
    this.phase = 'matchEnd';
    this.phaseTimer = 9999; // Do NOT auto-loop! Stay at victory celebration!
    this.matchWinner = winner;

    const isPlayerWin = winner && !winner.isBot;
    this.message = isPlayerWin ? '🏆 YOU WIN! CHAMPION!' : `${winner.name.toUpperCase()} WINS!`;
    this.messageSub = isPlayerWin
      ? 'Crowd roaring · Arena flashes · Victory recorded in profile!'
      : 'Good fight · Wave or hold to restart';

    this.results = this.fighters
      .map((f) => ({
        name: f.name,
        color: f.color,
        detail: `${f.score} pts · ${f.accuracy}% acc · best x${f.bestCombo}`,
        rank: f.roundWins,
        gained: f.score,
      }))
      .sort((a, b) => b.rank - a.rank || b.gained - a.gained);

    this.ctx.audio.play('cheer');
    this.fx.confetti({ x: 0, y: 2.2, z: 0 }, 140);

    // Record win in persistent player profile
    if (isPlayerWin && winner.p && winner.p.profile) {
      winner.p.profile.wins = (winner.p.profile.wins || 0) + 1;
      winner.p.profile.games = (winner.p.profile.games || 0) + 1;
      winner.p.profile.level = Math.floor(winner.p.profile.wins / 3) + 1;
      try {
        const key = 'arfg_profiles_v2';
        const raw = localStorage.getItem(key);
        if (raw) {
          const list = JSON.parse(raw);
          const found = list.find((x) => x.id === winner.p.profile.id);
          if (found) {
            found.wins = winner.p.profile.wins;
            found.games = winner.p.profile.games;
            found.level = winner.p.profile.level;
            localStorage.setItem(key, JSON.stringify(list));
          }
        }
      } catch {}
    }
  }

  update(dt) {
    this.time += dt;
    this.phaseTimer -= dt;

    // Camera recoil recovery
    this.camRecoilZ = damp(this.camRecoilZ, 0, 7.5, dt);
    this.camRecoilRot = damp(this.camRecoilRot, 0, 8.5, dt);

    for (const f of this.fighters) {
      if (f.flash > 0) f.flash = Math.max(0, f.flash - dt * 4);
      if (f.p) f.stamina = clamp(f.stamina + dt * 4.5, 0, 100);
      if (!f.p) continue;

      const events = this.drain(f.p);
      if (this.phase === 'fight') {
        for (const e of events) {
          if (e.type === 'punch') {
            // First-person glove animation
            if (f.side === 0) {
              if (e.hand === 'L' && this.fpGloveL) this.fpGloveL.punchT = 1.0;
              else if (this.fpGloveR) this.fpGloveR.punchT = 1.0;
            }
            this.tryHit(f, this.fighters[1 - f.side], e);
            f.avatar?.flash?.(f.color, 0.15);
          } else if (e.type === 'kick') {
            f._kickDodgeUntil = performance.now() + 650;
            this.ctx.audio.play('kick', { side: e.side });
            f.avatar?.flash?.('#38bdf8', 0.22);
            this.fx.burst({ x: f.x, y: 0.3, z: f.z }, '#38bdf8', 12, { speed: 2.2, life: 0.35 });
          }
        }
      }
    }

    if (this.phase === 'waiting') {
      const real = this.players.filter((p) => p && p.active && p.joined !== false);
      if (real.length >= 1) {
        this.queue = [...real];
        this.beginMatch();
      }
      this.updateCamera();
      return;
    }

    if (this.phase === 'intro') {
      const n = Math.ceil(this.phaseTimer);
      if (n !== this.introTick && n > 0) {
        this.introTick = n;
        this.ctx.audio.play('count');
      }
      this.messageSub = this.phaseTimer > 0 ? `${Math.max(1, Math.ceil(this.phaseTimer))}` : 'FIGHT!';
      this.updateFighters(dt, true);
      if (this.phaseTimer <= 0) this.beginFight();
    } else if (this.phase === 'fight') {
      this.updateFighters(dt, false);
      this.updateBot(dt);
      if (this.phaseTimer <= 0) {
        const [a, b] = this.fighters;
        this.endRound(a.hp === b.hp ? null : a.hp > b.hp ? a : b, 'Time');
      }
    } else if (this.phase === 'roundEnd') {
      this.updateFighters(dt, true);
      if (this.phaseTimer <= 0) {
        if (this.matchWinner) this.endMatch();
        else {
          this.round++;
          this.beginRound();
        }
      }
    } else if (this.phase === 'matchEnd') {
      this.updateFighters(dt, true);
      this.#updateCameraFlashes(dt);
    }

    this.updateCamera();
    this.updateFirstPersonGloves(dt);
  }

  updateFighters(dt, frozen) {
    for (const f of this.fighters) {
      const stage = f.p?.stage;
      let targetX = f.baseX;
      let targetZ = f.baseZ;

      if (!frozen && stage) {
        targetX += clamp(stage.x * 0.35, -1.2, 1.2);
        targetZ += clamp(stage.z * 0.22, -0.6, 0.6);
      }

      // Bot weaving
      if (f.isBot && !frozen && f.hp > 0 && this.botState !== 'windup') {
        targetX = f.baseX + Math.sin(this.time * 2.2) * 0.34;
        targetZ = f.baseZ + Math.cos(this.time * 1.5) * 0.14;
      }

      f.x = damp(f.x, targetX, 7, dt);
      f.z = damp(f.z, targetZ, 5, dt);
      f.lunge = damp(f.lunge, 0, 8, dt);

      // Face block detection
      f.blocking = f.p ? f.p.motion.block : f.isBot ? (performance.now() < this.botBlockUntil ? 1 : 0) : 0;

      // Elastic bounce recoil spring
      if (f.bounceVelZ) {
        f.bounceT += dt;
        f.recoil.z += f.bounceVelZ * Math.cos(f.bounceT * 12) * Math.exp(-f.bounceT * 4.5) * dt;
        if (f.bounceT > 0.8) f.bounceVelZ = 0;
      }

      f.recoil.z = damp(f.recoil.z, 0, 8.5, dt);
      f.recoil.rotX = damp(f.recoil.rotX, 0, 9.5, dt);
      f.recoil.rotY = damp(f.recoil.rotY, 0, 10, dt);
      f.recoil.rotZ = damp(f.recoil.rotZ, 0, 10, dt);
      f.recoil.y = damp(f.recoil.y, 0, 8, dt);

      // Comic dizzy stars when HP <= 25% (75% damaged)
      this.#updateDizzyStars(f, dt);

      // KO Collapse
      if (f.hp <= 0) {
        f.koProgress = clamp(f.koProgress + dt * 2.5, 0, 1);
        f.recoil.rotX = lerp(f.recoil.rotX, -Math.PI / 2, f.koProgress);
        f.recoil.y = lerp(f.recoil.y, 0.18, f.koProgress);
      }

      const facing = f.facing;
      const posX = f.x + f.recoil.x;
      const posY = f.recoil.y;
      const posZ = f.z + f.recoil.z + f.lunge * (f.side === 0 ? -1 : 1);

      if (f.p) {
        this.place(f.p, posX, posZ, { y: posY, facing });
        if (f.side === 0) {
          f.avatar.setVisible(this.viewMode === 'chase');
        }
      } else {
        f.avatar.group.position.set(posX, posY, posZ);
        f.avatar.group.rotation.x = f.recoil.rotX;
        f.avatar.group.rotation.y = facing + f.recoil.rotY;
        f.avatar.group.rotation.z = f.recoil.rotZ;
        f.avatar.facingTarget = facing;
        f.avatar.seated = false;
        f.avatar.update(null, null, dt, { active: false });

        if (f.avatar.headGroup && f.hp > 25) {
          f.avatar.headGroup.rotation.x = damp(f.avatar.headGroup.rotation.x, 0, 11, dt);
        }

        if (f.avatar._rigged) {
          f.avatar._rigged.setPosition(posX, posY, posZ);
          f.avatar._rigged.setFacing(facing + f.recoil.rotY);
          f.avatar._rigged.update(dt);
        }
      }

      if (f.avatar.accentMat) {
        f.avatar.accentMat.emissiveIntensity = 0.9 + f.flash * 2.8;
      }
    }
  }

  #updateDizzyStars(f, dt) {
    if (!f.dizzyStars) return;
    const isDizzy = f.hp > 0 && f.hp <= 25;
    f.dizzyStars.group.visible = isDizzy;
    if (!isDizzy) return;

    f.dizzyAngle = (f.dizzyAngle || 0) + dt * 4.5;
    const headY = 1.82;
    f.dizzyStars.group.position.set(f.x + f.recoil.x, headY + Math.sin(this.time * 6) * 0.04, f.z + f.recoil.z);

    const rx = 0.35;
    const rz = 0.22;
    for (let i = 0; i < f.dizzyStars.stars.length; i++) {
      const theta = f.dizzyAngle + (i * Math.PI * 2) / f.dizzyStars.stars.length;
      const s = f.dizzyStars.stars[i];
      s.position.set(Math.cos(theta) * rx, Math.sin(theta * 2) * 0.04, Math.sin(theta) * rz);
      s.rotation.y += dt * 6;
      s.rotation.z += dt * 4;
    }

    if (f.avatar?.headGroup) {
      f.avatar.headGroup.rotation.z = Math.sin(this.time * 6) * 0.18;
      f.avatar.headGroup.rotation.x = Math.cos(this.time * 5) * 0.14;
    }

    if (Math.random() < 0.012) {
      this.ctx.audio.play('dizzy');
    }
  }

  #updateCameraFlashes(dt) {
    if (this.phase !== 'matchEnd' || !this.matchWinner) {
      for (const f of this.cameraFlashes) {
        f.light.intensity = 0;
      }
      return;
    }

    for (const f of this.cameraFlashes) {
      if (f.flashTimer > 0) {
        f.flashTimer -= dt;
        f.light.intensity = Math.max(0, f.flashTimer * 18);
      } else if (Math.random() < 0.08) {
        f.flashTimer = 0.12 + Math.random() * 0.08;
        f.light.intensity = 3.5;
      }
    }
  }

  tryHit(attacker, defender, e) {
    if (!defender || this.phase !== 'fight') return;
    const now = performance.now();
    if (now - attacker.lastHitAt < 160) return;
    attacker.lastHitAt = now;
    attacker.punches++;

    const isHard = e.hardHit || e.power > 1.05;
    const zone = e.zone || (Math.random() < 0.65 ? 'head' : 'torso');
    const quality = clamp(Number(e.quality ?? e.power ?? 0.7), 0, 1);
    const momentum = clamp(Number(e.momentum ?? quality), 0, 1.45);
    const power = clamp(Number(e.power) || (isHard ? 1.2 : 0.85), 0.2, 1.5);
    const dist = Math.hypot(attacker.x - defender.x, attacker.z - defender.z);
    const range = 2.85 + Math.max(0, (e.reach || 1) - 1) * 0.9;

    attacker.lunge = (isHard ? 0.28 : 0.2) + quality * 0.12;

    if (dist > range + 0.5) {
      attacker.misses++;
      this.#refreshAccuracy(attacker);
      attacker.combo = 0;
      this.combo = 0;
      this.message = 'OUT OF RANGE!';
      this.messageSub = 'Step forward and punch through the target';
      this.ctx.audio.play('whoosh');
      this.fx.burst({ x: defender.x, y: 1.3, z: defender.z }, '#64748b', 8, { speed: 1.5, life: 0.35 });
      return;
    }

    const blocking = defender.blocking > 0.5;
    const kickDodging = performance.now() < (defender._kickDodgeUntil || 0);
    const ducking = defender.p && defender.p.motion.duck > 0.42;
    const leaning = defender.p && Math.abs(defender.p.motion.lean) > 0.65;
    const dodge = ((ducking || leaning) && Math.random() < 0.42) || kickDodging;

    if (dodge) {
      attacker.misses++;
      this.#refreshAccuracy(attacker);
      attacker.combo = 0;
      this.combo = 0;
      this.message = kickDodging ? 'KICK-DODGED!' : ducking ? 'DUCK-DODGED!' : 'SLIP-DODGED!';
      this.messageSub = 'The bot slipped your punch';
      this.ctx.audio.play('whoosh');
      return;
    }

    const accuracyChance = clamp(
      0.52 + quality * 0.45 + momentum * 0.1 - Math.max(0, dist - 2.3) * 0.06,
      0.22,
      0.98
    );
    const weak = quality < 0.18;
    if (weak || Math.random() > accuracyChance) {
      attacker.misses++;
      this.#refreshAccuracy(attacker);
      attacker.combo = 0;
      this.combo = 0;
      this.message = weak ? 'TOO WEAK!' : 'GLANCING MISS!';
      this.messageSub = 'Extend your arm fully · Drive from your body';
      this.ctx.audio.play('whoosh');
      return;
    }

    const comboActive = now - this.lastComboAt < 1200;
    attacker.combo = comboActive ? attacker.combo + 1 : 1;
    attacker.bestCombo = Math.max(attacker.bestCombo, attacker.combo);
    this.combo = attacker.combo;
    this.lastComboAt = now;
    const comboBonus = 1 + Math.min(attacker.combo - 1, 5) * 0.16;

    let dmg = (isHard ? 14 : 7 + power * 10 + quality * 5) * (0.9 + momentum * 0.25) * comboBonus;
    if (zone === 'head') dmg *= 1.25; // Precision headshots deal bonus damage
    if (blocking) dmg *= 0.05; // Shield block absorbs 95% of damage!

    const points = Math.round(
      (40 + power * 75 + momentum * 55 + (isHard ? 50 : 0)) * comboBonus * (blocking ? 0.2 : 1)
    );
    attacker.score += points;

    if (blocking) {
      attacker.blocked++;
      attacker.combo = 0;
      this.combo = 0;
    } else {
      attacker.hits++;
      attacker.damage += dmg;
    }
    this.#refreshAccuracy(attacker);

    defender.hp = clamp(defender.hp - dmg, 0, MAX_HP);
    defender.flash = 1;

    // Distinct Impact Kinetics: Head vs Torso & Elastic Bounce
    const impact = (1 + momentum * 0.4) * (isHard ? 1.35 : 1.0);
    defender.bounceVelZ = -1.4 * power * impact;
    defender.bounceT = 0;

    const hitPos = {
      x: defender.x + (e.hand === 'L' ? 0.12 : -0.12),
      y: zone === 'head' ? 1.62 : 1.18,
      z: defender.z + 0.15,
    };

    if (zone === 'head') {
      defender.recoil.z = -0.6 * power * impact;
      defender.recoil.rotX = -0.65 * power * impact;
      defender.recoil.rotY = (e.hand === 'L' ? -0.45 : 0.45) * power * impact;
      defender.recoil.rotZ = (e.hand === 'L' ? 0.35 : -0.35) * power * impact;
      defender.recoil.y = 0.08 * power * impact;
      if (defender.avatar?.headGroup) {
        defender.avatar.headGroup.rotation.x = -0.9 * power * impact;
        defender.avatar.headGroup.rotation.y = (e.hand === 'L' ? -0.4 : 0.4) * power;
      }
    } else {
      // Body shot: torso hunches forward and body buckles
      defender.recoil.z = -0.5 * power * impact;
      defender.recoil.rotX = 0.45 * power * impact;
      defender.recoil.rotY = (e.hand === 'L' ? -0.2 : 0.2) * power;
      defender.recoil.y = -0.16 * power * impact;
    }

    defender.avatar?.flashVisor?.(0.28);
    defender.avatar?.flash?.(blocking ? '#94a3b8' : '#ef4444', 0.28);

    if (blocking) {
      this.ctx.audio.play('block');
      this.fx.ring(hitPos, '#38bdf8', 1.4, 0.35);
      this.fx.burst(hitPos, '#cbd5e1', 14, { speed: 2.8, life: 0.35 });
      this.message = 'SHIELD BLOCKED!';
      this.messageSub = 'Clean guard deflection';
    } else {
      // Pounding audio on every landed hit
      this.ctx.audio.play('pounding', { power: isHard ? 1.4 : power });

      if (attacker.combo >= 3 && attacker.combo % 3 === 0) {
        this.ctx.audio.play('combo', { combo: attacker.combo });
      }

      this.fx.burst(hitPos, attacker.color || '#ef4444', Math.round(20 + quality * 22 + (isHard ? 15 : 0)), {
        speed: 3.5 + power * 2.5,
        life: 0.45 + quality * 0.2,
      });
      this.fx.ring(hitPos, isHard ? '#fbbf24' : (attacker.color || '#ef4444'), 1.3 + quality * 0.6, 0.35);

      if (isHard) {
        this.ctx.engine.shake(0.38, 0.25);
        this.message = zone === 'head' ? '💥 HARD HIT TO HEAD!' : '⚡ BRUTAL BODY SHOT!';
      } else if (attacker.combo >= 2) {
        this.ctx.engine.shake(0.22, 0.18);
        this.message = `COMBO x${attacker.combo}! (${zone.toUpperCase()})`;
      } else {
        this.ctx.engine.shake(0.18, 0.15);
        this.message = zone === 'head' ? 'HEAD SHOT!' : 'BODY SHOT!';
      }
      this.messageSub = `${Math.round(defender.hp)} HP · +${points} pts`;
    }

    if (defender.hp <= 0) {
      this.endRound(attacker, 'KNOCKOUT!');
      this.ctx.engine.shake(0.55, 0.65);
      this.fx.confetti({ x: defender.x, y: 1.6, z: defender.z }, 90);
    }
  }

  updateBot(dt) {
    const bot = this.fighters.find((f) => f.isBot);
    const target = this.fighters.find((f) => !f.isBot);
    if (!bot || bot.hp <= 0 || !target || target.hp <= 0 || this.phase !== 'fight') return;

    bot.stamina = clamp(bot.stamina + dt * 10, 0, 100);

    if (this.botState === 'windup') {
      this.botWindupTimer -= dt;
      bot.lunge = -0.16;
      bot.recoil.rotX = -0.14;
      bot.avatar?.flashVisor?.(0.85);

      if (this.botWindupTimer <= 0) {
        this.botState = 'strike';
        bot.lunge = 0.42;

        const isDucking = target.p?.motion?.duck > 0.38;
        const isLeaning = target.p?.motion?.lean && Math.abs(target.p.motion.lean) > 0.52;
        const kickDodging = performance.now() < (target._kickDodgeUntil || 0);

        if (kickDodging || isDucking || isLeaning) {
          this.message = kickDodging ? 'KICK-DODGED!' : isDucking ? 'DUCKED UNDER!' : 'SLIPPED!';
          this.messageSub = '⚡ COUNTER WINDOW OPEN!';
          this.ctx.audio.play('whoosh');
          this.botState = 'recovery';
          this.botRecoveryTimer = 1.25;
          return;
        }

        const isBlocked = target.blocking > 0.5;
        const baseDmg = 8 + Math.random() * 7;
        const dmg = isBlocked ? 0 : baseDmg; // Full shield block negates damage!
        target.hp = clamp(target.hp - dmg, 0, MAX_HP);
        target.flash = 1;

        if (isBlocked) {
          this.ctx.audio.play('block');
          this.ctx.engine.shake(0.12, 0.18);
          this.message = '🛡️ SHIELD BLOCKED!';
          this.messageSub = 'Perfect guard - 0 damage taken';
          this.botState = 'recovery';
          this.botRecoveryTimer = 1.0;
        } else {
          this.camRecoilZ = 0.45;
          this.camRecoilRot = (Math.random() - 0.5) * 0.22;
          this.ctx.audio.play('pounding', { power: 1.1 });
          this.ctx.engine.shake(0.38, 0.28);

          const flash = document.getElementById('flash');
          if (flash) {
            flash.style.background = 'rgba(239, 68, 68, 0.45)';
            flash.style.opacity = '1';
            setTimeout(() => {
              flash.style.opacity = '0';
              flash.style.background = '#fff';
            }, 180);
          }

          this.message = 'BOT LANDS HIT!';
          this.messageSub = `${Math.round(target.hp)} HP remaining`;

          this.botState = 'recovery';
          this.botRecoveryTimer = 0.9;
        }

        if (target.hp <= 0) {
          this.endRound(bot, 'KNOCKOUT!');
        }
      }
    } else if (this.botState === 'recovery') {
      this.botRecoveryTimer -= dt;
      if (this.botRecoveryTimer <= 0) {
        this.botState = 'idle';
        this.botNextPunch = 2.0 + Math.random() * 2.2;
      }
    } else {
      // Idle & weaving
      this.botNextPunch -= dt;
      if (this.botNextPunch <= 0) {
        if (Math.random() < 0.25) {
          this.botBlockUntil = performance.now() + 650;
          this.message = 'BOT GUARDS!';
          this.botNextPunch = 1.5 + Math.random() * 1.5;
        } else {
          this.botState = 'windup';
          this.botWindupTimer = 0.65; // 650ms telegraph warning
          this.ctx.audio.play('telegraph');
          this.message = '⚠️ BOT WINDING UP! (BLOCK OR DUCK!)';
        }
      }
    }
  }

  updateFirstPersonGloves(dt) {
    if (this.viewMode !== 'fp' || !this.fpGroup || !this.fighters.length) return;
    const f0 = this.fighters[0];
    if (!f0) return;

    this.fpGloveL.punchT = Math.max(0, this.fpGloveL.punchT - dt * 3.8);
    this.fpGloveR.punchT = Math.max(0, this.fpGloveR.punchT - dt * 3.8);

    const isBlocking = f0.blocking > 0.5;

    if (isBlocking) {
      // High Guard Face Cover position
      this.fpGloveL.group.position.set(-0.11, -0.04, -0.48);
      this.fpGloveR.group.position.set(0.11, -0.04, -0.48);
      this.fpGloveL.group.rotation.set(0.3, 0.35, 0.18);
      this.fpGloveR.group.rotation.set(0.3, -0.35, -0.18);
    } else {
      const lProg = Math.sin(this.fpGloveL.punchT * Math.PI);
      this.fpGloveL.group.position.set(
        this.fpGloveL.restPos.x + lProg * 0.08,
        this.fpGloveL.restPos.y + lProg * 0.18,
        this.fpGloveL.restPos.z - lProg * 1.25
      );
      this.fpGloveL.group.rotation.set(0, 0, 0);

      const rProg = Math.sin(this.fpGloveR.punchT * Math.PI);
      this.fpGloveR.group.position.set(
        this.fpGloveR.restPos.x - rProg * 0.08,
        this.fpGloveR.restPos.y + rProg * 0.18,
        this.fpGloveR.restPos.z - rProg * 1.25
      );
      this.fpGloveR.group.rotation.set(0, 0, 0);
    }

    this.fpGroup.position.copy(this.ctx.camera.position);
    this.fpGroup.quaternion.copy(this.ctx.camera.quaternion);
  }

  updateCamera() {
    const [p1, opponent] = this.fighters;
    if (!p1 || !opponent) {
      super.updateCamera();
      return;
    }

    const p = p1.p;
    const camX = p?.stage?.x ? clamp(p.stage.x * 0.35, -0.9, 0.9) : 0;
    const camDuck = p?.motion?.duck ? -clamp(p.motion.duck * 0.45, 0, 0.45) : 0;
    const camLean = p?.motion?.lean ? clamp(p.motion.lean * 0.35, -0.5, 0.5) : 0;

    const botX = opponent.x * 0.45;
    const botY = 1.45 + (opponent.recoil?.y || 0);
    const botZ = opponent.z;

    if (this.viewMode === 'fp') {
      const eyeX = camX + camLean;
      const eyeY = 1.6 + camDuck;
      const eyeZ = 1.05 + this.camRecoilZ;
      this.setCamera([eyeX, eyeY, eyeZ], [botX, botY, botZ], 58);
      this.ctx.camera.rotation.z += this.camRecoilRot;
    } else {
      const chaseX = camX * 0.5 + camLean * 0.4;
      const chaseY = 2.05 + camDuck * 0.3;
      const chaseZ = 2.65 + this.camRecoilZ;
      this.setCamera([chaseX, chaseY, chaseZ], [botX * 0.4, 1.35, botZ], 52);
    }
  }

  getHud() {
    const players = this.fighters.map((f) => ({
      id: f.id,
      name: f.name,
      color: f.color,
      value: f.hp,
      max: MAX_HP,
      label: 'HP',
      points: f.score,
      detail: `${'●'.repeat(f.roundWins)}${'○'.repeat(Math.max(0, ROUNDS_TO_WIN - f.roundWins))} · ${f.accuracy}% acc · x${f.bestCombo}`,
      active: true,
    }));

    const hero = this.fighters[0];
    const scoreLine = hero
      ? `SCORE ${Math.round(hero.score).toLocaleString()} · ${hero.accuracy}% ACC${hero.combo >= 2 ? ` · x${hero.combo} COMBO` : ''}`
      : '';

    return {
      title: this.title,
      subtitle: `${this.viewMode === 'fp' ? 'POV (First-Person)' : 'Chase View'} · Press [V] to toggle`,
      phase: this.phase,
      timer: this.phase === 'fight' ? Math.max(0, this.phaseTimer) : null,
      round: this.round,
      score: scoreLine,
      message: this.message,
      messageSub: this.messageSub,
      winnerId: this.matchWinner?.p?.id || null,
      big: this.phase === 'intro' ? { text: `${Math.max(1, Math.ceil(this.phaseTimer))}`, sub: 'ROUND ' + this.round } : null,
      players,
      results:
        this.phase === 'matchEnd'
          ? this.results.map((r, i) => ({ ...r, rank: i + 1 }))
          : [],
      queue: this.queue.map((p) => ({ id: p.key, name: p.name, color: p.color })),
    };
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    if (this.bot?._rigged) {
      this.bot._rigged.dispose();
      this.bot._rigged = null;
    }
    if (this.bot) this.bot.dispose();
    if (this.fpGroup) {
      this.fpGroup.removeFromParent();
    }
    for (const f of this.fighters) {
      f.dizzyStars?.group?.removeFromParent();
    }
    for (const cf of this.cameraFlashes) {
      cf.light?.removeFromParent();
    }
    super.dispose();
  }
}
