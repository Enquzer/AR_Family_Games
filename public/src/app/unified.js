/**
 * AR Family Games — Unified All-In-One Kinect Console.
 *
 * Single access point running directly at http://localhost:3000/
 * Integrates:
 * - Direct camera acquisition & MediaPipe PoseEngine (0ms local latency)
 * - Persistent Player Profile System (no duplicate re-registration, saved wins/stats)
 * - 3D Athlete Avatars & Procedural Environments (Three.js)
 * - Kinect Hand Gesture Browsing & Dwell Launcher
 * - In-Game HUD with "Exit to Home" and "Exit System"
 * - Live Multi-Player Skeleton Corner PIP
 * - Screen Wake Lock (prevents display sleep)
 */
import { Engine } from '../engine/engine.js';
import { Avatar } from '../engine/avatar.js';
import { buildMenuWorld } from '../engine/environments.js';
import { Effects } from '../engine/effects.js';
import { NetClient } from '../net/client.js';
import { MotionTracker } from '../vision/motion.js';
import { PoseSimulator } from '../vision/simulator.js';
import { PoseEngine } from './poseEngine.js';
import { startCamera, stopCamera, cameraSupported } from '../vision/camera.js';
import { CONNECTIONS } from '../shared/pose.js';
import {
  calibrationFromMessage,
  defaultCalibration,
  mapGroundToStage,
  computeViewRig,
} from '../shared/stage.js';
import { formatTime, clamp, damp, lerp } from '../shared/math.js';
import { createGame } from '../games/index.js';
import { GAME_BY_ID, GAME_CATALOG } from '../games/catalog.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const room = (params.get('room') || 'HOME').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'HOME';
const demo = params.get('demo') === '1';

const canvas = $('#stage');
const video = $('#camera-video');
const engine = new Engine(canvas);
const audio = engine.audio;
const net = new NetClient({ room, role: 'host', name: 'Console' });

let menu = null;
let game = null;
let calibration = defaultCalibration();
calibration.cameraOffset = 0.0;
calibration.reachGain = 1.55;

function loadCalibrationOffset() {
  try {
    const saved = localStorage.getItem('ar_family_calibration_offset');
    if (saved) {
      const data = JSON.parse(saved);
      if (typeof data.cameraOffset === 'number') calibration.cameraOffset = data.cameraOffset;
      if (typeof data.reachGain === 'number') calibration.reachGain = data.reachGain;
    }
  } catch {}
}

function saveCalibrationOffset() {
  try {
    localStorage.setItem(
      'ar_family_calibration_offset',
      JSON.stringify({
        cameraOffset: calibration.cameraOffset ?? 0,
        reachGain: calibration.reachGain ?? 1.55,
      })
    );
  } catch {}
}

loadCalibrationOffset();

function recalibrateReach() {
  let targetP = null;
  for (const p of players.values()) {
    if (p.joined && p.lm && performance.now() - p.lastSeen < 1200) {
      targetP = p;
      break;
    }
  }
  if (!targetP) {
    for (const p of players.values()) {
      if (p.lm && performance.now() - p.lastSeen < 1200) {
        targetP = p;
        break;
      }
    }
  }

  if (targetP && targetP.lm && targetP.lm[11] && targetP.lm[12]) {
    const shX = (targetP.lm[11].x + targetP.lm[12].x) / 2;
    const mirror = calibration.mirror !== false;
    const mirrorSh = mirror ? 1 - shX : shX;
    calibration.cameraOffset = clamp((0.5 - mirrorSh) * 0.35, -0.28, 0.28);
    saveCalibrationOffset();
    audio.play('bell');
    toast(`🎯 Reach Re-Centered (Offset: ${(calibration.cameraOffset * 100).toFixed(0)}%)`);
  } else {
    calibration.cameraOffset = 0.0;
    saveCalibrationOffset();
    audio.play('tick');
    toast('🎯 Reach Calibration Reset');
  }
}
let poseEngine = null;
let sim = null;
let cameraActive = false;
let cameraStarting = false;
let lastHudAt = 0;
let hudCacheKey = '';
let fatalShown = false;
let viewRig = null;
let lastViewAt = 0;

/* ------------------------------------------------------------------ */
/* Player Profile Manager (Persistent identity & stats)               */
/* ------------------------------------------------------------------ */
class ProfileManager {
  constructor() {
    this.storageKey = 'arfg_profiles_v2';
    this.profiles = this.load();
    this.assigned = new Map(); // trackId -> profile
  }

  load() {
    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) return JSON.parse(data);
    } catch {}
    return [
      { id: 1, name: 'Player 1', color: '#22d3ee', icon: '⚡', level: 1, wins: 0, games: 0, bodyHeight: null },
      { id: 2, name: 'Player 2', color: '#f472b6', icon: '🔥', level: 1, wins: 0, games: 0, bodyHeight: null },
      { id: 3, name: 'Player 3', color: '#fbbf24', icon: '⭐', level: 1, wins: 0, games: 0, bodyHeight: null },
      { id: 4, name: 'Player 4', color: '#a3e635', icon: '🍀', level: 1, wins: 0, games: 0, bodyHeight: null },
    ];
  }

  save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.profiles));
    } catch {}
    this.renderBadges();
  }

  getProfile(trackId, bodySpan = null) {
    if (this.assigned.has(trackId)) {
      return this.assigned.get(trackId);
    }

    // Try to match by stored body height proportion if available
    let matched = null;
    if (bodySpan && Number.isFinite(bodySpan)) {
      const available = this.profiles.filter((p) => ![...this.assigned.values()].some((a) => a.id === p.id));
      for (const p of available) {
        if (p.bodyHeight && Math.abs(p.bodyHeight - bodySpan) < 0.07) {
          matched = p;
          break;
        }
      }
    }

    if (!matched) {
      const available = this.profiles.filter((p) => ![...this.assigned.values()].some((a) => a.id === p.id));
      matched = available[0] || this.profiles[(trackId - 1) % this.profiles.length];
    }

    if (bodySpan && Number.isFinite(bodySpan) && !matched.bodyHeight) {
      matched.bodyHeight = bodySpan;
      this.save();
    }

    this.assigned.set(trackId, matched);
    this.renderBadges();
    return matched;
  }

  releaseTrack(trackId) {
    this.assigned.delete(trackId);
    this.renderBadges();
  }

  recordWin(profileId) {
    const p = this.profiles.find((x) => x.id === profileId);
    if (p) {
      p.wins = (p.wins || 0) + 1;
      p.games = (p.games || 0) + 1;
      p.level = Math.floor(p.wins / 3) + 1;
      this.save();
    }
  }

  recordGame(profileId) {
    const p = this.profiles.find((x) => x.id === profileId);
    if (p) {
      p.games = (p.games || 0) + 1;
      this.save();
    }
  }

  setName(profileId, newName) {
    const p = this.profiles.find((x) => x.id === profileId);
    if (p && newName) {
      p.name = newName.slice(0, 14);
      this.save();
    }
  }

  renderBadges() {
    const bar = $('#profile-bar');
    if (!bar) return;
    bar.innerHTML = '';
    const activeProfiles = [...this.assigned.values()];
    for (const p of activeProfiles) {
      const chip = document.createElement('div');
      chip.className = 'profile-chip active';
      chip.style.setProperty('--c', p.color);
      chip.innerHTML = `
        <span class="p-icon">${p.icon}</span>
        <span class="p-name">${p.name}</span>
        <span class="p-stat">Lvl ${p.level || 1} · ${p.wins || 0}W</span>
      `;
      chip.title = 'Click to edit name';
      chip.addEventListener('click', () => {
        const name = prompt(`Enter name for ${p.name}:`, p.name);
        if (name) {
          this.setName(p.id, name);
          const pl = [...players.values()].find((x) => x.profile?.id === p.id);
          if (pl) {
            pl.name = p.name;
            pl.avatar.setName(p.name);
          }
        }
      });
      bar.appendChild(chip);
    }
  }
}

