// Money is integer UZS everywhere. Formatting only — no money math lives here.

export function formatMoney(amount: number | null | undefined, currency = "so'm"): string {
  if (amount === null || amount === undefined) return "—";
  const sign = amount < 0 ? "−" : "";
  const abs = Math.abs(Math.round(amount));
  const grouped = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped} ${currency}`;
}

/** Parse user input like "1 250 000", "1,250,000" or "1250000" into integer UZS. */
export function parseMoney(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input) : null;
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/[\s ,_']/g, "").replace(/so.?m$/i, "");
  if (!/^-?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}
