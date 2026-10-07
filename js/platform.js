/**
 * Serpent Ring — StarHermit platform adapter over the canonical SDK
 * (starhermit-sdk.js, loaded as a classic script before the modules;
 * window.StarHermit).
 *
 * Hosted mode is active while the SDK holds a launch token (read from the
 * fragment — `#game_token=` or the sign-in return `#access_token=` —
 * stripped, kept in memory and renewed by the SDK); everything else runs
 * fully local with no network calls. The adapter owns: the account
 * nickname, the one-slot cloud save (`game:<slug>`; localStorage stays the
 * offline cache), the per-player settings KV, keyboard bindings from the
 * controls API, sign-in and the invite link. No WebSocket use — the shipped
 * client is a solo game.
 */

const LOCAL_KEY = 'serpent-ring:save:v1';
const SAVE_DEBOUNCE_MS = 2000;

const SH = () => (typeof window !== 'undefined' && window.StarHermit) || globalThis.StarHermit || null;

const state = {
  hosted: false,
  nickname: null,
  sync: 'offline', // offline | saving | synced
};

let doc = { version: 1, records: {} };
let authCb = null;
let sentSettings = {};
let settingsTimer = null;

/** Keyboard actions (KeyboardEvent.code); mirrored by control.* in starhermit.txt. */
export const DEFAULT_BINDINGS = {
  steer_left: ['ArrowLeft', 'KeyA'],
  steer_right: ['ArrowRight', 'KeyD'],
  boost: ['Space', 'ArrowUp', 'KeyW'],
  undo: ['KeyU'],
  pause: ['Escape', 'KeyP'],
};
let bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));

/* ------------------------------------------------------------------ *
 *  Profile nickname (SDK: nickname, "Player <id>" fallback)
 * ------------------------------------------------------------------ */

async function loadProfile() {
  if (!state.hosted) return;
  const p = await SH().profile().catch(() => null);
  state.nickname = p ? p.displayName : 'Player ' + String(SH().userId).slice(0, 8);
  renderProfile();
}

/* ------------------------------------------------------------------ *
 *  Cloud save: the SDK slot (game:<slug>), remote-preferred load,
 *  localStorage is the offline cache. Debounced writes, pagehide flush.
 * ------------------------------------------------------------------ */

function readLocalDoc() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    if (parsed && parsed.version === 1 && parsed.records && typeof parsed.records === 'object') {
      return parsed;
    }
  } catch {
    // corrupt cache: start fresh
  }
  return { version: 1, records: {} };
}

function writeLocalDoc() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(doc));
  } catch {
    // storage unavailable: cloud mirror still works when hosted
  }
}

async function loadDoc() {
  doc = readLocalDoc();
  if (!state.hosted) return doc;
  const remote = await SH().loadJSON();
  if (remote && remote.version === 1 && remote.records && typeof remote.records === 'object') {
    doc = remote; // remote wins on conflict
    writeLocalDoc();
  } else if (Object.keys(doc.records).length) {
    SH().saveJSON(doc, 0); // empty slot: seed it from the local copy
  }
  setSync('synced');
  return doc;
}

function scheduleSave() {
  writeLocalDoc();
  if (!state.hosted) { setSync('offline'); return; }
  setSync('saving');
  SH().saveJSON(doc, SAVE_DEBOUNCE_MS);
}

function flushSave() {
  if (state.hosted) SH().flushSave(true);
}

/* ------------------------------------------------------------------ *
 *  Status + profile chip rendering
 * ------------------------------------------------------------------ */

function setSync(sync) {
  state.sync = sync;
  renderSync();
}

function renderProfile() {
  const el = typeof document !== 'undefined' && document.querySelector('[data-sr-live="player"]');
  if (el) el.textContent = state.hosted ? state.nickname || '' : '';
}

function renderSync() {
  const el = typeof document !== 'undefined' && document.querySelector('[data-sr-live="sync"]');
  if (!el) return;
  el.textContent = state.sync === 'synced' ? 'synced' : state.sync === 'saving' ? 'saving…' : 'offline';
  el.setAttribute('data-sync', state.sync);
}

/* ------------------------------------------------------------------ *
 *  Public API
 * ------------------------------------------------------------------ */

