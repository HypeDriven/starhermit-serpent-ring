/**
 * Serpent Ring — rules engine.
 *
 * Pure, deterministic, environment-agnostic (browser + Node). No rendering,
 * no DOM, no timers. All positions are integer simulation units
 * (100 units == 1 display meter); headings are integer sixteenths of a turn
 * (0..65535). All randomness flows through seeded streams stored inside the
 * state, so a state is fully serializable and replayable.
 *
 * Public contract:
 *   createGame(options)            -> state
 *   getLegalActions(state, id)     -> legal-action query (shared by play,
 *                                    tutorials and hints)
 *   applyCommand(state, cmd)       -> {ok, reason?}  (only way to mutate intent)
 *   step(state)                    -> events[]       (advance exactly one tick)
 *   getResults(state)              -> ranked results with component breakdown
 *   compareResults(a, b)           -> tie-break ordering
 *   hashState(state)               -> deterministic 64-bit-ish hex digest
 *   serializeState / deserializeState (versioned, with migration)
 *   makeReplay / verifyReplay      -> replay envelope record + verification
 *   maxPlausibleScore              -> anti-cheat bound for leaderboard checks
 */

export const SCHEMA_VERSION = 1;
export const TICK_RATE = 30;
export const BUILD = '1.0.0';

export const TERMINAL_REASONS = Object.freeze([
  'goal-reached',   // a serpent satisfied the stage objective
  'time-up',        // the round clock expired
  'collision',      // solo round ended by the player's death
  'eliminated',     // hosted round: this serpent was eliminated
  'last-standing',  // only one serpent remains
  'moves-exhausted',// challenge boost budget spent and no motion possible
  'conceded',       // a player resigned
  'all-complete',   // lesson/challenge script finished
]);

export const INVALID_REASONS = Object.freeze([
  'ok',
  'round-not-active',
  'serpent-dead',
  'unknown-serpent',
  'insufficient-mass',
  'boost-disabled',
  'bad-heading',
  'move-limit-reached',
  'duplicate-command',
  'malformed-command',
  'unknown-command',
]);

export const HEADING_MAX = 65536; // heading is modulo this
const TWO_PI = Math.PI * 2;

/* ------------------------------------------------------------------ *
 *  Seeded random streams (splitmix-style stepper, state kept in game)
 * ------------------------------------------------------------------ */

export function rngNext(s) {
  // s is a 32-bit integer state; returns [newState, float in [0,1)]
  let t = (s + 0x6d2b79f5) | 0;
  let r = t;
  r = Math.imul(r ^ (r >>> 15), r | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  const v = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  return [t, v];
}

export function rngInt(state, stream, n) {
  // deterministic integer in [0, n)
  const [ns, v] = rngNext(state.rng[stream]);
  state.rng[stream] = ns;
  return Math.floor(v * n);
}

export function rngRange(state, stream, lo, hi) {
  return lo + rngInt(state, stream, hi - lo + 1);
}

export function seedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ *
 *  Ruleset
 * ------------------------------------------------------------------ */

export function defaultRuleset(overrides = {}) {
  const base = {
    id: 'ruleset-standard',
    version: 1,
    arena: {
      outer: 12000,          // outer wall radius (sim units, 100 = 1 m)
      inner: 3000,           // central island radius (0 => full disc)
      thornCount: 0,         // procedural thorn hazards from seed
      thorns: [],            // explicit [{x,y,r}] hazards (kill on touch)
    },
    serpent: {
      baseTrail: 45,         // trail ticks at zero mass
      massPerTrail: 2,       // mass needed per extra trail tick
      baseSpeed: 42,         // units per tick
      boostNum: 17, boostDen: 10, // boost speed multiplier 1.7x
      turnRate: 900,         // heading units per tick (~4.9 deg)
      boostTurnRate: 720,
      eatRadius: 420,        // pickup reach from head center
      bodyRadius: 200,       // collision radius of body/head
      spawnInvuln: 75,       // ticks of spawn grace
      minBoostMass: 20,      // mass needed to start boosting
      boostFloorMass: 8,     // boost auto-stops here
      boostDrainInterval: 6, // 1 mass shed per N boost ticks
      neckSkip: 26,          // own trail points ignored for self-collision
      maxTrail: 1400,        // absolute trail cap (perf bound)
    },
    motes: {
      target: 260,           // ambient mote population to maintain
      maxField: 420,         // hard cap including shed/burst motes
      valueMin: 1,
      valueMax: 3,
      bloomEvery: 37,        // every Nth spawned mote is a bloom mote
      bloomValue: 8,
      spawnPerTick: 2,       // max ambient spawns per tick
    },
    bots: {
      count: 4,
      skill: { sense: 5000, avoid: 1600, reaction: 6, aggression: 30 },
    },
    goals: [{ type: 'score', value: 1200 }],
    winBy: 'goal',           // goal | score | last-standing | survive
    timeLimitTicks: 0,       // 0 => none
    moveLimit: 0,            // 0 => unlimited; else boost budget in ticks
    respawn: false,
    allowUndo: false,
    mechanics: { boost: true, thorns: false },
    scoring: {
      mote: 10,              // per mote eaten
      massUnit: 2,           // per mass value eaten
      peakLength: 1,         // per peak trail tick
      survival: 1,           // per 30 ticks alive
      elimination: 150,      // per credited elimination
      goal: 500,             // objective completion bonus
    },
    assists: { widePickup: false, gentleTurn: false, slowSim: false },
  };
  return mergeRuleset(base, overrides);
}

function mergeRuleset(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over)) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) &&
        base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = mergeRuleset(base[k], over[k]);
    } else {
      out[k] = over[k];
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Game creation
 * ------------------------------------------------------------------ */

export function createGame({ seed, ruleset, players, modeId = 'arena', contentVersion = 1 }) {
  const rs = ruleset || defaultRuleset();
  const state = {
    schema: SCHEMA_VERSION,
    contentVersion,
    modeId,
    seed: seed >>> 0,
    rng: {
      rules: (seed ^ 0x9e3779b9) >>> 0,
      deco: (seed ^ 0x85ebca6b) >>> 0,
      av: (seed ^ 0xc2b2ae35) >>> 0,
    },
    ruleset: rs,
    tick: 0,
    phase: 'active', // active | terminal
    terminal: null,
    arena: {
      outer: rs.arena.outer,
      inner: rs.arena.inner,
      thorns: [],
    },
    serpents: [],
    motes: [],
    moteSeq: 0,
    cmdSeq: 0,
    commandQueue: [], // commands scheduled for the upcoming tick
    stats: { spawnedMotes: 0, eatenMotes: 0, deaths: 0 },
  };

  // Thorn hazards: explicit list plus seeded procedural clusters.
  for (const t of rs.arena.thorns || []) {
    state.arena.thorns.push({ x: t.x | 0, y: t.y | 0, r: t.r | 0 });
  }
  const thornCount = rs.mechanics.thorns ? (rs.arena.thornCount | 0) : 0;
  for (let i = 0; i < thornCount; i++) {
    const p = sampleRingPoint(state, 1400, 60);
    state.arena.thorns.push({ x: p.x, y: p.y, r: rngRange(state, 'rules', 450, 950) });
  }

  // Players / bots.
  const list = players && players.length ? players : defaultPlayers(rs.bots.count);
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const p = list[i];
    const s = makeSerpent(state, p, i, n);
    state.serpents.push(s);
  }

  // Initial mote field.
  while (state.motes.length < rs.motes.target) spawnMote(state, false);
  return state;
}