const profileManager = new ProfileManager();
const players = new Map();
const playerOrder = [];

/* ------------------------------------------------------------------ */
/* Menu 3D World                                                       */
/* ------------------------------------------------------------------ */
function initMenu() {
  menu = buildMenuWorld();
  engine.setScene(menu.scene);
  engine.camera.position.set(0, 1.85, 5.8);
  engine.camera.lookAt(0, 1.1, 0);
  engine.camera.fov = 48;
  engine.camera.updateProjectionMatrix();
  engine.camera.rotation.z = 0;
}

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Player Management & Wave-to-Join                                   */
/* ------------------------------------------------------------------ */
function ensurePlayer(key, meta, bodySpan = null) {
  let p = players.get(key);
  const now = performance.now();
  if (!p) {
    const profile = profileManager.getProfile(meta.id ?? 1, bodySpan);
    p = {
      key,
      trackId: meta.id ?? 1,
      id: profile.id,
      name: profile.name,
      color: profile.color,
      profile,
      avatar: new Avatar({ name: profile.name, color: profile.color, id: profile.id }),
      motion: new MotionTracker(),
      lm: null,
      aspect: meta.aspect || 16 / 9,
      stage: { x: 0, z: 0, t: 0, u: 0.5, v: 0.9, half: 4, visible: true },
      lastSeen: now,
      firstSeen: now,
      active: true,
      packets: 0,
      joined: false, // Must wave to join!
      waveSeen: 0,
    };
    p.avatar.setVisible(false);
    players.set(key, p);
  }
  return p;
}

function joinPlayer(p) {
  if (!p || p.joined) return;
  p.joined = true;
  p.active = true;
  p.avatar.setVisible(true);

  // Auto-calibrate lateral offset if player stands off-center relative to camera
  if (p.lm && p.lm[11] && p.lm[12]) {
    const shX = (p.lm[11].x + p.lm[12].x) / 2;
    const mirror = calibration.mirror !== false;
    const mirrorSh = mirror ? 1 - shX : shX;
    calibration.cameraOffset = clamp((0.5 - mirrorSh) * 0.35, -0.28, 0.28);
    saveCalibrationOffset();
  }

  if (!playerOrder.includes(p.key)) {
    playerOrder.push(p.key);
  }

  audio.play('bell');
  toast(`👋 ${p.name} joined!`);
  updateAttractPlayers();

  if (game && typeof game.addPlayer === 'function') {
    const activeJoined = playerOrder
      .map((key) => players.get(key))
      .filter((x) => x && x.joined && x !== p);
    if (activeJoined.length >= 1) {
      promptPlayer2Join(p);
    } else {
      game.addPlayer(p);
    }
  }
}

