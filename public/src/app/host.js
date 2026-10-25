/**
 * Laptop host / controller.
 *
 * Owns the camera, MediaPipe pose tracking, TV auto-calibration and the game
 * launcher. It sends compact pose packets to the TV display at ~20 Hz and
 * listens for live game state so the laptop shows the same scoreboard.
 */
import { NetClient } from '../net/client.js';
import {
  startCamera as openCamera,
  stopCamera,
  listCameras,
  cameraSupported,
} from '../vision/camera.js';
import { ScreenDetector } from '../vision/calibration.js';
import { PoseSimulator } from '../vision/simulator.js';
import { MotionTracker } from '../vision/motion.js';
import { PoseEngine } from './poseEngine.js';
import { packPose, CONNECTIONS } from '../shared/pose.js';
import { clamp, formatTime } from '../shared/math.js';
import { GAME_CATALOG, GAME_BY_ID } from '../games/catalog.js';
import {
  defaultCalibration,
  makeCalibration,
  calibrationFromMessage,
  calibrationToMessage,
  estimatePlayerDistance,
  estimateCameraFovFromDistance,
  computeViewRig,
} from '../shared/stage.js';
import { orderQuad, quadArea } from '../shared/homography.js';

const $ = (sel, root = document) => root.querySelector(sel);
const params = new URLSearchParams(location.search);
const STORE_ROOM = 'arfg.room.v1';
const STORE_CAL = 'arfg.calibration.v1';
const STORE_TV = 'arfg.tv.v1';
const STORE_DISTANCE = 'arfg.distance.v1';

function cleanRoom(value) {
  return String(value || 'HOME').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'HOME';
}

let room = cleanRoom(params.get('room') || localStorage.getItem(STORE_ROOM) || 'HOME');

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */
function loadCalibration() {
  try {
    const raw = localStorage.getItem(STORE_CAL);
    if (raw) {
      const cal = calibrationFromMessage(JSON.parse(raw));
      if (cal) return cal;
    }
  } catch {
    /* corrupt storage: fall through to defaults */
  }
  return defaultCalibration({ tvInches: Number(localStorage.getItem(STORE_TV)) || 55 });
}