function defaultPlayers(botCount) {
  const arr = [{ id: 'p1', name: 'You', isBot: false }];
  for (let i = 0; i < botCount; i++) {
    arr.push({ id: 'b' + (i + 1), name: BOT_NAMES[i % BOT_NAMES.length], isBot: true, skill: i });
  }
  return arr;
}

export const BOT_NAMES = [
  'Reed', 'Bramble', 'Sorrel', 'Vetch', 'Ilex', 'Tansy', 'Lumen', 'Wren',
  'Alder', 'Cinch', 'Dulse', 'Eryngo', 'Fennel', 'Gale', 'Horehound', 'Isop',
  'Jacinth', 'Knapweed', 'Lovage', 'Madder', 'Nettle', 'Orris', 'Puccoon',
  'Quill', 'Rampion', 'Sedge', 'Tarragon', 'Ulex', 'Vervain', 'Woad', 'Yarrow',
];

function makeSerpent(state, player, index, total) {
  const rs = state.ruleset;
  // Evenly spaced around the annulus midline, deterministic jitter by seed.
  const mid = (state.arena.outer + state.arena.inner) / 2;
  const frac = index / total;
  const jitter = rngRange(state, 'rules', -800, 800);
  const ang = frac * TWO_PI + (jitter / 65536) * 0.02;
  const x = Math.round(Math.cos(ang) * mid);
  const y = Math.round(Math.sin(ang) * mid);
  // Head tangent to the ring (counter-clockwise).
  const heading = angleToHeading(ang + Math.PI / 2);
  const trail = [];
  for (let i = 0; i < rs.serpent.baseTrail; i++) {
    // Trail extends backwards along the spawn tangent.
    const back = headingToAngle(heading) + Math.PI;
    trail.push({
      x: Math.round(x + Math.cos(back) * rs.serpent.baseSpeed * i),
      y: Math.round(y + Math.sin(back) * rs.serpent.baseSpeed * i),
    });
  }
  return {
    id: player.id,
    name: String(player.name || player.id).slice(0, 24),
    isBot: !!player.isBot,
    skill: player.skill != null ? player.skill : index,
    hue: (index * 47 + rngInt(state, 'rules', 20)) % 360,
    alive: true,
    deathTick: -1,
    deathCause: null,
    x, y, heading,
    targetHeading: heading,
    boostOn: false,
    boostTicksUsed: 0,
    drainAccum: 0,
    mass: 0,
    invuln: rs.serpent.spawnInvuln,
    trail,
    peakTrail: trail.length,
    invalidActions: 0,
    recentCmds: [],
    // scoring components
    score: { motes: 0, massEaten: 0, peakTrail: trail.length, survivalTicks: 0, eliminations: 0, goal: 0 },
    bot: player.isBot ? { nextThink: 0, desired: heading, flee: 0, boostWish: false } : null,
    goalMet: false,
    goalTick: -1,
  };
}

/* ------------------------------------------------------------------ *
 *  Angle helpers (integer headings)
 * ------------------------------------------------------------------ */

export function headingToAngle(h) {
  return ((h % HEADING_MAX) / HEADING_MAX) * TWO_PI;
}

