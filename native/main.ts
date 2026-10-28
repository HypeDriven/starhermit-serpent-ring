// Serpent Ring on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (js/rules.js), content (js/content.js)
// and the round (js/session.js: input folded into commands per tick, the
// lesson tracker) are the browser build's, unchanged in effect; this module
// is what js/main.js did around them — the screen flow (title → modes /
// practice / daily / journey / learn / challenge / help → the ring ⇄ pause
// → results), steering by keys, pads, pointer and touch, boost, undo
// (Practice), the results with the records and the score post, and the
// lifecycle (a hidden window pauses the round, as visibilitychange did).
// Screens are drawn by screens.ts (starhermit:ui), the ring by render.ts.
//
// Time is the runtime's fixed steps at the rules' own rate (30 Hz, one rules
// tick a step), so slow frames never change a round and play scripts replay
// exactly; render checks play one step a frame.
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { isKeyDown, onAction, onKey, onPointerButton, onPointerMove, onTouch } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { Content, Looks, Rules, Session, type GameEvent, type Item, type Rec, type Result, type Round } from "./game.ts";
import * as audio from "./audio.ts";
import { N, S, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyTokens, initStyles } from "./style.ts";

export type Screen = "title" | "modes" | "practice" | "daily" | "journey" | "learn" | "challenge" | "help" | "play" | "pause" | "results";
export interface ResultsView {
  lessonDone: boolean; res: Result; rec: Rec | null; reason: string | null;
  lb: platform.Posted | "posting" | null;
}

export const app = {
  screen: "title" as Screen,
  openedFrame: 0,
  focusNext: null as string | null,
  helpReturn: "title" as Screen,
  round: null as Round | null,
  results: null as ResultsView | null,
  dailyItem: null as Item | null,
  toasts: [] as { text: string; until: number }[],
};
let clockMs = 0;
const now = (): number => clockMs / 1000;
export const fresh = (): boolean => frame().frame !== app.openedFrame;

// ------------------------------------------------------------------ helpers
const spoken: string[] = [];
/** The live regions (objective, progress, results): one announcement a frame, joined. */
export function announce(text: string): void { if (text) spoken.push(text); }
function flushAnnouncements(): void {
  if (!spoken.length) return;
  const text = spoken.splice(0).join(" ").slice(0, 500);
  try { ui.announce(text, { politeness: "polite" }); } catch { /* busy */ }
}
export function toast(text: string, seconds = 3.2): void {
  app.toasts.push({ text, until: Date.now() / 1000 + seconds });
  if (app.toasts.length > 3) app.toasts.shift();
}
const pending: (() => void)[] = [];
/** A widget's press, run once the frame's UI is built (state changes mid-build would break later widgets). */
export function later(fn: () => void): void { pending.push(fn); }

// ------------------------------------------------------------------ names (main.js itemName / itemBrief)
export function itemName(item: Item): string {
  if (item.kind === "daily" && item.dayKey) return T("{name} — {day}", { name: T(item.baseName || item.name), day: item.dayKey });
  if (item.kind === "practice" && item.difficulty) return T("Practice — {name}", { name: T(item.difficulty) });
  return T(item.name);
}
export const itemBrief = (item: Item): string => (item.brief ? T(item.brief) : "");
export const themeOf = (item: Item): ReturnType<typeof Content.themeById> => Content.themeById(item.theme);

// ------------------------------------------------------------------ screens
export function open(s: Screen, focus: string | null = null): void {
  app.screen = s;
  app.openedFrame = frame().frame;
  app.focusNext = focus ?? firstFocus(s);
  ui.setFocus(null);
}
function firstFocus(s: Screen): string | null {
  switch (s) {
    case "title": return "btn-play";
    case "modes": return "mode-practice";
    case "practice": return "diff-0";
    case "daily": return "btn-play-daily";
    case "journey": return "stage-0";
    case "learn": return "lesson-0";
    case "challenge": return "chal-0";
    case "help": return "btn-help-close";
    case "pause": return "btn-resume";
    case "results": return "btn-retry";
    default: return null;
  }
}
export function showTitle(): void {
  app.round = null;
  app.results = null;
  render.resetFx();
  open("title");
}
export function showHelp(): void {
  if (app.screen === "play") { pause(); }
  app.helpReturn = app.screen === "help" ? app.helpReturn : app.screen;
  open("help");
}
export function closeHelp(): void { open(app.helpReturn === "help" ? "title" : app.helpReturn); }
export function showDaily(): void {
  app.dailyItem = Content.dailyContent(Rules.dailyKey(new Date(platform.nowMs())));
  open("daily");
}
export function startDaily(): void {
  startLevel(Content.dailyContent(Rules.dailyKey(new Date(platform.nowMs()))));
}
export function startPractice(i: number): void {
  const d = Content.PRACTICE_DIFFICULTIES[i]!;
  startLevel({
    id: "practice-" + d.id, kind: "practice", name: "Practice — " + d.name, difficulty: d.name,
    brief: d.brief, seed: Rules.seedFromString("practice:" + d.id),
    ruleset: Rules.defaultRuleset({ id: "practice-" + d.id, ...d.ruleset }),
  });
}

