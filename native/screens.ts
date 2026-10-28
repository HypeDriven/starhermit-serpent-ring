// The browser build's DOM shell (index.html + css/style.css + main.js's
// screen population) as starhermit:ui, built every frame: the title bar
// (name, player, sync chip, UTC clock, Help), and one screen at a time in a
// centred column up to 760 px wide — the title with its ring vignette and
// menu, the mode cards, Practice difficulties, the Daily brief, the Journey
// chapters, the lessons, the challenges, Help, the ring with its HUD, Pause
// and the results — plus the toast. The old media queries are layouts picked
// by the window's logical size: narrow (≤ 700 px: tighter padding) and short
// landscape (≤ 520 px tall: the ring beside its HUD, the title menu in two
// columns, no vignette). The Graphics screen and the pause panel's volume
// sliders are the runtime's Options (the Options buttons open them).
import { frame, openMenu } from "starhermit:engine";
import { bindings, primaryPointer } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { Content, Rules, Session } from "./game.ts";
import { N, S, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import {
  app, BREAKDOWN, closeHelp, END_REASONS, field, frameDt, fresh, hudLines, invite, itemBrief, itemName, later, lbLine, open,
  pause, resultsHeadline, resume, retry, showDaily, showHelp, showTitle, signIn, startDaily, startLevel, startPractice, themeOf,
} from "./main.ts";
import { token } from "./style.ts";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; narrow: boolean; land: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  return { lw, lh, sc, narrow: lw <= 700, land: lh <= 520 && lw > lh };
}
const lastSize = new Map<string, ui.Rect>();
function textWidth(text: string, style: string, kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: [style] }).width / ui.preferences().scale;
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "text", id?: string): void {
  if (!text) return;
  let u = ui.style(cls);
  if (id) u = u.id(id);
  if (textWidth(text, cls) <= width) u.label(text);
  else u.paragraph(text, Math.max(20, width));
}
/** Centred text up to `width` wide (a centred class): a paragraph that wide, or a label in a centred row. */
function centred(text: string, width: number, cls: string, id?: string): void {
  if (!text) return;
  const u = (): typeof ui => (id ? ui.style(cls).id(id) : ui.style(cls));
  // style() applies to the next widget or container: take it inside the row
  if (textWidth(text, cls) <= width) ui.row(`${id ?? cls}-row`, () => { u().label(text); }, { width, justify: "center" });
  else u().paragraph(text, Math.max(20, width));
}
interface Btn { id: string; text: string; style?: string; act: () => void; name?: string; width?: number; content?: () => void }
const PAD: Record<string, number> = { btn: 32, "btn-primary": 32, "btn-block": 32, "btn-icon": 29, card: 32 };
function button(b: Btn): void {
  const style = b.style ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.content) opts.content = b.content;
  else if (b.width != null && textWidth(b.text, style, "button") > b.width) {
    // a label wider than its button wraps (labels don't)
    const inner = b.width - (PAD[style] ?? 32);
    opts.content = () => { ui.style(style === "btn-primary" ? "wrap-primary" : "wrap").paragraph(b.text, Math.max(20, inner)); };
  } else if (b.name && b.name !== b.text) opts.content = () => { ui.label(b.text); };
  const s: ui.Style = {};
  if (b.width != null) s.width = b.width;
  if (ui.style(style, s).id(b.id).button(b.name ?? b.text, opts) && fresh()) later(b.act);
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  draw.rect(0, 0, f.width, f.height, token("bg")); // body background (--sr-bg)
  ui.place("root", { anchor: "top-start", x: 0, y: 0 }, () => {
    ui.column("shell", () => {
      lastSize.set("topbar", topbar(L));
      body(L);
    }, { width: L.lw, height: L.lh, spacing: 0 });
  });
  toasts(L);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    if (primaryPointer() === "coarse") app.focusNext = null;
    else {
      if (age >= 1) ui.setFocus(app.focusNext);
      if (age >= 3) app.focusNext = null;
    }
  }
}

