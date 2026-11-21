import { describe, expect, it } from "vitest";
import { approvable, codeChain, compareCodes, decideKey, isTopicCode, keyOf } from "./keys";
import { solvePrompt, toExtracted } from "./extract";
import { chunkRanges, costOf, splitRange } from "./import";
import { parseOptions } from "../services/questions";

describe("keyOf", () => {
  it("takes a letter within the options", () => {
    expect(keyOf("b", 4)).toBe("B");
    expect(keyOf(" C ", 4)).toBe("C");
    expect(keyOf("E", 4)).toBeNull();
    expect(keyOf("E", 5)).toBe("E");
  });
  it("takes a number only for an open question", () => {
    expect(keyOf("2,5", 0)).toBe("2.5");
    expect(keyOf("-4", 0)).toBe("-4");
    expect(keyOf("3/4", 0)).toBe("3/4");
    expect(keyOf("12", 4)).toBeNull();
    expect(keyOf("A", 0)).toBeNull();
  });
  it("is null for nothing", () => {
    expect(keyOf("", 4)).toBeNull();
    expect(keyOf(null, 4)).toBeNull();
    expect(keyOf("   ", 0)).toBeNull();
  });
});

describe("decideKey", () => {
  it("a printed answer both solves confirm is STATED", () => {
    expect(decideKey("B", ["B", "B"], false)).toEqual({ answer: "B", keyCheck: "STATED" });
  });
  it("a printed answer a solve disputes, or one solve missing, is CONFLICT but keeps the printed key", () => {
    expect(decideKey("B", ["B", "C"], false)).toEqual({ answer: "B", keyCheck: "CONFLICT" });
    expect(decideKey("B", ["B", null], false)).toEqual({ answer: "B", keyCheck: "CONFLICT" });
  });
  it("a picture always needs a person", () => {
    expect(decideKey("B", ["B", "B"], true).keyCheck).toBe("CONFLICT");
    expect(decideKey(null, ["B", "B"], true)).toEqual({ answer: "", keyCheck: "UNKNOWN" });
  });
  it("without a printed answer: two equal solves are AGREED, otherwise no key", () => {
    expect(decideKey(null, ["12", "12"], false)).toEqual({ answer: "12", keyCheck: "AGREED" });
    expect(decideKey(null, ["0.5", "1/2"], false)).toEqual({ answer: "0.5", keyCheck: "AGREED" });
    expect(decideKey(null, ["A", "D"], false)).toEqual({ answer: "", keyCheck: "CONFLICT" });
    expect(decideKey(null, ["A", null], false)).toEqual({ answer: "", keyCheck: "CONFLICT" });
    expect(decideKey(null, [null, null], false)).toEqual({ answer: "", keyCheck: "UNKNOWN" });
  });
});

describe("topic codes", () => {
  it("sorts in book order", () => {
    expect(["1.10", "2", "1.2", "1", "1.2.1"].sort(compareCodes)).toEqual(["1", "1.2", "1.2.1", "1.10", "2"]);
  });
  it("lists the topics above", () => {
    expect(codeChain("3.2.1")).toEqual(["3", "3.2", "3.2.1"]);
  });
  it("knows a code", () => {
    expect(isTopicCode("1.2.3")).toBe(true);
    expect(isTopicCode("1.")).toBe(false);
    expect(isTopicCode("I")).toBe(false);
  });
});

describe("approvable", () => {
  it("needs a key that fits the options", () => {
    expect(approvable({ answer: "B", options: ["1", "2", "3", "4"] })).toBe(true);
    expect(approvable({ answer: "", options: ["1", "2"] })).toBe(false);
    expect(approvable({ answer: "12", options: [] })).toBe(true);
    expect(approvable({ answer: "2|-2", options: [] })).toBe(true);
    expect(approvable({ answer: "C", options: ["1", "2"] })).toBe(false);
  });
});

