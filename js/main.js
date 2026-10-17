/**
 * Serpent Ring — bootstrap: screen population, input mapping, fixed-timestep
 * game loop, HUD and results. Uses the 2D canvas renderer (render.js); the
 * authoritative simulation lives in rules.js.
 */
import { initUI } from './ui.js';
import * as rules from './rules.js';
import * as content from './content.js';
import { render, renderHero, fxEvents, resetFx } from './render.js';
import * as graphics from './graphics.js';
import { playEvent } from './audio.js';
import * as platform from './platform.js';
import { setMusicVolume, setSfxVolume } from './audio.js';
import { shText } from './sh-strings.js';
import { T, N, getLang, onLanguage, initLanguage } from './i18n.js';

const $ = (sel) => document.querySelector(sel);
const TICK_MS = 1000 / rules.TICK_RATE;

/** Display length: content and goals speak in metres of 10 trail ticks. */
const meters = (trailTicks) => (trailTicks / 10).toFixed(1);

function showScreen(name) {
  const main = $('#sr-main');
  if (!main) return;
  for (const sec of main.querySelectorAll('[data-sr-screen]')) {
    sec.hidden = sec.getAttribute('data-sr-screen') !== name;
  }
}

function btn(label, className, onClick, nav) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sr-btn' + (className ? ' ' + className : '');
  b.textContent = label;
  if (nav) b.setAttribute('data-sr-nav', nav);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/* ------------------------------------------------------------------ *
 *  Screen population
 * ------------------------------------------------------------------ */

let dailyItem = content.dailyContent();

/** A content item's display name in the current language (daily and practice names are composed). */
function itemName(item) {
  if (item.kind === 'daily' && item.dayKey) return T('{name} — {day}', { name: T(item.baseName || item.name), day: item.dayKey });
  if (item.kind === 'practice' && item.difficulty) return T('Practice — {name}', { name: T(item.difficulty) });
  return T(item.name);
}
const itemBrief = (item) => (item.brief ? T(item.brief) : '');

/** Build (or rebuild, on a language change) every menu list built in code. */
function populate() {
  const modeList = $('#mode-list');
  modeList.textContent = '';
  for (const [label, brief, nav] of [
    [N('Practice'), N('Free play against bot rivals. Pick a difficulty.'), 'practice-difficulty'],
    [N('Journey'), N('40 authored stages in five chapters.'), 'journey-setup'],
    [N('Learn'), N('Five interactive lessons, one mechanic at a time.'), 'learn-setup'],
    [N('Daily Challenge'), N('One shared ring for everyone, today only.'), 'daily-setup'],
    [N('Challenge'), N('Constrained goals: clocks, limits, thorns.'), 'challenge-setup'],
  ]) {
    const card = btn('', 'sr-mode-card', null, nav);
    const t = document.createElement('strong');
    t.textContent = T(label);
    const p = document.createElement('p');
    p.textContent = T(brief);
    card.append(t, p);
    modeList.appendChild(card);
  }

  const diffList = $('#diff-list');
  diffList.textContent = '';
  for (const d of content.PRACTICE_DIFFICULTIES) {
    diffList.appendChild(btn(`${T(d.name)} — ${T(d.brief)}`, 'sr-blockbtn', () => startLevel({
      id: 'practice-' + d.id, kind: 'practice', name: 'Practice — ' + d.name, difficulty: d.name,
      brief: d.brief, seed: rules.seedFromString('practice:' + d.id),
      ruleset: rules.defaultRuleset(Object.assign({ id: 'practice-' + d.id }, d.ruleset)),
    })));
  }

  $('#journey-summary').textContent = T('{n} stages across five chapters.', { n: content.JOURNEY.length });
  const chapterList = $('#chapter-list');
  chapterList.textContent = '';
  let lastChapter = null;
  for (const item of content.JOURNEY) {
    if (item.chapter !== lastChapter) {
      lastChapter = item.chapter;
      const h = document.createElement('h3');
      h.className = 'sr-h3';
      h.textContent = T(item.chapterName);
      chapterList.appendChild(h);
    }
    chapterList.appendChild(btn(`${item.index}. ${itemName(item)} — ${itemBrief(item)}`, 'sr-blockbtn', () => startLevel(item)));
  }

  $('#learn-summary').textContent = T('{n} short lessons.', { n: content.LESSONS.length });
  const lessonList = $('#lesson-list');
  lessonList.textContent = '';
  for (const item of content.LESSONS) {
    lessonList.appendChild(btn(`${itemName(item)} — ${itemBrief(item)}`, 'sr-blockbtn', () => startLevel(item)));
  }

  $('#challenge-summary').textContent = T('{n} constrained rings.', { n: content.CHALLENGES.length });
  const chalList = $('#chal-list');
  chalList.textContent = '';
  for (const item of content.CHALLENGES) {
    chalList.appendChild(btn(`${itemName(item)} — ${itemBrief(item)}`, 'sr-blockbtn', () => startLevel(item)));
  }

  renderDailyBrief();
  renderHelp();
}