function updateAttractPlayers() {
  const wrap = $('#attract-players');
  if (!wrap) return;
  const joined = playerOrder
    .map((key) => players.get(key))
    .filter((p) => p && p.active && p.joined);

  if (!joined.length) {
    wrap.innerHTML = '<span class="wave-prompt">👋 Stand in camera view &amp; WAVE TO JOIN</span>';
    return;
  }
  wrap.innerHTML = '';
  wrap.append(
    el('span', 'attract-ready', `${joined.length} PLAYER${joined.length === 1 ? '' : 'S'} READY`)
  );
  for (const p of joined) {
    const chip = el('span', 'attract-player', `${p.profile?.icon || '👤'} ${p.name}`);
    chip.style.setProperty('--c', p.color);
    wrap.append(chip);
  }
  if (joined.length < 4) {
    const hint = el('span', 'wave-prompt', '· Wave to join');
    wrap.append(hint);
  }
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function prunePlayers() {
  const now = performance.now();
  let changed = false;
  for (const p of players.values()) {
    p.active = now - p.lastSeen < 2000;

    // Unjoined vision candidates that left view: prune after 3 seconds
    if (!p.joined && now - p.lastSeen > 3000) {
      p.avatar.group.removeFromParent();
      p.avatar.dispose();
      players.delete(p.key);
      changed = true;
      continue;
    }

    // Joined players who left view for > 15 seconds: unjoin & prune
    if (p.joined && now - p.lastSeen > 15000) {
      profileManager.releaseTrack(p.id);
      p.avatar.group.removeFromParent();
      p.avatar.dispose();
      players.delete(p.key);
      const i = playerOrder.indexOf(p.key);
      if (i >= 0) playerOrder.splice(i, 1);
      toast(`👋 ${p.name} left the game`);
      changed = true;
    }
  }
  if (changed) updateAttractPlayers();
}

/* ------------------------------------------------------------------ */
/* Camera Acquisition & Detection                                      */
/* ------------------------------------------------------------------ */
async function startCameraTracking() {
  if (cameraStarting || cameraActive) return;
  cameraStarting = true;
  const statusEl = $('#camera-toggle-btn');
  if (statusEl) statusEl.textContent = 'Starting camera…';

  try {
    await startCamera(video, { width: 640, height: 360, frameRate: 60 });
    cameraActive = true;
    cameraStarting = false;
    if (statusEl) {
      statusEl.textContent = '📷 Camera Active';
      statusEl.classList.add('ok');
    }
    toast('Camera connected · Tracking ready');
  } catch (err) {
    cameraStarting = false;
    cameraActive = false;
    console.warn('[camera] start failed:', err);
    if (statusEl) {
      statusEl.textContent = '📷 Click to allow camera';
      statusEl.classList.remove('ok');
    }
    toast(err.message || 'Camera blocked — click to allow access');
  }
}

/* ------------------------------------------------------------------ */
/* Game Lifecycle                                                      */
/* ------------------------------------------------------------------ */
function startGame(gameId, options = {}) {
  const meta = GAME_BY_ID[gameId];
  if (!meta) return;

  const cursorEl = $('#kinect-cursor');
  if (cursorEl) cursorEl.hidden = true;

  // Detach avatars from menu scene before game adopts them
  for (const p of players.values()) {
    p.avatar.group.removeFromParent();
  }

  stopGame(false);
  poseEngine?.tracker?.setGameMode?.(true);

  if (sim) {
    sim.setScenario(gameId);
    const count = gameId === 'boxing' || gameId === 'tennis' || gameId === 'balling' ? 2 : 3;
    sim.setPlayerCount(count);
    syncDemoPlayers();
  }

  const gameOptions = demo ? { ...options, demo: true } : options;
  const ctx = { engine, camera: engine.camera, audio, calibration, room, settings: gameOptions };
  try {
    game = createGame(gameId, ctx, gameOptions);
  } catch (err) {
    showFatal(err);
    return;
  }

  engine.setScene(game.scene);
  for (const key of playerOrder) {
    const p = players.get(key);
    if (p && p.active && p.joined) game.addPlayer(p);
  }

  game.start();
  $('#attract').hidden = true;
  $('#hud').hidden = false;
  document.body.dataset.game = gameId;
  toast(`${meta.icon} ${meta.title} started`);
  lastHudAt = 0;
  hudCacheKey = '';

  // Record games played for active profiles
  for (const p of players.values()) {
    if (p.active && p.profile) profileManager.recordGame(p.profile.id);
  }

  // Prompt dominant hand calibration for virtual hand-held games (Tennis, Bowling, Balling, Archery)
  const mainPlayer = players.get(playerOrder[0]);
  if (HAND_PROMPT_GAMES.includes(gameId) && mainPlayer) {
    promptDominantHand(mainPlayer, gameId);
  }
}

function stopGame(showMenu = true) {
  if (!game) return;
  const old = game;
  game = null;
  poseEngine?.tracker?.setGameMode?.(false);

  isGamePaused = false;
  dominantHandCalibrating = false;
  pendingPlayer2Join = null;
  const pauseModal = $('#pause-modal');
  if (pauseModal) pauseModal.hidden = true;
  const joinModal = $('#player-join-modal');
  if (joinModal) joinModal.hidden = true;
  const handModal = $('#dominant-hand-modal');
  if (handModal) handModal.hidden = true;

  try {
    old.dispose();
  } catch (err) {
    console.warn('dispose failed', err);
  }

  for (const p of players.values()) {
    p.avatar.group.removeFromParent();
  }

  if (showMenu) {
    engine.setScene(menu.scene);
    engine.camera.position.set(0, 1.85, 5.8);
    engine.camera.lookAt(0, 1.1, 0);
    engine.camera.fov = 48;
    engine.camera.updateProjectionMatrix();
    engine.camera.rotation.z = 0;

    $('#attract').hidden = false;
    $('#hud').hidden = true;
    delete document.body.dataset.game;

    const cursorEl = $('#kinect-cursor');
    if (cursorEl) cursorEl.hidden = true;
    for (const c of document.querySelectorAll('.attract-card')) {
      c.classList.remove('kinect-hover', 'kinect-selected');
    }
    updateAttractPlayers();
    if (sim) sim.setScenario('menu');
  }
}

/* ------------------------------------------------------------------ */
/* Kinect Features: Dominant Hand, Pause, Mid-Game Drop-In            */
/* ------------------------------------------------------------------ */

let isGamePaused = false;
let dominantHandCalibrating = false;
let pendingPlayer2Join = null;

const HAND_PROMPT_GAMES = ['tennis', 'bowling', 'balling', 'archery'];

function promptDominantHand(player, gameId, onSelected) {
  if (!player) return;
  dominantHandCalibrating = true;
  const modal = $('#dominant-hand-modal');
  if (!modal) return;
  modal.hidden = false;

  const cardL = $('#hand-opt-left');
  const cardR = $('#hand-opt-right');

  const cleanUp = () => {
    dominantHandCalibrating = false;
    modal.hidden = true;
    cardL?.classList.remove('active', 'locked');
    cardR?.classList.remove('active', 'locked');
  };

  const selectHand = (hand) => {
    player.dominantHand = hand;
    if (player.profile) {
      player.profile.dominantHand = hand;
      profileManager.updateProfile(player.profile.id, { dominantHand: hand });
    }
    const propName = gameId === 'tennis' ? 'racket' : (gameId === 'bowling' || gameId === 'balling') ? 'ball' : 'none';
    player.avatar.setProp(propName, hand);
    audio.play('bell');
    toast(`✓ ${hand === 'L' ? 'LEFT' : 'RIGHT'} HAND SELECTED`);
    cleanUp();
    if (onSelected) onSelected(hand);
  };

  if (cardL) cardL.onclick = () => selectHand('L');
  if (cardR) cardR.onclick = () => selectHand('R');
}

function updateDominantHandCalibration(player) {
  if (!dominantHandCalibrating || !player || !player.motion) return;
  const s = player.motion.state;
  const ringL = $('#reach-ring-left');
  const ringR = $('#reach-ring-right');
  const cardL = $('#hand-opt-left');
  const cardR = $('#hand-opt-right');

  const progL = s.dominantProgress?.L || 0;
  const progR = s.dominantProgress?.R || 0;

  if (ringL) ringL.style.strokeDashoffset = `${264 * (1 - progL)}`;
  if (ringR) ringR.style.strokeDashoffset = `${264 * (1 - progR)}`;

  cardL?.classList.toggle('active', progL > 0.15);
  cardR?.classList.toggle('active', progR > 0.15);

  if (s.dominantCandidate) {
    const choice = s.dominantCandidate;
    (choice === 'L' ? cardL : cardR)?.classList.add('locked');
    setTimeout(() => {
      const card = $(choice === 'L' ? '#hand-opt-left' : '#hand-opt-right');
      card?.click();
    }, 180);
  }
}

function toggleGamePause(forceState) {
  if (!game) return;
  isGamePaused = forceState !== undefined ? forceState : !isGamePaused;
  game.isPaused = isGamePaused;
  const modal = $('#pause-modal');
  if (modal) modal.hidden = !isGamePaused;

  if (isGamePaused) {
    audio.play('whistle');
    const statsEl = $('#pause-stats');
    if (statsEl) {
      statsEl.innerHTML = `<p><strong>${game.title || 'MATCH'}</strong></p><p>${game.message || ''} ${game.messageSub || ''}</p>`;
    }
  } else {
    audio.play('go');
  }
}

function promptPlayer2Join(p2) {
  if (!game) return;
  pendingPlayer2Join = p2;
  const modal = $('#player-join-modal');
  if (!modal) return;
  const nameEl = $('#join-p2-name');
  if (nameEl) nameEl.textContent = p2.name || 'PLAYER 2';
  modal.hidden = false;
  audio.play('bell');

  const cardAgainst = $('#opt-join-against');
  const cardWith = $('#opt-join-with');
  const btnDismiss = $('#btn-join-dismiss');

  const resolve = (mode) => {
    modal.hidden = true;
    pendingPlayer2Join = null;
    cardAgainst?.classList.remove('active');
    cardWith?.classList.remove('active');

    if (mode === 'dismiss') {
      p2.avatar.setVisible(false);
      toast(`👁 ${p2.name} is spectating`);
      return;
    }
    game.addPlayer(p2, mode);
    audio.play('cheer');
    toast(`🎮 ${p2.name} joined (${mode === 'against' ? 'VS Match' : 'Co-Op Team'})!`);
  };

  if (cardAgainst) cardAgainst.onclick = () => resolve('against');
  if (cardWith) cardWith.onclick = () => resolve('with');
  if (btnDismiss) btnDismiss.onclick = () => resolve('dismiss');
}

function updatePlayer2JoinGestures(p2) {
  if (!pendingPlayer2Join || !p2 || !p2.motion) return;
  const s = p2.motion.state;
  // Left arm extended out -> Play Against
  if (s.reachForwardL > 0.32 && s.reachForwardL > s.reachForwardR + 0.14) {
    $('#opt-join-against')?.classList.add('active');
    setTimeout(() => $('#opt-join-against')?.click(), 250);
  } else if (s.reachForwardR > 0.32 && s.reachForwardR > s.reachForwardL + 0.14) {
    // Right arm extended out -> Play With
    $('#opt-join-with')?.classList.add('active');
    setTimeout(() => $('#opt-join-with')?.click(), 250);
  }
}

/* ------------------------------------------------------------------ */
/* Demo Mode                                                           */
/* ------------------------------------------------------------------ */
function initDemo() {
  sim = new PoseSimulator({ players: 2, scenario: 'idle' });
  syncDemoPlayers();
}

function syncDemoPlayers() {
  if (!sim) return;
  const wanted = new Set(sim.players.map((sp) => `demo:${sp.id}`));
  for (const [key, p] of players) {
    if (!p.demo || wanted.has(key)) continue;
    p.avatar.dispose();
    players.delete(key);
    const i = playerOrder.indexOf(key);
    if (i >= 0) playerOrder.splice(i, 1);
  }
  for (const sp of sim.players) {
    const key = `demo:${sp.id}`;
    const p = ensurePlayer(key, { id: sp.id, name: sp.name, color: sp.color });
    p.demo = true;
    joinPlayer(p);
  }
}

function updateDemo(dt) {
  if (!sim) return;
  const ts = performance.now();
  sim.update(dt, ts);
  for (const sp of sim.players) {
    const key = `demo:${sp.id}`;
    const p = players.get(key);
    if (!p) continue;
    p.lm = sp.lm;
    p.aspect = 16 / 9;
    p.avatar.aspect = 16 / 9;
    p.lastSeen = performance.now();
    p.active = true;
    p.stage = mapGroundToStage(calibration, sp.lm, 16 / 9, { mirror: calibration.mirror });
    p.motion.update(sp.lm, 16 / 9, ts);
  }
}

/* ------------------------------------------------------------------ */
/* In-Game HUD                                                         */
/* ------------------------------------------------------------------ */
function renderHud(hud) {
  const hudEl = $('#hud');
  if (!hud) {
    hudEl.hidden = true;
    return;
  }
  hudEl.hidden = false;
  $('#hud-title').textContent = hud.title || '';
  $('#hud-subtitle').textContent = hud.subtitle || '';
  const timer = $('#hud-timer');
  timer.textContent = hud.timer != null ? formatTime(hud.timer) : '';
  timer.hidden = hud.timer == null;
  const score = $('#hud-score');
  score.textContent = hud.score || '';
  score.hidden = !hud.score;

  const msg = $('#hud-message');
  msg.textContent = hud.message || '';
  const sub = $('#hud-message-sub');
  sub.textContent = hud.messageSub || '';

  const big = $('#hud-big');
  if (hud.big) {
    big.hidden = false;
    big.querySelector('.big-text').textContent = hud.big.text || '';
    big.querySelector('.big-sub').textContent = hud.big.sub || '';
  } else {
    big.hidden = true;
  }

  const wrap = $('#hud-players');
  wrap.innerHTML = '';
  for (const p of hud.players || []) {
    const card = el('div', 'pcard' + (p.active === false ? ' offline' : ''));
    card.style.setProperty('--c', p.color || '#22d3ee');
    const head = el('div', 'pcard-head');
    if (p.rank) head.append(el('span', 'prank' + (p.rank === 1 ? ' gold' : ''), p.rank === 1 ? '1' : `${p.rank}`));
    head.append(el('span', 'pdot'));
    head.append(el('span', 'pname', p.name || 'Player'));
    if (p.points != null) head.append(el('span', 'ppoints', `${p.points} pts`));
    card.append(head);
    const max = Number(p.max) || 0;
    const value = Number(p.value) || 0;
    if (max > 0) {
      const bar = el('div', 'pbar');
      const fill = el('i');
      fill.style.width = `${clamp((value / max) * 100, 0, 100)}%`;
      bar.append(fill);
      card.append(bar);
    }
    const meta = el('div', 'pmeta');
    const left = el('span', 'pvalue');
    if (max > 0) left.textContent = `${Math.round(value)}${p.label ? ' ' + p.label : ''}`;
    meta.append(left);
    meta.append(el('span', 'pdetail', p.detail || ''));
    card.append(meta);
    wrap.append(card);
  }

  // Check if round/match ended with a winner and record win
  if (hud.phase === 'matchEnd' && hud.winnerId) {
    const winPl = [...players.values()].find((x) => x.id === hud.winnerId);
    if (winPl && winPl.profile && !winPl._winRecorded) {
      winPl._winRecorded = true;
      profileManager.recordWin(winPl.profile.id);
      setTimeout(() => (winPl._winRecorded = false), 15000);
    }
  }
}

function hudKey(hud) {
  if (!hud) return 'none';
  return [
    hud.phase,
    hud.score,
    hud.message,
    hud.timer?.toFixed(1),
    hud.big?.text,
    ...(hud.players || []).map((p) => `${p.id}:${Math.round(p.value)}:${p.detail}`),
  ].join('|');
}

/* ------------------------------------------------------------------ */
/* Kinect Hand Menu & Gesture Actions                                  */
/* ------------------------------------------------------------------ */
const cursorState = {
  x: window.innerWidth / 2,
  y: window.innerHeight / 2,
  targetX: window.innerWidth / 2,
  targetY: window.innerHeight / 2,
  active: false,
  lastActiveAt: 0,
  hoveredItem: null,
  dwellTime: 0,
  lastTickAt: 0,
  color: '#22d3ee',
  selecting: false,
};

const DWELL_DURATION = 1.35;
const CIRCUMFERENCE = 2 * Math.PI * 26;

function shutdownSystem() {
  audio.play('bell');
  const overlay = $('#shutdown-overlay');
  if (overlay) overlay.hidden = false;
  fetch('/api/shutdown').catch(() => {});
  setTimeout(() => {
    window.close();
  }, 1200);
}

function updateHandMenu(dt, now) {
  const cursorEl = $('#kinect-cursor');
  if (!cursorEl) return;

  const targets = [];
  if (game) {
    const homeBtn = $('#gesture-home-btn');
    if (homeBtn && !$('#hud').hidden) {
      targets.push({ el: homeBtn, type: 'home', dwell: 1.25, label: 'HOLD FOR HOME' });
    }
    const viewBtn = $('#gesture-view-btn');
    if (viewBtn && !$('#hud').hidden && game.toggleView) {
      viewBtn.hidden = false;
      targets.push({ el: viewBtn, type: 'toggle-view', dwell: 1.25, label: 'HOLD FOR VIEW' });
    } else if (viewBtn) {
      viewBtn.hidden = true;
    }
  } else {
    for (const card of document.querySelectorAll('.attract-card')) {
      targets.push({
        el: card,
        type: 'game',
        gameId: card.dataset.gameId,
        dwell: 1.35,
        label: 'HOLD TO START',
      });
    }
    const exitBtn = $('#gesture-exit-sys');
    if (exitBtn) {
      targets.push({ el: exitBtn, type: 'exit-sys', dwell: 1.6, label: 'HOLD TO EXIT' });
    }
  }

  let bestHand = null;
  let activePlayer = null;

  for (const p of players.values()) {
    if (!p.joined || !p.lm || now - p.lastSeen > 1200) continue;
    const lm = p.lm;
    const hipY = ((lm[23]?.y ?? 0.65) + (lm[24]?.y ?? 0.65)) / 2;
    const lWrist = lm[15];
    const rWrist = lm[16];
    // Active if hand is anywhere above hip level (natural reach from waist to head)
    const lUp = lWrist && (lWrist.visibility ?? 1) > 0.35 && lWrist.y < hipY + 0.05;
    const rUp = rWrist && (rWrist.visibility ?? 1) > 0.35 && rWrist.y < hipY + 0.05;

    let candidate = null;
    if (lUp && rUp) candidate = lWrist.y < rWrist.y ? lWrist : rWrist;
    else if (lUp) candidate = lWrist;
    else if (rUp) candidate = rWrist;

    if (candidate) {
      if (!bestHand || candidate.y < bestHand.y) {
        bestHand = candidate;
        activePlayer = p;
      }
    }
  }

  if (bestHand && activePlayer) {
    cursorState.active = true;
    cursorState.lastActiveAt = now;
    cursorState.color = activePlayer.color || '#22d3ee';

    const lm = activePlayer.lm;
    const lSh = lm ? lm[11] : null;
    const rSh = lm ? lm[12] : null;
    const lHip = lm ? lm[23] : null;
    const rHip = lm ? lm[24] : null;
    const chestX = lSh && rSh ? (lSh.x + rSh.x) / 2 : 0.5;
    const chestY = lSh && rSh ? (lSh.y + rSh.y) / 2 : 0.35;
    const hipY = lHip && rHip ? (lHip.y + rHip.y) / 2 : chestY + 0.3;
    const shoulderW = lSh && rSh ? Math.max(0.12, Math.abs(lSh.x - rSh.x)) : 0.22;
    const torsoH = Math.max(0.20, hipY - chestY);

    const mirror = calibration.mirror !== false;
    const mirrorChestX = mirror ? 1 - chestX : chestX;
    const mirrorHandX = mirror ? 1 - bestHand.x : bestHand.x;
    const deltaX = mirrorHandX - mirrorChestX;
    const reachGain = calibration.reachGain ?? 1.55;
    const cameraOffset = calibration.cameraOffset ?? 0.0;
    const normX = deltaX / (shoulderW * 1.25);
    const reachX = clamp(0.5 + cameraOffset + normX * reachGain * 0.46, 0.015, 0.985) * window.innerWidth;
    
    // Continuous vertical mapping: head -> top, waist -> bottom
    const normY = (bestHand.y - (chestY - 0.08)) / (torsoH * 1.15);
    const reachY = clamp(normY, 0.02, 0.98) * window.innerHeight;

    cursorState.targetX = reachX;
    cursorState.targetY = reachY;
  } else if (now - cursorState.lastActiveAt > 500) {
    cursorState.active = false;
  }

  if (!cursorState.active || cursorState.selecting) {
    cursorEl.hidden = true;
    if (cursorState.hoveredItem) {
      cursorState.hoveredItem.el.classList.remove('kinect-hover');
      cursorState.hoveredItem = null;
    }
    cursorState.dwellTime = 0;
    return;
  }

  cursorState.x = damp(cursorState.x, cursorState.targetX, 22, dt);
  cursorState.y = damp(cursorState.y, cursorState.targetY, 22, dt);

  cursorEl.hidden = false;
  cursorEl.style.transform = `translate3d(${cursorState.x}px, ${cursorState.y}px, 0)`;
  cursorEl.style.setProperty('--cursor-color', cursorState.color);

  let hitItem = null;
  let bestDist = Infinity;
  for (const item of targets) {
    const rect = item.el.getBoundingClientRect();
    if (
      cursorState.x >= rect.left &&
      cursorState.x <= rect.right &&
      cursorState.y >= rect.top &&
      cursorState.y <= rect.bottom
    ) {
      hitItem = item;
      break;
    }
    const dx = Math.max(rect.left - cursorState.x, 0, cursorState.x - rect.right);
    const dy = Math.max(rect.top - cursorState.y, 0, cursorState.y - rect.bottom);
    const dist = Math.hypot(dx, dy);
    if (dist <= 24 && dist < bestDist) {
      bestDist = dist;
      hitItem = item;
    }
  }

  const ringFill = cursorEl.querySelector('.ring-fill');
  const label = cursorEl.querySelector('.kinect-cursor-label');

  if (hitItem) {
    if (cursorState.hoveredItem?.el !== hitItem.el) {
      if (cursorState.hoveredItem) cursorState.hoveredItem.el.classList.remove('kinect-hover');
      cursorState.hoveredItem = hitItem;
      cursorState.hoveredItem.el.classList.add('kinect-hover');
      cursorState.dwellTime = 0;
      audio.play('select');
    }

    const targetDwell = hitItem.dwell || DWELL_DURATION;
    cursorState.dwellTime += dt;
    const progress = clamp(cursorState.dwellTime / targetDwell, 0, 1);

    if (now - cursorState.lastTickAt > 300 && progress < 0.92) {
      cursorState.lastTickAt = now;
      audio.play('tick');
    }

    if (ringFill) ringFill.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);
    if (label) label.textContent = progress > 0.75 ? 'CONFIRMING...' : hitItem.label;

    if (cursorState.dwellTime >= targetDwell && !cursorState.selecting) {
      cursorState.selecting = true;
      hitItem.el.classList.add('kinect-selected');

      if (hitItem.type === 'home') {
        audio.play('select');
        setTimeout(() => {
          hitItem.el.classList.remove('kinect-hover', 'kinect-selected');
          cursorEl.hidden = true;
          cursorState.hoveredItem = null;
          cursorState.dwellTime = 0;
          cursorState.selecting = false;
          stopGame(true);
        }, 200);
      } else if (hitItem.type === 'toggle-view') {
        audio.play('select');
        if (game?.toggleView) game.toggleView();
        setTimeout(() => {
          hitItem.el.classList.remove('kinect-hover', 'kinect-selected');
          cursorState.hoveredItem = null;
          cursorState.dwellTime = 0;
          cursorState.selecting = false;
        }, 300);
      } else if (hitItem.type === 'exit-sys') {
        setTimeout(() => shutdownSystem(), 150);
      } else if (hitItem.type === 'game') {
        const gameId = hitItem.gameId;
        audio.play('go');
        setTimeout(() => {
          hitItem.el.classList.remove('kinect-hover', 'kinect-selected');
          cursorEl.hidden = true;
          cursorState.hoveredItem = null;
          cursorState.dwellTime = 0;
          cursorState.selecting = false;
          startGame(gameId, {});
        }, 220);
      }
    }
  } else {
    if (cursorState.hoveredItem) {
      cursorState.hoveredItem.el.classList.remove('kinect-hover');
      cursorState.hoveredItem = null;
    }
    cursorState.dwellTime = 0;
    if (ringFill) ringFill.style.strokeDashoffset = CIRCUMFERENCE;
    if (label) label.textContent = game ? 'POINT TO EXIT' : 'POINT TO BROWSE';
  }
}

