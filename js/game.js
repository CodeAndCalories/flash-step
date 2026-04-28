import { state } from './state.js';
import { settings } from './settings.js';
import { getAudio, playShutter, playFootstep, playHeartbeat, playCatch, playWin, playPickup, playEmpty, playScreech, startAmbient, stopAmbient, startExitHum, stopExitHum, updateExitHum } from './audio.js';
import { genMaze, bfs, shuf, findDeadEnds } from './maze.js';
import { draw } from './renderer.js';
import { stepEnemy, checkEnd, isWall } from './enemy.js';

const MOVE_SPD = 3.2;
const TURN_SPD = 2.5;

function resize() {
  state.W = state.canvas.width  = window.innerWidth;
  state.H = state.canvas.height = window.innerHeight;
}

function initGame() {
  resize();
  const sz = Math.min(9 + state.level * 2, 23);
  const s  = sz % 2 === 0 ? sz + 1 : sz;
  const { g, cols, rows } = genMaze(s, s);
  state.MAP = g; state.COLS = cols; state.ROWS = rows;

  state.P.x = 1.5; state.P.y = 1.5; state.P.angle = Math.PI * 0.15;

  const gc = cols - 2, gr = rows - 2;
  state.MAP[gr][gc] = 2;

  // Spawn enemy maximising min(distFromPlayer, distFromGoal)
  const pass = (c, r) => state.MAP[r][c] !== 1;
  const dp = bfs(pass, cols, rows, 1,  1);
  const dg = bfs(pass, cols, rows, gc, gr);

  let best = -1, cands = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (state.MAP[r][c] === 1 || (c === 1 && r === 1) || (c === gc && r === gr)) continue;
    const score = Math.min(dp[r][c] < 0 ? 0 : dp[r][c], dg[r][c] < 0 ? 0 : dg[r][c]);
    if (score > best) { best = score; cands = []; }
    if (score === best) cands.push([c, r]);
  }
  shuf(cands);
  const [ec, er] = cands[Math.random() * Math.min(cands.length, Math.max(1, cands.length * 0.2)) | 0];
  state.E.x = ec + 0.5; state.E.y = er + 0.5; state.E.moveTimer = 0;

  state.ENEMY_MS = Math.max(1100 - state.level * 80, 420);

  // Spawn battery pickups on random open floor cells
  const numBatteries = Math.min(3 + Math.floor(state.level / 2), 7);
  const exclude = new Set([`1,1`, `${gc},${gr}`, `${ec | 0},${er | 0}`]);
  const openCells = [];
  for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++)
    if (state.MAP[r][c] === 0 && !exclude.has(`${c},${r}`)) openCells.push([c, r]);
  shuf(openCells);
  state.batteries = openCells.slice(0, numBatteries).map(([c, r]) => ({ x: c + 0.5, y: r + 0.5 }));

  // Place decoy eyes in dead ends far from the player start
  const deadEnds = findDeadEnds(state.MAP, cols, rows);
  const numDecoys = Math.min(2 + Math.floor(state.level / 3), 5);
  shuf(deadEnds);
  state.decoys = deadEnds
    .filter(([c, r]) => (c - 1) ** 2 + (r - 1) ** 2 > 9)
    .slice(0, numDecoys)
    .map(([c, r]) => ({ x: c + 0.5, y: r + 0.5, phase: Math.random() * Math.PI * 2 }));

  state.flashCount = 8; state.flashHeld = false; state.flashAlpha = 0;
  state.flashDecay = 0; state.outlineAlpha = 0; state.flashHeldMs = 0;
  state.bobTimer = 0; state.isMoving = false; state.footstepTimer = 0;
  state.heartbeatTimer = 0; state.shakeX = 0; state.shakeY = 0; state.shakeAmt = 0;
  state.firstFlashDone = false; state.minimapTimer = 0; state.jumpScareTimer = 0;
  state.crumbs = [];
  updateUI();
}

