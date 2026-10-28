// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per simulation event, rotating
// through each event's clips so repeats vary. The procedural blips audio.js
// played while a clip was still decoding are not ported (a live synthesis
// graph makes clip loads fail on the web runtime): a clip still loading is
// silent. The runtime's Options own the volumes and the mute (the old pause
// panel's Music / Sounds sliders; the game has no music). Clips load once the
// mixer runs (natively at once, in a browser after the first press), one at
// a time.
import { context, loadClip, play as playClip, type AudioClip } from "starhermit:audio";

/** audio.js EVENT_SAMPLES. */
const SAMPLES: Record<Sfx, string[]> = {
  "eat": ["eat-glint", "eat-pluck", "eat-morsel", "eat-bubble", "eat-chime", "eat-spark"],
  "boost-start": ["boost-whoosh", "boost-surge", "boost-ignite", "boost-rush", "boost-launch"],
  "death": ["death-impact", "death-shatter", "death-crash", "death-fade"],
};
export type Sfx = "eat" | "boost-start" | "death";
const clips = new Map<string, AudioClip>();
const rotor: Record<string, number> = {};
const queue: string[] = [];
let loading = false;
let wanted = false;

/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wanted = true; }

export function play(ev: Sfx): void {
  const names = SAMPLES[ev];
  const i = (rotor[ev] = ((rotor[ev] ?? -1) + 1) % names.length);
  const clip = clips.get(names[i]!);
  if (!clip) return;
  try { playClip(clip, { bus: "effects" }); } catch { clips.delete(names[i]!); if (!queue.includes(names[i]!)) queue.push(names[i]!); }
}

/** Each frame: the clips once the mixer runs, one at a time. */
export function update(): void {
  if (context.state !== "running") return;
  if (wanted) {
    wanted = false;
    for (const list of Object.values(SAMPLES)) for (const n of list) if (!queue.includes(n)) queue.push(n);
  }
  if (loading || !queue.length) return;
  const name = queue.shift()!;
  if (clips.has(name)) return;
  loading = true;
  loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => {
    console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
    loading = false;
  });
}
