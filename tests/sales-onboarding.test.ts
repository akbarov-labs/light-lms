// Center setup in the bot chat, end to end on the real database with a scripted model (no API cost):
// sales → setup mode → draft → files → summary → team → a real center with lessons, salary rules, students.
// Run: npm run test:integration
import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import type { CreateMessage } from "@/lib/agent/loop";
import { buildCtx, loadUser } from "@/lib/ctx-core";
import { handleSalesMessage, openSalesChat, recordOnboardingFile, recordSalesPhone } from "@/lib/sales-agent/service";
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
  it("collects a draft and files, shows the summary, sends it to the team, and the team opens a real center", async () => {
    const chat = await openSalesChat(`95${uniq}01`, { name: "Dilnoza Karimova", username: "dilnoza_k" });
    const sent: string[] = [];
    let filesToTeam: OnboardingFile[] = [];
    const m = model(
      // sales mode: the owner wants to start, agrees to set it up here
      msg([call("start_onboarding")], "tool_use"),
      msg([text("Ajoyib! Markazingiz nomi va shahri qanday?")], "end_turn"),
      // setup mode: everything in one save (a real chat takes many turns)
      msg([call("save_onboarding", draft)], "tool_use"),
      msg([text("Rahmat! O'quvchilar ro'yxatini fayl qilib yuboring.")], "end_turn"),
      // a file arrives
      msg([text("Fayl olindi, rahmat!")], "end_turn"),
      // summary, then finish too early (no phone)
      msg([text("Mana xulosa:"), call("show_summary")], "tool_use"),
      msg([text("To'g'rimi?")], "end_turn"),
      msg([call("finish_onboarding")], "tool_use"),
      msg([call("request_phone")], "tool_use"),
      msg([text("Avval raqamingizni tugma bilan yuboring.")], "end_turn"),
      // phone arrives, finish works
      msg([call("finish_onboarding")], "tool_use"),
      msg([text("Rahmat! Jamoamiz markazingizni ochadi.")], "end_turn"),
    );
    const turn = (s: string) =>
      handleSalesMessage({ chatRowId: chat.id, text: s, locale: "uz", notifyTeam: async (h) => (sent.push(h), 9000 + sent.length), sendFilesToTeam: async (f) => void (filesToTeam = f), create: m.create });

    await turn("Markazimni ulamoqchiman");
    expect(readOnboarding((await db.salesChat.findUniqueOrThrow({ where: { id: chat.id } })).onboarding).status).toBe("collecting");
    expect(m.seen[0].tools!.map((t) => (t as { name: string }).name)).toContain("start_onboarding");

    await turn("Bilim markazi, Toshkent ...");
    // the next turn ran in setup mode: its own prompt and tools
    const setupCall = m.seen[2];
    expect((setupCall.system as Anthropic.Beta.BetaTextBlockParam[])[0].text).toContain("save_onboarding");
    expect(setupCall.tools!.map((t) => (t as { name: string }).name)).toEqual(["request_phone", "notify_team", "save_onboarding", "show_summary", "finish_onboarding"]);
    const stored = readOnboarding((await db.salesChat.findUniqueOrThrow({ where: { id: chat.id } })).onboarding);
    expect(stored.draft.groups).toHaveLength(2);

    const marker = await recordOnboardingFile(chat.id, { kind: "document", fileId: "BQAC-test", name: "oquvchilar.xlsx", mime: "application/vnd.ms-excel", size: 2048, messageId: 77, caption: "hamma guruhlar", at: new Date().toISOString() });
    expect(marker).toBe("[fayl olindi: oquvchilar.xlsx (application/vnd.ms-excel) — izoh: «hamma guruhlar»]");
    await turn(marker!);

    const shown = await turn("Bo'ldi, hammasi shu");
    expect(shown.replies[0]).toBe("Mana xulosa:");
    expect(shown.replies[1]).toContain("📋 Markazingiz ma'lumotlari");
    expect(shown.replies[1]).toContain("oquvchilar.xlsx");
    expect(shown.replies[1]).toContain("egasining telefon raqami");

    const early = await turn("Ha, to'g'ri");
    expect(early.askPhone).toBe(true);
    // the model was told why it could not finish yet
    const refused = m.seen[8].messages.filter((x) => x.role === "user").at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(refused[0].is_error).toBe(true);
    expect(sent).toHaveLength(0);

    await recordSalesPhone(chat.id, ownerPhone);
    await turn("[telefon raqam olindi]");
    expect(m.left()).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("🏫 Sabaq: markaz sozlash so'rovi");
    expect(sent[0]).toContain(`+${ownerPhone}`);
    expect(sent[0]).toContain(`create-from-onboarding.ts ${chat.id}`);
    expect(filesToTeam.map((f) => f.messageId)).toEqual([77]);
    const done = await db.salesChat.findUniqueOrThrow({ where: { id: chat.id } });
    expect(readOnboarding(done.onboarding).status).toBe("submitted");
    expect(done.teamMessageIds).toContain(9001);
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
});
