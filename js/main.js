/**
 * Serpent Ring — bootstrap: screen population, input mapping, fixed-timestep
 * game loop, HUD and results. Uses the 2D canvas renderer (render.js); the
 * authoritative simulation lives in rules.js.
 */
import { initUI } from './ui.js';
import * as rules from './rules.js';
import * as content from './content.js';
import { render } from './render.js';
import { playEvent } from './audio.js';
import * as platform from './platform.js';

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

function populate() {
  const modeList = $('#mode-list');
  for (const [label, brief, nav] of [
    ['Practice', 'Free play against bot rivals. Pick a difficulty.', 'practice-difficulty'],
    ['Journey', '40 authored stages in five chapters.', 'journey-setup'],
    ['Learn', 'Five interactive lessons, one mechanic at a time.', 'learn-setup'],
    ['Daily Challenge', 'One shared ring for everyone, today only.', 'daily-setup'],
    ['Challenge', 'Constrained goals: clocks, limits, thorns.', 'challenge-setup'],
  ]) {
    const card = btn('', 'sr-mode-card', null, nav);
    const t = document.createElement('strong');
    t.textContent = label;
    const p = document.createElement('p');
    p.textContent = brief;
    card.append(t, p);
    modeList.appendChild(card);
  }

  const diffList = $('#diff-list');
  for (const d of content.PRACTICE_DIFFICULTIES) {
    diffList.appendChild(btn(`${d.name} — ${d.brief}`, 'sr-blockbtn', () => startLevel({
      id: 'practice-' + d.id, kind: 'practice', name: 'Practice — ' + d.name,
      brief: d.brief, seed: rules.seedFromString('practice:' + d.id),
      ruleset: rules.defaultRuleset(Object.assign({ id: 'practice-' + d.id }, d.ruleset)),
    })));
  }

  $('#journey-summary').textContent = `${content.JOURNEY.length} stages across five chapters.`;
  const chapterList = $('#chapter-list');
  let lastChapter = null;
  for (const item of content.JOURNEY) {
    if (item.chapter !== lastChapter) {
      lastChapter = item.chapter;
      const h = document.createElement('h3');
      h.className = 'sr-h3';
      h.textContent = item.chapterName;
      chapterList.appendChild(h);
    }
    chapterList.appendChild(btn(`${item.index}. ${item.name} — ${item.brief}`, 'sr-blockbtn', () => startLevel(item)));
  }

  $('#learn-summary').textContent = `${content.LESSONS.length} short lessons.`;
  const lessonList = $('#lesson-list');
  for (const item of content.LESSONS) {
    lessonList.appendChild(btn(`${item.name} — ${item.brief}`, 'sr-blockbtn', () => startLevel(item)));
  }

  $('#challenge-summary').textContent = `${content.CHALLENGES.length} constrained rings.`;
  const chalList = $('#chal-list');
  for (const item of content.CHALLENGES) {
    chalList.appendChild(btn(`${item.name} — ${item.brief}`, 'sr-blockbtn', () => startLevel(item)));
  }

  $('#daily-brief').textContent = `${dailyItem.name}. ${dailyItem.brief}`;

  $('#help-body').innerHTML = [
    '<p>Your serpent glides forward on its own. Steer with the pointer or with ← / → (A / D); hold Space (or ↑) to boost.</p>',
    '<p>Gather light motes to grow and score. The pale rim, the dark island and the red thorns all end your glide — unless the ruleset says otherwise.</p>',
    '<p>Each mode states its goal: reach a length, beat a score, survive the clock or outlast your rivals.</p>',
    '<p>In Practice, press U (or Ctrl+Z) to rewind a bad moment. Undo is not available in ranked modes.</p>',
  ].join('');
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
  objEl.textContent = cur.item.name + (cur.item.brief ? ' — ' + cur.item.brief : '');
  const L = cur.lesson;
  if (L && me) {
    const steps = cur.item.steps;
    progEl.textContent = !me.alive
      ? 'Down — press Play again to retry the lesson.'
      : L.done
        ? 'Lesson complete.'
        : `Step ${L.index + 1} / ${steps.length} — ${steps[L.index].text}`;
    return;
  }
  if (st && st.goal) {
    progEl.textContent = me.alive
      ? `Goal ${Math.min(st.current, st.target)} / ${st.target} · length ${meters(rules.trailLength(cur.state.ruleset, me))} m`
      : 'Down — watch the rim, island and thorns.';
  } else {
    progEl.textContent = me && me.alive ? 'Glide on.' : 'Down.';
  }
}