export function angleToHeading(a) {
  let h = Math.round((a / TWO_PI) * HEADING_MAX) % HEADING_MAX;
  if (h < 0) h += HEADING_MAX;
  return h;
}

function headingDelta(from, to) {
  // signed shortest arc from -> to in (-32768, 32768]
  let d = (to - from) % HEADING_MAX;
  if (d > HEADING_MAX / 2) d -= HEADING_MAX;
  if (d < -HEADING_MAX / 2) d += HEADING_MAX;
  return d;
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

/* ------------------------------------------------------------------ *
 *  Motes
 * ------------------------------------------------------------------ */

function sampleRingPoint(state, margin, stream) {
  // Uniform-ish sample inside the annulus/disc via the given rng stream name
  // ('rules' uses the authoritative stream; pass a literal int for deco use).
  const st = typeof stream === 'number' ? stream : state.rng[stream];
  const [s1, u1] = rngNext(st);
  const [s2, u2] = rngNext(s1);
  if (typeof stream !== 'number') state.rng[stream] = s2;
  const inner = state.arena.inner + margin;
  const outer = state.arena.outer - margin;
  const r = Math.sqrt(u1 * (outer * outer - inner * inner) + inner * inner);
  const a = u2 * TWO_PI;
  return { x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r), rngState: s2 };
}

function pointInThorn(state, x, y, pad) {
  for (const t of state.arena.thorns) {
    if (dist2(x, y, t.x, t.y) < (t.r + pad) * (t.r + pad)) return true;
  }
  return false;
}

function spawnMote(state, isBloom, at) {
  const rs = state.ruleset;
  if (state.motes.length >= rs.motes.maxField) return null;
  let pos = at;
  if (!pos) {
    // Bounded rejection sampling: never loops forever (no soft lock).
    let tries = 0;
    do {
      pos = sampleRingPoint(state, 900, 'rules');
      tries++;
    } while (tries < 24 && pointInThorn(state, pos.x, pos.y, 500));
  }
  state.moteSeq++;
  const bloom = isBloom || (state.moteSeq % rs.motes.bloomEvery === 0);
  const mote = {
    id: state.moteSeq,
    x: pos.x, y: pos.y,
    v: bloom ? rs.motes.bloomValue : rngRange(state, 'rules', rs.motes.valueMin, rs.motes.valueMax),
    bloom,
  };
  state.motes.push(mote);
  state.stats.spawnedMotes++;
  return mote;
}

/* ------------------------------------------------------------------ *
 *  Legal actions — the single source of truth for what may be done.
 *  Play UI, tutorials and hints all query this.
 * ------------------------------------------------------------------ */

export function getLegalActions(state, serpentId) {
  const s = state.serpents.find((p) => p.id === serpentId);
  const active = state.phase === 'active';
  const alive = !!(s && s.alive);
  const rs = state.ruleset;
  const boostDisabled = !rs.mechanics.boost;
  const moveLimitHit = rs.moveLimit > 0 && s ? s.boostTicksUsed >= rs.moveLimit : false;
  const enoughMass = s ? s.mass >= rs.serpent.minBoostMass : false;

  const act = (valid, reason) => ({ valid, reason: valid ? null : reason });
  return {
    serpent: s || null,
    steer: act(active && alive, !active ? 'round-not-active' : 'serpent-dead'),
    boost: s && s.boostOn
      ? act(active && alive, !active ? 'round-not-active' : 'serpent-dead')
      : act(
          active && alive && !boostDisabled && !moveLimitHit && enoughMass,
          !active ? 'round-not-active'
            : !alive ? 'serpent-dead'
            : boostDisabled ? 'boost-disabled'
            : moveLimitHit ? 'move-limit-reached'
            : 'insufficient-mass',
        ),
    concede: act(active && !!s, !active ? 'round-not-active' : 'unknown-serpent'),
    undo: act(rs.allowUndo && active && alive, !rs.allowUndo ? 'undo-not-permitted' : (!active ? 'round-not-active' : 'serpent-dead')),
  };
}

/** Human-readable explanation for a rejected action (used by hints/UI). */
export function explainInvalid(reason) {
  switch (reason) {
    case 'round-not-active': return 'the round is not running';
    case 'serpent-dead': return 'your serpent has fallen';
    case 'unknown-serpent': return 'no such serpent';
    case 'insufficient-mass': return 'boost needs more length — gather motes first';
    case 'boost-disabled': return 'boost is disabled in this ruleset';
    case 'move-limit-reached': return 'the boost budget for this challenge is spent';
    case 'duplicate-command': return 'command already received';
    case 'bad-heading': return 'heading out of range';
    case 'malformed-command': return 'command could not be understood';
    default: return 'action not allowed';
  }
}

/* ------------------------------------------------------------------ *
 *  Commands
 * ------------------------------------------------------------------ */

let localCmdSeq = 1;
export function makeCommand(serpentId, type, data = {}) {
  return {
    id: 'c' + (localCmdSeq++),
    serpent: serpentId,
    type,
    tick: -1, // assigned by session/server for the tick it applies to
    ...data,
  };
}

/**
 * Validate + queue a command. Returns {ok:true} or {ok:false, reason}.
 * Duplicate command ids are rejected idempotently (never counted as invalid).
 */
