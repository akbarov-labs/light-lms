// Center setup in the bot chat. First a short application (school, its Instagram/Telegram link, the owner's
// name and phone) that the team approves with a button, so strangers cannot fill the database or burn AI
// credits; then the owner answers Sabaq's AI assistant question by question (and sends files), the answers
// become a draft on their SalesChat, the owner confirms a summary, the team checks it and
// scripts/create-from-onboarding.ts turns it into a real center. Pure functions here (tested); the agent's
// side is in service.ts, the Telegram side in src/worker/bot/sales.ts.
//
// Money and people never go in unchecked: the AI only fills the draft; prices, salary rules and the student
// list reach the database after a person on the team has read the summary.
import { z } from "zod";
import { normalizePhone } from "@/lib/phone";
import { validSlot, type WeeklySlot } from "@/lib/schedule";
import { SALARY_MODELS, normalizeRule, type SalaryModel } from "@/lib/salary/models";

// ---------------------------------------------------------------- the draft

const str = (max = 120) => z.string().trim().min(1).max(max);
const optStr = (max = 300) => z.string().trim().max(max).optional();
const money = z.number().int().min(0).max(1_000_000_000);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const salary = z.object({
  model: z.enum(SALARY_MODELS as [SalaryModel, ...SalaryModel[]]),
  percent: z.number().int().min(0).max(100).optional(),
  fixedAmount: money.optional(),
  perLesson: money.optional(),
});