describe("toExtracted", () => {
  const q = (o: Partial<Record<string, unknown>> = {}) => ({ section: "1.1", number: 1, ref: "97-1-6", text: "2+2=?", options: ["3", "4", "5", "6"], stated: "", solution: "", figure: false, page: 2, answer: "B", ...o });
  it("maps pages to the book and keys to their options", () => {
    const r = toExtracted({ sections: [{ code: "1.1", title: " Qo'shish " }], questions: [q({ stated: "Javob: B" })] } as never, 9, 4);
    expect(r.sections).toEqual([{ code: "1.1", title: "Qo'shish" }]);
    expect(r.questions[0]).toMatchObject({ section: "1.1", number: 1, ref: "97-1-6", page: 10, solve: "B", stated: null });
    // a stated answer in key form is kept
    expect(toExtracted({ sections: [], questions: [q({ stated: "b" })] } as never, 1, 4).questions[0].stated).toBe("B");
  });
  it("keeps a topic's explanation, trimmed, and none when it is empty", () => {
    const r = toExtracted({ sections: [{ code: "1.1.4", title: "Bo'linish belgilari", theory: "  1. Oxirgi raqami $0$ yoki $5$ bo'lsa ...  " }, { code: "1.1.5", title: "Qoldiqli bo'lish", theory: " " }], questions: [] } as never, 1, 4);
    expect(r.sections).toEqual([
      { code: "1.1.4", title: "Bo'linish belgilari", theory: "1. Oxirgi raqami $0$ yoki $5$ bo'lsa ..." },
      { code: "1.1.5", title: "Qoldiqli bo'lish" },
    ]);
  });
  it("drops what the bank cannot take", () => {
    const r = toExtracted({ sections: [{ code: "x", title: "y" }], questions: [q({ options: ["only one"] }), q({ section: "bob" }), q({ text: " " }), q({ number: 0 }), q({ options: ["1", "2", "3", "4", "5", "6"] })] } as never, 1, 4);
    expect(r.sections).toEqual([]);
    expect(r.questions).toEqual([]);
  });
  it("an answer that does not fit is no answer; a strange ref is none; a page outside the chunk is clamped", () => {
    const r = toExtracted({ sections: [], questions: [q({ answer: "12", ref: "see page 4!", page: 9 })] } as never, 1, 4).questions[0];
    expect(r.solve).toBeNull();
    expect(r.ref).toBeNull();
    expect(r.page).toBe(4);
  });
});

describe("solvePrompt", () => {
  it("lists options with letters and marks open questions", () => {
    const p = solvePrompt([{ id: "0", text: "2+2", options: ["3", "4"] }, { id: "1", text: "x=?", options: [] }]);
    expect(p).toContain("[0] 2+2\nA) 3   B) 4");
    expect(p).toContain("[1] x=?\n(open answer: give the number)");
  });
});

describe("chunks", () => {
  it("overlap by one page", () => {
    expect(chunkRanges(1, 10, 4)).toEqual([[1, 4], [4, 7], [7, 10]]);
    expect(chunkRanges(5, 6, 4)).toEqual([[5, 6]]);
    expect(chunkRanges(3, 3, 4)).toEqual([[3, 3]]);
    // a chunk is at least two pages, or it would never move on
    expect(chunkRanges(1, 3, 1)).toEqual([[1, 2], [2, 3]]);
  });
  it("split a chunk too long for one answer", () => {
    expect(splitRange([1, 4])).toEqual([[1, 2], [2, 4]]);
    expect(splitRange([1, 3])).toEqual([[1, 2], [2, 3]]);
    expect(splitRange([5, 6])).toEqual([[5, 5], [6, 6]]);
    expect(splitRange([5, 5])).toEqual([]);
  });
  it("price", () => {
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 100_000 })).toBeCloseTo(6);
  });
});

describe("parseOptions", () => {
  it("one per line, typed letters and numbering dropped", () => {
    expect(parseOptions("A) 16\nB. 10\n\nc: 8\n4\n")).toEqual(["16", "10", "8", "4"]);
    expect(parseOptions("1) x²\n2) √2")).toEqual(["x²", "√2"]);
    expect(parseOptions("")).toEqual([]);
    expect(parseOptions("3:4\n2.5\n2,5")).toEqual(["3:4", "2.5", "2,5"]);
  });
});
