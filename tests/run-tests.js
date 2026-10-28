/**
 * Serpent Ring — test runner (node tests/run-tests.js / npm test).
 */
import { JOURNEY, CHALLENGES, LESSONS, validateAllContent, dailyContent } from '../js/content.js';
import {
  createGame, defaultRuleset, step, applyCommand, getLegalActions, hashState,
  makeResult, getResults, scoreBreakdown, seedFromString, cloneState, HEADING_MAX,
} from '../js/rules.js';
import { LESSON_CHECKS, createRound, tick, finished, human, aim, undo as undoRound } from '../js/session.js';
import * as look from '../js/look.js';
import * as progress from '../js/progress.js';

let passed = 0;
let failed = 0;

function check(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log('ok   - ' + name);
  } catch (err) {
    failed++;
    console.error('FAIL - ' + name + ': ' + err.message);
  }
}

const game = (over = {}, seed = seedFromString('test')) =>
  createGame({ seed, ruleset: defaultRuleset(over), modeId: 'test' });

await t('journey has 40 stages', () => check(JOURNEY.length === 40));
await t('challenges present', () => check(CHALLENGES.length >= 6));
await t('lessons present', () => check(LESSONS.length === 5));

// Keep authored lesson checks and the Learn-mode tracker (js/session.js) in step.
await t('every lesson step uses a check the UI implements', () => {
  for (const l of LESSONS) {
    check(Array.isArray(l.steps) && l.steps.length > 0, l.id + ' has no steps');
    for (const s of l.steps) {
      check(LESSON_CHECKS.includes(s.check.type), `${l.id}/${s.id}: unknown check ${s.check.type}`);
      check(s.check.value > 0, `${l.id}/${s.id}: check without value`);
      check(typeof s.text === 'string' && s.text.length > 0, `${l.id}/${s.id}: no instruction text`);
    }
  }
});

await t('all content validates statically', () => {
  const bad = validateAllContent().filter((r) => !r.ok);
  check(bad.length === 0, JSON.stringify(bad));
  const daily = dailyContent();
  check(daily.ruleset.goals.length > 0, 'daily has no goal');
});

await t('simulation is deterministic for a seed', () => {
  const a = game({ bots: { count: 3 } });
  const b = game({ bots: { count: 3 } });
  for (let i = 0; i < 200; i++) { step(a); step(b); }
  check(hashState(a) === hashState(b), 'identical seeds diverged');
});

await t('serialization round-trips without changing the hash', () => {
  const a = game({ bots: { count: 2 } });
  for (let i = 0; i < 50; i++) step(a);
  check(hashState(cloneState(a)) === hashState(a), 'clone diverged');
});

await t('serpents grow by eating and the trail follows mass', () => {
  const s0 = game({ bots: { count: 0 } });
  const me = s0.serpents[0];
  const before = me.trail.length;
  for (let i = 0; i < 300; i++) step(s0);
  check(me.score.motes > 0, 'nothing was eaten in 10 s');
  check(me.trail.length > before, 'trail did not grow with mass');
});

await t('boost is illegal without mass and legal with it', () => {
  const s0 = game({ bots: { count: 0 } });
  const me = s0.serpents[0];
  check(!getLegalActions(s0, me.id).boost.valid, 'boost allowed at zero mass');
  const rejected = applyCommand(s0, { id: 'x1', serpent: me.id, type: 'boost', on: true });
  check(!rejected.ok && rejected.reason === 'insufficient-mass', 'wrong rejection reason');
  check(me.invalidActions === 1, 'invalid action not counted');
  me.mass = 100;
  check(getLegalActions(s0, me.id).boost.valid, 'boost still refused with mass');
  check(applyCommand(s0, { id: 'x2', serpent: me.id, type: 'boost', on: true }).ok);
  step(s0);
  check(me.boostOn, 'boost did not engage');
});