function initClicks() {
  const cards = document.querySelectorAll('.attract-card');
  for (const card of cards) {
    card.addEventListener('click', () => {
      const gameId = card.dataset.gameId;
      if (gameId && !game) {
        card.classList.add('kinect-selected');
        audio.play('go');
        setTimeout(() => {
          card.classList.remove('kinect-selected');
          startGame(gameId, {});
        }, 150);
      }
    });
  }

  $('#gesture-home-btn')?.addEventListener('click', () => {
    if (game) {
      audio.play('select');
      stopGame(true);
    }
  });

  $('#gesture-view-btn')?.addEventListener('click', () => {
    if (game?.toggleView) {
      audio.play('select');
      game.toggleView();
    }
  });

  $('#gesture-exit-sys')?.addEventListener('click', shutdownSystem);
  $('#camera-toggle-btn')?.addEventListener('click', () => {
    if (!cameraActive) startCameraTracking();
  });

  // Re-request camera on user click if blocked by browser policy
  window.addEventListener('click', (e) => {
    if (!cameraActive && !cameraStarting && e.target.id !== 'gesture-exit-sys') {
      startCameraTracking();
    }
  });
}

/* ------------------------------------------------------------------ */
/* Corner Skeleton Tracking PIP & Live Camera Overlay                 */
/* ------------------------------------------------------------------ */
let pipMode = 'compact'; // 'compact' | 'large' | 'fullscreen'

