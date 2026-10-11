import { clampedDate, addDays, parts, type ISODate } from "@/lib/dates";

export interface Period {
  start: ISODate;
  end: ISODate;
}

/** Monthly period anchored on `anchorDay` (1..31, clamped to month end) that contains `date`. */
export function periodContaining(date: ISODate, anchorDay: number): Period {
  const { y, m } = parts(date);
  let start = clampedDate(y, m, anchorDay);
  if (start > date) start = clampedDate(y, m - 1, anchorDay);
  return { start, end: addDays(nextPeriodStart(start, anchorDay), -1) };
}

export function nextPeriodStart(start: ISODate, anchorDay: number): ISODate {
  const { y, m } = parts(start);
  return clampedDate(y, m + 1, anchorDay);
}

export function nextPeriod(p: Period, anchorDay: number): Period {
  const start = nextPeriodStart(p.start, anchorDay);
  return { start, end: addDays(nextPeriodStart(start, anchorDay), -1) };
}

const UZ_MONTHS = [
  "Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun",
  "Iyul", "Avgust", "Sentabr", "Oktyabr", "Noyabr", "Dekabr",
];

export function uzMonthName(month1: number): string {
  return UZ_MONTHS[month1 - 1] ?? String(month1);
}

/** "Oktyabr 2026" for calendar months, "15.10–14.11.2026" for anchored periods. */
export function periodLabel(p: Period): string {
  const s = parts(p.start);
  const e = parts(p.end);
  if (s.d === 1 && e.m === s.m && e.y === s.y) return `${uzMonthName(s.m)} ${s.y}`;
  const dd = (n: number) => String(n).padStart(2, "0");
  return `${dd(s.d)}.${dd(s.m)}–${dd(e.d)}.${dd(e.m)}.${e.y}`;
}
