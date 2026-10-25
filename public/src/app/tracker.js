/**
 * Optional phone / second-camera tracker.
 *
 * Runs the same pose model locally and streams compact pose packets to the TV.
 * Player identities are namespaced by the server's sender id, so a phone can
 * add players without colliding with the laptop host.
 */
import { NetClient } from '../net/client.js';
import { startCamera as openCamera, stopCamera, listCameras } from '../vision/camera.js';
import { PoseEngine } from './poseEngine.js';
import { packPose, CONNECTIONS } from '../shared/pose.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);

function cleanRoom(value) {
  return String(value || 'HOME').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'HOME';
}

let room = cleanRoom(params.get('room') || localStorage.getItem('arfg.room.v1') || 'HOME');

const video = $('#video');
const overlay = $('#overlay');
const ctx = overlay.getContext('2d');

let engine = null;
let cameraOn = false;
let tracks = [];
let aspect = 16 / 9;
let lastDetect = 0;
let lastSend = 0;
let lastFpsAt = 0;
let fpsCount = 0;

const net = new NetClient({ room, role: 'tracker', name: 'Phone' });

net.addEventListener('status', (ev) => {
  const on = ev.detail.connected;
  $('#net-dot').className = 'dot ' + (on ? 'ok' : 'bad');
  $('#net-label').textContent = on ? 'LIVE' : 'RECONNECTING';
});

net.addEventListener('msg', (ev) => {
  const msg = ev.detail;
  if (msg.t === 'welcome') {
    room = msg.room || room;
    $('#room-input').value = room;
    updatePeers(msg.peers || []);
  } else if (msg.t === 'peers') {
    updatePeers(msg.peers || []);
  }
});

function updatePeers(peers) {
  const displays = peers.filter((p) => p.role === 'display').length;
  const label = $('#display-label');
  label.textContent = displays ? 'TV CONNECTED' : 'NO TV';
  label.classList.toggle('ok', displays > 0);
}

function setStatus(text, kind = '') {
  const node = $('#tracker-status');
  node.textContent = text;
  node.className = 'cam-status' + (kind ? ' ' + kind : '');
}

let toastTimer = 0;
function toast(text, ms = 2800) {
  const node = $('#toast');
  node.textContent = text;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), ms);
}

async function refreshCameras() {
  const select = $('#camera-select');
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

async function startFlow() {
  const btn = $('#btn-camera');
  btn.disabled = true;
  try {
    setStatus('Requesting camera…', 'busy');
    await openCamera(video, {
      deviceId: $('#camera-select').value || null,
      width: 960,
      height: 540,
      facingMode: 'environment',
    });
    cameraOn = true;
    $('#preview-empty').hidden = true;
    const vw = video.videoWidth || 960;
    const vh = video.videoHeight || 540;
    aspect = vw / vh;
    $('#preview').style.aspectRatio = `${vw} / ${vh}`;
    resizeOverlay();
    await refreshCameras();

    setStatus('Loading pose model…', 'busy');
    if (!engine) engine = new PoseEngine({ maxPlayers: 4, onStatus: (s) => setStatus(s) });
    await engine.load();
    setStatus('Tracking ready', 'ok');
    btn.textContent = 'Stop camera';
    toast('This camera is now adding players');
  } catch (err) {
    cameraOn = false;
    stopCamera(video);
    setStatus(err?.message || 'Camera failed', 'bad');
    toast(err?.message || 'Camera failed');
  } finally {
    btn.disabled = false;
  }
}

function stopFlow() {
  stopCamera(video);
  cameraOn = false;
  tracks = [];
  $('#preview-empty').hidden = false;
  $('#btn-camera').textContent = 'Start camera';
  setStatus('Camera off');
  drawOverlay([]);
  renderPlayers([]);
}

function resizeOverlay() {
  const rect = $('#preview').getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (overlay.width !== w || overlay.height !== h) {
    overlay.width = w;
    overlay.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawOverlay(list) {
  const rect = $('#preview').getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const p of list) {
    if (!p.lm) continue;
    ctx.strokeStyle = p.color || '#22d3ee';
    ctx.lineWidth = Math.max(2, w / 380);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      const A = p.lm[a];
      const B = p.lm[b];
      if (!A || !B) continue;
      ctx.moveTo(A.x * w, A.y * h);
      ctx.lineTo(B.x * w, B.y * h);
    }
    ctx.stroke();
    ctx.fillStyle = p.color || '#22d3ee';
    for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const P = p.lm[i];
      if (!P) continue;
      ctx.beginPath();
      ctx.arc(P.x * w, P.y * h, Math.max(2.2, w / 240), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function renderPlayers(list) {
  const wrap = $('#player-list');
  wrap.innerHTML = '';
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = cameraOn ? 'Looking for players…' : 'No players tracked.';
    wrap.append(p);
    return;
  }
  for (const p of list) {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.style.setProperty('--c', p.color || '#22d3ee');
    const dot = document.createElement('span');
    dot.className = 'player-dot';
    const main = document.createElement('div');
    main.className = 'player-main';
    const top = document.createElement('div');
    top.className = 'player-top';
    const name = document.createElement('span');
    name.className = 'player-name-static';
    name.textContent = p.name || `Player ${p.id}`;
    const tag = document.createElement('span');
    tag.className = 'player-tag';
    tag.textContent = 'TRACKING';
    top.append(name, tag);
    main.append(top);
    row.append(dot, main);
    wrap.append(row);
  }
}

function sendPoses() {
  if (!tracks.length) return;
  net.send({
    t: 'poses',
    ts: performance.now(),
    aspect,
    players: tracks.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      lm: packPose(p.lm),
    })),
  });
}

function joinRoom() {
  const code = cleanRoom($('#room-input').value);
  localStorage.setItem('arfg.room.v1', code);
  const url = new URL(location.href);
  url.searchParams.set('room', code);
  location.href = url.toString();
}

let lastFrame = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.06, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;

  if (cameraOn && engine?.ready && now - lastDetect > 33 && video.readyState >= 2) {
    lastDetect = now;
    tracks = engine.detect(video, now, aspect);
    drawOverlay(tracks);
    fpsCount++;
  }

  if (now - lastSend > 50) {
    lastSend = now;
    sendPoses();
  }

  if (now - lastFpsAt > 500) {
    const elapsed = now - lastFpsAt;
    const fps = cameraOn ? Math.round((fpsCount * 1000) / Math.max(1, elapsed)) : 0;
    lastFpsAt = now;
    fpsCount = 0;
    $('#fps-badge').textContent = `${fps} FPS`;
    $('#pose-badge').textContent = `${tracks.length} PLAYER${tracks.length === 1 ? '' : 'S'}`;
    renderPlayers(tracks);
  }
}

function boot() {
  $('#room-input').value = room;
  $('#btn-camera').addEventListener('click', () => (cameraOn ? stopFlow() : startFlow()));
  $('#camera-select').addEventListener('change', () => {
    if (cameraOn) startFlow();
  });
  $('#room-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
  });
  window.addEventListener('resize', () => {
    resizeOverlay();
    drawOverlay(tracks);
  });

  if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    setStatus('Camera blocked: open this page over HTTPS', 'bad');
  }

  resizeOverlay();
  refreshCameras();
  net.connect();
  requestAnimationFrame(loop);
}

boot();
