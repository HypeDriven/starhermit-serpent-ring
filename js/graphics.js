/**
 * Serpent Ring — Graphics settings: persistence, GPU detection, the Graphics
 * panel (title menu and pause menu), adaptive resolution and the frame-rate
 * readout. The quality model itself lives in gfx.js; drawing in render.js.
 */
import * as gfx from './gfx.js';
import { setGraphics, effectsFailed } from './render.js';

const KEY = 'serpent-ring:graphics:v1';
const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------------ *
 *  Localized strings (the rest of the game is English-only)
 * ------------------------------------------------------------------ */

const L = {
  'en-US': {
    open: 'Graphics', title: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {tier})',
    low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra',
    scale: 'Render scale', fromPreset: 'From preset ({tier})',
    cat_glow: 'Glow', cat_shadows: 'Shadows', cat_grade: 'Color grade', cat_particles: 'Particles',
    cat_background: 'Background', cat_detail: 'Detail',
    t_off: 'Off', t_on: 'On', t_high: 'High', t_low: 'Low', t_static: 'Static', t_animated: 'Animated',
    t_plain: 'Plain', t_detailed: 'Detailed',
    adaptive: 'Adaptive resolution', fps: 'Show frame rate', back: 'Back',
    note: 'Visual effects could not be drawn on this device; the plain view is shown instead.',
    unknownGpu: 'Unknown GPU',
    s_plain: 'plain drawing', s_glow: 'glow', s_glowHigh: 'full glow', s_shadows: 'shadows',
    s_grade: 'color grade', s_particles: '{n} particles', s_animated: 'animated backdrop', s_detailed: 'detailed',
  },
  'en-GB': {
    cat_grade: 'Colour grade', s_grade: 'colour grade',
  },
  'es-419': {
    open: 'Gráficos', title: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})',
    low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
    scale: 'Escala de render', fromPreset: 'Del ajuste ({tier})',
    cat_glow: 'Resplandor', cat_shadows: 'Sombras', cat_grade: 'Gradación de color', cat_particles: 'Partículas',
    cat_background: 'Fondo', cat_detail: 'Detalle',
    t_off: 'No', t_on: 'Sí', t_high: 'Alto', t_low: 'Bajo', t_static: 'Estático', t_animated: 'Animado',
    t_plain: 'Simple', t_detailed: 'Detallado',
    adaptive: 'Resolución adaptable', fps: 'Mostrar cuadros por segundo', back: 'Volver',
    note: 'No se pudieron dibujar los efectos visuales en este dispositivo; se muestra la vista simple.',
    unknownGpu: 'GPU desconocida',
    s_plain: 'dibujo simple', s_glow: 'resplandor', s_glowHigh: 'resplandor completo', s_shadows: 'sombras',
    s_grade: 'gradación de color', s_particles: '{n} partículas', s_animated: 'fondo animado', s_detailed: 'detallado',
  },
  'es-ES': {
    scale: 'Escala de renderizado', fps: 'Mostrar fotogramas por segundo',
    note: 'No se han podido dibujar los efectos visuales en este dispositivo; se muestra la vista simple.',
  },
  'de-DE': {
    open: 'Grafik', title: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})',
    low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra',
    scale: 'Renderskalierung', fromPreset: 'Voreinstellung ({tier})',
    cat_glow: 'Leuchten', cat_shadows: 'Schatten', cat_grade: 'Farbkorrektur', cat_particles: 'Partikel',
    cat_background: 'Hintergrund', cat_detail: 'Details',
    t_off: 'Aus', t_on: 'An', t_high: 'Hoch', t_low: 'Niedrig', t_static: 'Statisch', t_animated: 'Animiert',
    t_plain: 'Schlicht', t_detailed: 'Detailliert',
    adaptive: 'Adaptive Auflösung', fps: 'Bildrate anzeigen', back: 'Zurück',
    note: 'Visuelle Effekte konnten auf diesem Gerät nicht gezeichnet werden; die schlichte Ansicht wird gezeigt.',
    unknownGpu: 'Unbekannte GPU',
    s_plain: 'schlichte Darstellung', s_glow: 'Leuchten', s_glowHigh: 'volles Leuchten', s_shadows: 'Schatten',
    s_grade: 'Farbkorrektur', s_particles: '{n} Partikel', s_animated: 'animierter Hintergrund', s_detailed: 'detailliert',
  },
  'fr-FR': {
    open: 'Graphismes', title: 'Graphismes', quality: 'Qualité', auto: 'Auto (détectée : {tier})',
    low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra',
    scale: 'Échelle de rendu', fromPreset: 'Préréglage ({tier})',
    cat_glow: 'Lueur', cat_shadows: 'Ombres', cat_grade: 'Étalonnage', cat_particles: 'Particules',
    cat_background: 'Arrière-plan', cat_detail: 'Détails',
    t_off: 'Non', t_on: 'Oui', t_high: 'Élevé', t_low: 'Faible', t_static: 'Statique', t_animated: 'Animé',
    t_plain: 'Simple', t_detailed: 'Détaillé',
    adaptive: 'Résolution adaptative', fps: 'Afficher les images par seconde', back: 'Retour',
    note: 'Les effets visuels n’ont pas pu être dessinés sur cet appareil ; la vue simple est affichée.',
    unknownGpu: 'GPU inconnu',
    s_plain: 'rendu simple', s_glow: 'lueur', s_glowHigh: 'lueur complète', s_shadows: 'ombres',
    s_grade: 'étalonnage', s_particles: '{n} particules', s_animated: 'arrière-plan animé', s_detailed: 'détaillé',
  },
  'fr-CA': {
    cat_background: 'Arrière-plan', fps: 'Afficher la fréquence d’images',
  },
  'pt-BR': {
    open: 'Gráficos', title: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {tier})',
    low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
    scale: 'Escala de renderização', fromPreset: 'Predefinição ({tier})',
    cat_glow: 'Brilho', cat_shadows: 'Sombras', cat_grade: 'Correção de cor', cat_particles: 'Partículas',
    cat_background: 'Fundo', cat_detail: 'Detalhes',
    t_off: 'Desligado', t_on: 'Ligado', t_high: 'Alto', t_low: 'Baixo', t_static: 'Estático', t_animated: 'Animado',
    t_plain: 'Simples', t_detailed: 'Detalhado',
    adaptive: 'Resolução adaptável', fps: 'Mostrar taxa de quadros', back: 'Voltar',
    note: 'Não foi possível desenhar os efeitos visuais neste dispositivo; a visão simples é exibida.',
    unknownGpu: 'GPU desconhecida',
    s_plain: 'desenho simples', s_glow: 'brilho', s_glowHigh: 'brilho total', s_shadows: 'sombras',
    s_grade: 'correção de cor', s_particles: '{n} partículas', s_animated: 'fundo animado', s_detailed: 'detalhado',
  },
  'it-IT': {
    open: 'Grafica', title: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})',
    low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra',
    scale: 'Scala di rendering', fromPreset: 'Dal preset ({tier})',
    cat_glow: 'Bagliore', cat_shadows: 'Ombre', cat_grade: 'Correzione colore', cat_particles: 'Particelle',
    cat_background: 'Sfondo', cat_detail: 'Dettaglio',
    t_off: 'No', t_on: 'Sì', t_high: 'Alto', t_low: 'Basso', t_static: 'Statico', t_animated: 'Animato',
    t_plain: 'Semplice', t_detailed: 'Dettagliato',
    adaptive: 'Risoluzione adattiva', fps: 'Mostra frame rate', back: 'Indietro',
    note: 'Non è stato possibile disegnare gli effetti visivi su questo dispositivo; viene mostrata la vista semplice.',
    unknownGpu: 'GPU sconosciuta',
    s_plain: 'disegno semplice', s_glow: 'bagliore', s_glowHigh: 'bagliore pieno', s_shadows: 'ombre',
    s_grade: 'correzione colore', s_particles: '{n} particelle', s_animated: 'sfondo animato', s_detailed: 'dettagliato',
  },
};
const PARENT = { 'en-GB': 'en-US', 'es-ES': 'es-419', 'fr-CA': 'fr-FR' };
const BY_LANG = { en: 'en-US', es: 'es-419', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT' };

/** Pick the best supported locale for a list of browser languages. */
export function pickLocale(langs) {
  for (const raw of langs || []) {
    const tag = String(raw || '');
    const exact = Object.keys(L).find((k) => k.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const lang = tag.slice(0, 2).toLowerCase();
    if (lang === 'en' && /-(gb|uk|ie|au|nz)$/i.test(tag)) return 'en-GB';
    if (lang === 'es' && /-es$/i.test(tag)) return 'es-ES';
    if (lang === 'fr' && /-ca$/i.test(tag)) return 'fr-CA';
    if (BY_LANG[lang]) return BY_LANG[lang];
  }
  return 'en-US';
}

export function strings(locale) {
  return Object.assign({}, L['en-US'], L[PARENT[locale]] || {}, L[locale] || {});
}

const S = strings(pickLocale(typeof navigator !== 'undefined' ? (navigator.languages || [navigator.language]) : []));
const fmt = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ''));

