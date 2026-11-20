// Center setup in the bot chat, end to end on the real database with a scripted model (no API cost):
// sales → application → team approves → setup mode → draft → files → summary → team → a real center with
// lessons, salary rules, students. Plus: no AI while an application waits or after a refusal, the per-chat cap.
// Run: npm run test:integration
import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import type { CreateMessage } from "@/lib/agent/loop";
import { buildCtx, loadUser } from "@/lib/ctx-core";
import { ACCESS_APPROVED_MARK, decideAccess, handleSalesMessage, openSalesChat, recordOnboardingFile, recordSalesPhone, salesText } from "@/lib/sales-agent/service";
import { planFromDraft, readOnboarding, type OnboardingFile } from "@/lib/sales-agent/onboarding";
import { createCenterFromPlan } from "@/lib/sales-agent/create-center";
import { importStudents } from "@/app/(admin)/students/import/import-core";

type Block = Anthropic.Beta.BetaContentBlock;
const msg = (content: Block[], stop: Anthropic.Beta.BetaMessage["stop_reason"]) =>
  ({ id: "m", type: "message", role: "assistant", model: "test", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 10 } }) as unknown as Anthropic.Beta.BetaMessage;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as unknown as Block;
let n = 0;
const call = (name: string, input: object = {}) => ({ type: "tool_use", id: `toolu_o${++n}`, name, input }) as unknown as Block;

function model(...answers: Anthropic.Beta.BetaMessage[]) {
  const seen: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[] = [];
  const create: CreateMessage = async (p) => {
    seen.push(structuredClone(p));
    const a = answers.shift();
    if (!a) throw new Error("scripted model ran out of answers");
    return a;
  };
  return { create, seen, left: () => answers.length };
}

const uniq = String(Date.now()).slice(-6);
const ownerPhone = `99890${uniq}1`;
const draft = {
  center: { name: `Onboarding Test ${uniq}`, city: "Toshkent" },
  owner: { name: "Dilnoza Karimova" },
  branches: [{ name: "Chilonzor", rooms: ["1-xona"] }],
  courses: [{ name: "Ingliz tili", pricing: "monthly", price: 400000, lessonsPerWeek: 3 }],
  teachers: [{ name: "Aziz Rahimov", phone: `99891${uniq}2`, salary: { model: "PERCENT_EARNED", percent: 40 } }],
  groups: [
    { name: "Beginner A", course: "Ingliz tili", teacher: "Aziz Rahimov", days: [1, 3, 5], startTime: "09:00", endTime: "10:30", room: "1-xona" },
    { name: "Kids", course: "Ingliz tili", teacher: "Dilnoza Karimova", days: [6], startTime: "10:00", endTime: "11:30" },
  ],
  students: { count: 2, source: "file" },
  rules: { trialLessons: 2, excusedAbsenceCredit: true },
};