function loop(ts) {
  const dt = Math.min(ts - state.lastTime, 50);
  state.lastTime = ts;

  // Keep rendering the jump scare even after gameState changes to 'dead'
  if (state.jumpScareTimer > 0) {
    state.jumpScareTimer = Math.max(0, state.jumpScareTimer - dt / 220);
    const { ctx, W, H } = state;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    draw(0, 0, 0);
    state.frameId = requestAnimationFrame(loop);
    return;
  }

  if (state.gameState !== 'playing') { state.frameId = requestAnimationFrame(loop); return; }

  // Flash — two-stage fade
  if (state.flashHeld) {
    state.flashAlpha  = Math.min(1, state.flashAlpha + dt / 28);
    state.flashDecay  = state.flashAlpha;
    state.flashHeldMs += dt;
    state.outlineAlpha = 1;
  } else {
    state.flashAlpha  = Math.max(0, state.flashAlpha - dt * settings.flashFade / 120);
    state.flashDecay  = Math.max(0, state.flashDecay - dt * settings.flashFade / 52);
    // Outline lingers: longer you held, longer it stays (0.5 s base + up to 5 s extra)
    const lingerMs = 500 + Math.min(state.flashHeldMs * 3, 5000);
    state.outlineAlpha = Math.max(0, state.outlineAlpha - dt / lingerMs);
    state.flashHeldMs  = 0;
  }

  // Movement
  const { keys, dpad, P } = state;
  const fwd = (keys['w'] || keys['arrowup']    || dpad.fwd   ? 1 : 0)
            - (keys['s'] || keys['arrowdown']  || dpad.back  ? 1 : 0);
  const trn = (keys['d'] || keys['arrowright'] || dpad.turnR ? 1 : 0)
            - (keys['a'] || keys['arrowleft']  || dpad.turnL ? 1 : 0)
            + state.lookDelta * 0.011;
  state.lookDelta *= 0.62;
  P.angle += trn * TURN_SPD * dt / 1000;

  state.isMoving = false;
  if (fwd !== 0) {
    const spd = MOVE_SPD * dt / 1000;
    const nx = P.x + Math.cos(P.angle) * spd * fwd;
    const ny = P.y + Math.sin(P.angle) * spd * fwd;
    if (!isWall(nx, P.y)) P.x = nx;
    if (!isWall(P.x, ny)) P.y = ny;
    state.bobTimer    += dt * 0.009;
    state.isMoving     = true;
    state.footstepTimer -= dt;
    if (state.footstepTimer <= 0) { playFootstep(); state.footstepTimer = 370; }
    // Record breadcrumb every ~0.35 world units of travel
    const last = state.crumbs[state.crumbs.length - 1];
    if (!last || (P.x - last.x) ** 2 + (P.y - last.y) ** 2 > 0.12) {
      if (state.crumbs.length >= 250) state.crumbs.shift();
      state.crumbs.push({ x: P.x, y: P.y });
    }
  } else {
    state.footstepTimer = 0;
  }

  // Battery collection
  state.batteries = state.batteries.filter(b => {
    const dx = state.P.x - b.x, dy = state.P.y - b.y;
    if (dx * dx + dy * dy < 0.36) {
      state.flashCount = Math.min(state.flashCount + 3, 12);
      playPickup();
      return false;
    }
    return true;
  });

  // Enemy moves only while flash is on
  if (state.flashAlpha > 0.04) {
    if (!state.firstFlashDone) { state.firstFlashDone = true; state.minimapTimer = 4; }
    state.E.moveTimer += dt;
    while (state.E.moveTimer >= state.ENEMY_MS) { state.E.moveTimer -= state.ENEMY_MS; stepEnemy(); }
  }
  if (state.minimapTimer > 0) state.minimapTimer -= dt / 1000;

  // Heartbeat — rate scales with proximity
  const pd = Math.sqrt((P.x - state.E.x) ** 2 + (P.y - state.E.y) ** 2);
  const hbRate = pd < 2 ? 3.2 : pd < 3.5 ? 2.2 : pd < 6 ? 1.4 : 0;
  if (hbRate > 0) {
    state.heartbeatTimer -= dt;
    if (state.heartbeatTimer <= 0) { playHeartbeat(hbRate); state.heartbeatTimer = Math.max(280, 950 / hbRate); }
  } else {
    state.heartbeatTimer = 0;
  }

  const result = checkEnd();
  if (result) {
    state.gameState = result; state.flashHeld = false;
    stopAmbient(); stopExitHum();
    if (result === 'dead') {
      state.jumpScareTimer = 1.0;
      if (settings.screenshake) {
        state.shakeX = (Math.random() - 0.5) * 18;
        state.shakeY = (Math.random() - 0.5) * 18;
        state.shakeAmt = 1;
      }
      playScreech();
      setTimeout(playCatch, 320);
    } else {
      playWin();
    }
    setTimeout(() => showMsg(result), result === 'dead' ? 600 : 480);
  }

  // Exit hum — distance + bearing to goal
  const gdx = (state.COLS - 1.5) - P.x, gdy = (state.ROWS - 1.5) - P.y;
  let gang = Math.atan2(gdy, gdx) - P.angle;
  while (gang >  Math.PI) gang -= Math.PI * 2;
  while (gang < -Math.PI) gang += Math.PI * 2;
  updateExitHum(Math.sqrt(gdx * gdx + gdy * gdy), Math.sin(gang) * 0.6);

  updateUI();
  const bob = state.isMoving ? Math.sin(state.bobTimer) * 0.036 : 0;
  draw(state.flashAlpha > 0 ? state.flashAlpha : state.flashDecay * 0.32, bob, state.outlineAlpha);
  state.frameId = requestAnimationFrame(loop);
}

