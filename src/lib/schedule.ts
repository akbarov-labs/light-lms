// Room / teacher clash detection — pure. A clash = same weekday, overlapping times,
// overlapping date ranges (open-ended groups run forever).
import type { ISODate } from "./dates";

export interface WeeklySlot {
  weekday: number;
  startTime: string;
  endTime: string;
}

export interface ScheduledGroup<M = unknown> {
  from: ISODate;
  to: ISODate | null;
  slots: WeeklySlot[];
  meta: M;
}

export function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function rangesOverlap(aFrom: ISODate, aTo: ISODate | null, bFrom: ISODate, bTo: ISODate | null): boolean {
  return (!bTo || aFrom <= bTo) && (!aTo || bFrom <= aTo);
}

export function validSlot(s: WeeklySlot): boolean {
  return s.weekday >= 1 && s.weekday <= 7 && /^\d\d:\d\d$/.test(s.startTime) && /^\d\d:\d\d$/.test(s.endTime) && s.startTime < s.endTime;
}

export interface Clash<M> {
  slot: WeeklySlot;
  other: ScheduledGroup<M>;
  otherSlot: WeeklySlot;
}

export function findClash<M>(proposed: Omit<ScheduledGroup<unknown>, "meta">, others: ScheduledGroup<M>[]): Clash<M> | null {
  for (const other of others) {
    if (!rangesOverlap(proposed.from, proposed.to, other.from, other.to)) continue;
    for (const slot of proposed.slots) {
      for (const otherSlot of other.slots) {
        if (slot.weekday === otherSlot.weekday && timesOverlap(slot.startTime, slot.endTime, otherSlot.startTime, otherSlot.endTime)) {
          return { slot, other, otherSlot };
        }
      }
    }
  }
  return null;
}

/** Clash between one dated lesson and other dated lessons (for reschedules / substitutes). */
export function lessonClash<M>(
  l: { date: ISODate; startTime: string; endTime: string },
  others: { date: ISODate; startTime: string; endTime: string; meta: M }[],
): M | null {
  const hit = others.find((o) => o.date === l.date && timesOverlap(l.startTime, l.endTime, o.startTime, o.endTime));
  return hit ? hit.meta : null;
}