// ------------------------------------------------------------------ the title bar (.sr-topbar)
function topbar(L: Layout): ui.Rect {
  return ui.row("topbar", () => {
    ui.style("title").label("Serpent Ring");
    ui.spacer();
    if (platform.signedIn() && platform.displayName()) ui.style("player").id("hud-player").label(platform.displayName());
    const sync = platform.syncState();
    ui.style(sync === "synced" ? "sync-synced" : sync === "saving" ? "sync-saving" : "sync").id("sync")
      .label(sync === "synced" ? T("synced") : sync === "saving" ? T("saving…") : T("offline"));
    if (!L.narrow || L.lw > 360) ui.style("clock").id("clock").label(new Date(platform.nowMs()).toISOString().slice(11, 19) + " UTC");
    button({ id: "btn-help", text: "?", name: T("Help and rules"), style: "btn-icon", act: showHelp });
  }, { style: "topbar", width: L.lw, spacing: L.narrow ? 10 : 16, align: "center", padding: { top: L.land ? 3 : 6, bottom: L.land ? 3 : 6, start: 16, end: 16 } });
}

// ------------------------------------------------------------------ the screens (.sr-screen)
function body(L: Layout): void {
  const top = (lastSize.get("topbar")?.height ?? 56 * L.sc) / L.sc;
  const bh = Math.max(40, L.lh - top);
  const w = Math.min(760, L.lw);
  const pad = L.narrow ? 9.6 : 16;
  const inner = w - 2 * pad;
  if (app.screen === "play") { play(L, bh, inner, pad); return; }
  const key = `screen-${app.screen}`;
  const prev = lastSize.get(key);
  const scroll = !!prev && prev.height / L.sc + 2 * pad > bh + 1;
  const opening = frame().frame - app.openedFrame <= 6;
  ui.row("screen-row", () => {
    ui.column("screen", () => {
      const iw = inner - (scroll ? 14 : 0);
      const build = (): void => { lastSize.set(key, ui.column(`${key}-in`, () => screen(L, iw), { spacing: 12, width: iw })); };
      if (scroll) ui.scrollArea(`${key}-scroll`, { width: inner + 6, height: bh - 2 * pad }, build, opening ? { scrollTo: { top: 0 } } : undefined);
      else build();
    }, { width: w, spacing: 0, padding: pad });
  }, { width: L.lw, justify: "center" });
}

function screen(L: Layout, w: number): void {
  switch (app.screen) {
    case "title": title(L, w); break;
    case "modes": modes(w); break;
    case "practice": practice(w); break;
    case "daily": daily(w); break;
    case "journey": journey(w); break;
    case "learn": list(w, "learn"); break;
    case "challenge": list(w, "challenge"); break;
    case "help": help(w); break;
    case "pause": pausePanel(w); break;
    case "results": results(L, w); break;
    default: break;
  }
}

/** Title: the ring vignette, the name, the tagline, the menu. */
function title(L: Layout, w: number): void {
  if (!L.land) {
    const hw = Math.min(0.9 * L.lw, 360), hh = hw / 2;
    ui.row("hero-row", () => {
      ui.widget("", {
        role: "none", size: { width: hw, height: hh },
        draw: (rect) => render.drawHero(rect, frame().scale, Content.THEMES[0]!, frame().time),
      });
    }, { width: w, justify: "center" });
  }
  centred("Serpent Ring", w, "hero-name", "title-h");
  centred(T("Steer, gather light, and outlast the ring."), w, "tagline", "tagline");
  const items: Btn[] = [
    { id: "btn-play", text: T("Play"), style: "btn-primary", act: () => open("modes") },
    { id: "btn-daily", text: T("Daily Challenge"), act: showDaily },
    { id: "btn-journey", text: T("Journey"), act: () => open("journey") },
    { id: "btn-learn", text: T("Learn"), act: () => open("learn") },
    { id: "btn-challenge", text: T("Challenge"), act: () => open("challenge") },
    { id: "btn-options", text: T("Options"), act: openMenu },
  ];
  if (platform.signedIn()) { if (platform.inviteLink()) items.push({ id: "btn-invite", text: S("invite"), act: invite }); }
  else items.push({ id: "btn-signin", text: S("signIn"), act: signIn });
  if (L.land) {
    // the menu in two columns so it fits without scrolling
    const cw = Math.min(260, (w - 10) / 2);
    ui.grid("menu", () => { for (const b of items) button({ ...b, width: cw }); }, { columns: [cw, cw], spacing: 8, justify: "center", width: w } as ui.GridLayout);
  } else {
    const bw = Math.min(0.9 * L.lw, 320);
    ui.column("menu", () => { for (const b of items) button({ ...b, width: bw }); }, { width: w, spacing: 6, align: "center" });
  }
}

