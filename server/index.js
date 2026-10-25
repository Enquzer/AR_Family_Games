/**
 * AR Family Games - local game server
 *
 * Serves the web app and runs the realtime relay between:
 *   - host    : laptop camera + pose tracking + controls
 *   - display : the TV / big screen renderer (authoritative game simulation)
 *   - tracker : optional phone cameras that add more tracked players
 *
 * No internet or cloud account required. Everything runs on the LAN.
 */
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.fbx': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.task': 'application/octet-stream',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

function lanAddresses() {
  const out = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push({ name, address: entry.address });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Static file server                                                  */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  try {
    if (req.url === '/api/info') {
      const body = JSON.stringify({
        app: 'AR Family Games',
        port: PORT,
        addresses: lanAddresses(),
        rooms: [...rooms.values()].map((r) => ({
          code: r.code,
          peers: r.clients.size,
          game: r.game?.gameId || null,
        })),
      });
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body);
      return;
    }

    if (req.url === '/api/shutdown') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, message: 'Server shutting down' }));
      console.log('[server] Shutdown requested via gesture/UI. Exiting process...');
      setTimeout(() => process.exit(0), 400);
      return;
    }

    const url = new URL(req.url || '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';

    // Resolve safely inside public/.
    const filePath = path.resolve(ROOT, '.' + pathname);
    if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let info;
    try {
      info = await stat(filePath);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    if (info.isDirectory()) {
      res.writeHead(302, { location: pathname.replace(/\/?$/, '/') + 'index.html' }).end();
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const cache =
      pathname.startsWith('/vendor/') || pathname.startsWith('/models/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache';
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': info.size,
      'cache-control': cache,
      'x-content-type-options': 'nosniff',
    });
    createReadStream(filePath).pipe(res);
    if (process.env.LOG_REQUESTS) {
      console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  } catch (err) {
    console.error('[http]', err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal error');
  }
});

/* ------------------------------------------------------------------ */
/* Realtime rooms                                                      */
/* ------------------------------------------------------------------ */

/** @type {Map<string, Room>} */
const rooms = new Map();
let nextClientId = 1;

const MAX_POSE_PAYLOAD = 2 * 1024 * 1024;
const ROOM_TTL_MS = 1000 * 60 * 30;
const COLORS = ['#22d3ee', '#f472b6', '#fbbf24', '#a3e635'];

function createRoom(code) {
  return {
    code,
    clients: new Map(), // ws -> { id, role, name, color, joinedAt }
    game: null, // { gameId, options, action, at }
    calibration: null,
    state: null,
    lastActive: Date.now(),
  };
}

function getRoom(code) {
  const key = String(code || 'HOME').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'HOME';
  let room = rooms.get(key);
  if (!room) {
    room = createRoom(key);
    rooms.set(key, room);
    console.log(`[room] created ${key}`);
  }
  room.lastActive = Date.now();
  return room;
}

function peersOf(room) {
  return [...room.clients.entries()].map(([ws, meta]) => ({
    id: meta.id,
    role: meta.role,
    name: meta.name,
    color: meta.color,
    connected: ws.readyState === ws.OPEN,
  }));
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      console.warn('[ws] send failed', err.message);
    }
  }
}

function broadcast(room, msg, { except = null, roles = null } = {}) {
  const data = JSON.stringify(msg);
  for (const [ws, meta] of room.clients) {
    if (ws === except) continue;
    if (roles && !roles.includes(meta.role)) continue;
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(data);
      } catch {
        /* client is going away */
      }
    }
  }
}

