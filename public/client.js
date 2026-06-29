'use strict';

// ----------------------------------------------------------------------------
// DOM
// ----------------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const menu = document.getElementById('menu');
const nameInput = document.getElementById('nameInput');
const joinBtn = document.getElementById('joinBtn');
const hud = document.getElementById('hud');
const statusEl = document.getElementById('status');
const touch = document.getElementById('touch');

// ----------------------------------------------------------------------------
// State
// ----------------------------------------------------------------------------
let ws = null;
let myId = null;
let cell = 40;
let map = null; // { cols, rows, grid }
let players = [];

const input = { up: false, down: false, left: false, right: false };
let lastSent = '';

// ----------------------------------------------------------------------------
// Canvas sizing
// ----------------------------------------------------------------------------
function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ----------------------------------------------------------------------------
// Networking
// ----------------------------------------------------------------------------
function connect(name) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name }));

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.t === 'init') {
      myId = msg.id;
      cell = msg.cell;
    } else if (msg.t === 'map') {
      cell = msg.cell;
      map = { cols: msg.cols, rows: msg.rows, grid: msg.grid };
    } else if (msg.t === 'state') {
      players = msg.players;
    }
  };

  ws.onclose = () => {
    statusEl.textContent = '연결이 끊겼습니다. 새로고침 해주세요.';
  };
}

function sendInput() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const key = `${input.up}${input.down}${input.left}${input.right}`;
  if (key === lastSent) return;
  lastSent = key;
  ws.send(JSON.stringify({ t: 'input', ...input }));
}

function sendCatch() {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'catch' }));
}

// ----------------------------------------------------------------------------
// Input: keyboard
// ----------------------------------------------------------------------------
const keyMap = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    sendCatch();
    return;
  }
  const dir = keyMap[e.code];
  if (dir) {
    e.preventDefault();
    input[dir] = true;
    sendInput();
  }
});
window.addEventListener('keyup', (e) => {
  const dir = keyMap[e.code];
  if (dir) {
    input[dir] = false;
    sendInput();
  }
});

// ----------------------------------------------------------------------------
// Input: touch
// ----------------------------------------------------------------------------
function bindTouchButton(el, dir) {
  const on = (e) => { e.preventDefault(); input[dir] = true; sendInput(); };
  const off = (e) => { e.preventDefault(); input[dir] = false; sendInput(); };
  el.addEventListener('touchstart', on, { passive: false });
  el.addEventListener('touchend', off, { passive: false });
  el.addEventListener('touchcancel', off, { passive: false });
  el.addEventListener('mousedown', on);
  el.addEventListener('mouseup', off);
  el.addEventListener('mouseleave', off);
}
document.querySelectorAll('.dpad').forEach((el) => bindTouchButton(el, el.dataset.dir));
document.getElementById('catchBtn').addEventListener('touchstart', (e) => { e.preventDefault(); sendCatch(); }, { passive: false });
document.getElementById('catchBtn').addEventListener('mousedown', (e) => { e.preventDefault(); sendCatch(); });

// ----------------------------------------------------------------------------
// Join
// ----------------------------------------------------------------------------
function startGame() {
  const name = (nameInput.value || '').trim() || 'Player';
  connect(name);
  menu.classList.add('hidden');
  hud.classList.remove('hidden');
  if ('ontouchstart' in window) touch.classList.remove('hidden');
}
joinBtn.addEventListener('click', startGame);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); });

// ----------------------------------------------------------------------------
// Rendering
// ----------------------------------------------------------------------------
function render() {
  requestAnimationFrame(render);
  const W = window.innerWidth;
  const H = window.innerHeight;
  ctx.fillStyle = '#05050f';
  ctx.fillRect(0, 0, W, H);

  if (!map) return;

  const me = players.find((p) => p.id === myId);
  const camX = me ? me.x : (map.cols * cell) / 2;
  const camY = me ? me.y : (map.rows * cell) / 2;
  const offX = W / 2 - camX;
  const offY = H / 2 - camY;

  // Walls (Pac-Man blue blocks), only those on screen.
  const minC = Math.max(0, Math.floor((-offX) / cell));
  const maxC = Math.min(map.cols - 1, Math.floor((W - offX) / cell));
  const minR = Math.max(0, Math.floor((-offY) / cell));
  const maxR = Math.min(map.rows - 1, Math.floor((H - offY) / cell));
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (map.grid[r][c] !== 1) continue;
      const x = c * cell + offX;
      const y = r * cell + offY;
      ctx.fillStyle = '#1b1bdb';
      roundRect(ctx, x + 2, y + 2, cell - 4, cell - 4, 6);
      ctx.fill();
      ctx.strokeStyle = '#5b5bff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Players
  for (const p of players) {
    const x = p.x + offX;
    const y = p.y + offY;
    const radius = cell * 0.35;

    // Body
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = p.freeze > 0 ? '#888' : p.color;
    ctx.fill();

    // Tagger ring
    if (p.isIt) {
      ctx.beginPath();
      ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff3b3b';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    // Highlight self
    if (p.id === myId) {
      ctx.beginPath();
      ctx.arc(x, y, radius + 9, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Freeze countdown
    if (p.freeze > 0) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.freeze, x, y);
    }

    // Name + crown for tagger
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText((p.isIt ? '👹 ' : '') + p.name, x, y - radius - 6);
  }

  // HUD status
  if (me) {
    if (me.freeze > 0) {
      statusEl.textContent = `😵 잡혔어요! ${me.freeze}초 후 술래가 됩니다`;
    } else if (me.isIt) {
      statusEl.textContent = '👹 당신이 술래! 닿은 채로 스페이스/CATCH';
    } else {
      const it = players.find((p) => p.isIt);
      statusEl.textContent = it ? `🏃 도망쳐요! 술래: ${it.name}` : '🏃 도망쳐요!';
    }
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

render();