/** Read the launch token (SDK) once; hosted mode iff a token is held. */
export function init() {
  const sh = SH();
  if (sh) {
    sh.init();
    state.hosted = sh.signedIn;
    sh.on('saved', (ok) => setSync(ok ? 'synced' : 'offline'));
    sh.on('auth', (a) => {
      state.hosted = !!a.signedIn;
      if (!a.signedIn) { state.nickname = null; setSync('offline'); renderProfile(); }
      if (authCb) authCb(state.hosted);
    });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushSave);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
  }
  setSync(state.hosted ? 'saving' : 'offline');
  renderProfile();
  return state.hosted;
}

export function isHosted() { return state.hosted; }

/** Post a finished ranked round to the `high-score` board through the game's
 *  score-script.js (StarHermit.submitScores) → { posted, rank }. */
export async function submitScore(total) {
  if (!state.hosted) return { posted: false, rank: null };
  const sh = SH();
  const keys = await sh.submitScores({ 'high-score': total });
  if (!keys || !keys.includes('high-score')) return { posted: false, rank: null };
  try {
    const r = await sh.leaderboard('high-score', { pageSize: 100 });
    const me = (r.items || []).find((i) => i.userId === sh.userId);
    return { posted: true, rank: me ? me.rank : null };
  } catch { return { posted: true, rank: null }; }
}
export function nickname() { return state.nickname; }
export function canSignIn() { const sh = SH(); return !!(sh && sh.canSignIn()); }
export function signIn() { const sh = SH(); return !!(sh && sh.signIn()); }
export function inviteLink() { return state.hosted ? SH().inviteLink() : null; }
/** cb(signedIn) when the session signs in/out (renewal refused). */
export function onAuth(cb) { authCb = cb; }

/** Load the save doc: cloud when hosted (remote wins), else local cache. */
export function loadSave() {
  if (state.hosted && !state.nickname) loadProfile();
  return loadDoc();
}

/**
 * Fold a finished round into the local records and mirror the doc to the
 * cloud slot (debounced). Returns the record for this level, if any.
 */
export function recordResult(item, res) {
  const id = item && item.id;
  if (!id || !res) return null;
  const rec = doc.records[id] || { plays: 0, wins: 0, best: 0, bestPeak: 0 };
  rec.plays += 1;
  if (res.goalMet) rec.wins += 1;
  rec.best = Math.max(rec.best, res.total || 0);
  rec.bestPeak = Math.max(rec.bestPeak, res.peakTrail || 0);
  doc.records[id] = rec;
  scheduleSave();
  return rec;
}

export function records() { return doc.records; }

/* ------------------------------------------------------------------ *
 *  Per-player settings KV ({ graphics, audio }): platform wins at start
 * ------------------------------------------------------------------ */

/** Platform settings (empty standalone, no call). */
export async function loadSettings() {
  if (!state.hosted) return {};
  const remote = await SH().getSettings().catch(() => ({}));
  const out = {};
  for (const k of ['graphics', 'audio']) if (remote && remote[k] && typeof remote[k] === 'object') out[k] = remote[k];
  sentSettings = JSON.parse(JSON.stringify(out));
  return out;
}

/** Patch changed settings groups (debounced; no-op standalone). */
export function mirrorSettings(groups) {
  if (!state.hosted) return;
  Object.assign(pendingSettings, groups);
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    const diff = {};
    for (const [k, v] of Object.entries(pendingSettings)) if (JSON.stringify(v) !== JSON.stringify(sentSettings[k])) diff[k] = v;
    if (!Object.keys(diff).length) return;
    Object.assign(sentSettings, JSON.parse(JSON.stringify(diff)));
    SH().patchSettings(diff);
  }, 600);
}
const pendingSettings = {};

/* ------------------------------------------------------------------ *
 *  Controls: platform overrides of the declared keyboard actions
 * ------------------------------------------------------------------ */

export async function loadBindings() {
  const sh = SH();
  if (sh) bindings = await sh.loadBindings(DEFAULT_BINDINGS).catch(() => bindings);
  return bindings;
}
export function getBindings() { return bindings; }
export function actionFor(code) {
  for (const [a, codes] of Object.entries(bindings)) if (codes.includes(code)) return a;
  return null;
}