function cyclePipMode() {
  const pipEl = $('#tv-tracking-pip');
  if (!pipEl) return;
  if (pipMode === 'compact') {
    pipMode = 'large';
    pipEl.classList.remove('pip-fullscreen');
    pipEl.classList.add('pip-large');
    toast('Live Tracking: Large View');
  } else if (pipMode === 'large') {
    pipMode = 'fullscreen';
    pipEl.classList.remove('pip-large');
    pipEl.classList.add('pip-fullscreen');
    toast('Live Tracking: Fullscreen AR View');
  } else {
    pipMode = 'compact';
    pipEl.classList.remove('pip-large', 'pip-fullscreen');
    toast('Live Tracking: Compact View');
  }
}

function drawPip(activePlayers) {
  const pipCanvas = $('#pip-canvas');
  if (!pipCanvas) return;
  const ctx = pipCanvas.getContext('2d');
  
  // High-definition 16:9 canvas buffer
  const targetW = 640;
  const targetH = 360;
  if (pipCanvas.width !== targetW || pipCanvas.height !== targetH) {
    pipCanvas.width = targetW;
    pipCanvas.height = targetH;
  }
  const w = pipCanvas.width;
  const h = pipCanvas.height;

  const joinedPlayers = activePlayers.filter((p) => p.joined);
  const countBadge = $('#pip-count');
  if (countBadge) countBadge.textContent = `${joinedPlayers.length} / 4 PLAYERS`;
  const pipDot = document.querySelector('.pip-dot');
  if (pipDot) pipDot.classList.toggle('active', joinedPlayers.length > 0);

  const statusText = $('#pip-status');
  if (statusText) {
    if (!cameraActive && !demo) {
      statusText.textContent = cameraStarting ? 'Starting camera…' : 'Camera inactive · Click to activate';
    } else if (!joinedPlayers.length) {
      statusText.textContent = '👋 Stand in view & wave to join';
    } else {
      statusText.textContent = joinedPlayers.map((p) => `${p.name} (Lvl ${p.profile?.level || 1})`).join(' · ');
    }
  }

  const mirror = calibration.mirror !== false;

  // 1. Draw live webcam camera feed (mirrored horizontally so player sees their natural reflection)
  if (video && video.readyState >= 2 && video.videoWidth > 0) {
    ctx.save();
    if (mirror) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    // Subtle dark contrast layer so neon skeletons and UI elements stand out with high vibrancy
    ctx.fillStyle = 'rgba(6, 12, 24, 0.28)';
    ctx.fillRect(0, 0, w, h);
  } else {
    // Clean background while camera initializes
    ctx.fillStyle = '#060a14';
    ctx.fillRect(0, 0, w, h);
  }

  // If no players detected yet, show helpful prompt over the live camera view
  if (!activePlayers.length) {
    ctx.save();
    const bannerMsg = cameraActive ? 'STAND IN FRONT OF CAMERA TO PLAY' : 'INITIALIZING CAMERA…';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const mw = ctx.measureText(bannerMsg).width + 36;
    ctx.fillStyle = 'rgba(8, 14, 28, 0.82)';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(w / 2 - mw / 2, h / 2 - 18, mw, 36, 10);
    } else {
      ctx.rect(w / 2 - mw / 2, h / 2 - 18, mw, 36);
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.fillText(bannerMsg, w / 2, h / 2);
    ctx.restore();
    return;
  }

  // 2. Overlay live tracking (skeleton, joint nodes, head badge, and raised hands) directly over real body
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const p of activePlayers) {
    if (!p.lm) continue;
    const isJoined = p.joined;
    const color = isJoined ? (p.color || '#22d3ee') : '#fbbf24';
    ctx.save();

    // Neon skeleton bones connecting joints
    ctx.strokeStyle = color;
    ctx.lineWidth = isJoined ? 3.2 : 2.2;
    ctx.shadowColor = color;
    ctx.shadowBlur = isJoined ? 8 : 4;
    if (!isJoined) {
      ctx.globalAlpha = 0.85;
    }

    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      const A = p.lm[a];
      const B = p.lm[b];
      if (!A || !B) continue;
      const ax = (mirror ? 1 - A.x : A.x) * w;
      const ay = A.y * h;
      const bx = (mirror ? 1 - B.x : B.x) * w;
      const by = B.y * h;
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();

    // Glowing joint dots
    ctx.shadowBlur = 4;
    for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const pt = p.lm[i];
      if (!pt) continue;
      const px = (mirror ? 1 - pt.x : pt.x) * w;
      const py = pt.y * h;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(px, py, isJoined ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, isJoined ? 2.2 : 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Active raised hand detection & highlight halo
    const wristL = p.lm[15];
    const wristR = p.lm[16];
    const shL = p.lm[11];
    const shR = p.lm[12];
    for (const [wrist, shoulder] of [[wristL, shL], [wristR, shR]]) {
      if (wrist && shoulder && wrist.y < shoulder.y) {
        const hx = (mirror ? 1 - wrist.x : wrist.x) * w;
        const hy = wrist.y * h;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx, hy, 14, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(hx, hy, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Floating badge above head
    const nose = p.lm[0];
    if (nose) {
      const nx = (mirror ? 1 - nose.x : nose.x) * w;
      const ny = Math.max(22, nose.y * h - 22);

      let label;
      if (isJoined) {
        label = `${p.profile?.icon || '⚡'} ${p.name}`;
      } else {
        const prog = p.motion?.waveProgress || 0;
        label = prog > 0.3 ? '👋 WAVING...' : '👋 WAVE TO JOIN';
      }

      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const textW = ctx.measureText(label).width + 16;

      ctx.fillStyle = isJoined ? 'rgba(8, 14, 28, 0.9)' : 'rgba(180, 83, 9, 0.92)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(nx - textW / 2, ny - 12, textW, 20, 6);
      } else {
        ctx.rect(nx - textW / 2, ny - 12, textW, 20);
      }
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, nx, ny + 2);

      // Distance advisory if standing too far or too close
      if (p.stage) {
        let distMsg = null;
        if (p.stage.z > 3.8) distMsg = '→ STEP CLOSER';
        else if (p.stage.z < 1.3) distMsg = '← STEP BACK';

        if (distMsg) {
          ctx.font = 'bold 10px system-ui, sans-serif';
          const dw = ctx.measureText(distMsg).width + 12;
          ctx.fillStyle = 'rgba(239, 68, 68, 0.88)';
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(nx - dw / 2, ny + 12, dw, 15, 4);
          } else {
            ctx.rect(nx - dw / 2, ny + 12, dw, 15);
          }
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.fillText(distMsg, nx, ny + 23);
        }
      }
    }

    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/* View Rig & Projection                                               */
/* ------------------------------------------------------------------ */
function applyViewRig(dt) {
  if (game?.overrideCamera) return;
  const stages = [];
  for (const key of playerOrder) {
    const p = players.get(key);
    if (p && p.active && p.stage) stages.push(p.stage);
  }
  viewRig = computeViewRig(calibration, stages, engine.camera.aspect || 16 / 9);
  const cam = engine.camera;
  cam.fov = damp(cam.fov, viewRig.fov, 2.2, dt);
  cam.updateProjectionMatrix();

  const now = performance.now();
  if (now - lastViewAt > 500) {
    lastViewAt = now;
    const badge = $('#view-badge');
    if (badge) {
      if (viewRig.count) {
        badge.textContent = `VIEW AUTO · ${viewRig.avgDistance.toFixed(1)} m · ${Math.round(viewRig.fov)}°`;
        badge.classList.add('ok');
      } else {
        badge.textContent = 'VIEW AUTO';
        badge.classList.remove('ok');
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Main Animation Loop                                                 */
/* ------------------------------------------------------------------ */
let last = performance.now();
let menuTime = 0;
let lastPrune = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  menuTime += dt;

  try {
    // 1. Run local camera pose detection if camera is live
    if (cameraActive && poseEngine?.ready && video.readyState >= 2) {
      const aspect = video.videoWidth ? video.videoWidth / video.videoHeight : 16 / 9;
      const tracks = poseEngine.detect(video, now, aspect);

      for (const t of tracks) {
        const key = `local:${t.id}`;
        const bodySpan = t.lm?.[27] && t.lm?.[0] ? t.lm[27].y - t.lm[0].y : null;
        const p = ensurePlayer(key, { id: t.id, name: t.name, color: t.color, aspect }, bodySpan);
        p.lm = t.smooth || t.lm;
        p.fastLm = t.fast || t.lm;
        p.worldLm = t.world || null;
        p.aspect = aspect;
        p.avatar.aspect = aspect;
        p.lastSeen = now;
        p.active = true;
        p.stage = mapGroundToStage(calibration, p.lm, aspect, { mirror: calibration.mirror });
        p.motion.update(p.fastLm, aspect, now, p.worldLm, p.lm);

        // Wave to Join Gate: player only becomes active in game/menu after waving!
        if (!p.joined) {
          if (p.motion.waveAt && p.motion.waveAt > (p.waveSeen || 0)) {
            p.waveSeen = p.motion.waveAt;
            joinPlayer(p);
          }
        }
      }
    }

    if (demo) updateDemo(dt);

    const activeJoined = playerOrder
      .map((k) => players.get(k))
      .filter((p) => p && p.joined && now - p.lastSeen < 1800 && p.lm);

    const allVisible = Array.from(players.values())
      .filter((p) => p && now - p.lastSeen < 1800 && p.lm);

    drawPip(allVisible);

    if (game) {
      // Check pause gesture || (parallel arms overhead) across active players
      for (const p of activeJoined) {
        if (p.motion?.state?.events?.length) {
          const pauseIdx = p.motion.state.events.findIndex((e) => e.type === 'pauseToggle');
          if (pauseIdx !== -1) {
            p.motion.state.events.splice(pauseIdx, 1);
            toggleGamePause();
          }
        }
      }

      // Live update Dominant Hand Calibration progress if modal active
      if (dominantHandCalibrating && activeJoined[0]) {
        updateDominantHandCalibration(activeJoined[0]);
      }

      // Live update Player 2 Drop-in Gestures if modal active
      if (pendingPlayer2Join) {
        updatePlayer2JoinGestures(pendingPlayer2Join);
      }

      const effectiveDt = (isGamePaused || dominantHandCalibrating) ? 0 : dt;
      for (const p of activeJoined) {
        p.avatar.aspect = p.aspect;
        p.avatar.update(p.lm, p.stage, effectiveDt, {
          active: p.active && now - p.lastSeen < 900,
          lockFacing: game?.id === 'boxing',
        });
      }
      if (effectiveDt > 0) {
        game.update(effectiveDt);
      }
      applyViewRig(dt);
      game.fx?.update(effectiveDt);
      if (now - lastHudAt > 110) {
        lastHudAt = now;
        const hud = game.getHud();
        const key = hudKey(hud);
        if (key !== hudCacheKey) {
          hudCacheKey = key;
          renderHud(hud);
        }
      }
    } else {
      menu.update(dt, menuTime);

      // Only joined players appear on the 3D stage floor!
      let idx = 0;
      const count = activeJoined.length;
      for (const p of activeJoined) {
        if (!menu.scene.children.includes(p.avatar.group)) {
          p.avatar.followStage = false;
          p.avatar.seated = false;
          p.avatar.setProp('none');
          p.avatar.setVisible(true);
          menu.scene.add(p.avatar.group);
        }

        let posX = 0;
        if (count === 1) {
          posX = p.stage?.x ? p.stage.x * 0.85 : 0;
        } else {
          const slotX = -2.5 + (idx * 5.0) / (count - 1);
          posX = p.stage?.x ? lerp(slotX, p.stage.x * 0.85, 0.4) : slotX;
        }
        const posZ = p.stage?.z ? clamp(p.stage.z * 0.4, -0.5, 1.2) : 0;
        p.avatar.group.position.set(posX, 0, posZ);
        p.avatar.aspect = p.aspect;
        p.avatar.update(p.lm, { x: posX, z: posZ }, dt, { active: true });
        idx++;
      }
    }

    updateHandMenu(dt, now);

    if (now - lastPrune > 1500) {
      lastPrune = now;
      prunePlayers();
    }

    engine.render(dt);
  } catch (err) {
    showFatal(err);
  }
}

/* ------------------------------------------------------------------ */
/* Screen Wake Lock                                                    */
/* ------------------------------------------------------------------ */
let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
    console.log('[power] Screen wake lock active');
  } catch (err) {
    console.warn('[power] Screen wake lock failed:', err.message);
  }
}

function toast(text, ms = 2600) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), ms);
}