function renderDailyBrief() {
  $('#daily-brief').textContent = `${itemName(dailyItem)}. ${itemBrief(dailyItem)}`;
}

// Help names the effective keyboard bindings (platform controls API).
function keyLabel(code) {
  const named = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc' };
  return named[code] || code.replace(/^Key|^Digit/, '');
}
function keysOf(action) { return (platform.getBindings()[action] || []).map(keyLabel).join(' / '); }
function renderHelp() {
  const body = $('#help-body');
  body.textContent = '';
  for (const text of [
    T('Your serpent glides forward on its own. Steer with the pointer or with {left} and {right}; hold {boost} to boost. {pause} pauses.', {
      left: keysOf('steer_left'), right: keysOf('steer_right'), boost: keysOf('boost'), pause: keysOf('pause'),
    }),
    T('Gather light motes to grow and score. The pale rim, the dark island and the red thorns all end your glide — unless the ruleset says otherwise.'),
    T('Each mode states its goal: reach a length, beat a score, survive the clock or outlast your rivals.'),
    T('In Practice, press {undo} (or Ctrl+Z) to rewind a bad moment. Undo is not available in ranked modes.', { undo: keysOf('undo') }),
  ]) {
    const p = document.createElement('p');
    p.textContent = text;
    body.appendChild(p);
  }
}

/* ------------------------------------------------------------------ *
 *  Game loop
 * ------------------------------------------------------------------ */

let cur = null; // { item, state, last, acc, steerDir, desiredHeading, boostWanted, over }

function startLevel(item) {
  paused = false;
  const state = rules.createGame({
    seed: item.seed,
    ruleset: item.ruleset,
    modeId: item.id,
    contentVersion: content.CONTENT_VERSION,
  });
  const me = state.serpents.find((s) => !s.isBot);
  cur = {
    item, state,
    last: performance.now(), acc: 0,
    steerDir: 0, desiredHeading: me ? me.targetHeading : 0,
    boostWanted: false, over: false,
    lesson: null,
  };
  if (item.kind === 'learn' && Array.isArray(item.steps) && item.steps.length) {
    cur.lesson = { index: 0, done: false };
    resetLessonStep(me);
  }
  resetFx();
  graphics.resetTiming();
  showScreen('play');
  resizeCanvas();
  updateHud();
}

function human() { return cur && cur.state.serpents.find((s) => !s.isBot); }

function pushSteer() {
  const me = human();
  if (!me || !me.alive) return;
  const h = ((Math.round(cur.desiredHeading) % rules.HEADING_MAX) + rules.HEADING_MAX) % rules.HEADING_MAX;
  if (h !== me.targetHeading) rules.applyCommand(cur.state, rules.makeCommand(me.id, 'steer', { heading: h }));
}

function pushBoost() {
  const me = human();
  if (!me) return;
  if (cur.boostWanted === me.boostOn) return;
  // Only send a boost request the rules will accept: holding the key with too
  // little mass would otherwise queue a rejected command every single tick and
  // inflate the invalid-action tie-breaker.
  if (cur.boostWanted && !rules.getLegalActions(cur.state, me.id).boost.valid) return;
  rules.applyCommand(cur.state, rules.makeCommand(me.id, 'boost', { on: cur.boostWanted }));
}

/**
 * Acknowledge simulation events with sound. Eating and boosting are only
 * sonified for the player's own serpent; deaths anywhere in the ring are
 * audible because they change the field. At most one clip per kind per tick.
 */
