// Date-only values are ISO strings "YYYY-MM-DD" (no timezone). Timestamps stay Date (UTC).
// Prisma @db.Date columns come back as Date at UTC midnight: use toISODate / fromISODate at the edges.

export type ISODate = string;

export const TZ = "Asia/Tashkent";

export function toISODate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function fromISODate(s: ISODate): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** A real calendar date "YYYY-MM-DD": 2026-02-31 and 2026-13-01 are refused (no silent roll-over). */
export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = fromISODate(s);
  return !Number.isNaN(d.getTime()) && toISODate(d) === s;
}

/** Years a month parameter may name (salary pages, exports): anything else is a typo or a probe. */
export const MONTH_YEARS = { min: 2000, max: 2100 } as const;

/** "YYYY-MM" with MM 01–12 and a sane year. */
export function isMonth(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(s);
  return !!m && Number(m[1]) >= MONTH_YEARS.min && Number(m[1]) <= MONTH_YEARS.max;
}

/** A month query parameter, or the current month (Tashkent) when it is missing or invalid. */
export function monthParam(raw: unknown, now: Date = new Date()): string {
  return isMonth(raw) ? raw : todayISO(now).slice(0, 7);
}

/** Today's calendar date in the center timezone. */
export function todayISO(now: Date = new Date(), tz: string = TZ): ISODate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Current wall-clock time "HH:mm" in the center timezone. */
export function nowTimeHHmm(now: Date = new Date(), tz: string = TZ): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISODate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toISODate(d);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((fromISODate(a).getTime() - fromISODate(b).getTime()) / 86_400_000);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function parts(s: ISODate): { y: number; m: number; d: number } {
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) };
}

export function makeDate(y: number, m1: number, d: number): ISODate {
  // normalise month overflow
  const yy = y + Math.floor((m1 - 1) / 12);
  const mm = ((((m1 - 1) % 12) + 12) % 12) + 1;
  return `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Date in month (y, m1) on `day`, clamped to the month's last day (31 → 30/28/29). */
export function clampedDate(y: number, m1: number, day: number): ISODate {
  const yy = y + Math.floor((m1 - 1) / 12);
  const mm = ((((m1 - 1) % 12) + 12) % 12) + 1;
  return makeDate(yy, mm, Math.min(day, daysInMonth(yy, mm)));
}

/** Same anchor day n months later, clamped. */
export function addMonthsAnchored(s: ISODate, n: number, anchorDay?: number): ISODate {
  const { y, m, d } = parts(s);
  return clampedDate(y, m + n, anchorDay ?? d);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function weekdayOf(s: ISODate): number {
  const w = fromISODate(s).getUTCDay();
  return w === 0 ? 7 : w;
}

export function monthKey(s: ISODate): string {
  return s.slice(0, 7);
}

export function monthRange(month: string): { start: ISODate; end: ISODate } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return { start: makeDate(y, m, 1), end: makeDate(y, m, daysInMonth(y, m)) };
}

export function shiftMonth(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return makeDate(y, m + n, 1).slice(0, 7);
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

/** "dd.MM.yyyy". A Date is read in the center timezone (DB DATE values are UTC midnight → same day). */
export function formatDate(s: ISODate | Date | null | undefined): string {
  if (!s) return "—";
  const iso = typeof s === "string" ? s : todayISO(s);
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

/** "dd.MM.yyyy HH:mm" in center timezone */
export function formatDateTime(d: Date | null | undefined, tz: string = TZ): string {
  if (!d) return "—";
  return `${formatDate(todayISO(d, tz))} ${nowTimeHHmm(d, tz)}`;
}

/** Iterate dates inclusive. */
export function* eachDate(from: ISODate, to: ISODate): Generator<ISODate> {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}

const MONTHS = {
  uz: ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktyabr", "Noyabr", "Dekabr"],
  ru: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
};

/** "2026-10" → "Oktyabr 2026" / "Октябрь 2026" */
export function monthLabel(month: string, locale: "uz" | "ru" = "uz"): string {
  const m = Number(month.slice(5, 7));
  return `${MONTHS[locale][m - 1] ?? month} ${month.slice(0, 4)}`;
}
