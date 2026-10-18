/**
 * Serpent Ring — graphics quality model: presets, per-category overrides,
 * StarHermit hardware-level detection, per-preset budgets and a cost summary. Pure (no DOM, no canvas) so the settings
 * panel, the renderer and the unit tests agree on what a setting means.
 */

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  glow: ['off', 'on', 'high'],            // additive light around serpents, motes and the rim
  shadows: ['off', 'on'],                  // soft drop shadows under serpents, motes and thorns
  grade: ['off', 'on'],                    // colour grade + vignette on the arena backdrop
  particles: ['off', 'low', 'high'],       // eat sparkles, boost wake, death bursts
  background: ['static', 'animated'],      // drifting spores, rim shimmer, mote pulse
  detail: ['plain', 'detailed'],           // textured floor, foliage, shaded bodies, thorn brambles
};

// Each preset is a row of tiers, a render scale (multiplies the device pixel
// ratio) and a device-pixel-ratio cap so Low stays as cheap as the plain build.
const TABLE = {
  low: { scale: 1, dprCap: 1, glow: 'off', shadows: 'off', grade: 'off', particles: 'off', background: 'static', detail: 'plain' },
  balanced: { scale: 1, dprCap: 1.5, glow: 'on', shadows: 'off', grade: 'on', particles: 'low', background: 'animated', detail: 'detailed' },
  high: { scale: 1, dprCap: 2, glow: 'on', shadows: 'on', grade: 'on', particles: 'high', background: 'animated', detail: 'detailed' },
  ultra: { scale: 1.25, dprCap: 2, glow: 'high', shadows: 'on', grade: 'on', particles: 'high', background: 'animated', detail: 'detailed' },
};

// Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX
// 5090; js/gpu-level.js → window.StarHermitGpu, a classic script loaded before the game): Low from 0,
// Balanced from 4, High from 10, Ultra from 17. Phones, tablets and ≤ 4 GB machines are capped at level 9.
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  const sys = { webgl: true, webgl2: true, ...(system || {}), gpu: String(gpu || '') };
  if (!gpu) sys.webgl = false; // no renderer string: no usable WebGL
  return G ? G.detectLevel(sys) : (gpu ? LEVELS.balanced : 0);
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU (the hardware level already caps phones and tablets at Balanced). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, system));
}

/*
 * Per-preset 2D-canvas budget. Each preset holds 60 FPS on the weakest GPU Auto gives it (Low → level 0,
 * Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). The arena, serpents, motes,
 * thorns, hit tests and rules are identical on every preset — only visuals change.
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

/** A preset's concrete budget for a hardware level (particle and spore counts scale ≤ 2× within the preset). */
export function budgetFor(preset, level) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] || 0;
  const lv = Math.max(Number.isFinite(level) ? level : floor, floor);
  const k = G ? Math.min(2, G.scaleBudget(1, lv, floor)) : 1;
  b.particles = Math.min(PARTICLE_MAX, Math.round(b.particles * k));
  b.spores = Math.min(SPORE_MAX, Math.round(b.spores * k));
  return b;
}

/** Live particle cap for a resolved setting (Particles tier share of the preset's budget). */
export function particleCap(r) {
  return Math.round(((r && r.budget) || BUDGETS.balanced).particles * (PARTICLE_SHARE[r && r.particles] ?? 0));
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const userScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto, userScale, scale: row.scale * userScale, dprCap: row.dprCap };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budgetFor(preset, out.level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // The effect passes run only when something needs them; otherwise the plain renderer draws.
  out.effects = out.glow !== 'off' || out.shadows !== 'off' || out.grade !== 'off'
    || out.particles !== 'off' || out.background !== 'static' || out.detail !== 'plain';
  return out;
}

/** Apply a preset choice: choosing a preset (or Auto) clears per-category overrides. */
export function choosePreset(saved, preset) {
  const next = { ...(saved || {}) };
  for (const cat of Object.keys(CATEGORIES)) delete next[cat];
  next.preset = PRESETS.includes(preset) ? preset : 'auto';
  return next;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset]?.[cat];
}

/** Canvas backing-store ratio: min(dpr, preset cap) × render scale × adaptive scale. */
export function pixelRatio(r, dpr = 1, adaptive = 1) {
  return clamp(Math.min(dpr || 1, r.dprCap) * r.scale * adaptive, 0.5, 4);
}

const EN = {
  plain: 'plain drawing', glow: 'glow', glowHigh: 'full glow', shadows: 'shadows',
  grade: 'colour grade', particles: '{n} particles', animated: 'animated backdrop',
  detailed: 'detailed',
};

/** One-line cost summary; `t(key)` localizes the fragments (English by default). */
export function describe(r, pixels, t) {
  const tr = (k, n) => String((t && t(k)) || EN[k]).replace('{n}', n);
  const parts = r.effects ? [
    r.detail === 'detailed' ? tr('detailed') : null,
    r.glow === 'off' ? null : r.glow === 'high' ? tr('glowHigh') : tr('glow'),
    r.shadows === 'on' ? tr('shadows') : null,
    r.grade === 'on' ? tr('grade') : null,
    r.particles === 'off' ? null : tr('particles', particleCap(r)),
    r.background === 'animated' ? tr('animated') : null,
  ] : [tr('plain')];
  if (pixels) parts.push(`${pixels[0]}×${pixels[1]} px`);
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
