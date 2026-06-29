'use strict';

import { firebaseConfig, isConfigured } from './firebase-config.js';

// ============================================================================
//  술래잡기 — Firebase Realtime Database 기반 서버리스 멀티플레이
//
//  서버가 없습니다. 각 클라이언트가:
//    - 자기 캐릭터를 로컬에서 움직이고 위치를 RTDB 에 올림
//    - 다른 사람 위치를 RTDB 에서 읽어 그림
//    - 술래(taggerId)는 RTDB 의 /game 노드로 모두가 공유
//  미로는 인원수로부터 결정적으로 생성되므로 모든 클라이언트가 동일합니다.
// ============================================================================

// ---------------------------------------------------------------------------
// Constants (서버 버전과 동일한 규칙)
// ---------------------------------------------------------------------------
const CELL = 40;
const PLAYER_RADIUS = 14;
const SPEED = 150;          // px/sec
const FREEZE_MS = 10000;    // 잡히면 10초 정지
const CATCH_PAD = 8;        // 잡기 사거리 여유
const WRITE_HZ = 12;        // 내 위치를 RTDB 에 올리는 빈도

const COLORS = ['#ffd23f', '#3fa9ff', '#7CFC00', '#ff77ff', '#ff8c42', '#00e5d0', '#c77dff', '#f5f5f5'];

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const menu = document.getElementById('menu');
const nameInput = document.getElementById('nameInput');
const joinBtn = document.getElementById('joinBtn');
const hud = document.getElementById('hud');
const statusEl = document.getElementById('status');
const touch = document.getElementById('touch');

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// Maze (인원수로부터 결정적으로 생성 — 모든 클라이언트가 동일)
// ---------------------------------------------------------------------------
function blocksForPlayers(n) {
  // Minimum is generous so even a solo/2-player game has plenty of room,
  // then grows with the number of players. (blocks*3+1 cells per axis)
  return Math.max(8, Math.ceil(Math.sqrt(Math.max(1, n)) * 3) + 5);
}
function buildMaze(numPlayers) {
  const b = blocksForPlayers(numPlayers);
  const cols = b * 3 + 1;
  const rows = b * 3 + 1;
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      const isBlock = r % 3 !== 0 && c % 3 !== 0;
      row.push(border || isBlock ? 1 : 0);
    }
    grid.push(row);
  }
  return { cols, rows, grid };
}
function openCells(m) {
  const cells = [];
  for (let r = 0; r < m.rows; r++)
    for (let c = 0; c < m.cols; c++)
      if (m.grid[r][c] === 0) cells.push({ r, c });
  return cells;
}
function randomOpenPosition(m) {
  const cells = openCells(m);
  const cell = cells[Math.floor(Math.random() * cells.length)];
  return { x: (cell.c + 0.5) * CELL, y: (cell.r + 0.5) * CELL };
}
function circleHitsWall(m, x, y) {
  const minC = Math.max(0, Math.floor((x - PLAYER_RADIUS) / CELL));
  const maxC = Math.min(m.cols - 1, Math.floor((x + PLAYER_RADIUS) / CELL));
  const minR = Math.max(0, Math.floor((y - PLAYER_RADIUS) / CELL));
  const maxR = Math.min(m.rows - 1, Math.floor((y + PLAYER_RADIUS) / CELL));
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (m.grid[r][c] !== 1) continue;
      const rx = c * CELL, ry = r * CELL;
      const nx = Math.max(rx, Math.min(x, rx + CELL));
      const ny = Math.max(ry, Math.min(y, ry + CELL));
      const dx = x - nx, dy = y - ny;
      if (dx * dx + dy * dy < PLAYER_RADIUS * PLAYER_RADIUS) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
let maze = buildMaze(1);
let online = false;
let me = null;                    // { id, name, color, x, y, frozenUntil }
const remotes = new Map();        // id -> { name, color, x, y, frozenUntil, dispX, dispY }
let taggerId = null;              // 현재 술래 id (null 이면 유예 시간/미지정)
let pendingTaggerId = null;       // freeze 후 술래가 될 사람

const input = { up: false, down: false, left: false, right: false };

// Firebase handles (online 모드에서 채워짐)
let fb = null; // { db, refs..., api: {ref,set,update,onValue,onDisconnect,remove,runTransaction,get,serverTimestamp} }

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keyMap = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); doCatch(); return; }
  const d = keyMap[e.code];
  if (d) { e.preventDefault(); input[d] = true; }
});
window.addEventListener('keyup', (e) => {
  const d = keyMap[e.code];
  if (d) input[d] = false;
});
function bindTouch(el, dir) {
  const on = (e) => { e.preventDefault(); input[dir] = true; };
  const off = (e) => { e.preventDefault(); input[dir] = false; };
  el.addEventListener('touchstart', on, { passive: false });
  el.addEventListener('touchend', off, { passive: false });
  el.addEventListener('touchcancel', off, { passive: false });
  el.addEventListener('mousedown', on);
  el.addEventListener('mouseup', off);
  el.addEventListener('mouseleave', off);
}
document.querySelectorAll('.dpad').forEach((el) => bindTouch(el, el.dataset.dir));
const catchBtn = document.getElementById('catchBtn');
catchBtn.addEventListener('touchstart', (e) => { e.preventDefault(); doCatch(); }, { passive: false });
catchBtn.addEventListener('mousedown', (e) => { e.preventDefault(); doCatch(); });

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------
joinBtn.addEventListener('click', startGame);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); });