/** Choose a mode: the cards (.sr-mode-grid, auto-fit columns of at least 200 px). */
function modes(w: number): void {
  para(T("Choose a mode"), w, "h2", "modes-h");
  const cards: [string, string, () => void, string][] = [
    [N("Practice"), N("Free play against bot rivals. Pick a difficulty."), () => open("practice"), "mode-practice"],
    [N("Journey"), N("40 authored stages in five chapters."), () => open("journey"), "mode-journey"],
    [N("Learn"), N("Five interactive lessons, one mechanic at a time."), () => open("learn"), "mode-learn"],
    [N("Daily Challenge"), N("One shared ring for everyone, today only."), showDaily, "mode-daily"],
    [N("Challenge"), N("Constrained goals: clocks, limits, thorns."), () => open("challenge"), "mode-challenge"],
  ];
  const gap = 9.6;
  const cols = Math.max(1, Math.floor((w + gap) / (200 + gap)));
  const cw = (w - gap * (cols - 1)) / cols;
  for (let r = 0; r * cols < cards.length; r++) {
    ui.row(`modes-r${r}`, () => {
      for (const [label, brief, act, id] of cards.slice(r * cols, r * cols + cols)) {
        const name = T(label);
        button({
          id, text: name, style: "card", width: cw, act,
          content: () => {
            ui.column(`${id}-c`, () => {
              ui.style("card-title").label(name);
              ui.style("card-text").paragraph(T(brief), cw - 32);
            }, { spacing: 4, width: cw - 32 });
          },
        });
      }
    }, { spacing: gap, width: w, align: "stretch" });
  }
  button({ id: "btn-back", text: T("← Back to title"), act: showTitle });
}

function practice(w: number): void {
  para(T("Practice — choose a difficulty"), w, "h2", "practice-h");
  Content.PRACTICE_DIFFICULTIES.forEach((d, i) => {
    button({ id: `diff-${i}`, text: `${T(d.name)} — ${T(d.brief)}`, style: "btn-block", width: w, act: () => startPractice(i) });
  });
  button({ id: "btn-back", text: T("← Back to modes"), act: () => open("modes") });
}

function daily(w: number): void {
  const item = app.dailyItem ?? Content.dailyContent(Rules.dailyKey(new Date(platform.nowMs())));
  para(T("Daily Challenge"), w, "h2", "daily-h");
  para(`${itemName(item)}. ${itemBrief(item)}`, w, "text", "daily-brief");
  flow("daily-btns", [
    { id: "btn-play-daily", text: T("Play the daily challenge"), style: "btn-primary", act: startDaily },
    { id: "btn-daily-rules", text: T("Rules and details"), act: showHelp },
  ], w);
  button({ id: "btn-back", text: T("← Back to title"), act: showTitle });
}

function journey(w: number): void {
  para(T("Journey — 40 stages in five chapters"), w, "h2", "journey-h");
  para(T("{n} stages across five chapters.", { n: Content.JOURNEY.length }), w, "text", "journey-summary");
  let last: string | undefined;
  Content.JOURNEY.forEach((item, i) => {
    if (item.chapter !== last) { last = item.chapter; para(T(item.chapterName!), w, "h3", `chapter-${item.chapter}`); }
    button({ id: `stage-${i}`, text: `${item.index}. ${itemName(item)} — ${itemBrief(item)}`, style: "btn-block", width: w, act: () => startLevel(item) });
  });
  button({ id: "btn-back", text: T("← Back to title"), act: showTitle });
}

