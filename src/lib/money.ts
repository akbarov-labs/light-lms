// Money is integer UZS everywhere. Formatting and parsing only — no money math lives here.

export function formatMoney(amount: number | null | undefined, currency = "so'm"): string {
  if (amount === null || amount === undefined) return "—";
  const sign = amount < 0 ? "−" : "";
  const abs = Math.abs(Math.round(amount));
  const grouped = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped} ${currency}`;
}

/** A single payment above this needs an explicit "yes, this amount is right" (typo guard). */
export const LARGE_PAYMENT = 50_000_000;

/** Is this payment large enough to need the explicit confirmation, and is it missing? */
export function needsLargeConfirm(amount: number, confirmed: boolean): boolean {
  return amount > LARGE_PAYMENT && !confirmed;
}

// whitespace of any kind (space, NBSP, narrow NBSP from Excel ru/uz) is one separator class
const SPACE = /[\s   ]/;
const isSep = (c: string) => SPACE.test(c) || c === "," || c === "." || c === "'" || c === "’" || c === "_";
const sepClass = (c: string) => (SPACE.test(c) ? " " : c === "’" ? "'" : c);

/**
 * Parse user input into integer UZS, or null when it is not a clean amount.
 *   "1 250 000", "1,250,000", "1.250.000", "1'250'000", "1250000" → 1 250 000
 *   "300 000,00", "1,250,000.00", "300000.0"                      → decimals accepted only when zero
 *   "150000,50", "1,25", "12,34,567", "1 25 000"                  → null (tiyin / bad grouping)
 * Grouping separators are only valid between groups of exactly three digits and must be the
 * same throughout; a decimal tail (1–2 digits) must use a different character than the grouping.
 * A leading "-", "−" or "–" makes the amount negative; a trailing "so'm"/"сум"/"UZS" is ignored.
 */
export function parseMoney(input: unknown): number | null {
  if (typeof input === "number") return Number.isSafeInteger(input) ? input : null;
  if (typeof input !== "string") return null;
  let s = input.trim().replace(/(so['’`ʻ‘]?m|сўм|сум|sum|uzs)\.?$/i, "").trim();
  let sign = 1;
  if (/^[-−–]/.test(s)) {
    sign = -1;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) s = s.slice(1).trim();
  if (!/^\d/.test(s)) return null;

  // decimal tail: a "," or "." followed by 1–2 digits at the very end
  let decimalSep: string | null = null;
  const tail = /([.,])(\d{1,2})$/.exec(s);
  if (tail) {
    if (!/^0+$/.test(tail[2])) return null;
    decimalSep = tail[1];
    s = s.slice(0, -tail[0].length);
  }

  let digits = "";
  let groupSep: string | null = null;
  let run = 0; // digits since the last separator
  for (const c of s) {
    if (c >= "0" && c <= "9") {
      digits += c;
      run++;
      continue;
    }
    if (!isSep(c)) return null;
    const cls = sepClass(c);
    if (groupSep === null) {
      if (run < 1 || run > 3) return null; // the first group has 1–3 digits
      groupSep = cls;
    } else if (cls !== groupSep || run !== 3) return null;
    run = 0;
  }
  if (groupSep !== null && run !== 3) return null; // every later group has exactly three digits
  if (groupSep !== null && groupSep === decimalSep) return null;
  if (digits.length === 0 || digits.length > 15) return null;
  const n = Number(digits);
  return n === 0 ? 0 : sign * n;
}

/**
 * Live formatting for a money input while the user types: groups the whole part ("1 250 000")
 * and keeps a decimal tail the user is typing (",0", ",00") instead of gluing it onto the amount.
 * `value` is the parsed amount (null while the text is not a clean amount, e.g. "150 000,5").
 */
export function typedMoney(raw: string): { display: string; value: number | null } {
  const m = /^(.*?)([.,]\d{0,2})?$/.exec(raw.trim()) ?? ["", raw, undefined];
  const whole = (m[1] ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const tail = m[2] ?? "";
  // a lone trailing separator is not a decimal yet ("1," may become "1,250"): it does not change the value
  const value = whole === "" ? null : parseMoney(tail.length > 1 ? `${whole}${tail}` : whole);
  return { display: grouped + tail, value };
}
