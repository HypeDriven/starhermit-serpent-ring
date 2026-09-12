/**
 * Serpent Ring — StarHermit platform adapter.
 *
 * Hosted mode activates only when a launch token is present in the URL
 * fragment (`#game_token=<jwt>`); everything else runs fully local. The
 * adapter owns: token read/decode/refresh, the account nickname, and the
 * one-slot cloud save (localStorage stays the offline cache). No WebSocket
 * use — the shipped client is a solo game.
 */

const LOCAL_KEY = 'serpent-ring:save:v1';
const SAVE_NAME = 'save.json';
const SAVE_DEBOUNCE_MS = 2000;
const REFRESH_MS = 45 * 60 * 1000;
const REFRESH_RETRY_MS = 60 * 1000;

const state = {
  token: null,     // raw JWT, in memory only (never persisted)
  sub: null,       // user id from the JWT payload
  slug: null,      // game scope from the JWT payload
  hosted: false,
  nickname: null,
  sync: 'offline', // offline | saving | synced
};

let doc = { version: 1, records: {} };
let saveTimer = null;
let dirty = false;
let refreshTimer = null;

/* ------------------------------------------------------------------ *
 *  Stored-zip helper (single stored entry, no compression, CRC32)
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const local = out.length;
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
function unzipFirstEntry(zipBytes) {
  // Stored single-entry reader: scan local headers for compression 0.
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

/* ------------------------------------------------------------------ *
 *  Launch token: fragment read once + strip, sub/game_scope decode
 * ------------------------------------------------------------------ */

function readLaunchToken() {
  // The platform delivers the token in the URL fragment; query params are
  // a local-dev fallback only. Read once, then strip it from the URL.
  let token = null;
  if (typeof location !== 'undefined' && location.hash) {
    const frag = new URLSearchParams(location.hash.slice(1));
    token = frag.get('game_token');
    if (frag.has('game_token') || frag.has('session_id')) {
      frag.delete('game_token');
      frag.delete('session_id');
      const rest = frag.toString();
      const url = location.pathname + location.search + (rest ? '#' + rest : '');
      history.replaceState(null, '', url);
    }
  }
  if (!token && typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search);
    token = q.get('token') || q.get('launch') || q.get('launch_token') || q.get('game_token');
  }
  return token;
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
  } catch {
    return null;
  }
}

function authHeaders(extra) {
  return Object.assign({ Authorization: 'Bearer ' + state.token }, extra || {});
}

function cloudSaveUrl() {
  return '/api/v1/me/cloud-saves/' + encodeURIComponent(state.slug);
}

/* ------------------------------------------------------------------ *
 *  Token refresh: re-mint a scoped token before the 60-min lifetime
 * ------------------------------------------------------------------ */

function scheduleRefresh(delay) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshToken, delay);
}

async function refreshToken() {
  if (!state.hosted) return;
  try {
    const res = await fetch('/api/v1/games/' + encodeURIComponent(state.slug) + '/launch-token', {
      method: 'POST',
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error('launch-token refresh HTTP ' + res.status);
    const data = await res.json().catch(() => ({}));
    if (!data.token) throw new Error('launch-token refresh returned no token');
    state.token = data.token;
    scheduleRefresh(REFRESH_MS);
  } catch {
    scheduleRefresh(REFRESH_RETRY_MS);
  }
}

/* ------------------------------------------------------------------ *
 *  Profile nickname (NEVER /api/v1/me, never usernames)
 * ------------------------------------------------------------------ */

async function loadProfile() {
  if (!state.hosted) return;
  try {
    const res = await fetch('/api/v1/users/' + encodeURIComponent(state.sub) + '/profile', {
      headers: authHeaders(),
    });
    if (res.ok) {
      const p = await res.json().catch(() => ({}));
      const nick = typeof p.nickname === 'string' ? p.nickname.trim() : '';
      if (nick) state.nickname = nick;
    }
  } catch {
    // offline or private profile: use the fallback below
  }
  if (!state.nickname) state.nickname = 'Player ' + String(state.sub).slice(0, 8);
  renderProfile();
}

/* ------------------------------------------------------------------ *
 *  Cloud save: one slot, zip+base64, remote-preferred load, localStorage
 *  is the offline cache. Debounced writes, pagehide/visibility flush.
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
  try {
    const res = await fetch(cloudSaveUrl(), { headers: authHeaders() });
    if (res.status === 404) { setSync('synced'); return doc; }
    if (!res.ok) throw new Error('cloud load HTTP ' + res.status);
    const remote = JSON.parse(new TextDecoder().decode(unzipFirstEntry(new Uint8Array(await res.arrayBuffer()))));
    if (remote && remote.version === 1 && remote.records && typeof remote.records === 'object') {
      doc = remote; // remote wins on conflict
      writeLocalDoc();
    }
    setSync('synced');
  } catch {
    setSync('offline'); // local copy stays authoritative until the net returns
  }
  return doc;
}

function encodeDoc() {
  return { dataBase64: bytesToBase64(zipStore(SAVE_NAME, new TextEncoder().encode(JSON.stringify(doc)))) };
}

function scheduleSave() {
  writeLocalDoc();
  if (!state.hosted) { setSync('offline'); return; }
  dirty = true;
  setSync('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
}

async function flushSave(opts = {}) {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!dirty || !state.hosted) return;
  dirty = false;
  setSync('saving');
  try {
    const res = await fetch(cloudSaveUrl(), {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(encodeDoc()),
      keepalive: !!opts.keepalive,
    });
    if (!res.ok) throw new Error('cloud save HTTP ' + res.status);
    setSync('synced');
  } catch {
    dirty = true;
    setSync('offline');
    scheduleRefreshSave();
  }
}

function scheduleRefreshSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flushSave(), SAVE_DEBOUNCE_MS * 15);
}

function onPageHide() {
  if (!dirty || !state.hosted) return;
  // Best-effort final flush; the server accepts a re-PUT of the same doc.
  fetch(cloudSaveUrl(), {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(encodeDoc()),
    keepalive: true,
  }).catch(() => {});
  dirty = false;
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

/** Read the launch token once; hosted mode iff a usable token was found. */
export function init() {
  const token = readLaunchToken();
  const payload = token ? decodeJwtPayload(token) : null;
  if (payload && payload.sub && payload.game_scope) {
    state.token = token;
    state.sub = payload.sub;
    state.slug = payload.game_scope;
    state.hosted = true;
    scheduleRefresh(REFRESH_MS);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
  }
  setSync(state.hosted ? 'saving' : 'offline');
  renderProfile();
  return state.hosted;
}

export function isHosted() { return state.hosted; }
export function nickname() { return state.nickname; }

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

// Exported for the unit tests (zip round-trip validation).
export const __zip = { zipStore, unzipFirstEntry, bytesToBase64, base64ToBytes, crc32 };
