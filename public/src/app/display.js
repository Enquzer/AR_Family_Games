/**
 * TV display application.
 * Renders the game world, receives tracked poses, runs the authoritative game
 * simulation, and reports scores back to the controller.
 */
import { Engine } from '../engine/engine.js';
import { Avatar } from '../engine/avatar.js';
import { buildMenuWorld } from '../engine/environments.js';
import { Effects } from '../engine/effects.js';
import { NetClient } from '../net/client.js';
import { MotionTracker } from '../vision/motion.js';
import { PoseSimulator } from '../vision/simulator.js';
import { unpackPose, CONNECTIONS } from '../shared/pose.js';
import {
  calibrationFromMessage,
  defaultCalibration,
  mapGroundToStage,
  computeViewRig,
} from '../shared/stage.js';
import { formatTime, clamp, damp, lerp } from '../shared/math.js';
import { createGame } from '../games/index.js';
import { GAME_BY_ID } from '../games/catalog.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const room = (params.get('room') || 'HOME').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'HOME';
const demo = params.get('demo') === '1';

const canvas = $('#stage');
const engine = new Engine(canvas);
const audio = engine.audio;
const net = new NetClient({ room, role: 'display', name: 'TV' });

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
    if (p.lm && performance.now() - p.lastSeen < 1200) {
      targetP = p;
      break;
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
let sim = null;
let lastHudAt = 0;
let lastStateAt = 0;
let flashUntil = 0;
let hudCacheKey = '';
let fatalShown = false;
let viewRig = null;
let lastViewAt = 0;
let controllerCount = 0;
let trackerCount = 0;
let hostCamera = null;
let hostDemo = false;
let lastCameraOffToastAt = 0;

const players = new Map();
const playerOrder = [];
let demoPlayers = null;

/* ------------------------------------------------------------------ */
/* Menu world                                                          */
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
/* Players                                                             */
/* ------------------------------------------------------------------ */
function ensurePlayer(key, meta) {
  let p = players.get(key);
  const now = performance.now();
  if (!p) {
    p = {
      key,
      id: meta.id ?? key,
      name: meta.name || 'Player',
      color: meta.color || '#22d3ee',
      avatar: new Avatar({ name: meta.name || 'Player', color: meta.color || '#22d3ee', id: key }),
      motion: new MotionTracker(),
      lm: null,
      aspect: meta.aspect || 16 / 9,
      stage: { x: 0, z: 0, t: 0, u: 0.5, v: 0.9, half: 4, visible: true },
      lastSeen: now,
      firstSeen: now,
      active: true,
      packets: 0,
      joined: true,
      waveSeen: 0,
    };
    p.avatar.setVisible(true);
    players.set(key, p);
    playerOrder.push(key);
    joinPlayer(p, { silent: true });
  }
  if (meta.name && meta.name !== p.name) {
    p.name = meta.name;
    p.avatar.setName(meta.name);
  }
  if (meta.color && meta.color !== p.color) {
    p.color = meta.color;
    p.avatar.setColor(meta.color);
  }
  return p;
}

/**
 * A player becomes active only after waving at the camera (or when the host
 * explicitly marks them joined). This is the Kinect-style "wave to join" gate.
 */
function joinPlayer(p, opts = {}) {
  if (!p) return;
  if (!p.joined) {
    p.joined = true;
    p.avatar.setVisible(true);
    if (game && !game.players?.includes(p)) {
      if (game.players?.length >= 1) {
        promptPlayer2Join(p);
      } else {
        game.addPlayer(p);
      }
    }
    updateAttractPlayers();
    if (!opts.silent) {
      toast(`${p.name} joined 👋`);
      try {
        audio.play('select');
      } catch {
        /* audio is optional */
      }
    }
  } else if (game && !game.players?.includes(p)) {
    if (game.players?.length >= 1) {
      promptPlayer2Join(p);
    } else {
      game.addPlayer(p);
    }
  }
}

function updateAttractPlayers() {
  const wrap = $('#attract-players');
  if (!wrap) return;
  if (!controllerCount && !demo) {
    wrap.innerHTML =
      '<span class="connect-prompt">📷 Open <a href="/" target="_blank" rel="noopener">http://localhost:3000</a> on the laptop and start the camera</span>';
    return;
  }
  if (controllerCount && hostCamera === false && !hostDemo && !demo && trackerCount === 0) {
    wrap.innerHTML =
      '<span class="connect-prompt camera">📷 Controller connected — click <strong>Start camera</strong> on the laptop</span>';
    return;
  }
  const joined = playerOrder.map((key) => players.get(key)).filter((p) => p && (p.joined || p.active));
  if (!joined.length) {
    wrap.innerHTML = '<span class="wave-prompt">📷 Step into camera view to join (up to 4 players)</span>';
    return;
  }
  wrap.innerHTML = '';
  wrap.append(
    el('span', 'attract-ready', `${joined.length} PLAYER${joined.length === 1 ? '' : 'S'} TRACKED`)
  );
  for (const p of joined) {
    const chip = el('span', 'attract-player', p.name);
    chip.style.setProperty('--c', p.color);
    wrap.append(chip);
  }
}

function ingestPose(from, packet) {
  const aspect = packet.aspect || 16 / 9;
  for (const pl of packet.players || []) {
    if (!pl || pl.id == null || !pl.lm) continue;
    const key = `${from}:${pl.id}`;
    const p = ensurePlayer(key, { ...pl, aspect });
    const lm = unpackPose(pl.lm);
    if (!lm) continue;
    const ts = packet.ts || performance.now();
    p.lm = lm;
    p.aspect = aspect;
    p.avatar.aspect = aspect;
    p.lastSeen = performance.now();
    p.active = true;
    p.packets++;
    p.stage = mapGroundToStage(calibration, lm, aspect, { mirror: calibration.mirror });
    p.motion.update(lm, aspect, ts);
    if (!p.joined) {
      joinPlayer(p, { silent: true });
    }
  }
}

function prunePlayers() {
  const now = performance.now();
  let changed = false;
  for (const p of players.values()) {
    p.active = now - p.lastSeen < 1600;
    const ttl = p.joined ? 45000 : 12000;
    if (now - p.lastSeen > ttl) {
      p.avatar.group.removeFromParent();
      p.avatar.dispose();
      players.delete(p.key);
      const i = playerOrder.indexOf(p.key);
      if (i >= 0) playerOrder.splice(i, 1);
      changed = true;
    }
  }
  if (changed) updateAttractPlayers();
}

/* ------------------------------------------------------------------ */
/* Game lifecycle                                                      */
/* ------------------------------------------------------------------ */
function startGame(gameId, options = {}) {
  const meta = GAME_BY_ID[gameId];
  if (!meta) return;
  const cursorEl = $('#kinect-cursor');
  if (cursorEl) cursorEl.hidden = true;
  for (const p of players.values()) {
    p.avatar.group.removeFromParent();
  }
  stopGame(false);
  // Prepare demo players before the game starts so every player gets game state.
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
  audio.unlock().catch(() => {});
  for (const key of playerOrder) {
    const p = players.get(key);
    if (p?.joined) game.addPlayer(p);
  }
  game.start();
  $('#attract').hidden = true;
  $('#hud').hidden = false;
  document.body.dataset.game = gameId;
  toast(`${meta.icon} ${meta.title} started`);
  lastHudAt = 0;
  lastStateAt = 0;
  hudCacheKey = '';

  const mainPlayer = players.get(playerOrder[0]);
  if (HAND_PROMPT_GAMES.includes(gameId) && mainPlayer) {
    promptDominantHand(mainPlayer, gameId);
  }
}

function stopGame(showMenu = true) {
  if (!game) return;
  const old = game;
  game = null;

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
    const viewBadge = $('#view-badge');
    if (viewBadge) {
      viewBadge.textContent = 'VIEW AUTO';
      viewBadge.classList.remove('ok');
    }
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
  if (s.reachForwardL > 0.32 && s.reachForwardL > s.reachForwardR + 0.14) {
    $('#opt-join-against')?.classList.add('active');
    setTimeout(() => $('#opt-join-against')?.click(), 250);
  } else if (s.reachForwardR > 0.32 && s.reachForwardR > s.reachForwardL + 0.14) {
    $('#opt-join-with')?.classList.add('active');
    setTimeout(() => $('#opt-join-with')?.click(), 250);
  }
}

/* ------------------------------------------------------------------ */
/* Demo mode                                                           */
/* ------------------------------------------------------------------ */
function initDemo() {
  sim = new PoseSimulator({ players: 2, scenario: 'idle' });
  syncDemoPlayers();
}

function syncDemoPlayers() {
  if (!sim) return;
  const wanted = new Set(sim.players.map((sp) => `demo:${sp.id}`));
  // Drop demo players that no longer exist when the roster shrinks (e.g.
  // switching from a 4-player game to a 2-player game).
  for (const [key, p] of players) {
    if (!p.demo || wanted.has(key)) continue;
    p.avatar.dispose();
    players.delete(key);
    const i = playerOrder.indexOf(key);
    if (i >= 0) playerOrder.splice(i, 1);
  }
  for (const sp of sim.players) {
    const key = `demo:${sp.id}`;
    const p = ensurePlayer(key, {
      id: sp.id,
      name: sp.name,
      color: sp.color,
      aspect: 16 / 9,
      joined: true,
    });
    p.demo = true;
  }
  demoPlayers = sim.players;
}

let demoTick = 0;
function updateDemo(dt) {
  if (!sim) return;
  demoTick += dt;
  if (demoTick < 1 / 30) return;
  const step = Math.min(demoTick, 0.1);
  demoTick = 0;
  // Demo dancers copy the live coach target so the demo shows the intended
  // follow-the-move interaction, including readable scores and combos.
  sim.setDanceGuide(game?.id === 'dance' ? game.currentMove : null);
  const list = sim.update(step);
  for (const sp of list) {
    const key = `demo:${sp.id}`;
    const p = players.get(key);
    if (!p) continue;
    p.lm = sp.lm;
    p.aspect = 16 / 9;
    p.avatar.aspect = 16 / 9;
    p.lastSeen = performance.now();
    p.active = true;
    p.stage = mapGroundToStage(calibration, sp.lm, 16 / 9, { mirror: calibration.mirror });
    if (game) p.motion.update(sp.lm, 16 / 9, performance.now());
  }
}

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

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

  const queue = $('#hud-queue');
  queue.innerHTML = '';
  if (hud.queue && hud.queue.length) {
    queue.append(el('span', 'qlabel', 'UP NEXT'));
    for (const q of hud.queue) {
      const chip = el('span', 'qchip', q.name);
      chip.style.setProperty('--c', q.color || '#22d3ee');
      queue.append(chip);
    }
  }

  const results = $('#hud-results');
  results.innerHTML = '';
  if (hud.results && hud.results.length && (hud.phase === 'results' || hud.phase === 'final' || hud.phase === 'matchEnd')) {
    results.hidden = false;
    results.append(el('div', 'results-title', hud.phase === 'final' ? 'SERIES STANDINGS' : 'RESULTS'));
    for (const r of hud.results.slice(0, 6)) {
      const row = el('div', 'result-row');
      row.style.setProperty('--c', r.color || '#22d3ee');
      row.append(el('span', 'rrank', r.rank ? `#${r.rank}` : ''));
      row.append(el('span', 'rname', r.name));
      row.append(el('span', 'rtime', r.time != null ? `${r.time.toFixed(2)}s` : r.detail || ''));
      if (r.gained != null) row.append(el('span', 'rgain', `+${r.gained}`));
      results.append(row);
    }
  } else {
    results.hidden = true;
  }

  const calBadge = $('#cal-badge');
  if (calBadge) {
    calBadge.textContent = calibration.synthetic ? 'QUICK SETUP' : 'TV CALIBRATED';
    calBadge.className = 'cal-badge ' + (calibration.synthetic ? 'warn' : 'ok');
  }
}

