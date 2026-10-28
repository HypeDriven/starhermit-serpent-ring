// A steering bot for the play scripts: plays a round with the real rules and
// the client's own round code (js/session.js), choosing each tick which way
// to hold the steering keys (or, with `aimEvery`, where to tap), and records
// the inputs tick by tick. Its brain is the rules' bot (botThink: a danger
// ray ahead, else the nearest worthwhile mote), rewritten so it never draws
// from the authoritative rng; `orbit` follows the ring's midline instead
// (Lesson 1's lap). Never boosts unless `boost` says so.
import * as rules from '../js/rules.js';
import { createRound, tick, human, finished, aim } from '../js/session.js';

const H = rules.HEADING_MAX;
const delta = (from, to) => { let d = (to - from) % H; if (d > H / 2) d -= H; if (d < -H / 2) d += H; return d; };
const d2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

function brain(state, s, opts) {
  const rs = state.ruleset;
  const bodyR = rs.serpent.bodyRadius;
  const margin = opts.margin ?? 420;
  const dangerAt = (hx, hy) => {
    const c = hx * hx + hy * hy;
    const outLim = state.arena.outer - bodyR - margin;
    if (c > outLim * outLim) return true;
    if (state.arena.inner > 0) { const inLim = state.arena.inner + bodyR + margin; if (c < inLim * inLim) return true; }
    for (const t of state.arena.thorns) if (d2(hx, hy, t.x, t.y) < (t.r + bodyR + 260) ** 2) return true;
    for (const o of state.serpents) {
      if (!o.alive) continue;
      if (o.id !== s.id && d2(hx, hy, o.x, o.y) < 1100 * 1100) return true;
      const skip = o.id === s.id ? rs.serpent.neckSkip + 6 : 0;
      for (let i = skip; i < o.trail.length; i += 2) if (d2(hx, hy, o.trail[i].x, o.trail[i].y) < 420 * 420) return true;
    }
    return false;
  };
  const step = opts.rayStep ?? 420;
  const rayDanger = (h) => {
    const a = rules.headingToAngle(h);
    for (let i = 1; i <= (opts.ray ?? 6); i++) if (dangerAt(Math.round(s.x + Math.cos(a) * step * i), Math.round(s.y + Math.sin(a) * step * i))) return true;
    return false;
  };
  if (rayDanger(s.heading)) {
    const probes = [900, -900, 1800, -1800, 2700, -2700, 3600, -3600, 5400, -5400, 8000, -8000, 12000, -12000];
    for (const p of probes) { const h = (s.heading + p + H) % H; if (!rayDanger(h)) return h; }
    return (s.heading + (opts.turn ?? 3600)) % H;
  }
  if (opts.orbit) {
    // the ring's midline, counter-clockwise: the tangent plus a pull toward the middle radius
    const mid = (state.arena.outer + state.arena.inner) / 2;
    const r = Math.hypot(s.x, s.y);
    const a = Math.atan2(s.y, s.x) + Math.PI / 2 + Math.max(-0.6, Math.min(0.6, (r - mid) / 3000));
    return rules.angleToHeading(a);
  }
  let best = null, bestScore = -1;
  const sense2 = (opts.sense ?? 5000) ** 2;
  for (const m of state.motes) {
    const dd = d2(s.x, s.y, m.x, m.y);
    if (dd > sense2) continue;
    const sc = ((m.v || 1) * (opts.bloomBias && m.bloom ? 6 : 1) * 1e6) / (dd + 40000);
    if (sc > bestScore) {
      if (dangerAt(m.x, m.y)) continue;
      const h = rules.angleToHeading(Math.atan2(m.y - s.y, m.x - s.x));
      if (dd > 900 * 900 && rayDanger(h)) continue;
      // a mote inside the turning circle can't be reached: leave it
      if (dd < 700 * 700 && Math.abs(delta(s.heading, h)) > 9000) continue;
      bestScore = sc; best = m;
    }
  }
  if (best) return rules.angleToHeading(Math.atan2(best.y - s.y, best.x - s.x));
  return s.heading;
}

/** The held steering keys as the client reads them (main.ts steerDir: both held → the last pressed). */
const effective = (k) => (k.a && k.d ? k.last : k.a ? 1 : k.d ? -1 : 0);
/** The one hold/release line (or none) that moves the held keys toward `target`; applies it. */
function keyLine(k, target, allowed) {
  if (!allowed) return null;
  const eff = effective(k);
  if (eff === target) {
    // tidy up: never leave both held longer than needed (a later stop then takes one line)
    if (k.a && k.d) { if (k.last === 1) { k.d = false; return 'release KeyD'; } k.a = false; return 'release KeyA'; }
    return null;
  }
  if (target === 1) {
    if (!k.a) { k.a = true; k.last = 1; return 'hold KeyA'; }
    k.d = false; return 'release KeyD';
  }
  if (target === -1) {
    if (!k.d) { k.d = true; k.last = -1; return 'hold KeyD'; }
    k.a = false; return 'release KeyA';
  }
  // stop: release what steers now (the other is already up after the tidy-up, or goes next tick)
  if (eff === 1) { k.a = false; return 'release KeyA'; }
  k.d = false; return 'release KeyD';
}

/**
 * Plays `item` to its end (or `maxTicks`): { inputs: [{ t, dir, boost, aim }] (tick t's input),
 * ticks, result, lessonDone, reason }. With `aimEvery` the bot taps an aim (radians) every
 * that many ticks instead of holding keys.
 */
export function plan(item, opts = {}) {
  const cur = createRound(item);
  const inputs = [];
  const maxTicks = opts.maxTicks ?? 30 * 300;
  let lastAim = -1e9;
  const keys = { a: false, d: false, last: 0 };
  while (!finished(cur) && cur.state.tick < maxTicks) {
    const me = human(cur);
    const want = brain(cur.state, me, opts);
    const input = { t: cur.state.tick + 1, dir: 0, boost: false, aim: null };
    if (opts.aimEvery) {
      if (cur.state.tick - lastAim >= opts.aimEvery && Math.abs(delta(cur.desiredHeading, want)) > 600) {
        input.aim = rules.headingToAngle(want);
        aim(cur, input.aim);
        lastAim = cur.state.tick;
      }
    } else {
      const sp = cur.state.ruleset.serpent;
      const rate = me.boostOn ? sp.boostTurnRate : sp.turnRate;
      const d = delta(cur.desiredHeading, want);
      const target = Math.abs(d) < rate / 2 ? 0 : Math.sign(d);
      // at most one key line a tick (a play-script line takes a frame, the render check plays a tick a frame)
      input.line = keyLine(keys, target, cur.state.tick + 1 >= (opts.firstTick ?? 3));
      input.dir = effective(keys);
    }
    input.boost = !!(opts.boost && opts.boost(cur, me));
    cur.steerDir = input.dir;
    cur.boostWanted = input.boost;
    tick(cur);
    inputs.push(input);
  }
  const me = human(cur);
  return {
    inputs, ticks: cur.state.tick, result: rules.makeResult(cur.state, me, 'local'),
    lessonDone: !!(cur.lesson && cur.lesson.done), reason: cur.state.terminal ? cur.state.terminal.reason : null, cur,
  };
}
