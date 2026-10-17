// Pure helpers of the CSV import (no DB): dates and columns.
import { daysInMonth, makeDate, type ISODate } from "@/lib/dates";

/** Column of the optional "debt since" date: by header name, else the 7th column. */
export const DEBT_SINCE_COLUMN = 6;
const DEBT_SINCE_HEADER = /^(debt[\s_-]*since|qarz[\s_-]*sanasi|дата[\s_-]*долга|долг[\s_-]*с)$/i;

export function debtSinceColumn(header: string[] | null): number {
  if (header) {
    const i = header.findIndex((h) => DEBT_SINCE_HEADER.test(h.trim()));
    if (i >= 0) return i;
  }
  return DEBT_SINCE_COLUMN;
}

/** "dd.MM.yyyy", "d.M.yyyy", "dd/MM/yyyy" or "yyyy-MM-dd" → ISO date; null when not a real date. */
export function parseImportDate(raw: string): ISODate | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else {
    match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return makeDate(y, m, d);
}