async function startGame() {
  const name = (nameInput.value || '').trim() || 'Player';
  menu.classList.add('hidden');
  hud.classList.remove('hidden');
  if ('ontouchstart' in window) touch.classList.remove('hidden');

  if (isConfigured(firebaseConfig)) {
    try {
      await connectFirebase(name);
      online = true;
    } catch (err) {
      console.error('Firebase 연결 실패, 오프라인 모드로 전환:', err);
      startOffline(name);
    }
  } else {
    startOffline(name);
  }
}

function startOffline(name) {
  online = false;
  maze = buildMaze(1);
  const pos = randomOpenPosition(maze);
  me = { id: 'local', name, color: COLORS[0], x: pos.x, y: pos.y, frozenUntil: 0 };
  taggerId = 'local'; // 혼자라 본인이 술래
}

// ---------------------------------------------------------------------------
// Firebase (online 모드)
// ---------------------------------------------------------------------------
async function connectFirebase(name) {
  const appMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
  const dbMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
  const app = appMod.initializeApp(firebaseConfig);
  const db = dbMod.getDatabase(app);
  const api = dbMod;

  const id = (crypto.randomUUID && crypto.randomUUID()) || 'p' + Math.random().toString(36).slice(2);
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];

  // 현재 인원수에 맞는 미로 + 빈 칸에 스폰
  const snap = await api.get(api.ref(db, 'players'));
  const count = (snap.exists() ? Object.keys(snap.val()).length : 0) + 1;
  maze = buildMaze(count);
  const pos = randomOpenPosition(maze);

  const joinedAt = Date.now();
  me = { id, name, color, x: pos.x, y: pos.y, frozenUntil: 0, joinedAt };

  const myRef = api.ref(db, 'players/' + id);
  await api.set(myRef, {
    name, color, x: pos.x, y: pos.y, frozenUntil: 0, joinedAt,
  });
  api.onDisconnect(myRef).remove();

  fb = { db, api, myRef, gameRef: api.ref(db, 'game') };

  // 다른 플레이어 구독
  api.onValue(api.ref(db, 'players'), (s) => {
    const val = s.val() || {};
    const ids = Object.keys(val);
    // 인원수에 맞춰 미로 갱신 (커질 때 기존 위치는 그대로 유효)
    const m = buildMaze(Math.max(1, ids.length));
    if (m.cols !== maze.cols) maze = m;

    remotes.forEach((_, rid) => { if (!val[rid]) remotes.delete(rid); });
    for (const rid of ids) {
      if (rid === id) continue;
      const p = val[rid];
      let r = remotes.get(rid);
      if (!r) { r = { dispX: p.x, dispY: p.y }; remotes.set(rid, r); }
      r.name = p.name; r.color = p.color; r.x = p.x; r.y = p.y;
      r.frozenUntil = p.frozenUntil || 0;
      r.joinedAt = p.joinedAt || 0;
    }
    ensureTagger();
  });

  // 술래 정보 구독
  api.onValue(fb.gameRef, (s) => {
    const g = s.val() || {};
    taggerId = g.taggerId || null;
    pendingTaggerId = g.pendingTaggerId || null;
  });

  ensureTagger();
}

// 술래가 비어있으면(아무도 술래가 아니고 freeze 대기자도 없으면) 가장 먼저 들어온 사람이 차지
function ensureTagger() {
  if (!online || !fb) return;
  const allIds = [me.id, ...remotes.keys()];
  const taggerValid = taggerId && allIds.includes(taggerId);
  const pendingValid = pendingTaggerId && allIds.includes(pendingTaggerId);
  if (taggerValid || pendingValid) return;

  // 결정적으로 후보 선정: joinedAt(없으면 id) 기준 최솟값. 모두 같은 후보를 고름.
  const candidates = [];
  if (me.frozenUntil <= Date.now()) candidates.push({ id: me.id, key: me.joinedAt || me.id });
  remotes.forEach((r, rid) => {
    if ((r.frozenUntil || 0) <= Date.now()) candidates.push({ id: rid, key: r.joinedAt || rid });
  });
  if (!candidates.length) return;
  candidates.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const chosen = candidates[0].id;

  // 트랜잭션으로 한 명만 술래가 되도록
  fb.api.runTransaction(fb.api.ref(fb.db, 'game/taggerId'), (cur) => {
    if (cur && allIds.includes(cur)) return cur; // 이미 유효한 술래
    return chosen;
  });
}

