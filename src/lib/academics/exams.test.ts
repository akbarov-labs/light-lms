import { describe, expect, it } from "vitest";
import { certificateNumber, CODE_ALPHABET, ExamInputError, examStats, normalizeCode, parseBands, parseSections, scoreResult, sectionsMax, verifyCode } from "./exams";

describe("parseSections / parseBands", () => {
  it("reads name: max lines", () => {
    expect(parseSections("Listening: 25\n\nReading=25\n  Writing : 30  ")).toEqual([
      { name: "Listening", max: 25 },
      { name: "Reading", max: 25 },
      { name: "Writing", max: 30 },
    ]);
    expect(sectionsMax(parseSections("A: 40\nB: 60"))).toBe(100);
    expect(parseSections("")).toEqual([]);
  });
  it("a bad line names its number", () => {
    const e = (() => {
      try {
        parseSections("A: 10\nB 20");
      } catch (x) {
        return x;
      }
    })();
    expect(e).toBeInstanceOf(ExamInputError);
    expect(e).toMatchObject({ field: "sections", line: 2 });
    expect(() => parseSections("A: 0")).toThrow(ExamInputError);
  });
  it("bands are sorted and must fit the maximum", () => {
    expect(parseBands("40: A2\n0: A1\n70 = B1", 100)).toEqual([
      { min: 0, level: "A1" },
      { min: 40, level: "A2" },
      { min: 70, level: "B1" },
    ]);
    expect(() => parseBands("120: C1", 100)).toThrow(ExamInputError);
  });
});

describe("scoreResult", () => {
  const plain = { maxScore: 100, passScore: 60, sections: [], bands: [] };
  it("total only: pass mark and percent", () => {
    expect(scoreResult(plain, { total: 72 })).toEqual({ score: 72, sectionScores: [], passed: true, level: null, pct: 72 });
    expect(scoreResult(plain, { total: 59 })?.passed).toBe(false);
    expect(scoreResult(plain, { total: null })).toBeNull();
    expect(() => scoreResult(plain, { total: 101 })).toThrow(ExamInputError);
    expect(() => scoreResult(plain, { total: 7.5 })).toThrow(ExamInputError);
  });
  it("sections add up; every section is required once one is entered", () => {
    const ex = { maxScore: 50, passScore: null, sections: [{ name: "L", max: 20 }, { name: "R", max: 30 }], bands: [] };
    expect(scoreResult(ex, { sections: [15, 22] })).toMatchObject({ score: 37, sectionScores: [15, 22], passed: null, pct: 74 });
    expect(scoreResult(ex, { sections: [null, null] })).toBeNull();
    expect(() => scoreResult(ex, { sections: [15, null] })).toThrow(ExamInputError);
    expect(() => scoreResult(ex, { sections: [21, 0] })).toThrow(ExamInputError);
  });
  it("placement bands pick the highest band reached", () => {
    const ex = { maxScore: 100, passScore: null, sections: [], bands: [{ min: 0, level: "A1" }, { min: 40, level: "A2" }, { min: 70, level: "B1" }] };
    expect(scoreResult(ex, { total: 39 })?.level).toBe("A1");
    expect(scoreResult(ex, { total: 40 })?.level).toBe("A2");
    expect(scoreResult(ex, { total: 100 })?.level).toBe("B1");
    expect(scoreResult({ ...ex, bands: [{ min: 50, level: "B1" }] }, { total: 10 })?.level).toBeNull();
  });
});

describe("examStats", () => {
  it("count, average, pass/fail, best", () => {
    expect(examStats([{ score: 70, passed: true }, { score: 55, passed: false }, { score: 81, passed: true }])).toEqual({ count: 3, avg: 68.7, passed: 2, failed: 1, best: 81 });
    expect(examStats([])).toEqual({ count: 0, avg: null, passed: 0, failed: 0, best: null });
  });
});

describe("certificate ids", () => {
  it("number = year + 4-digit sequence", () => {
    expect(certificateNumber(2026, 7)).toBe("2026-0007");
    expect(certificateNumber(2026, 12345)).toBe("2026-12345");
  });
  it("verify codes use the unambiguous alphabet and normalize back", () => {
    for (let i = 0; i < 50; i++) {
      const c = verifyCode();
      expect(c).toHaveLength(10);
      expect([...c].every((x) => CODE_ALPHABET.includes(x))).toBe(true);
      expect(normalizeCode(`${c.slice(0, 5).toLowerCase()} - ${c.slice(5)}`)).toBe(c);
    }
    expect(CODE_ALPHABET).not.toMatch(/[01ILO]/);
    expect(normalizeCode("ABCDE12345")).toBeNull(); // 1 is not in the alphabet
    expect(normalizeCode("ABC")).toBeNull();
  });
});
