import { describe, expect, it } from "vitest";
import { computeProgress, ratingFor, type ProgressInput, type ProgressLesson, type ProgressMark } from "./progress";

const L = (n: number, status: ProgressLesson["status"] = "HELD", topic: string | null = null): ProgressLesson => ({ id: `l${n}`, date: `2026-10-${String(n).padStart(2, "0")}`, status, topic });
const M = (n: number, status: ProgressMark["status"], grade: number | null = null, comment: string | null = null): ProgressMark => ({ lessonId: `l${n}`, status, grade, comment });
const base = (over: Partial<ProgressInput> = {}): ProgressInput => ({
  lessons: [L(1), L(3), L(6), L(8)],
  marks: [M(1, "PRESENT", 5), M(3, "LATE", 4), M(6, "ABSENT"), M(8, "PRESENT", 4, "Yaxshi ishladi")],
  window: { start: "2026-09-01", end: null },
  freezes: [],
  gradeScale: "5",
  ...over,
});

describe("computeProgress", () => {
  it("counts marks, attendance %, average grade and comments", () => {
    const p = computeProgress(base());
    expect(p).toMatchObject({ lessons: 4, present: 2, late: 1, absent: 1, excused: 0, unmarked: 0, attendancePct: 75, gradeCount: 3, gradeAvg: 4.3, gradePct: 87, rating: "EXCELLENT" });
    expect(p.comments).toEqual([{ date: "2026-10-08", text: "Yaxshi ishladi" }]);
    expect(p.lines.map((l) => l.status)).toEqual(["PRESENT", "LATE", "ABSENT", "PRESENT"]);
  });
  it("only held lessons inside the enrollment window and outside freezes count", () => {
    const p = computeProgress(
      base({
        lessons: [L(1), L(2, "CANCELLED"), L(3, "SCHEDULED"), L(6), L(8), L(20)],
        window: { start: "2026-10-05", end: "2026-10-19" },
        freezes: [{ from: "2026-10-07", to: "2026-10-09" }],
      }),
    );
    expect(p.lessons).toBe(1);
    expect(p.lines.map((l) => l.date)).toEqual(["2026-10-06"]);
    expect(p.attendancePct).toBe(0);
  });
  it("a held lesson without a mark is unmarked, not absent", () => {
    const p = computeProgress(base({ marks: [M(1, "PRESENT")] }));
    expect(p).toMatchObject({ lessons: 4, present: 1, unmarked: 3, attendancePct: 100, gradeAvg: null, rating: "EXCELLENT" });
  });
  it("nothing held → no percentages, no rating", () => {
    expect(computeProgress(base({ lessons: [L(1, "SCHEDULED")], marks: [] }))).toMatchObject({ lessons: 0, attendancePct: null, gradeAvg: null, rating: null });
  });
  it("0–100 scale averages to whole numbers", () => {
    const p = computeProgress(base({ gradeScale: "100", marks: [M(1, "PRESENT", 90), M(3, "PRESENT", 75), M(6, "PRESENT", 80), M(8, "PRESENT")] }));
    expect(p).toMatchObject({ gradeAvg: 82, gradePct: 82, rating: "GOOD" });
  });
  it("trend against last month's average, within the shown precision = same", () => {
    expect(computeProgress(base({ prevAvg: 3.9 })).trend).toBe("up");
    expect(computeProgress(base({ prevAvg: 4.7 })).trend).toBe("down");
    expect(computeProgress(base({ prevAvg: 4.3 })).trend).toBe("same");
    expect(computeProgress(base({ prevAvg: null })).trend).toBeNull();
  });
});

describe("ratingFor", () => {
  it("grade bands, attendance alone without grades, poor attendance caps the rating", () => {
    expect(ratingFor(90, 100)).toBe("EXCELLENT");
    expect(ratingFor(72, 90)).toBe("GOOD");
    expect(ratingFor(55, 90)).toBe("FAIR");
    expect(ratingFor(30, 90)).toBe("ATTENTION");
    expect(ratingFor(null, 80)).toBe("GOOD");
    expect(ratingFor(95, 60)).toBe("FAIR");
    expect(ratingFor(30, 60)).toBe("ATTENTION");
    expect(ratingFor(null, null)).toBeNull();
  });
});
