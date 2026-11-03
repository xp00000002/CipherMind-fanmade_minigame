/* server.js - 静态站点 + 开放房间注册 API + PeerJS 信令
 *
 * 本地：
 *   cd server
 *   npm install
 *   npm start
 *   打开 http://localhost:9000/
 *
 * 生产：可以直接用本服务，也可以让 Nginx 托管静态文件，
 *       只把 /api 和 /peerjs 反代到本服务（默认 9000）。
 */
'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { ExpressPeerServer } = require('peer');

const PORT = Number(process.env.PORT || 9000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.resolve(__dirname, '..');
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS || 180000);
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 1000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const GAMES = new Set(['chess', 'zjh', 'battle', 'upgrade', 'freecell', 'klondike', 'spider']);
const rooms = new Map();   /* id -> { id, game, hostName, rules, gameStarted, allowSpec, noChat, ts, expiresAt } */

function cleanup() {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.expiresAt <= now) rooms.delete(id);
  }
}

function validId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

function cleanText(v, max) {
  return String(v == null ? '' : v).slice(0, max);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '16kb' }));

const corsOptions = {
  origin: CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN.split(',').map((s) => s.trim()),
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS']
};
app.use('/api', cors(corsOptions));

/* ---------- 开放房间 API ---------- */
app.get('/api/rooms', (req, res) => {
  cleanup();
  const game = String(req.query.game || '');
  let list = Array.from(rooms.values());
  if (game && GAMES.has(game)) list = list.filter((r) => r.game === game);
  list.sort((a, b) => b.ts - a.ts);
  res.json({
    rooms: list.map((r) => ({
      id: r.id,
      game: r.game,
      hostName: r.hostName,
      rules: r.rules,
      gameStarted: r.gameStarted,
      allowSpec: r.allowSpec,
      noChat: r.noChat,
      ts: r.ts
    }))
  });
});

app.post('/api/rooms', (req, res) => {
  const b = req.body || {};
  if (!validId(b.id)) return res.status(400).json({ error: 'invalid id' });
  if (!GAMES.has(b.game)) return res.status(400).json({ error: 'invalid game' });
  if (!rooms.has(b.id) && rooms.size >= MAX_ROOMS) {
    return res.status(503).json({ error: 'too many rooms' });
  }
  const now = Date.now();
  rooms.set(b.id, {
    id: b.id,
    game: b.game,
    hostName: cleanText(b.hostName || 'Player', 64),
    rules: cleanText(b.rules || '', 256),
    gameStarted: !!b.gameStarted,
    allowSpec: !!b.allowSpec,
    noChat: !!b.noChat,
    ts: now,
    expiresAt: now + ROOM_TTL_MS
  });
  res.json({ ok: true });
});

app.delete('/api/rooms/:id', (req, res) => {
  rooms.delete(req.params.id);
  res.status(204).end();
});

app.get('/api/health', (req, res) => {
  cleanup();
  res.json({ ok: true, rooms: rooms.size });
});

/* 保持 API 的错误响应为 JSON，不返回 HTML 堆栈 */
app.use('/api', (err, req, res, next) => {
  if (!err) return next();
  res.status(err.status || 400).json({ error: 'bad request' });
});

/* ---------- 静态站点 ---------- */
app.use((req, res, next) => {
  if (/^\/(?:server|\.git)(?:\/|$)/.test(req.path)) return res.status(404).end();
  next();
});
app.use(express.static(ROOT, {
  index: 'index.html',
  setHeaders(res, filePath) {
    if (/\.html?$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));

/* ---------- PeerJS 信令 ---------- */
const server = http.createServer(app);
const peerServer = ExpressPeerServer(server, {
  path: '/',
  proxied: true
});
app.use('/', peerServer);

setInterval(cleanup, 30000).unref();

server.listen(PORT, HOST, () => {
  console.log(`[server] http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`);
  console.log(`[server] PeerJS: /peerjs, rooms API: /api/rooms, TTL: ${ROOM_TTL_MS}ms`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