function hudKey(hud) {
  if (!hud) return '';
  return [
    hud.phase,
    hud.message,
    hud.score,
    hud.timer?.toFixed(1),
    hud.big?.text,
    ...(hud.players || []).map((p) => `${p.id}:${Math.round(p.value)}:${p.points}:${p.detail}`),
  ].join('|');
}

/* ------------------------------------------------------------------ */
/* Networking                                                          */
/* ------------------------------------------------------------------ */
net.addEventListener('status', (ev) => {
  const on = ev.detail.connected;
  const dot = $('#net-dot');
  if (dot) dot.className = 'dot ' + (on ? 'ok' : 'bad');
  const label = $('#net-label');
  if (label) label.textContent = on ? 'LIVE' : 'RECONNECTING';
});

net.addEventListener('msg', (ev) => {
  const msg = ev.detail;
  switch (msg.t) {
    case 'welcome': {
      $('#room-code').textContent = msg.room;
      if (msg.calibration) {
        calibration = calibrationFromMessage(msg.calibration);
        if (game) game.ctx.calibration = calibration;
      }
      if (msg.game && msg.game.gameId && msg.game.action === 'start') {
        startGame(msg.game.gameId, msg.game.options || {});
      }
      break;
    }
    case 'peers': {
      const hosts = msg.peers.filter((p) => p.role === 'host').length;
      trackerCount = msg.peers.filter((p) => p.role === 'tracker').length;
      controllerCount = hosts + trackerCount;
      const label = $('#controller-label');
      if (label) {
        if (hosts) label.textContent = `${hosts} CONTROLLER${hosts > 1 ? 'S' : ''}`;
        else if (trackerCount) label.textContent = `${trackerCount} TRACKER${trackerCount > 1 ? 'S' : ''}`;
        else label.textContent = 'NO CONTROLLER';
      }
      updateAttractPlayers();
      break;
    }
    case 'poses':
      ingestPose(msg.from, msg);
      break;
    case 'event': {
      if (msg.name === 'host:status') {
        hostCamera = msg.payload?.camera === true;
        hostDemo = msg.payload?.demo === true;
        updateAttractPlayers();
        if (hostCamera === false && !hostDemo && trackerCount === 0 && Date.now() - lastCameraOffToastAt > 8000) {
          lastCameraOffToastAt = Date.now();
          toast('Laptop camera is off — start it on the controller');
        }
      }
      break;
    }
    case 'calibration':
      calibration = calibrationFromMessage(msg.calibration);
      if (game) game.ctx.calibration = calibration;
      toast('TV calibration updated');
      break;
    case 'command':
      if (msg.action === 'start' && msg.gameId) startGame(msg.gameId, msg.options || {});
      else if (msg.action === 'stop' || msg.action === 'menu') stopGame(true);
      else if (msg.action === 'calibrate:flash') flashScreen(2200);
      break;
    case 'flash':
      flashScreen(msg.duration || 2200);
      break;
    case 'player':
      break;
    default:
      break;
  }
});

