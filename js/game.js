import { state } from './state.js';
import { settings, saveSettings } from './settings.js';
import { getAudio, playShutter, playFootstep, playHeartbeat, playCatch, playWin, playPickup, playEmpty, playScreech, startAmbient, stopAmbient, startExitHum, stopExitHum, updateExitHum, suspendAudio, resumeAudio, setMasterVolume, playPanicWarning, updatePanicAudio, resetPanicAudio, playMimicPulse, playPaperRustle, playBatScreech, playRatSkitter, playWebStick, playBlindClick, playCursedFlash } from './audio.js';
import { genMaze, bfs, shuf, findDeadEnds } from './maze.js';
import { draw, loadSprites } from './renderer.js';
import { stepEnemy, stepMimic, stepBlindOne, stepEntity, checkEnd, isWall } from './enemy.js';

const NOTE_TEXTS = [
  "I dropped my torch. I can still hear it rolling.",
  "Something moved when the flash went off. I told myself it was my shadow.",
  "It's learning. It waited exactly where I stopped last time.",
  "I found someone else's footprints. They stopped in the middle of the corridor.",
  "It doesn't have eyes. I don't know how it finds me.",
  "I've started seeing myself in the walls. I don't think that's me anymore.",
  "There are two of them now. One follows my steps. One follows my mistakes.",
  "The flash is changing. Sometimes it comes out wrong. Red.",
  "I found the exit once. It wasn't where it should have been.",
  "I think I've been here before. I think I am the thing they're running from.",
];
function getNoteText(lvl) {
  const idx = (lvl - 1) % NOTE_TEXTS.length;
  return lvl > NOTE_TEXTS.length ? `[Page ${lvl}]\n${NOTE_TEXTS[idx]}` : NOTE_TEXTS[idx];
}

// ── Level type cycle ──────────────────────────────────────────────────────────
// Levels 1-2: always HUNT. From level 3: 4-step cycle ECHO→SILENCE→GAUNTLET→HUNT.
// Each completed cycle (every 4 levels) adds 8 % enemy speed and +2 maze cells.
const CYCLE_TYPES = ['ECHO', 'SILENCE', 'GAUNTLET', 'HUNT'];
const TYPE_SUBS   = {
  HUNT:     'STALKER ONLY · SMALL MAZE',
  ECHO:     'MIMIC ONLY · LARGE MAZE',
  SILENCE:  'BLIND ONE · NO HEARTBEAT',
  GAUNTLET: 'ALL ENEMIES',
};
const FLAVOR_TEXT = {
  HUNT:     "It knows you're here.",
  ECHO:     "It remembers your path.",
  SILENCE:  "Don't make a sound.",
  GAUNTLET: "They're all here.",
};
const DEATH_MSGS = {
  stalker:       { title: 'FOUND',      sub: 'It never stopped moving.' },
  mimic:         { title: 'ECHOED',     sub: 'You led it right to yourself.' },
  blindone:      { title: 'HEARD',      sub: 'You should have stayed still.' },
  cursed:        { title: 'BETRAYED',   sub: 'The camera chose its side.' },
  extra_stalker: { title: 'SURROUNDED', sub: 'There were too many.' },
};
const TYPE_MAZE_MOD = { HUNT: -4, ECHO: 4, SILENCE: 0, GAUNTLET: 0 };

function getLevelInfo(level) {
  if (level <= 2) return { type: 'HUNT', cycle: 0 };
  const cycle = Math.floor((level - 3) / 4) + 1;  // 1, 1, 1, 1, 2, 2, ...
  const idx   = (level - 3) % 4;                   // 0=ECHO 1=SILENCE 2=GAUNTLET 3=HUNT
  return { type: CYCLE_TYPES[idx], cycle };
}

const MOVE_SPD   = 3.2;
const TURN_SPD   = 2.5;
const MOUSE_SENS = 0.003;
let   mouseDeltaX = 0;

function resize() {
  state.W = state.canvas.width  = window.innerWidth;
  state.H = state.canvas.height = window.innerHeight;
}

