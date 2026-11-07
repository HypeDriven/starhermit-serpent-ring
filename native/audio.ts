// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per simulation event, rotating
// through each event's clips so repeats vary: one engine sound bank an event.
// The procedural blips audio.js played while a clip was still decoding are not
// ported: a cue whose clips are still loading is silent. The runtime's Options
// own the volumes and the mute (the old pause panel's Music / Sounds sliders;
// the game has no music).
import { loadClip, SoundBank, type AudioClip } from "starhermit:audio";

/** audio.js EVENT_SAMPLES. */
const SAMPLES: Record<Sfx, string[]> = {
  "eat": ["eat-glint", "eat-pluck", "eat-morsel", "eat-bubble", "eat-chime", "eat-spark"],
  "boost-start": ["boost-whoosh", "boost-surge", "boost-ignite", "boost-rush", "boost-launch"],
  "death": ["death-impact", "death-shatter", "death-crash", "death-fade"],
};
export type Sfx = "eat" | "boost-start" | "death";
const banks = new Map<Sfx, SoundBank>();

/** Loads every clip at once (onStart). */
export function loadSfx(): void {
  for (const ev of Object.keys(SAMPLES) as Sfx[]) {
    void Promise.all(SAMPLES[ev].map((name) => loadClip(`sfx/${name}.opus`).catch((e: unknown): AudioClip | null => {
      console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }))).then((loaded) => {
      const clips = loaded.filter((c): c is AudioClip => c !== null);
      if (clips.length) banks.set(ev, new SoundBank({ clips, order: "sequence", bus: "effects" }));
    });
  }
}

export function play(ev: Sfx): void {
  try { banks.get(ev)?.play(); } catch { /* the mixer is full this frame: skip it */ }
}
