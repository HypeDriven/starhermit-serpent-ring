// The look of the top bar, menus, lists, HUD and screens: the browser build's
// css/style.css, rewritten class-based in tools/ui-style.css and converted
// once with `starhermit css` into assets/ui-style.json (`npm run css`),
// registered at start with the theme the runtime's own widgets (scroll bars,
// focus rings) take. The runtime's high contrast option swaps in a
// black-and-white token set.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string>;
const BASE: Tokens = {
  bg: "#0b1220", panel: "#131c2e", text: "#f4efe6", muted: "#9fb0bd", accent: "#ffd75e",
  hi: "#1d2a40", primary: "#b8860b", white: "#ffffff", synced: "#7fd98f",
};
const CONTRAST: Tokens = {
  bg: "#000000", panel: "#000000", text: "#ffffff", muted: "#e6e6e6", accent: "#ffff00",
  hi: "#333333", primary: "#000000", white: "#ffffff", synced: "#00ff88",
};

let current: Tokens = { ...BASE };
export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setFont({ family: "system-ui" });
  ui.setTheme({
    fontSize: 16, smallSize: 13.6, headingSize: 20.8, padding: 8, spacing: 8, radius: 9.6,
    text: BASE.text!, muted: BASE.muted!, panel: BASE.panel!, control: BASE.panel!, hovered: BASE.hi!,
    pressed: "#26364f", field: BASE.panel!, accent: BASE.accent!, focus: BASE.accent!, outline: BASE.hi!,
  });
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$text" } },
    paragraph: { text: { color: "$text" } },
    heading: { text: { color: "$white" } },
    widget: { focusRing: { color: "$accent", width: 2, offset: 1 } },
    scrollArea: { parts: { bar: { background: "$hi", radius: 4 } } },
    tooltip: { background: "$panel", text: { color: "$text" }, radius: 6, padding: 6 },
  });
  key = "";
  applyTokens(false);
}

let key = "";
/** The base or high-contrast tokens (cheap when unchanged). */
export function applyTokens(highContrast: boolean): void {
  const k = String(highContrast);
  if (k === key) return;
  key = k;
  current = { ...BASE, ...(highContrast ? CONTRAST : {}) };
  ui.setTokens(current);
  ui.setTheme({
    text: current.text!, muted: current.muted!, panel: current.panel!, control: current.panel!, hovered: current.hi!,
    field: current.panel!, accent: current.accent!, focus: current.accent!, outline: current.white!,
  });
}
/** A token's current colour (for draw calls, which take real colours). */
export function token(name: string): string { return current[name] ?? "#000000"; }
