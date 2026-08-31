/**
 * Serpent Ring — test runner (node tests/run-tests.js / npm test).
 */
import { JOURNEY, CHALLENGES } from '../js/content.js';

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

await t('journey has 40 stages', () => check(JOURNEY.length === 40));
await t('challenges present', () => check(CHALLENGES.length >= 6));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
