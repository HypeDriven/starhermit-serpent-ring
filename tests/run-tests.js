/**
 * Serpent Ring — test runner (node tests/run-tests.js / npm test).
 */
import { JOURNEY, CHALLENGES, LESSONS, validateAllContent, dailyContent } from '../js/content.js';
import {
  createGame, defaultRuleset, step, applyCommand, getLegalActions, hashState,
  makeResult, getResults, scoreBreakdown, seedFromString, cloneState, HEADING_MAX,
} from '../js/rules.js';
import { readFileSync } from 'node:fs';
// js/gpu-level.js is a classic script in the page (window.StarHermitGpu); evaluate it the same way here.
new Function('window', 'module', readFileSync(new URL('../js/gpu-level.js', import.meta.url), 'utf8'))(globalThis, undefined);
const gfx = await import('../js/gfx.js');
const { pickLocale, strings } = await import('../js/graphics.js');

let passed = 0;
let failed = 0;

function check(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log('ok   - ' + name);
  } catch (err) {
    failed++;
    console.error('FAIL - ' + name + ': ' + err.message);
  }
}

const game = (over = {}, seed = seedFromString('test')) =>
  createGame({ seed, ruleset: defaultRuleset(over), modeId: 'test' });

await t('journey has 40 stages', () => check(JOURNEY.length === 40));
await t('challenges present', () => check(CHALLENGES.length >= 6));
await t('lessons present', () => check(LESSONS.length === 5));

// Keep authored lesson checks and the Learn-mode tracker in main.js in step.
const LESSON_CHECKS = [
  'heading-turned', 'laps', 'ticks', 'motes', 'motes-after', 'length',
  'length-alive', 'bloom', 'boost-ticks', 'proximity', 'eliminate-or-survive',
];
await t('every lesson step uses a check the UI implements', () => {
  for (const l of LESSONS) {
    check(Array.isArray(l.steps) && l.steps.length > 0, l.id + ' has no steps');
    for (const s of l.steps) {
      check(LESSON_CHECKS.includes(s.check.type), `${l.id}/${s.id}: unknown check ${s.check.type}`);
      check(s.check.value > 0, `${l.id}/${s.id}: check without value`);
      check(typeof s.text === 'string' && s.text.length > 0, `${l.id}/${s.id}: no instruction text`);
    }
  }
});

await t('all content validates statically', () => {
  const bad = validateAllContent().filter((r) => !r.ok);
  check(bad.length === 0, JSON.stringify(bad));
  const daily = dailyContent();
  check(daily.ruleset.goals.length > 0, 'daily has no goal');
});

await t('simulation is deterministic for a seed', () => {
  const a = game({ bots: { count: 3 } });
  const b = game({ bots: { count: 3 } });
  for (let i = 0; i < 200; i++) { step(a); step(b); }
  check(hashState(a) === hashState(b), 'identical seeds diverged');
});

await t('serialization round-trips without changing the hash', () => {
  const a = game({ bots: { count: 2 } });
  for (let i = 0; i < 50; i++) step(a);
  check(hashState(cloneState(a)) === hashState(a), 'clone diverged');
});

await t('serpents grow by eating and the trail follows mass', () => {
  const s0 = game({ bots: { count: 0 } });
  const me = s0.serpents[0];
  const before = me.trail.length;
  for (let i = 0; i < 300; i++) step(s0);
  check(me.score.motes > 0, 'nothing was eaten in 10 s');
  check(me.trail.length > before, 'trail did not grow with mass');
});

await t('boost is illegal without mass and legal with it', () => {
  const s0 = game({ bots: { count: 0 } });
  const me = s0.serpents[0];
  check(!getLegalActions(s0, me.id).boost.valid, 'boost allowed at zero mass');
  const rejected = applyCommand(s0, { id: 'x1', serpent: me.id, type: 'boost', on: true });
  check(!rejected.ok && rejected.reason === 'insufficient-mass', 'wrong rejection reason');
  check(me.invalidActions === 1, 'invalid action not counted');
  me.mass = 100;
  check(getLegalActions(s0, me.id).boost.valid, 'boost still refused with mass');
  check(applyCommand(s0, { id: 'x2', serpent: me.id, type: 'boost', on: true }).ok);
  step(s0);
  check(me.boostOn, 'boost did not engage');
});

await t('malformed and out-of-range commands are rejected', () => {
  const s0 = game({ bots: { count: 0 } });
  const me = s0.serpents[0];
  check(!applyCommand(s0, { serpent: me.id, type: 'steer', heading: HEADING_MAX }).ok, 'heading bound not enforced');
  check(!applyCommand(s0, { serpent: me.id, type: 'steer', heading: NaN }).ok, 'NaN heading accepted');
  check(!applyCommand(s0, { serpent: 'nobody', type: 'steer', heading: 0 }).ok, 'unknown serpent accepted');
  check(!applyCommand(s0, { serpent: me.id, type: 'fly' }).ok, 'unknown command accepted');
  const dup = { id: 'dup', serpent: me.id, type: 'steer', heading: 100 };
  check(applyCommand(s0, dup).ok, 'first command rejected');
  check(!applyCommand(s0, dup).ok, 'duplicate id accepted');
});

