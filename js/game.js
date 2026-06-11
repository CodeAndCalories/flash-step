import { state } from './state.js';
import { settings, saveSettings } from './settings.js';
import { getAudio, playShutter, playFootstep, playHeartbeat, playCatch, playWin, playPickup, playScreech, startAmbient, stopAmbient, startExitHum, stopExitHum, updateExitHum, suspendAudio, resumeAudio, setMasterVolume, playPanicWarning, updatePanicAudio, resetPanicAudio, playMimicPulse, playPaperRustle, playBatScreech, playRatSkitter, playWebStick, playBlindClick, playCursedFlash, startHallucinations, stopHallucinations, startEndingHeartbeat, stopEndingHeartbeat, startReflectionAmbient, stopReflectionAmbient, playReflectionEcho, playStalkerDrag, playMimicWhisper, playIntercom, playWallProximity } from './audio.js';
import { genMaze, bfs, shuf, findDeadEnds } from './maze.js';
import { draw, loadSprites, getSpriteReport } from './renderer.js';
import { stepEnemy, stepMimic, stepBlindOne, stepEntity, checkEnd, isWall } from './enemy.js';

// Two voices alternate by level parity: odd = SURVIVOR, even = MAZE MASTER.
const NOTE_TEXTS = [
  // Level 1 — Survivor
  "Day one. I dropped my light near the entrance. I can hear something moving in the walls. I thought it was rats.",
  // Level 2 — Maze Master
  "Subject 31. Female. Adaptation rate above average. Survived the first corridor without illuminating once. Noted.",
  // Level 3 — Survivor
  "It follows the flash. I figured it out too late. Every time I turn the camera on it gets closer. It doesn't move in the dark. It waits.",
  // Level 4 — Maze Master
  "Introduced the second specimen today. Subject 31's reaction was textbook. Panic, then recalibration. She lasted four more levels. A record at the time.",
  // Level 5 — Survivor
  "I've seen the green door twice. Both times it moved before I reached it. I don't think the exit wants to be found.",
  // Level 6 — Maze Master
  "The reflection variable continues to produce reliable results. Subjects consistently follow the ghost image. The instinct toward a familiar shape overrides threat recognition entirely.",
  // Level 7 — Survivor
  "If anyone finds this — my name is Daniel. I have a daughter. Her name is Mara. If you get out, tell her I looked for the exit every single day.",
  // Level 8 — Maze Master
  "Still alive. Level nine. I have not had a subject reach level nine in fourteen attempts. I am adjusting the variables. Do not mistake my patience for admiration.",
  // Level 9 — Survivor
  "I found batteries someone left. Stacked. Deliberately. Someone was here before me and they PREPARED for someone else. That means he KNEW someone else would come.",
  // Level 10 — Maze Master
  "Removed the flash variable for one level. Without the core mechanic the subject did not freeze — they adapted. Ran the corridors from memory. I found that more unsettling than I expected.",
  // Level 11 — Survivor
  "I've stopped being afraid of the things in the dark. I'm afraid of whoever put them there. The creatures just do what they were made to do. He made them. He's watching.",
  // Level 12 — Maze Master
  "You are different from the others. I don't say that as encouragement. The others slowed down around level six. You have not slowed down. I am not sure what to do with that yet.",
  // Level 13 — Survivor
  "writing this in the dark cant see the paper. found the chair. the screens. he was just here. the screens were still warm. HE IS ALWAYS WATCHING.",
  // Level 14 — Maze Master
  "I have extended your maze three times. Introduced every specimen I have. Removed the light. Still you find the door. What happens next is not cruelty. It is methodology.",
  // Level 15 — Survivor
  "He leaves notes too. I found one. It was about me. It had my real name on it. Not subject anything. My name. I don't know how he knows my name.",
  // Level 16 — Maze Master
  "I'm done being patient. I designed this to be survivable. I designed it to test limits, not to be beaten. Tomorrow I introduce the final configuration.",
  // Level 17 — Survivor
  "I found the exit door today and stood in front of it for a long time. I didn't go through. I don't know why. I think I'm scared of what's on the other side.",
  // Level 18 — Maze Master
  "Something is wrong. You should not have been able to reach this level. Something in the design has failed. Or something in you hasn't. I genuinely cannot tell which.",
  // Level 19 — Survivor
  "Last note. Going for the exit. If you're reading this — run. Don't use the flash if you can help it. And if you hear his voice on the intercom — don't answer. He wants you to stop moving. Keep moving.",
  // Level 20 — Maze Master
  "I'm sorry. That's not something this process requires. But you were never supposed to see all of it. The exit is open. I won't close it again. I don't think I could if I tried.",
];
// Cycles back to index 0 after level 20; parity (and thus voice) is preserved.
function getNoteText(lvl) {
  return NOTE_TEXTS[(lvl - 1) % NOTE_TEXTS.length];
}
// Odd levels are SURVIVOR notes, even levels are MAZE MASTER logs.
function noteType(lvl) {
  return lvl % 2 === 1 ? 'survivor' : 'master';
}

// ── Level type cycle ──────────────────────────────────────────────────────────
// Levels 1-2: always HUNT. From level 3: 4-step cycle ECHO→SILENCE→GAUNTLET→HUNT.
// Each completed cycle (every 4 levels) adds 8 % enemy speed and +2 maze cells.
const CYCLE_TYPES = ['ECHO', 'SILENCE', 'GAUNTLET', 'HUNT'];
const TYPE_SUBS   = {
  HUNT:         'STALKER ONLY · SMALL MAZE',
  ECHO:         'MIMIC ONLY · LARGE MAZE',
  SILENCE:      'BLIND ONE · NO HEARTBEAT',
  GAUNTLET:     'ALL ENEMIES',
  'LIGHTS ON':  'FULLY ILLUMINATED · PURE CHASE',
  REFLECTION:   'MIMIC ONLY · MIRROR MAZE',
  VOID:         'NO WALLS · NAVIGATE BLIND',
};
const FLAVOR_TEXT = {
  HUNT:         "It knows you're here.",
  ECHO:         "It remembers your path.",
  SILENCE:      "Don't make a sound.",
  GAUNTLET:     "They're all here.",
  'LIGHTS ON':  "Nowhere to hide.",
  REFLECTION:   "Which one is moving?",
  VOID:         "He took the walls.",
};
const DEATH_MSGS = {
  stalker:       { title: 'FOUND',      sub: 'It never stopped moving.' },
  mimic:         { title: 'ECHOED',     sub: 'You led it right to yourself.' },
  blindone:      { title: 'HEARD',      sub: 'You should have stayed still.' },
  cursed:        { title: 'BETRAYED',   sub: 'The camera chose its side.' },
  extra_stalker: { title: 'SURROUNDED', sub: 'There were too many.' },
  reflection:    { title: 'MIRRORED',   sub: 'You followed yourself in.' },
  void:          { title: 'LOST',       sub: 'The maze was always there.' },
};
const TYPE_MAZE_MOD = { HUNT: -4, ECHO: 4, SILENCE: 0, GAUNTLET: 0, 'LIGHTS ON': 0, REFLECTION: 2, VOID: -4 };

// Second intro-card flavor line, faded in late — only for types that have one.
const FLAVOR2_TEXT = { GAUNTLET: "They don't all wake at once.", VOID: "Your footprints are all you have." };

function getLevelInfo(level) {
  // REFLECTION: every 7th level (7, 14, 21, 28, …) — takes priority over other overrides
  if (level >= 7 && level % 7 === 0) return { type: 'REFLECTION', cycle: Math.floor(level / 7) };
  // THE VOID: level 10 and every 9th after (10, 19, 28, …). Priority REFLECTION > VOID > LIGHTS ON.
  if (level >= 10 && (level - 10) % 9 === 0) return { type: 'VOID', cycle: 0 };
  // Every 5th level from level 11 onwards is LIGHTS ON (fully lit, pure chase)
  if (level >= 11 && (level - 11) % 5 === 0) return { type: 'LIGHTS ON', cycle: 0 };
  if (level <= 2) return { type: 'HUNT', cycle: 0 };
  const cycle = Math.floor((level - 3) / 4) + 1;
  const idx   = (level - 3) % 4;                   // 0=ECHO 1=SILENCE 2=GAUNTLET 3=HUNT
  return { type: CYCLE_TYPES[idx], cycle };
}

const MOVE_SPD   = 2.2;
const TURN_SPD   = 2.0;
let   mouseDeltaX = 0;
let   smoothedMouseDelta = 0;

function resize() {
  state.W = state.canvas.width  = window.innerWidth;
  state.H = state.canvas.height = window.innerHeight;
}

