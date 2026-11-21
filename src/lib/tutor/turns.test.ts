import { describe, expect, it } from "vitest";
import { TUTOR_HISTORY, nextDayCount, toTelegramHtml, trimTurns, type TutorMessage } from "./turns";
import { tutorRoute } from "./route";
import { TUTOR_SYSTEM, turnNote } from "./prompt";

const turns = (n: number): TutorMessage[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` }) as TutorMessage);

describe("trimTurns", () => {
  it("keeps the last ~10 turns, starting at the student's message", () => {
    const kept = trimTurns(turns(30));
    expect(kept).toHaveLength(TUTOR_HISTORY);
    expect(kept[0]).toEqual({ role: "user", content: "m10" });
    // an odd cut would start at the tutor's reply: that one is dropped
    const odd = trimTurns(turns(30), 19);
    expect(odd[0].role).toBe("user");
    expect(odd).toHaveLength(18);
  });

  it("drops broken rows (not an array, empty, unknown role)", () => {
    expect(trimTurns("x" as unknown as TutorMessage[])).toEqual([]);
    expect(trimTurns([{ role: "system", content: "a" } as unknown as TutorMessage, { role: "user", content: " " }, { role: "user", content: "q" }])).toEqual([{ role: "user", content: "q" }]);
  });
});

describe("nextDayCount", () => {
  it("counts up to the limit, then refuses; a new day starts over", () => {
    expect(nextDayCount({ day: "2026-11-23", dayMessages: 0 }, "2026-11-23", 30)).toBe(1);
    expect(nextDayCount({ day: "2026-11-23", dayMessages: 29 }, "2026-11-23", 30)).toBe(30);
    expect(nextDayCount({ day: "2026-11-23", dayMessages: 30 }, "2026-11-23", 30)).toBeNull();
    expect(nextDayCount({ day: "2026-11-22", dayMessages: 30 }, "2026-11-23", 30)).toBe(1);
    expect(nextDayCount({ day: "", dayMessages: 0 }, "2026-11-23", 1)).toBe(1);
  });
});

describe("toTelegramHtml", () => {
  it("escapes the model's text and keeps **bold**", () => {
    expect(toTelegramHtml("x < 5 & **diskriminant** > 0")).toBe("x &lt; 5 &amp; <b>diskriminant</b> &gt; 0");
    expect(toTelegramHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("cuts a long reply to fit one Telegram message", () => {
    const html = toTelegramHtml("a".repeat(5000));
    expect(html.length).toBeLessThanOrEqual(3501);
    expect(html.endsWith("…")).toBe(true);
  });
});

describe("tutorRoute", () => {
  const base = { text: "2x + 3 = 11 ni qanday yechaman?", eligible: true, sheetOpen: false };
  it("sends a linked family's question to the tutor", () => {
    expect(tutorRoute(base)).toBe("tutor");
  });
  it("leaves everyone else, commands and empty texts to today's flow", () => {
    expect(tutorRoute({ ...base, eligible: false })).toBe("skip");
    expect(tutorRoute({ ...base, text: "/start" })).toBe("skip");
    expect(tutorRoute({ ...base, text: "   " })).toBe("skip");
    expect(tutorRoute({ ...base, eligible: false, sheetOpen: true })).toBe("skip");
  });
  it("keeps an open homework sheet or test in its own flow", () => {
    expect(tutorRoute({ ...base, sheetOpen: true })).toBe("busy");
    expect(tutorRoute({ ...base, testOpen: true })).toBe("busy");
  });
});

describe("prompt", () => {
  it("holds the client's rules", () => {
    expect(TUTOR_SYSTEM).toMatch(/NEVER state the final answer/);
    expect(TUTOR_SYSTEM).toMatch(/SIMILAR problem/);
    expect(TUTOR_SYSTEM).toMatch(/Karakalpak, answer in Uzbek \(Latin script\)/);
    expect(TUTOR_SYSTEM).toMatch(/konspekt/);
    expect(TUTOR_SYSTEM).toMatch(/homework or test questions/);
  });
  it("tells the model the grade, who writes and the script, nothing personal", () => {
    expect(turnNote({ grades: [10, 5, 10, null], parent: true, script: "cyrillic" })).toBe(
      "Grade: 5, 10. This chat is a parent's; they may ask for their child. Explain so they can help the child, same rules. The last message is in Cyrillic: answer in Cyrillic (Russian, or Uzbek Cyrillic if it is Uzbek).",
    );
    expect(turnNote({ grades: [null], parent: false, script: null })).toBe("Grade: unknown (ask if it matters). This chat is the student's own.");
  });
});