function saveCalibration(cal) {
  try {
    localStorage.setItem(STORE_CAL, JSON.stringify(calibrationToMessage(cal)));
    localStorage.setItem(STORE_TV, String(cal.tvInches || 55));
  } catch {
    /* storage may be disabled */
  }
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */
const state = {
  selectedGame: GAME_BY_ID[params.get('game')] ? params.get('game') : 'boxing',
  calibration: loadCalibration(),
  cameraOn: false,
  demoMode: false,
  tvConnected: false,
  gameRunning: false,
  displayState: null,
  manualMode: false,
  manualPoints: [],
  aspect: 16 / 9,
  names: new Map(),
  motion: new Map(),
  joined: new Map(),
  joinSeen: new Map(),
  view: null,
};

const preview = $('#preview');
const video = $('#video');
const overlay = $('#overlay');
const ctx = overlay.getContext('2d');

let poseEngine = null;
let simulator = null;
let detectionTracks = [];
let lastDetectAt = 0;
let lastSendAt = 0;
let lastUiAt = 0;
let lastFpsAt = 0;
let lastFpsCount = 0;
let demoTick = 0;
let lastHostStatusAt = 0;
let cameraStarting = false;

/* ------------------------------------------------------------------ */
/* Networking                                                          */
/* ------------------------------------------------------------------ */
const net = new NetClient({ room, role: 'host', name: 'Laptop' });

net.addEventListener('status', (ev) => {
  const on = ev.detail.connected;
  $('#net-dot').className = 'dot ' + (on ? 'ok' : 'bad');
  $('#net-label').textContent = on ? 'LIVE' : 'RECONNECTING';
  if (!on) {
    state.tvConnected = false;
    setTvLabel(false);
  }
});

net.addEventListener('msg', (ev) => {
  const msg = ev.detail;
  switch (msg.t) {
    case 'welcome': {
      room = msg.room || room;
      $('#room-input').value = room;
      if (msg.calibration) {
        state.calibration = calibrationFromMessage(msg.calibration);
        syncCalibrationControls();
        updateCalUi();
      } else {
        // First controller in the room: publish the saved setup.
        net.send({ t: 'calibration', calibration: calibrationToMessage(state.calibration) });
      }
      updatePeers(msg.peers || []);
      sendHostStatus();
      if (msg.state) handleState(msg.state);
      if (msg.game?.action === 'start' && msg.game.gameId) {
        selectGame(msg.game.gameId, { updateDemo: false });
        state.gameRunning = true;
        updateLaunchUi();
      }
      break;
    }
    case 'peers':
      updatePeers(msg.peers || []);
      sendHostStatus();
      break;
    case 'state':
      handleState(msg.state);
      break;
    case 'calibration':
      if (msg.calibration) {
        state.calibration = calibrationFromMessage(msg.calibration);
        syncCalibrationControls();
        updateCalUi();
      }
      break;
    case 'event':
      if (msg.name === 'player:join') toast(`${msg.payload?.name || 'Player'} joined`);
      break;
    default:
      break;
  }
});

function updatePeers(peers) {
  const displays = peers.filter((p) => p.role === 'display').length;
  const trackers = peers.filter((p) => p.role === 'tracker').length;
  state.tvConnected = displays > 0;
  setTvLabel(displays > 0, displays, trackers);
}

/** Tell the TV whether this controller has a live camera. */
function sendHostStatus() {
  if (!net.connected) return;
  net.send({
    t: 'event',
    name: 'host:status',
    payload: {
      camera: !!state.cameraOn,
      demo: !!state.demoMode,
      joined: currentPlayers().filter((p) => p.joined).length,
    },
  });
}

function setTvLabel(connected, displays = 0, trackers = 0) {
  const pill = $('#tv-pill');
  const label = $('#tv-label');
  if (!pill || !label) return;
  if (!connected) {
    pill.className = 'net-pill bad';
    label.textContent = 'NO TV';
    return;
  }
  pill.className = 'net-pill ok';
  const bits = [`TV CONNECTED${displays > 1 ? ` ×${displays}` : ''}`];
  if (trackers) bits.push(`${trackers} PHONE${trackers > 1 ? 'S' : ''}`);
  label.textContent = bits.join(' · ');
}

/* ------------------------------------------------------------------ */
/* Calibration                                                         */
/* ------------------------------------------------------------------ */
function syncCalibrationControls() {
  const mirror = state.calibration.mirror !== false;
  $('#mirror-toggle').checked = mirror;
  const tv = String(state.calibration.tvInches || 55);
  if ([...$('#tv-size').options].some((o) => o.value === tv)) $('#tv-size').value = tv;
  applyMirrorCss();
}

function applyMirrorCss() {
  const mirror = $('#mirror-toggle').checked;
  const transform = mirror ? 'scaleX(-1)' : 'none';
  video.style.transform = transform;
  overlay.style.transform = transform;
}

function setCalStatus(text, kind = '') {
  const node = $('#cal-status');
  if (!node) return;
  node.textContent = text;
  node.className = 'hint' + (kind ? ' ' + kind : '');
}

function updateCalUi() {
  const cal = state.calibration;
  if (cal.synthetic) {
    setCalStatus('Quick setup active. Auto-calibrate for a true AR perspective.', 'warn');
  } else {
    const conf = Math.round((cal.confidence ?? 1) * 100);
    setCalStatus(
      `TV calibrated · game ${cal.fov.toFixed(0)}° · camera ${cal.camFov.toFixed(0)}° · ${cal.tvInches}" · ${conf}% match`,
      'ok'
    );
  }
}

function sendCalibration() {
  net.send({ t: 'calibration', calibration: calibrationToMessage(state.calibration) });
}

function applyQuad(points, opts = {}) {
  const cal = makeCalibration(points, {
    camFov: state.calibration?.camFov || 55,
    tvInches: Number($('#tv-size').value) || 55,
    mirror: $('#mirror-toggle').checked,
    synthetic: !!opts.synthetic,
    confidence: opts.confidence,
  });
  state.calibration = cal;
  saveCalibration(cal);
  sendCalibration();
  updateCalUi();
  return cal;
}

function resetCalibration() {
  state.calibration = defaultCalibration({
    mirror: $('#mirror-toggle').checked,
    tvInches: Number($('#tv-size').value) || 55,
  });
  saveCalibration(state.calibration);
  sendCalibration();
  updateCalUi();
  toast('Calibration reset to quick setup');
}

async function autoCalibrate() {
  if (!state.cameraOn) return toast('Start the camera first');
  if (state.demoMode) return toast('Turn off demo players first');
  if (!state.tvConnected) return toast('Open display.html on the TV and join this room first');

  const btn = $('#btn-auto-cal');
  btn.disabled = true;
  cancelManual();
  setCalStatus('Flashing the TV white — keep the room dim…', 'busy');

  net.send({ t: 'flash', duration: 2600 });
  await sleep(360);

  const detector = new ScreenDetector();
  const best = await detector.capture(video, {
    duration: 1800,
    onSample: (detection, elapsed) => {
      const pct = Math.round((elapsed / 1800) * 100);
      setCalStatus(
        detection
          ? `TV found — refining corners… ${pct}%`
          : `Scanning for the TV flash… ${pct}%`,
        'busy'
      );
    },
  });

  btn.disabled = false;

  if (!best || (best.confidence ?? 0) < 0.08) {
    setCalStatus('TV not found. Dim the room, keep the TV in frame, or pick the corners manually.', 'bad');
    toast('Could not detect the TV — try manual corners');
    return;
  }

  applyQuad(best.quad, { synthetic: false, confidence: best.confidence });
  toast(`TV calibrated · ${Math.round(best.confidence * 100)}% match`);
}

/**
 * Use a player standing at a known distance to solve the camera's vertical
 * FOV. This is the trigonometry step behind the distance readout and the
 * auto view rig: a correct FOV makes the distance estimate trustworthy.
 */
function calibrateDistanceFov() {
  if (!state.cameraOn) return toast('Start the camera first');
  if (state.demoMode) return toast('Turn off demo players first');
  const list = currentPlayers().filter((p) => p.joined && p.lm);
  if (!list.length) return toast('Stand fully in view and wave to join first');
  const known = Number($('#known-distance')?.value) || 3;

  let best = null;
  for (const p of list) {
    const m = estimatePlayerDistance(p.lm, state.aspect || 16 / 9, state.calibration);
    if (!m.heightNorm) continue;
    if (!best || m.heightNorm > best.m.heightNorm) best = { p, m };
  }
  if (!best) return toast('Could not read your body — stand fully in frame');

  const fov = estimateCameraFovFromDistance(best.p.lm, state.aspect || 16 / 9, known);
  if (!fov) return toast('Could not estimate camera FOV — stand fully in frame');

  state.calibration = makeCalibration(state.calibration.quad, {
    camFov: fov,
    tvInches: state.calibration.tvInches,
    mirror: state.calibration.mirror,
    synthetic: state.calibration.synthetic,
    confidence: state.calibration.confidence,
  });
  saveCalibration(state.calibration);
  sendCalibration();
  updateCalUi();
  try {
    localStorage.setItem(STORE_DISTANCE, String(known));
  } catch {
    /* storage may be disabled */
  }
  toast(`Camera FOV set to ${fov.toFixed(1)}° from ${known} m`);
}

function startManual() {
  if (!state.cameraOn) return toast('Start the camera first');
  if (state.demoMode) return toast('Turn off demo players first');
  state.manualMode = true;
  state.manualPoints = [];
  preview.classList.add('calibrating');
  $('#cal-overlay').hidden = false;
  $('#cal-overlay-text').textContent = 'Click corner 1 of 4 · top-left of the TV';
  setCalStatus('Click the four corners of the TV in order', 'busy');
  drawOverlay(currentPlayers());
}

function cancelManual() {
  if (!state.manualMode) return;
  state.manualMode = false;
  state.manualPoints = [];
  preview.classList.remove('calibrating');
  $('#cal-overlay').hidden = true;
  if (state.cameraOn) setCalStatus('Tracking ready');
  drawOverlay(currentPlayers());
}

function finishManualCalibration() {
  const quad = orderQuad(state.manualPoints.map((p) => ({ ...p })));
  const area = quadArea(quad);
  state.manualMode = false;
  state.manualPoints = [];
  preview.classList.remove('calibrating');
  $('#cal-overlay').hidden = true;

  if (area < 0.012) {
    setCalStatus('Those corners are too close together. Try again.', 'bad');
    toast('Calibration area too small — click the TV corners');
    drawOverlay(currentPlayers());
    return;
  }

  applyQuad(quad, { synthetic: false, confidence: 1 });
  toast('TV calibrated from four corners');
  drawOverlay(currentPlayers());
}

function onPreviewClick(e) {
  if (!state.manualMode) return;
  if (!state.cameraOn) return toast('Start the camera first');
  const rect = preview.getBoundingClientRect();
  const dx = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  const dy = clamp((e.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
  const rawX = $('#mirror-toggle').checked ? 1 - dx : dx;
  state.manualPoints.push({ x: rawX, y: dy });
  drawOverlay(currentPlayers());

  const n = state.manualPoints.length;
  if (n < 4) {
    const names = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
    $('#cal-overlay-text').textContent = `Click corner ${n + 1} of 4 · ${names[n]}`;
    setCalStatus(`Corner ${n} of 4 set`, 'busy');
  } else {
    finishManualCalibration();
  }
}

/* ------------------------------------------------------------------ */
/* Camera + pose engine                                                */
/* ------------------------------------------------------------------ */
function setCamStatus(text, kind = '') {
  const node = $('#cam-status');
  if (!node) return;
  node.textContent = text;
  node.className = 'cam-status' + (kind ? ' ' + kind : '');
}

async function refreshCameras() {
  const select = $('#camera-select');
  if (!select) return;
  const current = select.value;
  let cameras = [];
  try {
    cameras = await listCameras();
  } catch {
    cameras = [];
  }
  select.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = 'Default camera';
  select.append(auto);
  cameras.forEach((cam, i) => {
    const option = document.createElement('option');
    option.value = cam.deviceId;
    option.textContent = cam.label || `Camera ${i + 1}`;
    select.append(option);
  });
  if (current && [...select.options].some((o) => o.value === current)) select.value = current;
}

async function startCameraFlow() {
  if (cameraStarting) return;
  cameraStarting = true;
  if (!cameraSupported()) {
    cameraStarting = false;
    toast('Camera access needs Chrome/Edge on http://localhost');
    setCamStatus('Camera not supported in this browser', 'bad');
    return;
  }
  const btn = $('#btn-camera');
  const cta = $('#btn-camera-cta');
  btn.disabled = true;
  if (cta) cta.disabled = true;
  try {
    setCamStatus('Requesting camera…', 'busy');
    await openCamera(video, {
      deviceId: $('#camera-select').value || null,
      width: 1280,
      height: 720,
    });

    state.cameraOn = true;
    sendHostStatus();
    if (state.demoMode) setDemo(false, { keepCamera: true });
    preview.classList.add('live');
    $('#preview-empty').hidden = true;

    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    state.aspect = vw / vh;
    preview.style.aspectRatio = `${vw} / ${vh}`;
    resizeOverlay();
    applyMirrorCss();
    await refreshCameras();

    setCamStatus('Loading pose model…', 'busy');
    if (!poseEngine) poseEngine = new PoseEngine({ maxPlayers: 4, onStatus: (s) => setCamStatus(s) });
    await poseEngine.load();
    setCamStatus('Tracking ready', 'ok');
    btn.textContent = 'Stop camera';
    toast('Camera ready — stand in front of the TV');
  } catch (err) {
    state.cameraOn = false;
    stopCamera(video);
    setCamStatus(err?.message || 'Camera failed', 'bad');
    toast(err?.message || 'Camera failed');
    sendHostStatus();
  } finally {
    cameraStarting = false;
    btn.disabled = false;
    if (cta) cta.disabled = false;
  }
}

function stopCameraFlow() {
  stopCamera(video);
  state.cameraOn = false;
  detectionTracks = [];
  state.motion.clear();
  state.joined.clear();
  state.joinSeen.clear();
  preview.classList.remove('live');
  $('#preview-empty').hidden = state.demoMode;
  $('#btn-camera').textContent = 'Start camera';
  setCamStatus(state.demoMode ? 'Simulated players' : 'Camera off', state.demoMode ? 'ok' : '');
  drawOverlay(currentPlayers());
  renderPlayers([]);
  sendHostStatus();
}

/* ------------------------------------------------------------------ */
/* Demo / simulator                                                    */
/* ------------------------------------------------------------------ */
function demoCount() {
  return state.selectedGame === 'boxing' || state.selectedGame === 'tennis' ? 2 : 4;
}

function setDemo(on, opts = {}) {
  state.demoMode = !!on;
  if (on) {
    if (state.cameraOn && !opts.keepCamera) stopCameraFlow();
    if (!simulator) simulator = new PoseSimulator({ players: demoCount(), scenario: state.selectedGame });
    simulator.setScenario(state.selectedGame || 'menu');
    simulator.setPlayerCount(demoCount());
    state.motion.clear();
    state.joined.clear();
    state.joinSeen.clear();
    detectionTracks = [];
    $('#preview-empty').hidden = true;
    setCamStatus('Simulated players', 'ok');
    $('#btn-camera').textContent = 'Start camera';
  } else {
    simulator = null;
    state.motion.clear();
    state.joined.clear();
    state.joinSeen.clear();
    detectionTracks = [];
    $('#preview-empty').hidden = state.cameraOn;
    setCamStatus(state.cameraOn ? 'Tracking ready' : 'Camera off', state.cameraOn ? 'ok' : '');
    drawOverlay([]);
    renderPlayers([]);
  }
  updateDemoButton();
  sendHostStatus();
}

function updateDemoButton() {
  const btn = $('#btn-demo');
  if (!btn) return;
  btn.textContent = state.demoMode ? 'Stop demo' : 'Demo players';
  btn.classList.toggle('active', state.demoMode);
}

/* ------------------------------------------------------------------ */
/* Players + motion                                                    */
/* ------------------------------------------------------------------ */
function sourcePrefix() {
  return state.demoMode ? 'demo' : 'cam';
}

function playerKey(id) {
  return `${sourcePrefix()}:${id}`;
}

function motionFor(key) {
  let tracker = state.motion.get(key);
  if (!tracker) {
    tracker = new MotionTracker();
    state.motion.set(key, tracker);
  }
  return tracker;
}

function currentPlayers() {
  if (state.demoMode && simulator) {
    return simulator.players.map((p) => {
      const key = playerKey(p.id);
      return {
        key,
        id: p.id,
        name: state.names.get(key) || p.name,
        color: p.color,
        lm: p.lm,
        joined: true,
      };
    });
  }
  return detectionTracks.map((t) => {
    const key = playerKey(t.id);
    return {
      key,
      id: t.id,
      name: state.names.get(key) || t.name,
      color: t.color,
      lm: t.lm,
      joined: !!state.joined.get(key),
    };
  });
}

/**
 * A player joins when their tracker reports a wave. Demo players are always
 * joined so camera-free testing goes straight into the game.
 */
function checkJoin(key, name) {
  if (!state.joined.get(key)) {
    state.joined.set(key, true);
    sendHostStatus();
  }
  const tracker = state.motion.get(key);
  if (!tracker?.waveAt) return;
  const seen = state.joinSeen.get(key) || 0;
  if (tracker.waveAt <= seen) return;
  state.joinSeen.set(key, tracker.waveAt);
  toast(`${name || 'Player'} wave detected 👋`);
}

function sendPoses() {
  const list = currentPlayers();
  if (!list.length) return;
  net.send({
    t: 'poses',
    ts: performance.now(),
    aspect: state.demoMode ? 16 / 9 : state.aspect || 16 / 9,
    players: list.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      lm: packPose(p.lm),
      joined: p.joined === true,
    })),
  });
}