function initGame(startLevel) {
  // Optional start level (used when resuming from a save). Omitted → keep state.level
  // (so retry stays on the same level and post-win progression isn't reset).
  if (typeof startLevel === 'number') state.level = startLevel;
  resize();
  const { type, cycle }  = getLevelInfo(state.level);
  state.levelType         = type;
  const useStalker        = type === 'HUNT' || type === 'GAUNTLET' || type === 'LIGHTS ON' || type === 'VOID';
  const useBlind          = type === 'SILENCE' || type === 'GAUNTLET';
  const useReflection     = type === 'REFLECTION';
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
  // REFLECTION: find mimic spawn far from player start (use dp = distance from player BFS)
  let reflMX = 1.5, reflMY = 1.5;
  if (useReflection) {
    let bestR = -1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (state.MAP[r][c] === 1 || (c === 1 && r === 1) || (c === gc && r === gr)) continue;
      const d = dp[r][c];
      if (d > bestR) { bestR = d; reflMX = c + 0.5; reflMY = r + 0.5; }
    }
  }

  // Stalker active only in HUNT and GAUNTLET
  state.E.active    = useStalker;
  state.E.x         = useStalker ? ec + 0.5 : -5;
  state.E.y         = useStalker ? er + 0.5 : -5;
  state.E.moveTimer = 0;

  // Speed: 5 % per level after 3, plus 8 % per completed cycle
  const lvlMult     = state.level > 3 ? Math.pow(0.95, state.level - 3) : 1.0;
  const cycleMult   = cycle > 0 ? Math.pow(0.92, Math.max(0, cycle - 1)) : 1.0;
  let   enemyBaseMS = (1100 - state.level * 80) * lvlMult * cycleMult;
  if (type === 'GAUNTLET') enemyBaseMS /= 0.85; // 15% slower — three enemies is plenty of pressure
  state.ENEMY_MS    = Math.max(150, Math.round(enemyBaseMS));
  state.baseEnemyMS = state.ENEMY_MS;
  if (type === 'LIGHTS ON') {
    state.ENEMY_MS    = Math.max(150, Math.round(state.baseEnemyMS / 2)); // 2× speed
    state.baseEnemyMS = state.ENEMY_MS;
  }

  // Battery pickups — not spawned on levels 1-3 or LIGHTS ON
  const numBatteries = (state.level >= 4 && type !== 'LIGHTS ON')
    ? Math.min(3 + Math.floor(state.level / 2), 7) : 0;
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
  const numDecoys = Math.min(3 + Math.floor(state.level / 5), 5);
  shuf(deadEnds);
  state.decoys = deadEnds
    .filter(([c, r]) => (c - 1) ** 2 + (r - 1) ** 2 > 9)
    .slice(0, numDecoys)
    .map(([c, r]) => ({ x: c + 0.5, y: r + 0.5, phase: Math.random() * Math.PI * 2 }));

  // Flash is always unlimited; batteries increase brightness instead
  state.flashCount      = Infinity;
  state.flashBrightness = 0.35;
  state.flashHeld = false; state.flashAlpha = 0;
  state.flashDecay = 0; state.outlineAlpha = 0; state.flashHeldMs = 0;
  state.bobTimer = 0; state.isMoving = false; state.footstepTimer = 0;
  state.heartbeatTimer = 0; state.shakeX = 0; state.shakeY = 0; state.shakeAmt = 0;
  state.firstFlashDone  = false; state.minimapTimer = 0; state.jumpScareTimer = 0;
  state.crumbs          = [];
  state.panicLevel      = 0; state.panicDecayTimer = 0;
  state.playerHistory   = []; state.historyTimer = 0;
  state.M = useReflection
    ? { x: reflMX, y: reflMY, active: true, moveTimer: 0 }
    : { x: 1.5, y: 1.5, active: false, moveTimer: 0 };
  state.mimicSoundTimer  = 0;
  state.afterimages     = []; state.lastKnownE = null; state.lastKnownM = null; state.lastKnownB = null;
  state.killedBy        = null;
  state.lastHeardPos    = null; state.blindSoundTimer = 0;
  state.noteCollected   = false; state.noteDisplay = null;
  state.batCooldown     = 5000; state.bat = null; state.rat = null;
  state.lastPlayerCell  = { c: 1, r: 1 }; state.webEffect = null;
  state.stamina         = 1.0;  state.sprinting = false;
  state.levelTimer        = 0;
  state.graceTimer        = type === 'GAUNTLET' ? 8000 : 0; // GAUNTLET only: enemies frozen for the first 8 s
  state.blindOneAwake     = type !== 'GAUNTLET'; // GAUNTLET staggers the Blind One to 35 s
  state.blackoutActive    = false;
  state.blackoutTimer     = 0;
  state.blackoutCooldown  = 0;
  // Intercom — per-level flags + transient display reset (run-scoped flags live in beginRun)
  state.im90Fired           = false;
  state.imExitFired         = false;
  state.imVoidFired         = false;
  state.imStillTimer        = 0;
  state.imStillCooldown     = 0;
  state.imExitHesitateTimer = 0;
  state.intercomMsg         = null;
  state.intercomQueue       = [];
  state.wallProximityTimer  = 0;   // VOID: fire the first sonar check promptly
  state.hallucinVignette  = 0;
  state.replayBuffer      = [];
  state.replayRecordTimer = 0;
  state.deathReplay       = null;
  state.cursedFlash     = false; state.cursedTimer = 0; state.cursedBurnCount = 0;
  state.cursedEnemyTimer = 0;
  state.spawnWarning         = null;
  state.flashTooltipTimer    = state.level === 1 ? 6000 : 0;
  state.limitedWarningTimer  = state.level === 4 ? 3000 : 0;
  state.flashesUsedThisLevel = 0;
  state.hintText  = ''; state.hintTimer = 0;
  state.level1Hints    = { flash: false, door: false, enemy: false, idle: false };
  state.level1IdleMs   = 0; state.level1DoorMs = 0;
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
    draw(0, 0, 0, dt);
    state.frameId = requestAnimationFrame(loop);
    return;
  }

  if (state.gameState === 'replay') {
    stepReplay(dt);
    state.frameId = requestAnimationFrame(loop);
    return;
  }

  if (state.paused)                  { state.frameId = requestAnimationFrame(loop); return; }
  if (state.gameState !== 'playing') { state.frameId = requestAnimationFrame(loop); return; }

  state.levelTimer += dt;
  if (state.graceTimer > 0) state.graceTimer -= dt;
  const enemiesFrozen = state.graceTimer > 0; // start-of-level grace: nothing hunts yet
  // GAUNTLET wakes the Blind One late so all three threats don't converge at once
  if (state.levelType === 'GAUNTLET' && !state.blindOneAwake && state.levelTimer >= 35000)
    state.blindOneAwake = true;
  if (state.hintTimer > 0) state.hintTimer -= dt;

  // ── Maze Master intercom triggers (atmosphere only — never blocks play) ───────
  if (!state.imLevel5Fired && state.level === 5) {
    state.imLevel5Fired = true; fireIntercom('STILL WATCHING.');
  }
  if (!state.imGauntletFired && state.levelType === 'GAUNTLET') {
    state.imGauntletFired = true; fireIntercom("LET'S ADJUST THE VARIABLES.");
  }
  if (!state.imVoidFired && state.levelType === 'VOID') {
    state.imVoidFired = true; fireIntercom('I TOOK SOMETHING FROM YOU.');
  }
  if (!state.im90Fired && state.levelTimer >= 90000) {
    state.im90Fired = true; fireIntercom('IMPRESSIVE.');
  }
  if (state.imStillCooldown > 0) state.imStillCooldown -= dt;
  if (!state.isMoving) {
    state.imStillTimer += dt;
    if (state.imStillTimer >= 8000 && state.imStillCooldown <= 0) {
      fireIntercom('WHY DID YOU STOP?');
      state.imStillCooldown = 10000; state.imStillTimer = 0;
    }
  } else state.imStillTimer = 0;
  if (!state.imExitFired) {
    const exDx = (state.COLS - 1.5) - state.P.x, exDy = (state.ROWS - 1.5) - state.P.y;
    if (Math.sqrt(exDx * exDx + exDy * exDy) < 2.2) {
      state.imExitHesitateTimer += dt;
      if (state.imExitHesitateTimer >= 4000) { state.imExitFired = true; fireIntercom('GO ON THEN.'); }
    } else state.imExitHesitateTimer = 0;
  }
  updateIntercom(dt);

  // ── THE VOID — wall-proximity sonar (every 400 ms; walls are invisible here) ───
  if (state.levelType === 'VOID') {
    state.wallProximityTimer -= dt;
    if (state.wallProximityTimer <= 0) {
      state.wallProximityTimer = 400; // was 200 — slower so it reads as a ping, not footsteps
      const dF = voidWallDist(state.P.angle);
      const dL = voidWallDist(state.P.angle - 0.6);
      const dR = voidWallDist(state.P.angle + 0.6);
      const minD = Math.min(dF, dL, dR);
      if (minD < 3.0) {
        const g = (3.0 - minD) / 3.0 * 0.35; // was 0.5 — slightly quieter
        let pan = 0.0;                              // forward shortest → centre
        if (dR < dF && dR < dL)      pan = 0.4;     // right shortest → pan right
        else if (dL < dF && dL < dR) pan = -0.4;    // left shortest  → pan left
        playWallProximity(g, pan);
      }
    }
  }

  // Level 1 hints — show once, never again
  if (state.level === 1 && !state.paused) {
    const h = state.level1Hints;
    state.level1DoorMs += dt;
    if (!state.isMoving) state.level1IdleMs += dt; else state.level1IdleMs = 0;
    if (!h.flash && state.firstFlashDone) {
      showHint('HOLD to illuminate longer', 3000); h.flash = true;
    } else if (!h.door && state.level1DoorMs > 10000) {
      showHint('Find the GREEN DOOR to escape', 3000); h.door = true;
    } else if (!h.idle && state.level1IdleMs > 30000) {
      showHint(isMouseMode() ? 'Use WASD to move, MOUSE to look' : 'Use arrow keys or DPAD to move', 3500);
      h.idle = true;
    }
  }

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
    // Cursed flash forces maximum brightness
    state.flashBrightness = 1.0;
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

  // LIGHTS ON: scene normally fully lit; flash is repurposed as a timed blackout
  if (state.levelType === 'LIGHTS ON') {
    if (state.blackoutCooldown > 0) state.blackoutCooldown -= dt;
    if (state.blackoutActive) {
      state.blackoutTimer -= dt;
      if (state.blackoutTimer <= 0) {
        state.blackoutActive   = false;
        state.blackoutCooldown = 20000; // 20 s cooldown starts when the lights snap back
      }
    }
    // During blackout the lights cut completely; the stalker keeps moving (see gate below)
    state.flashAlpha = state.blackoutActive ? 0 : 1.0;
    state.flashDecay = state.blackoutActive ? 0 : 1.0;
    state.flashHeld  = false;
    state.panicLevel = 0;
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
    // Cap raw delta so a single huge frame (flick / hitch) can't snap the view ~180°
    const rawDelta = Math.max(-40, Math.min(40, mouseDeltaX));
    // Lerp toward the (capped) raw delta for smooth, low-jitter turning.
    // dt-scaled so turn feel is identical at any refresh rate (0.18/frame at 60 fps).
    const smoothK = 1 - Math.pow(1 - 0.18, dt * 0.06);
    smoothedMouseDelta += (rawDelta - smoothedMouseDelta) * smoothK;
    P.angle    += smoothedMouseDelta * settings.mouseSens;
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
  const effSPD = inWeb ? MOVE_SPD * 0.4 : state.sprinting ? MOVE_SPD * 1.6 : MOVE_SPD;

  state.isMoving = false;
  if (fwd !== 0 || strafe !== 0) {
    const spd = effSPD * dt / 1000;
    let wallHit = false;
    if (fwd !== 0) {
      const nx = P.x + Math.cos(P.angle) * spd * fwd;
      const ny = P.y + Math.sin(P.angle) * spd * fwd;
      if (!isWall(nx, P.y)) P.x = nx; else wallHit = true;
      if (!isWall(P.x, ny)) P.y = ny; else wallHit = true;
    }
    if (strafe !== 0) {
      const sx = -Math.sin(P.angle) * spd * strafe;
      const sy =  Math.cos(P.angle) * spd * strafe;
      if (!isWall(P.x + sx, P.y)) P.x += sx; else wallHit = true;
      if (!isWall(P.x, P.y + sy)) P.y += sy; else wallHit = true;
    }
    // Subtle bump feedback when walking into a wall
    if (wallHit && settings.screenshake) {
      state.shakeX = (Math.random() - 0.5) * 1.5;
      state.shakeY = (Math.random() - 0.5) * 1.5;
      state.shakeAmt = 0.15; // decays in ~50 ms at renderer's 0.045/frame rate
    }
    state.bobTimer    += dt * 0.009;
    state.isMoving     = true;
    state.footstepTimer -= dt;
    if (state.footstepTimer <= 0) {
      playFootstep();
      if (state.levelType === 'REFLECTION') setTimeout(playReflectionEcho, 280);
      state.footstepTimer = state.sprinting ? 230 : 370;
    }
    const last = state.crumbs[state.crumbs.length - 1];
    if (!last || (P.x - last.x) ** 2 + (P.y - last.y) ** 2 > 0.12) {
      // VOID keeps a tight, recent breadcrumb trail (60); other levels keep 250.
      const maxCrumbs = state.levelType === 'VOID' ? 60 : 250;
      while (state.crumbs.length >= maxCrumbs) state.crumbs.shift();
      state.crumbs.push({ x: P.x, y: P.y, angle: P.angle, t: state.levelTimer });
    }
  } else {
    state.footstepTimer = 0;
  }
  // VOID: footprints expire after 25 s (time-based, runs every frame even when still)
  if (state.levelType === 'VOID') {
    const cutoff = state.levelTimer - 25000;
    while (state.crumbs.length && (state.crumbs[0].t ?? 0) < cutoff) state.crumbs.shift();
  }

  // Battery collection
  state.batteries = state.batteries.filter(b => {
    const dx = state.P.x - b.x, dy = state.P.y - b.y;
    if (dx * dx + dy * dy < 0.36) {
      state.flashBrightness = Math.min(1.0, state.flashBrightness + 0.12);
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
      const text = getNoteText(state.level);
      const type = noteType(state.level);
      // Master logs type slightly faster than survivor notes; cap so even the
      // longest entries finish typing within a sane window (notes here are long).
      const baseMs = type === 'master' ? 38 : 55;
      const charMs = Math.min(baseMs, 6500 / Math.max(1, text.length));
      state.noteDisplay = { text, type, charMs, chars: 0, elapsed: 0, alpha: 0, _shown: false };
    }
  }
  if (state.noteDisplay) {
    const nd = state.noteDisplay;
    nd.elapsed += dt;
    // Walking on dismisses the note (grace period so picking it up while moving doesn't instakill it)
    if (state.isMoving && nd.elapsed > 500) {
      state.noteDisplay = null;
    } else {
      nd.chars = Math.min(nd.text.length, Math.floor(nd.elapsed / nd.charMs));
      const fadeIn = 200, hold = 1200, fadeOut = 600; // ~2 s visible after typing (was ~4 s)
      const total = nd.text.length * nd.charMs + fadeIn + hold + fadeOut;
      if (nd.elapsed < fadeIn)               nd.alpha = nd.elapsed / fadeIn;
      else if (nd.elapsed > total - fadeOut) nd.alpha = Math.max(0, (total - nd.elapsed) / fadeOut);
      else                                   nd.alpha = 1;
      if (nd.elapsed >= total) state.noteDisplay = null;
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

  // Blind One — tracks footstep sound, not player position (dormant until awake)
  if (state.level >= 5 && state.B.active && state.blindOneAwake) {
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
    if (enemiesFrozen) {
      state.B.moveTimer = 0;
    } else {
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

  // Stalker moves: when flash is on, OR always in LIGHTS ON
  if (state.E.active && (state.flashAlpha > 0.04 || state.levelType === 'LIGHTS ON')) {
    if (!state.firstFlashDone) {
      state.firstFlashDone = true;
      state.minimapTimer = state.mutators.blindMap ? 0 : 4; // BLIND MAP: never reveal
      if (state.level === 1 && state.level1Hints && !state.level1Hints.enemy) {
        showHint('IT MOVES WHEN YOU LOOK', 3000); state.level1Hints.enemy = true;
      }
    }
    if (enemiesFrozen) {
      state.E.moveTimer = 0;
    } else {
      state.E.moveTimer += dt;
      const stalkerEffMS = Math.max(150, state.ENEMY_MS / getBrightSpeedMult());
      while (state.E.moveTimer >= stalkerEffMS) { state.E.moveTimer -= stalkerEffMS; stepEnemy(); playStalkerDrag(); }
    }
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
      if (enemiesFrozen) { es.moveTimer = 0; continue; }
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
      const mimicMS = Math.max(320, state.ENEMY_MS * 1.8 / getBrightSpeedMult());
      while (state.M.moveTimer >= mimicMS) { state.M.moveTimer -= mimicMS; stepMimic(); playMimicWhisper(); }
    } else {
      state.M.moveTimer = 0;
    }
  }

  // REFLECTION: mimic mirrors player movement — steps when player moves OR flash is on
  if (state.levelType === 'REFLECTION' && state.M.active) {
    if (!enemiesFrozen && (state.isMoving || state.flashAlpha > 0.04)) {
      state.M.moveTimer += dt;
      const mimicMS = Math.max(300, state.ENEMY_MS / getBrightSpeedMult());
      while (state.M.moveTimer >= mimicMS) { state.M.moveTimer -= mimicMS; stepMimic(); }
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

  // Hallucination vignette decay (200 ms flash)
  if (state.hallucinVignette > 0)
    state.hallucinVignette = Math.max(0, state.hallucinVignette - dt / 200);

  // Afterimage alpha decay
  for (const ai of state.afterimages) ai.alpha -= dt / 3000;
  state.afterimages = state.afterimages.filter(ai => ai.alpha > 0);

  // Record positions every 100 ms into circular replay buffer (last 8 s)
  state.replayRecordTimer += dt;
  while (state.replayRecordTimer >= 100) {
    state.replayRecordTimer -= 100;
    state.replayBuffer.push({
      px: state.P.x, py: state.P.y,
      ex: state.E.active ? state.E.x : null, ey: state.E.active ? state.E.y : null,
      mx: state.M.active ? state.M.x : null, my: state.M.active ? state.M.y : null,
      bx: state.B.active ? state.B.x : null, by: state.B.active ? state.B.y : null,
      extras: state.extraStalkers.map(e => ({ x: e.x, y: e.y })),
    });
    if (state.replayBuffer.length > 80) state.replayBuffer.shift();
  }

  const result = checkEnd();
  if (result) {
    state.gameState = result; state.flashHeld = false;
    if (result === 'dead' && state.cursedFlash) state.killedBy = 'cursed';
    if (result === 'dead' && state.levelType === 'REFLECTION' && state.killedBy === 'mimic') state.killedBy = 'reflection';
    if (result === 'dead' && state.levelType === 'VOID' &&
        (state.killedBy === 'stalker' || state.killedBy === 'extra_stalker')) state.killedBy = 'void';
    if (isMouseMode() && document.pointerLockElement) document.exitPointerLock();
    stopLevelAmbient(); stopExitHum(); stopHallucinations(); resetPanicAudio();
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
    if (result === 'dead' && !state.cursedFlash) {
      setTimeout(startDeathReplay, 600);
    } else if (result === 'win' && state.level === 10) {
      setTimeout(showEndingSequence, 480);
    } else {
      setTimeout(() => showMsg(result), result === 'dead' ? 600 : 480);
    }
  }

  // Exit hum — distance + bearing to goal
  const gdx = (state.COLS - 1.5) - P.x, gdy = (state.ROWS - 1.5) - P.y;
  let gang = Math.atan2(gdy, gdx) - P.angle;
  while (gang >  Math.PI) gang -= Math.PI * 2;
  while (gang < -Math.PI) gang += Math.PI * 2;
  updateExitHum(Math.sqrt(gdx * gdx + gdy * gdy), Math.sin(gang) * 0.6);

  updateUI();
  const bob = state.isMoving ? Math.sin(state.bobTimer) * 0.036 : 0;
  const effBright = state.cursedFlash ? 1.0 : state.flashBrightness;
  const rawLit = state.levelType === 'LIGHTS ON' ? (state.blackoutActive ? 0 : 1.0)
    : (state.flashAlpha > 0 ? state.flashAlpha : state.flashDecay * 0.32) * effBright;
  draw(rawLit, bob, state.outlineAlpha, dt);
  state.frameId = requestAnimationFrame(loop);
}

function updateUI() {
  // Brightness bar
  const bFill = document.getElementById('brightness-bar-fill');
  if (bFill) bFill.style.width = `${Math.round(state.flashBrightness * 100)}%`;
  const visEl = document.getElementById('s-visible');
  if (visEl) visEl.style.display =
    (state.flashHeld && state.flashBrightness > 0.4 && state.gameState === 'playing') ? 'block' : 'none';
  // Hint display
  const hintEl = document.getElementById('hint-display');
  if (hintEl) {
    if (state.hintTimer > 0) {
      hintEl.style.display = 'block';
      hintEl.style.opacity = String(Math.min(1, state.hintTimer / 600));
      hintEl.textContent   = state.hintText;
    } else {
      hintEl.style.display = 'none';
    }
  }
  document.getElementById('s-level').textContent = state.level > 10 ? '∞ ENDLESS' : `LEVEL: ${state.level}`;
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
  // Note display typewriter (two voices: survivor vs Maze Master log)
  const noteEl = document.getElementById('note-display');
  if (noteEl) {
    if (state.noteDisplay && !state.paused) {
      const nd = state.noteDisplay;
      noteEl.style.display = 'flex';
      noteEl.style.opacity = nd.alpha;
      const paperEl = document.getElementById('note-paper');
      const labelEl = document.getElementById('note-label');
      const textEl  = document.getElementById('note-text');
      if (!nd._shown) {
        nd._shown = true;
        paperEl.classList.remove('note-survivor', 'note-master', 'note-flicker');
        paperEl.classList.add(nd.type === 'master' ? 'note-master' : 'note-survivor');
        labelEl.textContent = nd.type === 'master' ? '— OBSERVATION LOG —' : '— FOUND NOTE —';
        const hintEl2 = document.getElementById('note-dismiss-hint');
        if (hintEl2) hintEl2.textContent = isMouseMode() ? '[SPACE to dismiss]' : '[TAP to dismiss]';
        // Master logs flicker on like a monitor turning on (200 ms)
        if (nd.type === 'master') { void paperEl.offsetHeight; paperEl.classList.add('note-flicker'); }
      }
      textEl.textContent = nd.text.substring(0, nd.chars);
    } else noteEl.style.display = 'none';
  }
  // Maze Master intercom line (bottom-left)
  const imEl = document.getElementById('intercom-msg');
  if (imEl) {
    if (state.intercomMsg && state.gameState === 'playing' && !state.paused) {
      imEl.style.display = 'block';
      imEl.style.opacity = state.intercomMsg.alpha;
      imEl.textContent   = state.intercomMsg.text;
    } else imEl.style.display = 'none';
  }
  // Notes counter — "X/Y" format (collected / levels played)
  const sNotes = document.getElementById('s-notes');
  if (sNotes) {
    const n = state.collectedNotes.length;
    sNotes.textContent = (n > 0 || state.level > 1) ? `📄 ${n}/${state.level}` : '';
  }
  // LIGHTS ON warning
  const sLightsOn = document.getElementById('s-lights-on');
  if (sLightsOn) sLightsOn.style.display =
    (state.levelType === 'LIGHTS ON' && state.gameState === 'playing') ? 'block' : 'none';
  // Blackout ability indicator (LIGHTS ON only)
  const sBlackout = document.getElementById('s-blackout');
  if (sBlackout) {
    if (state.levelType === 'LIGHTS ON' && state.gameState === 'playing') {
      sBlackout.style.display = 'block';
      if (state.blackoutActive)
        sBlackout.textContent = `🌑 BLACKOUT ${Math.ceil(state.blackoutTimer / 1000)}s`;
      else if (state.blackoutCooldown > 0)
        sBlackout.textContent = `BLACKOUT RECHARGING ${Math.ceil(state.blackoutCooldown / 1000)}s`;
      else
        sBlackout.textContent = `⚡ FLASH = BLACKOUT`;
      sBlackout.classList.toggle('blackout-ready', !state.blackoutActive && state.blackoutCooldown <= 0);
    } else {
      sBlackout.style.display = 'none';
    }
  }
  // SILENCE level warning (explains missing heartbeat)
  const sSilence = document.getElementById('s-silence');
  if (sSilence) sSilence.style.display =
    (state.levelType === 'SILENCE' && state.gameState === 'playing') ? 'block' : 'none';
  // THE VOID indicator
  const sVoid = document.getElementById('s-void');
  if (sVoid) sVoid.style.display =
    (state.levelType === 'VOID' && state.gameState === 'playing') ? 'block' : 'none';
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

// ── Checkpoint save ─────────────────────────────────────────────────────────────
// Separate key from 'flashstep-settings' and 'flashstep-hiscore'. Progress only —
// never enemy/battery/brightness/mid-level state.
const SAVE_KEY = 'flashstep-save';
function loadGameSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch(e) { return null; }
}
// True while the current run has any challenge mutator enabled
function anyMutatorActive() {
  const m = state.mutators;
  return !!(m && (m.blindMap || m.permadeath));
}
// Save current progress. escaped=true also bumps the lifetime escape counter.
// Level never regresses (Math.max), so re-saving an earlier level is a no-op.
function writeGameSave(level, escaped) {
  // MUTATOR GUARD — single choke point: mutator runs never write the checkpoint.
  // Covers every call site: showMsg win branch, #msg-quit, #pause-quit.
  if (anyMutatorActive()) return null;
  const prev = loadGameSave() || { level: 1, notes: [], totalEscapes: 0 };
  const data = {
    level: Math.max(prev.level || 1, level),
    notes: state.collectedNotes.slice(),
    totalEscapes: (prev.totalEscapes || 0) + (escaped ? 1 : 0),
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch(e) {}
  return data;
}
function clearGameSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch(e) {}
}

// ── High score ────────────────────────────────────────────────────────────────
function loadHighScore() {
  try { return JSON.parse(localStorage.getItem('flashstep-hiscore') || '{}'); } catch(e) { return {}; }
}
function saveHighScore(data) {
  try { localStorage.setItem('flashstep-hiscore', JSON.stringify(data)); } catch(e) {}
}
function updateHiScoreDisplay() {
  const hs = loadHighScore();
  const el = document.getElementById('hi-score');
  if (!el) return;
  const parts = [];
  if (hs.maxLevel)               parts.push(`Level ${hs.maxLevel}`);
  if (hs.minFlashes !== undefined) parts.push(`${hs.minFlashes} flashes`);
  el.textContent = parts.length ? `BEST: ${parts.join(' · ')}` : '';
}

// ── Share card ────────────────────────────────────────────────────────────────
function generateShareCard() {
  const W2 = 640, H2 = 360;
  const off = document.createElement('canvas');
  off.width = W2; off.height = H2;
  const oc = off.getContext('2d');
  oc.fillStyle = '#000'; oc.fillRect(0, 0, W2, H2);
  const vg = oc.createRadialGradient(W2/2, H2/2, H2*0.2, W2/2, H2/2, H2*0.95);
  vg.addColorStop(0, 'transparent'); vg.addColorStop(1, 'rgba(140,0,0,0.55)');
  oc.fillStyle = vg; oc.fillRect(0, 0, W2, H2);
  oc.textAlign = 'center';
  oc.fillStyle = '#cc2222';
  oc.font = "bold 52px Georgia, serif";
  oc.fillText('THE FLASH-STEP', W2/2, 72);
  oc.strokeStyle = '#441111'; oc.lineWidth = 1;
  oc.beginPath(); oc.moveTo(W2*0.2, 90); oc.lineTo(W2*0.8, 90); oc.stroke();
  oc.font = "26px 'Courier New', monospace";
  oc.fillStyle = '#eeeeee';
  oc.fillText(`Survived to Level ${state.winLevel}`, W2/2, 148);
  oc.font = "20px 'Courier New', monospace";
  oc.fillStyle = '#aa2222';
  if (state.winFlashes > 0) oc.fillText(`${state.winFlashes} flashes used`, W2/2, 190);
  oc.fillStyle = '#666666';
  oc.fillText(`Escaped a ${state.winType}`, W2/2, 232);
  oc.font = "12px 'Courier New', monospace";
  oc.fillStyle = '#331111';
  oc.fillText(window.location.hostname || 'flash-step', W2/2, H2 - 14);
  const a = document.createElement('a');
  a.download = 'flash-step-score.png';
  a.href = off.toDataURL('image/png');
  a.click();
}

// ── Death replay ─────────────────────────────────────────────────────────────

function startDeathReplay() {
  if (!state.replayBuffer.length) { showMsg('dead'); return; }
  state.gameState = 'replay';
  const dr = {
    frames:  [...state.replayBuffer],
    elapsed: 0,
    phase:   'fadeout',
    onSkip:  null,
  };
  state.deathReplay = dr;

  function onSkip() {
    window.removeEventListener('keydown',     onSkip);
    window.removeEventListener('pointerdown', onSkip);
    window.removeEventListener('touchstart',  onSkip);
    window.removeEventListener('touchend',    onSkip);
    endReplay();
  }
  dr.onSkip = onSkip;
  window.addEventListener('keydown',     onSkip);
  window.addEventListener('pointerdown', onSkip);
  window.addEventListener('touchstart',  onSkip, { passive: true });
  window.addEventListener('touchend',    onSkip, { passive: true });
}

function endReplay() {
  const dr = state.deathReplay;
  if (dr?.onSkip) {
    window.removeEventListener('keydown',     dr.onSkip);
    window.removeEventListener('pointerdown', dr.onSkip);
    window.removeEventListener('touchstart',  dr.onSkip);
    window.removeEventListener('touchend',    dr.onSkip);
  }
  state.deathReplay = null;
  state.gameState   = 'dead';
  showMsg('dead');
}

function stepReplay(dt) {
  const dr = state.deathReplay;
  if (!dr) { showMsg('dead'); return; }
  const { ctx, W, H } = state;

  dr.elapsed += dt;

  if (dr.phase === 'fadeout') {
    const t = Math.min(1, dr.elapsed / 300);
    ctx.fillStyle = `rgba(0,0,0,${t.toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
    if (dr.elapsed >= 300) { dr.phase = 'playing'; dr.elapsed = 0; }
    return;
  }

  renderTopDownReplay(dr);
  if (dr.elapsed >= 3000) endReplay();
}

function renderTopDownReplay(dr) {
  const { ctx, W, H, MAP, COLS, ROWS } = state;
  const frames = dr.frames;
  const n      = frames.length;

  // How many frames to reveal (animates across the 3 s window)
  const progress  = Math.min(1, dr.elapsed / 3000);
  const showCount = Math.max(1, Math.ceil(progress * n));

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // Fit maze to 88 % of the shorter axis, centred, with room for label
  const labelH  = Math.max(28, H * 0.06);
  const usableH = H - labelH * 2;
  const cell    = Math.min(W * 0.88 / COLS, usableH * 0.88 / ROWS);
  const offX    = (W - cell * COLS) / 2;
  const offY    = (usableH - cell * ROWS) / 2;

  // Walls
  ctx.fillStyle = '#1d1d1d';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (MAP[r][c] === 1) ctx.fillRect(offX + c * cell, offY + r * cell, cell + 0.5, cell + 0.5);
    }
  }

  // Goal cell highlight
  ctx.fillStyle = '#0a2a0a';
  ctx.fillRect(offX + (COLS - 2) * cell, offY + (ROWS - 2) * cell, cell, cell);

  // Convert world → screen coords
  const ws = (wx, wy) => [offX + wx * cell, offY + wy * cell];

  const dotR = Math.max(1.5, cell * 0.18);

  function drawTrail(getPos, color) {
    for (let i = 0; i < showCount; i++) {
      const pos = getPos(frames[i]);
      if (!pos) continue;
      const [sx, sy] = ws(pos[0], pos[1]);
      const age   = showCount < 2 ? 1 : i / (showCount - 1);
      const r     = (i === showCount - 1) ? dotR * 2 : dotR;
      ctx.globalAlpha = 0.12 + age * 0.88;
      ctx.fillStyle   = color;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Enemy trails (drawn first so player renders on top)
  drawTrail(f => f.ex != null ? [f.ex, f.ey] : null, '#ff3030');
  drawTrail(f => f.bx != null ? [f.bx, f.by] : null, '#888888');
  drawTrail(f => f.mx != null ? [f.mx, f.my] : null, '#dddddd');
  const extraColors = ['#ff6600', '#ff00aa', '#9900ff'];
  for (let ei = 0; ei < state.extraStalkers.length; ei++) {
    drawTrail(f => f.extras?.[ei] ? [f.extras[ei].x, f.extras[ei].y] : null,
              extraColors[ei % extraColors.length]);
  }

  // Player trail (white, on top)
  drawTrail(f => [f.px, f.py], '#ffffff');

  // "THIS IS WHERE IT FOUND YOU" label
  ctx.globalAlpha = Math.min(1, dr.elapsed / 600); // fade in with the replay
  const fontSize  = Math.max(10, Math.floor(W * 0.022));
  ctx.font        = `bold ${fontSize}px 'Courier New', monospace`;
  ctx.textAlign   = 'center';
  ctx.fillStyle   = 'rgba(220,50,50,0.9)';
  ctx.fillText('THIS IS WHERE IT FOUND YOU', W / 2, H - labelH * 0.4);
  const skipHint  = isMouseMode() ? 'PRESS ANY KEY TO SKIP' : 'TAP TO SKIP';
  ctx.font        = `${Math.max(8, Math.floor(W * 0.013))}px 'Courier New', monospace`;
  ctx.fillStyle   = 'rgba(255,255,255,0.22)';
  ctx.fillText(skipHint, W / 2, H - labelH * 0.4 + Math.max(14, fontSize * 1.6));
  ctx.globalAlpha = 1;

  // Red vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28,
                                       W / 2, H / 2, Math.min(W, H) * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(55,0,0,0.6)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

// ── Level 10 ending sequence ──────────────────────────────────────────────────

function showEndingSequence() {
  const overlay = document.getElementById('ending-seq');
  const cardEl  = document.getElementById('ending-card');
  overlay.style.display = 'flex';

  const CARDS = [
    { text: 'You found the exit.',      dur: 2000 },
    { text: 'It was open.',             dur: 2000 },
    { text: 'It was always open.',      dur: 2000 },
    { text: "You've escaped 10 times.", dur: 3000 },
    { text: 'So has it.',               dur: 3000 },
    { text: null,                       dur: 4000 },
  ];

  startEndingHeartbeat();
  let idx = 0;

  function nextCard() {
    if (idx >= CARDS.length) {
      stopEndingHeartbeat();
      overlay.style.display = 'none';
      showMsg('win');
      return;
    }
    const card = CARDS[idx++];
    cardEl.innerHTML = card.text === null
      ? `<span class="ending-title">THE FLASH-STEP</span><span class="ending-sub">Thank you for playing</span>`
      : `<span class="ending-main">${card.text}</span>`;

    cardEl.style.transition = 'none';
    cardEl.style.opacity    = '0';
    void cardEl.offsetHeight;
    cardEl.style.transition = 'opacity 0.5s ease';
    cardEl.style.opacity    = '1';

    setTimeout(() => {
      cardEl.style.opacity = '0';
      setTimeout(nextCard, 520);
    }, Math.max(100, card.dur - 520));
  }

  nextCard();
}

function showMsg(type) {
  if (isMouseMode() && document.pointerLockElement) document.exitPointerLock();
  const el = document.getElementById('msgscreen');
  el.className = type;
  const dm = type === 'dead'
    ? (DEATH_MSGS[state.killedBy] || { title: 'CAUGHT', sub: 'It was waiting for you.' })
    : null;
  el.querySelector('.msg-title').textContent = type === 'dead' ? dm.title : 'ESCAPED';
  if (type === 'dead') {
    el.querySelector('.msg-sub').textContent  = dm.sub;
    el.querySelector('.msg-info').textContent =
      `BRIGHTNESS: ${Math.round(state.flashBrightness * 100)}%  ·  LEVEL ${state.level}`;
  } else {
    // Win: merged two-line summary, type name accented via the same data-type
    // pattern as the level intro card. Display-only — the save below is unchanged.
    el.dataset.type = state.levelType;
    el.querySelector('.msg-sub').innerHTML =
      `<span class="msg-type">${state.levelType}</span> COMPLETE`;
    el.querySelector('.msg-info').textContent =
      `LEVEL ${state.level} · BRIGHTNESS ${Math.round(state.flashBrightness * 100)}%`;
  }
  if (type === 'win' && state.level === 10) {
    el.querySelector('.msg-sub').textContent  = 'THE CYCLE IS COMPLETE';
    el.querySelector('.msg-info').textContent = '∞ ENDLESS MODE UNLOCKED';
  }
  el.classList.add('show');
  const retryBtn = document.getElementById('retry-btn');
  retryBtn.textContent = type === 'win' ? 'NEXT LEVEL' : 'TRY AGAIN';
  // PERMADEATH: one life — no retry on death; show the run-over verdict instead
  retryBtn.style.display = (type === 'dead' && state.mutators.permadeath) ? 'none' : '';
  const runoverEl = document.getElementById('msg-runover');
  if (runoverEl) {
    if (type === 'dead' && state.mutators.permadeath) {
      runoverEl.style.display = 'block';
      runoverEl.textContent   = `RUN OVER · REACHED LEVEL ${state.level}`;
    } else {
      runoverEl.style.display = 'none';
    }
  }
  const shareBtn = document.getElementById('share-btn');
  if (shareBtn) shareBtn.style.display = type === 'win' ? 'inline-block' : 'none';
  if (type === 'win') {
    state.winLevel   = state.level;
    state.winType    = state.levelType;
    state.winFlashes = state.flashesUsedThisLevel;
    if (!anyMutatorActive()) { // mutator runs never write the hiscore key
      const hs = loadHighScore();
      hs.maxLevel     = Math.max(hs.maxLevel || 0, state.level);
      hs.totalEscaped = (hs.totalEscaped || 0) + 1;
      if (state.level >= 4 && (hs.minFlashes === undefined || state.flashesUsedThisLevel < hs.minFlashes))
        hs.minFlashes = state.flashesUsedThisLevel;
      saveHighScore(hs);
      updateHiScoreDisplay();
    }
    state.level++;
    // Checkpoint: escaping a level unlocks the next one. Only ever advances (Math.max).
    writeGameSave(state.level, true);
  }
  // "Progress saved to Level X" reassurance — reflects the current checkpoint, if any.
  // (We never save on death; this just shows the checkpoint you already reached.)
  const savedEl = document.getElementById('msg-saved');
  if (savedEl) {
    const sv = loadGameSave();
    if (sv && sv.level > 1) {
      savedEl.style.display = 'block';
      savedEl.textContent   = `Progress saved to Level ${sv.level}`;
    } else {
      savedEl.style.display = 'none';
    }
  }
  // Death-screen run stats — display-only reads of values already tracked in
  // state (level, collected notes, ms survived this level). No new tracking.
  const statsEl = document.getElementById('msg-stats');
  if (statsEl) {
    if (type === 'dead') {
      statsEl.style.display = 'block';
      statsEl.textContent =
        `LEVEL ${state.level} · ${state.collectedNotes.length} NOTES · ${Math.round(state.levelTimer / 1000)}s SURVIVED`;
    } else {
      statsEl.style.display = 'none';
    }
  }
}

// ── Level intro card ──────────────────────────────────────────────────────────

function showLevelIntro() {
  const el = document.getElementById('level-intro');
  if (!el) return;
  const info = getLevelInfo(state.level);
  el.dataset.type = info.type; // presentation only — drives per-type accent color in CSS
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

  // Some types get a second flavor line that fades in late (GAUNTLET, VOID)
  const flavor2El = el.querySelector('.li-flavor2');
  if (flavor2El) {
    const line2 = FLAVOR2_TEXT[info.type];
    if (line2) {
      flavor2El.textContent   = line2;
      flavor2El.style.display = 'block';
      flavor2El.style.transition = 'none';
      flavor2El.style.opacity    = '0';
      void flavor2El.offsetHeight;
      flavor2El.style.transition = 'opacity 0.6s ease 0.9s';
      flavor2El.style.opacity    = '1';
    } else {
      flavor2El.textContent   = '';
      flavor2El.style.display = 'none';
    }
  }

  // New enemy arrival — shown only the first time each threshold is crossed
  const NEW_ENEMY_MSGS = { 3: '[ THE MIMIC HAS FOUND YOU ]', 5: '[ THE BLIND ONE WAKES ]', 7: '[ THEY ARE ALL HERE NOW ]' };
  const neEl = el.querySelector('.li-new-enemy');
  let extraMs = 0;
  if (neEl) {
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem('flashstep-intros') || '{}'); } catch(e) {}
    const msg = (!seen[state.level] && NEW_ENEMY_MSGS[state.level]) || null;
    if (msg) {
      seen[state.level] = true;
      try { localStorage.setItem('flashstep-intros', JSON.stringify(seen)); } catch(e) {}
      neEl.textContent = msg;
      neEl.style.opacity = '0';
      neEl.style.display = 'block';
      setTimeout(() => {
        neEl.style.transition = 'opacity 0.5s ease';
        neEl.style.opacity    = '1';
      }, 500);
      extraMs = 1200;
    } else {
      neEl.textContent = '';
      neEl.style.display = 'none';
    }
  }

  clearTimeout(el._ft);
  el._ft = setTimeout(() => {
    el.style.transition = 'opacity 0.8s ease';
    el.style.opacity    = '0';
    setTimeout(() => { el.style.display = 'none'; }, 820);
  }, 1900 + extraMs);
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
  smoothedMouseDelta = 0;
  Object.assign(state.dpad, { fwd: false, back: false, turnL: false, turnR: false });
  if (document.pointerLockElement) document.exitPointerLock();
  document.body.classList.add('paused');
  document.getElementById('pause-screen').classList.add('active');
  showPausePanel('pause-main');
  document.getElementById('howto-btn').style.display = 'flex';
  suspendAudio();
}

function resumeGame() {
  state.paused = false;
  document.body.classList.remove('paused');
  document.getElementById('pause-screen').classList.remove('active');
  document.getElementById('howto-btn').style.display  = 'none';
  document.getElementById('howto-overlay').style.display = 'none';
  resumeAudio();
}

// ── Bootstrap — must run before event listeners reference state.canvas ────────
state.canvas = document.getElementById('c');
state.ctx    = state.canvas.getContext('2d');
resize();
state.ctx.fillStyle = '#000';
state.ctx.fillRect(0, 0, state.W, state.H);
applyControlScheme();

// High score display + checkpoint CONTINUE button on main menu
updateHiScoreDisplay();
refreshMenuSaveUI();
// Share card button
document.getElementById('share-btn').addEventListener('click', generateShareCard);

// Attempt to load PNG sprites; falls back to procedural shapes if missing
loadSprites({
  battery:       'sprites/battery.png',
  note:          'sprites/note.png',
  rat:           'sprites/rat.png',
  door:          'sprites/door.png',
  web:           'sprites/web.png',
  bat:           'sprites/bat.png',
  jumpscareface: 'sprites/jumpscareface.png',
  stalker:       'sprites/stalker.png',
  mimic:         'sprites/mimic.png',
  blind:         'sprites/blind.png',
  footprint:     'sprites/footprint.png',
  spider:        'sprites/spider.png',
}).then(() => {
  const { loaded, failed } = getSpriteReport();
  console.log('[Sprites] Loaded:', loaded.join(', ') || 'none');
  if (failed.length) {
    console.warn('[Sprites] Procedural fallback for:', failed.join(', '));
    const crit = ['stalker', 'mimic', 'blind'].filter(k => failed.includes(k));
    if (crit.length) console.warn('[Sprites] WARNING — critical enemy sprites missing:', crit.join(', '));
  }
}).catch(() => {});

// ── Controls ──────────────────────────────────────────────────────────────────

function startFlash() {
  if (state.gameState !== 'playing') return;
  if (state.levelType === 'LIGHTS ON') {
    // Flash is repurposed as a 3 s blackout — a skill-based escape on a cooldown
    if (!state.blackoutActive && state.blackoutCooldown <= 0) {
      state.blackoutActive = true;
      state.blackoutTimer  = 3000;
      playShutter();
    }
    return;
  }
  if (state.cursedFlash) return;
  if (!state.flashHeld) {
    if (state.level >= 4) state.flashesUsedThisLevel++;
    if (state.cursedBurnCount > 0) state.cursedBurnCount--;
    if (Math.random() < 1 / 40) {
      // Cursed flash — single red frame then strobe begins
      state.cursedFlash      = true;
      state.cursedTimer      = 10000 + Math.random() * 2000;
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
  // Space / E dismisses an open note (it's already saved to the pause log)
  if (state.noteDisplay && (e.key === ' ' || e.key.toLowerCase() === 'e')) state.noteDisplay = null;
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault();
  if (e.key === ' ') startFlash();
});
// Any mouse click / screen tap also dismisses an open note
document.addEventListener('pointerdown', () => { if (state.noteDisplay) state.noteDisplay = null; });
document.addEventListener('keyup', e => {
  state.keys[e.key.toLowerCase()] = false;
  if (e.key === ' ') stopFlash();
});

const fb = document.getElementById('flash-btn');
fb.addEventListener('touchstart',  e => { e.preventDefault(); startFlash(); fb.classList.add('active'); },    { passive: false });
fb.addEventListener('touchend',    e => { e.preventDefault(); stopFlash();  fb.classList.remove('active'); }, { passive: false });
fb.addEventListener('touchcancel', e => { e.preventDefault(); stopFlash();  fb.classList.remove('active'); }, { passive: false });
fb.addEventListener('mousedown',  () => startFlash());
fb.addEventListener('mouseup',    () => stopFlash());

function dBtn(id, key) {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener('touchstart',  e => { e.preventDefault(); state.dpad[key] = true;  el.classList.add('pressed'); },    { passive: false });
  el.addEventListener('touchend',    e => { e.preventDefault(); state.dpad[key] = false; el.classList.remove('pressed'); }, { passive: false });
  el.addEventListener('touchcancel', e => { e.preventDefault(); state.dpad[key] = false; el.classList.remove('pressed'); }, { passive: false });
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
  document.getElementById('b-fwd').addEventListener('touchend',    () => { state.dpad.sprint = false; }, { passive: true });
  document.getElementById('b-fwd').addEventListener('touchcancel', () => { state.dpad.sprint = false; }, { passive: true });
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
state.canvas.addEventListener('touchcancel', e => {
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

function getBrightSpeedMult() {
  if (!state.flashHeld || state.flashAlpha < 0.05) return 1.0;
  const b = state.flashBrightness;
  return b > 0.7 ? 1.6 : b > 0.4 ? 1.3 : 1.0;
}

function showHint(text, ms) {
  state.hintText  = text;
  state.hintTimer = ms;
}

// THE VOID — step along a ray from the player until it hits a wall/boundary cell,
// returning the distance (capped at 4 units). Used for the wall-proximity sonar.
function voidWallDist(angle) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  for (let d = 0.1; d <= 4; d += 0.1) {
    const cx = (state.P.x + dx * d) | 0, cy = (state.P.y + dy * d) | 0;
    if (cx < 0 || cy < 0 || cx >= state.COLS || cy >= state.ROWS) return d;
    if (state.MAP[cy][cx] !== 0) return d;
  }
  return 4;
}

// ── Maze Master intercom — queue + display state machine ────────────────────────
function fireIntercom(text) {
  state.intercomQueue.push(text);
}
function updateIntercom(dt) {
  // Advance the line currently showing (fade in 300 / hold 3000 / fade out 800)
  if (state.intercomMsg) {
    const im = state.intercomMsg;
    im.elapsed += dt;
    const fadeIn = 300, hold = 3000, fadeOut = 800, total = fadeIn + hold + fadeOut;
    if (im.elapsed < fadeIn)              im.alpha = im.elapsed / fadeIn;
    else if (im.elapsed > fadeIn + hold)  im.alpha = Math.max(0, 1 - (im.elapsed - fadeIn - hold) / fadeOut);
    else                                  im.alpha = 1;
    if (im.elapsed >= total) state.intercomMsg = null;
  }
  // Never overlap: only start the next queued line once the current one finishes
  if (!state.intercomMsg && state.intercomQueue.length) {
    state.intercomMsg = { text: state.intercomQueue.shift(), elapsed: 0, alpha: 0 };
    playIntercom();
  }
}

function startLevelAmbient() {
  if (state.levelType === 'REFLECTION') startReflectionAmbient(); else startAmbient();
}
function stopLevelAmbient() { stopAmbient(); stopReflectionAmbient(); }

function hallucinSafeCheck() {
  if (state.paused || state.gameState !== 'playing') return false;
  if (state.levelTimer < 60000) return false; // no hallucinations in first 60 s
  if (!state.E.active) return true;
  const dx = state.P.x - state.E.x, dy = state.P.y - state.E.y;
  return dx * dx + dy * dy >= 9; // >= 3 units from stalker
}
function hallucinTriggerVignette() { state.hallucinVignette = 1.0; }

// ── Mutators — post-game challenge modifiers ──────────────────────────────────
// Menu selection lives here until run start; applies to that run only (never
// persisted). Unlock condition: hiscore maxLevel ≥ 10 (game beaten once).
const pendingMutators = { blindMap: false, permadeath: false };
function anyPendingMutator() {
  return pendingMutators.blindMap || pendingMutators.permadeath;
}
function wireMutatorToggle(id, key) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('click', () => {
    pendingMutators[key] = !pendingMutators[key];
    btn.setAttribute('aria-pressed', String(pendingMutators[key]));
  });
}
wireMutatorToggle('mut-blindmap',   'blindMap');
wireMutatorToggle('mut-permadeath', 'permadeath');

// Start a run at startLevel with the given control scheme. notes seeds the run's
// collected-notes log (from a save when continuing, [] for a new game).
function beginRun(scheme, startLevel, notes) {
  settings.controlScheme = scheme;
  saveSettings();
  getAudio();
  // Mutators: snapshot the menu selection for this run. PERMADEATH always
  // starts fresh at level 1 — the checkpoint is read-only for mutator runs.
  state.mutators = { ...pendingMutators };
  if (state.mutators.permadeath) { startLevel = 1; notes = []; }
  const mutTag = document.getElementById('mutator-tag');
  if (mutTag) {
    const names = [];
    if (state.mutators.blindMap)   names.push('BLIND MAP');
    if (state.mutators.permadeath) names.push('PERMADEATH');
    mutTag.textContent   = names.join(' · ');
    mutTag.style.display = names.length ? 'block' : 'none';
  }
  state.collectedNotes  = Array.isArray(notes) ? notes.slice() : [];
  // Run-scoped intercom lines (fire at most once per run)
  state.imLevel5Fired   = false;
  state.imGauntletFired = false;
  document.getElementById('menu').classList.add('hidden');
  initGame(startLevel); state.gameState = 'playing'; state.lastTime = performance.now();
  applyControlScheme();
  startLevelAmbient(); startExitHum();
  startHallucinations(hallucinSafeCheck, hallucinTriggerVignette);
  state.frameId = requestAnimationFrame(loop);
}

// Switch which menu sub-panel is visible (covers all panels incl. the continue one)
function showMenuPanel(id) {
  document.querySelectorAll('#menu .menu-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// Show/hide CONTINUE + relabel the play buttons based on whether a save exists
function refreshMenuSaveUI() {
  const save      = loadGameSave();
  const has       = !!(save && save.level > 1);
  const contBtn   = document.getElementById('btn-continue');
  const startover = document.getElementById('btn-startover');
  const pcBtn     = document.getElementById('btn-pc');
  const mobileBtn = document.getElementById('btn-mobile');
  if (has) {
    contBtn.style.display = 'flex';
    contBtn.querySelector('.continue-main').textContent = `CONTINUE · LEVEL ${save.level}`;
    contBtn.querySelector('.continue-sub').textContent  = `${save.totalEscapes || 0} levels escaped`;
    pcBtn.innerHTML     = '🖥&nbsp; NEW GAME · PC';
    mobileBtn.innerHTML = '📱&nbsp; NEW GAME · MOBILE';
    startover.style.display = 'block';
  } else {
    contBtn.style.display = 'none';
    pcBtn.innerHTML     = '🖥&nbsp; PLAY ON PC';
    mobileBtn.innerHTML = '📱&nbsp; PLAY ON MOBILE';
    startover.style.display = 'none';
  }
  // Mutators unlock once the game has been beaten. Condition: hiscore
  // maxLevel ≥ 10 — recorded on every win and never cleared, unlike the
  // checkpoint save, so "start over" can't re-lock the section.
  const mutSection = document.getElementById('mutators-section');
  if (mutSection) mutSection.style.display =
    (loadHighScore().maxLevel || 0) >= 10 ? 'block' : 'none';
}

// Return to the main menu (used by both pause-quit and death-screen quit)
function goToMenu() {
  stopLevelAmbient(); stopExitHum(); stopHallucinations();
  document.getElementById('howto-overlay').style.display = 'none';
  document.getElementById('msgscreen').classList.remove('show');
  resumeGame();                      // clears paused state + unsuspends audio
  state.gameState = 'menu';
  document.getElementById('menu').classList.remove('hidden');
  showMenuPanel('menu-main');
  refreshMenuSaveUI();
}

// New game (level 1) — overwrites/clears any existing save.
// SAVE SAFETY: a mutator run must leave the checkpoint exactly as-is, so the
// pre-run clear is skipped whenever any mutator is selected.
document.getElementById('btn-pc').addEventListener('click',     () => { if (!anyPendingMutator()) clearGameSave(); beginRun('mouse', 1, []); });
document.getElementById('btn-mobile').addEventListener('click', () => { if (!anyPendingMutator()) clearGameSave(); beginRun('touch', 1, []); });

// CONTINUE — choose controls, then resume at the saved level with restored notes
document.getElementById('btn-continue').addEventListener('click', () => {
  const save = loadGameSave();
  const info = document.querySelector('#menu-continue .continue-info');
  if (info && save) info.textContent = `Resume at Level ${save.level} · ${save.totalEscapes || 0} escaped`;
  showMenuPanel('menu-continue');
});
document.getElementById('btn-cont-pc').addEventListener('click', () => {
  const save = loadGameSave() || { level: 1, notes: [] };
  beginRun('mouse', Math.max(1, save.level || 1), save.notes);
});
document.getElementById('btn-cont-mobile').addEventListener('click', () => {
  const save = loadGameSave() || { level: 1, notes: [] };
  beginRun('touch', Math.max(1, save.level || 1), save.notes);
});
document.getElementById('btn-cont-back').addEventListener('click', () => showMenuPanel('menu-main'));

// "start over" — clear the save and begin fresh at level 1 (uses the remembered scheme)
document.getElementById('btn-startover').addEventListener('click', () => {
  if (!anyPendingMutator()) clearGameSave(); // mutator runs never touch the save
  beginRun(isMouseMode() ? 'mouse' : 'touch', 1, []);
});

document.getElementById('retry-btn').addEventListener('click', () => {
  document.getElementById('msgscreen').classList.remove('show');
  initGame(); state.gameState = 'playing'; state.lastTime = performance.now();
  applyControlScheme();
  startLevelAmbient(); startExitHum();
  startHallucinations(hallucinSafeCheck, hallucinTriggerVignette);
});

// Death/win screen → quit to menu, saving current level so quitting never loses progress
document.getElementById('msg-quit').addEventListener('click', () => {
  writeGameSave(state.level, false);
  goToMenu();
});

// ── Pause panel buttons ────────────────────────────────────────────────────────

document.getElementById('pause-resume').addEventListener('click', resumeGame);

document.getElementById('pause-notes-btn').addEventListener('click', () => {
  const list = document.getElementById('pause-notes-list');
  list.innerHTML = state.collectedNotes.length === 0
    ? '<p class="notes-empty" style="color:#666666">No notes found yet.</p>'
    : state.collectedNotes.slice().sort((a, b) => a - b)
        .map(lvl => {
          const master = noteType(lvl) === 'master';
          const col    = master ? '#c8d8e8' : '#e8c87a';
          const hdr    = master ? `[ OBSERVATION LOG · LEVEL ${lvl} ]` : `[ FOUND NOTE · LEVEL ${lvl} ]`;
          const font   = master ? "font-family:'Share Tech Mono',monospace;" : '';
          return `<div class="note-entry"><span class="note-lvl" style="color:${col}">${hdr}</span><p class="note-body" style="color:${col};${font}">${getNoteText(lvl)}</p></div>`;
        })
        .join('');
  showPausePanel('pause-notes');
});
document.getElementById('pause-notes-back').addEventListener('click', () => showPausePanel('pause-main'));

document.getElementById('pause-options-btn').addEventListener('click', () => {
  document.getElementById('p-opt-volume').value = settings.masterVolume;
  document.getElementById('p-opt-flash').value  = settings.flashFade;
  document.getElementById('p-opt-sens').value   = settings.mouseSens;
  syncPauseShake();
  syncPauseGrain();
  showPausePanel('pause-opts');
});

document.getElementById('pause-opts-back').addEventListener('click', () => showPausePanel('pause-main'));

document.getElementById('howto-btn').addEventListener('click', () => {
  document.getElementById('howto-overlay').style.display = 'flex';
});

document.getElementById('pause-quit').addEventListener('click', () => {
  writeGameSave(state.level, false);              // save progress before leaving
  const btn = document.getElementById('pause-quit');
  if (btn._t) return;                             // ignore re-clicks during the confirm
  const orig = btn.textContent;
  btn.textContent = anyMutatorActive() ? 'NO SAVE.' : 'SAVED.'; // mutator runs don't write
  btn._t = setTimeout(() => { btn._t = null; btn.textContent = orig; goToMenu(); }, 800);
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
document.getElementById('p-opt-grain').addEventListener('click', () => {
  settings.grain = !settings.grain;
  syncPauseGrain();
  saveSettings();
});
document.getElementById('p-opt-sens').addEventListener('input', e => {
  settings.mouseSens = parseFloat(e.target.value);
  saveSettings();
});

function syncPauseShake() {
  const btn = document.getElementById('p-opt-shake');
  btn.textContent = settings.screenshake ? 'ON' : 'OFF';
  btn.setAttribute('aria-pressed', String(settings.screenshake));
}

function syncPauseGrain() {
  const btn = document.getElementById('p-opt-grain');
  btn.textContent = settings.grain ? 'ON' : 'OFF';
  btn.setAttribute('aria-pressed', String(settings.grain));
}


