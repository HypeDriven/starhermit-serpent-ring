// Localization: the engine's string tables (assets/strings.json: English text
// as the keys, the nine StarHermit locales) in the interface language the
// runtime reports (the player's choice in Options › Language, else the
// account's preferred language or the device's). The runtime's Options replace
// the game's own Language setting and the DOM re-labelling: every string is
// drawn through T() each frame, so a change shows on the next frame and never
// restarts a round. The account strings are the engine's (starhermit.*).
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

export type Vars = Record<string, string | number>;
/** An English source string in the player's language; `{name}` placeholders from vars. Unknown strings pass through. */
export function T(key: string, vars?: Vars | null): string {
  return strings.has(key) ? strings.t(key, vars ?? undefined) : key;
}
/** Marks an English key that is translated with T() where it is shown. */
export const N = (s: string): string => s;
/** An engine account string: signIn, invite, inviteCopied, inviteLink, signedOut, leaderboardPosting, … */
export function S(key: string, vars?: Vars): string { return strings.t(`starhermit.${key}`, vars); }
