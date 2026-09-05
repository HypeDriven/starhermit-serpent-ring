# Known Issues — Serpent Ring

QA pass 2025-09-04. Static review driven by Qwen3.8 27B on <HOST> (<QUANT>), alongside the game's
own unit tests and end-to-end suite.

## Test results

| Check | Result |
| --- | --- |
| `npm test` | 2/2 pass |
| `node --check` on all modules | clean |
| `tests/e2e.mjs` (headless Chrome) | PASS, no page errors |

## Confirmed defects

None outstanding — all confirmed defects fixed (see Resolved below).

## Resolved

### 1. Pointer/touch steering of the serpent was dead

- **File:** `js/main.js` (`bindPointer`, previously defined but never called)
- **Trigger:** moving the mouse / tapping / dragging over the playfield canvas
- **Behaviour:** nothing happened; only keyboard (ArrowLeft/ArrowRight/Space) steered.
- **Expected:** spec.md §3 Input — "Pointer/touch … steer with the pointer or ← / →".
- **Fix:** call `bindPointer()` once at bootstrap in `js/main.js` (line 287) so the canvas receives
  `pointermove`/`pointerdown`/`pointerup`/`pointercancel` listeners. The existing
  `pointerSteer()` already maps pointer X/Y relative to the arena centre into a heading
  (matching the renderer's inverted-y convention) and feeds the same `pushSteer()`
  path the keyboard uses, so pointer and keyboard steering now share identical
  semantics. Keyboard steering is unchanged.
- **Verified 2025-09-04:** `npm test` 2/2 pass; `node --check` clean; `tests/e2e.mjs`
  (headless Chrome, desktop + mobile) exits 0 with `E2E PASS`. The heading maths was
  checked against `render.js` (screen y is `cy - y*scale`, so a screen offset `(dx, dy)`
  correctly maps to heading `atan2(-dy, dx)`).
