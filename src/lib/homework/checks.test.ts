// The first pilot center's homework rules: the student's own check (wrong questions, hints, locks), the
// deadline an hour before class with late answers after it, and reading answers off a notebook photo.
import { describe, expect, it } from "vitest";
import { checkAnswers, hintFor, lockedQuestions } from "./grade";
import { homeworkWindow, isLate, studentState, windowState } from "./rules";
import { describeKinds, photoPrompt, toAnswers } from "./photo";

const key = ["B", "-4", "0.75", "2|-2", "12.5"];

describe("checkAnswers", () => {
  it("names wrong and empty questions, never the right answer", () => {
    const r = checkAnswers(key, ["B", "4", "", "-2", "1.25"]);
    expect(r).toEqual({ correct: 2, total: 5, wrong: [{ q: 1, hint: "sign" }, { q: 4, hint: "decimal" }], blank: [2] });
    expect(JSON.stringify(r)).not.toContain("-4");
  });

  it("all right", () => {
    expect(checkAnswers(key, ["b", "-4", "3/4", "2", "12,5"])).toMatchObject({ correct: 5, wrong: [], blank: [] });
  });
});

describe("hintFor", () => {
  it("the sign, the decimal point, nothing for other slips or letters", () => {
    expect(hintFor("-4", "4")).toBe("sign");
    expect(hintFor("3/4", "-0.75")).toBe("sign");
    expect(hintFor("12.5", "125")).toBe("decimal");
    expect(hintFor("12.5", "0.125")).toBe("decimal");
    expect(hintFor("-4", "5")).toBeNull();
    expect(hintFor("-4", "0")).toBeNull();
    expect(hintFor("B", "C")).toBeNull();
    expect(hintFor("B", "4")).toBeNull();
  });
});

describe("lockedQuestions", () => {
  it("only answers right at the last check", () => {
    expect([...lockedQuestions(key, ["B", "4", "0.75"])]).toEqual([0, 2]);
    expect(lockedQuestions(key, []).size).toBe(0);
  });
});

describe("the window with an early deadline and late answers", () => {
  // lesson 18.11 15:30 (10:30Z), next lesson 20.11 14:00 (09:00Z), an hour before, two late days
  const w = homeworkWindow({ date: "2026-11-18", endTime: "15:30" }, { date: "2026-11-20", startTime: "14:00" }, { dueMinutesBefore: 60, lateDays: 2 });

  it("closes an hour before the next lesson, late answers for two days", () => {
    expect(w.dueAt!.toISOString()).toBe("2026-11-20T08:00:00.000Z");
    expect(w.resultsAt!.toISOString()).toBe("2026-11-20T09:00:00.000Z");
    expect(w.lateUntil!.toISOString()).toBe("2026-11-22T08:00:00.000Z");
    expect(windowState(w, new Date("2026-11-20T07:59:59Z"))).toBe("open");
    expect(windowState(w, new Date("2026-11-20T08:00:00Z"))).toBe("late");
    expect(windowState(w, new Date("2026-11-22T08:00:00Z"))).toBe("closed");
  });

  it("after the deadline only those who had not answered may answer, and they are late", () => {
    const after = new Date("2026-11-20T10:00:00Z");
    expect(studentState(w, after, null)).toBe("late");
    expect(studentState(w, after, new Date("2026-11-19T12:00:00Z"))).toBe("closed");
    expect(studentState(w, after, new Date("2026-11-20T09:30:00Z"))).toBe("late");
    expect(isLate(w, new Date("2026-11-20T09:30:00Z"))).toBe(true);
    expect(isLate(w, new Date("2026-11-19T12:00:00Z"))).toBe(false);
    expect(isLate(w, null)).toBe(false);
  });

  it("the deadline never falls before the lesson that set it has ended", () => {
    const tight = homeworkWindow({ date: "2026-11-18", endTime: "15:30" }, { date: "2026-11-18", startTime: "16:00" }, { dueMinutesBefore: 60, lateDays: 0 });
    expect(tight.dueAt!.toISOString()).toBe(tight.opensAt.toISOString());
    expect(tight.lateUntil).toBeNull();
  });
});

describe("photo reading", () => {
  const kinds: ("choice" | "number")[] = ["choice", "choice", "choice", "number", "number"];

  it("tells the model the question kinds as ranges, never the key", () => {
    expect(describeKinds(kinds)).toBe("1–3: a letter (A–E); 4–5: a number");
    expect(describeKinds(["number"])).toBe("1: a number");
    expect(photoPrompt(kinds)).toContain("5 questions");
  });

  it("keeps what fits: in range, the kind checked by code, the last reading of a question wins", () => {
    const read = toAnswers(
      [
        { n: 1, answer: "b", sure: true },
        { n: 2, answer: "7", sure: true },
        { n: 4, answer: "−4", sure: true },
        { n: 5, answer: "2,5", sure: false },
        { n: 5, answer: "2,6", sure: true },
        { n: 9, answer: "A", sure: true },
        { n: 3, answer: " ", sure: true },
      ],
      kinds,
    );
    expect(read).toEqual([
      { q: 0, raw: "B", unsure: false },
      { q: 1, raw: "7", unsure: true },
      { q: 3, raw: "-4", unsure: false },
      { q: 4, raw: "2.6", unsure: false },
    ]);
  });
});
