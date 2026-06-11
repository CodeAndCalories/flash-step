# FLASH-STEP — PROJECT.md
**The source of truth for AI-assisted sessions. Read this entire file before editing any code.**
Last updated: 2026-06-11 (end of Fable-5 era audit/polish arc).

---

## 1. WHAT THIS IS

A vanilla JS ES-module raycaster horror game. No framework, no build step, no bundler.
Deployed via GitHub Pages at `codeandcalories.github.io/flash-step`.

- 10 source files, ~5,650 lines (pre-polish count; see AUDIT.md for current map)
- Core loop: navigate a procedural maze in darkness; flashing your light reveals the maze
  AND attracts the entity. Reach the green exit door. 10 levels → ending → endless mode.
- Level types (`getLevelInfo`, game.js:102): levels 1–2 HUNT; from level 3 a 4-step
  cycle **ECHO → SILENCE → GAUNTLET → HUNT**. LIGHTS ON / REFLECTION / VOID are NOT in
  the cycle — they're level-number overrides, priority REFLECTION > VOID > LIGHTS ON:
  REFLECTION every 7th (7, 14, 21…), **VOID at 10 and every 9th after (19, 28…)**,
  LIGHTS ON every 5th from 11 (11, 16, 21…). Endless (11+) continues this schedule.
- Sprites in `/sprites/` (door.png and jumpscareface.png were re-encoded to 256-color
  palette in June 2026 — originals recoverable via git history if banding ever appears).

Key files: `index.html`, `style.css`, `js/game.js` (state machine, flow, items, notes,
mutators, daily), `js/renderer.js` (raycast + all post effects), `js/maze.js` (gen),
`js/enemy.js` (AI), `js/state.js`, `js/menu.js`, `js/audio.js`, `js/settings.js`.

---

## 2. SACRED INVARIANTS — NEVER BREAK THESE

1. **Save ordering.** The win flow's `state.level++ → writeGameSave(...)` ordering in
   `showMsg('win')` is the save system's only invariant. Never reorder, never move the
   write, never add early returns between them.

2. **NOTE_TEXTS is append-only.** Run notes (`state.collectedNotes` / save `notes[]`)
   store raw LEVEL NUMBERS; the lore log (`flashstep-lore.found[]`) stores CANONICAL
   note numbers 1–20 via `noteSlot()` (endless level 23 → note 3). `getNoteText(lvl)`
   maps `(lvl-1) % NOTE_CYCLE` with `NOTE_CYCLE` pinned at 20. Reordering or inserting
   into NOTE_TEXTS silently rewrites every note players already collected. Index 20
   (FILE CLOSED) is reached ONLY via the lore unlock, never via level math. Never
   change `% NOTE_CYCLE` to `% NOTE_TEXTS.length` (the array is length 21).

3. **The level-10 ending funnels through `showMsg('win')`.** `showEndingSequence()` runs
   its own overlay, then calls showMsg('win'); a level-10 override then rewrites the
   text via textContent ("THE CYCLE IS COMPLETE"). Any change to the win screen must
   verify this path still flows. The ending sequence itself is untouchable without an
   explicit, dedicated prompt.

4. **Save guards are centralized.** `anyMutatorActive()` = `state.dailyRun ||
   Object.values(state.mutators).some(Boolean)`. It guards: the `writeGameSave`
   chokepoint, the hiscore gate, and the "NO SAVE." pause label.
   `anyPendingMutator()` (same some-Boolean pattern) guards the three `clearGameSave`
   call sites (NEW GAME ×2, start over). **Any new mutator/mode flag must live inside
   `state.mutators` or be added to these predicates — never add a parallel guard.**

5. **The lore log is account-level.** `'flashstep-lore'` is NEVER cleared by new game /
   start over / clearGameSave, and its write is NOT routed through writeGameSave
   (mutator and daily runs still collect notes).

6. **Daily determinism.** Generation uses ONE injected rng per level
   (`mulberry32(hash(date|level))` for dailies, `Math.random` reference otherwise),
   threaded through all 10 gen call sites (see AUDIT.md). Never re-seed mid-generation,
   never change gen call ORDER, never add a new Math.random call inside generation —
   any of these silently breaks "same maze for everyone." Runtime/AI randomness is
   exempt and intentionally unseeded.

7. **ENEMY_MS has three competing writers** (panic, cursed flash, LIGHTS ON) coordinated
   only by code ordering. Do not touch any of them without mapping all three first.

8. **The photosensitivity warning** always shows on first load regardless of save state.
   Its logic is untouchable; styling may follow global button styles only.