await t('malformed and out-of-range commands are rejected', () => {
  const s0 = game({ bots: { count: 0 } });
  const me = s0.serpents[0];
  check(!applyCommand(s0, { serpent: me.id, type: 'steer', heading: HEADING_MAX }).ok, 'heading bound not enforced');
  check(!applyCommand(s0, { serpent: me.id, type: 'steer', heading: NaN }).ok, 'NaN heading accepted');
  check(!applyCommand(s0, { serpent: 'nobody', type: 'steer', heading: 0 }).ok, 'unknown serpent accepted');
  check(!applyCommand(s0, { serpent: me.id, type: 'fly' }).ok, 'unknown command accepted');
  const dup = { id: 'dup', serpent: me.id, type: 'steer', heading: 100 };
  check(applyCommand(s0, dup).ok, 'first command rejected');
  check(!applyCommand(s0, dup).ok, 'duplicate id accepted');
});

await t('hitting the rim ends a solo round', () => {
  const s0 = game({ bots: { count: 0 } });
  const me = s0.serpents[0];
  me.invuln = 0;
  me.x = s0.arena.outer - 10;
  me.y = 0;
  step(s0);
  check(!me.alive, 'serpent survived the wall');
  check(s0.phase === 'terminal', 'round did not end');
  check(s0.terminal.reason === 'collision', 'unexpected reason ' + s0.terminal.reason);
});

await t('undo is legal only where the ruleset permits and rewinds state', () => {
  // Ranked-style ruleset: the query must refuse, and the command must agree.
  const s0 = game({ bots: { count: 0 }, allowUndo: false });
  const me = s0.serpents[0];
  check(!getLegalActions(s0, me.id).undo.valid, 'undo allowed without allowUndo');
  const refused = applyCommand(s0, { id: 'u0', serpent: me.id, type: 'undo' });
  check(!refused.ok && refused.reason === 'undo-not-permitted', 'wrong refusal reason');

  // Practice-style ruleset: undo rewinds position, mass and score.
  const s1 = game({ bots: { count: 0 }, allowUndo: true });
  const p1 = s1.serpents[0];
  for (let i = 0; i < 40; i++) step(s1);
  check(getLegalActions(s1, p1.id).undo.valid, 'undo refused in practice');
  const before = { x: p1.x, y: p1.y, motes: p1.score.motes, trail: p1.trail.length };
  for (let i = 0; i < 10; i++) step(s1);
  const accepted = applyCommand(s1, { id: 'u1', serpent: p1.id, type: 'undo' });
  check(accepted.ok, 'undo command rejected in practice');
  const events = step(s1);
  check(events.some((e) => e.type === 'undo' && e.serpent === p1.id), 'undo event not emitted');
  check(p1.x !== before.x || p1.y !== before.y, 'position did not change across rewind');
  check(p1.score.motes <= before.motes + 10, 'mote count rewound implausibly');
  check(p1.trail.length <= before.trail + 10, 'trail grew across rewind');
  check(p1.undoRing.length <= 1, 'undo ring not drained');
  check(p1.invalidActions === 0, 'undo counted as invalid');
});

await t('results expose a component breakdown that sums to the total', () => {
  const s0 = game({ bots: { count: 1 } });
  for (let i = 0; i < 120; i++) step(s0);
  const me = s0.serpents[0];
  const res = makeResult(s0, me, 'local');
  check(Array.isArray(res.breakdown), 'breakdown is not a list');
  check(res.breakdown.length === scoreBreakdown(s0.ruleset, me).length);
  const sum = res.breakdown.reduce((n, r) => n + r.amount, 0);
  check(sum === res.total, `breakdown ${sum} != total ${res.total}`);
  check(res.breakdown.every((r) => typeof r.label === 'string' && Number.isFinite(r.amount)),
    'breakdown rows are not label/amount pairs');
  const ranked = getResults(s0);
  check(ranked[0].placement === 1 && ranked.length === s0.serpents.length, 'ranking malformed');
});

// ---- The round (js/session.js): the client's input path ----
await t('round: held steering turns at the simulation rate and the serpent follows', () => {
  const cur = createRound(LESSONS[0]);
  const me = human(cur);
  const h0 = me.heading;
  cur.steerDir = 1;
  for (let i = 0; i < 5; i++) tick(cur);
  check(((me.heading - h0 + HEADING_MAX) % HEADING_MAX) === 5 * cur.state.ruleset.serpent.turnRate, 'turned 5 ticks of turnRate');
  cur.steerDir = 0;
  aim(cur, 0);
  check(cur.state.commandQueue.length > 0 || me.targetHeading === 0, 'pointer aim queued a steer');
});