function sonify(events) {
  if (!events || !events.length) return;
  const me = human();
  const played = new Set();
  for (const e of events) {
    let kind = null;
    if ((e.type === 'eat' || e.type === 'boost-start') && me && e.serpent === me.id) kind = e.type;
    else if (e.type === 'death') kind = 'death';
    if (!kind || played.has(kind)) continue;
    played.add(kind);
    playEvent(kind);
  }
}

/* ------------------------------------------------------------------ *
 *  Learn mode: the authored lesson steps drive the HUD and completion.
 *  Every check is evaluated from authoritative engine state only.
 * ------------------------------------------------------------------ */

function resetLessonStep(me) {
  const L = cur.lesson;
  if (!L || !me) return;
  L.base = {
    tick: cur.state.tick,
    motes: me.score.motes,
    boostTicks: me.boostTicksUsed,
    eliminations: me.score.eliminations,
  };
  L.turned = 0;          // total heading swept, in heading units
  L.angleSum = 0;        // signed angle swept about the arena centre
  L.blooms = 0;          // bloom motes eaten during this step
  L.near = 0;            // ticks spent close to a rival body
  L.prevHeading = me.heading;
  L.prevAngle = Math.atan2(me.y, me.x);
}

function lessonAccumulate(events, me) {
  const L = cur.lesson;
  let d = (me.heading - L.prevHeading) % rules.HEADING_MAX;
  if (d > rules.HEADING_MAX / 2) d -= rules.HEADING_MAX;
  if (d < -rules.HEADING_MAX / 2) d += rules.HEADING_MAX;
  L.turned += Math.abs(d);
  L.prevHeading = me.heading;

  const ang = Math.atan2(me.y, me.x);
  let da = ang - L.prevAngle;
  if (da > Math.PI) da -= Math.PI * 2;
  if (da < -Math.PI) da += Math.PI * 2;
  L.angleSum += da;
  L.prevAngle = ang;

  for (const e of events) {
    if (e.type === 'eat' && e.serpent === me.id && e.bloom) L.blooms++;
  }

  for (const o of cur.state.serpents) {
    if (o === me || !o.alive) continue;
    if (o.trail.some((p) => (p.x - me.x) ** 2 + (p.y - me.y) ** 2 < 1100 * 1100)) { L.near++; break; }
  }
}

function lessonStepMet(check, me) {
  const L = cur.lesson;
  const elapsed = cur.state.tick - L.base.tick;
  switch (check.type) {
    case 'heading-turned': return L.turned >= check.value;
    case 'laps': return Math.abs(L.angleSum) >= check.value * Math.PI * 2;
    case 'ticks': return elapsed >= check.value;
    case 'motes':
    case 'motes-after': return me.score.motes - L.base.motes >= check.value;
    case 'length': return me.trail.length >= check.value;
    case 'length-alive': return me.alive && me.trail.length >= check.value;
    case 'bloom': return L.blooms >= check.value;
    case 'boost-ticks': return me.boostTicksUsed - L.base.boostTicks >= check.value;
    case 'proximity': return L.near >= check.value;
    case 'eliminate-or-survive':
      return me.score.eliminations > L.base.eliminations || elapsed >= check.value;
    default: return false;
  }
}

function lessonTick(events) {
  const L = cur.lesson;
  if (!L || L.done) return;
  const me = human();
  if (!me || !me.alive) return;
  lessonAccumulate(events, me);
  const step = cur.item.steps[L.index];
  if (!step || !lessonStepMet(step.check, me)) return;
  L.index++;
  if (L.index >= cur.item.steps.length) L.done = true;
  else resetLessonStep(me);
}

function updateHud() {
  if (!cur) return;
  const me = human();
  const objEl = $('[data-sr-live="objective"]');
  const progEl = $('[data-sr-live="progress"]');
  const st = me && rules.getGoalStatus(cur.state, me.id);
  objEl.textContent = itemName(cur.item) + (cur.item.brief ? ' — ' + itemBrief(cur.item) : '');
  const L = cur.lesson;
  if (L && me) {
    const steps = cur.item.steps;
    progEl.textContent = !me.alive
      ? T('Down — press Play again to retry the lesson.')
      : L.done
        ? T('Lesson complete.')
        : T('Step {n} / {total} — {text}', { n: L.index + 1, total: steps.length, text: T(steps[L.index].text) });
    return;
  }
  if (st && st.goal) {
    progEl.textContent = me.alive
      ? T('Goal {current} / {target} · length {len} m', { current: Math.min(st.current, st.target), target: st.target, len: meters(rules.trailLength(cur.state.ruleset, me)) })
      : T('Down — watch the rim, island and thorns.');
  } else {
    progEl.textContent = me && me.alive ? T('Glide on.') : T('Down.');
  }
}