function showFatal(err) {
  console.error(err);
  if (fatalShown) return;
  fatalShown = true;
  const box = $('#fatal');
  if (!box) return;
  box.hidden = false;
  box.querySelector('.fatal-msg').textContent = err?.message || String(err);
}

/* ------------------------------------------------------------------ */
/* Boot Console                                                        */
/* ------------------------------------------------------------------ */
async function boot() {
  initMenu();
  initClicks();
  requestWakeLock();

  profileManager.renderBadges();
  $('#room-code').textContent = room;
  $('#attract').hidden = false;
  $('#hud').hidden = true;
  updateAttractPlayers();

  if (demo) {
    initDemo();
    const gameId = params.get('game');
    if (gameId) setTimeout(() => startGame(gameId, {}), 600);
  } else {
    // Load local PoseEngine
    poseEngine = new PoseEngine({
      maxPlayers: 4,
      onStatus: (msg) => {
        const el = $('#pip-status');
        if (el) el.textContent = msg;
      },
    });
    poseEngine.load().catch((err) => console.warn('[poseEngine] init error', err));
    startCameraTracking();
  }

  net.connect();
  requestAnimationFrame(frame);

  $('#btn-fullscreen')?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => toast('Fullscreen was blocked'));
  });
  $('#btn-sound')?.addEventListener('click', async () => {
    const ok = await audio.unlock();
    audio.setMuted(!ok ? true : false);
    toast(ok ? 'Sound on' : 'Sound unavailable');
  });

  $('#pip-calibrate-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    recalibrateReach();
  });
  $('#pip-size-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    cyclePipMode();
  });
  $('#btn-cam-view')?.addEventListener('click', () => {
    cyclePipMode();
  });
  $('#tv-tracking-pip')?.addEventListener('click', (e) => {
    if (e.target.closest('#pip-size-btn') || e.target.closest('#pip-calibrate-btn')) return;
    cyclePipMode();
  });

  // Pause Modal Actions
  $('#btn-pause-resume')?.addEventListener('click', () => toggleGamePause(false));
  $('#btn-pause-hand')?.addEventListener('click', () => {
    toggleGamePause(false);
    const mainP = players.get(playerOrder[0]);
    if (mainP && game) promptDominantHand(mainP, game.id);
  });
  $('#btn-pause-home')?.addEventListener('click', () => {
    toggleGamePause(false);
    stopGame(true);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'c' || e.key === 'C' || e.key === 'v' || e.key === 'V') {
      cyclePipMode();
    }
    if (e.key === 'r' || e.key === 'R') {
      recalibrateReach();
    }
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      if (game) toggleGamePause();
    }
    if (pendingPlayer2Join) {
      if (e.key === '1') $('#opt-join-against')?.click();
      if (e.key === '2') $('#opt-join-with')?.click();
      if (e.key === 'Escape') $('#btn-join-dismiss')?.click();
    }
    if (dominantHandCalibrating) {
      if (e.key === 'ArrowLeft' || e.key === 'l' || e.key === 'L') $('#hand-opt-left')?.click();
      if (e.key === 'ArrowRight' || e.key === 'r' || e.key === 'R') $('#hand-opt-right')?.click();
    }
  });

  document.addEventListener('pointerdown', () => {
    audio.unlock().catch(() => {});
    if (!wakeLock) requestWakeLock();
  }, { once: true });

  window.addEventListener('error', (e) => showFatal(e.error || new Error(e.message)));
  window.addEventListener('unhandledrejection', (e) => showFatal(e.reason));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      last = performance.now();
      if (!wakeLock) requestWakeLock();
    }
  });
}

boot();
