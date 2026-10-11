/** "#2563eb" → "37 99 235" for CSS rgb(var(--accent) / alpha). Falls back to blue. */
export function hexToRgbTriplet(hex: string | null | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return "37 99 235";
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