function finishIfTerminal() {
  if (!cur || cur.over) return;
  const lessonDone = !!(cur.lesson && cur.lesson.done);
  if (cur.state.phase !== 'terminal' && !lessonDone) return;
  cur.over = true;
  const me = human();
  const res = rules.makeResult(cur.state, me, 'local');
  const rec = platform.recordResult(cur.item, res);
  cur.resultsView = { lessonDone, res, rec, reason: cur.state.terminal ? cur.state.terminal.reason : null };
  renderResults();
  showScreen('results');
  const ranked = cur.item.kind === 'daily' || cur.item.kind === 'challenge';
  postToLeaderboard(ranked ? Math.max(0, res.total) : null);
}

const BREAKDOWN = {
  motes: N('Motes gathered'), mass: N('Mass consumed'), peak: N('Peak length'),
  survival: N('Survival'), eliminations: N('Eliminations'), goal: N('Objective'),
};
const END_REASONS = {
  'goal-reached': N('goal reached'), 'last-standing': N('last one standing'), 'time-up': N('time up'),
  conceded: N('conceded'), collision: N('collision'),
};

/** Results screen texts (re-run on a language change). */
function renderResults() {
  const view = cur && cur.resultsView;
  if (!view) return;
  const { lessonDone, res, rec, reason } = view;
  $('#res-headline').textContent = lessonDone ? T('Lesson complete!')
    : res.goalMet ? T('Goal complete!') : T('Ring claimed you.');
  const bd = $('#score-breakdown');
  bd.innerHTML = '';
  const table = document.createElement('dl');
  table.className = 'sr-score';
  for (const row of res.breakdown || []) {
    const dt = document.createElement('dt');
    const label = BREAKDOWN[row.key] ? T(BREAKDOWN[row.key]) : row.label;
    const detail = row.detail === 'complete' ? T('complete') : row.detail;
    dt.textContent = detail ? `${label} (${detail})` : label;
    const dd = document.createElement('dd'); dd.textContent = String(row.amount);
    table.append(dt, dd);
  }
  const total = document.createElement('p');
  total.textContent = T('Total {total} · peak length {len} m · ticks {ticks}', { total: res.total, len: meters(res.peakTrail), ticks: res.elapsedTicks });
  bd.append(table, total);
  $('#res-note').textContent = lessonDone
    ? T('Ended: every step of {name} complete', { name: itemName(cur.item) })
    : reason ? T('Ended: {reason}', { reason: END_REASONS[reason] ? T(END_REASONS[reason]) : String(reason).replace(/-/g, ' ') }) : '';
  $('#res-best').textContent = rec
    ? T('Best {best} · goal met {wins}/{plays} · peak {len} m', { best: rec.best, wins: rec.wins, plays: rec.plays, len: meters(rec.bestPeak) })
    : '';
  if (cur.lb) $('#res-lb').textContent = lbText(cur.lb);
}

function lbText(lb) {
  if (lb.state === 'posting') return shText('lbPosting');
  if (lb.state === 'failed') return shText('lbNotPosted');
  return lb.rank ? shText('lbRank', { rank: lb.rank }) : shText('lbPosted');
}

// Signed in only: post a ranked round (Daily Challenge, Challenges) to the
// `high-score` board and show the player's rank on the results screen.
function postToLeaderboard(total) {
  const line = $('#res-lb');
  if (total == null || !platform.isHosted()) { line.hidden = true; return; }
  line.hidden = false;
  const round = cur;
  round.lb = { state: 'posting' };
  line.textContent = lbText(round.lb);
  platform.submitScore(total).then((r) => {
    round.lb = !r.posted ? { state: 'failed' } : { state: 'posted', rank: r.rank || null };
    if (cur !== round) return;
    line.textContent = lbText(round.lb);
  });
}