/* ------------------------------------------------------------------ *
 *  State
 * ------------------------------------------------------------------ */

let saved = {};
let gpu = '';
let detected = 'balanced';
let resolved = gfx.resolve({}, 'balanced');
let adaptiveScale = 1;
const listeners = [];

function load() {
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* storage blocked: session only */ }
}

function detectGpu() {
  let name = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return { name: '', preset: 'low' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch { /* no WebGL: treat as a weak device */ return { name: '', preset: 'low' }; }
  const mobile = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
    || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '');
  return { name, preset: gfx.detectPreset(name, { mobile }) };
}

/** Canvas backing-store pixels per CSS pixel for the current settings. */
export function pixelRatio() {
  return gfx.pixelRatio(resolved, window.devicePixelRatio || 1, adaptiveScale);
}

export function onChange(fn) { listeners.push(fn); }

function apply() {
  resolved = gfx.resolve(saved, detected);
  if (!resolved.adaptive) adaptiveScale = 1;
  setGraphics(resolved);
  document.body.dataset.gfxPreset = resolved.preset;
  document.body.dataset.gfxAuto = resolved.auto ? 'true' : 'false';
  const fpsEl = $('#sr-fps');
  if (fpsEl) fpsEl.hidden = !resolved.showFps;
  for (const fn of listeners) fn(resolved);
  syncPanel();
}

