import { describe, expect, it } from "vitest";
import { findClash, lessonClash, timesOverlap, validSlot } from "./schedule";

const g = (from: string, to: string | null, slots: [number, string, string][], name: string) => ({
  from,
  to,
  slots: slots.map(([weekday, startTime, endTime]) => ({ weekday, startTime, endTime })),
  meta: { name },
});

describe("clash check", () => {
  it("touching times do not overlap", () => {
    expect(timesOverlap("09:00", "10:30", "10:30", "12:00")).toBe(false);
    expect(timesOverlap("09:00", "10:30", "10:00", "12:00")).toBe(true);
  });
  it("same weekday and overlapping time in an open-ended group clashes", () => {
    const res = findClash(g("2026-10-01", null, [[1, "09:00", "10:30"]], "new"), [g("2026-01-01", null, [[1, "10:00", "11:00"]], "A")]);
    expect(res?.other.meta.name).toBe("A");
  });
  it("different weekday or non-overlapping date ranges do not clash", () => {
    expect(findClash(g("2026-10-01", null, [[2, "09:00", "10:30"]], "new"), [g("2026-01-01", null, [[1, "09:00", "10:30"]], "A")])).toBeNull();
    expect(findClash(g("2026-10-01", null, [[1, "09:00", "10:30"]], "new"), [g("2026-01-01", "2026-09-30", [[1, "09:00", "10:30"]], "A")])).toBeNull();
  });
  it("validates slots", () => {
    expect(validSlot({ weekday: 1, startTime: "10:00", endTime: "09:00" })).toBe(false);
    expect(validSlot({ weekday: 8, startTime: "09:00", endTime: "10:00" })).toBe(false);
    expect(validSlot({ weekday: 7, startTime: "09:00", endTime: "10:00" })).toBe(true);
  });
  it("lesson-level clash", () => {
    expect(lessonClash({ date: "2026-10-05", startTime: "09:00", endTime: "10:00" }, [{ date: "2026-10-05", startTime: "09:30", endTime: "11:00", meta: "X" }])).toBe("X");
    expect(lessonClash({ date: "2026-10-06", startTime: "09:00", endTime: "10:00" }, [{ date: "2026-10-05", startTime: "09:30", endTime: "11:00", meta: "X" }])).toBeNull();
  });
});
