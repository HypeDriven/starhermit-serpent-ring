# Known Issues — Serpent Ring

QA pass 2026-09-07 (Claude Opus 5). Source review of the rules engine, bootstrap, renderer,
UI shell and static server, plus the game's own unit tests and browser end-to-end suite.

## Test results

| Check | Result |
| --- | --- |
| `npm test` | 12/12 pass (suite extended from 2 checks to 12) |
| `node --check` on all modules | clean |
| `tests/e2e.mjs` (headless Chrome, desktop + mobile) | `E2E PASS`, no page errors |
| Browser smoke: Learn lesson 1 end-to-end (pointer steering) | pass — all 3 steps, results screen |
| Browser smoke: Practice “Standard” render + boost spam | pass — rivals distinguishable, no errors |
| `server.js` probes (index, svg mime, `..` traversal, query string) | 200 / 200 / 403 / 200 |

## Confirmed defects

None outstanding — all confirmed defects fixed (see Resolved below).

## Resolved

### 1. Pointer/touch steering of the serpent was dead

- **File:** `js/main.js` (`bindPointer`, previously defined but never called)
- **Fix (2025-09-04):** call `bindPointer()` once at bootstrap so the canvas receives
  `pointermove`/`pointerdown`/`pointerup`/`pointercancel`. Pointer and keyboard steering
  share the same `pushSteer()` path.

### 2. Results screen printed `[object Object]` instead of a score breakdown

- **File:** `js/main.js` (`finishIfTerminal`)
- **Cause:** `rules.scoreBreakdown()` returns an **array** of `{key,label,amount,detail}`
  rows; the UI iterated it with `Object.entries()`, producing rows keyed `0…5` whose values
  stringified to `[object Object]`.
- **Fix:** iterate the array and render `label (detail)` → `amount`. Verified in the browser:
  “Motes gathered (21 × 10) 210 … Total 404”.

### 3. Sound effects never played

- **Files:** `js/main.js`, `js/audio.js`
- **Cause:** `playEvent()` was exported and 15 authored `.opus` clips shipped, but nothing
  ever called it — the simulation events returned by `rules.step()` were discarded.
- **Fix:** `sonify(events)` plays `eat` / `boost-start` for the player's own serpent and
  `death` for any serpent, at most one clip per kind per tick.

### 4. Holding boost without mass spammed rejected commands

- **File:** `js/main.js` (`pushBoost`)
- **Cause:** while boost was held with less than `minBoostMass`, a `boost` command was
  queued **every tick** and rejected, incrementing `invalidActions` ~30×/second. That
  counter is a scoring tie-break (`compareResults`), so a player who leaned on the key was
  silently penalised.
- **Fix:** consult `getLegalActions()` before sending a boost-on request.

### 5. Length was displayed in the wrong unit

- **Files:** `js/main.js` (HUD, results), `js/rules.js` (`scoreBreakdown`)
- **Cause:** three different conversions were in use. All authored content speaks in
  metres of 10 trail ticks (“Grow to 9 m” = `reach-length: 90`), but the HUD divided by 100
  (“0.5 m” at spawn) and the breakdown multiplied by `baseSpeed`.
- **Fix:** one `meters()` helper, `trailTicks / 10`, used by HUD, results and breakdown.

### 6. Held steering drifted while boosting

- **File:** `js/main.js` (`frame`)
- **Cause:** keyboard steering advanced the desired heading at `turnRate` even while
  boosting, when the simulation only turns at the slower `boostTurnRate`; the surplus
  accumulated as heading debt and the serpent kept turning after the key was released.
- **Fix:** advance the desired heading at whichever rate the simulation will apply.

### 7. Learn mode ignored its own lesson content

- **Files:** `js/main.js`, `tests/run-tests.js`
- **Cause:** every lesson in `js/content.js` declares ordered `steps` with a completion
  `check`, but nothing read them. Learn rounds instead showed the placeholder objective
  `Goal 0 / 99999999` and could only end by dying — spec §2 requires lessons that
  “require the player to perform the action”.
- **Fix:** a step tracker evaluated purely from authoritative engine state
  (`heading-turned`, `laps`, `ticks`, `motes`, `motes-after`, `length`, `length-alive`,
  `bloom`, `boost-ticks`, `proximity`, `eliminate-or-survive`). The HUD shows
  `Step n / m — <instruction>`, and finishing the last step ends the round with a
  “Lesson complete!” results screen. A unit test asserts every authored check type is one
  the tracker implements, so content and UI cannot drift apart.

### 8. All serpents rendered identically

- **File:** `js/render.js`
- **Cause:** every serpent drew in white, so the player could not tell which serpent was
  theirs — against pillar 1 (“ownership … legible”).
- **Fix:** rivals draw in their own `hue` from the rules state; the player keeps the pale
  white body plus a ring around the head.

### 9. Static server served files outside the game directory

- **File:** `server.js`
- **Cause:** `%2e%2e%2f` style paths resolved above `ROOT`; `.svg`, `.png`, `.json` and
  `.ico` were also served as `application/octet-stream`, so the favicon did not render.
- **Fix:** reject any resolved path outside `ROOT` with 403, parse the path with `URL`,
  and extend the MIME table.

### 10. Smaller fixes

- `index.html`: the objective line is now a polite `role="status"` live region (the
  per-frame progress line is explicitly `aria-live="off"` so screen readers are not
  flooded); the sound slider now starts at the volume actually in effect (100).
- `LICENSE.md` (PolyForm Noncommercial 1.0.0) added — required by the workspace rules.
- `tests/run-tests.js` grew from 2 to 12 checks: static content validation, seed
  determinism, serialize/clone hash stability, growth from eating, boost legality and
  invalid-action accounting, command validation (bad heading, unknown serpent/command,
  duplicate ids), wall collision terminating a solo round, and a breakdown-sums-to-total
  invariant on results.

## Remaining issues (not defects, noted for a future pass)

- The pause menu's **Music volume** slider is wired to `setMusicVolume()`, but no music is
  implemented, so the control has no audible effect.
- `js/vendor/three.module.js` ships but is unused: the playfield is drawn with the 2D
  canvas renderer, not the Three.js presentation the spec's rendering direction describes.
- Journey/lesson progress, achievements and the daily streak are not persisted between
  sessions; there is no local storage layer yet.
</content>
