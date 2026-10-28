/**
 * Serpent Ring — one round: the player's input folded into rules commands
 * tick by tick, and the Learn-mode lesson tracker. Pure (no DOM, no engine),
 * shared by the engine client (native/main.ts) and the node tools and tests
 * (tools/gen-plays.mjs plans exactly what the client will do).
 *
 * This is the browser build's main.js game loop body, unchanged in effect:
 * each rules tick, held steering turns the wanted heading at the rate the
 * simulation will actually turn (boost turns slower), the wanted heading and
 * the wanted boost are sent as commands, then the rules step.
 */
import * as rules from './rules.js';
import { CONTENT_VERSION } from './content.js';

/** A new round for a content item (journey stage, lesson, challenge, daily, practice). */
export function createRound(item) {
  const state = rules.createGame({
    seed: item.seed,
    ruleset: item.ruleset,
    modeId: item.id,
    contentVersion: CONTENT_VERSION,
  });
  const me = state.serpents.find((s) => !s.isBot);
  const cur = {
    item, state,
    steerDir: 0, desiredHeading: me ? me.targetHeading : 0,
    boostWanted: false, over: false,
    lesson: null,
  };
  if (item.kind === 'learn' && Array.isArray(item.steps) && item.steps.length) {
    cur.lesson = { index: 0, done: false };
    resetLessonStep(cur, me);
  }
  return cur;
}

export function human(cur) { return cur && cur.state.serpents.find((s) => !s.isBot); }

export function pushSteer(cur) {
  const me = human(cur);
  if (!me || !me.alive) return;
  const h = ((Math.round(cur.desiredHeading) % rules.HEADING_MAX) + rules.HEADING_MAX) % rules.HEADING_MAX;
  if (h !== me.targetHeading) rules.applyCommand(cur.state, rules.makeCommand(me.id, 'steer', { heading: h }));
}

export function pushBoost(cur) {
  const me = human(cur);
  if (!me) return;
  if (cur.boostWanted === me.boostOn) return;
  // Only send a boost request the rules will accept: holding the key with too
  // little mass would otherwise queue a rejected command every single tick and
  // inflate the invalid-action tie-breaker.
  if (cur.boostWanted && !rules.getLegalActions(cur.state, me.id).boost.valid) return;
  rules.applyCommand(cur.state, rules.makeCommand(me.id, 'boost', { on: cur.boostWanted }));
}

/** Pointer steering: aim at an angle (radians, y up) about the arena centre. */
export function aim(cur, angle) {
  cur.desiredHeading = rules.angleToHeading(angle);
  pushSteer(cur);
}

/** Undo where the ruleset permits it (Practice); false elsewhere. */
export function undo(cur) {
  const me = human(cur);
  if (!me || !rules.getLegalActions(cur.state, me.id).undo.valid) return false;
  rules.applyCommand(cur.state, rules.makeCommand(me.id, 'undo'));
  return true;
}

/** One rules tick with the current input; returns the tick's events. */
export function tick(cur) {
  const me = human(cur);
  if (cur.steerDir !== 0) {
    const sp = cur.state.ruleset.serpent;
    const rate = me && me.boostOn ? sp.boostTurnRate : sp.turnRate;
    cur.desiredHeading = (cur.desiredHeading + cur.steerDir * rate + rules.HEADING_MAX) % rules.HEADING_MAX;
    pushSteer(cur);
  }
  pushBoost(cur);
  const events = rules.step(cur.state);
  lessonTick(cur, events);
  return events;
}

/** The round is over: the rules ended it, or every lesson step is done. */
export function finished(cur) {
  return cur.state.phase === 'terminal' || !!(cur.lesson && cur.lesson.done);
}

/* ------------------------------------------------------------------ *
 *  Learn mode: the authored lesson steps drive the HUD and completion.
 *  Every check is evaluated from authoritative engine state only.
 * ------------------------------------------------------------------ */

function resetLessonStep(cur, me) {
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

function lessonAccumulate(cur, events, me) {
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

export function lessonStepMet(cur, check, me) {
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

/** The lesson checks this tracker implements (the content test keeps lessons to these). */
export const LESSON_CHECKS = ['heading-turned', 'laps', 'ticks', 'motes', 'motes-after', 'length', 'length-alive', 'bloom', 'boost-ticks', 'proximity', 'eliminate-or-survive'];

function lessonTick(cur, events) {
  const L = cur.lesson;
  if (!L || L.done) return;
  const me = human(cur);
  if (!me || !me.alive) return;
  lessonAccumulate(cur, events, me);
  const step = cur.item.steps[L.index];
  if (!step || !lessonStepMet(cur, step.check, me)) return;
  L.index++;
  if (L.index >= cur.item.steps.length) L.done = true;
  else resetLessonStep(cur, me);
}

/** Display length: content and goals speak in metres of 10 trail ticks. */
export const meters = (trailTicks) => (trailTicks / 10).toFixed(1);