describe("center setup in the bot chat", () => {
  it("application → approval → draft and files → summary → team → a real center", async () => {
    const chat = await openSalesChat(`95${uniq}01`, { name: "Dilnoza Karimova", username: "dilnoza_k" });
    const sent: { html: string; access?: string }[] = [];
    let filesToTeam: OnboardingFile[] = [];
    const m = model(
      // sales mode: wants to try → application without a phone is refused → asks for the phone
      msg([call("request_access", { schoolName: draft.center.name, link: "https://instagram.com/bilim_markazi", ownerName: "Dilnoza Karimova", city: "Toshkent" })], "tool_use"),
      msg([call("request_phone")], "tool_use"),
      msg([text("Raqamingizni tugma bilan yuboring.")], "end_turn"),
      // phone arrives → the application goes to the team
      msg([call("request_access", { schoolName: draft.center.name, link: "https://instagram.com/bilim_markazi", ownerName: "Dilnoza Karimova", city: "Toshkent" })], "tool_use"),
      msg([text("Rahmat! Jamoamiz tekshiradi, tasdiqlagach shu yerda davom etamiz.")], "end_turn"),
      // approved: setup mode starts
      msg([text("Ajoyib! Nechta filialingiz bor?")], "end_turn"),
      msg([call("save_onboarding", draft)], "tool_use"),
      msg([text("Rahmat! O'quvchilar ro'yxatini fayl qilib yuboring.")], "end_turn"),
      msg([text("Fayl olindi, rahmat!")], "end_turn"),
      msg([text("Mana xulosa:"), call("show_summary")], "tool_use"),
      msg([text("To'g'rimi?")], "end_turn"),
      msg([call("finish_onboarding")], "tool_use"),
      msg([text("Rahmat! Jamoamiz markazingizni ochadi.")], "end_turn"),
    );
    const turn = (s: string) =>
      handleSalesMessage({
        chatRowId: chat.id,
        text: s,
        locale: "uz",
        notifyTeam: async (html, opts) => (sent.push({ html, access: opts?.accessFor }), 9000 + sent.length),
        sendFilesToTeam: async (f) => void (filesToTeam = f),
        create: m.create,
      });
    const onb = async () => readOnboarding((await db.salesChat.findUniqueOrThrow({ where: { id: chat.id } })).onboarding);

    expect((await turn("Sinab ko'rmoqchiman. Bilim markazi, instagram.com/bilim_markazi, Dilnoza")).askPhone).toBe(true);
    expect(m.seen[0].tools!.map((t) => (t as { name: string }).name)).toEqual(["request_phone", "notify_team", "request_access"]);
    const refused = m.seen[1].messages.filter((x) => x.role === "user").at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(refused[0].is_error).toBe(true);
    expect(sent).toHaveLength(0);

    await recordSalesPhone(chat.id, ownerPhone);
    await turn("[telefon raqam olindi]");
    expect(sent).toHaveLength(1);
    expect(sent[0].access).toBe(chat.id);
    expect(sent[0].html).toContain("🆕 Sabaq: sinab ko'rish so'rovi");
    expect(sent[0].html).toContain("https://instagram.com/bilim_markazi");
    expect(sent[0].html).toContain(`+${ownerPhone}`);
    expect((await onb()).status).toBe("pending");

    // waiting for the team: a fixed answer, the model is not called
    const calls = m.seen.length;
    expect((await turn("Qachon tasdiqlaysiz?")).replies).toEqual([salesText("pending", "uz")]);
    expect(m.seen).toHaveLength(calls);

    expect(await decideAccess(chat.id, true, "Sarvar @akbarov")).not.toBeNull();
    expect(await decideAccess(chat.id, false, "someone else")).toBeNull();
    expect(await onb()).toMatchObject({ status: "collecting", reviewedBy: "Sarvar @akbarov" });

    await turn(ACCESS_APPROVED_MARK);
    // setup mode: its own prompt and tools; the application's answers are already in the draft
    const setupCall = m.seen[calls];
    expect((setupCall.system as Anthropic.Beta.BetaTextBlockParam[])[0].text).toContain("save_onboarding");
    expect(setupCall.tools!.map((t) => (t as { name: string }).name)).toEqual(["request_phone", "notify_team", "save_onboarding", "show_summary", "finish_onboarding"]);
    expect((await onb()).draft.center).toMatchObject({ name: draft.center.name, link: "https://instagram.com/bilim_markazi" });

    await turn("Bitta filial, Chilonzor ...");
    expect((await onb()).draft.groups).toHaveLength(2);

    const marker = await recordOnboardingFile(chat.id, { kind: "document", fileId: "BQAC-test", name: "oquvchilar.xlsx", mime: "application/vnd.ms-excel", size: 2048, messageId: 77, caption: "hamma guruhlar", at: new Date().toISOString() });
    expect(marker).toBe("[fayl olindi: oquvchilar.xlsx (application/vnd.ms-excel) — izoh: «hamma guruhlar»]");
    await turn(marker!);

    const shown = await turn("Bo'ldi, hammasi shu");
    expect(shown.replies[0]).toBe("Mana xulosa:");
    expect(shown.replies[1]).toContain("📋 Markazingiz ma'lumotlari");
    expect(shown.replies[1]).toContain("oquvchilar.xlsx");
    expect(shown.replies[1]).toContain("instagram.com/bilim_markazi");
    expect(shown.replies[1]).not.toContain("Hali kerak");

    await turn("Ha, to'g'ri");
    expect(m.left()).toBe(0);
    expect(sent).toHaveLength(2);
    expect(sent[1].html).toContain("🏫 Sabaq: markaz sozlash so'rovi");
    expect(sent[1].html).toContain(`create-from-onboarding.ts ${chat.id}`);
    expect(sent[1].access).toBeUndefined();
    expect(filesToTeam.map((f) => f.messageId)).toEqual([77]);
    const done = await db.salesChat.findUniqueOrThrow({ where: { id: chat.id } });
    expect(readOnboarding(done.onboarding).status).toBe("submitted");
    expect(done.teamMessageIds).toEqual([9001, 9002]);
    // the owner's phone never reached the model
    expect(JSON.stringify(m.seen)).not.toContain(ownerPhone);

    // the team: plan → center
    const p = planFromDraft(readOnboarding(done.onboarding).draft, done.phone);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const made = await createCenterFromPlan(p.plan, { plan: "PRO", source: "test" });
    const center = await db.center.findUniqueOrThrow({ where: { id: made.centerId }, include: { branches: { include: { rooms: true } }, groups: { include: { slots: true, _count: { select: { lessons: true } } } }, users: { include: { salaryRules: true } } } });
    expect(center.plan).toBe("PRO");
    expect(center.settings).toMatchObject({ trialLessons: 2, excusedAbsenceCredit: true });
    expect(center.branches[0].rooms.map((r) => r.name)).toEqual(["1-xona"]);
    const owner = center.users.find((u) => u.role === "OWNER")!;
    expect(owner).toMatchObject({ phone: ownerPhone, isTeacher: true, mustChangePassword: true });
    const teacher = center.users.find((u) => u.role === "TEACHER")!;
    expect(teacher.salaryRules[0]).toMatchObject({ model: "PERCENT_EARNED", percent: 40 });
    const beginner = center.groups.find((g) => g.name === "Beginner A")!;
    expect(beginner.slots).toHaveLength(3);
    expect(beginner.roomId).toBe(center.branches[0].rooms[0].id);
    expect(beginner._count.lessons).toBeGreaterThan(10);
    expect(center.groups.find((g) => g.name === "Kids")!.teacherId).toBe(owner.id);
    expect(made.groups.map((g) => g.code)).toEqual([1, 2]);

    // the same phones cannot open a second center
    await expect(createCenterFromPlan(p.plan, { source: "test" })).rejects.toThrow(/already have an account/);

    // students through the usual import, by group code
    const ctx = buildCtx((await loadUser(owner.id))!, { locale: "uz" });
    const csv = `Familiya,Ism,Telefon,Ota-ona telefoni,Guruh kodi,Balans\nValiyev,Ali,,99893${uniq}3,1,-400000\nKarimova,Laylo,,99893${uniq}4,2,0\n`;
    const r = await importStudents(ctx, csv, false);
    expect(r.errors).toEqual([]);
    expect(r.created).toBe(2);
  });

  it("a rejected application gets a polite fixed answer and no AI from then on", async () => {
    const chat = await openSalesChat(`95${uniq}02`);
    await db.salesChat.update({ where: { id: chat.id }, data: { onboarding: { status: "pending", draft: {}, files: [] } } });
    expect(await decideAccess(chat.id, false, "Sarvar")).not.toBeNull();
    const m = model();
    const r = await handleSalesMessage({ chatRowId: chat.id, text: "Nega?", locale: "ru", notifyTeam: async () => 1, create: m.create });
    expect(r.replies).toEqual([salesText("rejected", "ru")]);
    expect(m.seen).toHaveLength(0);
    // files are ignored outside the setup
    expect(await recordOnboardingFile(chat.id, { kind: "photo", fileId: "x", name: "a.jpg", mime: null, size: null, messageId: 1, caption: null, at: "" })).toBeNull();
  });

  it("before approval one chat can only spend so much", async () => {
    const chat = await openSalesChat(`95${uniq}03`);
    await db.salesChat.update({ where: { id: chat.id }, data: { inputTokens: 10_000_000 } });
    const m = model();
    const r = await handleSalesMessage({ chatRowId: chat.id, text: "Yana bir savol", locale: "uz", notifyTeam: async () => 1, create: m.create });
    expect(r.replies).toEqual([salesText("chatCap", "uz")]);
    expect(m.seen).toHaveLength(0);
  });
});