function motionLabel(s) {
  const now = performance.now();
  if (now - (s.waveAt || 0) < 520) return 'WAVE';
  if (now - s.punchL < 240 || now - s.punchR < 240) return 'PUNCH';
  if (s.block > 0.6) return 'BLOCK';
  if (s.armsUp > 0.55) return 'ARMS UP';
  if (s.jump > 0.22) return 'JUMP';
  if (s.duck > 0.45) return 'DUCK';
  if (s.swing > 0.45) return 'SWING';
  if (s.rowPower > 0.35) return 'ROW';
  if (s.run > 0.35) return 'RUN';
  return 'READY';
}

function motionKind(s) {
  const now = performance.now();
  if (now - (s.waveAt || 0) < 520) return 'wave';
  if (now - s.punchL < 240 || now - s.punchR < 240) return 'punch';
  if (s.block > 0.6) return 'block';
  if (s.armsUp > 0.55) return 'arms';
  if (s.jump > 0.22) return 'jump';
  if (s.duck > 0.45) return 'duck';
  if (s.swing > 0.45) return 'swing';
  if (s.rowPower > 0.35) return 'row';
  if (s.run > 0.35) return 'run';
  return 'ready';
}

function activity(s) {
  return clamp(Math.max(s.run, s.armsUp, s.rowPower, s.swing, s.block, s.jump, s.duck), 0, 1);
}

