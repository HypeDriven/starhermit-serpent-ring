# Serpent Ring — Game Specification

**Status:** running specification of the shipped game (present tense).
**Genre:** realtime growth arena, solo against bot rivals
**Platform:** a StarHermit engine script game (engine 1.22.0, `engine.minor=20`): played natively by the StarHermit client and in browsers by the engine's web runtime (`index.html` is the engine's loader)
**Rendering:** a 2D ring drawn with `starhermit:draw` over a baked `starhermit:canvas` backdrop; menus and HUD on `starhermit:ui`

## 1. Product vision

Serpent Ring is a game in which players steer continuously, gather motes to grow, boost at a length cost, and avoid colliding with other bodies. Its signature setting is a dark botanical arena traced by luminous serpents. The product should feel immediately understandable, responsive within one input, and polished enough that the board or playfield itself is the visual hero. Sessions should begin quickly, make the next useful action obvious without solving the game for the player, and end with a clear explanation of score and progress.

The experience must be original. Do not copy names, layouts, characters, iconography, writing, audio, progression maps, or level data from an existing title. Use an original visual language, original procedural assets, and internally authored content.

### Design pillars

1. **Readable before spectacular:** legal actions, hazards, selection, ownership, and goals remain legible with effects disabled.
2. **One-input confidence:** every press, tap, drag, key, or pointer action gives immediate visual and sonic acknowledgment.
3. **Short path to play:** a returning player reaches the primary playfield in at most two deliberate actions.
4. **Fair mastery:** randomness is seeded and inspectable; outcomes never depend on hidden purchases or invisible stat boosts.
5. **Scalable beauty:** the same art direction survives low-power mobile hardware and high-resolution desktop displays.

## 2. Core game design

### Objective and rules contract

Steer continuously, gather motes to grow, boost at a length cost, and avoid colliding with other bodies.

The rules engine must represent legal actions independently from rendering. It must expose legal-action queries, deterministic resolution, serializable state, a monotonically increasing turn/tick number, and a terminal-state reason. Tutorials and hints call the same legal-action API used by play rather than duplicating rules.

### Core loop

The repeated loop is: **steer, collect mass, boost, shape routes, and force or avoid collisions**. Input is locked only during the shortest non-interruptible resolution phase. Cosmetic animation may continue after the logical state is ready, but skip/fast-forward must settle every object into the exact deterministic end state.

### Scoring and victory

Rank by peak length and survival; collisions and pickups are authoritative. Results show a component breakdown rather than one unexplained total. Store integers for score and simulation units; format values only in presentation. Ties use, in order: primary objective completion, fewer invalid actions, lower authoritative elapsed time, then stable session identifier.

### Modes

- **Learn:** interactive lessons introduce one rule at a time and require the player to perform the action.
- **Journey:** authored progression with gradually combined mechanics and periodic mastery stages.
- **Daily:** one shared seed and ruleset per UTC day, synchronized to platform time.
- **Practice:** selectable difficulty, restart, undo where rules permit, and no effect on competitive rating.
- **Challenge:** constrained goals such as move limits, speed targets, altered layouts, or restricted tools.
- **Hosted play:** not offered. The game is solo against bot rivals; the title's “Invite a friend” only copies the platform invite link.

### Difficulty and content generation

- Represent content as versioned data: identifier, seed, initial state, goals, allowed mechanics, par values, tutorial flags, and presentation theme.
- Run offline validators to prove basic legality, reachable goals, bounded duration, and absence of soft locks. Logic puzzles additionally require a unique or explicitly accepted solution class.
- Difficulty is measured from solution depth, branching factor, time pressure, motor precision, hidden information, and recovery options—not merely larger numbers.
- Introduce one new concept in isolation, combine it with one known concept, then test mastery before adding another.
- Daily seeds are immutable after publication. If content is defective, mark the day excluded from ranking rather than silently replacing it.

### Game-state model

`boot → title → profile-ready → mode-select → preparing → tutorial/countdown → active ↔ paused/reconnecting → resolving → results → progression`.

