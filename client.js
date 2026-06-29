'use strict';

import { firebaseConfig, isConfigured } from './firebase-config.js';

// ============================================================================
//  술래잡기 — Firebase Realtime Database 기반 서버리스 멀티플레이
//  팩맨 미로 + 펠릿 + 달리기(스태미나) + 웅크리기(투명/발자국) + 관리자 + 미니게임
// ============================================================================

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CELL = 40;
const PLAYER_RADIUS = 13;
const WALK = 140;          // px/sec
const RUN = 245;           // px/sec (스태미나 소모)
const STA_MAX = 100;
const STA_DRAIN = 32;      // /sec while running
const STA_REGEN = 16;      // /sec while not running
const FREEZE_MS = 10000;   // 잡히면 10초
const CROUCH_MS = 5000;    // 웅크리기 지속 5초(투명)
const CROUCH_CD = 15000;   // 웅크리기 쿨타임 15초
const CATCH_PAD = 8;
const WRITE_HZ = 12;
const FOOT_MS = 3000;      // 발자국 수명
const FOOT_INTERVAL = 320; // 발자국 찍는 간격
const FOOT_SLOTS = 8;      // 플레이어당 발자국 버퍼

const ADMIN_NAME = 'admin140531';   // 닉네임에 이걸 입력하면 관리자
const ADMIN_DISPLAY = '이현석';      // 화면에 표시되는 관리자 이름
const TEAM_A = '#ff5c5c';
const TEAM_B = '#5c9cff';

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
const banner = document.getElementById('banner');
const staFill = document.getElementById('staFill');
const crouchInfo = document.getElementById('crouchInfo');
const adminPanel = document.getElementById('admin');
const playerListEl = document.getElementById('playerList');
const adminCountEl = document.getElementById('adminCount');
const adminStatusEl = document.getElementById('adminStatus');

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// Seeded RNG (모든 클라이언트가 같은 미로를 만들도록 결정적)
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Pac-Man 스타일 미로 (시드 기반: recursive backtracker + 루프 추가)
// ---------------------------------------------------------------------------
function mazeCellsForPlayers(n) {
  // 미로 셀 수(코리더 칸). 최소 9, 인원에 따라 증가.
  return Math.max(9, Math.ceil(Math.sqrt(Math.max(1, n)) * 3) + 6);
}
function buildMaze(numPlayers) {
  const W = mazeCellsForPlayers(numPlayers);
  const H = W;
  const cols = 2 * W + 1;
  const rows = 2 * H + 1;
  const grid = [];
  for (let r = 0; r < rows; r++) grid.push(new Array(cols).fill(1));

  const rng = mulberry32((W * 2654435761) >>> 0);
  const visited = [];
  for (let r = 0; r < H; r++) visited.push(new Array(W).fill(false));

  // iterative recursive-backtracker
  const stack = [[0, 0]];
  visited[0][0] = true;
  grid[1][1] = 0;
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const nbrs = [];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && !visited[ny][nx]) nbrs.push([nx, ny, dx, dy]);
    }
    if (!nbrs.length) { stack.pop(); continue; }
    const [nx, ny, dx, dy] = nbrs[Math.floor(rng() * nbrs.length)];
    visited[ny][nx] = true;
    grid[1 + cy * 2 + dy][1 + cx * 2 + dx] = 0; // 사이 벽 뚫기
    grid[1 + ny * 2][1 + nx * 2] = 0;
    stack.push([nx, ny]);
  }

  // braid: 벽 일부를 뚫어 루프를 만들어 팩맨처럼 (deterministic)
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (grid[r][c] !== 1) continue;
      const lr = grid[r][c - 1] === 0 && grid[r][c + 1] === 0;
      const ud = grid[r - 1][c] === 0 && grid[r + 1][c] === 0;
      if ((lr || ud) && rng() < 0.18) grid[r][c] = 0;
    }
  }
  return { cols, rows, grid, W };
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
function centerOpenPosition(m) {
  const cr = (m.rows - 1) / 2, cc = (m.cols - 1) / 2;
  let best = null, bd = Infinity;
  for (const cell of openCells(m)) {
    const d = (cell.r - cr) ** 2 + (cell.c - cc) ** 2;
    if (d < bd) { bd = d; best = cell; }
  }
  return best ? { x: (best.c + 0.5) * CELL, y: (best.r + 0.5) * CELL } : randomOpenPosition(m);
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
// State
// ---------------------------------------------------------------------------
let maze = buildMaze(1);
let online = false;
let isAdmin = false;
let me = null;            // 일반 플레이어 (관리자는 null)
const remotes = new Map();
let taggerId = null, pendingTaggerId = null;
let mode = 'tag';         // 'tag' | 'meteor' | 'tiles'
let teams = null;         // { id: 'A'|'B' } | null
let minigame = null;      // { type, endsAt }
let meteors = [];         // [{id,x,y,r}]
let tiles = {};           // { cellKey: 'A'|'B' }
const footprints = new Map(); // id -> [{x,y,ts}]
const collected = new Set();   // 내가 먹은 펠릿 (로컬)
let pelletsEaten = 0;

// 로컬 전용
let stamina = STA_MAX;
let crouchReadyAt = 0;
let footSlot = 0;
let lastFootTs = 0;
let lastTileCell = -1;

const input = { up: false, down: false, left: false, right: false, run: false };

// Firebase
let fb = null;
let lastCmdTs = 0;

// 관리자 운석 시뮬
let adminMeteorId = 0;
let adminMeteorSpawn = 0;
let lastMeteorWrite = 0;

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keyMap = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};
function typingInField(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
window.addEventListener('keydown', (e) => {
  if (typingInField(e)) return; // 입력창에 타이핑 중이면 게임 키 무시
  if (e.code === 'Space') { e.preventDefault(); doCatch(); return; }
  if (e.code === 'KeyC') { e.preventDefault(); doCrouch(); return; }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { input.run = true; return; }
  const d = keyMap[e.code];
  if (d) { e.preventDefault(); input[d] = true; }
});
window.addEventListener('keyup', (e) => {
  if (typingInField(e)) return;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { input.run = false; return; }
  const d = keyMap[e.code];
  if (d) input[d] = false;
});
function bindHold(el, dir) {
  const on = (e) => { e.preventDefault(); input[dir] = true; };
  const off = (e) => { e.preventDefault(); input[dir] = false; };
  el.addEventListener('touchstart', on, { passive: false });
  el.addEventListener('touchend', off, { passive: false });
  el.addEventListener('touchcancel', off, { passive: false });
  el.addEventListener('mousedown', on);
  el.addEventListener('mouseup', off);
  el.addEventListener('mouseleave', off);
}
document.querySelectorAll('.dpad').forEach((el) => bindHold(el, el.dataset.dir));
bindHold(document.getElementById('runBtn'), 'run');
function tapBtn(id, fn) {
  const el = document.getElementById(id);
  el.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });
  el.addEventListener('mousedown', (e) => { e.preventDefault(); fn(); });
}
tapBtn('catchBtn', doCatch);
tapBtn('crouchBtn', doCrouch);

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------
joinBtn.addEventListener('click', startGame);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); });