await t('hitting the rim ends a solo round', () => {
  const s0 = game({ bots: { count: 0 } });
  const me = s0.serpents[0];
  me.invuln = 0;
  me.x = s0.arena.outer - 10;
  me.y = 0;
  step(s0);
  check(!me.alive, 'serpent survived the wall');
  check(s0.phase === 'terminal', 'round did not end');
  check(s0.terminal.reason === 'collision', 'unexpected reason ' + s0.terminal.reason);
});

await t('undo is legal only where the ruleset permits and rewinds state', () => {
  // Ranked-style ruleset: the query must refuse, and the command must agree.
  const s0 = game({ bots: { count: 0 }, allowUndo: false });
  const me = s0.serpents[0];
  check(!getLegalActions(s0, me.id).undo.valid, 'undo allowed without allowUndo');
  const refused = applyCommand(s0, { id: 'u0', serpent: me.id, type: 'undo' });
  check(!refused.ok && refused.reason === 'undo-not-permitted', 'wrong refusal reason');

  // Practice-style ruleset: undo rewinds position, mass and score.
  const s1 = game({ bots: { count: 0 }, allowUndo: true });
  const p1 = s1.serpents[0];
  for (let i = 0; i < 40; i++) step(s1);
  check(getLegalActions(s1, p1.id).undo.valid, 'undo refused in practice');
  const before = { x: p1.x, y: p1.y, motes: p1.score.motes, trail: p1.trail.length };
  for (let i = 0; i < 10; i++) step(s1);
  const accepted = applyCommand(s1, { id: 'u1', serpent: p1.id, type: 'undo' });
  check(accepted.ok, 'undo command rejected in practice');
  const events = step(s1);
  check(events.some((e) => e.type === 'undo' && e.serpent === p1.id), 'undo event not emitted');
  check(p1.x !== before.x || p1.y !== before.y, 'position did not change across rewind');
  check(p1.score.motes <= before.motes + 10, 'mote count rewound implausibly');
  check(p1.trail.length <= before.trail + 10, 'trail grew across rewind');
  check(p1.undoRing.length <= 1, 'undo ring not drained');
  check(p1.invalidActions === 0, 'undo counted as invalid');
});

await t('results expose a component breakdown that sums to the total', () => {
  const s0 = game({ bots: { count: 1 } });
  for (let i = 0; i < 120; i++) step(s0);
  const me = s0.serpents[0];
  const res = makeResult(s0, me, 'local');
  check(Array.isArray(res.breakdown), 'breakdown is not a list');
  check(res.breakdown.length === scoreBreakdown(s0.ruleset, me).length);
  const sum = res.breakdown.reduce((n, r) => n + r.amount, 0);
  check(sum === res.total, `breakdown ${sum} != total ${res.total}`);
  check(res.breakdown.every((r) => typeof r.label === 'string' && Number.isFinite(r.amount)),
    'breakdown rows are not label/amount pairs');
  const ranked = getResults(s0);
  check(ranked[0].placement === 1 && ranked.length === s0.serpents.length, 'ranking malformed');
});

// Cloud-save zipping lives in the StarHermit SDK; tests/platform.test.mjs covers the round trip.

// ---- Graphics quality model (js/gfx.js) ----
const DESK = { cores: 8, memoryGb: 8 };
const PHONE = { mobile: true, cores: 8, memoryGb: 8 };