function updateUI() {
  const flashEl = document.getElementById('s-flash');
  flashEl.innerHTML = `FLASHES<br>${state.flashCount}`;
  flashEl.classList.toggle('low-battery', state.flashCount <= 2 && state.gameState === 'playing');
  document.getElementById('s-level').textContent = `LEVEL ${state.level}`;
  const dx = state.P.x - (state.COLS - 1.5), dy = state.P.y - (state.ROWS - 1.5);
  document.getElementById('s-dist').innerHTML = `DIST<br>${state.gameState === 'playing' ? Math.round(Math.sqrt(dx * dx + dy * dy)) : '—'}`;
  const sm = document.getElementById('s-moving');
  if (sm) sm.style.opacity = state.isMoving ? '1' : '0';
}

function showMsg(type) {
  const el = document.getElementById('msgscreen');
  el.className = type;
  el.querySelector('.msg-title').textContent = type === 'dead' ? 'CAUGHT' : 'ESCAPED';
  el.querySelector('.msg-sub').textContent   = type === 'dead' ? 'IT WAS WAITING FOR YOU' : `LEVEL ${state.level} COMPLETE`;
  el.querySelector('.msg-info').textContent  = `BATTERIES LEFT: ${state.flashCount}  ·  LEVEL ${state.level}`;
  el.classList.add('show');
  document.getElementById('retry-btn').textContent = type === 'win' ? 'NEXT LEVEL' : 'TRY AGAIN';
  if (type === 'win') state.level++;
}

// ── Bootstrap — must run before event listeners reference state.canvas ────────
state.canvas = document.getElementById('c');
state.ctx    = state.canvas.getContext('2d');
resize();
state.ctx.fillStyle = '#000';
state.ctx.fillRect(0, 0, state.W, state.H);

// ── Controls ──────────────────────────────────────────────────────────────────

function startFlash() {
  if (state.gameState !== 'playing') return;
  if (state.flashCount <= 0) { playEmpty(); return; }
  if (!state.flashHeld) { state.flashCount--; playShutter(); }
  state.flashHeld = true;
}
function stopFlash() { state.flashHeld = false; }

document.addEventListener('keydown', e => {
  state.keys[e.key.toLowerCase()] = true;
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault();
  if (e.key === ' ') startFlash();
});
document.addEventListener('keyup', e => {
  state.keys[e.key.toLowerCase()] = false;
  if (e.key === ' ') stopFlash();
});

const fb = document.getElementById('flash-btn');
fb.addEventListener('touchstart', e => { e.preventDefault(); startFlash(); fb.classList.add('active'); },    { passive: false });
fb.addEventListener('touchend',   e => { e.preventDefault(); stopFlash();  fb.classList.remove('active'); }, { passive: false });
fb.addEventListener('mousedown',  () => startFlash());
fb.addEventListener('mouseup',    () => stopFlash());

function dBtn(id, key) {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener('touchstart', e => { e.preventDefault(); state.dpad[key] = true;  el.classList.add('pressed'); },    { passive: false });
  el.addEventListener('touchend',   e => { e.preventDefault(); state.dpad[key] = false; el.classList.remove('pressed'); }, { passive: false });
  el.addEventListener('mousedown',  () => { state.dpad[key] = true;  el.classList.add('pressed'); });
  document.addEventListener('mouseup', () => { state.dpad[key] = false; el.classList.remove('pressed'); });
}
dBtn('b-fwd',   'fwd');
dBtn('b-back',  'back');
dBtn('b-turnL', 'turnL');
dBtn('b-turnR', 'turnR');

// Swipe-to-look on the canvas centre strip
state.canvas.addEventListener('touchstart', e => {
  for (const t of e.changedTouches)
    if (!state.lookStart && t.clientX > state.W * 0.3 && t.clientX < state.W * 0.7)
      state.lookStart = { id: t.identifier, x: t.clientX };
}, { passive: true });
state.canvas.addEventListener('touchmove', e => {
  for (const t of e.changedTouches)
    if (state.lookStart && t.identifier === state.lookStart.id) {
      state.lookDelta += (t.clientX - state.lookStart.x) * 0.55;
      state.lookStart.x = t.clientX;
    }
}, { passive: true });
state.canvas.addEventListener('touchend', e => {
  for (const t of e.changedTouches)
    if (state.lookStart && t.identifier === state.lookStart.id) state.lookStart = null;
}, { passive: true });
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
window.addEventListener('resize', resize);

document.getElementById('start-btn').addEventListener('click', () => {
  state.level = 1; getAudio();
  document.getElementById('menu').classList.add('hidden');
  initGame(); state.gameState = 'playing'; state.lastTime = performance.now();
  startAmbient(); startExitHum();
  state.frameId = requestAnimationFrame(loop);
});

document.getElementById('retry-btn').addEventListener('click', () => {
  document.getElementById('msgscreen').classList.remove('show');
  initGame(); state.gameState = 'playing'; state.lastTime = performance.now();
  startAmbient(); startExitHum();
});