function drawHero(now) {
  const hero = $('#sr-hero-canvas');
  if (!hero || hero.offsetParent === null) return;
  const ratio = graphics.pixelRatio();
  const w = Math.max(1, Math.round(hero.clientWidth * ratio));
  const h = Math.max(1, Math.round(hero.clientHeight * ratio));
  if (hero.width !== w || hero.height !== h) { hero.width = w; hero.height = h; }
  renderHero(hero, content.THEMES[0], now);
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!cur) drawHero(now);
  if (!cur || cur.over || paused) { if (cur) cur.last = now; graphics.resetTiming(); return; }
  const dt = Math.min(100, now - cur.last);
  cur.last = now;
  cur.acc += dt;
  let steps = 0;
  while (cur.acc >= TICK_MS && steps < 6) {
    const me = human();
    if (cur.steerDir !== 0) {
      // Track the rate the simulation will actually turn at, so held keys do
      // not build up a heading debt while boosting (boost turns slower).
      const sp = cur.state.ruleset.serpent;
      const rate = me && me.boostOn ? sp.boostTurnRate : sp.turnRate;
      cur.desiredHeading = (cur.desiredHeading + cur.steerDir * rate + rules.HEADING_MAX) % rules.HEADING_MAX;
      pushSteer();
    }
    pushBoost();
    const events = rules.step(cur.state);
    sonify(events);
    fxEvents(events, cur.state, content.themeById(cur.item.theme));
    lessonTick(events);
    cur.acc -= TICK_MS;
    steps++;
  }
  const canvas = $('#game-canvas');
  if (canvas) render(canvas, cur.state, content.themeById(cur.item.theme), now);
  graphics.frameTick(now);
  updateHud();
  finishIfTerminal();
}

/* ------------------------------------------------------------------ *
 *  Input
 * ------------------------------------------------------------------ */

let paused = false;

function setPaused(on) {
  if (!cur || cur.over) on = false;
  if (paused === on) return;
  paused = on;
  if (on) { cur.steerDir = 0; cur.boostWanted = false; }
  showScreen(on ? 'pause' : 'play');
}

// Headings increase counter-clockwise in the y-up world: positive turns left.
// Keys route by KeyboardEvent.code through the player's bindings (control.* in starhermit.txt).
const STEER = { steer_left: 1, steer_right: -1 };

window.addEventListener('keydown', (e) => {
  if (!cur || cur.over || $('[data-sr-screen="help"]')?.hidden === false || graphics.isOpen()) return;
  const action = platform.actionFor(e.code);
  if (paused && action !== 'pause') return;
  if (action in STEER) { cur.steerDir = STEER[action]; e.preventDefault(); }
  else if (action === 'boost') { cur.boostWanted = true; e.preventDefault(); }
  else if (action === 'undo' || ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ')) {
    // Undo where the ruleset permits it (Practice); ignored elsewhere.
    const me = human();
    if (me && rules.getLegalActions(cur.state, me.id).undo.valid) {
      rules.applyCommand(cur.state, rules.makeCommand(me.id, 'undo'));
    }
    e.preventDefault();
  }
  else if (action === 'pause') { setPaused(!paused); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  if (!cur) return;
  const action = platform.actionFor(e.code);
  if (action in STEER && cur.steerDir === STEER[action]) cur.steerDir = 0;
  else if (action === 'boost') cur.boostWanted = false;
});

// Pointer steering: aim at the pointer position relative to the arena centre.
function pointerSteer(e) {
  if (!cur || paused) return;
  const canvas = $('#game-canvas');
  const r = canvas.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2);
  const dy = e.clientY - (r.top + r.height / 2);
  if (dx * dx + dy * dy < 64) return; // dead zone around the centre
  cur.desiredHeading = rules.angleToHeading(Math.atan2(-dy, dx));
  pushSteer();
}

function bindPointer() {
  const canvas = $('#game-canvas');
  canvas.addEventListener('pointermove', pointerSteer);
  canvas.addEventListener('pointerdown', (e) => { cur && (cur.boostWanted = true); pointerSteer(e); });
  canvas.addEventListener('pointerup', () => { if (cur) cur.boostWanted = false; });
  canvas.addEventListener('pointercancel', () => { if (cur) cur.boostWanted = false; });
}

/* ------------------------------------------------------------------ *
 *  Canvas sizing, pause button, daily / retry hooks
 * ------------------------------------------------------------------ */