/* ------------------------------------------------------------------ *
 *  Adaptive resolution + frame-rate readout (fed by the game loop)
 * ------------------------------------------------------------------ */

let lastT = 0, acc = 0, count = 0, fpsAcc = 0, fpsN = 0, fpsShown = 0;

/** Call once per rendered gameplay frame. */
export function frameTick(now) {
  const dt = lastT ? now - lastT : 0;
  lastT = now;
  if (!dt || dt > 250) return; // first frame or resumed after a gap
  if (resolved.showFps) {
    fpsAcc += dt; fpsN++;
    if (now - fpsShown > 500) {
      const el = $('#sr-fps');
      if (el) el.textContent = `${Math.round(1000 / (fpsAcc / fpsN))} fps`;
      fpsShown = now; fpsAcc = 0; fpsN = 0;
    }
  }
  if (!resolved.adaptive) return;
  acc += dt; count++;
  if (count < 90) return;
  const avg = acc / count;
  acc = 0; count = 0;
  let next = adaptiveScale;
  if (avg > 26) next = Math.max(0.6, adaptiveScale - 0.1);
  else if (avg < 14) next = Math.min(1, adaptiveScale + 0.05);
  next = Math.round(next * 100) / 100;
  if (next !== adaptiveScale) {
    adaptiveScale = next;
    for (const fn of listeners) fn(resolved);
    syncPanel();
  }
}

/** Forget frame timing (pause, leave, new round). */
export function resetTiming() { lastT = 0; acc = 0; count = 0; }

/* ------------------------------------------------------------------ *
 *  Panel
 * ------------------------------------------------------------------ */

const tierName = (tier) => S['t_' + tier] || tier;
const presetName = (p) => S[p] || p;

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids) if (k) e.append(k);
  return e;
}

function row(labelText, control, id) {
  return el('div', { class: 'sr-gfx-row' }, el('label', { for: id, text: labelText }), control);
}