export const draftSchema = z.object({
  center: z.object({ name: optStr(120), city: optStr(80), phone: optStr(30), link: optStr(300) }).optional(),
  owner: z.object({ name: optStr(120), role: optStr(80) }).optional(),
  branches: z.array(z.object({ name: str(), address: optStr(), rooms: z.array(str(60)).max(50).optional() })).max(20).optional(),
  courses: z
    .array(
      z.object({
        name: str(),
        pricing: z.enum(["monthly", "package"]),
        price: money,
        lessonsPerWeek: z.number().int().min(1).max(21).optional(),
        lessonMinutes: z.number().int().min(15).max(600).optional(),
        packageLessons: z.number().int().min(1).max(1000).optional(),
      }),
    )
    .max(100)
    .optional(),
  teachers: z.array(z.object({ name: str(), phone: optStr(30), salary: salary.optional() })).max(200).optional(),
  groups: z
    .array(
      z.object({
        name: str(),
        course: str(),
        teacher: str(),
        branch: optStr(120),
        room: optStr(60),
        days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
        startTime: time,
        endTime: time,
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    )
    .max(300)
    .optional(),
  students: z.object({ count: z.number().int().min(0).max(100_000).optional(), source: z.enum(["file", "photo", "typed", "later"]).optional(), note: optStr(1000) }).optional(),
  rules: z
    .object({
      trialLessons: z.number().int().min(0).max(10).optional(),
      excusedAbsenceCredit: z.boolean().optional(),
      payFromCollected: z.boolean().optional(),
      reminderDaysBefore: z.number().int().min(0).max(15).optional(),
      other: optStr(1500),
    })
    .optional(),
  homework: z.object({ wanted: z.boolean().optional(), note: optStr(1000) }).optional(),
  notes: z.array(str(500)).max(50).optional(),
});
export type OnboardingDraft = z.infer<typeof draftSchema>;
export const DRAFT_SECTIONS = Object.keys(draftSchema.shape) as (keyof OnboardingDraft)[];

export interface OnboardingFile {
  kind: "document" | "photo";
  fileId: string;
  name: string;
  mime: string | null;
  size: number | null;
  /** the person's message in the private chat: copied to the team chat as it is */
  messageId: number;
  caption: string | null;
  at: string;
}

/**
 * none → pending (application sent) → collecting (team approved) → submitted (owner confirmed) → created;
 * pending → rejected. While pending or rejected the model is not called at all.
 */
export type OnboardingStatus = "none" | "pending" | "rejected" | "collecting" | "submitted" | "created";

export interface Onboarding {
  status: OnboardingStatus;
  draft: OnboardingDraft;
  files: OnboardingFile[];
  appliedAt?: string;
  /** who pressed approve/reject in the team chat, and when */
  reviewedBy?: string;
  reviewedAt?: string;
  submittedAt?: string;
  centerId?: string;
}

export function readOnboarding(raw: unknown): Onboarding {
  const o = (raw ?? {}) as Partial<Onboarding>;
  const draft = draftSchema.safeParse(o.draft ?? {});
  return {
    status: (["pending", "rejected", "collecting", "submitted", "created"] as const).find((s) => s === o.status) ?? "none",
    draft: draft.success ? draft.data : {},
    files: Array.isArray(o.files) ? o.files : [],
    ...Object.fromEntries((["appliedAt", "reviewedBy", "reviewedAt", "submittedAt", "centerId"] as const).filter((k) => o[k]).map((k) => [k, o[k]])),
  };
}

/**
 * The model sends whole sections: a list replaces the list it had (so it can fix or remove an item by
 * sending the corrected list), an object is merged field by field. Returns the new draft, or the reasons
 * the patch was refused, in words the model can act on.
 */
export function mergeDraft(draft: OnboardingDraft, patch: unknown): { ok: true; draft: OnboardingDraft } | { ok: false; errors: string[] } {
  if (!patch || typeof patch !== "object") return { ok: false, errors: ["bo'sh: kamida bitta bo'lim yubor"] };
  const next: Record<string, unknown> = { ...draft };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!(DRAFT_SECTIONS as string[]).includes(k)) return { ok: false, errors: [`noma'lum bo'lim: ${k}`] };
    if (v === null) delete next[k];
    else if (Array.isArray(v)) next[k] = v;
    else if (typeof v === "object") next[k] = { ...((next[k] as object) ?? {}), ...v };
    else return { ok: false, errors: [`${k}: ro'yxat yoki obyekt bo'lishi kerak`] };
  }
  const parsed = draftSchema.safeParse(next);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`) };
  return { ok: true, draft: parsed.data };
}

// ---------------------------------------------------------------- what is still missing

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** What the team needs before a center can be created, in Uzbek for the model and the summary. */
export function missingItems(d: OnboardingDraft, hasOwnerPhone: boolean): string[] {
  const m: string[] = [];
  if (!d.center?.name) m.push("markaz nomi");
  if (!d.owner?.name) m.push("egasining ismi");
  if (!hasOwnerPhone) m.push("egasining telefon raqami (tugma orqali)");
  if (!d.courses?.length) m.push("kamida bitta kurs va narxi");
  if (!d.teachers?.length) m.push("o'qituvchilar");
  if (!d.groups?.length) m.push("guruhlar (kurs, o'qituvchi, kunlar, vaqt)");
  const courses = new Set((d.courses ?? []).map((c) => norm(c.name)));
  const teachers = new Set((d.teachers ?? []).map((t) => norm(t.name)));
  const branches = new Set((d.branches ?? []).map((b) => norm(b.name)));
  for (const g of d.groups ?? []) {
    if (!courses.has(norm(g.course))) m.push(`«${g.name}» guruhining kursi «${g.course}» kurslar ro'yxatida yo'q`);
    if (!teachers.has(norm(g.teacher)) && norm(g.teacher) !== norm(d.owner?.name ?? "")) m.push(`«${g.name}» guruhining o'qituvchisi «${g.teacher}» o'qituvchilar ro'yxatida yo'q`);
    if (g.branch && !branches.has(norm(g.branch))) m.push(`«${g.name}» guruhining filiali «${g.branch}» filiallar ro'yxatida yo'q`);
    if (g.startTime >= g.endTime) m.push(`«${g.name}»: tugash vaqti boshlanishidan keyin bo'lsin`);
  }
  for (const t of d.teachers ?? []) {
    if (!t.phone || !normalizePhone(t.phone)) m.push(`${t.name}: telefon raqami (tizimga kirish uchun)`);
    if (!t.salary) m.push(`${t.name}: oylik qanday hisoblanadi`);
  }
  for (const c of d.courses ?? []) if (c.pricing === "package" && !c.packageLessons) m.push(`«${c.name}» paketida nechta dars`);
  if (!d.students?.source) m.push("o'quvchilar ro'yxati (Excel fayl, rasm yoki keyinroq)");
  return m;
}

// ---------------------------------------------------------------- summary

const PRICING = { monthly: "oylik", package: "paket" } as const;
const DAYS = ["", "Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
const MODEL_TEXT: Record<SalaryModel, string> = {
  PERCENT_EARNED: "foiz",
  FIXED: "belgilangan oylik",
  PER_LESSON: "har dars uchun",
  BASE_PLUS_PERCENT: "oylik + foiz",
};
const sum = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} so'm`;

function salaryText(s: z.infer<typeof salary>): string {
  const r = normalizeRule(s.model, s);
  const parts = [r.fixedAmount !== null ? sum(r.fixedAmount) : null, r.percent !== null ? `${r.percent}%` : null, r.perLesson !== null ? `${sum(r.perLesson)} / dars` : null].filter(Boolean);
  return `${MODEL_TEXT[s.model]}: ${parts.join(" + ")}`;
}