function resizeCanvas() {
  const canvas = $('#game-canvas');
  if (!canvas) return;
  // Backing-store ratio from the Graphics settings: min(dpr, preset cap) ×
  // render scale × adaptive scale (Low caps at 1, as cheap as the plain build).
  const dpr = graphics.pixelRatio();
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[id], [data-sr-nav]');
  if (!el) return;
  if (el.id === 'sr-help-open') { setPaused(true); return; }
  if (el.id === 'btn-pause') { setPaused(true); return; }
  const nav = el.getAttribute && el.getAttribute('data-sr-nav');
  if (nav === 'daily-setup' || nav === 'daily') {
    dailyItem = content.dailyContent();
    renderDailyBrief();
  }
  if (nav === 'play-daily') startLevel(content.dailyContent());
  else if (nav === 'retry' && cur) startLevel(cur.item);
  else if (nav === 'title' || el.id === 'btn-leave' || el.id === 'btn-help-close' || el.id === 'btn-err-close') {
    cur = null; paused = false;
  } else if (el.id === 'btn-resume') setPaused(false);
});

window.addEventListener('resize', resizeCanvas);
document.addEventListener('visibilitychange', () => { if (document.hidden && cur && !cur.over) setPaused(true); });

/* ------------------------------------------------------------------ *
 *  StarHermit account: sign-in, invite link, settings + bindings
 * ------------------------------------------------------------------ */

function toast(msg, ms = 3200) {
  const t = $('#sr-toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

function renderAccount() {
  const signin = $('#btn-signin');
  const invite = $('#btn-invite');
  if (signin) signin.hidden = platform.isHosted() || !platform.canSignIn();
  if (invite) invite.hidden = !platform.isHosted();
}

function audioLevels() {
  const v = (k) => Number($(`[data-sr-audio="${k}"]`)?.value ?? 0);
  return { music: v('music'), sfx: v('sfx') };
}

function renderAccountText() {
  $('#btn-signin').textContent = shText('signIn');
  $('#btn-invite').textContent = shText('invite');
}

async function initAccount() {
  renderAccountText();
  platform.onSaveConflict(() => { if (cur && cur.resultsView) renderResults(); });
  $('#btn-signin').addEventListener('click', () => platform.signIn());
  $('#btn-invite').addEventListener('click', async () => {
    const url = platform.inviteLink();
    if (!url) return;
    try { await navigator.clipboard.writeText(url); toast(shText('inviteCopied')); }
    catch { toast(shText('inviteLink', { url }), 8000); }
  });
  platform.onAuth((signedIn) => { if (!signedIn) toast(shText('signedOut')); renderAccount(); });
  renderAccount();
  // Signed in: the platform's settings and key bindings win over this device's copy.
  const remote = await platform.loadSettings();
  if (remote.graphics) graphics.setSaved(remote.graphics);
  if (remote.audio) {
    for (const [k, set] of [['music', setMusicVolume], ['sfx', setSfxVolume]]) {
      const v = Number(remote.audio[k]);
      const input = $(`[data-sr-audio="${k}"]`);
      if (Number.isFinite(v) && input) { input.value = String(v); set(v); }
    }
  }
  graphics.onChange(() => platform.mirrorSettings({ graphics: graphics.getSaved() }));
  document.addEventListener('change', (e) => {
    if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-sr-audio')) platform.mirrorSettings({ audio: audioLevels() });
  });
  await platform.loadBindings();
  renderHelp();
}

// Live clock in the title bar.
setInterval(() => {
  const el = $('[data-sr-live="clock"]');
  if (el) el.textContent = new Date().toISOString().slice(11, 19) + ' UTC';
}, 1000);

// Language first (sh-language.js: Language setting → account preference → browser),
// then a change re-renders every text built in code, in place.
initLanguage();
onLanguage((locale) => {
  graphics.setLocale(locale);
  populate();
  renderAccountText();
  platform.relabel();
  if (cur) updateHud();
  if (cur && cur.resultsView) renderResults();
});
populate();
graphics.onChange(() => resizeCanvas());
graphics.initGraphics(getLang());
platform.init();
platform.loadSave();
initUI();
initAccount();
bindPointer();
showScreen('title');
requestAnimationFrame(frame);