function flashScreen(duration = 2200) {
  const flash = $('#flash');
  if (!flash) return;
  flash.style.transition = 'none';
  flash.style.opacity = '1';
  flashUntil = performance.now() + duration;
  // force layout, then schedule fade
  requestAnimationFrame(() => {
    flash.style.transition = `opacity 500ms ease ${Math.max(0, duration - 400)}ms`;
    flash.style.opacity = '0';
  });
}

let toastTimer = 0;
function toast(text, ms = 2600) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
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
/* Auto view rig                                                       */
/* ------------------------------------------------------------------ */
/**
 * Keeps the whole player group comfortably framed. Player distances come from
 * the trig body-size estimate; the FOV only ever widens from the TV-calibrated
 * base so the room's perspective is preserved.
 */
function applyViewRig(dt) {
  const stages = [];
  for (const key of playerOrder) {
    const p = players.get(key);
    if (p?.joined && p.stage) stages.push(p.stage);
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
/* Kinect Hand Menu & Gesture Actions (Browse, Home, Shutdown)        */
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
const CIRCUMFERENCE = 2 * Math.PI * 26; // 163.36

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

  // During active gameplay, hide the hand cursor and loading dwell ring completely
  // so boxing punches, swings, and dance gestures never trigger dwell-click or close the game!
  // The cursor is ONLY active when paused or on the home menu.
  if (game && !isGamePaused && !pendingPlayer2Join) {
    if (cursorState.hoveredItem) {
      cursorState.hoveredItem.el.classList.remove('kinect-hover');
      cursorState.hoveredItem = null;
    }
    cursorState.dwellTime = 0;
    cursorState.active = false;
    cursorEl.hidden = true;
    return;
  }

  // Build target list depending on whether a game is active
  const targets = [];
  if (game && isGamePaused) {
    const resumeBtn = $('#btn-pause-resume');
    if (resumeBtn) {
      targets.push({ el: resumeBtn, type: 'pause-resume', dwell: 1.2, label: 'HOLD TO RESUME' });
    }
    const handBtn = $('#btn-pause-hand');
    if (handBtn) {
      targets.push({ el: handBtn, type: 'pause-hand', dwell: 1.2, label: 'HOLD TO SWITCH' });
    }
    const homeBtn = $('#btn-pause-home');
    if (homeBtn) {
      targets.push({ el: homeBtn, type: 'pause-home', dwell: 1.35, label: 'HOLD FOR HOME' });
    }
  } else if (!game) {
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

  // 1. Look for any player with an active raised hand
  let bestHand = null;
  let activePlayer = null;

  for (const p of players.values()) {
    if (!p.lm || now - p.lastSeen > 1200) continue;
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

  // 2. If hand found, map to screen coordinates with living room reach
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

  // 3. Update cursor DOM and smoothing
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

  // 4. Hit-test against interactive targets (distance-prioritized)
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

    // Audio tick while holding
    if (now - cursorState.lastTickAt > 300 && progress < 0.92) {
      cursorState.lastTickAt = now;
      audio.play('tick');
    }

    if (ringFill) {
      ringFill.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);
    }
    if (label) {
      label.textContent = progress > 0.75 ? 'CONFIRMING...' : hitItem.label;
    }

    // 5. Complete dwell action
    if (cursorState.dwellTime >= targetDwell && !cursorState.selecting) {
      cursorState.selecting = true;
      hitItem.el.classList.add('kinect-selected');

      if (hitItem.type === 'home' || hitItem.type === 'pause-home') {
        audio.play('select');
        net.send({ t: 'command', action: 'stop' });
        setTimeout(() => {
          hitItem.el.classList.remove('kinect-hover', 'kinect-selected');
          cursorEl.hidden = true;
          cursorState.hoveredItem = null;
          cursorState.dwellTime = 0;
          cursorState.selecting = false;
          if (isGamePaused) toggleGamePause(false);
          stopGame(true);
        }, 200);
      } else if (hitItem.type === 'pause-resume') {
        audio.play('select');
        setTimeout(() => {
          hitItem.el.classList.remove('kinect-hover', 'kinect-selected');
          cursorEl.hidden = true;
          cursorState.hoveredItem = null;
          cursorState.dwellTime = 0;
          cursorState.selecting = false;
          toggleGamePause(false);
        }, 200);
      } else if (hitItem.type === 'pause-hand') {
        audio.play('select');
        setTimeout(() => {
          hitItem.el.classList.remove('kinect-hover', 'kinect-selected');
          cursorEl.hidden = true;
          cursorState.hoveredItem = null;
          cursorState.dwellTime = 0;
          cursorState.selecting = false;
          toggleGamePause(false);
          const mainP = players.get(playerOrder[0]);
          if (mainP) promptDominantHand(mainP, game?.id);
        }, 200);
      } else if (hitItem.type === 'exit-sys') {
        setTimeout(() => {
          shutdownSystem();
        }, 150);
      } else if (hitItem.type === 'game') {
        const gameId = hitItem.gameId;
        audio.play('go');
        if (activePlayer) joinPlayer(activePlayer);
        net.send({ t: 'command', action: 'start', gameId, options: {} });
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

function initCardClicks() {
  const cards = document.querySelectorAll('.attract-card');
  for (const card of cards) {
    card.addEventListener('click', () => {
      const gameId = card.dataset.gameId;
      if (gameId && !game) {
        card.classList.add('kinect-selected');
        audio.play('go');
        net.send({ t: 'command', action: 'start', gameId, options: {} });
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
      net.send({ t: 'command', action: 'stop' });
      stopGame(true);
    }
  });

  $('#gesture-exit-sys')?.addEventListener('click', shutdownSystem);
}

/* ------------------------------------------------------------------ */
/* Loop                                                                */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Live Multi-Player Skeleton Tracking PIP (Corner TV Mirror)         */
/* ------------------------------------------------------------------ */
function drawPip(activePlayers) {
  const pipCanvas = $('#pip-canvas');
  if (!pipCanvas) return;
  const ctx = pipCanvas.getContext('2d');
  const w = pipCanvas.width;
  const h = pipCanvas.height;
  ctx.clearRect(0, 0, w, h);

  const countBadge = $('#pip-count');
  if (countBadge) countBadge.textContent = `${activePlayers.length} / 4`;
  const pipDot = document.querySelector('.pip-dot');
  if (pipDot) pipDot.classList.toggle('active', activePlayers.length > 0);

  const statusText = $('#pip-status');
  if (statusText) {
    if (!activePlayers.length) {
      statusText.textContent = 'Stand in view of camera';
    } else {
      statusText.textContent = activePlayers.map((p) => p.name).join(' · ');
    }
  }

  if (!activePlayers.length) {
    ctx.fillStyle = 'rgba(100, 116, 139, 0.45)';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NO PLAYERS IN VIEW', w / 2, h / 2);
    return;
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const mirror = calibration.mirror !== false;

  for (const p of activePlayers) {
    if (!p.lm) continue;
    const color = p.color || '#22d3ee';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.4;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;

    // Draw skeleton connections
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

    // Draw joint dots
    for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const pt = p.lm[i];
      if (!pt) continue;
      const px = (mirror ? 1 - pt.x : pt.x) * w;
      const py = pt.y * h;
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Name tag above head
    const nose = p.lm[0];
    if (nose) {
      const nx = (mirror ? 1 - nose.x : nose.x) * w;
      const ny = Math.max(12, nose.y * h - 10);
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      const tw = ctx.measureText(p.name).width + 8;
      ctx.fillRect(nx - tw / 2, ny - 9, tw, 12);
      ctx.fillStyle = color;
      ctx.fillText(p.name, nx, ny);
    }

    ctx.restore();
  }
}

let last = performance.now();
let menuTime = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  menuTime += dt;

  try {
    if (demo) updateDemo(dt);

    const activeList = playerOrder
      .map((k) => players.get(k))
      .filter((p) => p && now - p.lastSeen < 1400 && p.lm);

    drawPip(activeList);

    if (game) {
      // Check pause gesture || (parallel arms overhead) across active players
      for (const p of activeList) {
        if (p.motion?.state?.events?.length) {
          const pauseIdx = p.motion.state.events.findIndex((e) => e.type === 'pauseToggle');
          if (pauseIdx !== -1) {
            p.motion.state.events.splice(pauseIdx, 1);
            toggleGamePause();
          }
        }
      }

      // Live update Dominant Hand Calibration progress if modal active
      if (dominantHandCalibrating && activeList[0]) {
        updateDominantHandCalibration(activeList[0]);
      }

      // Live update Player 2 Drop-in Gestures if modal active
      if (pendingPlayer2Join) {
        updatePlayer2JoinGestures(pendingPlayer2Join);
      }

      const effectiveDt = (isGamePaused || dominantHandCalibrating) ? 0 : dt;
      for (const p of activeList) {
        p.avatar.aspect = p.aspect;
        p.avatar.update(p.lm, p.stage, effectiveDt, { active: p.active && now - p.lastSeen < 900 });
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
        if (net.connected && now - lastStateAt > 150) {
          lastStateAt = now;
          net.send({
            t: 'state',
            state: {
              gameId: game.id,
              phase: game.phase,
              message: hud.message,
              score: hud.score || null,
              timer: hud.timer,
              players: (hud.players || []).map((p) => ({
                id: p.id,
                name: p.name,
                color: p.color,
                value: Math.round(p.value * 10) / 10,
                max: p.max,
                detail: p.detail,
              })),
            },
          });
        }
      }
    } else {
      menu.update(dt, menuTime);

      // Up to 4 players visible and moving live on the 3D menu stage!
      let idx = 0;
      const count = activeList.length;
      for (const p of activeList) {
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
let lastPrune = 0;

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Screen Wake Lock (Prevent screen darkening & computer sleep)        */
/* ------------------------------------------------------------------ */
let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
    console.log('[power] Screen wake lock active — display will not dim or sleep');
  } catch (err) {
    console.warn('[power] Screen wake lock failed:', err.message);
  }
}

function boot() {
  initMenu();
  initCardClicks();
  requestWakeLock();
  $('#room-code').textContent = room;
  $('#attract').hidden = false;
  $('#hud').hidden = true;
  updateAttractPlayers();
  if (params.get('debug') === '1') {
    // Read-only diagnostics hook used by the smoke tests and headless checks.
    window.__arfg = {
      engine,
      players,
      calibration: () => calibration,
      game: () => game,
      hud: () => (game ? game.getHud() : null),
      viewRig: () => viewRig,
    };
  }
  if (demo) {
    initDemo();
    const gameId = params.get('game');
    if (gameId) setTimeout(() => startGame(gameId, {}), 600);
  }
  net.connect();
  requestAnimationFrame(frame);

  $('#pip-calibrate-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    recalibrateReach();
  });
  $('#pip-size-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const pip = $('#tv-tracking-pip');
    if (pip) {
      if (pip.classList.contains('pip-large')) {
        pip.classList.remove('pip-large');
      } else {
        pip.classList.add('pip-large');
      }
    }
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

  $('#btn-fullscreen')?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => toast('Fullscreen was blocked'));
  });
  $('#btn-sound')?.addEventListener('click', async () => {
    const ok = await audio.unlock();
    audio.setMuted(!ok ? true : false);
    toast(ok ? 'Sound on' : 'Sound unavailable');
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