async function startGame() {
  const raw = (nameInput.value || '').trim();
  isAdmin = raw === ADMIN_NAME;
  const name = isAdmin ? ADMIN_DISPLAY : (raw || 'Player');

  menu.classList.add('hidden');
  if (isAdmin) {
    adminPanel.classList.remove('hidden');
    setupAdminPanel();
  } else {
    hud.classList.remove('hidden');
    if ('ontouchstart' in window) touch.classList.remove('hidden');
  }

  if (isConfigured(firebaseConfig)) {
    try { await connectFirebase(name); online = true; }
    catch (err) { console.error('Firebase 연결 실패, 오프라인 모드:', err); startOffline(name); }
  } else {
    startOffline(name);
  }
}

function startOffline(name) {
  online = false;
  maze = buildMaze(1);
  if (isAdmin) return; // 관리자는 플레이어 없음
  const pos = randomOpenPosition(maze);
  me = { id: 'local', name, color: COLORS[0], x: pos.x, y: pos.y, frozenUntil: 0, adminFrozenUntil: 0, hiddenUntil: 0, joinedAt: Date.now(), facing: 0 };
  taggerId = 'local';
}

// ---------------------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------------------
async function connectFirebase(name) {
  const appMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
  const dbMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
  const app = appMod.initializeApp(firebaseConfig);
  const db = dbMod.getDatabase(app);
  const api = dbMod;
  fb = { db, api };

  const id = (crypto.randomUUID && crypto.randomUUID()) || 'p' + Math.random().toString(36).slice(2);

  // 공통 구독
  api.onValue(api.ref(db, 'players'), (s) => {
    const val = s.val() || {};
    const ids = Object.keys(val);
    const m = buildMaze(Math.max(1, ids.length));
    if (m.cols !== maze.cols) {
      maze = m; collected.clear();
      if (me && circleHitsWall(maze, me.x, me.y)) { const p = randomOpenPosition(maze); me.x = p.x; me.y = p.y; }
    }
    remotes.forEach((_, rid) => { if (!val[rid]) remotes.delete(rid); });
    for (const rid of ids) {
      if (me && rid === me.id) continue;
      const p = val[rid];
      let r = remotes.get(rid);
      if (!r) { r = { dispX: p.x, dispY: p.y, facing: 0 }; remotes.set(rid, r); }
      if (typeof p.facing === 'number') r.facing = p.facing;
      r.name = p.name; r.color = p.color; r.x = p.x; r.y = p.y;
      r.frozenUntil = p.frozenUntil || 0;
      r.adminFrozenUntil = p.adminFrozenUntil || 0;
      r.hiddenUntil = p.hiddenUntil || 0;
      r.joinedAt = p.joinedAt || 0;
    }
    if (isAdmin) renderPlayerList(val);
    ensureTagger();
  });
  api.onValue(api.ref(db, 'game'), (s) => {
    const g = s.val() || {};
    taggerId = g.taggerId || null;
    pendingTaggerId = g.pendingTaggerId || null;
    mode = g.mode || 'tag';
  });
  api.onValue(api.ref(db, 'admin/teams'), (s) => { teams = s.val() || null; });
  api.onValue(api.ref(db, 'admin/command'), (s) => { handleCommand(s.val()); });
  api.onValue(api.ref(db, 'minigame'), (s) => {
    const g = s.val() || null;
    minigame = g && g.type ? { type: g.type, endsAt: g.endsAt } : null;
    tiles = (g && g.tiles) || {};
    meteors = g && g.meteors ? Object.entries(g.meteors).map(([k, v]) => ({ id: k, ...v })) : [];
    if (!minigame && me) me.adminFrozenUntil = 0; // 미니게임 종료 시 부활
  });
  api.onValue(api.ref(db, 'footprints'), (s) => {
    const val = s.val() || {};
    footprints.clear();
    for (const [pid, slots] of Object.entries(val)) {
      footprints.set(pid, Object.values(slots).filter((f) => f && f.ts));
    }
  });

  if (isAdmin) return; // 관리자는 플레이어 노드 없음(관전)

  // 일반 플레이어: 내 노드 생성
  const snap = await api.get(api.ref(db, 'players'));
  const count = (snap.exists() ? Object.keys(snap.val()).length : 0) + 1;
  maze = buildMaze(count);
  const pos = randomOpenPosition(maze);
  const joinedAt = Date.now();
  me = { id, name, color: COLORS[Math.floor(Math.random() * COLORS.length)], x: pos.x, y: pos.y, frozenUntil: 0, adminFrozenUntil: 0, hiddenUntil: 0, joinedAt, facing: 0 };

  fb.myRef = api.ref(db, 'players/' + id);
  await api.set(fb.myRef, { name, color: me.color, x: pos.x, y: pos.y, frozenUntil: 0, adminFrozenUntil: 0, hiddenUntil: 0, facing: 0, joinedAt });
  api.onDisconnect(fb.myRef).remove();
  fb.footRef = api.ref(db, 'footprints/' + id);
  api.onDisconnect(fb.footRef).remove();
  ensureTagger();
}