function renderPlayers(players) {
  const wrap = $('#player-list');
  if (!wrap) return;
  updateViewStatus(players);
  updateTrackingHud(players);

  if (!players.length) {
    if (wrap.dataset.empty !== '1') {
      wrap.innerHTML = '<p class="hint">No players yet. Start the camera, step into view and wave.</p>';
      wrap.dataset.empty = '1';
    }
    $('#player-count').textContent = '0 joined';
    return;
  }

  if (wrap.dataset.empty === '1') {
    wrap.innerHTML = '';
    delete wrap.dataset.empty;
  }
  // The initial markup ships with a hint paragraph; clear it once players appear.
  wrap.querySelector('.hint')?.remove();

  const seen = new Set();
  for (const p of players) {
    seen.add(p.key);
    let row = [...wrap.querySelectorAll('.player-row')].find((r) => r.dataset.key === p.key);
    if (!row) {
      row = document.createElement('div');
      row.className = 'player-row';
      row.dataset.key = p.key;
      row.style.setProperty('--c', p.color || '#22d3ee');

      const dot = document.createElement('span');
      dot.className = 'player-dot';

      const main = document.createElement('div');
      main.className = 'player-main';

      const top = document.createElement('div');
      top.className = 'player-top';

      const input = document.createElement('input');
      input.className = 'player-name';
      input.maxLength = 16;
      input.value = p.name;
      input.setAttribute('aria-label', 'Player name');
      input.addEventListener('change', () => {
        const name = input.value.trim() || `Player ${p.id}`;
        state.names.set(p.key, name);
        input.value = name;
      });

      const tag = document.createElement('span');
      tag.className = 'player-tag';
      tag.textContent = 'READY';

      const bar = document.createElement('div');
      bar.className = 'player-bar';
      const fill = document.createElement('i');
      bar.append(fill);

      const sub = document.createElement('div');
      sub.className = 'player-sub';

      top.append(input, tag);
      main.append(top, bar, sub);
      row.append(dot, main);
      wrap.append(row);
    }

    row.style.setProperty('--c', p.color || '#22d3ee');
    const input = row.querySelector('.player-name');
    if (document.activeElement !== input && input.value !== p.name) input.value = p.name;

    row.classList.toggle('joined', !!p.joined);
    const tracker = state.motion.get(p.key);
    const tag = row.querySelector('.player-tag');
    const fill = row.querySelector('.player-bar i');
    const sub = row.querySelector('.player-sub');
    if (!p.joined) {
      tag.textContent = 'WAVE TO JOIN';
      tag.dataset.motion = 'join';
      if (fill) fill.style.width = '0%';
      if (sub) sub.textContent = 'Wave at the camera to join';
    } else {
      if (tracker) {
        const s = tracker.state;
        tag.textContent = motionLabel(s);
        tag.dataset.motion = motionKind(s);
        if (fill) fill.style.width = `${Math.round(activity(s) * 100)}%`;
      }
      if (sub) {
        const rig = estimatePlayerDistance(p.lm, state.aspect || 16 / 9, state.calibration);
        sub.textContent = Number.isFinite(rig.distance)
          ? `${rig.distance.toFixed(1)} m from camera · ${Math.round(rig.angleDeg)}°`
          : 'Joined';
      }
    }
  }

  for (const row of [...wrap.querySelectorAll('.player-row')]) {
    if (!seen.has(row.dataset.key)) row.remove();
  }
  const joined = players.filter((p) => p.joined).length;
  $('#player-count').textContent = `${joined} joined · ${players.length} tracked`;
}

