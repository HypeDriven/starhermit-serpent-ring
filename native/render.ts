// The ring, as the browser build's js/render.js drew it on its 2D canvas, on
// the runtime: the static backdrop (sky, foliage, textured floor, growth
// rings, rim and its glow, island, colour grade and vignette, and the thorns,
// which never move) is painted once per size, theme and look into an
// OffscreenCanvas with render.js's own canvas code — in stages, one a frame,
// within the canvas work budget — and drawn as one image; everything that
// moves (spores, motes and their halos, serpent shadows, glows, bodies,
// scales and heads, particles) is drawn each frame with starhermit:draw
// primitives (circles, lines, ellipses, additive glow sprites). The plain
// baseline (the Low look) is primitives only, as render.js's renderPlain.
//
// Sizes: render.js worked in its canvas's pixels, the CSS size times the
// look's capped pixel ratio (Low 1, Balanced 1.5, High and Ultra 2). This
// module keeps that space ("canvas pixels": the playfield rectangle divided
// by K = window scale / capped ratio) so every constant means what it meant,
// and maps to window pixels as it draws. Gameplay colours (the pale player
// with a pure-white head, rival hues, mote colours, red thorns) are never
// graded.
import * as draw from "starhermit:draw";
import { OffscreenCanvas, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import { Looks, type GameEvent, type Look, type State, type Serpent, type Theme } from "./game.ts";

export interface Rect { x: number; y: number; width: number; height: number }
type RGBA = [number, number, number, number];

const FALLBACK: Theme = {
  id: "fallback", name: "", serpentHues: [],
  sky: 0x0a0f18, fog: 0x0a0f18, floor: 0x101b2a, island: 0x0d1524,
  rimGlow: 0x37e2c8, mote: 0x9fe8ff, moteBloom: 0xffd75e,
  floorRing: 0x12303a, rim: 0x1d5f6b, plantA: 0x1b7f77, plantB: 0x2fd8b0,
  plantTip: 0x9ff5e2, spore: 0x2c8f9e,
};
const css = (hex: number): string => "#" + (hex & 0xffffff).toString(16).padStart(6, "0");
const rgba = (hex: number, a: number): string => `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;
const C = (hex: number, a = 1): RGBA => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, a];
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
const hsl = (h: number, s: number, l: number, a = 1): RGBA => { const [r, g, b] = hslToRgb(h, s, l); return [r, g, b, a]; };
const withA = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], a];

function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ settings
let G: Look = Looks.lookFor("balanced", 2);
let reduced = false;
export function setLook(l: Look): void {
  G = l;
  caches.clear();
  if (particleCap() === 0) particles.length = 0;
}
export function setReducedMotion(on: boolean): void { reduced = on; }
const particleCap = (): number => (reduced ? 0 : Looks.particleCap(G));
const animated = (): boolean => G.background === "animated" && !reduced;

// ------------------------------------------------------------------ the frame's space
/** Window pixels per canvas pixel, and the playfield's window origin. */
let K = 1, OX = 0, OY = 0;
/** The playfield's window rectangle: nothing draws past it (the old canvas's edge). */
let CLIP: { x: number; y: number; width: number; height: number } = { x: 0, y: 0, width: 0, height: 0 };
const wx = (x: number): number => OX + x * K;
const wy = (y: number): number => OY + y * K;
function circle(x: number, y: number, r: number, c: RGBA, blend?: draw.BlendMode): void {
  if (r <= 0) return;
  draw.circle(wx(x), wy(y), r * K, c, blend ? { blend, clip: CLIP } : { clip: CLIP });
}
function ring(x: number, y: number, r: number, c: RGBA, lw: number, blend?: draw.BlendMode): void {
  if (r <= 0 || lw <= 0) return;
  draw.strokeCircle(wx(x), wy(y), r * K, c, lw * K, blend ? { blend, clip: CLIP } : { clip: CLIP });
}
function line(x1: number, y1: number, x2: number, y2: number, c: RGBA, lw: number): void {
  draw.line(wx(x1), wy(y1), wx(x2), wy(y2), c, lw * K, { clip: CLIP });
}

// ------------------------------------------------------------------ the backdrop (staged bake)
interface Bake { key: string; canvas: OffscreenCanvas | null; g: OffscreenCanvasRenderingContext2D | null; stage: number; done: boolean; failed: boolean }
const caches = new Map<string, Bake>();
const STAGES = 5;

/** render.js backdrop(), split into stages (one a frame), plus the static thorns. */
function bakeStage(b: Bake, stage: number, w: number, h: number, state: State, T: Theme): void {
  const g = b.g!;
  const cx = w / 2, cy = h / 2;
  const scale = (Math.min(w, h) * 0.46) / state.arena.outer;
  const R = state.arena.outer * scale;
  const Ri = state.arena.inner * scale;
  const detailed = G.detail === "detailed";
  const u = Math.min(w, h) / 720;
  if (stage === 0) {
    // Sky: deep radial falloff instead of a flat fill.
    if (detailed) {
      const sky = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, Math.hypot(cx, cy));
      sky.addColorStop(0, rgba(T.fog ?? T.sky, 1));
      sky.addColorStop(1, css(T.sky));
      g.fillStyle = sky;
    } else g.fillStyle = css(T.sky);
    g.fillRect(0, 0, w, h);
    if (detailed) {
      // Foliage: fronds rooted just outside the rim, leaning outwards.
      const n = G.budget.fronds;
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
        g.lineCap = "round";
        g.lineWidth = (2.2 + hash01(i * 17) * 2.5) * u;
        g.beginPath();
        g.moveTo(bx, by);
        g.quadraticCurveTo(mx, my, tx, ty);
        g.stroke();
        g.fillStyle = rgba(T.plantTip, 0.5);
        g.beginPath();
        g.arc(tx, ty, 1.6 * u, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else if (stage === 1) {
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
      const specks = Math.round(G.budget.specks * u * u);
      for (let i = 0; i < specks; i++) {
        const a = hash01(i * 2 + 11) * Math.PI * 2;
        const rr = Ri + Math.sqrt(hash01(i * 2 + 12)) * (R - Ri);
        const light = hash01(i + 77) > 0.5;
        g.fillStyle = light ? rgba(T.floorRing, 0.9) : "rgba(0,0,0,0.25)";
        g.fillRect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1.4 * u, 1.4 * u);
      }
      // Inner shading toward the rim wall (only the ring's box: the clip keeps it inside).
      const wall = g.createRadialGradient(cx, cy, R * 0.86, cx, cy, R);
      wall.addColorStop(0, "rgba(0,0,0,0)");
      wall.addColorStop(1, "rgba(0,0,0,0.28)");
      g.fillStyle = wall;
      g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      g.restore();
    }
  } else if (stage === 2) {
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
    if (G.glow !== "off") {
      g.globalCompositeOperation = "lighter";
      for (const [lw, a] of [[14, 0.06], [8, 0.08], [4, 0.1]] as const) {
        g.lineWidth = lw * u;
        g.strokeStyle = rgba(T.rimGlow, a);
        g.beginPath();
        g.arc(cx, cy, R, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalCompositeOperation = "source-over";
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
  } else if (stage === 3) {
    // Colour grade + vignette on the backdrop only (gameplay pieces stay ungraded).
    if (G.grade === "on") {
      g.globalCompositeOperation = "soft-light";
      const tint = g.createLinearGradient(0, 0, w, h);
      tint.addColorStop(0, rgba(T.rimGlow, 0.18));
      tint.addColorStop(1, "rgba(40,20,80,0.18)");
      g.fillStyle = tint;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = "source-over";
      const vg = g.createRadialGradient(cx, cy, Math.min(w, h) * 0.42, cx, cy, Math.hypot(cx, cy));
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.55)");
      g.fillStyle = vg;
      g.fillRect(0, 0, w, h);
    }
  } else if (stage === 4) {
    // The thorns (render.js drew them each frame; they never move).
    for (const th of state.arena.thorns) {
      const x = cx + th.x * scale, y = cy - th.y * scale, r = Math.max(3, th.r * scale);
      if (G.shadows === "on") {
        g.fillStyle = "rgba(0,0,0,0.35)";
        g.beginPath(); g.arc(x + 2 * u, y + 3 * u, r, 0, Math.PI * 2); g.fill();
      }
      if (detailed) {
        g.beginPath();
        const spikes = 9;
        for (let k = 0; k <= spikes * 2; k++) {
          const a = (k / (spikes * 2)) * Math.PI * 2 + hash01(Math.round(th.x + th.y)) * 2;
          const rr = k % 2 ? r * 0.72 : r * 1.12;
          const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
          if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        const tg = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r * 1.1);
        tg.addColorStop(0, "#c0392b");
        tg.addColorStop(1, "#5a1414");
        g.fillStyle = tg;
        g.fill();
        g.lineWidth = 1.2 * u;
        g.strokeStyle = "#2a0808";
        g.stroke();
      } else {
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
        g.fillStyle = "#7a1f1f"; g.fill();
      }
    }
  }
}

/** The baked backdrop for this size/theme/look, advancing its bake one stage a frame; null until ready. */
function backdrop(slot: string, w: number, h: number, state: State, T: Theme): OffscreenCanvas | null {
  const thorns = state.arena.thorns.map((t) => `${t.x},${t.y},${t.r}`).join(";");
  const key = [w, h, T.id, state.arena.outer, state.arena.inner, thorns].join("|");
  let b = caches.get(slot);
  if (!b || b.key !== key) {
    b = { key, canvas: null, g: null, stage: 0, done: false, failed: false };
    caches.set(slot, b);
    try {
      b.canvas = new OffscreenCanvas(w, h);
      b.g = b.canvas.getContext("2d");
    } catch (e) { console.warn(`backdrop: ${String(e)}`); b.failed = true; }
  }
  if (b.failed) return null;
  if (!b.done) {
    try {
      bakeStage(b, b.stage, w, h, state, T);
      b.stage++;
      if (b.stage >= STAGES) b.done = true;
    } catch (e) {
      // the frame's canvas budget ran out: the same stage again next frame
      if (!(e instanceof RangeError)) { console.warn(`backdrop: ${String(e)}`); b.failed = true; }
    }
  }
  return b.done ? b.canvas : null;
}

// ------------------------------------------------------------------ glow sprites (render.js glowSprite)
const sprites = new Map<number, OffscreenCanvas>();
/** A white radial falloff: alpha a at the centre, 0.35 at 35 %, 0 at the edge; drawn tinted and additive. */
function glowSprite(a: number): OffscreenCanvas {
  let s = sprites.get(a);
  if (s) return s;
  const size = 64;
  s = new OffscreenCanvas(size, size);
  const g = s.getContext("2d");
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, `rgba(255,255,255,${a})`);
  gr.addColorStop(0.35, "rgba(255,255,255,0.35)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  sprites.set(a, s);
  return s;
}
function sprite(a: number, color: RGBA, x: number, y: number, size: number): void {
  const s = size * K;
  draw.image(glowSprite(a), wx(x) - s / 2, wy(y) - s / 2, s, s, { blend: "add", tint: [color[0], color[1], color[2], 1], clip: CLIP });
}

// ------------------------------------------------------------------ particles (pooled; sim units)
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: RGBA; size: number }
const particles: Particle[] = [];
function spawn(x: number, y: number, n: number, color: RGBA, speed: number, life: number, size: number): void {
  const cap = particleCap();
  if (!cap) return;
  for (let i = 0; i < n && particles.length < cap; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.35 + Math.random() * 0.65);
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size });
  }
}
/** Feed simulation events (eat, death, boost) to the cosmetic particle system. */
export function fxEvents(events: GameEvent[], state: State, theme: Theme | null): void {
  if (!events.length || !particleCap()) return;
  const T = { ...FALLBACK, ...(theme ?? {}) };
  const rich = G.particles === "high";
  for (const e of events) {
    if (e.type === "eat") {
      const col = C(e.bloom ? T.moteBloom : T.mote, 0.9);
      spawn(e.x, e.y, (e.bloom ? 14 : 6) * (rich ? 1 : 0.5), col, e.bloom ? 2600 : 1600, 0.5, e.bloom ? 2.4 : 1.8);
    } else if (e.type === "death") {
      const s = state.serpents.find((q) => q.id === e.serpent);
      const col: RGBA = !s || !s.isBot ? [232 / 255, 244 / 255, 1, 0.9] : hsl(s.hue, 80, 68, 0.9);
      spawn(e.x, e.y, rich ? 40 : 18, col, 4200, 1.1, 2.6);
      if (s) for (let i = 0; i < s.trail.length; i += rich ? 4 : 9) spawn(s.trail[i]!.x, s.trail[i]!.y, 1, col, 900, 0.9, 1.8);
    } else if (e.type === "boost-start") {
      spawn(e.x, e.y, rich ? 10 : 5, [1, 240 / 255, 200 / 255, 0.8], 2200, 0.45, 2);
    }
  }
}
function stepParticles(dt: number, state: State): void {
  if (!particleCap()) { particles.length = 0; return; }
  // Boost wake: a few motes of light shed behind every boosting serpent.
  for (const s of state.serpents) {
    if (!s.alive || !s.boostOn || s.trail.length < 4) continue;
    if (Math.random() < dt * (G.particles === "high" ? 40 : 18)) {
      const p = s.trail[Math.min(s.trail.length - 1, 3)]!;
      spawn(p.x, p.y, 1, s.isBot ? hsl(s.hue, 80, 72, 0.8) : [240 / 255, 248 / 255, 1, 0.8], 500, 0.6, 1.6);
    }
  }
  let j = 0;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]!;
    p.life -= dt;
    if (p.life <= 0) continue;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 1 - 2.5 * dt; p.vy *= 1 - 2.5 * dt;
    particles[j++] = p;
  }
  particles.length = j;
}
/** Drop pooled particles (new round, leaving to the title). */
export function resetFx(): void { particles.length = 0; }

// ------------------------------------------------------------------ serpents
type P2 = [number, number];
function sampleTrail(s: Serpent, maxPts: number, X: (x: number) => number, Y: (y: number) => number): P2[] {
  const tr = s.trail;
  const stride = Math.max(1, Math.floor(tr.length / maxPts));
  const pts: P2[] = [];
  for (let i = 0; i < tr.length; i += stride) pts.push([X(tr[i]!.x), Y(tr[i]!.y)]);
  const last = tr[tr.length - 1];
  if (last && (tr.length - 1) % stride !== 0) pts.push([X(last.x), Y(last.y)]);
  return pts;
}
/**
 * render.js strokeBody: the body as round-capped chunks, each a constant
 * width, tail first so the head-side chunks sit on top. Opaque passes join
 * their segments with discs (round joins and caps); translucent passes
 * (glow) draw the segments alone so overlaps don't double their alpha.
 */
function strokeBody(P: P2[], widthAt: (f: number) => number, color: RGBA, chunks: number, blend?: draw.BlendMode): void {
  const n = P.length;
  if (n < 2) return;
  const opaque = color[3] >= 1 && !blend;
  const per = Math.max(1, Math.ceil((n - 1) / chunks));
  for (let start = Math.floor((n - 2) / per) * per; start >= 0; start -= per) {
    const end = Math.min(n - 1, start + per);
    const lw = widthAt(start / (n - 1));
    for (let i = start + 1; i <= end; i++) {
      const a = P[i - 1]!, b = P[i]!;
      line(a[0], a[1], b[0], b[1], color, lw);
    }
    if (opaque) for (let i = start; i <= end; i++) circle(P[i]![0], P[i]![1], lw / 2, color);
    else { circle(P[start]![0], P[start]![1], lw / 2, color, blend); }
  }
}

// ------------------------------------------------------------------ the frame
/** Window rect of the playfield, the window scale, the theme, the time (s), the frame's seconds. */
export function drawField(slot: string, rect: Rect, frameScale: number, state: State, theme: Theme | null, time: number, dt: number, hero = false): void {
  const T: Theme = { ...FALLBACK, ...(theme ?? {}) };
  const ratio = G.effects ? Math.min(frameScale, G.dprCap) : Math.min(frameScale, 1);
  K = frameScale / ratio;
  OX = rect.x; OY = rect.y;
  CLIP = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const w = Math.max(1, Math.round(rect.width / K)), h = Math.max(1, Math.round(rect.height / K));
  K = rect.width / w;
  if (G.effects) renderFx(slot, w, h, state, T, time, dt, hero);
  else renderPlain(w, h, state, T, hero);
}

function renderPlain(w: number, h: number, state: State, T: Theme, hero: boolean): void {
  draw.rect(OX, OY, w * K, h * K, C(T.sky));
  const cx = w / 2, cy = h / 2;
  const scale = (Math.min(w, h) * 0.46) / state.arena.outer;
  circle(cx, cy, state.arena.outer * scale, C(T.floor));
  ring(cx, cy, state.arena.outer * scale, C(T.rimGlow, 0.6), 2);
  if (state.arena.inner > 0) circle(cx, cy, state.arena.inner * scale, C(T.island));
  for (const t of state.arena.thorns) circle(cx + t.x * scale, cy - t.y * scale, Math.max(3, t.r * scale), C(0x7a1f1f));
  const mote = C(T.mote), bloom = C(T.moteBloom);
  for (const m of state.motes) circle(cx + m.x * scale, cy - m.y * scale, m.bloom ? 5 : 3, m.bloom ? bloom : mote);
  // Ownership must stay legible: the player's serpent is the pale one with a
  // white head and every rival keeps its own hue from the rules state.
  for (const s of state.serpents) {
    if (!s.alive && !s.boostOn) continue;
    const mine = !s.isBot;
    const trail: RGBA = mine ? C(0xe8f4ff) : hsl(s.hue, 70, 62);
    const head: RGBA = mine ? [1, 1, 1, 1] : hsl(s.hue, 80, 72);
    const tr = s.trail;
    const dot = s.boostOn ? 4 : 3;
    for (let i = tr.length - 1; i >= 0; i -= Math.max(1, Math.floor(tr.length / 60))) circle(cx + tr[i]!.x * scale, cy - tr[i]!.y * scale, dot, trail);
    const hx = cx + s.x * scale, hy = cy - s.y * scale;
    if (mine) ring(hx, hy, s.boostOn ? 10 : 9, [232 / 255, 244 / 255, 1, 0.55], 2);
    circle(hx, hy, s.boostOn ? 6 : 5, head);
  }
  if (hero) heroMask(w, h);
}

/** The title vignette's elliptical fade (the old CSS mask) as page-coloured bands over the plain hero. */
function heroMask(w: number, h: number): void {
  const bake = caches.get("hero-mask");
  const key = `${w}x${h}`;
  let c = bake?.key === key ? bake.canvas : null;
  if (!c) {
    try {
      c = new OffscreenCanvas(w, h);
      const g = c.getContext("2d");
      g.fillStyle = PAGE_BG;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = "destination-out";
      g.save();
      g.translate(w / 2, h / 2);
      g.scale(w / 2, h / 2);
      const m = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      m.addColorStop(0, "rgba(0,0,0,1)");
      m.addColorStop(0.7, "rgba(0,0,0,1)");
      m.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = m;
      g.fillRect(-1, -1, 2, 2);
      g.restore();
      caches.set("hero-mask", { key, canvas: c, g: null, stage: STAGES, done: true, failed: false });
    } catch { return; }
  }
  draw.image(c, OX, OY, w * K, h * K);
}
/** The page background (--sr-bg) the title vignette fades into. */
export const PAGE_BG = "#0b1220";

function renderFx(slot: string, w: number, h: number, state: State, T: Theme, time: number, dt: number, hero: boolean): void {
  const t = animated() ? time : 0;
  const cx = w / 2, cy = h / 2;
  const scale = (Math.min(w, h) * 0.46) / state.arena.outer;
  const u = Math.min(w, h) / 720;
  const detailed = G.detail === "detailed";
  const glow = G.glow !== "off";
  const X = (x: number): number => cx + x * scale, Y = (y: number): number => cy - y * scale;

  const bg = backdrop(slot, w, h, state, T);
  if (bg) draw.image(bg, OX, OY, w * K, h * K);
  else {
    // while the backdrop bakes (a frame or four): the plain ring under the pieces
    draw.rect(OX, OY, w * K, h * K, C(T.sky));
    circle(cx, cy, state.arena.outer * scale, C(T.floor));
    if (state.arena.inner > 0) circle(cx, cy, state.arena.inner * scale, C(T.island));
  }

  // Ambient motion: drifting spores and a slow rim shimmer.
  if (animated()) {
    const R = state.arena.outer * scale;
    for (let i = 0, n = G.budget.spores; i < n; i++) {
      const a = hash01(i * 3 + 1) * Math.PI * 2 + t * (0.02 + hash01(i) * 0.04) * (i % 2 ? 1 : -1);
      const rr = R * (0.2 + hash01(i * 3 + 2) * 1.1) + Math.sin(t * 0.7 + i) * 6 * u;
      const tw = 0.25 + 0.25 * Math.sin(t * (1 + hash01(i * 5)) * 2 + i);
      const sx = cx + Math.cos(a) * rr, sy = cy + Math.sin(a) * rr;
      circle(sx, sy, (1 + hash01(i * 7) * 1.5) * u, C(T.spore ?? T.mote, tw), "add");
    }
    if (glow) ring(cx, cy, R, C(T.rimGlow, 0.05 + 0.04 * Math.sin(t * 1.3)), 6 * u, "add");
  }

  // Motes: core plus additive halo; bloom motes pulse gently.
  if (glow) {
    const rings = G.budget.haloRings;
    const hr = 6 * u;
    const halo = C(T.mote, 0.3 / rings);
    for (const m of state.motes) {
      if (m.bloom) continue;
      const x = X(m.x), y = Y(m.y);
      for (let k = 1; k <= rings; k++) circle(x, y, hr * (k / rings), halo, "add");
    }
    const bc = C(T.moteBloom);
    for (const m of state.motes) {
      if (!m.bloom) continue;
      sprite(0.7, bc, X(m.x), Y(m.y), 26 * u * (1 + 0.18 * Math.sin(t * 3 + m.x * 0.001)));
    }
  }
  const mu = detailed ? Math.max(1, u) : 1;
  const moteC = C(T.mote), bloomC = C(T.moteBloom);
  for (const m of state.motes) if (!m.bloom) circle(X(m.x), Y(m.y), 3 * mu, moteC);
  for (const m of state.motes) if (m.bloom) circle(X(m.x), Y(m.y), 5 * mu, bloomC);

  // Serpents.
  const bodyR = state.ruleset?.serpent?.bodyRadius || 200;
  const views = state.serpents.filter((s) => s.alive || s.boostOn).map((s) => {
    const pts = sampleTrail(s, detailed ? G.budget.samples : 60, X, Y);
    const bw = Math.max(5, 2 * bodyR * scale) * (s.boostOn ? 1.1 : 1);
    return { s, pts, bw, mine: !s.isBot };
  });

  if (G.shadows === "on") {
    const sh: RGBA = [0, 0, 0, 0.38];
    const ox = 2.5 * u, oy = 4 * u;
    for (const v of views) {
      const pts = v.pts.map((p) => [p[0] + ox, p[1] + oy] as P2);
      if (detailed) strokeBody(pts, (f) => v.bw * (1 - 0.55 * f) + 1, sh, G.budget.chunks);
      else for (const p of pts) circle(p[0], p[1], 3.5, sh);
    }
  }

  if (glow) {
    for (const v of views) {
      const base: RGBA = v.mine ? [200 / 255, 230 / 255, 1, 1] : hsl(v.s.hue, 85, 60);
      const k = (v.s.boostOn ? 1.6 : 1) * (G.glow === "high" ? 1.35 : 1);
      strokeBody(v.pts, (f) => v.bw * (2.6 - 1.2 * f) * k, withA(base, 0.07 * k), Math.ceil(G.budget.chunks / 2), "add");
      if (G.glow === "high") strokeBody(v.pts, (f) => v.bw * (1.6 - 0.6 * f), withA(base, 0.1), Math.ceil(G.budget.chunks / 2), "add");
      sprite(0.4, base, X(v.s.x), Y(v.s.y), v.bw * 5 * k);
    }
  }

  for (const v of views) {
    const { s, pts, bw, mine } = v;
    const hx = X(s.x), hy = Y(s.y);
    if (detailed) {
      const base: RGBA = mine ? C(0xe8f4ff) : hsl(s.hue, 70, 62);
      const edge: RGBA = mine ? C(0x8aa3bd) : hsl(s.hue, 60, 30);
      const hi: RGBA = mine ? [1, 1, 1, 0.9] : hsl(s.hue, 90, 84, 0.85);
      strokeBody(pts, (f) => bw * (1 - 0.55 * f) + 2 * u, edge, G.budget.chunks);
      strokeBody(pts, (f) => bw * (1 - 0.55 * f), base, G.budget.chunks);
      strokeBody(pts, (f) => bw * (1 - 0.55 * f) * 0.32, hi, G.budget.chunks);
      // Dorsal scale marks every few samples.
      const mark: RGBA = mine ? [120 / 255, 150 / 255, 190 / 255, 0.55] : hsl(s.hue, 55, 38, 0.6);
      for (let i = 3; i < pts.length - 1; i += 4) {
        const f = i / (pts.length - 1);
        circle(pts[i]![0], pts[i]![1], Math.max(1, bw * (1 - 0.55 * f) * 0.16), mark);
      }
      // Head: oriented teardrop with eyes. The player's head stays pure white.
      const nx = pts.length > 2 ? pts[2]! : [hx - 1, hy];
      const ang = Math.atan2(hy - nx[1]!, hx - nx[0]!);
      const hr = bw * 0.72;
      if (mine) ring(hx, hy, Math.max(9, hr + 5 * u), [232 / 255, 244 / 255, 1, 0.6], 2 * u);
      const cos = Math.cos(ang), sin = Math.sin(ang);
      const ex = hx + cos * hr * 0.15, ey = hy + sin * hr * 0.15;
      draw.ellipse(wx(ex), wy(ey), hr * 1.2 * K, hr * K, mine ? [1, 1, 1, 1] : hsl(s.hue, 80, 72), { rotation: ang, clip: CLIP });
      draw.strokeEllipse(wx(ex), wy(ey), hr * 1.2 * K, hr * K, edge, 1.2 * u * K, { rotation: ang, clip: CLIP });
      const eye: RGBA = mine ? C(0x1b2a3a) : C(0x0b0f18);
      for (const sy of [-1, 1]) {
        const lx = hr * 0.55, ly = sy * hr * 0.5;
        circle(hx + cos * lx - sin * ly, hy + sin * lx + cos * ly, Math.max(1.1, hr * 0.2), eye);
      }
    } else {
      const trail: RGBA = mine ? C(0xe8f4ff) : hsl(s.hue, 70, 62);
      const head: RGBA = mine ? [1, 1, 1, 1] : hsl(s.hue, 80, 72);
      for (let i = pts.length - 1; i >= 0; i--) circle(pts[i]![0], pts[i]![1], s.boostOn ? 4 : 3, trail);
      if (mine) ring(hx, hy, s.boostOn ? 10 : 9, [232 / 255, 244 / 255, 1, 0.55], 2);
      circle(hx, hy, s.boostOn ? 6 : 5, head);
    }
  }

  // Particles (additive). The title hero has none; it fades into the page instead.
  if (hero) { heroMask(w, h); return; }
  stepParticles(dt, state);
  for (const p of particles) {
    const step = Math.min(3, Math.floor((p.life / p.max) * 4));
    const a = (step + 0.5) / 4;
    circle(X(p.x), Y(p.y), p.size * u * (0.6 + 0.4 * a), withA(p.color, p.color[3] * a), "add");
  }
}

// ------------------------------------------------------------------ the title hero (render.js renderHero)
const heroMotes = Array.from({ length: 34 }, (_, i) => {
  const a = hash01(i * 11 + 3) * Math.PI * 2;
  const r = 4200 + hash01(i * 11 + 4) * 6800;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r, bloom: i % 9 === 0 };
});
function heroSerpent(id: string, isBot: boolean, hue: number, t: number, phase: number, radius: number, len: number): Serpent {
  const trail: { x: number; y: number }[] = [];
  for (let i = 0; i < len; i++) {
    const a = t * 0.45 + phase - i * 0.028;
    const r = radius + Math.sin(a * 3 + phase) * 900;
    trail.push({ x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r) });
  }
  return { id, name: id, isBot, hue, alive: true, boostOn: false, x: trail[0]!.x, y: trail[0]!.y, heading: 0, targetHeading: 0, trail, boostTicksUsed: 0, mass: 0, score: { motes: 0, eliminations: 0 } };
}
/** The title's small looping vignette of the ring; it moves only with an animated backdrop and motion allowed. */
export function drawHero(rect: Rect, frameScale: number, theme: Theme, time: number): void {
  const moving = G.effects && animated();
  const t = moving ? time : 2.4;
  const state = {
    tick: 0, phase: "active", terminal: null,
    arena: { outer: 12000, inner: 3000, thorns: [] },
    ruleset: { serpent: { bodyRadius: 260 } },
    motes: heroMotes,
    serpents: [
      heroSerpent("hero-rival", true, theme.serpentHues?.[4] ?? 35, t, 2.6, 8200, 70),
      heroSerpent("hero", false, 0, t, 0, 7000, 90),
    ],
  } as unknown as State;
  drawField("hero", rect, frameScale, state, theme, time, 0, true);
}
