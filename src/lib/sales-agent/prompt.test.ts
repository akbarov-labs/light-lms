import { describe, expect, it } from "vitest";
import { buildSalesPrompt, productFacts } from "./prompt";
import { PLANS } from "@/lib/plans";

const base = { name: "Sabaq", siteUrl: "https://sabaq.uz", demoUrl: "https://sabaq.uz/demo", signupOpen: false };

describe("sales agent prompt", () => {
  it("presents Sabaq as the teacher's AI assistant and never feeds it the words CRM or LMS as facts", () => {
    const facts = productFacts();
    expect(facts).not.toMatch(/\bCRM\b|\bLMS\b/);
    const p = buildSalesPrompt(base);
    expect(p).toContain("o'qituvchining AI yordamchisi");
    expect(p).toContain("Siz dars bering — qolganini biz qilamiz.");
    // the only mention is the instruction not to use them
    expect(p.match(/\bCRM\b/g)).toHaveLength(1);
  });

  it("takes prices from PLANS", () => {
    const facts = productFacts();
    expect(facts).toContain(`${PLANS.START.limit} tagacha faol o'quvchi`);
    expect(facts).toContain("249 000 so'm / oy");
    expect(facts).toContain("990 000 so'm / oy");
  });

  it("closed signup: our team sets the center up; open signup: the signup link", () => {
    expect(buildSalesPrompt(base)).toContain("jamoamiz o'zi sozlab beradi");
    const open = buildSalesPrompt({ ...base, signupOpen: true });
    expect(open).toContain("https://sabaq.uz/signup");
    expect(open).not.toContain("ro'yxatdan o'tish sahifasi yopiq");
  });

  it("gives the demo and site links only when there are some", () => {
    expect(buildSalesPrompt(base)).toContain("https://sabaq.uz/demo");
    const none = buildSalesPrompt({ ...base, siteUrl: null, demoUrl: null });
    expect(none).not.toContain("Demo (");
    expect(none).not.toContain("Sayt:");
  });
});