function updateViewStatus(players) {
  const node = $('#view-status');
  if (!node) return;
  const rigs = players
    .filter((p) => p.joined && p.lm)
    .map((p) => {
      const m = estimatePlayerDistance(p.lm, state.aspect || 16 / 9, state.calibration);
      return { distance: m.distance, angle: m.angle };
    });
  const view = computeViewRig(state.calibration, rigs, state.aspect || 16 / 9);
  state.view = view;
  if (!view.count) {
    node.textContent = 'VIEW AUTO · waiting for players';
    node.className = 'view-status';
    return;
  }
  node.textContent = `VIEW AUTO · ${view.avgDistance.toFixed(1)} m · ${Math.round(view.fov)}°`;
  node.className = 'view-status ok';
}

/** Are the wrists above the shoulder line? Used for the Kinect-style HUD. */
function handState(lm) {
  if (!lm || lm.length < 17) return { L: false, R: false };
  const sy = (lm[11]?.y + lm[12]?.y) / 2;
  if (!Number.isFinite(sy)) return { L: false, R: false };
  return {
    L: Number.isFinite(lm[15]?.y) && lm[15].y < sy - 0.03,
    R: Number.isFinite(lm[16]?.y) && lm[16].y < sy - 0.03,
  };
}

/**
 * Live tracking feedback for the controller preview. This is the "Kinect
 * sensor" readout: how many bodies are tracked, which hand is up, and how
 * close the wave gesture is to registering.
 */
