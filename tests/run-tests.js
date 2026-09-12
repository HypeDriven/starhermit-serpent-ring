/**
 * Serpent Ring — test runner (node tests/run-tests.js / npm test).
 */
import { JOURNEY, CHALLENGES, LESSONS, validateAllContent, dailyContent } from '../js/content.js';
import {
  createGame, defaultRuleset, step, applyCommand, getLegalActions, hashState,
  makeResult, getResults, scoreBreakdown, seedFromString, cloneState, HEADING_MAX,
} from '../js/rules.js';
import { __zip } from '../js/platform.js';

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

// Keep authored lesson checks and the Learn-mode tracker in main.js in step.
const LESSON_CHECKS = [
  'heading-turned', 'laps', 'ticks', 'motes', 'motes-after', 'length',
  'length-alive', 'bloom', 'boost-ticks', 'proximity', 'eliminate-or-survive',
];
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

await t('cloud-save zip helper round-trips a stored entry', () => {
  const { zipStore, unzipFirstEntry, bytesToBase64, base64ToBytes } = __zip;
  const doc = { version: 1, records: { 'practice-easy': { plays: 2, wins: 1, best: 120, bestPeak: 90 } } };
  const json = JSON.stringify(doc);
  const zip = zipStore('save.json', new TextEncoder().encode(json));
  check(zip.length > 30 + json.length, 'zip implausibly small');
  check(zip[0] === 0x50 && zip[1] === 0x4b, 'missing local file header signature');
  const back = new TextDecoder().decode(unzipFirstEntry(zip));
  check(back === json, 'zip round trip diverged');
  const viaB64 = new TextDecoder().decode(unzipFirstEntry(base64ToBytes(bytesToBase64(zip))));
  check(viaB64 === json, 'base64 zip round trip diverged');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
