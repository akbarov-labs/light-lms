import { describe, expect, it } from "vitest";
import { canonical, homeworkReport, isCorrect, keyKind, parseAnswer, parseKey } from "./grade";
import { homeworkRoute, homeworkWindow, windowState } from "./rules";

describe("parseAnswer", () => {
  it("reads choice letters, any case, with punctuation, and Cyrillic look-alikes", () => {
    for (const s of ["B", "b", " b ", "B)", "b.", "В", "в"]) expect(parseAnswer(s)).toEqual({ kind: "choice", letter: "B" });
    expect(parseAnswer("Д")).toEqual({ kind: "choice", letter: "D" });
    expect(parseAnswer("F")).toBeNull();
  });

  it("reads integers, decimals with . or , and fractions", () => {
    expect(parseAnswer("-4")).toMatchObject({ kind: "number" });
    expect(parseAnswer("2,5")).toMatchObject({ kind: "number" });
    expect(parseAnswer(".5")).toMatchObject({ kind: "number" });
    expect(parseAnswer("3/4")).toMatchObject({ kind: "number" });
    expect(parseAnswer("−4")).toMatchObject({ kind: "number" }); // Unicode minus
    expect(parseAnswer("x=-4")).toMatchObject({ kind: "number" });
    expect(parseAnswer("1 000")).toMatchObject({ kind: "number" });
  });

  it("refuses what is not an answer", () => {
    for (const s of ["", " ", "-", ".", "1/0", "javob 5", "2+3", "1,2,3", "AB"]) expect(parseAnswer(s), s).toBeNull();
  });
});

describe("isCorrect", () => {
  it("compares numbers by exact value", () => {
    expect(isCorrect("0.75", "3/4")).toBe(true);
    expect(isCorrect("3/4", ",75")).toBe(true);
    expect(isCorrect("2.5", "2,50")).toBe(true);
    expect(isCorrect("-4", "x = -4")).toBe(true);
    expect(isCorrect("1/3", "0.333")).toBe(false);
    expect(isCorrect("0.3", "0.30000000000000004")).toBe(false);
    expect(isCorrect("4", "-4")).toBe(false);
  });

  it("compares letters and never mixes letters with numbers", () => {
    expect(isCorrect("C", "c")).toBe(true);
    expect(isCorrect("C", "С")).toBe(true); // Cyrillic Es
    expect(isCorrect("C", "D")).toBe(false);
    expect(isCorrect("1", "A")).toBe(false);
  });

  it("accepts any of several answers and nothing for a blank", () => {
    expect(isCorrect("2|-2", "-2")).toBe(true);
    expect(isCorrect("2|-2", "2")).toBe(true);
    expect(isCorrect("2|-2", "4")).toBe(false);
    expect(isCorrect("2", "")).toBe(false);
    expect(isCorrect("2", null)).toBe(false);
  });

  it("knows a key item's kind and stores answers in one form", () => {
    expect(keyKind("B|C")).toBe("choice");
    expect(keyKind("2|-2")).toBe("number");
    expect(canonical("b)")).toBe("B");
    expect(canonical("x = 2,5")).toBe("2.5");
    expect(canonical("+3")).toBe("3");
    expect(canonical("hello")).toBeNull();
  });
});

describe("parseKey", () => {
  const ok = (text: string) => {
    const r = parseKey(text);
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.items;
  };

  it("takes answers separated by spaces, lines, ; or comma-space", () => {
    expect(ok("B C -4 3/4")).toEqual(["B", "C", "-4", "3/4"]);
    expect(ok("b\nc\n2,5")).toEqual(["B", "C", "2.5"]);
    expect(ok("A; B; 7")).toEqual(["A", "B", "7"]);
    expect(ok("A, B, 2,5")).toEqual(["A", "B", "2.5"]);
  });

  it("takes numbered answers in every common form", () => {
    expect(ok("1) B 2) C 3) -4")).toEqual(["B", "C", "-4"]);
    expect(ok("1)B 2.C 3-D 4:-4 5B")).toEqual(["B", "C", "D", "-4", "B"]);
    expect(ok("1A2B3C")).toEqual(["A", "B", "C"]);
    expect(ok("abdca")).toEqual(["A", "B", "D", "C", "A"]);
    expect(ok("1. 2|-2")).toEqual(["2|-2"]);
  });

  it("reads 1.5 as a number, not question 1", () => {
    expect(ok("1.5 2")).toEqual(["1.5", "2"]);
  });

  it("catches a skipped or doubled question number", () => {
    expect(parseKey("1) A 2) B 4) C")).toMatchObject({ ok: false, error: "numbering", index: 3 });
    expect(parseKey("1A2B2C")).toMatchObject({ ok: false, error: "numbering", index: 3 });
  });

  it("names the bad answer and its position", () => {
    expect(parseKey("A B ? D")).toMatchObject({ ok: false, error: "badToken", index: 3, token: "?" });
    expect(parseKey("A 1-4")).toMatchObject({ ok: false, error: "badToken", index: 2 });
    expect(parseKey("2|B")).toMatchObject({ ok: false, error: "mixed", index: 1 });
    expect(parseKey("A 3)")).toMatchObject({ ok: false, error: "badToken" });
    expect(parseKey("   ")).toEqual({ ok: false, error: "empty" });
    expect(parseKey(Array(101).fill("A").join(" "))).toEqual({ ok: false, error: "tooMany" });
  });
});