Every transition has one owner and an explicit reason. Backgrounding (the runtime's suspend) pauses the round.

## 3. Interaction and user-interface design

### Screens

Every screen sits under a title bar (name, the signed-in player, the cloud sync chip — offline / saving… / synced — a UTC clock, and **?** for Help) in a centred column up to 760 px wide that scrolls when taller than the window.

- **Title:** the ring vignette (a looping miniature of the ring with two serpents, fading into the page), the name, the tagline and the menu: Play, Daily Challenge, Journey, Learn, Challenge, Options (the runtime's Options menu), and Sign in with StarHermit for a guest or Invite a friend when signed in.
- **Choose a mode:** five cards (Practice, Journey, Learn, Daily Challenge, Challenge) in auto-fit columns of at least 200 px.
- **Practice:** Calm, Standard and Fierce (undo allowed, unranked).
- **Daily Challenge:** today's ring name and brief, Play the daily challenge, Rules and details (Help, which returns here).
- **Journey:** 40 stages under their five chapter headings; **Learn:** five lessons; **Challenge:** six constrained rings. Each list ends with a back button.
- **The ring:** the playfield (up to 720 px wide and 68 % of the window tall), the objective line, the progress line (goal progress and length, or the lesson step) and the pause button.
- **Paused:** Resume, Options (the runtime's volumes, graphics level, language, controls) and Leave to title.
- **Results:** the headline (Goal complete! / Lesson complete! / Ring claimed you.), the score breakdown, the total with peak length and ticks, how the round ended, the item's records (best, goal met / plays, best peak), the leaderboard line for ranked rounds when signed in, Play again and Leave to title.
- **Help:** the rules and the effective key bindings; Close help returns to the screen it was opened from (from the ring it pauses first).

### Responsive layouts

Layouts are picked by the window's logical size: narrow (≤ 700 px) tightens the padding; short landscape (≤ 520 px tall and wider than tall) puts the HUD and pause button beside a height-sized ring, shows the title menu in two columns without the vignette, and puts the results' score table beside the notes and buttons. The runtime's interface size, text size and safe area apply.

### Input

| Action | Keys (default) | Gamepad | Pointer / touch |
| --- | --- | --- | --- |
| Steer left / right | ← / A, → / D | D-pad, left stick | the serpent turns toward the pointer over the ring (about its centre); a finger on the ring steers the same way |
| Boost (hold) | Space, ↑, W | A (South), right trigger | press / hold on the ring |
| Undo (Practice) | U, Ctrl+Z | X (West) | — |
| Pause / resume | Esc, P | Start | the ⏸ button |

Held steering keys turn the wanted heading at the rate the simulation turns (slower while boosting); both held means the last pressed wins. Players rebind keys and pads in the runtime's Options. Menus are navigable by Tab / arrows / Enter, the D-pad and South, and by pointer or touch.

### Accessibility

Every control is a runtime UI widget with a screen-reader name (the playfield is an image named “Serpent Ring playfield”); the objective, lesson steps and the player's fate are announced as a polite live region, as is the results headline. The runtime's high contrast swaps in a black-and-white token set; its reduced motion stops the ambient spores, mote pulses and particles; its text size and interface size scale the UI.

## 4. Visual and audio design

The ring keeps the browser build's look: five themes (Night Garden, Ember Thicket, Frost Reeds, Golden Hollow, Void Orchard). The backdrop — radial sky, foliage fronds outside the rim, the textured floor with growth rings and moss specks, rim and rim glow, the island, the colour grade and vignette, and the thorns (which never move) — is painted with the old canvas code into an OffscreenCanvas once per size, theme and look, one stage a frame within the canvas work budget. Everything that moves is drawn each frame with draw primitives: drifting spores and the rim shimmer, motes with additive halos and pulsing bloom glow sprites, serpent shadows, glows, tapered bodies (round-joined segments in chunks), dorsal scale marks and oriented heads with eyes, and additive particles (eat sparkles, boost wake, death bursts). The player's serpent is always the pale one with a pure-white head and a ring; rivals keep their hues. Gameplay colours are never graded.

### Graphics levels

The runtime's quality level picks the old presets (js/look.js): **Low** draws the plain baseline (flat ring, dot trails, no effects, pixel ratio 1); **Balanced** adds the detailed backdrop, glow, colour grade, low particles and the animated backdrop (pixel ratio ≤ 1.5); **High** adds drop shadows and full particles (≤ 2); **Ultra** the stronger glow. Particle and spore counts scale up to 2× with the runtime's level within a tier. The runtime owns Auto, render scale, adaptive resolution and the frame-rate limit.

### Audio

The authored one-shots (sfx/*.opus) play per event, rotating through each event's clips: eating and boost starts for the player's own serpent, deaths anywhere in the ring (at most one clip per kind per tick). Clips load one at a time once the mixer runs. The runtime's Options own volumes and mute. (The browser build's synthesized fallback blips while a clip decoded are not ported; a clip still loading is silent.)

### Localization

Every game string is translated in en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR and it-IT (js/locales/, English text as keys) and drawn through `T()` each frame in the runtime's interface language (Options › Language, else the account's or device's), so a change shows on the next frame.

## 5. Technical architecture

- `js/rules.js` — the deterministic 30 Hz simulation (integer positions and headings, seeded rng streams, bots, motes, thorns, boost, undo ring, scoring, results); `js/content.js` — themes, stages, lessons, challenges, practice difficulties, the Daily; both unchanged from the browser build.
- `js/session.js` — one round: held steering and pointer aims folded into commands each tick (the old main.js loop) and the Learn-mode lesson tracker; shared by the client and the tools.
- `js/progress.js` — the records document and its merge; `js/look.js` — the graphics presets; `js/i18n.js`, `js/sh-strings.js`, `js/locales/` — strings.
- `native/main.ts` (screen flow, input, the fixed-step clock, results, score posting), `native/screens.ts` (all UI), `native/render.ts` (the ring), `native/platform.ts` (save, player, clock, leaderboard), `native/audio.ts`, `native/style.ts` (tools/ui-style.css → assets/ui-style.json), `native/i18n.ts`, `native/game.ts` (typed facade).

### Determinism

The runtime's fixed steps run at the rules' own rate (30 Hz): one rules tick per step, so slow frames never change a round and play scripts replay exactly (render checks play one step a frame). Cosmetic particles use their own randomness and never touch the rules' rng.

## 6. StarHermit integration

- **Save:** the engine save (`saves`, schema 1, on the device and in the player's cloud slot) holds the records document; two devices' saves merge (most plays and wins, best total and peak per item). The browser build's cloud slot (`game:serpent-ring`) shows as foreign and is merged in and replaced once. Guests' old browser localStorage records do not migrate.
- **Settings:** the browser build's settings KV groups (graphics preset, volumes) are the runtime's Options now; the old keys are removed.
- **Leaderboard:** signed in, a finished Daily Challenge or Challenge posts its total (≥ 0) to the `high-score` board through `score-script.js` (a practice session whose socket carries `{ type: 'result', scores }`; the script range-checks it), then shows the player's rank. Learn, Journey and Practice rounds are not posted.
- **Clock:** the Daily's UTC day and the title-bar clock use the platform's server time once it has answered, else the device's clock.
- **Account:** Sign in with StarHermit (guests), Invite a friend (copies the platform invite link), a toast when the session ends.
- **Not offered:** hosted multiplayer (the browser build never connected one), achievements (defined in content but never awarded by the browser build).

## 7. Content, economy, and retention

- Launch scope: tutorial sequence, at least 40 authored stages or equivalent procedural depth, daily challenge, practice, five visual themes, and a mastery track.
- Cosmetic rewards may alter materials, trails, board surrounds, ambience, or profile flourishes, but never hitboxes, timing windows, information, or power.
- Reward cadence: early feedback every session, meaningful unlock every 3–5 sessions, and long-term goals visible without manipulative countdowns.
- No real-money wagering, paid random rewards, forced advertising, energy pressure, punitive streak loss, or purchases that affect competitive outcomes.
- Notifications, if ever added by the host, are opt-in, frequency-capped, quiet-hour aware, and never use false urgency.

## 8. Analytics and privacy

Measure tutorial completion, first meaningful action time, session duration bands, level attempts, quit state, input modality, performance tier, reconnect success, and accessibility feature usage only in aggregate. Use random session identifiers, short retention, and explicit consent where required. Never collect message content, drawings, voice, private board notes, or exact pointer trails as analytics.

Success targets for the first public test: median first-play time under 20 seconds, tutorial completion above 80%, crash-free sessions above 99.5%, p95 input acknowledgment below 100 ms locally, and at least 95% of supported mobile sessions holding their selected frame-rate tier.

## 9. Testing and acceptance criteria

- `npm test`: the rules, content, round, records and look unit tests (`tests/run-tests.js`), every client string translated in all nine locales with matching placeholders (`tests/i18n.test.mjs`), then `tests/native.mjs`: the web index matches the files, `tsc` (strict, the engine's d.ts), `starhermit check .` with no warnings, and every `tests/native/*.play` as a signed-out render check driving the real UI:
  - `learn-keys.play` (desktop): title, Help, modes, Practice list, then Lesson 1 steered by keys to “Lesson complete!” with its exact total;
  - `journey-phone.play` (390×844 @3, menus by touch): Journey stage 1 to its goal;
  - `challenge-land.play` (844×390 @3): the Ember Sprint challenge to its goal;
  - `menus.play` (desktop): the Daily brief and its rules, pause by Esc and the ⏸ button, Leave to title, Practice with undo, and the runtime's Options;
  - `.daily.play` (written at test time): today's Daily played by the bot to its end.
  The round scripts are generated by `tools/gen-plays.mjs` from a steering bot (`tools/plan.mjs`) that plays with the real rules and the client's round code; each expects the round's exact total, peak length and ticks.
- `npm run test:browser` (`tools/browser-play.mjs`): the packaged loader in Chrome on the GPU at a desktop, a phone (DPR 3) and a phone sideways — keys, mouse steering and boost, pause and resume to results on the desktop; finger steering in Lesson 1 on the phone; today's Daily to results sideways — with no console errors or warnings.
- `npm run package` regenerates `index.html` and `starhermit-files.json` after every change; `npm run css` the UI styles.

## 10. Known limitations

- The old pointer steering is kept as it was: the mouse steers by hovering over the ring and a finger on the ring also boosts while it is down (in stages that allow boost).
- Results gained a Leave to title button and Help returns to the screen it was opened from (the browser build's Help always went back to the title).