function sendPeers(room) {
  broadcast(room, { t: 'peers', peers: peersOf(room) });
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_POSE_PAYLOAD });

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  let room = null;
  let meta = null;
  const helloTimer = setTimeout(() => {
    if (!meta) ws.close(4000, 'hello required');
  }, 8000);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'hello') {
      if (meta) return;
      clearTimeout(helloTimer);
      room = getRoom(msg.room);
      const role = ['host', 'display', 'tracker'].includes(msg.role) ? msg.role : 'host';
      meta = {
        id: `c${nextClientId++}`,
        role,
        name: String(msg.name || role).slice(0, 24),
        color: COLORS[room.clients.size % COLORS.length],
        joinedAt: Date.now(),
      };
      room.clients.set(ws, meta);
      console.log(`[ws] ${meta.id} ${role} "${meta.name}" joined ${room.code} (${room.clients.size})`);

      send(ws, {
        t: 'welcome',
        id: meta.id,
        role,
        room: room.code,
        peers: peersOf(room),
        game: room.game,
        calibration: room.calibration,
        state: room.state,
        serverTime: Date.now(),
      });
      sendPeers(room);
      return;
    }

    if (!meta || !room) return;
    room.lastActive = Date.now();

    switch (msg.t) {
      case 'poses': {
        // Pose frames go only to screens. Keep them lean.
        const out = {
          t: 'poses',
          from: meta.id,
          fromName: meta.name,
          ts: Number(msg.ts) || Date.now(),
          aspect: Number(msg.aspect) || 16 / 9,
          players: Array.isArray(msg.players) ? msg.players : [],
        };
        broadcast(room, out, { roles: ['display'] });
        break;
      }
      case 'calibration': {
        room.calibration = msg.calibration || null;
        broadcast(room, { t: 'calibration', calibration: room.calibration, from: meta.id }, { roles: ['display'] });
        break;
      }
      case 'flash': {
        broadcast(
          room,
          { t: 'flash', duration: Number(msg.duration) || 2200, from: meta.id },
          { roles: ['display'] }
        );
        break;
      }
      case 'command': {
        room.game = {
          gameId: msg.gameId || null,
          options: msg.options || {},
          action: msg.action || 'start',
          at: Date.now(),
        };
        room.state = null;
        console.log(`[room] ${room.code} command ${room.game.action} ${room.game.gameId || ''}`);
        broadcast(room, { t: 'command', ...room.game, from: meta.id }, { except: ws });
        sendPeers(room);
        break;
      }
      case 'state': {
        room.state = {
          ...msg.state,
          from: meta.id,
          at: Date.now(),
        };
        broadcast(room, { t: 'state', state: room.state }, { except: ws, roles: ['host', 'tracker'] });
        break;
      }
      case 'event': {
        broadcast(room, { t: 'event', name: msg.name, payload: msg.payload, from: meta.id }, { except: ws });
        break;
      }
      case 'player': {
        broadcast(room, { t: 'player', player: msg.player, from: meta.id }, { except: ws });
        break;
      }
      case 'ping': {
        send(ws, { t: 'pong', at: msg.at, serverTime: Date.now() });
        break;
      }
      case 'bye': {
        ws.close(1000, 'bye');
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    if (!room || !meta) return;
    room.clients.delete(ws);
    console.log(`[ws] ${meta.id} left ${room.code} (${room.clients.size})`);
    sendPeers(room);
    if (room.clients.size === 0) room.lastActive = Date.now();
  });

  ws.on('error', (err) => console.warn('[ws]', err.message));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [code, room] of rooms) {
    if (room.clients.size === 0 && room.lastActive < cutoff) {
      rooms.delete(code);
      console.log(`[room] expired ${code}`);
    }
  }
}, 20000);

server.listen(PORT, HOST, () => {
  const urls = [`http://localhost:${PORT}`];
  for (const { address } of lanAddresses()) urls.push(`http://${address}:${PORT}`);
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║            AR FAMILY GAMES  ·  local server           ║');
  console.log('  ╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Controller (laptop):');
  for (const u of urls) console.log(`    ${u}/`);
  console.log('');
  console.log('  TV display (open on the HDMI screen):');
  for (const u of urls) console.log(`    ${u}/display.html`);
  console.log('');
  console.log('  Phone tracker (optional extra camera):');
  for (const u of urls.slice(1)) console.log(`    ${u}/tracker.html`);
  console.log('');
  console.log('  Room code is shown in the app. Everything stays on your LAN.');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error(`  Try:  set PORT=3001 && npm start   (Windows)\n`);
    process.exit(1);
  }
  throw err;
});

function shutdown() {
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1001, 'server shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason);
});
