/**
 * Validated categorical palette, in fixed slot order. Assign by index so a
 * given series keeps its colour across renders, and so adjacent slots stay
 * distinguishable - the order is part of the validation, not arbitrary.
 *
 * Each slot has a light- and dark-mode step. Green and red sit at the end of
 * the order because they carry a status meaning elsewhere in this app, so a
 * two- or three-series chart never accidentally reads as good/bad.
 */
export interface PaletteSlot {
  light: string;
  dark: string;
}

export const CATEGORICAL_PALETTE: PaletteSlot[] = [
  { light: "#2a78d6", dark: "#3987e5" }, // blue
  { light: "#eb6834", dark: "#d95926" }, // orange
  { light: "#1baf7a", dark: "#199e70" }, // aqua
  { light: "#eda100", dark: "#c98500" }, // yellow
  { light: "#e87ba4", dark: "#d55181" }, // magenta
  { light: "#4a3aa7", dark: "#9085e9" }, // violet
  { light: "#008300", dark: "#008300" }, // green
  { light: "#e34948", dark: "#e66767" }, // red
];

export function paletteSlot(
  index: number,
  palette: PaletteSlot[] = CATEGORICAL_PALETTE,
): PaletteSlot {
  return palette[index % palette.length];
}

/**
 * ASASI brand chart palette (brand guidelines, Colour page), used on
 * /operations. Slot order was picked by searching orderings for the best
 * adjacent-pair separation with scripts/validate_palette.js against the
 * brand surfaces (cream #F5F0E2 / green #243316):
 *
 * - slots 0-1 are the two-series pair (this period vs previous) and clear
 *   the colour-blind and normal-vision separation checks in both modes;
 * - the brand palette is deliberately muted, so the generic chroma-floor
 *   and lightness-band checks flag it by design - and from slot 2 on the
 *   adjacent separation is weaker (dark mode especially), which is why
 *   every multi-series chart that uses it keeps a labelled legend and a
 *   table view rather than relying on colour alone;
 * - dark mode uses lighter tints of the brand copper/red/green/tan since
 *   the brand's own deep red and green are unreadable on a green surface.
 */
export const BRAND_PALETTE: PaletteSlot[] = [
  { light: "#304221", dark: "#F5F0E2" }, // brand green / cream
  { light: "#B58156", dark: "#B58156" }, // brand copper
  { light: "#893131", dark: "#E0877F" }, // brand red / red tint
  { light: "#D3A98C", dark: "#9AA08C" }, // brand tan / sage grey
  { light: "#5B5B5B", dark: "#D3A98C" }, // brand grey / tan
];

/** CSS custom property names have to be idents, and keys come from data. */
function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function paletteVar(key: string, prefix = "c-"): string {
  return `var(--${prefix}${safeKey(key)})`;
}

/**
 * Builds the CSS text that defines one custom property per series, with a
 * dark-mode override.
 *
 * This goes in an inline <style> rather than Tailwind `dark:[--x:#hex]`
 * classes: those have to exist as literal strings in the source for
 * Tailwind's scanner to generate them, and series keys are only known at
 * request time. Inline CSS sidesteps the scanner entirely.
 *
 * `dark:` in this app is prefers-color-scheme (Tailwind v4's default - there
 * is no class-based toggle), so the media query below matches it.
 */
export function paletteCss(
  scopeClass: string,
  keys: string[],
  prefix = "c-",
  palette: PaletteSlot[] = CATEGORICAL_PALETTE,
): string {
  const decls = (mode: "light" | "dark") =>
    keys
      .map(
        (key, i) =>
          `--${prefix}${safeKey(key)}:${paletteSlot(i, palette)[mode]}`,
      )
      .join(";");

  return (
    `.${scopeClass}{${decls("light")}}` +
    `@media (prefers-color-scheme:dark){.${scopeClass}{${decls("dark")}}}`
  );
}
