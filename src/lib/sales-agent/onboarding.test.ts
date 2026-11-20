import { describe, expect, it } from "vitest";
import { draftSummary, mergeDraft, missingItems, planFromDraft, readOnboarding, type OnboardingDraft } from "./onboarding";

const full: OnboardingDraft = {
  center: { name: "Bilim Markazi", city: "Toshkent" },
  owner: { name: "Dilnoza Karimova", role: "egasi" },
  branches: [{ name: "Chilonzor", rooms: ["1-xona"] }],
  courses: [
    { name: "Ingliz tili", pricing: "monthly", price: 400000, lessonsPerWeek: 3 },
    { name: "IELTS intensiv", pricing: "package", price: 1200000, packageLessons: 24 },
  ],
  teachers: [
    { name: "Aziz Rahimov", phone: "+998 90 111 22 33", salary: { model: "PERCENT_EARNED", percent: 40 } },
    { name: "Malika", phone: "901112244", salary: { model: "FIXED", fixedAmount: 3000000 } },
  ],
  groups: [
    { name: "Beginner A", course: "ingliz tili", teacher: "Aziz Rahimov", days: [1, 3, 5], startTime: "09:00", endTime: "10:30", room: "1-xona" },
    { name: "IELTS 1", course: "IELTS intensiv", teacher: "malika", branch: "Chilonzor", days: [2, 4], startTime: "15:00", endTime: "17:00", room: "2-xona" },
    { name: "Kids", course: "Ingliz tili", teacher: "Dilnoza Karimova", days: [6], startTime: "10:00", endTime: "11:30" },
  ],
  students: { count: 80, source: "file" },
  rules: { trialLessons: 1, excusedAbsenceCredit: true, payFromCollected: false },
};

describe("mergeDraft", () => {
  it("replaces a list, merges an object field by field, deletes with null", () => {
    let d: OnboardingDraft = {};
    let r = mergeDraft(d, { center: { name: "Bilim" }, courses: [{ name: "A", pricing: "monthly", price: 1 }] });
    expect(r.ok).toBe(true);
    d = r.ok ? r.draft : d;
    r = mergeDraft(d, { center: { city: "Samarqand" }, courses: [{ name: "B", pricing: "monthly", price: 2 }] });
    d = r.ok ? r.draft : d;
    expect(d.center).toEqual({ name: "Bilim", city: "Samarqand" });
    expect(d.courses?.map((c) => c.name)).toEqual(["B"]);
    r = mergeDraft(d, { courses: null });
    expect(r.ok && r.draft.courses).toBeFalsy();
  });

  it("refuses bad input with reasons the model can act on", () => {
    const r = mergeDraft({}, { groups: [{ name: "X", course: "A", teacher: "B", days: [9], startTime: "9:00", endTime: "10:00" }], salary: {} });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join(" ")).toContain("noma'lum bo'lim: salary");
    const r2 = mergeDraft({}, { groups: [{ name: "X", course: "A", teacher: "B", days: [9], startTime: "9:00", endTime: "10:00" }] });
    expect(!r2.ok && r2.errors.join(" ")).toMatch(/groups\.0\.(days|startTime)/);
  });

  it("reads a broken stored value as empty", () => {
    expect(readOnboarding({ status: "weird", draft: { courses: "x" } })).toEqual({ status: "none", draft: {}, files: [] });
  });
});

describe("missingItems / summary", () => {
  it("lists what the team still needs, including broken references", () => {
    const m = missingItems({ center: { name: "X" }, groups: [{ name: "G", course: "Yo'q", teacher: "Hech kim", days: [1], startTime: "10:00", endTime: "09:00" }] }, false);
    expect(m).toEqual(expect.arrayContaining(["egasining ismi", "egasining telefon raqami (tugma orqali)", "kamida bitta kurs va narxi"]));
    expect(m.join("|")).toContain("«G» guruhining kursi «Yo'q»");
    expect(m.join("|")).toContain("tugash vaqti");
  });

  it("a complete draft needs nothing; the owner may teach a group", () => {
    expect(missingItems(full, true)).toEqual([]);
  });

  it("the summary shows prices, salary rules and the schedule in plain text", () => {
    const s = draftSummary(full, [{ kind: "document", fileId: "f", name: "talabalar.xlsx", mime: null, size: 10, messageId: 5, caption: null, at: "" }], true);
    expect(s).toContain("Ingliz tili: 400 000 so'm (oylik, haftasiga 3 dars)");
    expect(s).toContain("IELTS intensiv: 1 200 000 so'm (paket, 24 dars)");
    expect(s).toContain("Aziz Rahimov, +998 90 111 22 33 — foiz: 40%");
    expect(s).toContain("Beginner A: ingliz tili, Aziz Rahimov, Du/Ch/Ju 09:00–10:30");
    expect(s).toContain("talabalar.xlsx");
    expect(s).not.toContain("Hali kerak");
    expect(s).not.toMatch(/\*\*|#/);
  });
});

describe("planFromDraft", () => {
  it("resolves names to records, normalizes phones, adds a room named only in a group", () => {
    const p = planFromDraft(full, "+998 90 000 00 01");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const { plan } = p;
    expect(plan.owner).toEqual({ name: "Dilnoza Karimova", phone: "998900000001", teaches: true });
    expect(plan.teachers.map((t) => t.phone)).toEqual(["998901112233", "998901112244"]);
    expect(plan.teachers[0].salary).toEqual({ model: "PERCENT_EARNED", percent: 40, fixedAmount: null, perLesson: null });
    expect(plan.groups.map((g) => [g.course, g.teacher, g.branch])).toEqual([
      [0, 0, 0],
      [1, 1, 0],
      [0, "owner", 0],
    ]);
    expect(plan.groups[0].slots).toEqual([1, 3, 5].map((weekday) => ({ weekday, startTime: "09:00", endTime: "10:30" })));
    expect(plan.branches[0].rooms).toEqual(["1-xona", "2-xona"]);
    expect(plan.courses[1]).toMatchObject({ pricingType: "PACKAGE", packageLessons: 24 });
    expect(plan.settings).toEqual({ trialLessons: 1, excusedAbsenceCredit: true, payFromCollected: false });
  });

  it("lists every problem at once", () => {
    const p = planFromDraft(
      { ...full, owner: undefined, teachers: [{ name: "A", phone: "123" }, { name: "B", phone: "901112233" }, { name: "C", phone: "+998901112233" }], groups: [{ ...full.groups![0], teacher: "Z" }] },
      null,
    );
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.errors).toEqual(
      expect.arrayContaining([
        "owner.name is missing",
        "the owner's phone is missing (the chat has none)",
        'teacher "A": no valid phone',
        'teacher "C": phone 998901112233 is used twice',
        'group "Beginner A": teacher "Z" not in teachers',
      ]),
    );
  });

  it("a center with no branch named gets one", () => {
    const p = planFromDraft({ ...full, branches: undefined, groups: full.groups!.map((g) => ({ ...g, branch: undefined, room: undefined })) }, "901234567");
    expect(p.ok && p.plan.branches).toEqual([{ name: "Asosiy filial", address: null, rooms: [] }]);
  });
});
