/**
 * Serpent Ring — WebAudio: authored one-shot samples with procedural blips
 * as fallback while a sample loads or if it fails. No assets are decoded
 * before the first user-gesture-driven play call.
 */
let ctx = null;
let sfxBus = null;
const musicVol = { v: 0 };
const sfxVol = { v: 1 };

const SFX_BASE = './sfx/';

/** Runtime event map: every manifest basename is reachable from its event. */
const EVENT_SAMPLES = {
  'eat': ['eat-glint', 'eat-pluck', 'eat-morsel', 'eat-bubble', 'eat-chime', 'eat-spark'],
  'boost-start': ['boost-whoosh', 'boost-surge', 'boost-ignite', 'boost-rush', 'boost-launch'],
  'death': ['death-impact', 'death-shatter', 'death-crash', 'death-fade'],
};

const buffers = new Map(); // name -> AudioBuffer | null (null = failed)
const pending = new Map(); // name -> Promise (in-flight fetch/decode)
const nextIndex = new Map(); // event -> rotation index (avoids repeat playback)

function ensureCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function ensureSfxBus() {
  const c = ensureCtx();
  if (!sfxBus) {
    sfxBus = c.createGain();
    sfxBus.gain.value = sfxVol.v;
    sfxBus.connect(c.destination);
  }
  return sfxBus;
}

export function setMusicVolume(v) { musicVol.v = Math.max(0, Math.min(100, v)) / 100; }
export function setSfxVolume(v) {
  sfxVol.v = Math.max(0, Math.min(100, v)) / 100;
  if (sfxBus) sfxBus.gain.value = sfxVol.v;
}

/** Lazy-fetch + decode + cache one clip. Never throws. */
function loadSample(name) {
  if (buffers.has(name)) return Promise.resolve(buffers.get(name));
  if (pending.has(name)) return pending.get(name);
  const p = fetch(SFX_BASE + name + '.opus')
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    })
    .then((data) => ensureCtx().decodeAudioData(data))
    .then((buf) => { buffers.set(name, buf); return buf; })
    .catch(() => { buffers.set(name, null); return null; })
    .finally(() => { pending.delete(name); });
  pending.set(name, p);
  return p;
}

function playSample(buf) {
  const c = ensureCtx();
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(ensureSfxBus());
  src.start();
}

function blip(freq, dur, vol) {
  try {
    const c = ensureCtx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol * sfxVol.v, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur);
  } catch { /* audio unavailable */ }
}

/** Try the mapped sample first; run synth only while loading/on failure. */
function playWithSamples(kind, names, synth) {
  try {
    const i = nextIndex.get(kind) || 0;
    nextIndex.set(kind, i + 1);
    const name = names[i % names.length];
    if (buffers.has(name)) {
      const buf = buffers.get(name);
      if (buf) { playSample(buf); return; }
      synth(); // known-bad clip: synthesis fallback
      return;
    }
    loadSample(name); // kick off lazy load; next trigger uses the sample
    synth();
  } catch {
    synth();
  }
}

export function playEvent(kind) {
  const synth = {
    'eat': () => blip(660, 0.12, 0.5),
    'boost-start': () => blip(880, 0.2, 0.7),
    'death': () => blip(196, 0.4, 0.8),
  }[kind];
  if (!synth) return;
  playWithSamples(kind, EVENT_SAMPLES[kind], synth);
}
