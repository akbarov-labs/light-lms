import { describe, expect, it } from "vitest";
import { bookOrder, pickPlacement, pickReplacement, pickTopicQuestions, seededRandom, shuffled, withinReach, type PoolQuestion } from "./select";
import { cleanQuizAnswer, gradeAttempt, passed, percentOf } from "./grade";
import { attemptState, deadlineOf, GRACE_MS, minutesUsed, secondsLeft } from "./timing";
import { reachableTopics, suggestGroup } from "./placement";

const pool = (codes: [string, number][]): PoolQuestion[] => codes.flatMap(([code, n]) => Array.from({ length: n }, (_, i) => ({ id: `${code}#${i + 1}`, topicCode: code, number: i + 1 })));

describe("selection", () => {
  it("is reproducible for a seed and differs between seeds", () => {
    const a = seededRandom("x");
    const b = seededRandom("x");
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const items = Array.from({ length: 30 }, (_, i) => i);
    expect(shuffled(items, "s1")).toEqual(shuffled(items, "s1"));
    expect(shuffled(items, "s1")).not.toEqual(shuffled(items, "s2"));
    expect([...shuffled(items, "s1")].sort((x, y) => x - y)).toEqual(items);
  });

  it("draws a topic test of n questions without repeats, in book order", () => {
    const p = pool([["2.1", 6], ["2.10", 4], ["2.2", 5]]);
    const got = pickTopicQuestions(p, 8, "seed");
    expect(got).toHaveLength(8);
    expect(new Set(got.map((q) => q.id)).size).toBe(8);
    expect(got).toEqual([...got].sort(bookOrder));
    // "2.2" sorts before "2.10"
    const codes = got.map((q) => q.topicCode);
    expect(codes.lastIndexOf("2.2")).toBeLessThan(codes.indexOf("2.10") === -1 ? Infinity : codes.indexOf("2.10"));
    expect(pickTopicQuestions(p, 50, "seed")).toHaveLength(15);
    expect(pickTopicQuestions(p, 8, "seed")).toEqual(got);
  });

  it("replaces a question with one not in the test, or none when the pool is used up", () => {
    const p = pool([["1", 3]]);
    expect(pickReplacement(p, new Set(["1#1", "1#2"]), "r")?.id).toBe("1#3");
    expect(pickReplacement(p, new Set(["1#1", "1#2", "1#3"]), "r")).toBeNull();
  });

  it("keeps a placement within the reached topic, mostly from its last topics, easy-first", () => {
    expect(withinReach("3.2", "3.2")).toBe(true);
    expect(withinReach("3.2.4", "3.2")).toBe(true);
    expect(withinReach("1.5", "3.2")).toBe(true);
    expect(withinReach("3.3", "3.2")).toBe(false);
    expect(withinReach("3.10", "3.2")).toBe(false);
    const p = pool([["1.1", 10], ["1.2", 10], ["2.1", 10], ["2.2", 10], ["3.1", 10], ["3.2", 10], ["3.2.1", 5], ["3.3", 10], ["4.1", 10]]);
    const got = pickPlacement(p, "3.2", 20, "chat-1");
    expect(got).toHaveLength(20);
    expect(got.every((q) => withinReach(q.topicCode, "3.2"))).toBe(true);
    // the last three topics with questions before the reach: 3.1, 3.2, 3.2.1
    const recent = got.filter((q) => ["3.1", "3.2", "3.2.1"].includes(q.topicCode)).length;
    expect(recent).toBe(12);
    expect(got).toEqual([...got].sort(bookOrder));
    expect(pickPlacement(p, "3.2", 20, "chat-1")).toEqual(got);
  });

  it("fills a placement from whichever side has questions", () => {
    // only recent topics exist
    expect(pickPlacement(pool([["1", 4], ["2", 4]]), "2", 20, "s")).toHaveLength(8);
    // few recent questions: the rest from earlier topics
    const p = pool([["1", 20], ["2", 20], ["3", 20], ["4", 1], ["5", 1], ["6", 1]]);
    const got = pickPlacement(p, "6", 15, "s");
    expect(got).toHaveLength(15);
    expect(got.filter((q) => ["4", "5", "6"].includes(q.topicCode))).toHaveLength(3);
    expect(pickPlacement(p, "0", 15, "s")).toEqual([]);
  });
});

