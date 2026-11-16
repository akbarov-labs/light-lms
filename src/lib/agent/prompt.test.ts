import { describe, expect, it } from "vitest";
import { buildStateBlock, buildSystemPrompt } from "./prompt";

const center = {
  name: "Aniq Hisob",
  phone: "998711234567",
  branches: [{ id: "b1", name: "Chilonzor", address: "Bunyodkor 1", hasLocation: true }],
  courses: ["Matematika DTM"],
  teachers: [{ name: "Dilnoza Karimova", bio: "12 yil tajriba, 2025-yilda 9 o'quvchi DTMda 180+ ball." }, { name: "Aziz", bio: null }],
  rules: "",
};

describe("buildSystemPrompt", () => {
  it("is filled from the center's data, so a renamed center needs no prompt edit", () => {
    const p = buildSystemPrompt({ ...center, name: "Yangi Nom" });
    expect(p).toContain('"Yangi Nom" o\'quv markazining');
    expect(p).toContain("Chilonzor: Bunyodkor 1");
    expect(p).toContain("Matematika DTM");
    expect(p).toContain("branch_id: b1, xaritada joylashuvi bor");
  });

  it("shows teachers only by name and public bio", () => {
    const p = buildSystemPrompt(center);
    expect(p).toContain("- Dilnoza Karimova: 12 yil tajriba");
    expect(p).toContain("- Aziz: (ma'lumot kiritilmagan)");
  });

  it("keeps the rules learned from live chats: no grading, no phone gate, no re-asking", () => {
    const p = buildSystemPrompt(center);
    expect(p).toMatch(/Javoblarni HECH QACHON baholama/);
    expect(p).toMatch(/javobni HECH QACHON raqamga bog'lama/);
    expect(p).toMatch(/HECH QACHON qayta so'rama/);
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

describe("buildStateBlock", () => {
  it("lists the chat's open trials with group ids, flags today, and says it outranks the history", () => {
    const b = buildStateBlock({
      phone: "telegram",
      trials: [{ student: "Sarvar Akbarov", group: "DTM Matematika", groupId: "g1", date: "16.11.2026", weekday: "dushanba", time: "14:00", address: "Yunusobod", daysFromToday: 0, started: false }],
    });
    expect(b).toContain("Telefon raqam: olingan (Telegram kontakt)");
    expect(b).toContain("«DTM Matematika» (group_id: g1), 16.11.2026, dushanba, 14:00, Yunusobod — BUGUN");
    expect(b).toContain("suhbat tarixidan ustun");
    expect(buildStateBlock({ phone: null, trials: [] })).toMatch(/olinmagan[\s\S]*- yo'q/);
    // a lesson earlier today is over, not upcoming
    const t = { student: "A", group: "G", groupId: "g", date: "16.11.2026", weekday: "dushanba", time: "14:00", address: "X", daysFromToday: 0, started: true };
    expect(buildStateBlock({ phone: null, trials: [t] })).toContain("— bugun bo'lib o'tgan");
  });
});