function writeMe(patch) {
  if (online && fb && fb.myRef) fb.api.update(fb.myRef, patch);
}

// ---------------------------------------------------------------------------
// Tagger 관리 (tag 모드에서만)
// ---------------------------------------------------------------------------
function ensureTagger() {
  if (mode !== 'tag' || isAdmin || !online || !fb || !me) return;
  const allIds = [me.id, ...remotes.keys()];
  const taggerValid = taggerId && allIds.includes(taggerId);
  const pendingValid = pendingTaggerId && allIds.includes(pendingTaggerId);
  if (taggerValid || pendingValid) return;
  const cands = [];
  if (me.frozenUntil <= Date.now()) cands.push({ id: me.id, key: me.joinedAt || me.id });
  remotes.forEach((r, rid) => { if ((r.frozenUntil || 0) <= Date.now()) cands.push({ id: rid, key: r.joinedAt || rid }); });
  if (!cands.length) return;
  cands.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const chosen = cands[0].id;
  fb.api.runTransaction(fb.api.ref(fb.db, 'game/taggerId'), (cur) => {
    if (cur && allIds.includes(cur)) return cur;
    return chosen;
  });
}

// ---------------------------------------------------------------------------
// 액션: 잡기 / 웅크리기
// ---------------------------------------------------------------------------
function doCatch() {
  if (!me || isAdmin || mode !== 'tag') return;
  if (taggerId !== me.id) return;
  if (frozenNow(me)) return;
  const reach = PLAYER_RADIUS * 2 + CATCH_PAD;
  let best = null, bd = Infinity;
  remotes.forEach((r, rid) => {
    if (frozenNow(r)) return;
    const d = Math.hypot(r.x - me.x, r.y - me.y);
    if (d <= reach && d < bd) { bd = d; best = rid; }
  });
  if (best && online && fb) {
    fb.api.update(fb.api.ref(fb.db), {
      ['players/' + best + '/frozenUntil']: Date.now() + FREEZE_MS,
      'game/taggerId': null,
      'game/pendingTaggerId': best,
    });
  }
}
function doCrouch() {
  if (!me || isAdmin) return;
  const now = Date.now();
  if (now < crouchReadyAt) return;     // 쿨타임 중
  if (me.hiddenUntil > now) return;     // 이미 웅크리는 중
  me.hiddenUntil = now + CROUCH_MS;
  crouchReadyAt = now + CROUCH_CD;      // 쿨타임은 발동 시점부터 15초
  writeMe({ hiddenUntil: me.hiddenUntil });
}
function frozenNow(p) {
  const now = Date.now();
  return (p.frozenUntil || 0) > now || (p.adminFrozenUntil || 0) > now;
}