function initGame() {
  resize();
  const { type, cycle }  = getLevelInfo(state.level);
  state.levelType         = type;
  const useStalker        = type === 'HUNT' || type === 'GAUNTLET';
  const useBlind          = type === 'SILENCE' || type === 'GAUNTLET';
  const cycleBonus        = Math.max(0, cycle - 1) * 2;
  const sz = Math.max(9, Math.min(9 + state.level * 2 + cycleBonus + TYPE_MAZE_MOD[type], 35));
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
  // Stalker active only in HUNT and GAUNTLET
  state.E.active    = useStalker;
  state.E.x         = useStalker ? ec + 0.5 : -5;
  state.E.y         = useStalker ? er + 0.5 : -5;
  state.E.moveTimer = 0;

  // Speed: 5 % per level after 3, plus 8 % per completed cycle
  const lvlMult     = state.level > 3 ? Math.pow(0.95, state.level - 3) : 1.0;
  const cycleMult   = cycle > 0 ? Math.pow(0.92, Math.max(0, cycle - 1)) : 1.0;
  state.ENEMY_MS    = Math.max(150, Math.round((1100 - state.level * 80) * lvlMult * cycleMult));
  state.baseEnemyMS = state.ENEMY_MS;

  // Battery pickups — not spawned on levels 1-3 (unlimited flash)
  const numBatteries = state.level >= 4 ? Math.min(3 + Math.floor(state.level / 2), 7) : 0;
  const exclude = new Set([`1,1`, `${gc},${gr}`, `${ec | 0},${er | 0}`]);
  const openCells = [];
  for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++)
    if (state.MAP[r][c] === 0 && !exclude.has(`${c},${r}`)) openCells.push([c, r]);
  shuf(openCells);
  state.batteries = openCells.slice(0, numBatteries).map(([c, r]) => ({ x: c + 0.5, y: r + 0.5 }));

  // Note + webs (cells not already used for batteries)
  const restCells = openCells.slice(numBatteries);
  shuf(restCells);
  state.note = restCells.length > 0 ? { x: restCells[0][0] + 0.5, y: restCells[0][1] + 0.5 } : null;
  state.webs = restCells.slice(1, 4).map(([c, r]) => ({ x: c + 0.5, y: r + 0.5, hit: false }));

  // Blind One — spawn at cell farthest from Stalker's reference position
  if (useBlind) {
    const bpass = (c, r) => state.MAP[r][c] !== 1;
    const bdm = bfs(bpass, cols, rows, ec | 0, er | 0);
    let bbest = -1, bcands = [];
    for (let r2 = 1; r2 < rows - 1; r2++) for (let c2 = 1; c2 < cols - 1; c2++) {
      if (state.MAP[r2][c2] !== 0) continue;
      const d = bdm[r2][c2];
      if (d > bbest) { bbest = d; bcands = []; }
      if (d === bbest) bcands.push([c2, r2]);
    }
    shuf(bcands);
    const [bc2, br2] = bcands[0] || [cols - 2, rows - 2];
    state.B = { x: bc2 + 0.5, y: br2 + 0.5, active: true, moveTimer: 0, lostTimer: 0 };
  } else {
    state.B = { x: 0, y: 0, active: false, moveTimer: 0, lostTimer: 0 };
  }

  // Extra stalkers — GAUNTLET only, level 9+
  state.extraStalkers  = [];
  state.extraSpawnTimer = (state.level >= 9 && type === 'GAUNTLET') ? 45000 : 0;

  // Place decoy eyes in dead ends far from the player start
  const deadEnds = findDeadEnds(state.MAP, cols, rows);
  const numDecoys = Math.min(2 + Math.floor(state.level / 3), 5);
  shuf(deadEnds);
  state.decoys = deadEnds
    .filter(([c, r]) => (c - 1) ** 2 + (r - 1) ** 2 > 9)
    .slice(0, numDecoys)
    .map(([c, r]) => ({ x: c + 0.5, y: r + 0.5, phase: Math.random() * Math.PI * 2 }));

  // Levels 1-3: unlimited flash (Infinity lets battery checks short-circuit naturally)
  state.flashCount = state.level <= 3 ? Infinity : 8;
  state.flashHeld = false; state.flashAlpha = 0;
  state.flashDecay = 0; state.outlineAlpha = 0; state.flashHeldMs = 0;
  state.bobTimer = 0; state.isMoving = false; state.footstepTimer = 0;
  state.heartbeatTimer = 0; state.shakeX = 0; state.shakeY = 0; state.shakeAmt = 0;
  state.firstFlashDone  = false; state.minimapTimer = 0; state.jumpScareTimer = 0;
  state.crumbs          = [];
  state.flashDrainCount = 0;
  state.panicLevel      = 0; state.panicDecayTimer = 0;
  state.playerHistory   = []; state.historyTimer = 0;
  state.M               = { x: 1.5, y: 1.5, active: false, moveTimer: 0 };
  state.mimicSoundTimer  = 0;
  state.afterimages     = []; state.lastKnownE = null; state.lastKnownM = null; state.lastKnownB = null;
  state.killedBy        = null;
  state.lastHeardPos    = null; state.blindSoundTimer = 0;
  state.noteCollected   = false; state.noteDisplay = null;
  state.batCooldown     = 5000; state.bat = null; state.rat = null;
  state.lastPlayerCell  = { c: 1, r: 1 }; state.webEffect = null;
  state.stamina         = 1.0;  state.sprinting = false;
  state.cursedFlash     = false; state.cursedTimer = 0; state.cursedBurnCount = 0;
  state.cursedDrainAccum = 0;   state.cursedEnemyTimer = 0;
  state.spawnWarning         = null;
  state.flashTooltipTimer    = state.level === 1 ? 6000 : 0;
  state.limitedWarningTimer  = state.level === 4 ? 3000 : 0;
  resetPanicAudio();
  showLevelIntro();
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

  if (state.paused)                  { state.frameId = requestAnimationFrame(loop); return; }
  if (state.gameState !== 'playing') { state.frameId = requestAnimationFrame(loop); return; }

  const prevFlashHeld = state.flashHeld;

  // Flash — two-stage fade + hold drain + panic escalation
  if (state.flashHeld) {
    state.flashAlpha   = Math.min(1, state.flashAlpha + dt / 28);
    state.flashDecay   = state.flashAlpha;
    state.flashHeldMs += dt;
    state.outlineAlpha = 1;

    // Panic escalation
    if (state.flashHeld) {
      if (state.panicLevel < 1 && state.flashHeldMs >= 3000) {
        state.panicLevel = 1;
        state.ENEMY_MS   = Math.max(150, state.baseEnemyMS / 2);
        playPanicWarning();
      }
      if (state.panicLevel < 2 && state.flashHeldMs >= 4000) {
        state.panicLevel = 2;
        state.ENEMY_MS   = Math.max(150, state.baseEnemyMS / 3);
      }
      if (state.panicLevel < 3 && state.flashHeldMs >= 5000) {
        state.panicLevel = 3;
        state.ENEMY_MS   = 150;
      }
    }
  } else {
    state.flashAlpha  = Math.max(0, state.flashAlpha - dt * settings.flashFade / 120);
    state.flashDecay  = Math.max(0, state.flashDecay - dt * settings.flashFade / 52);
    const lingerMs    = 500 + Math.min(state.flashHeldMs * 3, 5000);
    state.outlineAlpha = Math.max(0, state.outlineAlpha - dt / lingerMs);
    state.flashHeldMs  = 0;

    // Panic decay: speed recovers over 3 s after releasing flash
    if (state.panicLevel > 0) {
      state.panicDecayTimer += dt;
      if (state.panicDecayTimer >= 3000) {
        state.panicLevel      = 0;
        state.panicDecayTimer = 0;
        state.ENEMY_MS        = state.baseEnemyMS;
        resetPanicAudio();
      } else if (state.panicDecayTimer > 1000) {
        // Smooth speed interpolation back to normal over the last 2 s
        const t      = (state.panicDecayTimer - 1000) / 2000;
        const peakMS = state.panicLevel >= 3 ? 150
                     : state.panicLevel === 2 ? Math.max(150, state.baseEnemyMS / 3)
                     :                          Math.max(150, state.baseEnemyMS / 2);
        state.ENEMY_MS = peakMS + (state.baseEnemyMS - peakMS) * t;
      }
    }
  }

  // Cursed flash override — strobes uncontrollably, enemies max speed
  if (state.cursedFlash) {
    state.cursedTimer -= dt;
    state.flashHeld    = true;
    // Strobe at ~4 Hz (125 ms per half-cycle)
    state.flashAlpha   = Math.floor(Date.now() / 125) % 2 ? 0.92 : 0.04;
    state.flashDecay   = state.flashAlpha;
    state.outlineAlpha = 1;
    state.ENEMY_MS     = 150;
    // Extra stamina drain (3× rate)
    state.stamina = Math.max(0, state.stamina - dt * 2 / 4000);
    // 3 battery drains over duration (~1 per 3.3 s)
    state.cursedDrainAccum += dt;
    while (state.cursedDrainAccum >= 3333) {
      state.cursedDrainAccum -= 3333;
      state.flashCount = Math.max(0, state.flashCount - 1);
    }
    if (state.cursedTimer <= 0) {
      state.cursedFlash     = false;
      state.flashHeld       = false;
      state.flashAlpha      = 0;
      state.flashDecay      = 0;
      state.cursedBurnCount = 3;
      state.cursedEnemyTimer = 3000;
    }
  }
  // Post-cursed: enemies stay fast for 3 s then return to base speed
  if (!state.cursedFlash && state.cursedEnemyTimer > 0) {
    state.cursedEnemyTimer -= dt;
    state.ENEMY_MS = state.cursedEnemyTimer > 0 ? 150 : state.baseEnemyMS;
  }

  // Snapshot all visible enemies on flash release → afterimages (no eyes, with grain)
  if (prevFlashHeld && !state.flashHeld) {
    if (state.lastKnownE) { state.afterimages.push({ ...state.lastKnownE, alpha: 0.12, maxAlpha: 0.12 }); state.lastKnownE = null; }
    if (state.lastKnownM) { state.afterimages.push({ ...state.lastKnownM, alpha: 0.08, maxAlpha: 0.08 }); state.lastKnownM = null; }
    if (state.lastKnownB) { state.afterimages.push({ ...state.lastKnownB, alpha: 0.10, maxAlpha: 0.10 }); state.lastKnownB = null; }
  }

  // Movement
  const { keys, dpad, P } = state;
  const mouse = isMouseMode();

  const fwd = (keys['w'] || keys['arrowup']   || dpad.fwd  ? 1 : 0)
            - (keys['s'] || keys['arrowdown'] || dpad.back ? 1 : 0);

  if (mouse) {
    P.angle    += mouseDeltaX * MOUSE_SENS;
    mouseDeltaX = 0;
    state.lookDelta = 0;
  } else {
    const trn = (keys['d'] || keys['arrowright'] || dpad.turnR ? 1 : 0)
              - (keys['a'] || keys['arrowleft']  || dpad.turnL ? 1 : 0)
              + state.lookDelta * 0.011;
    state.lookDelta *= 0.62;
    P.angle += trn * TURN_SPD * dt / 1000;
  }

  // A/D strafe in mouse mode; they turn in touch/keyboard mode (handled above)
  const strafe = mouse
    ? (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0)
    : 0;

  // Sprint / stamina
  state.sprinting = !!(keys['shift'] || dpad.sprint) && state.stamina > 0 && (fwd !== 0 || strafe !== 0);
  if (state.sprinting) {
    let drain = dt / 4000;
    if (state.panicLevel > 0) drain *= 1.5;
    state.stamina = Math.max(0, state.stamina - drain);
  } else {
    const regen = (fwd === 0 && strafe === 0) ? dt / 4000 : dt / 8000;
    state.stamina = Math.min(1, state.stamina + regen);
  }
  const inWeb  = !!state.webEffect;
  const effSPD = inWeb ? MOVE_SPD * 0.4 : state.sprinting ? MOVE_SPD * 1.9 : MOVE_SPD;

  state.isMoving = false;
  if (fwd !== 0 || strafe !== 0) {
    const spd = effSPD * dt / 1000;
    if (fwd !== 0) {
      const nx = P.x + Math.cos(P.angle) * spd * fwd;
      const ny = P.y + Math.sin(P.angle) * spd * fwd;
      if (!isWall(nx, P.y)) P.x = nx;
      if (!isWall(P.x, ny)) P.y = ny;
    }
    if (strafe !== 0) {
      const sx = -Math.sin(P.angle) * spd * strafe;
      const sy =  Math.cos(P.angle) * spd * strafe;
      if (!isWall(P.x + sx, P.y)) P.x += sx;
      if (!isWall(P.x, P.y + sy)) P.y += sy;
    }
    state.bobTimer    += dt * 0.009;
    state.isMoving     = true;
    state.footstepTimer -= dt;
    if (state.footstepTimer <= 0) {
      playFootstep();
      state.footstepTimer = state.sprinting ? 230 : 370;
    }
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

  // Note collection + typewriter timer
  if (state.note && !state.noteCollected) {
    const ndx = P.x - state.note.x, ndy = P.y - state.note.y;
    if (ndx * ndx + ndy * ndy < 0.25) {
      state.noteCollected = true;
      if (!state.collectedNotes.includes(state.level)) state.collectedNotes.push(state.level);
      playPaperRustle();
      state.noteDisplay = { text: getNoteText(state.level), chars: 0, timer: 4000, alpha: 1 };
    }
  }
  if (state.noteDisplay) {
    state.noteDisplay.timer -= dt;
    if (state.noteDisplay.timer <= 0) { state.noteDisplay = null; }
    else {
      const elapsed = 4000 - state.noteDisplay.timer;
      state.noteDisplay.chars = Math.min(state.noteDisplay.text.length, Math.floor(elapsed / 55));
      state.noteDisplay.alpha = state.noteDisplay.timer < 800 ? state.noteDisplay.timer / 800 : 1;
    }
  }

  // UI timers
  if (state.flashTooltipTimer   > 0) state.flashTooltipTimer   -= dt;
  if (state.limitedWarningTimer > 0) state.limitedWarningTimer -= dt;

  // Bat random scare (2 % per second, 15 s cooldown)
  if (state.batCooldown > 0) { state.batCooldown -= dt; }
  else if (!state.bat && Math.random() < 0.02 * dt / 1000) {
    state.bat = { t: 0, dir: Math.random() < 0.5 ? 1 : -1 };
    state.batCooldown = 15000;
    playBatScreech();
  }
  if (state.bat) { state.bat.t += dt / 600; if (state.bat.t >= 1) state.bat = null; }

  // Rat trigger on cell change (1.5 % chance)
  const pCell = { c: P.x | 0, r: P.y | 0 };
  if (state.lastPlayerCell &&
      (pCell.c !== state.lastPlayerCell.c || pCell.r !== state.lastPlayerCell.r)) {
    if (Math.random() < 0.015) {
      state.rat = {
        wx: (state.lastPlayerCell.c + 0.5) + (Math.random() - 0.5) * 0.4,
        wy: (state.lastPlayerCell.r + 0.5) + (Math.random() - 0.5) * 0.4,
        vx: (pCell.c - state.lastPlayerCell.c) * 2.4,
        vy: (pCell.r - state.lastPlayerCell.r) * 2.4,
        life: 1.0
      };
      playRatSkitter();
    }
  }
  state.lastPlayerCell = pCell;
  if (state.rat) {
    state.rat.wx  += state.rat.vx * dt / 1000;
    state.rat.wy  += state.rat.vy * dt / 1000;
    state.rat.life -= dt / 1000;
    if (state.rat.life <= 0) state.rat = null;
  }

  // Web collision + effect timer
  for (const web of state.webs) {
    if (!web.hit) {
      const wdx = P.x - web.x, wdy = P.y - web.y;
      if (wdx * wdx + wdy * wdy < 0.36) { web.hit = true; state.webEffect = { timer: 2000 }; playWebStick(); }
    }
  }
  if (state.webEffect) { state.webEffect.timer -= dt; if (state.webEffect.timer <= 0) state.webEffect = null; }

  // Blind One — tracks footstep sound, not player position
  if (state.level >= 5 && state.B.active) {
    const bdx = P.x - state.B.x, bdy = P.y - state.B.y;
    const bdist = Math.sqrt(bdx * bdx + bdy * bdy);
    const soundR = state.sprinting ? 6 : state.isMoving ? 3 : 0;
    if (soundR > 0 && bdist < soundR) {
      state.lastHeardPos = { x: P.x, y: P.y }; state.B.lostTimer = 0;
    } else if (!state.isMoving) {
      state.B.lostTimer += dt;
      if (state.B.lostTimer >= 2000) state.lastHeardPos = null;
    }
    // Sprint reaction: if sprinting within 6 units, immediately lock on at fast speed
    if (state.sprinting && bdist < 6) state.lastHeardPos = { x: P.x, y: P.y };
    const blindMS = (state.sprinting && bdist < 6 && state.lastHeardPos) ? 340 : 780;
    state.B.moveTimer += dt;
    while (state.B.moveTimer >= blindMS) {
      state.B.moveTimer -= blindMS;
      stepBlindOne();
      if (state.lastHeardPos) {
        const gc = state.B.x | 0, gr = state.B.y | 0;
        if (gc === (state.lastHeardPos.x | 0) && gr === (state.lastHeardPos.y | 0))
          state.lastHeardPos = null;
      }
    }
    // Echolocation click sound
    state.blindSoundTimer -= dt;
    if (state.blindSoundTimer <= 0) {
      const bRate = bdist < 3 ? 3 : bdist < 6 ? 2 : bdist < 10 ? 1 : 0;
      if (bRate > 0) {
        let bAng = Math.atan2(state.B.y - P.y, state.B.x - P.x) - P.angle;
        while (bAng >  Math.PI) bAng -= Math.PI * 2;
        while (bAng < -Math.PI) bAng += Math.PI * 2;
        playBlindClick(Math.sin(bAng) * 0.8, bRate);
        state.blindSoundTimer = Math.max(260, 780 / bRate);
      } else state.blindSoundTimer = 600;
    }
  }

  // Stalker moves only when active and flash is on
  if (state.E.active && state.flashAlpha > 0.04) {
    if (!state.firstFlashDone) { state.firstFlashDone = true; state.minimapTimer = 4; }
    state.E.moveTimer += dt;
    while (state.E.moveTimer >= state.ENEMY_MS) { state.E.moveTimer -= state.ENEMY_MS; stepEnemy(); }
  }
  if (state.minimapTimer > 0) state.minimapTimer -= dt / 1000;

  // Extra stalkers — GAUNTLET only, level 9+
  if (state.level >= 9 && state.levelType === 'GAUNTLET') {
    if (state.extraStalkers.length < 3) {
      state.extraSpawnTimer -= dt;
      if (state.extraSpawnTimer <= 0) {
        state.extraSpawnTimer = 45000;
        // Spawn at farthest open cell from player
        const epass = (c, r) => state.MAP[r][c] !== 1;
        const edm   = bfs(epass, state.COLS, state.ROWS, state.P.x | 0, state.P.y | 0);
        let ebest = -1, ecands = [];
        for (let r2 = 1; r2 < state.ROWS - 1; r2++) for (let c2 = 1; c2 < state.COLS - 1; c2++) {
          if (state.MAP[r2][c2] !== 0) continue;
          const d = edm[r2][c2];
          if (d > ebest) { ebest = d; ecands = []; }
          if (d === ebest) ecands.push([c2, r2]);
        }
        shuf(ecands);
        const [ec2, er2] = ecands[0] || [1, 1];
        const idx = state.extraStalkers.length;
        state.extraStalkers.push({ x: ec2 + 0.5, y: er2 + 0.5, moveTimer: 0, speedMult: 1 + idx * 0.18 });
        state.spawnWarning = { timer: 2200 };
      }
    }
    for (const es of state.extraStalkers) {
      es.moveTimer += dt;
      const esMS = Math.max(150, Math.round(state.ENEMY_MS / es.speedMult));
      while (es.moveTimer >= esMS) { es.moveTimer -= esMS; stepEntity(es); }
    }
  }
  if (state.spawnWarning) { state.spawnWarning.timer -= dt; if (state.spawnWarning.timer <= 0) state.spawnWarning = null; }

  // Mimic path-following — only active in ECHO and GAUNTLET types
  if (state.levelType === 'ECHO' || state.levelType === 'GAUNTLET') {
    state.historyTimer += dt;
    while (state.historyTimer >= 500) {
      state.historyTimer -= 500;
      state.playerHistory.push({ x: P.x, y: P.y });
      if (state.playerHistory.length > 40) state.playerHistory.shift();
      // Activate mimic once 12 s of history is built up (25 entries × 0.5 s = 12.5 s)
      if (state.playerHistory.length >= 25) {
        state.M.active = true;
        // Normal mode: replay the lagged path; panic mode overrides with BFS below
        if (state.panicLevel === 0) {
          const pos = state.playerHistory[state.playerHistory.length - 25];
          state.M.x = pos.x; state.M.y = pos.y;
        }
      }
    }
    // During panic: mimic also BFS-hunts player (slower than main enemy)
    if (state.M.active && state.panicLevel > 0) {
      state.M.moveTimer += dt;
      const mimicMS = Math.max(320, state.ENEMY_MS * 1.8);
      while (state.M.moveTimer >= mimicMS) { state.M.moveTimer -= mimicMS; stepMimic(); }
    } else {
      state.M.moveTimer = 0;
    }
  }

  // Heartbeat — Stalker proximity; suppressed entirely in SILENCE
  const pd = state.E.active
    ? Math.sqrt((P.x - state.E.x) ** 2 + (P.y - state.E.y) ** 2)
    : Infinity;
  if (state.levelType !== 'SILENCE' && state.E.active) {
    const hbRate = pd < 2 ? 3.2 : pd < 3.5 ? 2.2 : pd < 6 ? 1.4 : 0;
    if (hbRate > 0) {
      state.heartbeatTimer -= dt;
      if (state.heartbeatTimer <= 0) { playHeartbeat(hbRate); state.heartbeatTimer = Math.max(280, 950 / hbRate); }
    } else { state.heartbeatTimer = 0; }
  }

  // Mimic proximity ping — high ethereal tone, distinct from heartbeat
  if (state.level >= 3 && state.M.active) {
    const md2 = Math.sqrt((P.x - state.M.x) ** 2 + (P.y - state.M.y) ** 2);
    const mRate = md2 < 3 ? 2.5 : md2 < 5 ? 1.5 : md2 < 8 ? 0.7 : 0;
    if (mRate > 0) {
      state.mimicSoundTimer -= dt;
      if (state.mimicSoundTimer <= 0) { playMimicPulse(mRate); state.mimicSoundTimer = Math.max(380, 900 / mRate); }
    } else { state.mimicSoundTimer = 0; }
  }

  // Panic footsteps — spatial audio panned to enemy bearing
  if (state.panicLevel > 0) {
    const edx = state.E.x - P.x, edy = state.E.y - P.y;
    let eAng = Math.atan2(edy, edx) - P.angle;
    while (eAng >  Math.PI) eAng -= Math.PI * 2;
    while (eAng < -Math.PI) eAng += Math.PI * 2;
    updatePanicAudio(state.panicLevel, Math.sin(eAng) * 0.85, pd);
  }

  // Afterimage alpha decay
  for (const ai of state.afterimages) ai.alpha -= dt / 3000;
  state.afterimages = state.afterimages.filter(ai => ai.alpha > 0);

  const result = checkEnd();
  if (result) {
    state.gameState = result; state.flashHeld = false;
    if (result === 'dead' && state.cursedFlash) state.killedBy = 'cursed';
    if (isMouseMode() && document.pointerLockElement) document.exitPointerLock();
    stopAmbient(); stopExitHum(); resetPanicAudio();
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
  const flashEl    = document.getElementById('s-flash');
  const unlimited  = state.flashCount === Infinity;
  flashEl.style.display = unlimited ? 'none' : '';
  if (!unlimited) {
    flashEl.textContent = `FLASHES: ${state.flashCount}`;
    flashEl.classList.toggle('low-battery', state.flashCount <= 2 && state.gameState === 'playing');
    flashEl.classList.remove('flash-draining');
  }
  document.getElementById('s-level').textContent = `LEVEL: ${state.level}`;
  const sType = document.getElementById('s-type');
  if (sType) sType.textContent = state.levelType || '';
  const dx = state.P.x - (state.COLS - 1.5), dy = state.P.y - (state.ROWS - 1.5);
  const distVal = state.gameState === 'playing' ? Math.round(Math.sqrt(dx * dx + dy * dy)) : '—';
  document.getElementById('s-dist').textContent = isMouseMode() ? `STEPS TO EXIT: ${distVal}` : `DIST: ${distVal}`;
  const sm = document.getElementById('s-moving');
  if (sm) sm.style.opacity = state.isMoving ? '1' : '0';
  const locked = document.pointerLockElement === state.canvas;
  document.getElementById('mouse-prompt').style.display =
    (isMouseMode() && state.gameState === 'playing' && !state.paused && !locked) ? 'flex' : 'none';
  // Note display typewriter
  const noteEl = document.getElementById('note-display');
  if (noteEl) {
    if (state.noteDisplay && !state.paused) {
      noteEl.style.display = 'flex'; noteEl.style.opacity = state.noteDisplay.alpha;
      document.getElementById('note-text').textContent =
        state.noteDisplay.text.substring(0, state.noteDisplay.chars);
    } else noteEl.style.display = 'none';
  }
  // Notes counter — "X/Y" format (collected / levels played)
  const sNotes = document.getElementById('s-notes');
  if (sNotes) {
    const n = state.collectedNotes.length;
    sNotes.textContent = (n > 0 || state.level > 1) ? `📄 ${n}/${state.level}` : '';
  }
  // SILENCE level warning (explains missing heartbeat)
  const sSilence = document.getElementById('s-silence');
  if (sSilence) sSilence.style.display =
    (state.levelType === 'SILENCE' && state.gameState === 'playing') ? 'block' : 'none';
  // Cursed flash warning
  const sCursed = document.getElementById('s-cursed');
  if (sCursed) sCursed.style.display = state.cursedFlash ? 'block' : 'none';
  // Spawn warning + level type flash in orange
  const sSpawned = document.getElementById('s-spawned');
  if (sSpawned) {
    sSpawned.style.display = state.spawnWarning ? 'block' : 'none';
    if (state.spawnWarning) sSpawned.textContent = `ANOTHER ONE`;
  }
  const sTypeSpawn = document.getElementById('s-type-spawn');
  if (sTypeSpawn) {
    sTypeSpawn.style.display = state.spawnWarning ? 'block' : 'none';
    if (state.spawnWarning) sTypeSpawn.textContent = state.levelType;
  }
  // Level 1 flash tooltip
  const tipEl = document.getElementById('flash-tooltip');
  if (tipEl) {
    const showTip = state.flashTooltipTimer > 0 && state.gameState === 'playing' && !state.paused;
    tipEl.style.display = showTip ? 'block' : 'none';
    tipEl.style.opacity = String(Math.min(1, state.flashTooltipTimer / 700));
  }
  // "BATTERIES NOW LIMITED" warning at level 4
  const limitEl = document.getElementById('s-limited');
  if (limitEl) limitEl.style.display = state.limitedWarningTimer > 0 ? 'block' : 'none';
  // Stamina bar
  const sBar = document.getElementById('stamina-bar');
  const sFill = document.getElementById('stamina-fill');
  if (sBar && sFill) {
    const showBar = (state.sprinting || state.stamina < 0.99) && state.gameState === 'playing' && !state.paused;
    sBar.style.display = showBar ? 'block' : 'none';
    sFill.style.width  = `${Math.max(0, state.stamina) * 100}%`;
    sFill.style.background = state.stamina > 0.3 ? 'rgba(255,255,255,0.5)'
      : state.stamina > 0.1 ? 'rgba(255,140,0,0.65)' : 'rgba(255,40,40,0.70)';
  }
}

function showMsg(type) {
  if (isMouseMode() && document.pointerLockElement) document.exitPointerLock();
  const el = document.getElementById('msgscreen');
  el.className = type;
  const dm = type === 'dead'
    ? (DEATH_MSGS[state.killedBy] || { title: 'CAUGHT', sub: 'It was waiting for you.' })
    : null;
  el.querySelector('.msg-title').textContent = type === 'dead' ? dm.title : 'ESCAPED';
  el.querySelector('.msg-sub').textContent   = type === 'dead'
    ? dm.sub
    : `${state.levelType} COMPLETE · LEVEL ${state.level}`;
  el.querySelector('.msg-info').textContent  = state.flashCount === Infinity
    ? `LEVEL ${state.level}`
    : `BATTERIES LEFT: ${state.flashCount}  ·  LEVEL ${state.level}`;
  el.classList.add('show');
  document.getElementById('retry-btn').textContent = type === 'win' ? 'NEXT LEVEL' : 'TRY AGAIN';
  if (type === 'win') state.level++;
}

// ── Level intro card ──────────────────────────────────────────────────────────

function showLevelIntro() {
  const el = document.getElementById('level-intro');
  if (!el) return;
  const info = getLevelInfo(state.level);
  el.querySelector('.li-level').textContent  = `LEVEL ${state.level}`;
  el.querySelector('.li-sub').textContent    = TYPE_SUBS[info.type];
  el.querySelector('.li-flavor').textContent = FLAVOR_TEXT[info.type] || '';
  el.querySelector('.li-cycle').textContent  = info.cycle > 0 ? `CYCLE ${info.cycle}` : '';
  el.style.transition = 'none';
  el.style.opacity    = '1';
  el.style.display    = 'flex';
  // Restart type slam + flavor fade-in each level
  const typeEl   = el.querySelector('.li-type');
  const flavorEl = el.querySelector('.li-flavor');
  typeEl.textContent = info.type;
  typeEl.classList.remove('li-slam');   void typeEl.offsetHeight;
  typeEl.classList.add('li-slam');
  flavorEl.classList.remove('li-flavor-in'); void flavorEl.offsetHeight;
  flavorEl.classList.add('li-flavor-in');
  clearTimeout(el._ft);
  el._ft = setTimeout(() => {
    el.style.transition = 'opacity 0.8s ease';
    el.style.opacity    = '0';
    setTimeout(() => { el.style.display = 'none'; }, 820);
  }, 1900);
}

// ── Control scheme ────────────────────────────────────────────────────────────

function isMouseMode() {
  if (settings.controlScheme === 'mouse') return true;
  if (settings.controlScheme === 'touch') return false;
  return !('ontouchstart' in window || navigator.maxTouchPoints > 0);
}

function applyControlScheme() {
  const mouse = isMouseMode();
  document.body.classList.toggle('mouse-mode', mouse);
  if (!mouse && document.pointerLockElement) document.exitPointerLock();
}

// ── Pause ─────────────────────────────────────────────────────────────────────

function showPausePanel(id) {
  document.querySelectorAll('.pause-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function pauseGame() {
  if (state.gameState !== 'playing') return;
  state.paused    = true;
  state.flashHeld = false;
  state.keys      = {};
  mouseDeltaX     = 0;
  Object.assign(state.dpad, { fwd: false, back: false, turnL: false, turnR: false });
  if (document.pointerLockElement) document.exitPointerLock();
  document.body.classList.add('paused');
  document.getElementById('pause-screen').classList.add('active');
  showPausePanel('pause-main');
  suspendAudio();
}

function resumeGame() {
  state.paused = false;
  document.body.classList.remove('paused');
  document.getElementById('pause-screen').classList.remove('active');
  resumeAudio();
}

// ── Bootstrap — must run before event listeners reference state.canvas ────────
state.canvas = document.getElementById('c');
state.ctx    = state.canvas.getContext('2d');
resize();
state.ctx.fillStyle = '#000';
state.ctx.fillRect(0, 0, state.W, state.H);
applyControlScheme();

// Attempt to load PNG sprites; falls back to procedural shapes if missing
loadSprites({ battery: 'sprites/battery.png' }).catch(() => {});

// ── Controls ──────────────────────────────────────────────────────────────────

function startFlash() {
  if (state.gameState !== 'playing') return;
  if (state.cursedFlash) return;              // already cursed, can't override
  if (state.flashCount <= 0) { playEmpty(); return; }
  if (!state.flashHeld) {
    state.flashCount--;
    if (state.cursedBurnCount > 0) state.cursedBurnCount--;  // consume one camera-burn charge
    if (Math.random() < 1 / 40) {
      // Cursed flash — single red frame then strobe begins
      state.cursedFlash      = true;
      state.cursedTimer      = 10000 + Math.random() * 2000;
      state.cursedDrainAccum = 0;
      playCursedFlash();
    } else {
      playShutter();
    }
  }
  state.flashHeld = true;
}
function stopFlash() { state.flashHeld = false; }

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (state.paused) {
      const ap = document.querySelector('.pause-panel.active');
      (ap && ap.id !== 'pause-main') ? showPausePanel('pause-main') : resumeGame();
    } else if (state.gameState === 'playing') {
      pauseGame();
    }
    return;
  }
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

// Mobile sprint via double-tap on forward button
{
  let lastFwdTap = 0;
  document.getElementById('b-fwd').addEventListener('touchstart', () => {
    const now = Date.now();
    if (now - lastFwdTap < 300) state.dpad.sprint = true;
    lastFwdTap = now;
  }, { passive: true });
  document.getElementById('b-fwd').addEventListener('touchend', () => { state.dpad.sprint = false; }, { passive: true });
}

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

// ── Pointer lock (mouse mode) ─────────────────────────────────────────────────
state.canvas.addEventListener('click', () => {
  if (isMouseMode() && state.gameState === 'playing' && !state.paused)
    state.canvas.requestPointerLock();
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement === state.canvas && !state.paused)
    mouseDeltaX += e.movementX;
});
document.addEventListener('pointerlockchange', () => {
  // If pointer lock is unexpectedly lost mid-game, pause
  if (!document.pointerLockElement && isMouseMode() &&
      state.gameState === 'playing' && !state.paused)
    pauseGame();
});
document.addEventListener('pointerlockerror', () => {});  // silence errors

