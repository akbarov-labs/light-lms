function parse(hex: string | null | undefined): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** "#2563eb" → "37 99 235" for CSS rgb(var(--accent) / alpha). Falls back to blue. */
export function hexToRgbTriplet(hex: string | null | undefined): string {
  const c = parse(hex) ?? [37, 99, 235];
  return c.join(" ");
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** White or near-black text, whichever reads better on the center's accent color. */
export function accentFgTriplet(hex: string | null | undefined): string {
  const c = parse(hex) ?? [37, 99, 235];
  const L = luminance(c);
  const onWhite = 1.05 / (L + 0.05);
  const onDark = (L + 0.05) / 0.06;
  return onWhite >= onDark ? "255 255 255" : "9 9 11";
}

/** CSS variables for a center's accent (white-label). */
export function accentVars(hex: string | null | undefined): Record<string, string> {
  return { "--accent": hexToRgbTriplet(hex), "--accent-fg": accentFgTriplet(hex) };
}