function updateTrackingHud(players) {
  const status = $('#tracking-status');
  const hand = $('#hand-status');
  const fill = $('#wave-fill');
  const hint = $('#wave-hint');
  if (!status) return;

  const joined = players.filter((p) => p.joined).length;
  let mode = 'off';
  let label = 'CAMERA OFF';
  let text = 'Start the camera to track hands';
  let progress = 0;

  if (state.demoMode) {
    mode = 'live';
    label = 'DEMO PLAYERS';
    text = `${players.length} simulated players`;
  } else if (!state.cameraOn) {
    mode = 'off';
    label = 'CAMERA OFF';
    text = 'Click Start camera to allow access';
  } else {
    mode = 'live';
    label = players.length ? `${players.length} TRACKED` : 'TRACKING READY';
    text = players.length
      ? joined
        ? `${joined} joined · wave to add more`
        : 'Wave at the camera to join'
      : 'Step into view';
    let raised = { L: false, R: false };
    let recentWave = false;
    for (const p of players) {
      const tracker = state.motion.get(p.key);
      if (tracker) {
        progress = Math.max(progress, tracker.state.waveProgress || 0);
        if (performance.now() - (tracker.state.waveAt || 0) < 1200) recentWave = true;
      }
      const h = handState(p.lm);
      raised.L = raised.L || h.L;
      raised.R = raised.R || h.R;
    }
    if (recentWave) {
      mode = 'wave';
      label = 'WAVE DETECTED';
      text = '👋 Joined — keep playing';
      progress = 1;
    } else if (raised.L || raised.R) {
      mode = 'hand';
      label = 'HAND TRACKED';
      text = `${raised.L && raised.R ? 'Both hands' : raised.L ? 'Left hand' : 'Right hand'} raised — sweep side to side`;
      progress = Math.max(progress, 0.15);
    }
  }

  status.textContent = label;
  status.className = `tracking-status ${mode}`;
  if (hand) hand.textContent = text;
  if (fill) fill.style.width = `${Math.round(clamp(progress, 0, 1) * 100)}%`;
  if (hint) hint.hidden = !(state.cameraOn && !state.demoMode && joined === 0);
}