function finishIfTerminal() {
  if (!cur || cur.over) return;
  const lessonDone = !!(cur.lesson && cur.lesson.done);
  if (cur.state.phase !== 'terminal' && !lessonDone) return;
  cur.over = true;
  const me = human();
  const res = rules.makeResult(cur.state, me, 'local');
  $('#res-headline').textContent = lessonDone ? 'Lesson complete!'
    : res.goalMet ? 'Goal complete!' : 'Ring claimed you.';
  const bd = $('#score-breakdown');
  bd.innerHTML = '';
  const table = document.createElement('dl');
  table.className = 'sr-score';
  for (const row of res.breakdown || []) {
    const dt = document.createElement('dt');
    dt.textContent = row.detail ? `${row.label} (${row.detail})` : row.label;
    const dd = document.createElement('dd'); dd.textContent = String(row.amount);
    table.append(dt, dd);
  }
  const total = document.createElement('p');
  total.textContent = `Total ${res.total} · peak length ${meters(res.peakTrail)} m · ticks ${res.elapsedTicks}`;
  bd.append(table, total);
  $('#res-note').textContent = lessonDone
    ? `Ended: every step of ${cur.item.name} complete`
    : cur.state.terminal ? `Ended: ${String(cur.state.terminal.reason).replace(/-/g, ' ')}` : '';
  const rec = platform.recordResult(cur.item, res);
  $('#res-best').textContent = rec
    ? `Best ${rec.best} · goal met ${rec.wins}/${rec.plays} · peak ${meters(rec.bestPeak)} m`
    : '';
  showScreen('results');
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!cur || cur.over || paused) { if (cur) cur.last = now; return; }
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
    lessonTick(events);
    cur.acc -= TICK_MS;
    steps++;
  }
  const canvas = $('#game-canvas');
  if (canvas) render(canvas, cur.state, content.themeById(cur.item.theme));
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

const KEY_STEER = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };

window.addEventListener('keydown', (e) => {
  if (!cur || cur.over || $('[data-sr-screen="help"]')?.hidden === false) return;
  if (paused && e.code !== 'Escape' && e.code !== 'KeyP') return;
  if (e.code in KEY_STEER) { cur.steerDir = KEY_STEER[e.code]; e.preventDefault(); }
  else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { cur.boostWanted = true; e.preventDefault(); }
  else if (e.code === 'KeyU' || ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ')) {
    // Undo where the ruleset permits it (Practice); ignored elsewhere.
    const me = human();
    if (me && rules.getLegalActions(cur.state, me.id).undo.valid) {
      rules.applyCommand(cur.state, rules.makeCommand(me.id, 'undo'));
    }
    e.preventDefault();
  }
  else if (e.code === 'Escape' || e.code === 'KeyP') { setPaused(!paused); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  if (!cur) return;
  if (e.code in KEY_STEER && cur.steerDir === KEY_STEER[e.code]) cur.steerDir = 0;
  else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') cur.boostWanted = false;
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
  const dpr = Math.min(2, window.devicePixelRatio || 1);
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
    $('#daily-brief').textContent = `${dailyItem.name}. ${dailyItem.brief}`;
  }
  if (nav === 'play-daily') startLevel(content.dailyContent());
  else if (nav === 'retry' && cur) startLevel(cur.item);
  else if (nav === 'title' || el.id === 'btn-leave' || el.id === 'btn-help-close' || el.id === 'btn-err-close') {
    cur = null; paused = false;
  } else if (el.id === 'btn-resume') setPaused(false);
});

window.addEventListener('resize', resizeCanvas);
document.addEventListener('visibilitychange', () => { if (document.hidden && cur && !cur.over) setPaused(true); });

// Live clock in the title bar.
setInterval(() => {
  const el = $('[data-sr-live="clock"]');
  if (el) el.textContent = new Date().toISOString().slice(11, 19) + ' UTC';
}, 1000);

populate();
platform.init();
platform.loadSave();
initUI();
bindPointer();
showScreen('title');
requestAnimationFrame(frame);
