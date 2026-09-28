/**
 * Serpent Ring — canvas 2D renderer (no external dependencies).
 * Presentation colors come from the content item's theme (see content.js);
 * the fallback palette matches the Night Garden theme.
 *
 * Quality tiers (see gfx.js) switch optional canvas passes on top of the
 * plain baseline: a cached textured backdrop with foliage, colour grade and
 * vignette; drop shadows; shaded tapered serpent bodies; additive glow;
 * pooled particles; and ambient motion. With every effect off the renderer
 * draws exactly the plain baseline. Gameplay colours (the pale player with a
 * pure-white head, rival hues, mote colours, red thorns) are never graded.
 */
import { PARTICLE_CAP } from './gfx.js';

const FALLBACK_THEME = {
  sky: 0x0a0f18, floor: 0x101b2a, island: 0x0d1524,
  rimGlow: 0x37e2c8, mote: 0x9fe8ff, moteBloom: 0xffd75e,
  floorRing: 0x12303a, rim: 0x1d5f6b, plantA: 0x1b7f77, plantB: 0x2fd8b0,
  plantTip: 0x9ff5e2, spore: 0x2c8f9e,
};

const css = (hex) => '#' + (hex & 0xffffff).toString(16).padStart(6, '0');
const rgba = (hex, a) => `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;

/* ------------------------------------------------------------------ *
 *  Settings
 * ------------------------------------------------------------------ */

let G = { glow: 'off', shadows: 'off', grade: 'off', particles: 'off', background: 'static', detail: 'plain', effects: false };
let failed = false;
const reducedMq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reducedMotion = () => !!(reducedMq && reducedMq.matches);

/** Apply resolved graphics settings (gfx.resolve output). Takes effect next frame. */
export function setGraphics(r) {
  G = Object.assign({}, G, r);
  failed = false;
  envCache = null;
  if (particleCap() === 0) particles.length = 0;
}

/** True when an effect pass threw and the renderer fell back to the plain view. */
export function effectsFailed() { return failed; }

const particleCap = () => (reducedMotion() ? 0 : PARTICLE_CAP[G.particles] || 0);
const animated = () => G.background === 'animated' && !reducedMotion();

/* ------------------------------------------------------------------ *
 *  Plain baseline (Low preset) — the original renderer
 * ------------------------------------------------------------------ */

function renderPlain(ctx, w, h, state, T) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = css(T.sky);
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;
  const scale = (Math.min(w, h) * 0.46) / state.arena.outer;

  ctx.beginPath();
  ctx.arc(cx, cy, state.arena.outer * scale, 0, Math.PI * 2);
  ctx.fillStyle = css(T.floor);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = css(T.rimGlow);
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (state.arena.inner > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, state.arena.inner * scale, 0, Math.PI * 2);
    ctx.fillStyle = css(T.island);
    ctx.fill();
  }

  for (const t of state.arena.thorns) {
    ctx.beginPath();
    ctx.arc(cx + t.x * scale, cy - t.y * scale, Math.max(3, t.r * scale), 0, Math.PI * 2);
    ctx.fillStyle = '#7a1f1f';
    ctx.fill();
  }

  for (const m of state.motes) {
    const r = m.bloom ? 5 : 3;
    ctx.beginPath();
    ctx.arc(cx + m.x * scale, cy - m.y * scale, r, 0, Math.PI * 2);
    ctx.fillStyle = m.bloom ? css(T.moteBloom) : css(T.mote);
    ctx.fill();
  }

  // Ownership must stay legible: the player's serpent is the pale one with a
  // white head and every rival keeps its own hue from the rules state.
  for (const s of state.serpents) {
    if (!s.alive && !s.boostOn) continue;
    const mine = !s.isBot;
    const trailColor = mine ? '#e8f4ff' : `hsl(${s.hue}, 70%, 62%)`;
    const headColor = mine ? '#ffffff' : `hsl(${s.hue}, 80%, 72%)`;
    const tr = s.trail;
    for (let i = tr.length - 1; i >= 0; i -= Math.max(1, Math.floor(tr.length / 60))) {
      ctx.beginPath();
      ctx.arc(cx + tr[i].x * scale, cy - tr[i].y * scale, s.boostOn ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = trailColor;
      ctx.fill();
    }
    const hx = cx + s.x * scale, hy = cy - s.y * scale;
    if (mine) {
      ctx.beginPath();
      ctx.arc(hx, hy, s.boostOn ? 10 : 9, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(232,244,255,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(hx, hy, s.boostOn ? 6 : 5, 0, Math.PI * 2);
    ctx.fillStyle = headColor;
    ctx.fill();
  }
}

/* ------------------------------------------------------------------ *
 *  Deterministic cosmetic noise (never touches the rules RNG)
 * ------------------------------------------------------------------ */

function hash01(n) {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ *
 *  Cached backdrop: sky, textured floor, foliage, island, grade
 * ------------------------------------------------------------------ */

let envCache = null;

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function backdrop(w, h, state, T, themeKey) {
  const key = [w, h, themeKey, state.arena.outer, state.arena.inner, G.detail, G.grade, G.glow].join('|');
  if (envCache && envCache.key === key) return envCache.canvas;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const cx = w / 2, cy = h / 2;
  const scale = (Math.min(w, h) * 0.46) / state.arena.outer;
  const R = state.arena.outer * scale;
  const Ri = state.arena.inner * scale;
  const detailed = G.detail === 'detailed';
  const u = Math.min(w, h) / 720; // size unit

  // Sky: deep radial falloff instead of a flat fill.
  if (detailed) {
    const sky = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, Math.hypot(cx, cy));
    sky.addColorStop(0, rgba(T.fog ?? T.sky, 1));
    sky.addColorStop(1, css(T.sky));
    g.fillStyle = sky;
  } else g.fillStyle = css(T.sky);
  g.fillRect(0, 0, w, h);

  if (detailed) {
    // Foliage: fronds rooted just outside the rim, leaning outwards, so no
    // decoration ever overlaps the playfield.
    const n = 64;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash01(i * 7 + 1) * 0.08;
      const len = R * (0.07 + hash01(i * 13 + 5) * 0.12);
      const bend = (hash01(i * 3 + 9) - 0.5) * 0.9;
      const bx = cx + Math.cos(a) * (R + 3 * u), by = cy + Math.sin(a) * (R + 3 * u);
      const tx = cx + Math.cos(a + bend * 0.12) * (R + len), ty = cy + Math.sin(a + bend * 0.12) * (R + len);
      const mx = cx + Math.cos(a + bend * 0.2) * (R + len * 0.55), my = cy + Math.sin(a + bend * 0.2) * (R + len * 0.55);
      const lg = g.createLinearGradient(bx, by, tx, ty);
      lg.addColorStop(0, rgba(T.plantA, 0.9));
      lg.addColorStop(0.7, rgba(T.plantB, 0.55));
      lg.addColorStop(1, rgba(T.plantTip, 0.35));
      g.strokeStyle = lg;
      g.lineCap = 'round';
      g.lineWidth = (2.2 + hash01(i * 17) * 2.5) * u;
      g.beginPath();
      g.moveTo(bx, by);
      g.quadraticCurveTo(mx, my, tx, ty);
      g.stroke();
      // Tip bud.
      g.fillStyle = rgba(T.plantTip, 0.5);
      g.beginPath();
      g.arc(tx, ty, 1.6 * u, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Floor.
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  if (detailed) {
    const fl = g.createRadialGradient(cx, cy, Ri, cx, cy, R);
    fl.addColorStop(0, css(T.floor));
    fl.addColorStop(0.75, css(T.floor));
    fl.addColorStop(1, rgba(T.floorRing, 1));
    g.fillStyle = fl;
  } else g.fillStyle = css(T.floor);
  g.fill();

  if (detailed) {
    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.clip();
    // Concentric growth rings and speckled moss: low contrast, under everything.
    g.lineWidth = 1 * u;
    for (let k = 1; k <= 7; k++) {
      const rr = Ri + ((R - Ri) * k) / 8;
      g.strokeStyle = rgba(T.floorRing, 0.55);
      g.beginPath();
      g.arc(cx, cy, rr, 0, Math.PI * 2);
      g.stroke();
    }
    const specks = Math.round(900 * u * u);
    for (let i = 0; i < specks; i++) {
      const a = hash01(i * 2 + 11) * Math.PI * 2;
      const rr = Ri + Math.sqrt(hash01(i * 2 + 12)) * (R - Ri);
      const light = hash01(i + 77) > 0.5;
      g.fillStyle = light ? rgba(T.floorRing, 0.9) : 'rgba(0,0,0,0.25)';
      g.fillRect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1.4 * u, 1.4 * u);
    }
    // Inner shading toward the rim wall.
    const wall = g.createRadialGradient(cx, cy, R * 0.86, cx, cy, R);
    wall.addColorStop(0, 'rgba(0,0,0,0)');
    wall.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = wall;
    g.fillRect(0, 0, w, h);
    g.restore();
  }

  // Rim.
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  if (detailed) {
    g.lineWidth = 5 * u;
    g.strokeStyle = rgba(T.rim ?? T.rimGlow, 0.9);
    g.stroke();
    g.lineWidth = 2 * u;
    g.strokeStyle = rgba(T.rimGlow, 0.85);
    g.stroke();
  } else {
    g.lineWidth = 2;
    g.strokeStyle = rgba(T.rimGlow, 0.6);
    g.stroke();
  }
  if (G.glow !== 'off') {
    g.globalCompositeOperation = 'lighter';
    for (const [lw, a] of [[14, 0.06], [8, 0.08], [4, 0.1]]) {
      g.lineWidth = lw * u;
      g.strokeStyle = rgba(T.rimGlow, a);
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  }

  // Island.
  if (state.arena.inner > 0) {
    g.beginPath();
    g.arc(cx, cy, Ri, 0, Math.PI * 2);
    if (detailed) {
      const is = g.createRadialGradient(cx - Ri * 0.3, cy - Ri * 0.3, Ri * 0.1, cx, cy, Ri);
      is.addColorStop(0, rgba(T.plantA, 0.55));
      is.addColorStop(0.55, css(T.island));
      is.addColorStop(1, css(T.island));
      g.fillStyle = is;
      g.fill();
      // Moss tufts on the island and a lit edge so the hazard boundary reads.
      for (let i = 0; i < 26; i++) {
        const a = hash01(i * 5 + 3) * Math.PI * 2;
        const rr = Math.sqrt(hash01(i * 5 + 4)) * Ri * 0.8;
        g.fillStyle = rgba(T.plantB, 0.18 + hash01(i) * 0.15);
        g.beginPath();
        g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, (2 + hash01(i * 9) * 4) * u, 0, Math.PI * 2);
        g.fill();
      }
      g.lineWidth = 2.5 * u;
      g.strokeStyle = rgba(T.rimGlow, 0.45);
      g.beginPath();
      g.arc(cx, cy, Ri, 0, Math.PI * 2);
      g.stroke();
    } else {
      g.fillStyle = css(T.island);
      g.fill();
    }
  }

  // Colour grade + vignette on the backdrop only (gameplay pieces stay ungraded).
  if (G.grade === 'on') {
    g.globalCompositeOperation = 'soft-light';
    const tint = g.createLinearGradient(0, 0, w, h);
    tint.addColorStop(0, rgba(T.rimGlow, 0.18));
    tint.addColorStop(1, 'rgba(40,20,80,0.18)');
    g.fillStyle = tint;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    const vg = g.createRadialGradient(cx, cy, Math.min(w, h) * 0.42, cx, cy, Math.hypot(cx, cy));
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
  }

  envCache = { key, canvas: c };
  return c;
}

/* ------------------------------------------------------------------ *
 *  Glow sprites (cached radial gradients drawn additively)
 * ------------------------------------------------------------------ */

const spriteCache = new Map();
function glowSprite(color) {
  let s = spriteCache.get(color);
  if (s) return s;
  const size = 64;
  s = makeCanvas(size, size);
  const g = s.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, color);
  gr.addColorStop(0.35, color.replace(/,\s*[\d.]+\)$/, ',0.35)'));
  gr.addColorStop(1, color.replace(/,\s*[\d.]+\)$/, ',0)'));
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  if (spriteCache.size > 64) spriteCache.clear();
  spriteCache.set(color, s);
  return s;
}

const hslToRgb = (h, s, l) => {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return [f(0), f(8), f(4)];
};
const hslA = (h, s, l, a) => { const [r, g, b] = hslToRgb(h, s, l); return `rgba(${r},${g},${b},${a})`; };

/* ------------------------------------------------------------------ *
 *  Particles (pooled; positions in sim units so resizes don't matter)
 * ------------------------------------------------------------------ */

const particles = [];

function spawn(x, y, n, color, speed, life, size) {
  const cap = particleCap();
  if (!cap) return;
  for (let i = 0; i < n && particles.length < cap; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.35 + Math.random() * 0.65);
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size });
  }
}

/** Feed simulation events (eat, death, boost) to the cosmetic particle system. */
export function fxEvents(events, state, theme) {
  if (!events || !events.length || !particleCap()) return;
  const T = Object.assign({}, FALLBACK_THEME, theme);
  const rich = G.particles === 'high';
  for (const e of events) {
    if (e.type === 'eat') {
      const col = rgba(e.bloom ? T.moteBloom : T.mote, 0.9);
      spawn(e.x, e.y, (e.bloom ? 14 : 6) * (rich ? 1 : 0.5), col, e.bloom ? 2600 : 1600, 0.5, e.bloom ? 2.4 : 1.8);
    } else if (e.type === 'death') {
      const s = state.serpents.find((q) => q.id === e.serpent);
      const col = !s || !s.isBot ? 'rgba(232,244,255,0.9)' : hslA(s.hue, 80, 68, 0.9);
      spawn(e.x, e.y, rich ? 40 : 18, col, 4200, 1.1, 2.6);
      if (s) for (let i = 0; i < s.trail.length; i += rich ? 4 : 9) spawn(s.trail[i].x, s.trail[i].y, 1, col, 900, 0.9, 1.8);
    } else if (e.type === 'boost-start') {
      spawn(e.x, e.y, rich ? 10 : 5, 'rgba(255,240,200,0.8)', 2200, 0.45, 2);
    }
  }
}

function stepParticles(dt, state) {
  if (!particleCap()) { particles.length = 0; return; }
  // Boost wake: a few motes of light shed behind every boosting serpent.
  for (const s of state.serpents) {
    if (!s.alive || !s.boostOn || s.trail.length < 4) continue;
    if (Math.random() < dt * (G.particles === 'high' ? 40 : 18)) {
      const p = s.trail[Math.min(s.trail.length - 1, 3)];
      spawn(p.x, p.y, 1, s.isBot ? hslA(s.hue, 80, 72, 0.8) : 'rgba(240,248,255,0.8)', 500, 0.6, 1.6);
    }
  }
  let j = 0;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) continue;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 1 - 2.5 * dt; p.vy *= 1 - 2.5 * dt;
    particles[j++] = p;
  }
  particles.length = j;
}

/* ------------------------------------------------------------------ *
 *  Effects renderer
 * ------------------------------------------------------------------ */

let lastNow = 0;

function sampleTrail(s, maxPts) {
  const tr = s.trail;
  const stride = Math.max(1, Math.floor(tr.length / maxPts));
  const pts = [];
  for (let i = 0; i < tr.length; i += stride) pts.push(tr[i]);
  if (pts[pts.length - 1] !== tr[tr.length - 1]) pts.push(tr[tr.length - 1]);
  return pts;
}

function strokeBody(ctx, P, widthAt, style, chunks) {
  const n = P.length;
  if (n < 2) return;
  ctx.strokeStyle = style;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const per = Math.max(1, Math.ceil((n - 1) / chunks));
  // Tail first so the thicker, head-side chunks sit on top.
  for (let start = Math.floor((n - 2) / per) * per; start >= 0; start -= per) {
    const end = Math.min(n - 1, start + per);
    ctx.lineWidth = widthAt(start / (n - 1));
    ctx.beginPath();
    ctx.moveTo(P[start][0], P[start][1]);
    for (let i = start + 1; i <= end; i++) ctx.lineTo(P[i][0], P[i][1]);
    ctx.stroke();
  }
}

function renderFx(ctx, w, h, state, T, themeKey, now, hero) {
  const dt = Math.min(0.1, Math.max(0, (now - (lastNow || now)) / 1000));
  lastNow = now;
  const t = animated() ? now / 1000 : 0;
  const cx = w / 2, cy = h / 2;
  const scale = (Math.min(w, h) * 0.46) / state.arena.outer;
  const u = Math.min(w, h) / 720;
  const detailed = G.detail === 'detailed';
  const glow = G.glow !== 'off';
  const X = (x) => cx + x * scale, Y = (y) => cy - y * scale;

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.drawImage(backdrop(w, h, state, T, themeKey), 0, 0);

  // Ambient motion: drifting spores and a slow rim shimmer.
  if (animated()) {
    const R = state.arena.outer * scale;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 46; i++) {
      const a = hash01(i * 3 + 1) * Math.PI * 2 + t * (0.02 + hash01(i) * 0.04) * (i % 2 ? 1 : -1);
      const rr = R * (0.2 + hash01(i * 3 + 2) * 1.1) + Math.sin(t * 0.7 + i) * 6 * u;
      const tw = 0.25 + 0.25 * Math.sin(t * (1 + hash01(i * 5)) * 2 + i);
      ctx.fillStyle = rgba(T.spore ?? T.mote, tw);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, (1 + hash01(i * 7) * 1.5) * u, 0, Math.PI * 2);
      ctx.fill();
    }
    if (glow) {
      ctx.lineWidth = 6 * u;
      ctx.strokeStyle = rgba(T.rimGlow, 0.05 + 0.04 * Math.sin(t * 1.3));
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Thorns.
  for (const th of state.arena.thorns) {
    const x = X(th.x), y = Y(th.y), r = Math.max(3, th.r * scale);
    if (G.shadows === 'on') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.arc(x + 2 * u, y + 3 * u, r, 0, Math.PI * 2); ctx.fill();
    }
    if (detailed) {
      ctx.beginPath();
      const spikes = 9;
      for (let k = 0; k <= spikes * 2; k++) {
        const a = (k / (spikes * 2)) * Math.PI * 2 + hash01(Math.round(th.x + th.y)) * 2;
        const rr = k % 2 ? r * 0.72 : r * 1.12;
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      const tg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r * 1.1);
      tg.addColorStop(0, '#c0392b');
      tg.addColorStop(1, '#5a1414');
      ctx.fillStyle = tg;
      ctx.fill();
      ctx.lineWidth = 1.2 * u;
      ctx.strokeStyle = '#2a0808';
      ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#7a1f1f'; ctx.fill();
    }
  }

  // Motes: core plus additive halo; bloom motes pulse gently.
  const moteC = css(T.mote), bloomC = css(T.moteBloom);
  if (glow) {
    ctx.globalCompositeOperation = 'lighter';
    const sm = glowSprite(rgba(T.mote, 0.5)), sb = glowSprite(rgba(T.moteBloom, 0.7));
    for (const m of state.motes) {
      const pulse = m.bloom ? 1 + 0.18 * Math.sin(t * 3 + m.x * 0.001) : 1;
      const s = (m.bloom ? 26 : 12) * u * pulse;
      ctx.drawImage(m.bloom ? sb : sm, X(m.x) - s / 2, Y(m.y) - s / 2, s, s);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  const mu = detailed ? Math.max(1, u) : 1;
  for (const m of state.motes) {
    const r = (m.bloom ? 5 : 3) * mu;
    ctx.beginPath();
    ctx.arc(X(m.x), Y(m.y), r, 0, Math.PI * 2);
    ctx.fillStyle = m.bloom ? bloomC : moteC;
    ctx.fill();
  }

  // Serpents.
  const bodyR = (state.ruleset && state.ruleset.serpent && state.ruleset.serpent.bodyRadius) || 200;
  const live = state.serpents.filter((s) => s.alive || s.boostOn);
  const views = live.map((s) => {
    const pts = sampleTrail(s, detailed ? 90 : 60).map((p) => [X(p.x), Y(p.y)]);
    const bw = Math.max(5, 2 * bodyR * scale) * (s.boostOn ? 1.1 : 1);
    return { s, pts, bw, mine: !s.isBot };
  });

  if (G.shadows === 'on') {
    ctx.save();
    ctx.translate(2.5 * u, 4 * u);
    for (const v of views) {
      if (detailed) strokeBody(ctx, v.pts, (f) => v.bw * (1 - 0.55 * f) + 1, 'rgba(0,0,0,0.38)', 10);
      else for (const p of v.pts) { ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }

  if (glow) {
    ctx.globalCompositeOperation = 'lighter';
    for (const v of views) {
      const col = v.mine ? 'rgba(200,230,255,A)' : hslA(v.s.hue, 85, 60, 'A');
      const k = (v.s.boostOn ? 1.6 : 1) * (G.glow === 'high' ? 1.35 : 1);
      strokeBody(ctx, v.pts, (f) => v.bw * (2.6 - 1.2 * f) * k, col.replace('A', String(0.07 * k)), 6);
      if (G.glow === 'high') strokeBody(ctx, v.pts, (f) => v.bw * (1.6 - 0.6 * f), col.replace('A', '0.1'), 6);
      const hs = v.bw * 5 * k;
      const hx = X(v.s.x), hy = Y(v.s.y);
      ctx.drawImage(glowSprite(col.replace('A', '0.4')), hx - hs / 2, hy - hs / 2, hs, hs);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  for (const v of views) {
    const { s, pts, bw, mine } = v;
    const hx = X(s.x), hy = Y(s.y);
    if (detailed) {
      const base = mine ? '#e8f4ff' : hslA(s.hue, 70, 62, 1);
      const edge = mine ? '#8aa3bd' : hslA(s.hue, 60, 30, 1);
      const hi = mine ? 'rgba(255,255,255,0.9)' : hslA(s.hue, 90, 84, 0.85);
      strokeBody(ctx, pts, (f) => bw * (1 - 0.55 * f) + 2 * u, edge, 12);
      strokeBody(ctx, pts, (f) => bw * (1 - 0.55 * f), base, 12);
      strokeBody(ctx, pts, (f) => bw * (1 - 0.55 * f) * 0.32, hi, 12);
      // Dorsal scale marks every few samples.
      ctx.fillStyle = mine ? 'rgba(120,150,190,0.55)' : hslA(s.hue, 55, 38, 0.6);
      for (let i = 3; i < pts.length - 1; i += 4) {
        const f = i / (pts.length - 1);
        ctx.beginPath();
        ctx.arc(pts[i][0], pts[i][1], Math.max(1, bw * (1 - 0.55 * f) * 0.16), 0, Math.PI * 2);
        ctx.fill();
      }
      // Head: oriented teardrop with eyes. The player's head stays pure white.
      const nx = pts.length > 2 ? pts[2] : [hx - 1, hy];
      const ang = Math.atan2(hy - nx[1], hx - nx[0]);
      const hr = bw * 0.72;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(ang);
      if (mine) {
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(9, hr + 5 * u), 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(232,244,255,0.6)';
        ctx.lineWidth = 2 * u;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(hr * 0.15, 0, hr * 1.2, hr, 0, 0, Math.PI * 2);
      ctx.fillStyle = mine ? '#ffffff' : hslA(s.hue, 80, 72, 1);
      ctx.fill();
      ctx.lineWidth = 1.2 * u;
      ctx.strokeStyle = edge;
      ctx.stroke();
      ctx.fillStyle = mine ? '#1b2a3a' : '#0b0f18';
      for (const sy of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(hr * 0.55, sy * hr * 0.5, Math.max(1.1, hr * 0.2), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else {
      const trailColor = mine ? '#e8f4ff' : `hsl(${s.hue}, 70%, 62%)`;
      const headColor = mine ? '#ffffff' : `hsl(${s.hue}, 80%, 72%)`;
      ctx.fillStyle = trailColor;
      for (let i = pts.length - 1; i >= 0; i--) {
        ctx.beginPath(); ctx.arc(pts[i][0], pts[i][1], s.boostOn ? 4 : 3, 0, Math.PI * 2); ctx.fill();
      }
      if (mine) {
        ctx.beginPath(); ctx.arc(hx, hy, s.boostOn ? 10 : 9, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(232,244,255,0.55)'; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(hx, hy, s.boostOn ? 6 : 5, 0, Math.PI * 2);
      ctx.fillStyle = headColor; ctx.fill();
    }
  }

  // Particles (additive). The title hero has none.
  if (hero) return;
  stepParticles(dt, state);
  if (particles.length) {
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      const a = p.life / p.max;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), p.size * u * (0.6 + 0.4 * a), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

/* ------------------------------------------------------------------ *
 *  Entry point
 * ------------------------------------------------------------------ */

/** Drop pooled particles (new round, leaving to the title). */
export function resetFx() { particles.length = 0; lastNow = 0; }

export function render(canvas, state, theme, now, hero = false) {
  const T = Object.assign({}, FALLBACK_THEME, theme);
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  if (G.effects && !failed) {
    try {
      renderFx(ctx, w, h, state, T, (theme && theme.id) || 'fallback', now ?? performance.now(), hero);
      return;
    } catch {
      // An effect pass failed on this browser: fall back to the plain view
      // (the Graphics panel reports it via effectsFailed()).
      failed = true;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }
  renderPlain(ctx, w, h, state, T);
}

/* ------------------------------------------------------------------ *
 *  Title hero: a small looping vignette of the ring built from a
 *  synthetic state and drawn with the same passes.
 * ------------------------------------------------------------------ */

const heroMotes = Array.from({ length: 34 }, (_, i) => {
  const a = hash01(i * 11 + 3) * Math.PI * 2;
  const r = 4200 + hash01(i * 11 + 4) * 6800;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r, bloom: i % 9 === 0 };
});

function heroSerpent(id, isBot, hue, t, phase, radius, len) {
  const trail = [];
  for (let i = 0; i < len; i++) {
    const a = t * 0.45 + phase - i * 0.028;
    const r = radius + Math.sin(a * 3 + phase) * 900;
    trail.push({ x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r) });
  }
  return { id, isBot, hue, alive: true, boostOn: false, x: trail[0].x, y: trail[0].y, trail };
}

let heroDrawnKey = '';
/** Draw the title hero; animates only with an animated background and motion allowed. */
export function renderHero(canvas, theme, now) {
  const moving = G.effects && animated();
  const key = `${canvas.width}x${canvas.height}|${JSON.stringify(G)}`;
  if (!moving && heroDrawnKey === key) return;
  heroDrawnKey = key;
  const t = moving ? now / 1000 : 2.4;
  const state = {
    arena: { outer: 12000, inner: 3000, thorns: [] },
    ruleset: { serpent: { bodyRadius: 260 } },
    motes: heroMotes,
    serpents: [
      heroSerpent('hero-rival', true, (theme && theme.serpentHues && theme.serpentHues[4]) || 35, t, 2.6, 8200, 70),
      heroSerpent('hero', false, 0, t, 0, 7000, 90),
    ],
  };
  render(canvas, state, theme, now, true);
}