const yesNo = (b: boolean | undefined) => (b === undefined ? "—" : b ? "ha" : "yo'q");

/** Plain text for the owner (no markdown: Telegram shows it as written). */
export function draftSummary(d: OnboardingDraft, files: OnboardingFile[], hasOwnerPhone: boolean): string {
  const L: string[] = ["📋 Markazingiz ma'lumotlari", ""];
  L.push(`Markaz: ${d.center?.name ?? "—"}${d.center?.city ? `, ${d.center.city}` : ""}${d.center?.link ? ` (${d.center.link})` : ""}`);
  L.push(`Egasi: ${d.owner?.name ?? "—"}${d.owner?.role ? ` (${d.owner.role})` : ""} · telefon: ${hasOwnerPhone ? "olingan" : "—"}`);
  if (d.branches?.length) L.push("", "Filiallar:", ...d.branches.map((b) => `- ${b.name}${b.address ? `, ${b.address}` : ""}${b.rooms?.length ? ` (xonalar: ${b.rooms.join(", ")})` : ""}`));
  L.push("", "Kurslar:", ...(d.courses?.length ? d.courses.map((c) => `- ${c.name}: ${sum(c.price)} (${PRICING[c.pricing]}${c.pricing === "package" && c.packageLessons ? `, ${c.packageLessons} dars` : ""}${c.lessonsPerWeek ? `, haftasiga ${c.lessonsPerWeek} dars` : ""}${c.lessonMinutes ? `, ${c.lessonMinutes} daqiqa` : ""})`) : ["- —"]));
  L.push("", "O'qituvchilar:", ...(d.teachers?.length ? d.teachers.map((t) => `- ${t.name}${t.phone ? `, ${t.phone}` : ""} — ${t.salary ? salaryText(t.salary) : "oylik: —"}`) : ["- —"]));
  L.push("", "Guruhlar:", ...(d.groups?.length ? d.groups.map((g) => `- ${g.name}: ${g.course}, ${g.teacher}, ${g.days.map((x) => DAYS[x]).join("/")} ${g.startTime}–${g.endTime}${g.room ? `, ${g.room}` : ""}${g.branch ? `, ${g.branch}` : ""}${g.startDate ? `, ${g.startDate} dan` : ""}`) : ["- —"]));
  const st = d.students;
  L.push("", `O'quvchilar: ${st?.count ? `~${st.count} ta, ` : ""}${{ file: "fayl bilan", photo: "rasm bilan", typed: "chatda yozildi", later: "keyinroq" }[st?.source ?? "later"] ?? "—"}${st?.note ? ` (${st.note})` : ""}`);
  const r = d.rules;
  L.push("", "Qoidalar:", `- bepul sinov darslari: ${r?.trialLessons ?? "—"}`, `- sababli qoldirilgan dars pulini qaytarish: ${yesNo(r?.excusedAbsenceCredit)}`, `- o'qituvchiga oylik: ${r?.payFromCollected === undefined ? "—" : r.payFromCollected ? "yig'ilgan puldan" : "o'tilgan darslardan"}`, `- to'lov eslatmasi: ${r?.reminderDaysBefore !== undefined ? `${r.reminderDaysBefore} kun oldin` : "—"}`);
  if (r?.other) L.push(`- boshqa: ${r.other}`);
  if (d.homework?.wanted !== undefined || d.homework?.note) L.push("", `Uy vazifasi: ${yesNo(d.homework?.wanted)}${d.homework?.note ? ` (${d.homework.note})` : ""}`);
  if (files.length) L.push("", `Fayllar: ${files.length} ta (${files.map((f) => f.name).join(", ").slice(0, 300)})`);
  if (d.notes?.length) L.push("", "Izohlar:", ...d.notes.map((n) => `- ${n}`));
  const missing = missingItems(d, hasOwnerPhone);
  if (missing.length) L.push("", "Hali kerak:", ...missing.map((x) => `- ${x}`));
  return L.join("\n");
}

// ---------------------------------------------------------------- the plan for creating the center

export interface CenterPlan {
  center: { name: string; phone: string | null };
  owner: { name: string; phone: string; teaches: boolean };
  branches: { name: string; address: string | null; rooms: string[] }[];
  courses: { name: string; pricingType: "SUBSCRIPTION" | "PACKAGE"; price: number; lessonsPerWeek: number | null; lessonMinutes: number; packageLessons: number | null }[];
  teachers: { name: string; phone: string; salary: ReturnType<typeof normalizeRule> | null }[];
  groups: { name: string; course: number; teacher: number | "owner"; branch: number; room: string | null; slots: WeeklySlot[]; startDate: string | null }[];
  settings: { trialLessons?: number; excusedAbsenceCredit?: boolean; payFromCollected?: boolean; reminderDaysBefore?: number };
}

