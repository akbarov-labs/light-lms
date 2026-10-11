import type { Tone } from "@/components/ui";
import type { TFn } from "./i18n";

export function slotSummary(slots: { weekday: number; startTime: string; endTime: string }[], t: TFn): string {
  if (slots.length === 0) return "—";
  const byTime = new Map<string, number[]>();
  for (const s of [...slots].sort((a, b) => a.weekday - b.weekday)) {
    const k = `${s.startTime}–${s.endTime}`;
    byTime.set(k, [...(byTime.get(k) ?? []), s.weekday]);
  }
  return [...byTime.entries()].map(([time, days]) => `${days.map((d) => t(`common.weekday.${d}` as "common.weekday.1")).join(", ")} ${time}`).join("; ");
}

export const enrollmentTone: Record<string, Tone> = { TRIAL: "amber", ACTIVE: "green", FROZEN: "blue", LEFT: "gray", TRANSFERRED: "violet" };
export const lessonTone: Record<string, Tone> = { SCHEDULED: "gray", HELD: "green", CANCELLED: "red" };
export const groupTone: Record<string, Tone> = { PLANNED: "amber", ACTIVE: "green", FINISHED: "gray", ARCHIVED: "gray" };
export const attendanceTone: Record<string, Tone> = { PRESENT: "green", ABSENT: "red", LATE: "amber", EXCUSED: "blue" };
export const attendanceMark: Record<string, string> = { PRESENT: "✓", ABSENT: "✗", LATE: "⏱", EXCUSED: "E" };
export const leadTone: Record<string, Tone> = { NEW: "blue", CONTACTED: "violet", TRIAL_BOOKED: "amber", TRIAL_DONE: "amber", ENROLLED: "green", LOST: "gray" };

export function fullName(s: { firstName: string; lastName: string }): string {
  return `${s.lastName} ${s.firstName}`.trim();
}