export function applyCommand(state, cmd) {
  if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') {
    return { ok: false, reason: 'malformed-command' };
  }
  const s = state.serpents.find((p) => p.id === cmd.serpent);
  if (!s) return { ok: false, reason: 'unknown-serpent' };

  if (cmd.id && s.recentCmds.includes(cmd.id)) {
    return { ok: false, reason: 'duplicate-command' };
  }

  let result = { ok: true };
  switch (cmd.type) {
    case 'steer': {
      if (state.phase !== 'active') result = { ok: false, reason: 'round-not-active' };
      else if (!s.alive) result = { ok: false, reason: 'serpent-dead' };
      else if (!Number.isFinite(cmd.heading) || cmd.heading < 0 || cmd.heading >= HEADING_MAX) {
        result = { ok: false, reason: 'bad-heading' };
      } else {
        cmd.heading = Math.round(cmd.heading) % HEADING_MAX;
      }
      break;
    }
    case 'boost': {
      const la = getLegalActions(state, s.id);
      if (cmd.on === false) {
        if (!s.alive) result = { ok: false, reason: 'serpent-dead' };
        // turning boost off is otherwise always fine
      } else if (!la.boost.valid) {
        result = { ok: false, reason: la.boost.reason };
      }
      break;
    }
    case 'concede': {
      if (state.phase !== 'active') result = { ok: false, reason: 'round-not-active' };
      break;
    }
    case 'noop':
      break;
    default:
      return { ok: false, reason: 'unknown-command' };
  }

  if (!result.ok) {
    if (result.reason !== 'duplicate-command') s.invalidActions++;
    return result;
  }
  if (cmd.id) {
    s.recentCmds.push(cmd.id);
    if (s.recentCmds.length > 32) s.recentCmds.shift();
  }
  state.commandQueue.push(cmd);
  return { ok: true };
}

