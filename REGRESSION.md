# FLASH-STEP — REGRESSION CHECKLIST

Flat playtest list for the June 2026 polish arc (commits `6a77bfb` → `6d21f3c`).
Run top to bottom; each line is pass/fail. Test against a browser with an EXISTING save
where noted — new-game tests prove nothing about migrations.

## FEEL / RENDERING
- [ ] Mouse look feels identical at 60 Hz and high-refresh (144 Hz) — no faster/slower turn, no jitter (dt-scaled lerp)
- [ ] Screen shake on wall bump + death decays at the same speed on both refresh rates
- [ ] Flashlight: bright center core, smooth dimming toward screen edges — NO visible vertical banding or hard cutoff
- [ ] HUNT level (1–2): baseline warm-brown darkness
- [ ] ECHO level (3): cold steel-blue fog, slightly washed colors
- [ ] SILENCE level (4): gray, heavily desaturated, fog noticeably closer
- [ ] GAUNTLET level (5): deep red shift, punchier near/far contrast
- [ ] LIGHTS ON level (11): sickly green-white tint, almost no fog, fully lit
- [ ] REFLECTION level (7): violet tint + ghost mirror pass still visible
- [ ] VOID level (10): walls invisible, footprints bright, NO fog/tint artifacts, green door still a beacon
- [ ] Goal door is never fogged — pure green at any distance, any theme
- [ ] Film grain: visible in darkness, animates (not static), intensifies subtly when an enemy is close
- [ ] Settings → FILM GRAIN OFF: grain fully gone (both options panels stay in sync); persists after reload

## MENU FLOW (use an existing save)
- [ ] CONTINUE shows correct level + escape count; resumes at saved level with notes intact
- [ ] NEW GAME (no mutators): wipes checkpoint, starts level 1
- [ ] "start over": same as new game, uses remembered control scheme
- [ ] Pause → QUIT TO MENU: button reads "SAVED.", checkpoint reflects current level after reload
- [ ] Title flicker is gentle (no strobe); menu background is a dark vignette, not flat black
- [ ] Keyboard Tab focus shows visible outlines on all menu buttons
- [ ] Menu → game start fades (~400ms), no hard cut; quitting back to menu works repeatedly

## DEATH / WIN / ENDING
- [ ] Death: red vignette, title lands first, buttons fade in ~600ms later; stats line shows level/notes/time
- [ ] Win: neutral dark vignette (NOT red); "TYPE COMPLETE" with theme-colored type name; "LEVEL n · BRIGHTNESS x%" single line (no duplicate level)
- [ ] Win layout: info + "Progress saved" ABOVE the buttons
- [ ] Level 10 win: full card sequence ("You found the exit." → … → title card) → win screen "THE CYCLE IS COMPLETE / ∞ ENDLESS MODE UNLOCKED" → NEXT LEVEL enters level 11 endless
- [ ] After beating level 10: MODIFIERS section appears on main menu (and survives "start over")

## MUTATORS (each: note checkpoint level BEFORE the run, verify identical AFTER)
- [ ] BLIND MAP: first flash shows NO minimap all run; everything else normal; checkpoint untouched after win AND quit
- [ ] PERMADEATH: starts level 1 even with a saved checkpoint; on death NO TRY AGAIN, shows "RUN OVER · REACHED LEVEL n"; checkpoint untouched
- [ ] DYING LIGHT: brightness bar shows dim lost-segment growing per level; batteries restore visibly less; by level ~9 cap stops shrinking; checkpoint untouched
- [ ] ALL GAUNTLET: levels 1–9 all GAUNTLET (intro card, grading, enemies); level 10 still VOID + normal ending; checkpoint untouched
- [ ] Any mutator run: pause → QUIT reads "NO SAVE." (not "SAVED.")
- [ ] Mutator NEW GAME does NOT wipe the existing checkpoint
- [ ] Mutator win writes NO hiscore change (check BEST line unchanged)
- [ ] All four stacked at once: tag lists all, run playable
- [ ] Normal run after a mutator run: saves work again, tag gone

## DAILY
- [ ] DAILY · #N button (cyan) visible without beating the game; sub-line present
- [ ] Determinism: play daily level 1, note maze layout → DevTools: delete `flashstep-daily` key → replay → IDENTICAL maze, spawns, battery/note positions
- [ ] One attempt: after run ends, menu shows result + COPY RESULT instead of play button; refresh mid-run does not grant a retry
- [ ] Run ends on death OR completing level 5 (no NEXT LEVEL at 5/5); result shows DAILY #N · x/5 · m:ss
- [ ] COPY RESULT: clipboard gets the 3-line format (🔦 partial / ✅ 5/5); button flips "COPIED." ~800ms; works on mobile browser
- [ ] Daily run writes nothing to checkpoint or hiscore; pause-quit reads "NO SAVE."
- [ ] Daily HUD tag "DAILY #N" shows in corner; mutators section not part of daily flow

## LORE
- [ ] Note pickup during a NORMAL run appears in pause → NOTES (X/20 header, full text)
- [ ] Note pickup during a MUTATOR or DAILY run ALSO lands in the log
- [ ] NEW GAME / start over: lore log keeps all entries (only checkpoint resets)
- [ ] Uncollected slots show "? · LEVEL n" dim rows; "later notes are found beyond level 10" hint while < 20
- [ ] MIGRATION (needs a pre-lore save): existing `flashstep-save` with notes, no `flashstep-lore` key → boot → log pre-seeded with those notes
- [ ] 20/20 collected: FILE CLOSED entry pinned on top (Daniel/Mara note), toast "FILE CLOSED — check your notes" appears on next level-complete or pause (never mid-gameplay), "— FILE CLOSED —" marker on main menu

## MOBILE (390px-wide viewport)
- [ ] D-pad / turn buttons / FLASH all reachable, no overlap (turn buttons slim to 60px), all targets ≥44px
- [ ] MODIFIERS toggles + descriptions readable and tappable; daily flow + COPY RESULT works
- [ ] Note display, intercom line, mutator tag don't collide with touch controls
- [ ] Performance acceptable on a real mid-range phone (grain + tint + fog active)

## REDUCED MOTION (OS setting ON)
- [ ] Menu: no title flicker, no background flicker, panels switch instantly
- [ ] Level intro: card appears instantly, ALL text visible (flavor line not stuck invisible)
- [ ] Death/win screens: everything visible immediately, buttons clickable at once
- [ ] Lore toast appears/disappears without fade; meters jump without transition
- [ ] Game remains fully playable start to finish

## PHOTOSENSITIVITY / SESSION
- [ ] Warning shows on first load of a fresh browser session, auto-dismisses ~4s or on tap, not shown again that session