describe("grading", () => {
  const qs = [
    { options: ["1", "2", "3", "4"], answer: "B" },
    { options: [], answer: "-4" },
    { options: [], answer: "2|-2" },
    { options: ["a", "b", "c"], answer: "C" },
  ];

  it("cleans answers to the question's kind", () => {
    expect(cleanQuizAnswer("b", 4)).toBe("B");
    expect(cleanQuizAnswer("Е", 5)).toBe("E");
    expect(cleanQuizAnswer("E", 4)).toBeNull();
    expect(cleanQuizAnswer("5", 4)).toBeNull();
    expect(cleanQuizAnswer("-2,5", 0)).toBe("-2.5");
    expect(cleanQuizAnswer("B", 0)).toBeNull();
    expect(cleanQuizAnswer("  ", 4)).toBe("");
  });

  it("grades by the key and names wrong and empty questions by number", () => {
    const g = gradeAttempt(qs, ["B", "−4", "-2", ""]);
    expect(g).toEqual({ correct: 3, total: 4, wrong: [4], blank: [4] });
    expect(gradeAttempt(qs, ["A", "4", "", "C"])).toEqual({ correct: 1, total: 4, wrong: [1, 2, 3], blank: [3] });
    // a question with no key never counts as right
    expect(gradeAttempt([{ options: [], answer: "" }], ["5"]).correct).toBe(0);
  });

  it("passes at the threshold", () => {
    expect(percentOf(14, 20)).toBe(70);
    expect(passed(14, 20, 70)).toBe(true);
    expect(passed(13, 20, 70)).toBe(false);
    expect(passed(7, 10, 70)).toBe(true);
    expect(passed(0, 0, 70)).toBe(false);
  });
});

describe("timing", () => {
  const start = new Date("2026-11-23T10:00:00Z");
  const a = { startedAt: start, deadlineAt: deadlineOf(start, 20), submittedAt: null as Date | null };

  it("closes at the deadline after a short grace", () => {
    expect(a.deadlineAt.toISOString()).toBe("2026-11-23T10:20:00.000Z");
    expect(attemptState(a, new Date("2026-11-23T10:19:59Z"))).toBe("open");
    expect(attemptState(a, new Date(a.deadlineAt.getTime() + GRACE_MS))).toBe("open");
    expect(attemptState(a, new Date(a.deadlineAt.getTime() + GRACE_MS + 1))).toBe("expired");
    expect(attemptState({ ...a, submittedAt: start }, new Date("2026-11-24T00:00:00Z"))).toBe("submitted");
  });

  it("counts down and measures the time used", () => {
    expect(secondsLeft(a.deadlineAt, new Date("2026-11-23T10:19:00.500Z"))).toBe(60);
    expect(secondsLeft(a.deadlineAt, new Date("2026-11-23T11:00:00Z"))).toBe(0);
    expect(minutesUsed({ ...a, submittedAt: new Date("2026-11-23T10:12:20Z") })).toBe(12);
    expect(minutesUsed({ ...a, submittedAt: new Date("2026-11-23T12:00:00Z") })).toBe(20);
    expect(minutesUsed(a)).toBeNull();
  });
});

describe("placement", () => {
  const groups = [
    { id: "g-early", topicCode: "1.2" },
    { id: "g-mid", topicCode: "2.3" },
    { id: "g-mid2", topicCode: "2.3" },
    { id: "g-late", topicCode: "3.1" },
    { id: "g-new", topicCode: null },
  ];

  it("suggests the group at or just below the reached topic when passed", () => {
    expect(suggestGroup(groups, "2.3", true)).toBe("g-mid");
    expect(suggestGroup(groups, "2.9", true)).toBe("g-mid");
    expect(suggestGroup(groups, "4", true)).toBe("g-late");
    // every group is further on: the earliest one
    expect(suggestGroup(groups, "1.1", true)).toBe("g-early");
  });

  it("suggests an earlier group when not passed", () => {
    expect(suggestGroup(groups, "2.3", false)).toBe("g-early");
    expect(suggestGroup(groups, "3.5", false)).toBe("g-mid");
    expect(suggestGroup(groups, "1.2", false)).toBe("g-early");
    expect(suggestGroup([{ id: "x", topicCode: null }], "1", true)).toBeNull();
  });

  it("lists chapters and sections from the first one with questions", () => {
    const topics = [
      { code: "1", approved: 0 },
      { code: "1.1", approved: 0 },
      { code: "2", approved: 5 },
      { code: "2.1", approved: 5 },
      { code: "2.1.1", approved: 5 },
      { code: "3", approved: 0 },
    ];
    expect(reachableTopics(topics).map((t) => t.code)).toEqual(["2", "2.1", "3"]);
    expect(reachableTopics([{ code: "1", approved: 0 }])).toEqual([]);
  });
});