function buildPanel() {
  const host = $('#gfx-panel');
  if (!host || host.childElementCount) return;
  const preset = el('select', { id: 'gfx-preset', 'data-gfx': 'preset' });
  for (const p of ['auto', ...gfx.PRESETS]) preset.append(el('option', { value: p }));
  preset.addEventListener('change', () => {
    saved = gfx.choosePreset(saved, preset.value);
    persist(); apply();
  });
  host.append(row(S.quality, preset, 'gfx-preset'));

  const scale = el('input', { id: 'gfx-scale', type: 'range', min: '50', max: '200', step: '10', 'data-gfx': 'render_scale' });
  const scaleOut = el('output', { id: 'gfx-scale-value', for: 'gfx-scale' });
  scale.addEventListener('input', () => {
    saved.render_scale = Number(scale.value) / 100;
    persist(); apply();
  });
  host.append(row(S.scale, el('span', { class: 'sr-gfx-range' }, scale, scaleOut), 'gfx-scale'));

  for (const [cat, tiers] of Object.entries(gfx.CATEGORIES)) {
    const sel = el('select', { id: 'gfx-' + cat, 'data-gfx': cat });
    sel.append(el('option', { value: 'preset' }));
    for (const t of tiers) sel.append(el('option', { value: t, text: tierName(t) }));
    sel.addEventListener('change', () => {
      if (sel.value === 'preset') delete saved[cat]; else saved[cat] = sel.value;
      persist(); apply();
    });
    host.append(row(S['cat_' + cat], sel, 'gfx-' + cat));
  }

  for (const [id, key, label, def] of [['gfx-adaptive', 'adaptive', S.adaptive, true], ['gfx-showfps', 'show_fps', S.fps, false]]) {
    const cb = el('input', { id, type: 'checkbox', 'data-gfx': key });
    cb.addEventListener('change', () => {
      if (cb.checked === def) delete saved[key]; else saved[key] = cb.checked;
      persist(); apply();
    });
    host.append(el('div', { class: 'sr-gfx-row sr-gfx-check' }, cb, el('label', { for: id, text: label })));
  }

  host.append(el('p', { id: 'gfx-summary', class: 'sr-gfx-summary', 'aria-live': 'polite' }));
  host.append(el('p', { id: 'gfx-note', class: 'sr-gfx-note', hidden: '' }));
}

function playfieldPixels() {
  const c = $('#game-canvas');
  if (c && c.clientWidth > 0) return [c.width, c.height];
  const side = Math.max(1, Math.min(720, window.innerWidth - 32, window.innerHeight * 0.68));
  const px = Math.round(side * pixelRatio());
  return [px, px];
}

function syncPanel() {
  const host = $('#gfx-panel');
  if (!host || !host.childElementCount) return;
  const preset = $('#gfx-preset');
  for (const o of preset.options) {
    o.textContent = o.value === 'auto' ? fmt(S.auto, { tier: presetName(detected) }) : presetName(o.value);
  }
  preset.value = resolved.auto ? 'auto' : resolved.preset;
  const scale = $('#gfx-scale');
  scale.value = String(Math.round(resolved.userScale * 100));
  $('#gfx-scale-value').textContent = `${Math.round(resolved.userScale * 100)}%`;
  for (const cat of Object.keys(gfx.CATEGORIES)) {
    const sel = $('#gfx-' + cat);
    sel.options[0].textContent = fmt(S.fromPreset, { tier: tierName(gfx.presetTier(resolved.preset, cat)) });
    sel.value = gfx.CATEGORIES[cat].includes(saved[cat]) ? saved[cat] : 'preset';
  }
  $('#gfx-adaptive').checked = resolved.adaptive;
  $('#gfx-showfps').checked = resolved.showFps;
  const cost = gfx.describe(resolved, playfieldPixels(), (k) => S['s_' + k]);
  $('#gfx-summary').textContent = `${gpu || S.unknownGpu} · ${cost}`;
  const note = $('#gfx-note');
  note.hidden = !effectsFailed();
  note.textContent = S.note;
}

/* ------------------------------------------------------------------ *
 *  Open / close
 * ------------------------------------------------------------------ */

let origin = 'title';
let opener = null;

function showScreen(name) {
  for (const sec of document.querySelectorAll('#sr-main [data-sr-screen]')) {
    sec.hidden = sec.getAttribute('data-sr-screen') !== name;
  }
}

export function isOpen() {
  const sec = $('[data-sr-screen="graphics"]');
  return !!sec && !sec.hidden;
}

function open(from, btn) {
  origin = from;
  opener = btn;
  syncPanel();
  showScreen('graphics');
  $('#gfx-preset')?.focus();
}

function close() {
  showScreen(origin);
  if (opener && opener.focus) opener.focus();
}

export function initGraphics() {
  load();
  const d = detectGpu();
  gpu = d.name;
  detected = d.preset;
  buildPanel();
  for (const [sel, key] of [['#btn-gfx-open', 'open'], ['#btn-pause-gfx', 'open'], ['#btn-gfx-close', 'back'], ['#gfx-title', 'title']]) {
    const e = $(sel);
    if (e) e.textContent = S[key];
  }
  $('#btn-gfx-open')?.addEventListener('click', (e) => open('title', e.currentTarget));
  $('#btn-pause-gfx')?.addEventListener('click', (e) => open('pause', e.currentTarget));
  $('#btn-gfx-close')?.addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && isOpen()) { close(); e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('resize', syncPanel);
  apply();
}
