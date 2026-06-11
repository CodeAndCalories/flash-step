# FLASH-STEP — Read-Only Code Audit

Audit date: 2026-06-11 · Commit: `eb74fa4` (checkpoint save system) · ~5,650 lines of code+markup, 12 sprite PNGs.
No files were modified. This document is the only new file.

---

## 1. FILE MAP

| File | Lines | Role | Imported / loaded by |
|---|---|---|---|
| `index.html` | 311 | DOM shell: canvas, HUD elements, all overlay screens (menu, pause, death, intro, notes, ending, how-to, photosensitivity warning), mobile control buttons | — (entry point; loads `style.css`, `js/menu.js`, `js/game.js`) |
| `style.css` | 624 | All styling: HUD, menus, pause, note paper, intro card, ending, how-to, mobile controls, photosensitivity screen | `index.html` |
| `js/state.js` | 123 | Single mutable `state` object — every runtime variable (player, enemies, timers, flags) | `game.js`, `renderer.js`, `enemy.js` |
| `js/settings.js` | 21 | `settings` object + auto-load/save to localStorage `flashstep-settings` | `game.js`, `menu.js` |
| `js/maze.js` | 71 | `genMaze` (recursive backtracker + 28% loop carving), `findDeadEnds`, `bfs`, `shuf` | `game.js`, `enemy.js` |
| `js/enemy.js` | 111 | BFS-greedy step functions (`stepEnemy`, `stepMimic`, `stepBlindOne`, `stepEntity`), `checkEnd` (kill/win check), `isWall` (player collision) | `game.js` |
| `js/renderer.js` | 1,248 | `draw()` — the entire frame: raycast, walls, sprites, overlays, minimap, jump scare; sprite cache (`loadSprites`/`getSprite`) | `game.js` |
| `js/audio.js` | 799 | 100% procedural WebAudio: SFX, ambient wind/drips, exit hum, panic audio, hallucination scheduler, intercom, VOID sonar | `game.js`, `menu.js` |
| `js/game.js` | 1,846 | Main loop, level generation/config, input (keyboard/mouse/touch), UI updates, save/high-score, death replay, level-10 ending, menu↔game wiring | `index.html` |
| `js/menu.js` | 90 | Photosensitivity warning, main-menu panel navigation, main-menu options controls | `index.html` |
| `SPRITES.md` | 85 | Sprite authoring spec / pipeline docs | — (docs) |
| `.gitignore` | 21 | Windows/VS Code/Node ignores + `.claude/` | — |
| `sprites/*.png` | 12 files | Optional art; missing files fall back to procedural shapes. Sizes: door **1.53 MB**, jumpscareface **1.15 MB**, others 24–115 KB | loaded at runtime by `game.js:1467` `loadSprites()` |

Import graph (all one-directional, no cycles):

```
index.html ─→ menu.js ─→ settings.js, audio.js
           └→ game.js ─→ state.js, settings.js, audio.js, maze.js, renderer.js, enemy.js
                          renderer.js ─→ state.js
                          enemy.js    ─→ state.js, maze.js
```

localStorage keys: `flashstep-save` (checkpoint), `flashstep-settings`, `flashstep-hiscore`, `flashstep-intros` (one-time new-enemy banners). sessionStorage: `photoWarningSeen`.

---

## 2. RENDERING PIPELINE

Everything happens in `renderer.js draw(lit, bob, outline)`, called once per `requestAnimationFrame` from `game.js loop()` (game.js:883). `lit` is the effective light level computed at game.js:880–882 (`flashAlpha` or lingering `flashDecay * 0.32`, times `flashBrightness`; forced to 1.0 in LIGHTS ON, 0 during blackout).

**Resolution/scaling:** canvas is set to `window.innerWidth × innerHeight` in CSS pixels (game.js:114 `resize()`). `devicePixelRatio` is **ignored** — on high-DPI screens the canvas is upscaled by the browser (slightly soft, but cheap; this is a deliberate-looking perf tradeoff). Horizontal ray resolution is fixed at **NR = 240 columns** (renderer.js:69) regardless of screen width; each column is `cw = W/240` px wide, so walls are visibly chunky on wide monitors. FOV = π/2.3, max ray distance MAXD = 18.

