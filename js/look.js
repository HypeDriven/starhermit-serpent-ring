/**
 * Serpent Ring — the look per graphics level: the browser build's four
 * presets and their budgets (js/gfx.js TABLE / BUDGETS, each tuned to hold
 * 60 FPS on the weakest GPU its Auto gave it), keyed by the runtime's quality
 * tier (frame().quality), with the particle and spore counts scaled within
 * the tier by the level (frame().levelIndex, at most 2×), as the browser
 * build scaled them by its hardware level. The runtime owns the rest of what
 * the old Graphics panel did: Auto and the level choice, render scale,
 * adaptive resolution, the frame-rate limit and its readout. The old panel's
 * per-effect overrides are not offered (the runtime's Options pick a level).
 * Pure, shared with the node tests.
 */

export const TIERS = ['low', 'balanced', 'high', 'ultra'];

/** gfx.js TABLE: the effect tiers and the backing-store pixel-ratio cap. */
const TABLE = {
  low: { dprCap: 1, glow: 'off', shadows: 'off', grade: 'off', particles: 'off', background: 'static', detail: 'plain' },
  balanced: { dprCap: 1.5, glow: 'on', shadows: 'off', grade: 'on', particles: 'low', background: 'animated', detail: 'detailed' },
  high: { dprCap: 2, glow: 'on', shadows: 'on', grade: 'on', particles: 'high', background: 'animated', detail: 'detailed' },
  ultra: { dprCap: 2, glow: 'high', shadows: 'on', grade: 'on', particles: 'high', background: 'animated', detail: 'detailed' },
};

/**
 * gfx.js BUDGETS:
 *   particles  particle cap at Particles "high" (low: 1/3), scaled with the level
 *   spores     drifting spores (Background animated), scaled with the level
 *   fronds     foliage fronds around the rim (Detail on; cached backdrop)
 *   specks     moss specks on the floor per 720² px (Detail on; cached backdrop)
 *   samples    trail sample points per serpent body (Detail on)
 *   chunks     tapered stroke segments per body pass (Detail on)
 *   haloRings  additive rings per ambient-mote halo (Glow on)
 */
export const BUDGETS = {
  low: { particles: 150, spores: 20, fronds: 32, specks: 400, samples: 60, chunks: 6, haloRings: 2 },
  balanced: { particles: 300, spores: 30, fronds: 48, specks: 600, samples: 72, chunks: 8, haloRings: 2 },
  high: { particles: 420, spores: 46, fronds: 64, specks: 900, samples: 90, chunks: 12, haloRings: 3 },
  ultra: { particles: 600, spores: 70, fronds: 96, specks: 1400, samples: 120, chunks: 16, haloRings: 3 },
};
export const PARTICLE_MAX = 1200;
export const SPORE_MAX = 140;
const PARTICLE_SHARE = { off: 0, low: 1 / 3, high: 1 };
/** The runtime's first level index of each tier (levels 0 … 9). */
const TIER_FLOOR = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index. */
export function lookFor(tier, levelIndex = 0) {
  const preset = TABLE[tier] ? tier : 'balanced';
  const row = TABLE[preset];
  const budget = { ...BUDGETS[preset] };
  const k = Math.min(2, Math.pow(1.64, Math.max(0, (Number(levelIndex) || 0) - TIER_FLOOR[preset])));
  budget.particles = Math.min(PARTICLE_MAX, Math.round(budget.particles * k));
  budget.spores = Math.min(SPORE_MAX, Math.round(budget.spores * k));
  const out = { preset, ...row, budget };
  // The effect passes run only when something needs them; otherwise the plain renderer draws.
  out.effects = out.glow !== 'off' || out.shadows !== 'off' || out.grade !== 'off'
    || out.particles !== 'off' || out.background !== 'static' || out.detail !== 'plain';
  return out;
}

/** Live particle cap for a look (Particles tier share of the budget). */
export function particleCap(look) {
  return Math.round(look.budget.particles * (PARTICLE_SHARE[look.particles] ?? 0));
}
