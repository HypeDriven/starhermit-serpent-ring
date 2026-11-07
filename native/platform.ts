// The game's data and the StarHermit platform, on the runtime's modules (what
// js/platform.js did over the JS SDK and localStorage):
// - the save (starhermit:storage `saves`, schema 1: on the device and in the
//   player's cloud slot) is the records document (js/progress.js: per content
//   item plays, wins, best total, best peak); two devices' saves merge on a
//   conflict (mergeDocs, as the browser build did on its saveconflict); the
//   slot the browser build wrote through the JS SDK (game:<slug>) shows as
//   foreign: it is merged in and replaced once;
// - the browser build's per-player settings KV (graphics, audio) is the
//   runtime's Options now (quality level, volumes): its keys are removed;
// - the player, the invite link, the platform's clock for the Daily, and
//   posting a ranked round's total through score-script.js
//   (leaderboards.submitScore) with the player's rank.
import type { JsonValue } from "starhermit:engine";
import {
  inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, serverNow, serverTime,
} from "starhermit:platform";
import { saves, settings as store } from "starhermit:storage";
import { Progress, type Doc, type Item, type Rec, type Result } from "./game.ts";

// --- the save --------------------------------------------------------------------------------
let data: Doc = Progress.emptyDoc();
let lastSavedAt = 0;
const mergedListeners = new Set<() => void>();
/** fn() after records from the account (another device, the browser build) were merged in. */
export function onMerged(fn: () => void): void { mergedListeners.add(fn); }
function merged(): void { for (const fn of mergedListeners) fn(); }

function write(opts: { replaceForeign?: boolean } = {}): void {
  try {
    saves.save(data as unknown as JsonValue, { schema: 1, ...opts });
    lastSavedAt = saves.load()?.savedAt ?? lastSavedAt;
  } catch (e) { console.warn(`save: ${String(e)}`); }
}
function adopt(other: unknown): boolean {
  const next = Progress.mergeDocs(other, data);
  if (Progress.sameDoc(next, data)) return false;
  data = next;
  write();
  return true;
}
saves.onConflict((mine, remote) => ({ merged: Progress.mergeDocs(remote.data, mine?.data ?? null) as unknown as JsonValue }));
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    if (adopt(cur.data)) merged();
  }
});
/** The browser build's cloud document: merged with this device's save, saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  const doc = old.text != null ? Progress.readForeign(old.text) : null;
  let grew = false;
  if (doc) {
    const next = Progress.mergeDocs(doc, data);
    grew = !Progress.sameDoc(next, data);
    data = next;
  }
  write({ replaceForeign: true });
  if (grew) merged();
}

/** Folds a finished round into the records and saves (device at once, account debounced). */
export function recordResult(item: Item, res: Result): Rec | null {
  const rec = Progress.recordResult(data, item, res);
  write();
  return rec;
}
export function record(id: string): Rec | null { return data.records[id] ?? null; }

/** The sync chip (platform.js renderSync): offline for a guest, else saving… / synced. */
export function syncState(): "offline" | "saving" | "synced" {
  if (!player()) return "offline";
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "offline";
  if (st === "loading" || st === "foreign" || st === "uploading" || saves.status() === "pending") return "saving";
  return "synced";
}
export function flush(): void { void saves.flush().catch(() => undefined); }

/** The browser build's settings KV groups (graphics preset, volumes) are the runtime's Options now. */
function dropLegacy(): void {
  const keys = store.legacyKeys();
  if (!keys) return;
  for (const key of keys) store.removeLegacy(key);
}

/** Reads the device's save (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  data = Progress.normalize(cur?.data ?? null);
  store.onLegacy(dropLegacy);
  dropLegacy();
  if (saves.state() === "foreign") migrateForeign();
  refreshPlayer();
  void serverTime().then(() => undefined, () => undefined);
}

// --- the player and the clock -----------------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function displayName(): string { return player()?.displayName ?? ""; }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
function refreshPlayer(): void {
  invite = null;
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
onPlayerChange(() => refreshPlayer());

/** Now in ms by the platform's clock when it has answered, else the device's (the Daily's UTC day, the clock). */
export function nowMs(): number {
  try { return serverNow() ?? Date.now(); } catch { return Date.now(); }
}

// --- the high-score board ---------------------------------------------------------------------
export interface Posted { posted: boolean; rank: number | null }
/** Signed in only: post a ranked round's total through score-script.js; { posted, rank }. Never rejects. */
export async function postScore(total: number): Promise<Posted> {
  const r = await leaderboards.submitScore("high-score", Math.max(0, Math.round(total)));
  return { posted: r.accepted, rank: r.rank };
}
