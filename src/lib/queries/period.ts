// Period helpers for report queries: DATE columns compare as ISO dates, but timestamps (createdAt)
// must use the center's day boundaries — Asia/Tashkent midnight is 19:00 UTC the day before (audit B13).
import { addDays, fromISODate, isISODate, monthRange, todayISO, TZ, type ISODate } from "@/lib/dates";

/** Offset of `tz` from UTC at instant `at`, in ms (Tashkent: +5 h). */
function tzOffsetMs(at: Date, tz: string): number {
  const p: Record<string, number> = {};
  for (const x of new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at)) {
    if (x.type !== "literal") p[x.type] = Number(x.value);
  }
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant the calendar day `iso` starts in `tz`. */
export function zonedDayStart(iso: ISODate, tz: string = TZ): Date {
  const utcMidnight = fromISODate(iso).getTime();
  // two passes so a DST change between the guess and the real instant is still exact
  const first = utcMidnight - tzOffsetMs(new Date(utcMidnight), tz);
  return new Date(utcMidnight - tzOffsetMs(new Date(first), tz));
}

/** `createdAt` range covering the whole days from..to in the center timezone: [start, end). */
export function zonedRange(from: ISODate, to: ISODate, tz: string = TZ): { gte: Date; lt: Date } {
  return { gte: zonedDayStart(from, tz), lt: zonedDayStart(addDays(to, 1), tz) };
}

/** from/to as given when valid ISO dates, else this month. */
export function periodOrThisMonth(p: { from?: string; to?: string }): { from: ISODate; to: ISODate } {
  const m = monthRange(todayISO().slice(0, 7));
  return { from: isISODate(p.from) ? p.from : m.start, to: isISODate(p.to) ? p.to : m.end };
}