function list(w: number, kind: "learn" | "challenge"): void {
  const items = kind === "learn" ? Content.LESSONS : Content.CHALLENGES;
  para(kind === "learn" ? T("Learn — five interactive lessons") : T("Challenge — constrained goals"), w, "h2", `${kind}-h`);
  para(kind === "learn" ? T("{n} short lessons.", { n: items.length }) : T("{n} constrained rings.", { n: items.length }), w, "text", `${kind}-summary`);
  const prefix = kind === "learn" ? "lesson" : "chal";
  items.forEach((item, i) => {
    button({ id: `${prefix}-${i}`, text: `${itemName(item)} — ${itemBrief(item)}`, style: "btn-block", width: w, act: () => startLevel(item) });
  });
  button({ id: "btn-back", text: T("← Back to title"), act: showTitle });
}

/** Buttons at their own widths in rows that wrap at `width` (.sr-rowbtns: flex-wrap). */
function flow(label: string, list: Btn[], width: number, gap = 9.6): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  const bw = (b: Btn): number => Math.min(width, textWidth(b.text, b.style ?? "btn", "button") + 2);
  for (const b of list) {
    const bwid = bw(b);
    if (rows[rows.length - 1]!.length && used + gap + bwid > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + bwid;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => { for (const b of row) button({ ...b, width: bw(b) }); }, { spacing: gap, width, align: "center" }));
  }, { spacing: gap, width });
}

// ------------------------------------------------------------------ help (main.js renderHelp)
const KEY_GLYPH: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc" };
/** The effective keyboard bindings of an action, as the old help named them. */
function keysOf(action: string): string {
  try {
    return bindings(action).filter((b) => b.device === "keyboard").map((b) => KEY_GLYPH[b.code] ?? b.label).join(" / ");
  } catch { return ""; }
}
function help(w: number): void {
  para(T("Help — rules and controls"), w, "h2", "help-h");
  const texts = [
    T("Your serpent glides forward on its own. Steer with the pointer or with {left} and {right}; hold {boost} to boost. {pause} pauses.", {
      left: keysOf("steer_left"), right: keysOf("steer_right"), boost: keysOf("boost"), pause: keysOf("pause"),
    }),
    T("Gather light motes to grow and score. The pale rim, the dark island and the red thorns all end your glide — unless the ruleset says otherwise."),
    T("Each mode states its goal: reach a length, beat a score, survive the clock or outlast your rivals."),
    T("In Practice, press {undo} (or Ctrl+Z) to rewind a bad moment. Undo is not available in ranked modes.", { undo: keysOf("undo") }),
  ];
  texts.forEach((t, i) => para(t, w, "text", `help-${i}`));
  button({ id: "btn-help-close", text: T("Close help"), act: closeHelp });
}

function pausePanel(w: number): void {
  para(T("Paused"), w, "h2", "pause-h");
  button({ id: "btn-resume", text: T("Resume"), style: "btn-primary", act: resume });
  flow("pause-btns", [
    { id: "btn-pause-options", text: T("Options"), act: openMenu },
    { id: "btn-leave", text: T("Leave to title"), act: showTitle },
  ], w);
}

