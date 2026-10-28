// Key extraction for the i18n coverage test (also handy for listing keys):
// literal T('…') / N('…') calls in the client (native/*.ts) and the shared
// modules (js/), and the display fields of the content tables.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JOURNEY, LESSONS, CHALLENGES, PRACTICE_DIFFICULTIES, dailyContent } from '../js/content.js';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['i18n.js', 'sh-strings.js', 'i18n.ts']);
const unescape = (s) => s.replace(/\\(['"\\`])/g, '$1');

export function sourceKeys() {
  const keys = new Set();
  const ternary = /(?<![\w.$])T\([^'"\n()]*?\?\s*'((?:[^'\\\n]|\\.)*)'\s*:\s*'((?:[^'\\\n]|\\.)*)'/g;
  const call = /(?<![\w.$])(?:T|N)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
  for (const dir of [join(ROOT, 'js'), join(ROOT, 'native')]) {
    for (const f of readdirSync(dir)) {
      if (!/\.(js|ts)$/.test(f) || SKIP.has(f)) continue;
      const src = readFileSync(join(dir, f), 'utf8');
      for (const m of src.matchAll(call)) keys.add(unescape(m[1] ?? m[2]));
      for (const m of src.matchAll(ternary)) { keys.add(unescape(m[1])); keys.add(unescape(m[2])); }
    }
  }
  return keys;
}

export function contentKeys() {
  const keys = new Set();
  const add = (...v) => v.forEach((s) => { if (typeof s === 'string' && s) keys.add(s); });
  for (const s of JOURNEY) add(s.chapterName, s.name, s.brief);
  for (const l of LESSONS) { add(l.name, l.brief); for (const st of l.steps || []) add(st.text); }
  for (const c of CHALLENGES) add(c.name, c.brief);
  for (const d of PRACTICE_DIFFICULTIES) add(d.name, d.brief);
  // The three rotating daily skeletons (one per day key mod 3).
  for (let i = 0; i < 6; i++) { const d = dailyContent(`2026-01-0${i + 1}`); add(d.baseName, d.brief); }
  return keys;
}

export const ALL = new Set([...sourceKeys(), ...contentKeys()]);
