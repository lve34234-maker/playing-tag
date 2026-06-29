'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const CELL = 40; // pixels per maze cell
const PLAYER_RADIUS = 14; // player body radius in pixels
const SPEED = 150; // movement speed in px/sec
const TICK_MS = 1000 / 30; // server tick rate
const FREEZE_MS = 10000; // how long a caught player stays frozen
const CATCH_PAD = 8; // extra reach added on top of the two body radii

// ----------------------------------------------------------------------------
// Static file server (serves the ./public folder)
// ----------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(__dirname, 'public', path.normalize(urlPath));
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ----------------------------------------------------------------------------
// Maze generation (Pac-Man style block lattice)
//
// The map grows with the number of players. We build a grid where 2x2 blocks
// of wall are separated by 1-wide corridors, surrounded by a solid border.
// Corridors form a fully connected grid, so every open cell is reachable.
// ----------------------------------------------------------------------------
function blocksForPlayers(n) {
  // Minimum 3 blocks per axis; grows roughly with the square root of players.
  return Math.max(3, Math.ceil(Math.sqrt(Math.max(1, n)) * 2) + 1);
}

function buildMaze(numPlayers) {
  const bx = blocksForPlayers(numPlayers);
  const by = blocksForPlayers(numPlayers);
  const cols = bx * 3 + 1;
  const rows = by * 3 + 1;
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      // A cell is a wall block when it is NOT on a corridor line.
      const isBlock = r % 3 !== 0 && c % 3 !== 0;
      row.push(border || isBlock ? 1 : 0);
    }
    grid.push(row);
  }
  return { cols, rows, grid };
}

function openCells(maze) {
  const cells = [];
  for (let r = 0; r < maze.rows; r++) {
    for (let c = 0; c < maze.cols; c++) {
      if (maze.grid[r][c] === 0) cells.push({ r, c });
    }
  }
  return cells;
}

// ----------------------------------------------------------------------------
// Game state
// ----------------------------------------------------------------------------
const COLORS = ['#ffd23f', '#3fa9ff', '#7CFC00', '#ff77ff', '#ff8c42', '#00e5d0', '#c77dff', '#f5f5f5'];

const players = new Map(); // id -> player
let maze = buildMaze(0);
let mapVersion = 0;
let nextId = 1;

function randomOpenPosition() {
  const cells = openCells(maze);
  const cell = cells[Math.floor(Math.random() * cells.length)];
  return { x: (cell.c + 0.5) * CELL, y: (cell.r + 0.5) * CELL };
}

function regenerateMap() {
  maze = buildMaze(players.size);
  mapVersion++;
  // Re-place everyone onto valid open cells (the maze shape changed).
  for (const p of players.values()) {
    const pos = randomOpenPosition();
    p.x = pos.x;
    p.y = pos.y;
  }
  broadcastMap();
}

function ensureTagger() {
  const list = [...players.values()];
  if (list.length === 0) return;
  const hasActiveTagger = list.some((p) => p.isIt && !p.frozenUntil);
  // A caught player who is frozen is the designated next tagger; don't fill the
  // vacuum while we are waiting for their freeze to end.
  const hasPendingTagger = list.some((p) => p.pendingIt && p.frozenUntil);
  if (!hasActiveTagger && !hasPendingTagger) {
    // Pick a random non-frozen player to be "it".
    const candidates = list.filter((p) => !p.frozenUntil);
    const pool = candidates.length ? candidates : list;
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    for (const p of list) p.isIt = false;
    chosen.isIt = true;
  }
}

// ----------------------------------------------------------------------------
// Collision: circle vs wall cells
// ----------------------------------------------------------------------------
function circleHitsWall(x, y) {
  const minC = Math.max(0, Math.floor((x - PLAYER_RADIUS) / CELL));
  const maxC = Math.min(maze.cols - 1, Math.floor((x + PLAYER_RADIUS) / CELL));
  const minR = Math.max(0, Math.floor((y - PLAYER_RADIUS) / CELL));
  const maxR = Math.min(maze.rows - 1, Math.floor((y + PLAYER_RADIUS) / CELL));
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (maze.grid[r][c] !== 1) continue;
      const rx = c * CELL;
      const ry = r * CELL;
      const nearestX = Math.max(rx, Math.min(x, rx + CELL));
      const nearestY = Math.max(ry, Math.min(y, ry + CELL));
      const dx = x - nearestX;
      const dy = y - nearestY;
      if (dx * dx + dy * dy < PLAYER_RADIUS * PLAYER_RADIUS) return true;
    }
  }
  return false;
}

