/**
 * Serpent Ring — bootstrap: screen population, input mapping, fixed-timestep
 * game loop, HUD and results. Uses the 2D canvas renderer (render.js); the
 * authoritative simulation lives in rules.js.
 */
import { initUI } from './ui.js';
import * as rules from './rules.js';
import * as content from './content.js';
import { render } from './render.js';

const $ = (sel) => document.querySelector(sel);
const TICK_MS = 1000 / rules.TICK_RATE;

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

const dailyItem = content.dailyContent();

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
  ].join('');
}

/* ------------------------------------------------------------------ *
 *  Game loop
 * ------------------------------------------------------------------ */

let cur = null; // { item, state, last, acc, steerDir, desiredHeading, boostWanted, over }

function startLevel(item) {
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
  };
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
  if (cur.boostWanted !== me.boostOn) {
    rules.applyCommand(cur.state, rules.makeCommand(me.id, 'boost', { on: cur.boostWanted }));
  }
}

function updateHud() {
  if (!cur) return;
  const me = human();
  const objEl = $('[data-sr-live="objective"]');
  const progEl = $('[data-sr-live="progress"]');
  const st = me && rules.getGoalStatus(cur.state, me.id);
  objEl.textContent = cur.item.name + (cur.item.brief ? ' — ' + cur.item.brief : '');
  if (st && st.goal) {
    progEl.textContent = me.alive
      ? `Goal ${Math.min(st.current, st.target)} / ${st.target} · length ${(rules.trailLength(cur.state.ruleset, me) / 100).toFixed(1)} m`
      : 'Down — watch the rim, island and thorns.';
  } else {
    progEl.textContent = me && me.alive ? 'Glide on.' : 'Down.';
  }
}

function finishIfTerminal() {
  if (!cur || cur.over || cur.state.phase !== 'terminal') return;
  cur.over = true;
  const me = human();
  const res = rules.makeResult(cur.state, me, 'local');
  $('#res-headline').textContent = res.goalMet ? 'Goal complete!' : 'Ring claimed you.';
  const bd = $('#score-breakdown');
  bd.innerHTML = '';
  const table = document.createElement('dl');
  table.className = 'sr-score';
  for (const [k, v] of Object.entries(res.breakdown || {})) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = String(v);
    table.append(dt, dd);
  }
  const total = document.createElement('p');
  total.textContent = `Total ${res.total} · peak length ${(res.peakTrail / 100).toFixed(1)} m · ticks ${res.elapsedTicks}`;
  bd.append(table, total);
  $('#res-note').textContent = cur.state.terminal ? `Ended: ${String(cur.state.terminal.reason).replace(/-/g, ' ')}` : '';
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
    if (cur.steerDir !== 0) {
      const rate = cur.state.ruleset.serpent.turnRate;
      cur.desiredHeading = (cur.desiredHeading + cur.steerDir * rate + rules.HEADING_MAX) % rules.HEADING_MAX;
      pushSteer();
    }
    pushBoost();
    rules.step(cur.state);
    cur.acc -= TICK_MS;
    steps++;
  }
  const canvas = $('#game-canvas');
  if (canvas) render(canvas, cur.state);
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
  showScreen(on ? 'pause' : 'play');
}

const KEY_STEER = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };

window.addEventListener('keydown', (e) => {
  if (!cur) return;
  if (e.code in KEY_STEER) { cur.steerDir = KEY_STEER[e.code]; e.preventDefault(); }
  else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { cur.boostWanted = true; e.preventDefault(); }
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
  if (el.id === 'btn-pause') { setPaused(true); return; }
  const nav = el.getAttribute && el.getAttribute('data-sr-nav');
  if (nav === 'play-daily') startLevel(dailyItem);
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
initUI();
bindPointer();
showScreen('title');
requestAnimationFrame(frame);
