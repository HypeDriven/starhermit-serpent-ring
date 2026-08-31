/**
 * Balance tuner (dev tool, not part of the test run):
 *   node tests/tune.js            -> probe eat rates + journey stage proofs
 *   node tests/tune.js rates      -> only eat-rate probes
 */
import { JOURNEY, CHALLENGES, dailyContent } from '../js/content.js';
import { simulateContentProof, probeEatRate } from './harness.js';
import { dailyKey } from '../js/rules.js';

if (process.argv[2] === 'rates' || !process.argv[2]) {
  console.log('--- eat-rate probes (lone bot, 90s) ---');
  for (const target of [150, 200, 260, 330]) {
    const r = probeEatRate({ motesTarget: target });
    console.log(`motes.target=${target}: ${JSON.stringify(r)}`);
  }
}

if (!process.argv[2] || process.argv[2] === 'stages') {
  console.log('--- journey proofs ---');
  for (const st of JOURNEY) {
    const t0 = Date.now();
    const proof = simulateContentProof(st);
    console.log(
      `${st.id} ${st.mastery ? 'M' : ' '} goal=${st.ruleset.goals[0].type}:${st.ruleset.goals[0].value}` +
      ` -> ${proof.ok ? 'OK ' : 'FAIL'} ticks=${proof.ticks} (${(proof.ticks / 30).toFixed(0)}s) ${proof.why} [${Date.now() - t0}ms]`,
    );
  }
  console.log('--- challenge proofs ---');
  for (const st of CHALLENGES) {
    const proof = simulateContentProof(st);
    console.log(`${st.id} -> ${proof.ok ? 'OK ' : 'FAIL'} ticks=${proof.ticks} ${proof.why}`);
  }
  console.log('--- daily proof ---');
  const d = dailyContent(dailyKey());
  const proof = simulateContentProof(d);
  console.log(`${d.id} -> ${proof.ok ? 'OK' : 'FAIL'} ticks=${proof.ticks} ${proof.why}`);
}