// ----------------------------------------------------------------------------
// Game tick
// ----------------------------------------------------------------------------
let lastTick = Date.now();

function tick() {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  for (const p of players.values()) {
    // Release frozen players whose timer has elapsed -> they become "it".
    if (p.frozenUntil && now >= p.frozenUntil) {
      p.frozenUntil = 0;
      p.pendingIt = false;
      // Whoever was caught becomes the new tagger.
      for (const o of players.values()) o.isIt = false;
      p.isIt = true;
    }

    if (p.frozenUntil) continue; // frozen players cannot move

    // Movement
    let dx = 0;
    let dy = 0;
    if (p.input.up) dy -= 1;
    if (p.input.down) dy += 1;
    if (p.input.left) dx -= 1;
    if (p.input.right) dx += 1;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      dx = (dx / len) * SPEED * dt;
      dy = (dy / len) * SPEED * dt;
      // Move on each axis separately so we slide along walls.
      if (!circleHitsWall(p.x + dx, p.y)) p.x += dx;
      if (!circleHitsWall(p.x, p.y + dy)) p.y += dy;
    }
  }

  ensureTagger();
  broadcastState();
}

function tryCatch(tagger) {
  if (!tagger.isIt || tagger.frozenUntil) return;
  const reach = PLAYER_RADIUS * 2 + CATCH_PAD;
  let best = null;
  let bestDist = Infinity;
  for (const p of players.values()) {
    if (p.id === tagger.id || p.frozenUntil) continue;
    const d = Math.hypot(p.x - tagger.x, p.y - tagger.y);
    if (d <= reach && d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  if (best) {
    best.frozenUntil = Date.now() + FREEZE_MS;
    best.isIt = false;
    best.pendingIt = true; // after the freeze, this player becomes the new tagger
    tagger.isIt = false; // the tagger is freed
  }
}

// ----------------------------------------------------------------------------
// Networking
// ----------------------------------------------------------------------------
const wss = new WebSocketServer({ server });

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function broadcastMap() {
  const payload = { t: 'map', version: mapVersion, cell: CELL, cols: maze.cols, rows: maze.rows, grid: maze.grid };
  for (const p of players.values()) send(p.ws, payload);
}

function broadcastState() {
  const now = Date.now();
  const list = [...players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    x: Math.round(p.x),
    y: Math.round(p.y),
    color: p.color,
    isIt: p.isIt,
    freeze: p.frozenUntil ? Math.max(0, Math.ceil((p.frozenUntil - now) / 1000)) : 0,
  }));
  const payload = { t: 'state', players: list };
  for (const p of players.values()) send(p.ws, payload);
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const player = {
    id,
    ws,
    name: 'Player' + id,
    color: COLORS[(id - 1) % COLORS.length],
    x: 0,
    y: 0,
    isIt: false,
    pendingIt: false,
    frozenUntil: 0,
    input: { up: false, down: false, left: false, right: false },
  };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.t === 'join') {
      player.name = String(msg.name || player.name).slice(0, 16) || player.name;
      players.set(id, player);
      regenerateMap(); // map grows and everyone is re-placed
      ensureTagger();
      send(ws, { t: 'init', id, cell: CELL });
      broadcastMap();
    } else if (msg.t === 'input' && players.has(id)) {
      player.input = {
        up: !!msg.up,
        down: !!msg.down,
        left: !!msg.left,
        right: !!msg.right,
      };
    } else if (msg.t === 'catch' && players.has(id)) {
      tryCatch(player);
    }
  });

  ws.on('close', () => {
    if (players.delete(id)) {
      if (players.size > 0) regenerateMap();
      else maze = buildMaze(0);
      ensureTagger();
    }
  });
});

setInterval(tick, TICK_MS);

server.listen(PORT, () => {
  console.log(`Tag game running at http://localhost:${PORT}`);
});