Frame order:

1. **Shake transform** — `ctx.translate(shakeX·amt, shakeY·amt)`; `shakeAmt` decays 0.045 *per frame* (frame-rate dependent — see §4). Black fill over the whole canvas (slightly oversized for shake margins).
2. **Ceiling/floor** (only when `lit > 0`) — two vertical `createLinearGradient`s split at `H/2 + headbob`, tinted per wall theme. Themes by level: dungeon (≤3), sewer (4–6), cave (7–9), "wrong" (10+, slowly color-cycles via `Date.now()`), reflection (REFLECTION type override) — `getWallTheme()` renderer.js:71.
3. **Raycast loop** (renderer.js:188–232) — 240 DDA rays (`cast()`, max 100 steps), **always runs even in darkness** to fill the depth buffer `zb` (Float32Array) plus `wallTops`/`wallWHs`. Fisheye-corrected (`dist · cos(ra − P.angle)`). Per column when lit: brightness `pow(1 − corr/effMXD, 1.08) · lit` where `effMXD = MAXD · flashBrightness` (battery pickups literally extend visible range); side-wall shading ×0.72; a fake "mortar" dark stripe at wall-x 0.47–0.53; theme-specific RGB ramps (cave adds per-column sine noise, "wrong" pulses red/blue). Goal cells (`MAP === 2`) render as the pulsing green door. **THE VOID:** wall slices are skipped entirely (walls invisible) but `zb` is still written so sprite depth-testing works; the goal still draws (renderer.js:204 comment).
4. **Exit door dressing** — `door.png` stretched over the goal columns, green frame bars, 6 rising particles.
5. **Theme extras** — sewer: 5 random drip pixels/frame; **REFLECTION: a full second 240-ray raycast pass** facing backwards, drawn at alpha 0.20 as a ghost mirror (renderer.js:266–284).
6. **Moss edge lines** — 2 px floor/ceiling edge strips per column, drawn **every frame even in darkness** (480 fillRects).
7. **Web overlays + spider sprites** — screen-blend, distance/angle culled, single-column depth test.
8. **Outline afterglow** (flash released) — **re-casts all 240 rays a second time** (renderer.js:356–375) to draw lingering wall edges. Skipped in VOID.
9. **World sprites**, each hand-rolled with the same pattern (project angle→screen X, perspective height `H·1.65/dist`, per-column clip region built from `zb`): breadcrumb footprints (player trail; brighter in VOID where they're the nav aid), battery pickups (ambient amber glow visible in dark + lit sprite + floor pool gradient), exit ambient green glow (≤4.5 units, works in dark), collectible note, rat scare, decoy eyes (dark-only, fade on approach), **Stalker** (dark-range eye glow + lit sprite with level-bracket "evolution" — hunch/width/glitch params from `getEvoParams`), afterimages (silhouette + deterministic grain, captured on flash release), REFLECTION ghost-player overlay, **Mimic** (screen-blend pale sprite, white eyes), **Blind One** (lit-only, no dark tell — intentional), **extra stalkers** (a ~70-line near-copy of the Stalker block with pink eyes).
10. **Post effects** — cursed-flash red wash + edge burn; camera-burn tint; main vignette (radial gradient) + white flash burst (first 13% of decay) + **scanlines: one `fillRect` per 3 rows of screen height every lit frame** (~360 calls at 1080p); proximity danger vignette (Stalker/Mimic distance, pulses even in dark); panic vignette (3 escalation levels); web-hit vignette; hallucination vignette.
11. **Minimap** (4 s after first flash, not in VOID) — full grid redraw per frame, shows walls, exit outline, player, all enemies, batteries, webs, note.
12. Restore transform; then **bat flyby** (screen-space, sprite-sheet 3-frame or procedural) and **jump scare** (`drawJumpScare`: red wash, procedural face, fixed-geometry cracks, `jumpscareface.png` screen-blended on top) — both outside the shake transform.

Separate render paths that bypass `draw()`: the **death replay** (game.js:1150 `renderTopDownReplay` — animated top-down trail map, "THIS IS WHERE IT FOUND YOU") and the **level-10 ending** (pure DOM/CSS cards).

---

## 3. UI INVENTORY

| Screen / element | HTML | CSS | JS logic |
|---|---|---|---|
| Photosensitivity warning (session-once, 4 s auto-dismiss) | `#photo-warning` index.html:34 | style.css:60–94 | menu.js:8–26 |
| Main menu (title, CONTINUE, PC/Mobile play, start-over link, hi-score) | `#menu` / `#menu-main` index.html:50 | style.css:96–195 | menu.js (panel nav) + game.js:1700–1760 (save UI, begin-run buttons) |
| Options panel (volume, flash fade, shake, sensitivity) | `#menu-options` index.html:81 | style.css:197–232 | menu.js:51–89 |
| Exit panel | `#menu-exit` index.html:117 | style.css:234–236 | menu.js |
| Continue panel (PC/Mobile resume) | `#menu-continue` index.html:124 | shared menu styles | game.js:1740–1754 |
| How-to-play overlay (shared by menu + pause) | `#howto-overlay` index.html:260 | style.css:528–575 | menu.js:47–49, game.js:1807 |
| In-game HUD: brightness bar + VISIBLE warning, level, MOVING dot, notes counter, level-type, per-type warnings (LIGHTS ON / blackout / SILENCE / VOID / cursed / spawn), distance readout | `#ui` index.html:11–31 | style.css:7–20, 318–410, 598–614 | game.js:887–1015 `updateUI()` (runs every frame) |
| Crosshair | `#crosshair` SVG index.html:213 | style.css:51 | hidden while paused via CSS |
| Mobile controls: d-pad (fwd/back), turn buttons, FLASH button; double-tap-fwd sprint; swipe-look strip | `#dpad` `#turn-btns` `#flash-btn` index.html:220–228 | style.css:38–49 | game.js:1544–1596 |
| Stamina bar | `#stamina-bar` index.html:230 | style.css:240–246 | game.js:1006–1015 |
| Collectible note display (typewriter, survivor vs. master skins, monitor-flicker animation) | `#note-display` index.html:232 | style.css:248–305 | game.js:583–613 (timers) + 917–937 (DOM) |
| Maze Master intercom line | `#intercom-msg` index.html:240 | style.css:307–316 | game.js:1640–1660 queue/state machine |
| Hint display (level-1 onboarding) + flash tooltip | `#hint-display` `#flash-tooltip` index.html:242,247 | style.css:322–327, 616–624 | game.js:367–379, 996–1002 |
| Mouse-capture prompt | `#mouse-prompt` index.html:249 | style.css:468–479 | game.js:913–915 |
| Pause screen (main / options / notes panels) + `?` how-to button | `#pause-screen` index.html:136–189, `#howto-btn` :245 | style.css:412–459, 577–596 | game.js:1422–1450, 1778–1844 |
| Level intro card (LEVEL n, type slam, flavor ×2, cycle, new-enemy banner) | `#level-intro` index.html:192 | style.css:330–386 | game.js:1335–1404 |
| Death/win screen (title, sub, info, retry, saved-note, share, quit) | `#msgscreen` index.html:203 | style.css:29–36 | game.js:1283–1331 `showMsg` |
| Death replay (canvas-rendered top-down) | — (canvas) | — | game.js:1093–1235 |
| Level-10 ending card sequence | `#ending-seq` index.html:255 | style.css:481–523 | game.js:1239–1281 |
| Minimap, share card | — (canvas) | — | renderer.js:1057–1106; game.js:1059–1089 |

Notable: the options panel exists **twice** (menu and pause) with parallel element IDs (`opt-*` vs `p-opt-*`) and duplicated wiring (menu.js:64–89 vs game.js:1821–1844).

---

## 4. PERFORMANCE NOTES

Delta time is handled correctly overall: `loop()` clamps `dt` to 50 ms and all gameplay timers/accumulators are dt-based. The exceptions and hot spots:

**Per-frame allocations (GC pressure)**
- `zb`, `wallTops`, `wallWHs` — three Float32Arrays allocated **every frame** (renderer.js:184–185). Could be module-level reused buffers.
- 10–20 `createRadialGradient`/`createLinearGradient` objects per lit frame (ceiling, floor, every battery glow, every enemy-eye pair ×2 gradients, exit glow, note glow, 4–6 vignettes, jump scare). Gradients are the most expensive canvas paint objects to construct.
- ~240+ template-string `fillStyle` allocations per frame in the ray loop (`rgb(${r},${g},${b})` per column), plus more in every sprite block.
- `state.replayBuffer` snapshot every 100 ms allocates an object + `extras` array via `.map()`.

**Redundant work in the render loop**
- The **outline afterglow re-raycasts all 240 rays** every frame it's visible (renderer.js:358–365), even though `wallTops`/`wallWHs` from the main pass hold nearly the same data (only difference: afterglow uses fixed MAXD and wallH 0.9).
- **REFLECTION runs a complete second raycast pass per frame** (renderer.js:268) — REFLECTION levels do ~2× the ray work, plus the ghost overlay. Worst frame: REFLECTION + afterglow = 3 full casts.
- **Scanlines** draw `H/3` individual fillRects per lit frame (renderer.js:1006). A pre-rendered pattern canvas drawn once would be ~1 call.
- **Moss edge lines**: 480 fillRects per frame even in total darkness (renderer.js:294–300).
- `Date.now()` is called ~12 separate times per frame in renderer.js; only partially cached in `now` (renderer.js:423).
- `updateUI()` (game.js:887) runs ~25 `getElementById` lookups and unconditional `textContent`/`style` writes **every frame**. Browsers dedupe identical writes cheaply, but element lookups could be cached once at boot, and writes gated on change.
- Minimap redraws the entire cell grid (up to 35×35 = 1,225 fillRects) per frame while visible — bounded by the 4 s timer, so acceptable.

**Frame-rate-dependent math (not dt-scaled)**
- Mouse smoothing lerp `smoothedMouseDelta += (raw − smoothed) * 0.18` (game.js:495) — turn feel differs between 60 Hz and 144 Hz displays.
- `shakeAmt -= 0.045` per frame in renderer.js:146 — shake duration halves at 120 fps (the comment at game.js:545 acknowledges the coupling).
- Stalker-sprite glitch double-draw uses `Math.random() < 0.15` per frame — flicker rate scales with fps (cosmetic).

**Enemy AI cost (do not change — flagged for awareness only)**
- Every enemy step runs a **full BFS flood of the maze** (`bfs()` allocates `rows` Int32Arrays per call; `q.shift()` is O(n) making it O(n²)-ish on 35×35 mazes). At panic level 3 (150 ms steps) with a GAUNTLET's 3+3 enemies, that's ~40 BFS floods/sec. Fine on desktop; the single biggest CPU spike risk on low-end mobile. Any optimization here touches enemy AI behavior — **out of scope per the rules**.

**Bounded vs. unbounded arrays** — all good: `crumbs` capped 250 (60 VOID, plus 25 s expiry), `afterimages` filtered on alpha, `replayBuffer` capped 80, `playerHistory` capped 40, `intercomQueue` only ever gets a handful of scripted lines. `state.keys` accumulates one entry per distinct key pressed (harmless).

**Mobile-specific risks**
- The gradient count per frame is the main mobile GPU/CPU cost; radial gradients are notably slow on older Android GPUs.
- `door.png` is **1.53 MB** and `jumpscareface.png` **1.15 MB** — together ~2.7 MB of the ~3.5 MB total payload, on a GitHub Pages game with no preloading UI. On slow connections the door/jumpscare render procedurally until decode completes (graceful, but the jumpscare PNG arriving late changes the death moment). Re-exporting/quantizing these two PNGs would cut load time ~70% with zero code change.
- `requestAnimationFrame` loop **keeps running after quitting to menu** (goToMenu never cancels `frameId`; the loop early-returns on `gameState !== 'playing'` each frame). Trivial CPU but wakes the device every frame while idling in the menu.
- Audio schedulers (`scheduleDrip`, `scheduleWindMoan`, `scheduleHallucination`) keep their `setTimeout` chains alive while paused; the suspended AudioContext means nothing audible happens, and the `hallucinGen` generation counter correctly prevents stale-closure leaks. OK as-is.

---

## 5. CODE HEALTH

**Dead / vestigial code (verified by grep)**
- `style.css:54–58` — `.low-battery`, `.flash-draining` classes and `low-batt`/`drain-pulse` keyframes are never applied by any JS. Leftovers from the old limited-flash system.
- `style.css:526` — `#s-level.endless` style is never applied; game.js:905 sets `textContent = '∞ ENDLESS'` but never adds the class, so endless mode shows red, not the intended blue.
- `renderer.js:48 drawSprite()` — exported, documented in SPRITES.md as *the* sprite API, but **never called**; every sprite draw in renderer.js is hand-rolled. Misleading for future contributors.
- `state.flashCount` (state.js:18, set to `Infinity` at game.js:231) — vestigial from limited flashes.
- game.js:1003 comment says "BATTERIES NOW LIMITED warning" but `#s-limited`'s actual text is "BRIGHTER = MORE DANGEROUS" — stale comment.
- index.html has **no `<title>`, no `<meta charset>`, no favicon** — tab shows the raw URL and charset is guessed by the browser (emoji in the HUD have worked by luck of UTF-8 default).

**Duplicated logic**
- `enemy.js` — `stepEnemy`, `stepMimic`, `stepEntity` are byte-for-byte identical except for which entity they move; `stepBlindOne` differs only in target selection. `stepEntity(ent)` already generalizes the pattern.
- `renderer.js` — `enemyScreen`, `mimicScreen`, `blindScreen` are identical except the entity read. The extra-stalker render block (renderer.js:911–979) is a ~70-line copy of the main Stalker block with `es` prefixes. Angle normalization (`while (a > π) ...`) is hand-repeated ~14 times.
- Options panel wiring duplicated across menu.js and game.js (two slider sets, `syncShakeBtn` vs `syncPauseShake`).
- These are *flagged, not fixed* — consolidation would be a pleasant refactor but touches enemy/render code paths.

**Magic numbers** (worth a constants block someday): kill radius 0.52 (enemy.js), pickup radii 0.36/0.25, projection constant `H * 1.65` (~18 occurrences), sprite cull margin `HFOV * 1.35`, stalker-moves gate `flashAlpha > 0.04`, brightness-speed thresholds 0.4/0.7 (game.js:1620), VOID sonar 3.0-unit range, blackout 3000/20000 ms.

**Fragile spots — handle with care**

- **Save path (game.js:1018–1039, 1296–1330).** The invariant chain is: win → `showMsg('win')` → `state.level++` → `writeGameSave(state.level, true)`. The save stores the *next* level. `writeGameSave` is read-modify-write with `Math.max` so level never regresses; `clearGameSave` only on explicit new game / start-over. Both quit buttons also save (`msg-quit` game.js:1771, `pause-quit` game.js:1811). **Any reordering of the `level++` relative to `writeGameSave`, or any second code path that increments level, will corrupt checkpoints.** Notes are saved as level numbers and re-resolved through `getNoteText(lvl % 20)` — safe across the modulo wrap, but changing `NOTE_TEXTS` length or order silently rewrites every previously collected note.
- **Level-10 ending (game.js:864, 1239–1281).** Triggered only by `result === 'win' && state.level === 10` — i.e. exactly once per save unless the save is cleared. `showMsg('win')` (which does the level++ *and the checkpoint save*) runs only **after** the 16-second card sequence completes. If the player closes the tab or anything throws during the cards, level 10's escape is never saved. The card sequence is driven by nested `setTimeout` with no cancellation handle, so navigating to menu mid-sequence (currently impossible via UI, but any new "skip" button would change that) would leave `nextCard` timers firing into a dead overlay. **Any change to showMsg, the win flow, or overlay z-indexes risks this sequence.**
- **`ENEMY_MS` shared-write hazard (game.js).** Three systems write `state.ENEMY_MS`: panic escalation/decay (394–428), cursed flash (432–458), LIGHTS ON setup (178). They coordinate only through `baseEnemyMS` and careful ordering inside `loop()`. Cursed flash also force-sets `flashHeld = true`, which feeds the panic system. Visual-only changes are safe; anything touching these blocks risks compounding speed bugs.
- **VOID rendering contract (renderer.js:201–204).** Walls invisible but `zb` must still be filled, and the goal must still draw. Any wall-rendering change (fog, textures) must preserve the `state.levelType !== 'VOID' || goal` branch or VOID becomes unplayable/trivial.
- **LIGHTS ON lighting contract (game.js:461–475, 880–882).** `rawLit` is forced to 1.0/0 outside the normal flash math. Lighting changes in `draw()` must treat `lit === 1` with `flashHeld === false` as a valid steady state (e.g., don't key new effects off `flashHeld`).
- **Photosensitivity coupling.** The cursed flash strobes at ~4 Hz (game.js:437) — already in the sensitive band the warning screen exists for. Any new flicker/strobe/grain effect should stay below ~3 Hz or be tied to the same warning.
- Minor: in `draw()`, `const es = enemyScreen()` (renderer.js:672) is later shadowed by `for (const es of state.extraStalkers)` (renderer.js:911) — legal but a refactor trap.
- Minor: floor fill `ctx.fillRect(0, H/2+hs, W, H)` (renderer.js:181) over-draws by half a screen (height should be `H/2 − hs`); harmless but confusing.

**Questions (noted rather than guessed)**
- `enemy.js stepBlindOne`: in wander mode it takes the *first* passable shuffled direction every step — it can oscillate between two cells. Intentional "aimless" behavior or accident? Flagged as a question; do not change (enemy AI).
- Minimap shows live positions of *all* enemies (renderer.js:1075–1091) for the full 4 s window — generous intel for a horror game. Intentional design choice? (It reads deliberate given the "first flash shows a map" menu copy.)
- `getLevelInfo` priority comment says "REFLECTION > VOID > LIGHTS ON", and level 28 matches both REFLECTION (28 % 7 = 0) and VOID ((28−10) % 9 = 0) — REFLECTION wins. Levels 14, 21, 35 also collide with the 4-step cycle. Assumed intentional.

---

## 6. POLISH OPPORTUNITIES

Ranked by impact-per-risk. All achievable inside the current canvas raycaster — no engine change. "Gameplay" = whether it touches gameplay-relevant logic at all (visibility, speed, save, AI).

| # | Upgrade | What it is | Files | Risk | Gameplay? |
|---|---|---|---|---|---|
| 1 | **Flashlight cone falloff** | Scale per-column brightness by angular distance from screen center (`cos`-weighted), so the flash reads as a beam instead of a uniform floodlight. One multiply inside the existing ray loop. | renderer.js (ray loop ~205) | Low | **Slightly** — edge-of-screen visibility drops; enemies at the periphery get harder to spot. Tune gently; exempt LIGHTS ON (`lit === 1` steady state) and the goal columns. |
| 2 | **Per-theme distance fog** | Instead of shading to black, lerp wall/sprite color toward a per-theme fog tint (green-grey sewer, warm cave, blue reflection, red "wrong"). Massive atmosphere gain for ~10 lines. | renderer.js | Low | No — same visibility curve, different color. Keep VOID branch untouched. |
| 3 | **Film grain overlay** | Pre-render 3–4 small noise canvases at boot; each frame draw one tiled at low alpha (2–6%, scaled with darkness for dark-grain). Replaces nothing; one `drawImage`. Cheaper than the current scanline loop. | renderer.js | Low | No. Keep static (no strobing) for photosensitivity. |
| 4 | **Scanline pass replacement** | Replace the ~360 per-frame fillRects with one pre-rendered pattern canvas + single `drawImage`. Identical look, frees frame budget for #1–3. | renderer.js:1005–1006 | Low | No |
| 5 | **Color grading per level type** | One full-screen composite pass at the end of `draw()`: a cached gradient/tint per level type (e.g. `'overlay'` or `'soft-light'` composite fill — sewer sickly green, REFLECTION cold blue, "wrong" pulsing crimson). Single fillRect. | renderer.js (end of draw) | Low | No — but verify jump scare & death replay aren't tinted (they draw after/outside; keep it that way). |
| 6 | **Damage/proximity screen effects** | On near-miss (proximity < 1.5): brief chromatic-aberration fake (draw the frame's edges twice with ±1 px offset in red/blue via two low-alpha strokes), plus heartbeat-synced vignette throb (sync the existing proximity vignette to `playHeartbeat` timing). | renderer.js, game.js (read-only of existing distances) | Med | No new logic — reads existing `pd`. Keep flash rate < 3 Hz. |
| 7 | **HUD redesign** | Consolidate the center warning stack (currently 8 separate divs that can stack awkwardly) into one prioritized slot; animate brightness-bar changes (pulse on battery pickup); fix the dead `#s-level.endless` class so endless mode gets its intended blue styling. | index.html, style.css, game.js `updateUI` | Low–Med | No — but `updateUI` sits next to save/level code; touch only the DOM bits. |
| 8 | **Level transition fades** | Fade-to-black between `showMsg` dismiss and the next level's intro card (CSS opacity on a full-screen div, or 300 ms canvas fade in `initGame`). Currently the cut is instant. | game.js (retry-btn handler, showLevelIntro), style.css | Med | **Adjacent** — sits in the win/retry flow next to save logic and the level-10 ending branch. Add around, never inside, the `showMsg`/`writeGameSave` chain. |
| 9 | **Menu living background** | Replace the static CSS flicker with a slow auto-walking raycast render (camera drifting through a maze, heavily darkened) on the canvas behind the menu. The renderer already supports it; needs a tiny "demo camera" driver while `gameState === 'menu'` — the RAF loop already runs in menu (currently wasted, see §4). | game.js (menu-state branch of loop), renderer.js | Med–High | No gameplay, but it repurposes the loop's early-return path — careful not to disturb pause/replay branches. |
| 10 | **Wall texturing** | Replace flat color + mortar stripe with a procedural per-column pattern (hash-based brick/streak variation using `wx` and wall height, like the cave noise already does) or sample a 64px texture column. | renderer.js ray loop | Med–High | No — but it's the hottest loop in the game; budget carefully for mobile, and preserve the VOID skip and goal-door branches. |
| 11 | **Sprite upgrades** | 2-frame sway animation for stalker/mimic (second PNG, swap on `Date.now()/400 % 2`); ground-contact shadows under enemies (one dark ellipse); re-export `door.png`/`jumpscareface.png` at sane sizes (≤200 KB) for ~70% payload cut. | sprites/, renderer.js, game.js loadSprites | Low | No — pure art. Sprite *fallback* code must stay (SPRITES.md contract). |
| 12 | **DPR-aware rendering** | Multiply canvas size by `min(devicePixelRatio, 2)` and `ctx.scale`, for crisp walls/HUD text on retina. | game.js `resize()` | Med | No — but it's a real perf cost on mobile (4× pixels); gate behind a quality setting, and audit the few places that read `state.W/H` as CSS pixels (touch zones game.js:1579 use `clientX` vs `state.W` — they'd still work since scale is uniform, but verify). |
| 13 | **Minimap fog-of-war** | Only reveal minimap cells the player has visited (the `crumbs`/`playerHistory` data already exists); answers the §5 question about free enemy intel while looking better. | renderer.js minimap block | Med | **Yes** — reduces player information; it's a difficulty change dressed as polish. Get a design decision first. |

**Explicitly out of scope** (would risk protected systems): anything touching `bfs`/step cadence (enemy AI), `genMaze`, the audio graph, `writeGameSave`/`loadGameSave`/`clearGameSave`, or the `showEndingSequence` card chain. Items 7 and 8 above are the only ones that go *near* those files' protected regions — both flagged.

---

*End of audit. No game files were modified.*
