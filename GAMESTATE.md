# FLASH-STEP — GAMESTATE

Raycaster horror maze: the flash reveals — and everything that hunts you moves when you look.
Stack: vanilla JS ES modules, canvas 2D raycaster, **no build step**, deployed via GitHub Pages.
Live URL: presumed `https://codeandcalories.github.io/flash-step/` — **VERIFY WITH OWNER**.

## ARCHITECTURE MAP

| File | Role |
|---|---|
| `index.html` | DOM shell: canvas, HUD, all overlays (menu/pause/death/intro/ending/howto/warning) |
| `style.css` | All styling + CSS animations (reduced-motion block at end) |
| `js/state.js` | Single mutable `state` object — every runtime variable |
| `js/settings.js` | `settings` + auto load/save (`flashstep-settings`) |
| `js/maze.js` | Maze gen (backtracker + loop carving), BFS, `shuf`, **mulberry32 + hashSeed** |
| `js/enemy.js` | BFS-greedy enemy steps, kill/win check, player collision |
| `js/renderer.js` | Entire frame: raycast, sprites, THEME_GRADE fog/tint, cone, grain, minimap, jumpscare |
| `js/audio.js` | 100% procedural WebAudio (SFX, ambient, panic, intercom, VOID sonar) |
| `js/game.js` | Main loop, level config, input, UI, saves, mutators, daily, lore, replay, ending |
| `js/menu.js` | Photosensitivity warning, menu panel nav, main-menu options |

## STORAGE KEYS (critical)

| Key | Shape | Written by | Cleared by |
|---|---|---|---|
| `flashstep-save` | `{level, notes:[lvl...], totalEscapes}` | `writeGameSave` (win / msg-quit / pause-quit) | `clearGameSave` (new game, start over) |
| `flashstep-settings` | `{masterVolume, flashFade, screenshake, grain, controlScheme, mouseSens}` | `saveSettings` on any change | never |
| `flashstep-hiscore` | `{maxLevel, totalEscaped, minFlashes}` | `showMsg` win branch (gated) | never — also the mutator unlock (`maxLevel >= 10`) |
| `flashstep-daily` | `{date, levelsCleared, timeMs, done}` | daily start (stub), each clear, run end | overwritten next daily; never cleared |
| `flashstep-lore` | `{found:[1..20], fileClosed}` | `addToLoreLog` (pickup), `migrateLore` (boot) | **never** |
| `flashstep-intros` | `{level: true}` one-time new-enemy banners | `showLevelIntro` | never |
| sessionStorage `photoWarningSeen` | `'1'` | warning dismiss | per session |

**Invariants:**
- `anyMutatorActive()` = `state.dailyRun || Object.values(state.mutators).some(Boolean)` — key-agnostic; guards `writeGameSave` (internal chokepoint) + the hiscore write. `anyPendingMutator()` guards the three `clearGameSave` call sites.
- Lore is append-only, written directly at pickup (NOT via writeGameSave) — mutator/daily pickups count.
- `NOTE_CYCLE = 20` pins the level→note modulus; `NOTE_TEXTS` is length 21 (index 20 = FILE CLOSED reward, unreachable from level math).
- Lore `found[]` stores **canonical note numbers 1–20** (`noteSlot()`: endless level 23 → note 3). Save `notes[]` stores raw level numbers (run-scoped).

## SACRED PATHS — DO NOT TOUCH WITHOUT OWN PROMPT

- `showMsg` win branch ordering: hiscore → `state.level++` → `writeGameSave(state.level, true)`.
- Level 10 ending: `showEndingSequence` cards → `showMsg('win')` only after cards finish (level++/save happen there).
- `ENEMY_MS` three-writer coordination: panic escalate/decay, cursed flash, LIGHTS ON setup.
- `NOTE_TEXTS` entries 0–19: append-only; reorder/insert corrupts every collected note (stored as numbers).
- Photosensitivity warning first-load behavior (menu.js IIFE).

## SYSTEMS SHIPPED (this arc)

