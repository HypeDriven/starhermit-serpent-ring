/**
 * Serpent Ring — graphics quality model: presets, per-category overrides,
 * GPU detection and a cost summary. Pure (no DOM, no canvas) so the settings
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

/** Particle budget per tier. */
export const PARTICLE_CAP = { off: 0, low: 140, high: 420 };

/** Best preset for this GPU, from the unmasked renderer string when the browser exposes it. */
export function detectPreset(gpu, { mobile = false } = {}) {
  const g = String(gpu || '').toLowerCase();
  let p = 'balanced';
  if (!g) p = 'balanced';
  else if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) p = 'low';
  else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?!.*graphics)|apple m\d/.test(g)) p = 'high';
  // Touch / mobile devices: Auto never goes above Balanced.
  if (mobile && PRESETS.indexOf(p) > PRESETS.indexOf('balanced')) p = 'balanced';
  return p;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const userScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto, userScale, scale: row.scale * userScale, dprCap: row.dprCap };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
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
    r.particles === 'off' ? null : tr('particles', PARTICLE_CAP[r.particles]),
    r.background === 'animated' ? tr('animated') : null,
  ] : [tr('plain')];
  if (pixels) parts.push(`${pixels[0]}×${pixels[1]} px`);
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