/**
 * The draft checked and resolved into what the create script writes: names turned into indexes, phones
 * normalized, slots built. Every problem is listed at once, so the team fixes the draft in one go.
 */
export function planFromDraft(d: OnboardingDraft, ownerPhone: string | null): { ok: true; plan: CenterPlan } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const phone = normalizePhone(ownerPhone ?? "");
  if (!d.center?.name) errors.push("center.name is missing");
  if (!d.owner?.name) errors.push("owner.name is missing");
  if (!phone) errors.push("the owner's phone is missing (the chat has none)");
  const branches = (d.branches?.length ? d.branches : [{ name: "Asosiy filial" }]).map((b) => ({ name: b.name, address: "address" in b ? (b.address ?? null) : null, rooms: "rooms" in b ? (b.rooms ?? []) : [] }));
  const courses = (d.courses ?? []).map((c) => ({
    name: c.name,
    pricingType: c.pricing === "package" ? ("PACKAGE" as const) : ("SUBSCRIPTION" as const),
    price: c.price,
    lessonsPerWeek: c.lessonsPerWeek ?? null,
    lessonMinutes: c.lessonMinutes ?? 90,
    packageLessons: c.pricing === "package" ? (c.packageLessons ?? null) : null,
  }));
  courses.forEach((c) => c.pricingType === "PACKAGE" && !c.packageLessons && errors.push(`course "${c.name}": a package needs packageLessons`));
  const seenPhones = new Set(phone ? [phone] : []);
  const teachers = (d.teachers ?? []).map((t) => {
    const p = normalizePhone(t.phone ?? "");
    if (!p) errors.push(`teacher "${t.name}": no valid phone`);
    else if (seenPhones.has(p)) errors.push(`teacher "${t.name}": phone ${p} is used twice`);
    else seenPhones.add(p);
    return { name: t.name, phone: p ?? "", salary: t.salary ? normalizeRule(t.salary.model, t.salary) : null };
  });
  const find = <T extends { name: string }>(list: T[], name: string) => list.findIndex((x) => norm(x.name) === norm(name));
  let ownerTeaches = false;
  const groups = (d.groups ?? []).map((g) => {
    const course = find(courses, g.course);
    if (course < 0) errors.push(`group "${g.name}": course "${g.course}" not in courses`);
    let teacher: number | "owner" = find(teachers, g.teacher);
    if (teacher < 0 && d.owner?.name && norm(d.owner.name) === norm(g.teacher)) {
      teacher = "owner";
      ownerTeaches = true;
    }
    if (teacher === -1) errors.push(`group "${g.name}": teacher "${g.teacher}" not in teachers`);
    const branch = g.branch ? find(branches, g.branch) : 0;
    if (branch < 0) errors.push(`group "${g.name}": branch "${g.branch}" not in branches`);
    if (g.room && branch >= 0 && find(branches[branch].rooms.map((name) => ({ name })), g.room) < 0) branches[branch].rooms.push(g.room);
    const slots = [...new Set(g.days)].sort().map((weekday) => ({ weekday, startTime: g.startTime, endTime: g.endTime }));
    if (!slots.every(validSlot)) errors.push(`group "${g.name}": bad time ${g.startTime}–${g.endTime}`);
    return { name: g.name, course, teacher, branch: Math.max(branch, 0), room: g.room ?? null, slots, startDate: g.startDate ?? null };
  });
  if (!courses.length) errors.push("no courses");
  if (!groups.length) errors.push("no groups");
  if (errors.length) return { ok: false, errors };
  const r = d.rules ?? {};
  const settings = Object.fromEntries(Object.entries({ trialLessons: r.trialLessons, excusedAbsenceCredit: r.excusedAbsenceCredit, payFromCollected: r.payFromCollected, reminderDaysBefore: r.reminderDaysBefore }).filter(([, v]) => v !== undefined));
  return {
    ok: true,
    plan: {
      center: { name: d.center!.name!, phone: normalizePhone(d.center?.phone ?? "") },
      owner: { name: d.owner!.name!, phone: phone!, teaches: ownerTeaches },
      branches,
      courses,
      teachers,
      groups: groups as CenterPlan["groups"],
      settings,
    },
  };
}