function runQueuedCommands(state, events) {
  const q = state.commandQueue;
  state.commandQueue = [];
  for (const cmd of q) {
    const s = state.serpents.find((p) => p.id === cmd.serpent);
    if (!s) continue;
    switch (cmd.type) {
      case 'steer':
        if (s.alive) s.targetHeading = cmd.heading;
        break;
      case 'boost': {
        const want = !!cmd.on;
        if (s.alive && want !== s.boostOn) {
          if (want) {
            s.boostOn = true;
            events.push({ type: 'boost-start', serpent: s.id, x: s.x, y: s.y });
          } else {
            s.boostOn = false;
            events.push({ type: 'boost-stop', serpent: s.id, x: s.x, y: s.y });
          }
        }
        break;
      }
      case 'concede':
        if (s.alive) {
          killSerpent(state, s, 'conceded', null, events);
        }
        break;
      default:
        break;
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Bots — deterministic, driven only by state + rules rng stream.
 * ------------------------------------------------------------------ */

function botThink(state, s) {
  const rs = state.ruleset;
  const skill = rs.bots.skill;
  const mem = s.bot;
  if (state.tick < mem.nextThink) return;
  mem.nextThink = state.tick + Math.max(2, skill.reaction - Math.min(4, s.skill));

  const sense = skill.sense + s.skill * 600;
  const sense2 = sense * sense;

  // 1) Danger scan: walls, thorns, bodies — multi-sample ray ahead.
  const dangerAt = (hx, hy) => {
    const d2c = hx * hx + hy * hy;
    const bodyR = rs.serpent.bodyRadius;
    const outLim = state.arena.outer - bodyR - 420;
    if (d2c > outLim * outLim) return true;
    if (state.arena.inner > 0) {
      const inLim = state.arena.inner + bodyR + 420;
      if (d2c < inLim * inLim) return true;
    }
    if (pointInThorn(state, hx, hy, bodyR + 200)) return true;
    for (const o of state.serpents) {
      if (!o.alive || o.invuln > 0) continue;
      if (o.id !== s.id) {
        // Moving heads are doubly dangerous — avoid head-on approaches.
        if (dist2(hx, hy, o.x, o.y) < 820 * 820) return true;
      }
      const skip = o.id === s.id ? rs.serpent.neckSkip : 0;
      const tr = o.trail;
      for (let i = skip; i < tr.length; i += 3) {
        if (dist2(hx, hy, tr[i].x, tr[i].y) < 320 * 320) return true;
      }
    }
    return false;
  };
  const rayStep = 420; // one sample per ~10 ticks of travel
  const rayDanger = (h) => {
    const a = headingToAngle(h);
    for (let i = 1; i <= 6; i++) {
      if (dangerAt(Math.round(s.x + Math.cos(a) * rayStep * i), Math.round(s.y + Math.sin(a) * rayStep * i))) return true;
    }
    return false;
  };

  let steerUrgency = false;
  if (rayDanger(s.heading)) {
    // Probe candidate headings, prefer smallest turn away from danger.
    const probes = [600, -600, 1400, -1400, 2400, -2400, 3600, -3600, 5200, -5200, 8000, -8000];
    let found = false;
    for (const p of probes) {
      const h = (s.heading + p + HEADING_MAX) % HEADING_MAX;
      if (!rayDanger(h)) { mem.desired = h; found = true; break; }
    }
    if (!found) mem.desired = (s.heading + 2400) % HEADING_MAX; // committed turn
    steerUrgency = true;
    mem.boostWish = false;
  }

  // 2) Forage: nearest worthwhile mote that is not inside a danger zone.
  if (!steerUrgency) {
    let best = null, bestScore = -1;
    for (const m of state.motes) {
      const d2 = dist2(s.x, s.y, m.x, m.y);
      if (d2 > sense2) continue;
      const sc = (m.v * 1000000) / (d2 + 40000);
      if (sc > bestScore) {
        if (dangerAt(m.x, m.y)) continue; // never dive into walls/trails for food
        const h = angleToHeading(Math.atan2(m.y - s.y, m.x - s.x));
        if (d2 > 900 * 900 && rayDanger(h)) continue;
        bestScore = sc; best = m;
      }
    }
    if (best) {
      mem.desired = angleToHeading(Math.atan2(best.y - s.y, best.x - s.x));
      // Aggressive bots boost toward bloom motes when rich and safe.
      mem.boostWish = !!(best.bloom && s.mass > 60 && !rayDanger(s.heading) && rngInt(state, 'rules', 100) < skill.aggression);
    } else {
      // Drift along the ring: gentle wander via rng.
      if (rngInt(state, 'rules', 100) < 12) {
        const cand = (s.heading + rngRange(state, 'rules', -2600, 2600) + HEADING_MAX) % HEADING_MAX;
        if (!rayDanger(cand)) mem.desired = cand;
      }
      mem.boostWish = false;
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Simulation step
 * ------------------------------------------------------------------ */

export function step(state) {
  const events = [];
  if (state.phase !== 'active') return events;
  const rs = state.ruleset;
  state.tick++;

  // Bots decide (uses same command path as humans).
  for (const s of state.serpents) {
    if (s.isBot && s.alive) {
      botThink(state, s);
      if (s.bot.desired !== s.targetHeading) {
        applyCommand(state, { id: null, serpent: s.id, type: 'steer', heading: s.bot.desired });
      }
      const wantBoost = !!s.bot.boostWish;
      if (wantBoost !== s.boostOn) {
        applyCommand(state, { id: null, serpent: s.id, type: 'boost', on: wantBoost });
      }
    }
  }

  runQueuedCommands(state, events);

  // --- Movement ---
  const sp = rs.serpent;
  for (const s of state.serpents) {
    if (!s.alive) continue;
    // Turn toward target heading at limited rate.
    const rate = s.boostOn ? sp.boostTurnRate : sp.turnRate;
    const d = headingDelta(s.heading, s.targetHeading);
    const stepD = Math.abs(d) <= rate ? d : Math.sign(d) * rate;
    s.heading = (s.heading + stepD + HEADING_MAX) % HEADING_MAX;

    let speed = sp.baseSpeed;
    if (s.boostOn) {
      speed = Math.round((sp.baseSpeed * rs.serpent.boostNum) / rs.serpent.boostDen);
      s.boostTicksUsed++;
      // Drain mass; shed it behind as a small mote.
      s.drainAccum++;
      if (s.drainAccum >= sp.boostDrainInterval) {
        s.drainAccum = 0;
        if (s.mass > 0) {
          s.mass--;
          const tail = s.trail[s.trail.length - 1];
          if (tail && state.motes.length < rs.motes.maxField) {
            const m = spawnMote(state, false, { x: tail.x, y: tail.y });
            if (m) { m.v = 1; events.push({ type: 'shed', serpent: s.id, x: tail.x, y: tail.y }); }
          }
        }
        if (s.mass <= sp.boostFloorMass) {
          s.boostOn = false;
          events.push({ type: 'boost-stop', serpent: s.id, x: s.x, y: s.y });
        }
      }
    }

    const a = headingToAngle(s.heading);
    s.x = Math.round(s.x + Math.cos(a) * speed);
    s.y = Math.round(s.y + Math.sin(a) * speed);

    // Trail: record new head position; trim to current length.
    s.trail.unshift({ x: s.x, y: s.y });
    const len = trailLength(rs, s);
    while (s.trail.length > len) s.trail.pop();
    if (s.trail.length > s.peakTrail) {
      s.peakTrail = s.trail.length;
      s.score.peakTrail = s.peakTrail;
    }
    if (s.invuln > 0) s.invuln--;
    s.score.survivalTicks++;
  }

  // --- Eating ---
  const eatR = sp.eatRadius + (rs.assists.widePickup ? 140 : 0);
  const eatR2 = eatR * eatR;
  for (const s of state.serpents) {
    if (!s.alive) continue;
    for (let i = state.motes.length - 1; i >= 0; i--) {
      const m = state.motes[i];
      if (dist2(s.x, s.y, m.x, m.y) <= eatR2) {
        state.motes.splice(i, 1);
        s.mass += m.v;
        s.score.motes++;
        s.score.massEaten += m.v;
        state.stats.eatenMotes++;
        events.push({ type: 'eat', serpent: s.id, x: m.x, y: m.y, value: m.v, bloom: m.bloom });
      }
    }
  }

  // --- Collisions (resolved simultaneously) ---
  const bodyR = sp.bodyRadius;
  const deaths = [];
  for (const s of state.serpents) {
    if (!s.alive || s.invuln > 0) continue;
    let cause = null, killer = null;
    const d2c = s.x * s.x + s.y * s.y;
    if (d2c > (state.arena.outer - bodyR) * (state.arena.outer - bodyR)) cause = 'wall';
    else if (state.arena.inner > 0 && d2c < (state.arena.inner + bodyR) * (state.arena.inner + bodyR)) cause = 'wall';
    else if (pointInThorn(state, s.x, s.y, bodyR)) cause = 'thorn';
    if (!cause) {
      // Head-to-head first.
      for (const o of state.serpents) {
        if (o === s || !o.alive) continue;
        if (dist2(s.x, s.y, o.x, o.y) < (bodyR * 2) * (bodyR * 2)) {
          cause = 'serpent'; killer = o.invuln > 0 ? null : o.id;
          break;
        }
      }
    }
    if (!cause) {
      // Other bodies only: your own trail never kills you (spec: "avoid
      // colliding with other bodies"). Fair, and it keeps proofs deterministic.
      for (const o of state.serpents) {
        if (o === s || !o.alive) continue;
        const tr = o.trail;
        let hit = false;
        for (let i = 0; i < tr.length; i++) {
          if (dist2(s.x, s.y, tr[i].x, tr[i].y) < (bodyR * 2 - 60) * (bodyR * 2 - 60)) {
            hit = true; break;
          }
        }
        if (hit) { cause = 'serpent'; killer = o.id; break; }
      }
    }
    if (cause) deaths.push({ s, cause, killer });
  }
  for (const d of deaths) killSerpent(state, d.s, d.cause, d.killer, events);

  // --- Mote field maintenance ---
  let spawned = 0;
  while (state.motes.length < rs.motes.target && spawned < rs.motes.spawnPerTick) {
    spawnMote(state, false);
    spawned++;
  }

  // --- Goals & terminal checks ---
  evaluateTerminal(state, events);
  return events;
}

export function trailLength(rs, s) {
  const len = rs.serpent.baseTrail + Math.floor(s.mass / rs.serpent.massPerTrail);
  return Math.min(len, rs.serpent.maxTrail);
}

function killSerpent(state, s, cause, killerId, events) {
  const rs = state.ruleset;
  s.alive = false;
  s.deathTick = state.tick;
  s.deathCause = cause;
  s.boostOn = false;
  state.stats.deaths++;
  if (killerId) {
    const k = state.serpents.find((p) => p.id === killerId);
    if (k && k.alive) {
      k.score.eliminations++;
      events.push({ type: 'elimination', serpent: k.id, victim: s.id, x: s.x, y: s.y });
    }
  }
  // Burst: part of the mass returns to the field as motes along the trail.
  const fraction = 3; // every 3rd trail point may drop a mote
  for (let i = 0; i < s.trail.length; i += fraction) {
    if (state.motes.length >= rs.motes.maxField) break;
    if ((i / fraction) % 2 === 0) {
      const p = s.trail[i];
      const m = spawnMote(state, false, { x: p.x, y: p.y });
      if (m) m.v = 1 + (m.id % 2);
    }
  }
  events.push({ type: 'death', serpent: s.id, cause, x: s.x, y: s.y, killer: killerId || null });
}

function goalProgress(state, s) {
  // Returns {met, label-ish numbers} for the first matching goal.
  for (const g of state.ruleset.goals) {
    switch (g.type) {
      case 'reach-length':
        if (s.peakTrail >= g.value) return { met: true, goal: g };
        break;
      case 'score':
        if (totalScore(state.ruleset, s) >= g.value) return { met: true, goal: g };
        break;
      case 'survive':
        if (s.alive && s.score.survivalTicks >= g.value) return { met: true, goal: g };
        break;
      case 'eliminate':
        if (s.score.eliminations >= g.value) return { met: true, goal: g };
        break;
      default:
        break;
    }
  }
  return { met: false, goal: state.ruleset.goals[0] || null };
}

export function getGoalStatus(state, serpentId) {
  const s = state.serpents.find((p) => p.id === serpentId);
  if (!s) return null;
  const g = state.ruleset.goals[0];
  let current = 0, target = g ? g.value : 0;
  if (g) {
    switch (g.type) {
      case 'reach-length': current = s.peakTrail; break;
      case 'score': current = totalScore(state.ruleset, s); break;
      case 'survive': current = s.score.survivalTicks; break;
      case 'eliminate': current = s.score.eliminations; break;
      default: break;
    }
  }
  return { goal: g, current, target, met: s.goalMet };
}

function evaluateTerminal(state, events) {
  const rs = state.ruleset;
  const alive = state.serpents.filter((s) => s.alive);
  const humans = state.serpents.filter((s) => !s.isBot);
  // In all-bot simulations (content validation) every serpent contends.
  const contenders = humans.length ? humans : state.serpents;
  const contendersAlive = humans.length ? alive.filter((s) => !s.isBot) : alive;

  // Goal completion (any serpent can trigger in goal races; solo: the human).
  for (const s of state.serpents) {
    if (s.goalMet) continue;
    const gp = goalProgress(state, s);
    if (gp.met) {
      s.goalMet = true;
      s.goalTick = state.tick;
      s.score.goal = 1;
      events.push({ type: 'goal', serpent: s.id, goal: gp.goal });
    }
  }

  const anyGoal = state.serpents.some((s) => s.goalMet);
  const concedeDeath = state.serpents.some((s) => s.deathCause === 'conceded' && !s.isBot);

  let reason = null;
  if (rs.winBy === 'goal' && anyGoal) reason = 'goal-reached';
  else if (rs.winBy === 'survive' && contendersAlive.length > 0 && contendersAlive.some((s) => s.goalMet)) reason = 'goal-reached';
  else if (rs.winBy === 'last-standing' && alive.length <= 1 && state.serpents.length > 1) reason = 'last-standing';
  else if (rs.winBy === 'score' && anyGoal) reason = 'goal-reached';
  else if (rs.timeLimitTicks > 0 && state.tick >= rs.timeLimitTicks) reason = 'time-up';
  else if (concedeDeath && contendersAlive.length === 0) reason = 'conceded';
  else if (humans.length > 0 && contendersAlive.length === 0 && state.modeId !== 'hosted') {
    // Solo/AI-table rounds end when the player falls.
    reason = state.serpents.find((s) => !s.isBot && !s.alive)?.deathCause === 'conceded' ? 'conceded' : 'collision';
  } else if (alive.length === 0) reason = 'collision';

  if (reason) {
    state.phase = 'terminal';
    state.terminal = { reason, tick: state.tick, results: getResults(state) };
    events.push({ type: 'terminal', reason, tick: state.tick });
  }
}

/* ------------------------------------------------------------------ *
 *  Scoring & ranking
 * ------------------------------------------------------------------ */

export function totalScore(rs, s) {
  const w = rs.scoring;
  return (
    s.score.motes * w.mote +
    s.score.massEaten * w.massUnit +
    s.score.peakTrail * w.peakLength +
    Math.floor(s.score.survivalTicks / TICK_RATE) * w.survival +
    s.score.eliminations * w.elimination +
    s.score.goal * w.goal
  );
}

export function scoreBreakdown(rs, s) {
  const w = rs.scoring;
  return [
    { key: 'motes', label: 'Motes gathered', amount: s.score.motes * w.mote, detail: `${s.score.motes} × ${w.mote}` },
    { key: 'mass', label: 'Mass consumed', amount: s.score.massEaten * w.massUnit, detail: `${s.score.massEaten} × ${w.massUnit}` },
    { key: 'peak', label: 'Peak length', amount: s.score.peakTrail * w.peakLength, detail: `${Math.round(s.score.peakTrail * rs.serpent.baseSpeed / 100)} m × ${w.peakLength}` },
    { key: 'survival', label: 'Survival', amount: Math.floor(s.score.survivalTicks / TICK_RATE) * w.survival, detail: `${(s.score.survivalTicks / TICK_RATE).toFixed(0)} s` },
    { key: 'eliminations', label: 'Eliminations', amount: s.score.eliminations * w.elimination, detail: `${s.score.eliminations} × ${w.elimination}` },
    { key: 'goal', label: 'Objective', amount: s.score.goal * w.goal, detail: s.score.goal ? 'complete' : '—' },
  ];
}

export function makeResult(state, s, sessionId) {
  const rs = state.ruleset;
  return {
    id: s.id,
    name: s.name,
    isBot: s.isBot,
    alive: s.alive,
    goalMet: s.goalMet,
    invalidActions: s.invalidActions,
    elapsedTicks: s.alive ? state.tick : s.deathTick,
    total: totalScore(rs, s),
    breakdown: scoreBreakdown(rs, s),
    peakTrail: s.peakTrail,
    mass: s.mass,
    eliminations: s.score.eliminations,
    motes: s.score.motes,
    sessionId: sessionId || s.id,
    deathCause: s.deathCause,
  };
}

/**
 * Tie-breaks, in order: objective completion, fewer invalid actions,
 * lower authoritative elapsed time, then stable session identifier.
 */
export function compareResults(a, b) {
  if (a.goalMet !== b.goalMet) return a.goalMet ? -1 : 1;
  if (a.total !== b.total) return b.total - a.total;
  if (a.invalidActions !== b.invalidActions) return a.invalidActions - b.invalidActions;
  if (a.elapsedTicks !== b.elapsedTicks) return a.elapsedTicks - b.elapsedTicks;
  return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
}

export function getResults(state, sessionIds) {
  const results = state.serpents.map((s) =>
    makeResult(state, s, sessionIds ? sessionIds[s.id] : undefined));
  results.sort(compareResults);
  results.forEach((r, i) => { r.placement = i + 1; });
  return results;
}

/* ------------------------------------------------------------------ *
 *  Hashing / serialization
 * ------------------------------------------------------------------ */

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

export function hashString(str) {
  // FNV-1a 64-bit via two interleaved 32-bit accumulators -> 16 hex chars.
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** Deterministic digest of everything that affects simulation outcomes. */
export function hashState(state) {
  const core = {
    tick: state.tick,
    seed: state.seed,
    rng: state.rng,
    phase: state.phase,
    motes: state.motes.map((m) => [m.id, m.x, m.y, m.v]),
    moteSeq: state.moteSeq,
    serpents: state.serpents.map((s) => [
      s.id, s.alive ? 1 : 0, s.x, s.y, s.heading, s.targetHeading,
      s.boostOn ? 1 : 0, s.mass, s.invuln, s.peakTrail,
      s.score.motes, s.score.massEaten, s.score.eliminations, s.score.survivalTicks,
      s.invalidActions, s.goalMet ? 1 : 0,
      s.trail.length,
      s.trail.length ? [s.trail[0].x, s.trail[0].y, s.trail[s.trail.length - 1].x, s.trail[s.trail.length - 1].y] : 0,
    ]),
    thorns: state.arena.thorns.map((t) => [t.x, t.y, t.r]),
  };
  return hashString(stableStringify(core));
}

export function serializeState(state) {
  return JSON.stringify(state);
}

export function deserializeState(json) {
  const state = typeof json === 'string' ? JSON.parse(json) : json;
  return migrateState(state);
}

/** Versioned migration chain; add steps as schema evolves. */
export function migrateState(state) {
  let v = state.schema | 0;
  if (v === 0) {
    // v0 -> v1: recentCmds + cmdSeq introduced.
    for (const s of state.serpents) {
      if (!Array.isArray(s.recentCmds)) s.recentCmds = [];
    }
    if (typeof state.cmdSeq !== 'number') state.cmdSeq = 0;
    state.schema = 1;
    v = 1;
  }
  if (v !== SCHEMA_VERSION) {
    throw new Error('unsupported state schema ' + state.schema);
  }
  return state;
}

export function cloneState(state) {
  return deserializeState(serializeState(state));
}

/* ------------------------------------------------------------------ *
 *  Replay envelope
 * ------------------------------------------------------------------ */

export function makeReplay(state, label) {
  return {
    schema: SCHEMA_VERSION,
    build: BUILD,
    contentVersion: state.contentVersion,
    modeId: state.modeId,
    label: label || state.modeId,
    seed: state.seed,
    ruleset: state.ruleset,
    players: state.serpents.map((s) => ({ id: s.id, name: s.name, isBot: s.isBot, skill: s.skill })),
    timestampOffset: 0,
    commands: [],      // {tick, cmd}
    hashes: [{ tick: 0, hash: hashState(state) }],
    terminal: null,
    finalHash: null,
  };
}

export function recordReplayCommand(replay, tick, cmd) {
  replay.commands.push({ tick, cmd: { ...cmd } });
}

export function finalizeReplay(replay, state) {
  replay.terminal = state.terminal ? { reason: state.terminal.reason, tick: state.terminal.tick } : null;
  replay.finalHash = hashState(state);
  return replay;
}

/**
 * Deterministic replay verification: rebuild the game from the envelope and
 * re-apply every command tick by tick. Returns per-checkpoint comparison.
 */
export function verifyReplay(replay, { maxTicks = 200000 } = {}) {
  const state = createGame({
    seed: replay.seed,
    ruleset: replay.ruleset,
    players: replay.players,
    modeId: replay.modeId,
    contentVersion: replay.contentVersion,
  });
  const checks = [];
  const byTick = new Map();
  for (const c of replay.commands) {
    if (!byTick.has(c.tick)) byTick.set(c.tick, []);
    byTick.get(c.tick).push(c.cmd);
  }
  const hashPoints = new Map((replay.hashes || []).map((h) => [h.tick, h.hash]));
  let mismatches = 0;
  const initial = hashPoints.get(0);
  if (initial && initial !== hashState(state)) {
    mismatches++;
    checks.push({ tick: 0, expected: initial, actual: hashState(state), ok: false });
  }
  while (state.phase === 'active' && state.tick < maxTicks) {
    const nextTick = state.tick + 1;
    const cmds = byTick.get(nextTick) || [];
    for (const cmd of cmds) applyCommand(state, cmd);
    step(state);
    const want = hashPoints.get(state.tick);
    if (want) {
      const actual = hashState(state);
      const ok = want === actual;
      if (!ok) mismatches++;
      checks.push({ tick: state.tick, expected: want, actual, ok });
    }
    if (replay.terminal && state.tick >= replay.terminal.tick && state.phase !== 'terminal') {
      // The recorded run ended here; keep stepping is pointless if we diverged.
      break;
    }
  }
  const finalOk = replay.finalHash ? hashState(state) === replay.finalHash : true;
  if (!finalOk) mismatches++;
  return {
    ok: mismatches === 0 && finalOk,
    mismatches,
    checks,
    finalHash: hashState(state),
    terminal: state.terminal ? state.terminal.reason : null,
  };
}

/* ------------------------------------------------------------------ *
 *  Leaderboard plausibility bound (anti-cheat, server + client share it)
 * ------------------------------------------------------------------ */

export function maxPlausibleScore(ruleset, elapsedTicks) {
  const rs = ruleset;
  const w = rs.scoring;
  // Upper bounds: a serpent can eat at most a few motes per tick; the field
  // only holds so many; survival and peak are bounded by time and caps.
  const seconds = Math.ceil(elapsedTicks / TICK_RATE) + 1;
  const maxEaten = Math.min(
    state0SpawnBudget(rs, elapsedTicks),
    Math.ceil(elapsedTicks / 6), // physical eating rate bound
  );
  const motePts = maxEaten * w.mote * rs.motes.bloomValue;
  const massPts = maxEaten * rs.motes.bloomValue * w.massUnit;
  const peakPts = rs.serpent.maxTrail * w.peakLength;
  const survPts = seconds * w.survival;
  const elimPts = 64 * w.elimination; // hard player-count bound
  const goalPts = w.goal;
  return motePts + massPts + peakPts + survPts + elimPts + goalPts;
}

function state0SpawnBudget(rs, ticks) {
  // ambient field + trickle spawns + generous death-burst allowance
  return rs.motes.maxField + rs.motes.spawnPerTick * ticks + 40 * rs.serpent.maxTrail;
}

/* ------------------------------------------------------------------ *
 *  Daily seed (one shared seed per UTC day)
 * ------------------------------------------------------------------ */

export function dailySeed(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return seedFromString(`serpent-ring-daily-${y}-${m}-${d}`);
}

export function dailyKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
