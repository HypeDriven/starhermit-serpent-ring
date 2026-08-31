/**
 * Shared test/sim harness: deterministic content proofs and utilities.
 */
import { createGame, step, applyCommand, hashState, getResults, TICK_RATE } from '../js/rules.js';

/**
 * Prove a content item is completable: fill every seat with bots and run the
 * authoritative simulation until terminal or the bound. Accepted outcomes:
 *  - 'goal-reached' (someone met the objective), or
 *  - for 'eliminate' goals: credited eliminations across the field >= goal
 *    (the explicitly accepted solution class for elimination stages), or
 *  - 'last-standing' for last-standing stages, or
 *  - 'time-up' for timed stages where at least one serpent met the goal.
 */
export function simulateContentProof(item, { maxMinutes = 12 } = {}) {
  const rs = item.ruleset;
  const seats = Math.max(1, rs.bots.count + 1);
  const players = [];
  for (let i = 0; i < seats; i++) {
    players.push({ id: 'sim' + i, name: 'sim' + i, isBot: true, skill: i });
  }
  const state = createGame({
    seed: item.seed, ruleset: rs, players, modeId: 'sim', contentVersion: item.version || 1,
  });
  const maxTicks = (rs.timeLimitTicks || 0) > 0
    ? rs.timeLimitTicks + 5
    : maxMinutes * 60 * TICK_RATE;
  let creditedElims = 0;
  const elimGoal = rs.goals.find((g) => g.type === 'eliminate');
  while (state.phase === 'active' && state.tick < maxTicks) {
    const events = step(state);
    for (const e of events) {
      if (e.type === 'elimination') creditedElims++;
    }
    if (elimGoal && creditedElims >= elimGoal.value) {
      return { ok: true, ticks: state.tick, why: 'elimination-class-satisfied' };
    }
  }
  if (state.phase === 'terminal') {
    const r = state.terminal.reason;
    if (r === 'goal-reached') return { ok: true, ticks: state.tick, why: 'goal-reached' };
    if (r === 'last-standing') return { ok: true, ticks: state.tick, why: 'last-standing' };
    if (r === 'time-up') {
      const anyGoal = state.serpents.some((s) => s.goalMet);
      if (anyGoal) return { ok: true, ticks: state.tick, why: 'goal-before-time-up' };
      return { ok: false, ticks: state.tick, why: 'time-up without any serpent meeting the goal' };
    }
    return { ok: false, ticks: state.tick, why: 'terminal:' + r };
  }
  return { ok: false, ticks: state.tick, why: 'bound reached without terminal — possible soft lock' };
}

/** Quick probe: how fast does a lone bot gather mass in an empty ring? */
export function probeEatRate({ seed = 1234, motesTarget = 260, seconds = 90, outer = 12000, inner = 3000 } = {}) {
  const { defaultRuleset } = rulesRef;
  const rs = defaultRuleset({
    bots: { count: 0 },
    arena: { outer, inner },
    motes: { target: motesTarget },
    goals: [{ type: 'survive', value: 99999999 }], winBy: 'survive',
  });
  const state = createGame({ seed, ruleset: rs, players: [{ id: 'p', name: 'p', isBot: true }], modeId: 'sim' });
  const ticks = seconds * TICK_RATE;
  while (state.tick < ticks && state.phase === 'active') step(state);
  const s = state.serpents[0];
  return {
    alive: s.alive,
    motes: s.score.motes,
    mass: s.score.massEaten,
    peakTrail: s.peakTrail,
    perSec: +(s.score.motes / seconds).toFixed(2),
  };
}

// Late import to keep probe flexible.
import * as rulesRef from '../js/rules.js';

export { createGame, step, applyCommand, hashState, getResults, TICK_RATE };