9. **Settings stay in `'flashstep-settings'`** — never merged with save data.

10. **ALL GAUNTLET exempts level 10** (`level !== 10` in getLevelInfo's first branch).
    Level 10 stays VOID always.

---

## 3. STORAGE KEYS

| Key | Contents | Cleared by |
|---|---|---|
| `flashstep-save` | `{ level, notes[], totalEscapes }` checkpoint | NEW GAME / start over (skipped when mutators pending) |
| `flashstep-settings` | volume, sensitivity, shake, grain, etc. | never (user-managed) |
| `flashstep-hiscore` | `{ maxLevel, totalEscaped, minFlashes }` (Math.max on win; maxLevel is the durable "beaten" record; unlocks MODIFIERS at >= 10) | never |
| `flashstep-daily` | `{ date, levelsCleared, timeMs, done }` — stub written at run START so refresh can't grant a second attempt | overwritten when the next day's daily is started |
| `flashstep-lore` | `{ found[1..20 canonical], fileClosed }` — all-time note collection; migrated from save.notes on first boot | never |
| `flashstep-intros` | `{ level: true }` one-time new-enemy intro banners (levels 3/5/7) | never |

(Also sessionStorage `photoWarningSeen` — photosensitivity warning shows once per browser session.)

---

## 4. RENDERER + PERFORMANCE BUDGET (hard caps)

- 240 rays (`NR` is a fixed constant — resize changes W/H, never ray count).
- Depth buffers (ZB, WALL_TOPS, WALL_WHS, WALL_GOAL) are module-level, allocated once.
  **Zero NEW per-frame allocations** is the rule: everything added in the polish arc
  allocates nothing per frame. (Pre-existing v1 churn — per-frame gradients and
  fillStyle strings — still exists; see AUDIT.md §4. Reduce it, never add to it.)
- Post effects budget: **max 3 extra draw calls/frame** total — currently scanline
  pattern fill (1) + theme grade tint (1, lit frames) + film grain pattern fill (1).
  At budget. New effects must replace, not add.
- No new raycast passes. The outline afterglow reuses ZB/WALL_GOAL from the primary
  pass (its wallH 0.9 vs sewer 0.765 means wallWHs/wallTops can't be shared — comment
  in code explains).
- REFLECTION runs a genuine second raycast pass — that's its identity, leave it.
- All time-based feel (mouse lerp, shake decay) is dt-scaled, calibrated to exactly
  match 60fps behavior: lerp `1 - Math.pow(1-k, dt*0.06)`, decay `k * dt * 0.06`.
  Any new per-frame easing must follow the same pattern.
- Fog = distance smoothstep inside existing per-column color math (no extra pass),
  scaled by light level; **the goal door is exempt from fog** (stays a pure beacon).
- Sprites receive theme grade via the full-screen tint only — per-sprite fog would
  change enemy visibility (= a hidden difficulty change). Don't "fix" this.
- Cone falloff: precomputed 240-entry CONE table, flat 1.10× core → 0.68× edge,
  screen-average ≈ 0.95× of old uniform light. Tuning happens in the table builder.
- Accessibility: every CSS animation added since June 2026 has a
  `prefers-reduced-motion: reduce` path (instant states, fully functional). New CSS
  animations must join that block. Canvas-side motion is settings-gated instead:
  film grain (`settings.grain`), screen shake (`settings.screenshake`). NOTE:
  head-bob EXISTS (game.js:932 → renderer `hs`) and currently has NO toggle —
  candidate accessibility option, not a current guarantee.

---

## 5. TUNABLE SURFACES (change values here, not logic)

- `THEME_GRADE` (top of renderer.js) — per-levelType fog RGB/start/density, desat,
  tint + alpha, contrast. VOID is a deliberate no-op entry. Wall palettes per level
  bracket (getWallTheme: dungeon ≤3, sewer 4–6, cave 7–9, "wrong" 10+) layer
  UNDERNEATH the grade — don't merge the two systems.
- `MUT_DYING_LIGHT` (top of game.js) — capStart 1.00, capPerLevel 0.06, capFloor 0.55,
  batteryMult 0.75. `dyingLightCap()` returns exactly 1.0 when off. Clamp sites:
  battery pickup, cursed-flash settle, defensive level-start clamp. Cursed strobe still
  RENDERS full-bright; only lasting brightness respects the cap.
- `DAILY_EPOCH` ('2026-06-12', game.js:1169) — daily #1 date, UTC-keyed. Before the
  epoch date the menu shows "DAILY · #0" (cosmetic; self-resolves at epoch).
- Intro card / win screen accent hexes live in style.css per data-type
  (HUNT #cc6a3a, ECHO #6f9fd8, SILENCE #9b9ba2, GAUNTLET #dd2222,
  LIGHTS ON #cfeccb, REFLECTION #9d7ce0, VOID #c8d8e8) — hand-matched to THEME_GRADE,
  hardcoded in CSS by design (CSS can't read JS).

---

## 6. FEATURES SHIPPED IN THE JUNE 2026 POLISH ARC

Pass 1 — perf/correctness: buffer reuse, scanline pattern, afterglow reuse, dt scaling,
PNG re-encode (−1.25 MB), head tags.
Pass 2 — atmosphere: cone falloff, per-theme fog + grade, film grain (+ settings toggle).
Pass 3 — UI: menu vignette/flicker, level intro accents (data-type pattern), death
staged fade + run stats, HUD spacing/meters/legibility, menu→game fade.
Pass 4 — win screen: subtitle dedup, theme accent, layout order, neutral vignette.
Pass 5 — mutators: framework + BLIND MAP, PERMADEATH, DYING LIGHT, ALL GAUNTLET;
save guards generalized to some-Boolean.
Pass 6 — DAILY: seeded gen (10 call sites), UTC daily, one attempt (start-stub),
share text + clipboard fallback, play-only timer.
Pass 7 — lore: persistent collection log + migration, NOTES X/20 panel, FILE CLOSED
21st note (append-only), unlock toast + menu marker.

---

## 7. KNOWN ISSUES / FRAGILE SPOTS (open as of 2026-06-11)

- **Level-10 save gap:** the ending doesn't write its checkpoint until the 16-second
  card sequence finishes — tab close mid-cards loses the escape. Fix is save-path
  surgery: own prompt, own reload test. (Check git log — may be fixed after this doc.)
- ENEMY_MS three-writer coordination (see invariant 7) — works, fragile, leave unless
  a real bug forces it.
- Verified dead code intentionally NOT removed (low-battery CSS, #s-level.endless
  style, exported drawSprite(), state.flashCount) — cleanup prompts break working
  games; remove only with explicit owner sign-off.
- Blind One's oscillating wander: ruled a feature (open question from AUDIT v1, since
  accepted by not changing it).
- Minimap shows live enemy positions in normal mode — deliberate for accessibility;
  BLIND MAP mutator is the hard alternative. A "noise-ping only" middle mode is a
  candidate future mutator, not a fix.

---

## 8. ROADMAP (priority order)

1. Level-10 save gap fix (if not already in git log)
2. Stats / run-summary screen (deaths, escapes, total notes, fastest level — needs a
   small persistent stats key; display-only otherwise)
3. Audio proximity layer (heartbeat scales with enemy distance, breathing at zero
   stamina) — spec before prompt
4. THE VOID capstone / secret-ending expansion tying off the Daniel lore — spec exists
   in chat history ("FILE CLOSED" is the floor, this is the ceiling); write full spec
   before any prompt
5. itch.io page + share-link swap in daily share text
6. Candidate mutators: noise-ping minimap, daily+mutator combos (would need its own
   share-text rules)

---

## 9. WORKING RULES FOR AI SESSIONS (non-negotiable)

1. **Read first:** this file + AUDIT.md before ANY edit. If a prompt conflicts with an
   invariant above, STOP and ask.
2. **One system per prompt.** Scoped files, explicit DO-NOT-TOUCH list, VERIFY section
   that must be answered with specifics (where the guard lives, which call sites,
   what was eliminated). A report that can't answer VERIFY hasn't done the work.
3. **`node --check` every edited JS file** (ES module mode).
4. **Save-path changes** get their own prompt and a mandatory reload test against an
   EXISTING save — new-game tests prove nothing about migrations.
5. **Playtest gates:** never stack 2+ unplayed gameplay changes. Visual/UI passes may
   batch; gameplay passes may not. End every gameplay arc with a concrete checklist.
6. **Balance:** values start in config objects, math projects, feel decides; keep
   before/after tables; note the likely "shave" in advance.
7. **No refactors, no cleanup, no renames** unless that is the explicit task.
8. **Commit + push after every validated pass.** Tag known-good states before
   gameplay-touching arcs (`git tag` — NOTE: no tags exist yet as of 2026-06-11;
   create `v1.0-fable` at the next validated state).
9. Update §6/§7/§8 of this file at the end of every session: what shipped, what's
   validated vs unplayed, what's next.
