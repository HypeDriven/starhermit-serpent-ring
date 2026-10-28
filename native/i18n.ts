// Localization: the browser build's tables (js/i18n.js with js/locales/*,
// English text as the keys, the nine StarHermit locales; the account strings
// in js/sh-strings.js) in the interface language the runtime reports
// (preferences().language: the player's choice in Options › Language, else
// the account's preferred language or the device's). The runtime's Options
// replace the game's own Language setting (sh-language.js) and the DOM
// re-labelling: every string is drawn through T() each frame, so a change
// shows on the next frame and never restarts a round.
import { onPreferencesChange, preferences } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { T as tr, N as mark, setLocale, getLang } from "../js/i18n.js";
import { shText } from "../js/sh-strings.js";

function apply(tag: string): void {
  const next = setLocale(String(tag || "en-US")) as string;
  ui.setLanguage(next);
}
apply(preferences().language);
onPreferencesChange((p) => { if (p.language !== getLang()) apply(p.language); });

export type Vars = Record<string, string | number>;
/** An English source string in the player's language; `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars | null): string { return tr(key, vars ?? undefined) as string; }
/** Marks an English key that is translated with T() where it is shown. */
export const N = (s: string): string => mark(s) as string;
/** The account strings (signIn, invite, inviteCopied, inviteLink, signedOut, lbPosting, lbRank, lbPosted, lbNotPosted). */
export function S(key: string, vars?: Vars): string { return shText(key, vars) as string; }