// ------------------------------------------------------------------ the round
const held = { left: false, right: false, last: 0, boostKey: false, boostPointer: false };
let lastSpoken = "";
export function startLevel(item: Item): void {
  app.round = Session.createRound(item);
  app.results = null;
  lastSpoken = "";
  render.resetFx();
  held.boostPointer = false;
  open("play", null);
  app.focusNext = null;
  announce(`${itemName(item)}. ${itemBrief(item)}`);
}
export function human(): ReturnType<typeof Session.human> { return app.round ? Session.human(app.round) : undefined; }
export function pause(): void {
  if (!app.round || app.round.over || app.screen !== "play") return;
  open("pause");
}
export function resume(): void {
  if (!app.round) { showTitle(); return; }
  open("play", null);
  app.focusNext = null;
}
export function retry(): void { if (app.round) startLevel(app.round.item); }
export function undo(): void {
  const r = app.round;
  if (!r || r.over || app.screen !== "play") return;
  Session.undo(r);
}

/** Acknowledge simulation events with sound (main.js sonify): eating and boosting only for the player's own serpent; deaths anywhere. */
function sonify(events: GameEvent[]): void {
  if (!events.length) return;
  const me = human();
  const played = new Set<string>();
  for (const e of events) {
    let kind: audio.Sfx | null = null;
    if ((e.type === "eat" || e.type === "boost-start") && me && e.serpent === me.id) kind = e.type;
    else if (e.type === "death") kind = "death";
    if (!kind || played.has(kind)) continue;
    played.add(kind);
    audio.play(kind);
  }
}

/** The HUD's two lines (main.js updateHud). */
export function hudLines(): { objective: string; progress: string } {
  const r = app.round!;
  const me = human();
  const objective = itemName(r.item) + (r.item.brief ? " — " + itemBrief(r.item) : "");
  const L = r.lesson;
  if (L && me) {
    const steps = r.item.steps!;
    const progress = !me.alive ? T("Down — press Play again to retry the lesson.")
      : L.done ? T("Lesson complete.")
      : T("Step {n} / {total} — {text}", { n: L.index + 1, total: steps.length, text: T(steps[L.index]!.text) });
    return { objective, progress };
  }
  const st = me && Rules.getGoalStatus(r.state, me.id);
  if (st && st.goal && me) {
    return {
      objective,
      progress: me.alive
        ? T("Goal {current} / {target} · length {len} m", { current: Math.min(st.current, st.target), target: st.target, len: Session.meters(Rules.trailLength(r.state.ruleset, me)) })
        : T("Down — watch the rim, island and thorns."),
    };
  }
  return { objective, progress: me && me.alive ? T("Glide on.") : T("Down.") };
}

function finishIfTerminal(): void {
  const r = app.round;
  if (!r || r.over || !Session.finished(r)) return;
  r.over = true;
  const lessonDone = !!(r.lesson && r.lesson.done);
  const res = Rules.makeResult(r.state, human(), "local");
  const rec = platform.recordResult(r.item, res);
  const view: ResultsView = { lessonDone, res, rec, reason: r.state.terminal ? r.state.terminal.reason : null, lb: null };
  app.results = view;
  open("results");
  announce(resultsHeadline());
  // Signed in: post a ranked round (Daily Challenge, Challenges) to the high-score board (score-script.js).
  const ranked = r.item.kind === "daily" || r.item.kind === "challenge";
  if (ranked && platform.signedIn()) {
    view.lb = "posting";
    void platform.postScore(Math.max(0, res.total)).then((p) => { view.lb = p; });
  }
}
export function resultsHeadline(): string {
  const v = app.results;
  if (!v) return "";
  return v.lessonDone ? T("Lesson complete!") : v.res.goalMet ? T("Goal complete!") : T("Ring claimed you.");
}
export function lbLine(): string | null {
  const lb = app.results?.lb;
  if (!lb) return null;
  if (lb === "posting") return S("lbPosting");
  return !lb.posted ? S("lbNotPosted") : lb.rank ? S("lbRank", { rank: lb.rank }) : S("lbPosted");
}
export const BREAKDOWN: Record<string, string> = {
  motes: N("Motes gathered"), mass: N("Mass consumed"), peak: N("Peak length"),
  survival: N("Survival"), eliminations: N("Eliminations"), goal: N("Objective"),
};
export const END_REASONS: Record<string, string> = {
  "goal-reached": N("goal reached"), "last-standing": N("last one standing"), "time-up": N("time up"),
  conceded: N("conceded"), collision: N("collision"),
};

// ------------------------------------------------------------------ account
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function invite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(S("inviteCopied")); } catch { toast(S("inviteLink", { url: link }), 8); }
}