describe("homeworkReport", () => {
  const key = ["B", "-4", "3/4"];
  const subs = [
    { studentId: "s1", answers: ["B", "-4", "0.75"] },
    { studentId: "s2", answers: ["b", "4", ""] },
    { studentId: "s3", answers: ["B", "4", "1/2"] },
    { studentId: "s4", answers: ["", "", ""] }, // opened the homework, answered nothing
  ];
  const r = homeworkReport(key, subs);

  it("counts per question over the students who answered anything", () => {
    expect(r.answeredBy).toEqual(["s1", "s2", "s3"]);
    expect(r.questions.map((q) => [q.n, q.correct, q.of])).toEqual([[1, 3, 3], [2, 1, 3], [3, 1, 3]]);
  });

  it("marks a question everyone got right, so the lesson can skip it", () => {
    expect(r.questions.map((q) => q.allCorrect)).toEqual([true, false, false]);
  });

  it("groups wrong answers by what was written, most common first, and lists blanks", () => {
    expect(r.questions[1].wrong).toEqual([{ given: "4", studentIds: ["s2", "s3"] }]);
    expect(r.questions[2].wrong).toEqual([{ given: "1/2", studentIds: ["s3"] }]);
    expect(r.questions[2].blank).toEqual(["s2"]);
  });

  it("scores every student from the current key", () => {
    expect(r.scores.get("s1")).toEqual({ correct: 3, answered: 3 });
    expect(r.scores.get("s2")).toEqual({ correct: 1, answered: 2 });
    expect(r.scores.has("s4")).toBe(false);
    // a corrected key re-grades: question 2 was really 4
    expect(homeworkReport(["B", "4", "3/4"], subs).scores.get("s3")).toEqual({ correct: 2, answered: 3 });
  });

  it("answers past the key's end are ignored and missing ones are blanks", () => {
    const q = homeworkReport(["A"], [{ studentId: "x", answers: ["A", "B"] }]);
    expect(q.scores.get("x")).toEqual({ correct: 1, answered: 1 });
    const longer = homeworkReport(["A", "B"], [{ studentId: "x", answers: ["A"] }]);
    expect(longer.questions[1].blank).toEqual(["x"]);
  });

  it("no answers: nothing is all-correct", () => {
    expect(homeworkReport(key, []).questions.every((q) => !q.allCorrect && q.of === 0)).toBe(true);
  });
});

describe("rules", () => {
  it("opens at the lesson's end and closes at the next lesson's start, Tashkent time", () => {
    const w = homeworkWindow({ date: "2026-11-18", endTime: "15:30" }, { date: "2026-11-20", startTime: "14:00" });
    expect(w.opensAt.toISOString()).toBe("2026-11-18T10:30:00.000Z");
    expect(w.dueAt!.toISOString()).toBe("2026-11-20T09:00:00.000Z");
    expect(windowState(w, new Date("2026-11-18T10:29:59Z"))).toBe("notYet");
    expect(windowState(w, new Date("2026-11-18T10:30:00Z"))).toBe("open");
    expect(windowState(w, new Date("2026-11-20T09:00:00Z"))).toBe("closed");
  });

  it("stays open with no next lesson", () => {
    const w = homeworkWindow({ date: "2026-11-18", endTime: "15:30" }, null);
    expect(w.dueAt).toBeNull();
    expect(windowState(w, new Date("2030-01-01T00:00:00Z"))).toBe("open");
  });

  it("routes by school grade: from the threshold up to the student, below to the parents", () => {
    expect(homeworkRoute(11, 9)).toBe("student");
    expect(homeworkRoute(9, 9)).toBe("student");
    expect(homeworkRoute(8, 9)).toBe("parents");
    expect(homeworkRoute(4, 9)).toBe("parents");
    expect(homeworkRoute(null, 9)).toBe("student");
    expect(homeworkRoute(7, 6)).toBe("student");
  });
});