// ---------------------------------------------------------------------------
// 관리자 명령 처리 (일반 클라이언트가 반응)
// ---------------------------------------------------------------------------
function handleCommand(cmd) {
  if (!cmd || !cmd.ts || cmd.ts <= lastCmdTs) return;
  lastCmdTs = cmd.ts;
  if (!me || isAdmin) return;
  const now = Date.now();
  if (cmd.type === 'gather') {
    const p = centerOpenPosition(maze); me.x = p.x; me.y = p.y; writeMe({ x: Math.round(p.x), y: Math.round(p.y) });
  } else if (cmd.type === 'scatter') {
    const p = randomOpenPosition(maze); me.x = p.x; me.y = p.y; writeMe({ x: Math.round(p.x), y: Math.round(p.y) });
  } else if (cmd.type === 'freeze') {
    me.adminFrozenUntil = now + 10 * 60 * 1000; writeMe({ adminFrozenUntil: me.adminFrozenUntil });
  } else if (cmd.type === 'unfreeze' || cmd.type === 'reset') {
    me.adminFrozenUntil = 0; me.frozenUntil = 0; writeMe({ adminFrozenUntil: 0, frozenUntil: 0 });
  }
}

// ---------------------------------------------------------------------------
// 관리자 패널
// ---------------------------------------------------------------------------
function setupAdminPanel() {
  adminPanel.querySelectorAll('[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => adminCmd(btn.dataset.cmd));
  });
  adminPanel.querySelectorAll('[data-mini]').forEach((btn) => {
    btn.addEventListener('click', () => adminMini(btn.dataset.mini));
  });
}
function autoTeams() {
  const ids = [...remotes.keys()].sort();
  const assign = {};
  ids.forEach((id, i) => { assign[id] = i % 2 === 0 ? 'A' : 'B'; });
  return assign;
}
function adminCmd(type) {
  if (!online || !fb) { adminStatusEl.textContent = '오프라인: 명령 불가'; return; }
  const now = Date.now();
  if (type === 'teams') {
    if (teams) { fb.api.set(fb.api.ref(fb.db, 'admin/teams'), null); adminStatusEl.textContent = '팀전 해제'; }
    else { fb.api.set(fb.api.ref(fb.db, 'admin/teams'), autoTeams()); adminStatusEl.textContent = '팀전 시작 (🟥 vs 🟦)'; }
    return;
  }
  if (type === 'reset') {
    fb.api.update(fb.api.ref(fb.db), { 'game/mode': 'tag', 'game/taggerId': null, 'game/pendingTaggerId': null });
    fb.api.set(fb.api.ref(fb.db, 'minigame'), null);
    fb.api.set(fb.api.ref(fb.db, 'admin/teams'), null);
  }
  fb.api.set(fb.api.ref(fb.db, 'admin/command'), { type, ts: now });
  adminStatusEl.textContent = '명령: ' + type;
}
function adminMini(type) {
  if (!online || !fb) { adminStatusEl.textContent = '오프라인: 미니게임 불가'; return; }
  const now = Date.now();
  if (type === 'stop' || type === 'tag') {
    fb.api.set(fb.api.ref(fb.db, 'minigame'), null);
    fb.api.update(fb.api.ref(fb.db), { 'game/mode': 'tag' });
    fb.api.set(fb.api.ref(fb.db, 'admin/command'), { type: 'unfreeze', ts: now });
    adminStatusEl.textContent = type === 'tag' ? '술래잡기 모드' : '미니게임 중지';
    return;
  }
  if (type === 'meteor') {
    fb.api.update(fb.api.ref(fb.db), { 'game/mode': 'meteor' });
    fb.api.set(fb.api.ref(fb.db, 'minigame'), { type: 'meteor', endsAt: now + 45000, meteors: {} });
    adminMeteorId = 0; adminMeteorSpawn = 0;
    adminStatusEl.textContent = '운석 피하기 시작! (45초)';
  } else if (type === 'tiles') {
    if (!teams) fb.api.set(fb.api.ref(fb.db, 'admin/teams'), autoTeams());
    fb.api.update(fb.api.ref(fb.db), { 'game/mode': 'tiles' });
    fb.api.set(fb.api.ref(fb.db, 'minigame'), { type: 'tiles', endsAt: now + 45000, tiles: {} });
    adminStatusEl.textContent = '판 뒤집기 시작! (45초)';
  }
}
function renderPlayerList(val) {
  const ids = Object.keys(val);
  adminCountEl.textContent = ids.length + '명';
  playerListEl.innerHTML = '';
  const now = Date.now();
  for (const id of ids) {
    const p = val[id];
    const row = document.createElement('div');
    row.className = 'player-row';
    const dot = document.createElement('span');
    dot.className = 'player-dot';
    dot.style.background = teams && teams[id] ? (teams[id] === 'A' ? TEAM_A : TEAM_B) : (p.color || '#fff');
    const nm = document.createElement('span');
    nm.className = 'player-name';
    nm.textContent = p.name || id.slice(0, 5);
    const tag = document.createElement('span');
    tag.className = 'player-tag';
    const flags = [];
    if (id === taggerId) flags.push('술래');
    if ((p.hiddenUntil || 0) > now) flags.push('웅크림');
    if ((p.frozenUntil || 0) > now || (p.adminFrozenUntil || 0) > now) flags.push('정지');
    if (teams && teams[id]) flags.push(teams[id] === 'A' ? '🟥' : '🟦');
    tag.textContent = flags.join(' ');
    row.append(dot, nm, tag);
    playerListEl.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// 메인 루프
// ---------------------------------------------------------------------------
let lastFrame = performance.now();
let lastWrite = 0;

function step(now) {
  requestAnimationFrame(step);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  const tnow = Date.now();

  if (isAdmin) { adminTick(dt, tnow); draw(); return; }
  if (!me) { draw(); return; }

  // tag freeze 해제 → 새 술래
  if (online && fb && me.frozenUntil && me.frozenUntil <= tnow && mode === 'tag') {
    me.frozenUntil = 0;
    fb.api.update(fb.api.ref(fb.db), {
      ['players/' + me.id + '/frozenUntil']: 0,
      'game/taggerId': me.id, 'game/pendingTaggerId': null,
    });
  }

  const frozen = frozenNow(me);

  // 이동 + 달리기
  let dx = 0, dy = 0;
  if (input.up) dy -= 1;
  if (input.down) dy += 1;
  if (input.left) dx -= 1;
  if (input.right) dx += 1;
  const moving = (dx || dy) && !frozen;
  const wantRun = input.run && moving && stamina > 0;
  if (wantRun) stamina = Math.max(0, stamina - STA_DRAIN * dt);
  else stamina = Math.min(STA_MAX, stamina + STA_REGEN * dt);
  const speed = wantRun ? RUN : WALK;

  if (moving) {
    const len = Math.hypot(dx, dy);
    me.facing = Math.atan2(dy, dx);
    const mvx = (dx / len) * speed * dt;
    const mvy = (dy / len) * speed * dt;
    if (!circleHitsWall(maze, me.x + mvx, me.y)) me.x += mvx;
    if (!circleHitsWall(maze, me.x, me.y + mvy)) me.y += mvy;
  }

  // 펠릿 먹기
  const cKey = cellKeyAt(me.x, me.y);
  if (cKey >= 0 && !collected.has(cKey) && isPelletCell(cKey)) {
    const cx = (cKey % 1000 + 0.5) * CELL, cy = (Math.floor(cKey / 1000) + 0.5) * CELL;
    if (Math.hypot(me.x - cx, me.y - cy) < PLAYER_RADIUS) { collected.add(cKey); pelletsEaten++; }
  }

  // 웅크리기 + 발자국
  const hidden = me.hiddenUntil > tnow;
  if (hidden && moving && now - lastFootTs > FOOT_INTERVAL) { lastFootTs = now; stampFootprint(me.x, me.y, tnow); }

  // 판 뒤집기: 밟은 칸을 우리 팀 색으로
  if (mode === 'tiles' && online && fb && teams && teams[me.id] && minigame && tnow < minigame.endsAt) {
    if (cKey >= 0 && cKey !== lastTileCell && isPelletCell(cKey)) {
      lastTileCell = cKey;
      if (tiles[cKey] !== teams[me.id]) fb.api.update(fb.api.ref(fb.db, 'minigame/tiles'), { [cKey]: teams[me.id] });
    }
  }

  // 운석 충돌
  if (mode === 'meteor' && minigame && tnow < minigame.endsAt && !frozen) {
    for (const mt of meteors) {
      if (Math.hypot(me.x - mt.x, me.y - mt.y) < (mt.r || 16) + PLAYER_RADIUS) {
        me.adminFrozenUntil = minigame.endsAt; writeMe({ adminFrozenUntil: me.adminFrozenUntil });
        break;
      }
    }
  }

  // 위치 동기화
  if (online && fb && now - lastWrite > 1000 / WRITE_HZ) {
    lastWrite = now;
    fb.api.update(fb.myRef, { x: Math.round(me.x), y: Math.round(me.y), facing: +me.facing.toFixed(2) });
  }

  // 원격 보간
  remotes.forEach((r) => {
    r.dispX += (r.x - r.dispX) * Math.min(1, dt * 12);
    r.dispY += (r.y - r.dispY) * Math.min(1, dt * 12);
  });

  ensureTagger();
  updateHud(tnow);
  draw();
}

// 관리자: 관전 + 운석 시뮬레이션 권한
function adminTick(dt, tnow) {
  remotes.forEach((r) => {
    r.dispX += (r.x - r.dispX) * Math.min(1, dt * 12);
    r.dispY += (r.y - r.dispY) * Math.min(1, dt * 12);
  });
  if (online && fb && minigame && minigame.type === 'meteor') {
    if (tnow >= minigame.endsAt) { adminMini('stop'); return; }
    adminMeteorSpawn += dt;
    const mapW = maze.cols * CELL, mapH = maze.rows * CELL;
    if (adminMeteorSpawn > 0.35) {
      adminMeteorSpawn = 0;
      meteors.push({ id: 'm' + (adminMeteorId++), x: Math.random() * mapW, y: -20, vy: 130 + Math.random() * 160, r: 14 + Math.random() * 12 });
    }
    for (const mt of meteors) mt.y += mt.vy * dt;
    meteors = meteors.filter((mt) => mt.y < mapH + 40);
    if (performance.now() - lastMeteorWrite > 80) {
      lastMeteorWrite = performance.now();
      const obj = {};
      for (const mt of meteors) obj[mt.id] = { x: Math.round(mt.x), y: Math.round(mt.y), r: Math.round(mt.r) };
      fb.api.set(fb.api.ref(fb.db, 'minigame/meteors'), obj);
    }
  }
  if (online && minigame && minigame.type === 'tiles') {
    let a = 0, b = 0;
    for (const v of Object.values(tiles)) { if (v === 'A') a++; else if (v === 'B') b++; }
    const left = Math.max(0, Math.ceil((minigame.endsAt - tnow) / 1000));
    adminStatusEl.textContent = `판 뒤집기 🟥${a} : 🟦${b}  (${left}s)`;
  } else if (online && minigame && minigame.type === 'meteor') {
    let alive = 0;
    remotes.forEach((r) => { if ((r.adminFrozenUntil || 0) <= tnow) alive++; });
    const left = Math.max(0, Math.ceil((minigame.endsAt - tnow) / 1000));
    adminStatusEl.textContent = `운석 피하기 ☄️ 생존 ${alive}명 (${left}s)`;
  }
}

// ---------------------------------------------------------------------------
// 발자국 / 펠릿 헬퍼
// ---------------------------------------------------------------------------
function cellKeyAt(x, y) {
  const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
  if (r < 0 || c < 0 || r >= maze.rows || c >= maze.cols) return -1;
  return r * 1000 + c;
}
function isPelletCell(key) {
  const r = Math.floor(key / 1000), c = key % 1000;
  return maze.grid[r] && maze.grid[r][c] === 0;
}
function stampFootprint(x, y, ts) {
  let arr = footprints.get(me.id);
  if (!arr) { arr = []; footprints.set(me.id, arr); }
  arr.push({ x: Math.round(x), y: Math.round(y), ts });
  while (arr.length > FOOT_SLOTS) arr.shift();
  if (online && fb && fb.footRef) {
    fb.api.update(fb.footRef, { [footSlot]: { x: Math.round(x), y: Math.round(y), ts } });
    footSlot = (footSlot + 1) % FOOT_SLOTS;
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function updateHud(tnow) {
  staFill.style.width = (stamina / STA_MAX * 100) + '%';
  if (me.hiddenUntil > tnow) crouchInfo.textContent = `🫥 웅크리는 중 ${Math.ceil((me.hiddenUntil - tnow) / 1000)}초`;
  else if (tnow < crouchReadyAt) crouchInfo.textContent = `웅크리기 쿨타임 ${Math.ceil((crouchReadyAt - tnow) / 1000)}초`;
  else crouchInfo.textContent = '웅크리기 준비됨 (C)';

  if (minigame && tnow < minigame.endsAt) {
    banner.classList.remove('hidden');
    const left = Math.ceil((minigame.endsAt - tnow) / 1000);
    if (minigame.type === 'meteor') banner.textContent = `☄️ 운석 피하기! ${left}초 ${frozenNow(me) ? '— 💥 탈락' : ''}`;
    else if (minigame.type === 'tiles') {
      let a = 0, b = 0; for (const v of Object.values(tiles)) { if (v === 'A') a++; else if (v === 'B') b++; }
      banner.textContent = `🟥 ${a} : ${b} 🟦  판 뒤집기 ${left}초`;
    }
  } else banner.classList.add('hidden');

  const myTeam = teams && teams[me.id];
  if ((me.adminFrozenUntil || 0) > tnow) statusEl.textContent = mode === 'meteor' ? '💥 운석에 맞아 탈락!' : '❄️ 관리자에 의해 정지됨';
  else if (me.frozenUntil > tnow) statusEl.textContent = `😵 잡혔어요! ${Math.ceil((me.frozenUntil - tnow) / 1000)}초 후 술래`;
  else if (mode === 'tag' && taggerId === me.id) statusEl.textContent = '👹 당신이 술래! 닿은 채 스페이스';
  else if (myTeam) statusEl.textContent = (myTeam === 'A' ? '🟥 레드팀' : '🟦 블루팀');
  else if (mode === 'tag') { const t = remotes.get(taggerId); statusEl.textContent = t ? `🏃 도망쳐요! 술래: ${t.name}` : '🏃 도망쳐요!'; }
  else statusEl.textContent = '🏃';
}

// ---------------------------------------------------------------------------
// 렌더링
// ---------------------------------------------------------------------------
function draw() {
  const W = window.innerWidth, H = window.innerHeight;
  ctx.fillStyle = '#05050f';
  ctx.fillRect(0, 0, W, H);

  let camX, camY, scale;
  if (isAdmin || !me) {
    const mapW = maze.cols * CELL, mapH = maze.rows * CELL;
    scale = Math.min(W / mapW, H / mapH) * 0.96;
    camX = mapW / 2; camY = mapH / 2;
  } else {
    scale = 1; camX = me.x; camY = me.y;
  }
  const toX = (wx) => (wx - camX) * scale + W / 2;
  const toY = (wy) => (wy - camY) * scale + H / 2;
  const s = CELL * scale;
  const tnow = Date.now();

  const minC = Math.max(0, Math.floor((camX - W / 2 / scale) / CELL));
  const maxC = Math.min(maze.cols - 1, Math.ceil((camX + W / 2 / scale) / CELL));
  const minR = Math.max(0, Math.floor((camY - H / 2 / scale) / CELL));
  const maxR = Math.min(maze.rows - 1, Math.ceil((camY + H / 2 / scale) / CELL));
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const x = toX(c * CELL), y = toY(r * CELL);
      if (maze.grid[r][c] === 1) {
        ctx.fillStyle = '#1b1bdb';
        roundRect(ctx, x + 2 * scale, y + 2 * scale, s - 4 * scale, s - 4 * scale, 6 * scale);
        ctx.fill();
        ctx.strokeStyle = '#4a4aff'; ctx.lineWidth = Math.max(1, 2 * scale); ctx.stroke();
      } else {
        const key = r * 1000 + c;
        if (mode === 'tiles' && tiles[key]) {
          ctx.fillStyle = tiles[key] === 'A' ? 'rgba(255,92,92,0.5)' : 'rgba(92,156,255,0.5)';
          ctx.fillRect(x, y, s, s);
        }
        if (mode !== 'tiles' && !collected.has(key)) {
          ctx.fillStyle = '#ffd9a0';
          ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, Math.max(1.5, 2.6 * scale), 0, 7); ctx.fill();
        }
      }
    }
  }

  // 발자국
  footprints.forEach((arr) => {
    for (const f of arr) {
      const age = tnow - f.ts;
      if (age > FOOT_MS) continue;
      ctx.fillStyle = `rgba(220,220,255,${0.5 * (1 - age / FOOT_MS)})`;
      ctx.beginPath(); ctx.arc(toX(f.x), toY(f.y), 4 * scale, 0, 7); ctx.fill();
    }
  });

  // 운석
  if (mode === 'meteor') {
    for (const mt of meteors) {
      const x = toX(mt.x), y = toY(mt.y), rr = (mt.r || 16) * scale;
      ctx.strokeStyle = 'rgba(255,160,60,0.35)'; ctx.lineWidth = rr; ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x, y - rr * 2.2); ctx.stroke();
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, '#fff2c0'); g.addColorStop(0.5, '#ff8c2b'); g.addColorStop(1, '#7a2b00');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.fill();
    }
  }

  // 플레이어
  const list = [];
  remotes.forEach((r, rid) => list.push({ id: rid, name: r.name, color: r.color, x: r.dispX, y: r.dispY, frozenUntil: r.frozenUntil, adminFrozenUntil: r.adminFrozenUntil, hiddenUntil: r.hiddenUntil, facing: r.facing }));
  if (me) list.push({ ...me, self: true });
  for (const p of list) {
    const hidden = (p.hiddenUntil || 0) > tnow;
    if (hidden && !p.self && !isAdmin) continue; // 남에게는 안 보임
    const x = toX(p.x), y = toY(p.y), rr = PLAYER_RADIUS * scale * 1.05;
    const frozen = frozenNow(p);
    const myTeam = teams && teams[p.id];
    let color = myTeam ? (myTeam === 'A' ? TEAM_A : TEAM_B) : (p.color || '#ffd23f');
    if (frozen) color = '#888';
    const isIt = mode === 'tag' && p.id === taggerId;

    ctx.save();
    ctx.globalAlpha = hidden ? 0.32 : 1;
    if (isIt) drawGhost(x, y, rr, '#ff4d4d');
    else drawPacman(x, y, rr, color, p.facing || 0, !frozen);
    ctx.restore();

    if (p.self) { ctx.beginPath(); ctx.arc(x, y, rr + 6 * scale, 0, 7); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    if (frozen && (p.frozenUntil || 0) > tnow) {
      ctx.fillStyle = '#fff'; ctx.font = `bold ${14 * scale}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(Math.ceil((p.frozenUntil - tnow) / 1000), x, y);
    }
    ctx.fillStyle = hidden ? 'rgba(255,255,255,0.5)' : '#fff';
    ctx.font = `${12 * scale}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText((isIt ? '👹 ' : '') + (p.name || ''), x, y - rr - 4 * scale);
  }
}

function drawPacman(x, y, r, color, facing, moving) {
  const open = moving ? (0.06 + 0.22 * Math.abs(Math.sin(Date.now() / 90))) : 0.05;
  const m = open * Math.PI;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, r, facing + m, facing - m + Math.PI * 2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#222';
  const ex = x + Math.cos(facing - Math.PI / 2) * r * 0.4;
  const ey = y + Math.sin(facing - Math.PI / 2) * r * 0.4;
  ctx.beginPath(); ctx.arc(ex, ey, Math.max(1, r * 0.12), 0, 7); ctx.fill();
}
function drawGhost(x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y - r * 0.1, r, Math.PI, 0);
  ctx.lineTo(x + r, y + r * 0.7);
  const n = 4;
  for (let i = 0; i < n; i++) {
    const x1 = x + r - (2 * r) * (i + 0.5) / n;
    const x2 = x + r - (2 * r) * (i + 1) / n;
    ctx.lineTo(x1, y + r * 0.45);
    ctx.lineTo(x2, y + r * 0.7);
  }
  ctx.closePath(); ctx.fill();
  for (const sx of [-0.38, 0.38]) {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + sx * r, y - r * 0.1, r * 0.28, 0, 7); ctx.fill();
    ctx.fillStyle = '#0033aa'; ctx.beginPath(); ctx.arc(x + sx * r + r * 0.1, y - r * 0.1, r * 0.13, 0, 7); ctx.fill();
  }
}
function roundRect(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

requestAnimationFrame(step);
