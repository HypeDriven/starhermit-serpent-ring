// Every player-facing string exists in all nine locales (node --test).
// Keys are the US-English source strings: literal T('…') / N('…') calls in
// src/, data-i18n markup in index.html, and the display fields of the content
// tables (stages, chapters, lessons, challenges, difficulties, dailies).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL } from './i18n-keys.mjs';

const DICTS = JSON.parse(readFileSync(new URL('../assets/strings.json', import.meta.url), 'utf8'));
const LOCALES = Object.keys(DICTS);
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('the key set is non-trivial', () => {
  assert.ok(ALL.size > 150, `only ${ALL.size} keys found`);
});

for (const locale of LOCALES.filter((l) => l !== 'en-US' && l !== 'en-GB')) {
  test(`${locale}: every key is translated with the same placeholders`, () => {
    const dict = DICTS[locale];
    const missing = [...ALL].filter((k) => !Object.prototype.hasOwnProperty.call(dict, k));
    assert.deepEqual(missing, [], `${missing.length} missing in ${locale}`);
    const bad = [...ALL].filter((k) => placeholders(dict[k]) !== placeholders(k));
    assert.deepEqual(bad, [], `placeholder mismatch in ${locale}`);
  });
}

test('no locale carries keys that no longer exist', () => {
  for (const locale of LOCALES) {
    const stray = Object.keys(DICTS[locale]).filter((k) => !ALL.has(k));
    assert.deepEqual(stray, [], locale);
  }
});

test('the nine locales; en-US is the identity table', () => {
  assert.deepEqual(LOCALES.slice().sort(), ['bew-ID', 'ca-ES', 'ca-FR', 'ca-IT', 'co-FR', 'da-DE', 'de-BE', 'de-BR', 'de-DE', 'de-IT', 'en-BQ', 'en-GB', 'en-HK', 'en-SG', 'en-US', 'es-419', 'es-AR', 'es-CL', 'es-CO', 'es-EC', 'es-ES', 'et-EE', 'eu-ES', 'eu-FR', 'fi-FI', 'fr-BE', 'fr-CA', 'fr-FR', 'fr-IT', 'fur-IT', 'gl-ES', 'id-ID', 'it-IT', 'ja-JP', 'km-VN', 'lb-BE', 'ms-SG', 'nl-BE', 'nl-NL', 'oc-FR', 'oc-IT', 'pt-BR', 'ru-EE', 'ru-FI', 'sl-IT', 'su-ID', 'sv-FI', 'ta-SG', 'vi-VN', 'yue-HK', 'zh-HK', 'zh-SG']);
  for (const [k, v] of Object.entries(DICTS['en-US'])) assert.equal(v, k);
});
