// js/platform.js over the shipped StarHermit SDK with a stubbed fetch and launch fragment:
// token read, profile nickname, cloud save round trip on `game:<slug>`, settings KV,
// control bindings, and no network traffic standalone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SDK = (() => {
  const m = { exports: {} };
  new Function('module', 'exports', readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8'))(m, m.exports);
  return m.exports;
})();

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64u({ alg: 'none' })}.${b64u({ sub: 'u-1234567890', game_scope: 'serpent-ring', exp: 9999999999 })}.sig`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timers = { setTimeout: (fn, ms) => (ms > 5000 ? 0 : setTimeout(fn, ms)), clearTimeout: (t) => t && clearTimeout(t) };

function stubNet() {
  const calls = [];
  const store = { save: null, patches: [] };
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url, auth: init.headers && init.headers.Authorization });
    const json = (code, body) => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } });
    if (url === '/api/v1/users/u-1234567890/profile') return json(200, { nickname: 'Ring Rui' });
    if (url === '/api/v1/me/cloud-saves/game%3Aserpent-ring') {
      if (method === 'GET') return store.save ? new Response(store.save, { status: 200 }) : json(404, {});
      if (method === 'PUT') { store.save = Buffer.from(JSON.parse(init.body).dataBase64, 'base64'); return json(200, {}); }
    }
    if (url === '/api/v1/games/serpent-ring/settings') {
      if (method === 'GET') return json(200, { settings: { graphics: { preset: 'low' }, audio: { music: 20, sfx: 80 } } });
      if (method === 'PATCH') { store.patches.push(JSON.parse(init.body).settings); return json(200, {}); }
    }
    if (url === '/api/v1/games/serpent-ring/controls') return json(200, { actions: [{ action: 'boost', codes: ['ShiftLeft'] }] });
    return json(404, {});
  };
  return { calls, store, fetch };
}
function storage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
let n = 0;
async function load(hash, hostname, net) {
  const loc = { hash, pathname: '/', search: '', hostname, href: `https://${hostname}/${hash}`, origin: `https://${hostname}` };
  const win = { location: loc, history: { state: null, replaceState(_s, _t, url) { loc.hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''; } } };
  globalThis.window = { StarHermit: SDK.create({ window: win, fetch: net.fetch, ...timers }), addEventListener() {} };
  globalThis.document = { addEventListener() {}, hidden: false, querySelector: () => null };
  globalThis.localStorage = storage();
  const P = await import(`../js/platform.js?i=${n++}`);
  P.init();
  return { P, loc };
}

test('hosted: token, nickname, cloud save, settings KV, bindings', async () => {
  const net = stubNet();
  const { P, loc } = await load(`#game_token=${TOKEN}`, 'localhost', net);
  assert.equal(P.isHosted(), true);
  assert.equal(loc.hash, '');
  await P.loadSave();
  await sleep(20);
  assert.equal(P.nickname(), 'Ring Rui');

  P.recordResult({ id: 'practice-easy' }, { goalMet: true, total: 120, peakTrail: 30 });
  globalThis.window.StarHermit.flushSave();
  await sleep(20);
  assert.ok(net.calls.some((c) => c.method === 'PUT' && c.url === '/api/v1/me/cloud-saves/game%3Aserpent-ring'));
  const again = await load(`#game_token=${TOKEN}`, 'localhost', net);
  const doc = await again.P.loadSave();
  assert.deepEqual(doc.records['practice-easy'], { plays: 1, wins: 1, best: 120, bestPeak: 30 }, 'remote-first round trip');

  assert.deepEqual(await P.loadSettings(), { graphics: { preset: 'low' }, audio: { music: 20, sfx: 80 } });
  P.mirrorSettings({ audio: { music: 50, sfx: 80 } });
  P.mirrorSettings({ graphics: { preset: 'low' } });
  await sleep(700);
  assert.deepEqual(net.store.patches, [{ audio: { music: 50, sfx: 80 } }]);

  await P.loadBindings();
  assert.equal(P.actionFor('ShiftLeft'), 'boost');
  assert.equal(P.actionFor('Space'), null);
  assert.equal(P.actionFor('KeyA'), 'steer_left');
  assert.ok(net.calls.every((c) => c.auth === `Bearer ${TOKEN}`));
  assert.ok(P.inviteLink().endsWith('/game-invite/u-1234567890/serpent-ring'));
});

test('standalone: no network; sign-in only on the platform host', async () => {
  const net = stubNet();
  const { P } = await load('', 'serpent-ring.starhermit.com', net);
  assert.equal(P.isHosted(), false);
  assert.equal(P.canSignIn(), true);
  await P.loadSave();
  P.recordResult({ id: 'x' }, { goalMet: false, total: 5 });
  assert.deepEqual(await P.loadSettings(), {});
  P.mirrorSettings({ audio: { music: 1 } });
  await P.loadBindings();
  assert.equal(P.actionFor('Space'), 'boost');
  assert.equal(P.inviteLink(), null);
  await sleep(700);
  assert.deepEqual(net.calls, []);
  const local = await load('', 'localhost', stubNet());
  assert.equal(local.P.canSignIn(), false);
});