await t('gfx: hardware level picks the Auto preset (Low 0, Balanced 4, High 10, Ultra 17)', () => {
  check(gfx.detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', DESK) === 'low', 'swiftshader');
  check(gfx.detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', DESK) === 0, 'llvmpipe level 0');
  check(gfx.detectPreset('', DESK) === 'low', 'no WebGL');
  check(gfx.detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK) === 'low', 'radeon igpu');
  check(gfx.detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK) === 'low', 'intel uhd');
  check(gfx.detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', DESK) === 'balanced', 'iris xe');
  check(gfx.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', DESK) === 'high', 'gtx 1070');
  check(gfx.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', DESK) === 'ultra', 'rtx 4080');
  check(gfx.detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK) === 20, 'rtx 5090 level');
  check(gfx.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK) === 'ultra', 'rtx 5090');
  for (const [p, lv] of Object.entries(gfx.LEVELS)) check(gfx.presetForLevel(lv) === p, `level ${lv}`);
  check(gfx.presetForLevel(3) === 'low' && gfx.presetForLevel(16) === 'high', 'between floors');
});

await t('gfx: phones and tablets are Balanced at most; software GPUs stay Low', () => {
  check(gfx.detectPreset('Adreno (TM) 740', PHONE) === 'balanced', 'adreno 740');
  check(gfx.detectLevel('Adreno (TM) 740', PHONE) <= 9, 'phone cap');
  check(gfx.detectPreset('Apple M2', PHONE) === 'balanced', 'apple tablet');
  check(gfx.detectPreset('SwiftShader', PHONE) === 'low', 'software phone');
});

await t('gfx: per-preset budgets are explicit, grow from Low to Ultra and scale with the level', () => {
  const keys = ['particles', 'spores', 'fronds', 'specks', 'samples', 'chunks', 'haloRings'];
  for (const p of gfx.PRESETS) for (const k of keys) check(Number.isFinite(gfx.BUDGETS[p][k]), `${p}.${k}`);
  for (let i = 1; i < gfx.PRESETS.length; i++) for (const k of keys) {
    check(gfx.BUDGETS[gfx.PRESETS[i]][k] >= gfx.BUDGETS[gfx.PRESETS[i - 1]][k], `${gfx.PRESETS[i]}.${k} grows`);
  }
  check(JSON.stringify(gfx.resolve({ preset: 'high' }, 'low', 10).budget) === JSON.stringify(gfx.BUDGETS.high), 'floor level = tuned budget');
  check(JSON.stringify(gfx.resolve({ preset: 'ultra' }, 'low', 0).budget) === JSON.stringify(gfx.resolve({ preset: 'ultra' }, 'ultra', 17).budget), 'below floor = floor');
  check(gfx.budgetFor('balanced', 9).spores > gfx.budgetFor('balanced', 4).spores, 'counts scale within the preset');
  check(gfx.budgetFor('balanced', 20).spores <= 2 * gfx.BUDGETS.balanced.spores, 'scale ≤ 2×');
  check(gfx.budgetFor('ultra', 20).particles <= gfx.PARTICLE_MAX && gfx.budgetFor('ultra', 20).spores <= gfx.SPORE_MAX, 'maxima');
  check(gfx.particleCap(gfx.resolve({ preset: 'high' }, 'low', 10)) === gfx.BUDGETS.high.particles, 'high: full particle budget');
  check(gfx.particleCap(gfx.resolve({ preset: 'balanced' }, 'low', 4)) === Math.round(gfx.BUDGETS.balanced.particles / 3), 'balanced: Particles low = 1/3');
  check(gfx.particleCap(gfx.resolve({ preset: 'low' }, 'low', 0)) === 0, 'low: particles off');
  const head = gfx.resolve({}, 'low', 0);
  check(head.preset === 'low' && !head.effects && head.level === 0, 'headless SwiftShader: Low, plain drawing');
});

await t('gfx: resolve applies preset, overrides and clamps scale', () => {
  const auto = gfx.resolve({}, 'low');
  check(auto.auto && auto.preset === 'low' && !auto.effects, 'auto low has no effects');
  check(auto.adaptive === true && auto.showFps === false, 'defaults');
  const hi = gfx.resolve({ preset: 'high' }, 'low');
  check(!hi.auto && hi.preset === 'high' && hi.shadows === 'on' && hi.glow === 'on' && hi.effects, 'high row');
  const ov = gfx.resolve({ preset: 'high', glow: 'off', particles: 'bogus' }, 'low');
  check(ov.glow === 'off' && ov.particles === 'high', 'override + invalid ignored');
  check(gfx.resolve({ preset: 'low', render_scale: 9 }, 'low').scale === 2, 'scale clamps high');
  check(gfx.resolve({ preset: 'low', render_scale: 0.1 }, 'low').scale === 0.5, 'scale clamps low');
  check(gfx.resolve({ preset: 'ultra' }).scale === 1.25, 'ultra scale');
  check(gfx.resolve({ adaptive: false, show_fps: true }, 'high').adaptive === false, 'adaptive off');
  check(gfx.pixelRatio(gfx.resolve({ preset: 'low' }), 3, 1) === 1, 'low caps dpr at 1');
  check(gfx.pixelRatio(gfx.resolve({ preset: 'high' }), 3, 0.6) === 1.2, 'high dpr cap × adaptive');
  check(gfx.presetTier('balanced', 'particles') === 'low', 'presetTier');
  check(/px$/.test(gfx.describe(hi, [720, 720])) && /shadows/.test(gfx.describe(hi)), 'describe');
});

await t('gfx: choosing a preset clears overrides but keeps scale/toggles', () => {
  const next = gfx.choosePreset({ preset: 'high', glow: 'off', detail: 'plain', render_scale: 1.5, show_fps: true }, 'low');
  check(next.preset === 'low' && !('glow' in next) && !('detail' in next), 'overrides cleared');
  check(next.render_scale === 1.5 && next.show_fps === true, 'scale/toggles kept');
  check(gfx.choosePreset({}, 'nonsense').preset === 'auto', 'unknown -> auto');
});

await t('gfx: Graphics panel strings exist in every locale', () => {
  const need = Object.keys(strings('en-US'));
  for (const loc of ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT']) {
    const s = strings(loc);
    for (const k of need) check(typeof s[k] === 'string' && s[k].length, `${loc} missing ${k}`);
    if (!loc.startsWith('en')) check(s.quality !== 'Quality', `${loc} untranslated`);
  }
  check(pickLocale(['de-AT']) === 'de-DE' && pickLocale(['fr-CA']) === 'fr-CA' && pickLocale(['es-MX']) === 'es-419', 'pickLocale');
  check(pickLocale(['en-GB']) === 'en-GB' && pickLocale(['xx']) === 'en-US', 'pickLocale fallback');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
