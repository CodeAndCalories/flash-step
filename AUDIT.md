# FLASH-STEP — Read-Only Code Audit **v2**

Audit date: 2026-06-11 · Commit: `6d21f3c` · ~6,000 lines of code+markup, 12 sprite PNGs.
v1 was written at `eb74fa4`, before the 7-pass polish arc. Companion docs: PROJECT.md (invariants), GAMESTATE.md, REGRESSION.md (playtest checklist).

---

## 0. CHANGES SINCE V1

**v1 findings FIXED:**
- Per-frame Float32Array allocations → module-level `ZB`/`WALL_TOPS`/`WALL_WHS` (+new `WALL_GOAL`), allocated once (renderer.js:74–81).
- Scanlines: ~360 fillRects/frame → one pre-built 1×3 pattern fill (renderer.js:85–93).
- Outline afterglow: 240 redundant `cast()` calls/frame → reuses primary-pass `zb`/`WALL_GOAL` (renderer.js:471–478).
- Frame-rate-dependent mouse lerp and shake decay → dt-scaled, exact 60fps equivalence (game.js:526, renderer.js:251).
- Missing `<title>`/`<meta charset>` → added.
- `door.png` 1526→750 KB, `jumpscareface.png` 1145→675 KB (256-color quantize, dimensions unchanged).
- v1 polish list items shipped: cone falloff (#1), per-type fog/grade (#2), film grain (#3), scanline pattern (#4), color grading (#5), HUD polish + transitions (#7, #8), menu/death/win restyles.

**ADDED since v1** (audited fresh in this doc): THEME_GRADE fog/grade system, CONE table, film grain + settings toggle, full UI/presentation pass with reduced-motion coverage, win-screen restyle, mutator framework (BLIND MAP / PERMADEATH / DYING LIGHT / ALL GAUNTLET), seeded DAILY RUN mode, persistent lore log + FILE CLOSED 21st note.

**REMAINS OPEN from v1:** per-frame gradient/fillStyle-string churn (§4), REFLECTION's second raycast pass (intentional), BFS-per-enemy-step cost, `updateUI()` per-frame DOM writes, RAF loop idling in menu, `es` variable shadowing (renderer.js:775 vs 1014), floor-fill overdraw (renderer.js:262), level-10 save gap, dual panel-switchers (menu.js `showPanel` vs game.js `showMenuPanel`).

**Issues found during this v2 cross-check (no code changed — report only):**
1. PROJECT.md had 8 wrong/stale claims — corrected in place (rotation schedule, hiscore shape, missing `flashstep-intros` key, daily overwrite semantics, "zero per-frame allocations" overstatement, nonexistent head-bob claim, `DAILY_EPOCH` date, nonexistent `v1.0-fable` tag).
2. **DAILY #0**: until 2026-06-12 UTC the menu shows "DAILY · #0" (`dailyNumber` pre-epoch). Cosmetic, self-resolves; fix only if epoch is moved again.
3. **Reduced-motion gap (canvas)**: `prefers-reduced-motion` covers CSS only. Grain and shake have settings toggles; **head-bob has no toggle at all** — candidate accessibility setting.
4. **Doc duplication**: GAMESTATE.md and PROJECT.md overlap heavily; two sources of truth will drift. Owner should bless one (PROJECT.md per its own header) and demote/delete the other.
5. **Lore toast pending across sessions**: `state.loreToastPending` is runtime-only — if the player quits to menu and closes the tab before a safe moment, the toast is lost (marker + pinned entry still communicate). Accepted, noting for completeness.

---

## 1. FILE MAP

| File | Lines | Role (imports unchanged from v1 graph: game.js is the hub; no cycles) |
|---|---|---|
| `index.html` | 374 | DOM shell: canvas, HUD, menu (+daily/mutators), pause, death/win, intro, ending, howto, photosensitivity warning, lore toast |
| `style.css` | 837 | All styling; CSS animations; `prefers-reduced-motion` block at end |
| `js/state.js` | 132 | Single mutable `state` (now incl. `mutators`, `dailyRun`, `loreToastPending`) |
| `js/settings.js` | 23 | Settings + localStorage (`grain` key added) |
| `js/maze.js` | 92 | Maze gen, BFS, `shuf(a, rng)` — now hosts `mulberry32` + `hashSeed` |
| `js/enemy.js` | 111 | Unchanged since v1: BFS-greedy steps, kill/win check, `isWall` |
| `js/renderer.js` | 1,375 | Frame pipeline + THEME_GRADE/CONE/grain configs at top |
| `js/audio.js` | 799 | Unchanged since v1: procedural WebAudio |
| `js/game.js` | 2,206 | Loop, level config, input, saves, mutators, daily, lore, replay, ending |
| `js/menu.js` | 103 | Warning, menu panels, main-menu options (incl. grain toggle) |

localStorage: `flashstep-save`, `flashstep-settings`, `flashstep-hiscore`, `flashstep-daily`, `flashstep-lore`, `flashstep-intros`; sessionStorage `photoWarningSeen`. Shapes + clear semantics: PROJECT.md §3.

## 2. RENDERING PIPELINE

`draw(lit, bob, outline, dt)` per RAF frame. Canvas = window size in CSS px (no DPR scaling); **NR = 240** ray columns. Order:
1. Shake translate (dt-scaled decay 0.045/60fps-frame) → black fill.
2. Ceiling/floor theme gradients at `globalAlpha 0.85` (vertical falloff), themes per level bracket (`getWallTheme`: dungeon ≤3 / sewer 4–6 / cave 7–9 / "wrong" 10+ / REFLECTION override).
3. **Primary raycast** (240 DDA rays, always runs) filling module-level `zb`/`wallTops`/`wallWHs`/`WALL_GOAL`. Per-column color: brightness `pow(1−corr/effMXD, 1.08·contrast) · lit · CONE[i]` (cone = precomputed 1.10 core → 0.68 edge); theme RGB ramp; then per-type **desat** + **distance fog** (smoothstep from `fogStart`, scaled by `lit`; goal door exempt). VOID skips wall fills but still writes depth.
4. Exit door sprite/frame/particles; sewer drips; REFLECTION mirror pass (second full raycast — intentional identity).
5. Moss edge lines (always); webs/spiders; **afterglow** (reuses `zb`/`WALL_GOAL`; own wallH 0.9 — sewer's 0.765 prevents reusing wallWHs).
6. World sprites (footprints, batteries, exit glow, note, rat, decoys, stalker + evolution params, afterimages, REFLECTION ghost, mimic, blind one, extra stalkers) — each angle-projected, per-column clipped against `zb`.
7. Post: cursed overlays → vignette + flash burst → **scanline pattern (1 fill)** → **grade tint (1 fill, `THEME_GRADE[levelType].tint` × lit)** → proximity/panic/web/hallucination vignettes → **film grain (1 pattern fill, 4 pre-rendered tiles, alpha 0.055→0.10 by proximity `pd`, `settings.grain`-gated)** → minimap (hidden in VOID and BLIND MAP runs via `minimapTimer` gate).
8. Restore → bat flyby → jump scare. Death replay and ending sequence bypass `draw()` entirely.

## 3. UI INVENTORY (additions since v1 in bold)

Menu: main panel (title flicker, vignette bg, CONTINUE amber, **DAILY · #N cyan + result/share swap**, **MODIFIERS section** — unlock `hiscore.maxLevel ≥ 10`, 4 toggles + no-save note, **FILE CLOSED marker**), options, exit, continue panel, **daily panel**, howto overlay.
In-game HUD: brightness bar (**+ DYING LIGHT lost-range segment**), center warning stack, distance, stamina bar, crosshair, hints, intercom, **mutator/daily corner tag**, mouse prompt, **lore toast** (safe-moments only).
Screens: pause (main/options/**notes — all-time X/20 lore panel with locked rows + FILE CLOSED pinned entry**), death (red vignette, staged fade, stats, **RUN OVER permadeath line**, **daily result + COPY RESULT**), win (neutral vignette, type accent, flex-order regroup), level intro (per-type `data-type` accents), level-10 ending cards, death replay (canvas), share card (canvas), photosensitivity warning (untouched).

## 4. PERFORMANCE NOTES

- **Fixed since v1:** buffer allocs, scanline fillRects, afterglow recast, dt scaling (see §0).
- **Still open (pre-existing):** 10–20 `createRadialGradient`/`createLinearGradient` objects per lit frame; ~240+ fillStyle template strings in the ray loop; `Date.now()` called ~12×/frame; `updateUI()` runs ~25 `getElementById` + style writes every frame; minimap full-grid redraw while visible; BFS flood per enemy step (`q.shift()` O(n)) — worst case GAUNTLET+panic ~40 floods/sec; RAF loop continues (no-op) in menu state.
- **New systems cost ~nothing:** grade/fog/desat are inline per-column math; cone is a table lookup; tint + grain are 2 draw calls (3 total with scanlines — at the stated budget); DYING LIGHT/ALL GAUNTLET/daily/lore are O(1) checks or event-time writes. `addToLoreLog` does a localStorage read+write per note pickup (rare; fine).
- Mobile risks unchanged from v1 (gradient count is the main cost); payload now ~1.25 MB lighter.

## 5. CODE HEALTH

**Dead code (re-verified at this commit, all still present, all deliberately kept):**
- `style.css:120-121` `.low-battery` / `.flash-draining` + their keyframes — never applied.
- `style.css:605` `#s-level.endless` — never applied (endless shows red, not the intended blue).
- `renderer.js drawSprite()` — exported, documented in SPRITES.md, never called (2 mentions, both definition/comment).
- `state.flashCount` (state.js:18, set `Infinity` game.js:264) — vestigial.
- **NEW:** `style.css:499` `.notes-empty` — orphaned by the lore-log notes panel (no longer emitted).

**Duplication / smells (unchanged stance — no refactors without explicit prompt):**
- enemy.js step functions ×4 near-identical; renderer `*Screen()` ×3 and extra-stalker render block (~70-line copy); angle-normalization repeated ~14×; options wiring duplicated menu/pause; **new:** the all-false mutator object literal exists in state.js and beginRun's daily branch (must stay in sync when adding mutators); `showMsg` has grown to ~120 lines handling win/dead/daily/permadeath/lore — works, but it's the file's densest function.

**Fragile spots (re-verified, all behaviors intact):**
- Save chain: hiscore (guarded) → `level++` → `writeGameSave` (internally guarded) in `showMsg` win — ordering invariant holds; lore writes correctly bypass it.
- Level-10 ending: cards → `showMsg('win')`; **save gap still open** (tab close mid-cards loses the escape; the FILE CLOSED toast correctly waits past the cards).
- `ENEMY_MS` three writers (panic/cursed/LIGHTS ON) — untouched, still ordering-coordinated.
- VOID depth-buffer contract and LIGHTS ON `lit===1` steady state — preserved through the grade/cone changes (fog/tint are no-ops or exempt where required).
- Cursed-flash ~4 Hz strobe remains the photosensitivity hotspot; grain was deliberately kept non-strobing.
- Minor: `es` shadowing renderer.js:775/1014; floor gradient overdraw renderer.js:262 (`H` height instead of `H/2−hs`); LF/CRLF warnings (cosmetic).

## 6. POLISH OPPORTUNITIES (v2 — remaining, ranked)

| # | Upgrade | Files | Risk | Gameplay? |
|---|---|---|---|---|
| 1 | Head-bob / motion-reduction toggle in settings (closes the canvas-side accessibility gap) | game.js, settings.js, index.html, menu.js | Low | No |
| 2 | Damage/proximity screen effects (chromatic-fringe near-miss, heartbeat-synced vignette throb — v1 #6, never built) | renderer.js | Med | No (reads existing `pd`) |
| 3 | Menu living background (slow auto-walk raycast behind menu; RAF already idles there) | game.js, renderer.js | Med–High | No |
| 4 | Wall texturing (hash-based per-column brick/streak variation, like cave noise) | renderer.js ray loop | Med–High | No — hottest loop, budget carefully |
| 5 | Gradient-churn diet: cache battery/eye/vignette gradients per resize instead of per frame | renderer.js | Med | No — biggest remaining mobile win |
| 6 | DPR-aware rendering behind a quality setting | game.js resize | Med | No — 4× pixel cost on mobile |
| 7 | 2-frame enemy sprite sway + ground-contact shadow ellipses | sprites/, renderer.js | Low | No |
| 8 | `updateUI` element-handle cache + change-gated writes | game.js | Low | No — but sits next to save code; DOM bits only |
| 9 | Noise-ping minimap (middle mode between full map and BLIND MAP) | renderer.js, game.js | Med | **Yes** — design decision, candidate mutator |

---

*Read-only audit. No game code was modified. PROJECT.md corrections are listed in §0 and in the session report.*