1. **Perf + dt** (`6a77bfb`): reused depth buffers, scanline pattern (1 fill), afterglow reuses primary raycast (+WALL_GOAL), dt-scaled mouse lerp + shake decay (exact 60fps match), `<title>`/charset, PNGs quantized (door 1526→750KB, jumpscare 1145→675KB).
2. **Atmosphere** (`cf06350`): THEME_GRADE per-LEVEL-TYPE fog/desat/contrast + 1-fillRect tint (sprites graded via tint only — per-sprite fog rejected for budget/visibility; goal door exempt from fog); flashlight cone (precomputed 240-entry table, ~0.95× avg = visibility preserved); film grain (4 pre-rendered tiles, 1 fill/frame, proximity alpha 0.055→0.10, settings toggle).
3. **UI pass** (`cf06350`): menu vignette+title flicker, intro per-type accents (data-type), death staged fade + stats line, HUD 16px margins + meters, menu→game fade; every new animation has a reduced-motion fallback.
4. **Win screen + mutators** (`29337d8`): merged subtitle + type accent + flex-order regroup (death DOM untouched); mutator framework (BLIND MAP, PERMADEATH) — guard inside writeGameSave, hiscore gate, clearGameSave skip when pending, "NO SAVE." label.
5. **Mutators 2** (uncommitted→this commit): DYING LIGHT (`dyingLightCap()` chokepoint at battery/cursed/init writes; meter lost-segment) + ALL GAUNTLET (override inside `getLevelInfo`, level 10 exempt); guards generalized to some-Boolean.
6. **Daily run**: seeded gen — converted call sites: `shuf` core, genMaze backtracker + loop-carve, stalker spawn shuffle+pick, battery cells, note+web cells, blind spawn, decoy cells+phase. One `mulberry32(hashSeed(date|level))` per level gen. Levels 1–5, one attempt (`flashstep-daily`, stub at start), timer = play-only dt, share text `FLASH-STEP DAILY #N / 🔦 3/5 · 4:32 / flash-step on itch` (✅ at 5/5), clipboard + execCommand fallback. `DAILY_EPOCH = '2026-06-12'` in code (task brief said 06-11 — **VERIFY WITH OWNER**; before the epoch date the menu shows DAILY #0).
7. **Lore system**: `flashstep-lore`, boot migration from save.notes (canonicalized; never loses notes), pause panel = all-time 20 slots + locked rows + "beyond level 10" hint, FILE CLOSED 21st note pinned on unlock, toast at safe moments only (win screen / pause open), menu marker.

## VALIDATED vs UNPLAYED

- Perf+dt pass: **playtested** (owner-confirmed).
- Atmosphere + UI passes: merged; **PENDING** owner playtest (visuals hand-tunable via configs).
- Win screen, mutators (all 4), daily, lore: **PENDING** playtest. Code-verified only: seeded-gen determinism (node test: same seed = same maze), note-cycle math (levels 1–200 never reach index 20, parity preserved), save-guard call-site coverage (grep).

## TUNABLE CONFIGS

- `renderer.js` top: `THEME_GRADE` (fog/desat/tint/contrast per type), `CONE` table params, grain alphas (0.055 base / 0.10 cap / tile count).
- `game.js` top: `MUT_DYING_LIGHT` (capStart/capPerLevel/capFloor/batteryMult).
- `game.js` daily block: `DAILY_EPOCH`, `DAILY_LEVELS = 5`.
- `game.js` notes: `NOTE_CYCLE = 20` (do not change without migrating lore).

## KNOWN QUIRKS / DEFERRED

- Dead code left deliberately (no-refactor rule): `.low-battery`/`.flash-draining` CSS, `#s-level.endless` never applied, unused `drawSprite()` (SPRITES.md documents it), `state.flashCount = Infinity`, `.notes-empty` CSS now unused.
- REFLECTION runs a second full raycast per frame — perf headroom if ever needed.
- Blind One wander can oscillate between two cells — accepted as-is.
- Minimap shows live enemy positions in normal runs — accepted (BLIND MAP mutator is the alternative).
- Level-10 save gap: checkpoint not written until ending cards finish (~16s); tab close mid-cards loses the escape — known, deferred.
- Git LF→CRLF warnings on Windows — cosmetic.
- RAF loop keeps running (no-op) in menu state — trivial; repurposable for a menu background later.

## NEXT UP

- Stats / run-summary screen.
- Audio proximity layer.
- THE VOID / secret ending capstone.
- itch.io page — share text currently says "flash-step on itch"; update the line/URL in `dailyShareText()` when the page exists.
