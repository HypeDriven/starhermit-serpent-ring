/**
 * Serpent Ring — the save document: per content item the plays, wins, best
 * total and best peak length ({ version: 1, records }), as the browser build
 * kept it in localStorage (serpent-ring:save:v1) and the cloud slot
 * (game:<slug>, through the JS SDK). Pure: the engine client (native/platform.ts)
 * and the node tests share it.
 */

export const emptyDoc = () => ({ version: 1, records: {} });

export const validDoc = (d) => !!(d && d.version === 1 && d.records && typeof d.records === 'object' && !Array.isArray(d.records));

const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** A clean copy of a document (anything else is an empty one). */
export function normalize(d) {
  const out = emptyDoc();
  if (!validDoc(d)) return out;
  for (const [id, r] of Object.entries(d.records)) {
    if (!r || typeof r !== 'object') continue;
    out.records[id] = { plays: n(r.plays), wins: n(r.wins), best: n(r.best), bestPeak: n(r.bestPeak) };
  }
  return out;
}

/** Per level the better of both records: most plays and wins, best score and peak (nothing is dropped). */
export function mergeDocs(a, b) {
  const out = emptyDoc();
  const ra = (validDoc(a) && a.records) || {}, rb = (validDoc(b) && b.records) || {};
  for (const id of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    const x = ra[id] || {}, y = rb[id] || {};
    out.records[id] = {
      plays: Math.max(n(x.plays), n(y.plays)), wins: Math.max(n(x.wins), n(y.wins)),
      best: Math.max(n(x.best), n(y.best)), bestPeak: Math.max(n(x.bestPeak), n(y.bestPeak)),
    };
  }
  return out;
}

export const sameDoc = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

/** The browser build's cloud slot text (save.json): its document, or null. */
export function readForeign(text) {
  try {
    const d = JSON.parse(text);
    return validDoc(d) ? normalize(d) : null;
  } catch { return null; }
}

/** Fold a finished round into the document; returns the item's record. */
export function recordResult(doc, item, res) {
  const id = item && item.id;
  if (!id || !res) return null;
  const rec = doc.records[id] || { plays: 0, wins: 0, best: 0, bestPeak: 0 };
  rec.plays += 1;
  if (res.goalMet) rec.wins += 1;
  rec.best = Math.max(rec.best, res.total || 0);
  rec.bestPeak = Math.max(rec.bestPeak, res.peakTrail || 0);
  doc.records[id] = rec;
  return rec;
}