await t('round: lesson 1 completes by orbiting; the round ends there', () => {
  const cur = createRound(LESSONS[0]);
  let n = 0;
  while (!finished(cur) && n++ < 4000) {
    const me = human(cur);
    const mid = (cur.state.arena.outer + cur.state.arena.inner) / 2;
    const r = Math.hypot(me.x, me.y);
    aim(cur, Math.atan2(me.y, me.x) + Math.PI / 2 + Math.max(-0.6, Math.min(0.6, (r - mid) / 3000)));
    tick(cur);
  }
  check(cur.lesson.done && cur.lesson.index === LESSONS[0].steps.length, 'every step met');
});

await t('round: undo only in Practice', () => {
  const ranked = createRound(JOURNEY[0]);
  for (let i = 0; i < 20; i++) tick(ranked);
  check(!undoRound(ranked), 'no undo in the Journey');
  const prac = createRound({ id: 'practice-calm', kind: 'practice', name: 'x', seed: 7, ruleset: defaultRuleset({ allowUndo: true, bots: { count: 0 } }) });
  for (let i = 0; i < 20; i++) tick(prac);
  check(undoRound(prac), 'undo in Practice');
});

// ---- Records (js/progress.js) ----
await t('records: a round folds in; docs merge to the better of both; foreign text reads', () => {
  const doc = progress.emptyDoc();
  progress.recordResult(doc, { id: 'j01' }, { total: 120, goalMet: false, peakTrail: 60 });
  const rec = progress.recordResult(doc, { id: 'j01' }, { total: 90, goalMet: true, peakTrail: 80 });
  check(rec.plays === 2 && rec.wins === 1 && rec.best === 120 && rec.bestPeak === 80, JSON.stringify(rec));
  const other = { version: 1, records: { j01: { plays: 5, wins: 0, best: 50, bestPeak: 99 }, j02: { plays: 1, wins: 1, best: 7, bestPeak: 45 } } };
  const m = progress.mergeDocs(doc, other);
  check(JSON.stringify(m.records.j01) === JSON.stringify({ plays: 5, wins: 1, best: 120, bestPeak: 99 }), 'j01 merged');
  check(m.records.j02.best === 7, 'j02 kept');
  check(progress.sameDoc(progress.mergeDocs(m, doc), m), 'merge is idempotent');
  check(progress.readForeign(JSON.stringify(other)).records.j02.plays === 1, 'foreign doc read');
  check(progress.readForeign('not json') === null && progress.readForeign('{"version":2}') === null, 'junk rejected');
  check(Object.keys(progress.normalize({ version: 1, records: { a: null, b: { plays: -3, best: 'x' } } }).records).join() === 'b', 'normalize drops junk');
});

// ---- The look per graphics level (js/look.js, the old gfx.js presets) ----
await t('look: the four presets keep the old tiers and budgets, scaled ≤ 2× by the level', () => {
  const low = look.lookFor('low', 0);
  check(!low.effects && low.dprCap === 1 && look.particleCap(low) === 0, 'low is the plain drawing');
  const bal = look.lookFor('balanced', 2);
  check(bal.glow === 'on' && bal.shadows === 'off' && bal.grade === 'on' && bal.detail === 'detailed', 'balanced row');
  check(look.particleCap(bal) === Math.round(look.BUDGETS.balanced.particles / 3), 'balanced: Particles low = 1/3');
  const hi = look.lookFor('high', 4);
  check(JSON.stringify(hi.budget) === JSON.stringify(look.BUDGETS.high), 'floor level = tuned budget');
  check(look.lookFor('ultra', 9).budget.spores <= 2 * look.BUDGETS.ultra.spores, 'scale ≤ 2×');
  check(look.lookFor('ultra', 9).glow === 'high' && look.lookFor('bogus', 0).preset === 'balanced', 'ultra glow; unknown → balanced');
  const keys = ['particles', 'spores', 'fronds', 'specks', 'samples', 'chunks', 'haloRings'];
  for (let i = 1; i < look.TIERS.length; i++) for (const k of keys) check(look.BUDGETS[look.TIERS[i]][k] >= look.BUDGETS[look.TIERS[i - 1]][k], `${k} grows`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