// ---------------------------------------------------------------------------
// Catch (술래만 동작)
// ---------------------------------------------------------------------------
function doCatch() {
  if (!me) return;
  if (taggerId !== me.id) return;          // 내가 술래가 아니면 무시
  if (me.frozenUntil > Date.now()) return; // 얼어있으면 무시

  const reach = PLAYER_RADIUS * 2 + CATCH_PAD;
  let best = null, bestDist = Infinity;
  remotes.forEach((r, rid) => {
    if ((r.frozenUntil || 0) > Date.now()) return;
    const d = Math.hypot(r.x - me.x, r.y - me.y);
    if (d <= reach && d < bestDist) { bestDist = d; best = rid; }
  });

  if (best) {
    if (online && fb) {
      const updates = {};
      updates['players/' + best + '/frozenUntil'] = Date.now() + FREEZE_MS;
      updates['game/taggerId'] = null;            // 유예 시간 시작
      updates['game/pendingTaggerId'] = best;     // 10초 뒤 이 사람이 술래
      fb.api.update(fb.api.ref(fb.db), updates);
    }
  }
}

// ---------------------------------------------------------------------------
// Local simulation + write loop
// ---------------------------------------------------------------------------
let lastFrame = performance.now();
let lastWrite = 0;

function step(now) {
  requestAnimationFrame(step);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!me) { draw(); return; }

  const frozen = me.frozenUntil > Date.now();

  // 내 freeze 가 끝났으면 내가 새 술래가 됨
  if (online && fb && me.frozenUntil && !frozen) {
    me.frozenUntil = 0;
    fb.api.update(fb.api.ref(fb.db), {
      ['players/' + me.id + '/frozenUntil']: 0,
      'game/taggerId': me.id,
      'game/pendingTaggerId': null,
    });
  }

  // 이동 (얼어있지 않을 때만)
  if (!frozen) {
    let dx = 0, dy = 0;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      dx = (dx / len) * SPEED * dt;
      dy = (dy / len) * SPEED * dt;
      if (!circleHitsWall(maze, me.x + dx, me.y)) me.x += dx;
      if (!circleHitsWall(maze, me.x, me.y + dy)) me.y += dy;
    }
  }

  // 위치 동기화 (throttle)
  if (online && fb && now - lastWrite > 1000 / WRITE_HZ) {
    lastWrite = now;
    fb.api.update(fb.myRef, { x: Math.round(me.x), y: Math.round(me.y) });
  }

  // 원격 플레이어 위치 보간(부드럽게)
  remotes.forEach((r) => {
    r.dispX += (r.x - r.dispX) * Math.min(1, dt * 12);
    r.dispY += (r.y - r.dispY) * Math.min(1, dt * 12);
  });

  draw();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function draw() {
  const W = window.innerWidth, H = window.innerHeight;
  ctx.fillStyle = '#05050f';
  ctx.fillRect(0, 0, W, H);
  if (!me) return;

  const offX = W / 2 - me.x;
  const offY = H / 2 - me.y;

  const minC = Math.max(0, Math.floor(-offX / CELL));
  const maxC = Math.min(maze.cols - 1, Math.floor((W - offX) / CELL));
  const minR = Math.max(0, Math.floor(-offY / CELL));
  const maxR = Math.min(maze.rows - 1, Math.floor((H - offY) / CELL));
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (maze.grid[r][c] !== 1) continue;
      const x = c * CELL + offX, y = r * CELL + offY;
      ctx.fillStyle = '#1b1bdb';
      roundRect(ctx, x + 2, y + 2, CELL - 4, CELL - 4, 6);
      ctx.fill();
      ctx.strokeStyle = '#5b5bff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  const drawList = [];
  remotes.forEach((r, rid) => drawList.push({ id: rid, name: r.name, color: r.color, x: r.dispX, y: r.dispY, frozenUntil: r.frozenUntil }));
  drawList.push({ id: me.id, name: me.name, color: me.color, x: me.x, y: me.y, frozenUntil: me.frozenUntil, self: true });

  for (const p of drawList) {
    const x = p.x + offX, y = p.y + offY;
    const radius = CELL * 0.35;
    const isFrozen = (p.frozenUntil || 0) > Date.now();
    const isIt = p.id === taggerId;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = isFrozen ? '#888' : p.color;
    ctx.fill();

    if (isIt) {
      ctx.beginPath();
      ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff3b3b';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    if (p.self) {
      ctx.beginPath();
      ctx.arc(x, y, radius + 9, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (isFrozen) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(Math.ceil((p.frozenUntil - Date.now()) / 1000), x, y);
    }
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText((isIt ? '👹 ' : '') + p.name, x, y - radius - 6);
  }

  // 상태 표시
  const myFrozen = me.frozenUntil > Date.now();
  if (!online) {
    statusEl.textContent = '🟡 오프라인 미리보기 (firebase-config.js 를 채우면 멀티플레이)';
  } else if (myFrozen) {
    statusEl.textContent = `😵 잡혔어요! ${Math.ceil((me.frozenUntil - Date.now()) / 1000)}초 후 술래가 됩니다`;
  } else if (taggerId === me.id) {
    statusEl.textContent = '👹 당신이 술래! 닿은 채로 스페이스/CATCH';
  } else {
    const t = taggerId === me.id ? me : remotes.get(taggerId);
    statusEl.textContent = t ? `🏃 도망쳐요! 술래: ${t.name}` : '🏃 도망쳐요!';
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

requestAnimationFrame(step);