function startGame(scheme) {
  settings.controlScheme = scheme;
  saveSettings();
  state.level = 1; getAudio();
  document.getElementById('menu').classList.add('hidden');
  initGame(); state.gameState = 'playing'; state.lastTime = performance.now();
  applyControlScheme();
  startAmbient(); startExitHum();
  state.frameId = requestAnimationFrame(loop);
}

document.getElementById('btn-pc').addEventListener('click',     () => startGame('mouse'));
document.getElementById('btn-mobile').addEventListener('click', () => startGame('touch'));

document.getElementById('retry-btn').addEventListener('click', () => {
  document.getElementById('msgscreen').classList.remove('show');
  initGame(); state.gameState = 'playing'; state.lastTime = performance.now();
  applyControlScheme();
  startAmbient(); startExitHum();
});

// ── Pause panel buttons ────────────────────────────────────────────────────────

document.getElementById('pause-resume').addEventListener('click', resumeGame);

document.getElementById('pause-notes-btn').addEventListener('click', () => {
  const list = document.getElementById('pause-notes-list');
  list.innerHTML = state.collectedNotes.length === 0
    ? '<p class="notes-empty">No notes found yet.</p>'
    : state.collectedNotes.slice().sort((a, b) => a - b)
        .map(lvl => `<div class="note-entry"><span class="note-lvl">LEVEL ${lvl}</span><p class="note-body">${getNoteText(lvl)}</p></div>`)
        .join('');
  showPausePanel('pause-notes');
});
document.getElementById('pause-notes-back').addEventListener('click', () => showPausePanel('pause-main'));