// ------------------------------------------------------------------ results (main.js renderResults)
function results(L: Layout, w: number): void {
  const v = app.results;
  const r = app.round;
  if (!v || !r) return;
  const { lessonDone, res, rec, reason } = v;
  para(resultsHeadline(), w, "h2", "res-headline");
  const tableW = Math.min(320, w);
  const table = (): void => {
    ui.column("score", () => {
      for (const row of res.breakdown) {
        const label = BREAKDOWN[row.key] ? T(BREAKDOWN[row.key]!) : row.label;
        const detail = row.detail === "complete" ? T("complete") : row.detail;
        ui.row(`score-${row.key}`, () => {
          ui.style("score-k").label(detail ? `${label} (${detail})` : label);
          ui.spacer();
          ui.style("score-v").id(`score-${row.key}-v`).label(String(row.amount));
        }, { width: tableW, spacing: 16 });
      }
    }, { width: tableW, spacing: 2 });
  };
  const notes = (nw: number): void => {
    para(T("Total {total} · peak length {len} m · ticks {ticks}", { total: res.total, len: Session.meters(res.peakTrail), ticks: res.elapsedTicks }), nw, "text", "res-total");
    const note = lessonDone ? T("Ended: every step of {name} complete", { name: itemName(r.item) })
      : reason ? T("Ended: {reason}", { reason: END_REASONS[reason] ? T(END_REASONS[reason]!) : String(reason).replace(/-/g, " ") }) : "";
    para(note, nw, "text", "res-note");
    if (rec) para(T("Best {best} · goal met {wins}/{plays} · peak {len} m", { best: rec.best, wins: rec.wins, plays: rec.plays, len: Session.meters(rec.bestPeak) }), nw, "text", "res-best");
    const lb = lbLine();
    if (lb) para(lb, nw, "text", "res-lb");
    flow("res-btns", [
      { id: "btn-retry", text: T("Play again"), style: "btn-primary", act: retry },
      { id: "btn-leave", text: T("Leave to title"), act: showTitle },
    ], nw);
  };
  if (L.land && w >= 520) {
    // short landscape: the score table beside the notes and Play again
    const half = (w - 19) / 2;
    ui.row("res-cols", () => {
      ui.column("res-left", table, { width: half });
      ui.column("res-right", () => notes(half), { width: half, spacing: 8 });
    }, { width: w, spacing: 19, align: "start" });
  } else {
    ui.row("score-wrap", table, { width: w, justify: "center" });
    ui.column("res-notes", () => notes(w), { width: w, spacing: 12 });
  }
}

// ------------------------------------------------------------------ the ring and its HUD (.sr-play)
function play(L: Layout, bh: number, inner: number, pad: number): void {
  const r = app.round;
  if (!r) return;
  const hud = hudLines();
  const theme = themeOf(r.item);
  const fieldWidget = (fw: number, fh: number): void => {
    ui.widget(T("Serpent Ring playfield"), {
      role: "image", size: { width: fw, height: fh },
      draw: (rect) => {
        Object.assign(field, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        render.drawField("play", rect, frame().scale, r.state, theme, frame().time, frameDt);
      },
    });
  };
  const pauseBtn = (): void => button({ id: "btn-pause", text: "⏸", name: T("Pause game"), style: "btn-icon", act: pause });
  if (L.land) {
    // short landscape: the ring sized by the height, the HUD and pause beside it
    const s = Math.max(60, bh - 2 * 6.4);
    const hw = Math.max(80, L.lw - s - 3 * 12.8);
    ui.row("play-row", () => {
      fieldWidget(s, s);
      ui.column("hud", () => {
        para(hud.objective, hw, "text", "hud-objective");
        para(hud.progress, hw, "text", "hud-progress");
        pauseBtn();
      }, { width: hw, spacing: 6 });
    }, { width: L.lw, height: bh, spacing: 12.8, align: "center", padding: { start: 12.8, end: 12.8, top: 6.4, bottom: 6.4 } });
    return;
  }
  const fw = Math.min(inner, 720);
  const fh = Math.min(fw, 0.68 * L.lh);
  ui.row("play-wrap", () => {
    ui.column("play", () => {
      fieldWidget(fw, fh);
      centred(hud.objective, inner, "hud", "hud-objective");
      centred(hud.progress, inner, "hud", "hud-progress");
      ui.row("pause-row", pauseBtn, { width: inner, justify: "center" });
    }, { width: inner + 2 * pad, spacing: 4, align: "center", padding: pad });
  }, { width: L.lw, justify: "center" });
}

// ------------------------------------------------------------------ toast (.sr-toast)
function toasts(L: Layout): void {
  if (!app.toasts.length) return;
  const w = Math.min(L.lw - 32, 480);
  ui.place("toast-stack", { anchor: "bottom", y: 16 }, () => {
    ui.column("toast-col", () => {
      app.toasts.forEach((t, i) => ui.column(`toast-${i}`, () => centred(t.text, w - 32, "toast-text", `toast-${i}-text`), { style: "toast" }));
    }, { spacing: 6, align: "center" });
  });
}