// ------------------------------------------------------------------ keys and pads (main.js keydown / keyup)
onAction((e) => {
  const a = e.action;
  if (a === "steer_left") { held.left = e.pressed; if (e.pressed) held.last = 1; }
  else if (a === "steer_right") { held.right = e.pressed; if (e.pressed) held.last = -1; }
  else if (a === "boost") held.boostKey = e.pressed;
  if (!e.pressed || ui.capturingKeys()) return;
  if (a === "pause") {
    if (app.screen === "play" && fresh()) later(pause);
    else if (app.screen === "pause" && fresh()) later(resume);
    else if (app.screen === "help" && fresh()) later(closeHelp);
    return;
  }
  if (a === "undo" && app.screen === "play") later(undo);
  // steering and boost keys are the round's, not UI focus navigation
  if (app.screen === "play" && (a === "steer_left" || a === "steer_right" || a === "boost")) ui.setFocus(null);
});
onKey((e) => {
  // Ctrl+Z undoes too (Practice)
  if (e.pressed && !e.repeat && e.code === "KeyZ" && (isKeyDown("ControlLeft") || isKeyDown("ControlRight") || isKeyDown("MetaLeft") || isKeyDown("MetaRight")) && app.screen === "play") later(undo);
});
/** Headings increase counter-clockwise in the y-up world: positive turns left. */
function steerDir(): number {
  if (held.left && held.right) return held.last;
  return held.left ? 1 : held.right ? -1 : 0;
}

// ------------------------------------------------------------------ pointer and touch on the ring (main.js bindPointer)
/** The playfield's rectangle in window pixels, set by screens.ts as it lays out. */
export const field: render.Rect = { x: 0, y: 0, width: 0, height: 0 };
const inField = (x: number, y: number): boolean => field.width > 0 && x >= field.x && y >= field.y && x <= field.x + field.width && y <= field.y + field.height;
let lastTouch = -1e9;
/** Aim at the pointer about the arena centre (a dead zone of 8 CSS px). */
function pointerSteer(x: number, y: number): void {
  const r = app.round;
  if (!r || r.over || app.screen !== "play") return;
  const dx = (x - (field.x + field.width / 2)) / frame().scale;
  const dy = (y - (field.y + field.height / 2)) / frame().scale;
  if (dx * dx + dy * dy < 64) return;
  Session.aim(r, Math.atan2(-dy, dx));
}
onPointerMove((x, y) => {
  if (now() - lastTouch < 0.6 || !inField(x, y)) return;
  pointerSteer(x, y);
});
onPointerButton((e) => {
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  if (e.pressed && inField(e.x, e.y) && app.screen === "play") { held.boostPointer = true; pointerSteer(e.x, e.y); }
  else if (!e.pressed) held.boostPointer = false;
});
onTouch((e) => {
  lastTouch = now();
  if (e.control || !e.primary) return;
  if (e.phase === "start") {
    if (inField(e.x, e.y) && app.screen === "play") { held.boostPointer = true; pointerSteer(e.x, e.y); }
  } else if (e.phase === "move") { if (held.boostPointer) pointerSteer(e.x, e.y); }
  else held.boostPointer = false;
});

// ------------------------------------------------------------------ the clock: one rules tick a fixed step
let hidden = false;
onFixedUpdate(() => {
  if (hidden) return;
  clockMs += 1000 / Rules.TICK_RATE;
  const r = app.round;
  if (!r || r.over || app.screen !== "play") return;
  r.steerDir = steerDir();
  r.boostWanted = held.boostKey || held.boostPointer;
  const events = Session.tick(r);
  sonify(events);
  render.fxEvents(events, r.state, themeOf(r.item));
  finishIfTerminal();
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.setLook(Looks.lookFor(f.quality, f.levelIndex));
}
onStart(() => {
  setFixedRate(Rules.TICK_RATE);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  open("title");
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
onSessionEnded(() => toast(S("signedOut")));
onSuspend(() => {
  hidden = true;
  // backgrounding pauses the round (main.js visibilitychange)
  if (app.screen === "play" && app.round && !app.round.over) pause();
  platform.flush();
});
onResume(() => { hidden = false; });

export let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  applyTokens(ui.preferences().highContrast);
  audio.update();
  const t = Date.now() / 1000;
  app.toasts = app.toasts.filter((x) => x.until >= t);
});
onRender(() => {
  drawScreens();
  for (const fn of pending.splice(0)) fn();
  if (app.screen === "play" && app.round) {
    // the progress line is a live region: speak it when the lesson step or the player's fate changes
    const r = app.round, me = human();
    const key = `${r.lesson ? `${r.lesson.index}:${r.lesson.done}` : ""}|${me?.alive}`;
    if (key !== lastSpoken) announce(hudLines().progress);
    lastSpoken = key;
  }
  flushAnnouncements();
});
export { now };