document.getElementById('pause-options-btn').addEventListener('click', () => {
  document.getElementById('p-opt-volume').value = settings.masterVolume;
  document.getElementById('p-opt-flash').value  = settings.flashFade;
  syncPauseShake();
  showPausePanel('pause-opts');
});

document.getElementById('pause-opts-back').addEventListener('click', () => showPausePanel('pause-main'));

document.getElementById('pause-quit').addEventListener('click', () => {
  stopAmbient(); stopExitHum();
  resumeGame();                      // clears paused state + unsuspends audio
  state.gameState = 'menu';
  state.level     = 1;
  document.getElementById('menu').classList.remove('hidden');
  document.querySelectorAll('.menu-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('menu-main').classList.add('active');
});

// Pause options controls — same settings object, different element IDs
document.getElementById('p-opt-volume').addEventListener('input', e => {
  settings.masterVolume = parseFloat(e.target.value);
  setMasterVolume(settings.masterVolume);
  saveSettings();
});
document.getElementById('p-opt-flash').addEventListener('input', e => {
  settings.flashFade = parseFloat(e.target.value);
  saveSettings();
});
document.getElementById('p-opt-shake').addEventListener('click', () => {
  settings.screenshake = !settings.screenshake;
  syncPauseShake();
  saveSettings();
});

function syncPauseShake() {
  const btn = document.getElementById('p-opt-shake');
  btn.textContent = settings.screenshake ? 'ON' : 'OFF';
  btn.setAttribute('aria-pressed', String(settings.screenshake));
}


