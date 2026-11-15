import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt";

const center = { name: "Aniq Hisob", phone: "998711234567", branches: [{ name: "Chilonzor", address: "Bunyodkor 1" }], courses: ["Matematika DTM"], rules: "" };

describe("buildSystemPrompt", () => {
  it("is filled from the center's data, so a renamed center needs no prompt edit", () => {
    const p = buildSystemPrompt({ ...center, name: "Yangi Nom" });
    expect(p).toContain('"Yangi Nom" o\'quv markazining');
    expect(p).toContain("Chilonzor: Bunyodkor 1");
    expect(p).toContain("Matematika DTM");
  });

  it("puts the center's rules in their own block, and without rules sends money questions to the owner", () => {
    expect(buildSystemPrompt({ ...center, rules: "Chegirma yo'q." })).toMatch(/<markaz_qoidalari>\nChegirma yo'q\.\n<\/markaz_qoidalari>/);
    expect(buildSystemPrompt(center)).toContain("Markaz qoidalari kiritilmagan");
  });

  it("holds nothing that changes between turns (dates, seats): those come from tools", () => {
    expect(buildSystemPrompt(center)).toBe(buildSystemPrompt(center));
    expect(buildSystemPrompt(center)).not.toMatch(/\d{2}\.\d{2}\.\d{4}/);
  });
});