/* ------------------------------------------------------------------ */
/* Overlay preview                                                     */
/* ------------------------------------------------------------------ */
function resizeOverlay() {
  const rect = preview.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (overlay.width !== w || overlay.height !== h) {
    overlay.width = w;
    overlay.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawOverlay(players) {
  const rect = preview.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  const now = performance.now();
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const p of players) {
    if (!p.lm) continue;
    const color = p.color || '#22d3ee';
    const tracker = state.motion.get(p.key);
    const motionState = tracker?.state;
    const raised = handState(p.lm);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.92;
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.max(6, w / 140);
    ctx.lineWidth = Math.max(2.5, w / 360);
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      const A = p.lm[a];
      const B = p.lm[b];
      if (!A || !B) continue;
      ctx.moveTo(A.x * w, A.y * h);
      ctx.lineTo(B.x * w, B.y * h);
    }
    ctx.stroke();

    for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const P = p.lm[i];
      if (!P) continue;
      ctx.beginPath();
      ctx.arc(P.x * w, P.y * h, Math.max(3, w / 220), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Hand markers: a ring that lights up when the hand is above the shoulder,
    // plus a pulse and "WAVE!" label when the gesture registers.
    for (const i of [15, 16]) {
      const W = p.lm[i];
      if (!W) continue;
      const isRaised = i === 15 ? raised.L : raised.R;
      const isWave = !!motionState && now - (motionState.waveAt || 0) < 1200;
      const x = W.x * w;
      const y = W.y * h;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, isRaised ? Math.max(7, w / 110) : Math.max(4, w / 200), 0, Math.PI * 2);
      ctx.strokeStyle = isWave ? '#67e8f9' : isRaised ? '#fbbf24' : color;
      ctx.lineWidth = isRaised ? 3 : 1.5;
      ctx.stroke();
      if (isRaised) {
        const pulse = 1 + Math.sin(now / 160) * 0.25;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(13, w / 65) * pulse, 0, Math.PI * 2);
        ctx.strokeStyle = isWave ? 'rgba(34, 211, 238, 0.6)' : 'rgba(251, 191, 36, 0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.translate(x, y - Math.max(18, w / 60));
        ctx.scale($('#mirror-toggle').checked ? -1 : 1, 1);
        ctx.font = `800 ${Math.max(10, Math.round(w / 90))}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isWave ? '#67e8f9' : '#fde68a';
        ctx.fillText(isWave ? 'WAVE!' : i === 15 ? 'L' : 'R', 0, 0);
      }
      ctx.restore();
    }

    if (!p.joined) {
      const nose = p.lm[0];
      if (nose) {
        ctx.save();
        ctx.translate(nose.x * w, Math.max(16, nose.y * h - 20));
        // The preview/overlay is CSS-mirrored when mirror controls are on.
        ctx.scale($('#mirror-toggle').checked ? -1 : 1, 1);
        ctx.font = `700 ${Math.max(11, Math.round(w / 80))}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText('WAVE TO JOIN', 0, 0);
        ctx.restore();
      }
    }

    const rig = estimatePlayerDistance(p.lm, state.aspect || 16 / 9, state.calibration);
    if (Number.isFinite(rig.distance)) {
      let warnText = null;
      if (rig.distance < 1.4) warnText = '← STEP BACK →';
      else if (rig.distance > 4.6) warnText = '→ STEP CLOSER ←';
      if (warnText) {
        const hip = p.lm[23] && p.lm[24] ? { x: (p.lm[23].x + p.lm[24].x) / 2, y: (p.lm[23].y + p.lm[24].y) / 2 } : p.lm[0];
        if (hip) {
          ctx.save();
          ctx.translate(hip.x * w, Math.max(28, hip.y * h - 35));
          ctx.scale($('#mirror-toggle').checked ? -1 : 1, 1);
          ctx.font = `bold ${Math.max(12, Math.round(w / 70))}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
          const textW = ctx.measureText(warnText).width + 16;
          ctx.beginPath();
          ctx.roundRect(-textW / 2, -12, textW, 24, 6);
          ctx.fill();
          ctx.fillStyle = '#f87171';
          ctx.fillText(warnText, 0, 0);
          ctx.restore();
        }
      }
    }
  }

  ctx.globalAlpha = 1;

  if (state.manualMode && state.manualPoints.length) {
    const pts = state.manualPoints;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x * w, p.y * h);
      else ctx.lineTo(p.x * w, p.y * h);
    });
    if (pts.length === 4) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    for (const p of pts) {
      ctx.fillStyle = '#0b1220';
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, Math.max(8, w / 80), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, Math.max(2.5, w / 300), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Live game state                                                     */
/* ------------------------------------------------------------------ */
function handleState(st) {
  state.displayState = st || null;
  const running = !!st?.gameId;
  if (running !== state.gameRunning) {
    state.gameRunning = running;
    poseEngine?.tracker?.setGameMode?.(running);
    updateLaunchUi();
  }
  const meta = st?.gameId ? GAME_BY_ID[st.gameId] : null;
  $('#display-state').textContent = running
    ? `${meta?.title || st.gameId} · ${String(st.phase || '').toUpperCase()}`
    : 'TV idle';
  $('#hud-phase').textContent = running ? String(st.phase || 'live').toUpperCase() : 'IDLE';
  $('#hud-timer').textContent = st?.timer != null ? formatTime(st.timer) : '--';
  $('#hud-message').textContent = st?.message || (running ? 'Live' : 'Waiting for the TV…');
  $('#hud-score').textContent = st?.score || '';
  renderTvScore(st?.players || []);
}

function renderTvScore(players) {
  const wrap = $('#tv-score');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const p of players) {
    const row = document.createElement('div');
    row.className = 'tv-score-row';
    row.style.setProperty('--c', p.color || '#22d3ee');

    const name = document.createElement('span');
    name.className = 'tv-name';
    name.textContent = p.name || 'Player';

    const val = document.createElement('span');
    val.className = 'tv-val';
    val.textContent = Number(p.max) > 0
      ? `${Math.round(Number(p.value) || 0)}${p.label ? ' ' + p.label : ''}`
      : p.detail || '';

    row.append(name, val);
    wrap.append(row);
  }
}

function updateLaunchUi() {
  const start = $('#btn-start');
  if (!start) return;
  start.disabled = !state.selectedGame;
  start.textContent = state.gameRunning ? 'Restart game' : 'Start game';
  $('#display-state').textContent = state.gameRunning
    ? $('#display-state').textContent
    : 'TV idle';
}

/* ------------------------------------------------------------------ */
/* Game catalog                                                        */
/* ------------------------------------------------------------------ */
function renderGames() {
  const grid = $('#game-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const game of GAME_CATALOG) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'game-card';
    card.dataset.id = game.id;
    card.style.setProperty('--accent', game.accent);

    const icon = document.createElement('span');
    icon.className = 'game-icon';
    icon.textContent = game.icon;

    const name = document.createElement('span');
    name.className = 'game-name';
    name.textContent = game.title;

    const players = document.createElement('span');
    players.className = 'game-players';
    players.textContent = `${game.players} players`;

    const tag = document.createElement('span');
    tag.className = 'game-tag';
    tag.textContent = game.tagline;

    card.append(icon, name, players, tag);
    card.addEventListener('click', () => selectGame(game.id));
    grid.append(card);
  }
  selectGame(state.selectedGame, { updateDemo: false });
}

function selectGame(id, { updateDemo = true } = {}) {
  const meta = GAME_BY_ID[id];
  if (!meta) return;
  state.selectedGame = id;
  for (const card of document.querySelectorAll('.game-card')) {
    card.classList.toggle('selected', card.dataset.id === id);
  }
  $('#how-title').textContent = `${meta.icon} ${meta.title}`;
  $('#how-text').textContent = meta.how;
  if (updateDemo && state.demoMode && simulator) {
    simulator.setScenario(id);
    simulator.setPlayerCount(demoCount());
  }
  updateLaunchUi();
}

function startSelectedGame() {
  if (!state.selectedGame) return;
  const meta = GAME_BY_ID[state.selectedGame];
  const joined = currentPlayers().filter((p) => p.joined).length;
  net.send({ t: 'command', action: 'start', gameId: state.selectedGame, options: {} });
  state.gameRunning = true;
  poseEngine?.tracker?.setGameMode?.(true);
  updateLaunchUi();
  if (state.demoMode && simulator) {
    simulator.setScenario(state.selectedGame);
    simulator.setPlayerCount(demoCount());
  }
  toast(
    !state.demoMode && !joined
      ? `${meta.icon} ${meta.title} started — wave at the camera to join`
      : `${meta.icon} ${meta.title} sent to the TV`
  );
}

function stopGame() {
  net.send({ t: 'command', action: 'stop' });
  state.gameRunning = false;
  poseEngine?.tracker?.setGameMode?.(false);
  updateLaunchUi();
  toast('Back to the attract screen');
}

/* ------------------------------------------------------------------ */
/* Loop                                                                */
/* ------------------------------------------------------------------ */
let lastFrame = performance.now();

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.06, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;

  if (state.cameraOn && poseEngine?.ready && !state.demoMode) {
    if (now - lastDetectAt > 33 && video.readyState >= 2) {
      lastDetectAt = now;
      detectionTracks = poseEngine.detect(video, now, state.aspect || 16 / 9);
      for (const track of detectionTracks) {
        const key = playerKey(track.id);
        motionFor(key).update(track.lm, state.aspect || 16 / 9, now);
        checkJoin(key, state.names.get(key) || track.name);
      }
      drawOverlay(currentPlayers());
      lastFpsCount++;
    }
  } else if (state.demoMode && simulator) {
    demoTick += dt;
    if (demoTick >= 1 / 30) {
      const step = Math.min(demoTick, 0.1);
      demoTick = 0;
      const list = simulator.update(step);
      for (const p of list) {
        const key = playerKey(p.id);
        motionFor(key).update(p.lm, 16 / 9, now);
        checkJoin(key, p.name);
      }
      drawOverlay(currentPlayers());
      lastFpsCount++;
    }
  } else if (state.manualMode) {
    drawOverlay([]);
  }

  if (now - lastSendAt > 50) {
    lastSendAt = now;
    sendPoses();
  }

  if (now - lastHostStatusAt > 3000) {
    lastHostStatusAt = now;
    sendHostStatus();
  }

  if (now - lastUiAt > 120) {
    lastUiAt = now;
    renderPlayers(currentPlayers());
  }

  if (now - lastFpsAt > 500) {
    const elapsed = now - lastFpsAt;
    const active = state.cameraOn || state.demoMode;
    const fps = active ? Math.round((lastFpsCount * 1000) / Math.max(1, elapsed)) : 0;
    lastFpsAt = now;
    lastFpsCount = 0;
    const list = currentPlayers();
    $('#fps-badge').textContent = `${fps} FPS`;
    $('#pose-badge').textContent = `${list.length} PLAYER${list.length === 1 ? '' : 'S'}`;
  }
}

/* ------------------------------------------------------------------ */
/* UI helpers                                                          */
/* ------------------------------------------------------------------ */
let toastTimer = 0;
function toast(text, ms = 2800) {
  const node = $('#toast');
  if (!node) return;
  node.textContent = text;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), ms);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showFatal(err) {
  console.error(err);
  const box = $('#fatal');
  if (!box) return;
  box.hidden = false;
  box.querySelector('.fatal-msg').textContent = err?.message || String(err);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
function bindUi() {
  $('#btn-camera').addEventListener('click', () => {
    if (state.cameraOn) stopCameraFlow();
    else startCameraFlow();
  });
  $('#btn-camera-cta')?.addEventListener('click', (e) => {
    e.stopPropagation();
    startCameraFlow();
  });

  $('#btn-demo').addEventListener('click', () => setDemo(!state.demoMode));
  $('#btn-auto-cal').addEventListener('click', autoCalibrate);
  $('#btn-manual-cal').addEventListener('click', startManual);
  $('#btn-reset-cal').addEventListener('click', resetCalibration);
  $('#btn-cal-fov')?.addEventListener('click', calibrateDistanceFov);
  $('#known-distance')?.addEventListener('change', (e) => {
    try {
      localStorage.setItem(STORE_DISTANCE, String(Number(e.target.value) || 3));
    } catch {
      /* storage may be disabled */
    }
  });
  $('#btn-start').addEventListener('click', startSelectedGame);
  $('#btn-stop').addEventListener('click', stopGame);

  $('#camera-select').addEventListener('change', () => {
    if (state.cameraOn) startCameraFlow();
  });

  $('#mirror-toggle').addEventListener('change', () => {
    applyMirrorCss();
    applyQuad(state.calibration.quad, {
      synthetic: state.calibration.synthetic,
      confidence: state.calibration.confidence,
    });
  });

  $('#tv-size').addEventListener('change', () => {
    applyQuad(state.calibration.quad, {
      synthetic: state.calibration.synthetic,
      confidence: state.calibration.confidence,
    });
  });

  const join = () => {
    const code = cleanRoom($('#room-input').value);
    localStorage.setItem(STORE_ROOM, code);
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    location.href = url.toString();
  };
  $('#btn-room').addEventListener('click', join);
  $('#room-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join();
  });

  preview.addEventListener('click', onPreviewClick);
  preview.addEventListener('contextmenu', (e) => {
    if (!state.manualMode) return;
    e.preventDefault();
    cancelManual();
    setCalStatus('Manual calibration cancelled');
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.manualMode) {
      cancelManual();
      setCalStatus('Manual calibration cancelled');
    }
  });

  window.addEventListener('resize', () => {
    resizeOverlay();
    drawOverlay(currentPlayers());
  });

  window.addEventListener('error', (e) => showFatal(e.error || new Error(e.message)));
  window.addEventListener('unhandledrejection', (e) => showFatal(e.reason));
}

/* ------------------------------------------------------------------ */
/* Screen Wake Lock (Prevent laptop display from dimming/sleeping)     */
/* ------------------------------------------------------------------ */
let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
    console.log('[power] Laptop screen wake lock active — will not sleep');
  } catch (err) {
    console.warn('[power] Screen wake lock failed:', err.message);
  }
}

function boot() {
  requestWakeLock();
  document.addEventListener('pointerdown', () => {
    if (!wakeLock) requestWakeLock();
  }, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !wakeLock) requestWakeLock();
  });

  $('#room-input').value = room;
  let known = 3;
  try {
    known = Number(localStorage.getItem(STORE_DISTANCE)) || 3;
  } catch {
    /* storage may be disabled */
  }
  if ($('#known-distance')) $('#known-distance').value = String(known);
  syncCalibrationControls();
  updateCalUi();
  renderGames();
  bindUi();
  updateDemoButton();
  resizeOverlay();
  refreshCameras();

  if (!cameraSupported()) {
    $('#btn-camera').disabled = true;
    setCamStatus('Camera needs Chrome/Edge on http://localhost', 'bad');
  }

  net.connect();

  if (params.get('demo') === '1') {
    setDemo(true);
  } else if (cameraSupported()) {
    // Camera is the whole point of the controller. Try to start it as soon as
    // the page is ready; the browser will show its normal permission prompt.
    setTimeout(() => {
      if (!state.cameraOn && !state.demoMode) startCameraFlow();
    }, 1400);
  }

  requestAnimationFrame(loop);
}

boot();
