// The lead agent's tools: what the model may ask for, and the code that does it.
//
// The model only ever asks; this code decides. Every write goes through the same services the admin uses
// (createStudentWithFamily, enrollStudent, the Notification queue), so capacity checks, billing, audit and
// parent messages work exactly as for a human admin — with actor AGENT on every audit row and lead note.
// The contact phone lives in the AgentChat row and is never put into anything the model reads.
import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { addDays, formatDate, fromISODate, nowTimeHHmm, toISODate, todayISO, weekdayOf, diffDays } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { esc } from "@/lib/messages";
import { appUrl } from "@/lib/env";
import { makeT } from "@/lib/i18n";
import { enqueue, staffChat, type Chat } from "@/lib/notify";
import { UserError } from "@/lib/user-error";
import { createStudentWithFamily } from "@/lib/services/students";
import { enrollStudent } from "@/lib/services/enrollments";
import { AgentToolError, type AgentTool } from "./loop";

/** The conversation state the tools read and update (a slice of the AgentChat row). */
export interface AgentChatState {
  id: string;
  chatId: string;
  leadId: string | null;
  studentId: string | null;
  trialGroupId: string | null;
  phone: string | null;
  phoneSource: string | null;
  awaitingPhone: boolean;
}

export interface AgentCtx {
  centerId: string;
  chat: AgentChatState;
  /** the person's Telegram name: the lead's name until a student is booked */
  personName: string;
  now?: Date;
}

const AGENT = { userId: null, actor: "AGENT" as const };
const SLOT_DAYS = ["Du", "Se", "Chor", "Pay", "Ju", "Sha", "Yak"]; // GroupSlot.weekday 1..7
const WEEKDAYS = ["dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba", "yakshanba"];

// ---------------------------------------------------------------- tool definitions (sent to the model)

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "list_groups",
    description:
      "Markazdagi ochiq guruhlar: kurs, daraja, narx, kunlar va vaqt, filial manzili, o'qituvchi, bo'sh joylar va eng yaqin dars sanasi. " +
      "Narx, jadval, bo'sh joy yoki sana haqida gapirishdan OLDIN doim shu vositani chaqir.",
    input_schema: {
      type: "object",
      properties: { course: { type: "string", description: "Ixtiyoriy: kurs nomidan bir qism (masalan \"matematika\"). Berilmasa hammasi." } },
      required: [],
    },
  },
  {
    name: "request_phone",
    description:
      "Mijozga \"Raqamni yuborish\" tugmasini ko'rsatadi. Sinov darsiga yozish yoki Ustozga savol yuborishdan oldin telefon raqam kerak. " +
      "Raqamni matn qilib yozishni so'rama: tugmani bosish kifoya. Raqam olinganda \"[telefon raqam olindi]\" belgisi keladi.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "book_trial",
    description:
      "O'quvchini tanlangan guruhning eng yaqin bepul sinov darsiga yozadi (markaz tizimiga o'quvchi sifatida qo'shadi). " +
      "Faqat telefon raqam olingandan va mijoz guruhga rozi bo'lgandan keyin chaqir. Natijada aniq sana, vaqt va manzil qaytadi.",
    input_schema: {
      type: "object",
      properties: {
        group_id: { type: "string", description: "list_groups natijasidagi id" },
        student_first_name: { type: "string" },
        student_last_name: { type: "string" },
        for_self: { type: "boolean", description: "true: mijoz o'zi o'qiydi; false: farzandi yoki boshqa odam uchun yozilyapti" },
        parent_name: { type: "string", description: "for_self=false bo'lsa: yozayotgan ota-onaning ismi" },
        goal: { type: "string", description: "Nima uchun kelyapti: maktab, olimpiada, DTM va h.k." },
        level_summary: { type: "string", description: "Suhbatda aniqlangan daraja: qaysi savollarga to'g'ri yoki xato javob berdi. O'qituvchi o'qiydi." },
      },
      required: ["group_id", "student_first_name", "student_last_name", "for_self", "goal", "level_summary"],
    },
  },
  {
    name: "notify_teacher",
    description:
      "Sinov darsiga yozilgan o'quvchi haqida guruh o'qituvchisiga Telegram'da qisqa ma'lumot yuboradi. book_trial dan keyin chaqir. " +
      "Faqat ma'lumot uchun: javob kerak bo'lgan savollar uchun ask_teacher ishlat.",
    input_schema: {
      type: "object",
      properties: { message: { type: "string", description: "3-5 qator: o'quvchi kim, darajasi, darsda nimaga e'tibor berish kerak" } },
      required: ["message"],
    },
  },
  {
    name: "ask_teacher",
    description:
      "Markaz qoidalarida javobi yo'q va qaror talab qiladigan savolni (masalan, yangi vaqtda guruh ochish) markaz egasiga yuboradi. " +
      "U mijozga o'zi qo'ng'iroq qiladi yoki yozadi, shuning uchun avval telefon raqam kerak. Qoidalarda javobi bor savol uchun chaqirma.",
    input_schema: {
      type: "object",
      properties: { question: { type: "string", description: "Savol va qisqa kontekst: kim, qaysi kurs yoki guruh, aynan nima so'rayapti" } },
      required: ["question"],
    },
  },
];

// ---------------------------------------------------------------- helpers

function str(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== "string" || !v.trim()) throw new AgentToolError(`'${key}' parametri berilmagan yoki bo'sh.`);
  return v.trim().slice(0, 1000);
}

async function saveChat(ctx: AgentCtx, data: Partial<AgentChatState>): Promise<void> {
  Object.assign(ctx.chat, data);
  await db.agentChat.update({ where: { id: ctx.chat.id }, data });
}

function lessonView(date: string, startTime: string, today: string) {
  // diffDays(a, b) = a − b in days: 1 = tomorrow
  return { date: formatDate(date), weekday: WEEKDAYS[weekdayOf(date) - 1], time: startTime, days_from_today: diffDays(date, today) };
}

/** First lesson per group that has not started yet (today's lessons count until their start time). */
async function upcomingLessons(groupIds: string[], now: Date): Promise<Map<string, { date: string; startTime: string }>> {
  const today = todayISO(now);
  const time = nowTimeHHmm(now);
  const lessons = await db.lesson.findMany({
    where: { groupId: { in: groupIds }, status: { not: "CANCELLED" }, date: { gte: fromISODate(today), lte: fromISODate(addDays(today, 21)) } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    select: { groupId: true, date: true, startTime: true },
  });
  const first = new Map<string, { date: string; startTime: string }>();
  for (const l of lessons) {
    const date = toISODate(l.date);
    if (first.has(l.groupId) || (date === today && l.startTime <= time)) continue;
    first.set(l.groupId, { date, startTime: l.startTime });
  }
  return first;
}

async function ownerChats(tx: Tx, centerId: string): Promise<Chat[]> {
  const owners = await tx.user.findMany({ where: { centerId, role: "OWNER", archivedAt: null, telegramChatId: { not: null } }, select: { telegramChatId: true, locale: true } });
  return owners.map((o) => ({ chatId: o.telegramChatId!, locale: o.locale === "ru" ? "ru" : "uz" }));
}

/** The lead for this chat: created when the phone first arrives, reused afterwards. Needs the phone. */
export async function ensureLead(ctx: AgentCtx): Promise<string> {
  if (ctx.chat.leadId) return ctx.chat.leadId;
  const phone = ctx.chat.phone;
  if (!phone) throw new AgentToolError("Avval request_phone bilan telefon raqamini oling.");
  const leadId = await db.$transaction(async (tx) => {
    const source = ctx.chat.phoneSource === "telegram" ? "Telegram kontakt" : "qo'lda yozilgan";
    const open = await tx.lead.findFirst({ where: { centerId: ctx.centerId, phone, archivedAt: null, stage: { notIn: ["ENROLLED", "LOST"] } } });
    if (open) {
      await tx.leadNote.create({ data: { leadId: open.id, text: `🤖 ↻ Telegram'da AI agentga yozdi (raqam: ${source})`, actor: "AGENT" } });
      return open.id;
    }
    const lead = await tx.lead.create({
      data: { centerId: ctx.centerId, name: ctx.personName.slice(0, 120) || "Telegram", phone, source: "Telegram AI", nextContactAt: fromISODate(todayISO(ctx.now)) },
    });
    await tx.leadNote.create({ data: { leadId: lead.id, text: `🤖 Telegram'da AI agentga yozdi (raqam: ${source})`, actor: "AGENT" } });
    await audit(tx, { centerId: ctx.centerId, ...AGENT, entity: "Lead", entityId: lead.id, action: "create.agent", after: { name: lead.name, phone } });
    return lead.id;
  });
  await saveChat(ctx, { leadId });
  return leadId;
}

// ---------------------------------------------------------------- executors

async function listGroups(ctx: AgentCtx, input: Record<string, unknown>) {
  const now = ctx.now ?? new Date();
  const course = typeof input.course === "string" && input.course.trim() ? input.course.trim() : undefined;
  const groups = await db.group.findMany({
    where: { centerId: ctx.centerId, status: { in: ["ACTIVE", "PLANNED"] }, ...(course ? { course: { name: { contains: course, mode: "insensitive" } } } : {}) },
    include: {
      course: true,
      branch: { select: { name: true, address: true } },
      teacher: { select: { name: true } },
      slots: { orderBy: [{ weekday: "asc" }, { startTime: "asc" }] },
      _count: { select: { enrollments: { where: { endDate: null, status: { in: ["TRIAL", "ACTIVE", "FROZEN"] } } } } },
    },
    orderBy: { code: "asc" },
    take: 30,
  });
  const today = todayISO(now);
  const next = await upcomingLessons(groups.map((g) => g.id), now);
  return groups.map((g) => {
    const price = g.priceOverride ?? g.course.price;
    const n = next.get(g.id);
    return {
      id: g.id,
      name: g.name,
      course: g.course.name,
      level: g.course.level,
      price:
        g.course.pricingType === "SUBSCRIPTION"
          ? `${formatMoney(price)} / oy`
          : `${formatMoney(price)} (${g.course.packageLessons ? `${g.course.packageLessons} dars` : "butun kurs"}${g.course.installments > 1 ? `, ${g.course.installments} bo'lib to'lash` : ""})`,
      schedule: g.slots.map((s) => `${SLOT_DAYS[s.weekday - 1]} ${s.startTime}-${s.endTime}`).join(", "),
      branch: g.branch.address ? `${g.branch.name}, ${g.branch.address}` : g.branch.name,
      teacher: g.teacher.name,
      seats_left: g.capacity ? Math.max(0, g.capacity - g._count.enrollments) : "cheklanmagan",
      next_lesson: n ? lessonView(n.date, n.startTime, today) : null,
    };
  });
}

async function requestPhone(ctx: AgentCtx) {
  if (ctx.chat.phone) return { ok: true, phone_received: true };
  await saveChat(ctx, { awaitingPhone: true });
  return { ok: true, button_shown: true };
}

async function bookTrial(ctx: AgentCtx, input: Record<string, unknown>) {
  const now = ctx.now ?? new Date();
  if (!ctx.chat.phone) throw new AgentToolError("Avval request_phone bilan telefon raqamini oling.");
  const groupId = str(input, "group_id");
  const firstName = str(input, "student_first_name").slice(0, 60);
  const lastName = str(input, "student_last_name").slice(0, 60);
  const forSelf = input.for_self === true;
  const parentName = typeof input.parent_name === "string" ? input.parent_name.trim().slice(0, 120) : "";
  const goal = str(input, "goal");
  const level = str(input, "level_summary");

  const group = await db.group.findFirst({ where: { id: groupId, centerId: ctx.centerId, status: { in: ["ACTIVE", "PLANNED"] } }, include: { branch: true, teacher: { select: { name: true } } } });
  if (!group) throw new AgentToolError("Bunday guruh yo'q. Id'ni list_groups natijasidan ol.");
  const lesson = (await upcomingLessons([group.id], now)).get(group.id);
  if (!lesson) throw new AgentToolError("Bu guruhda yaqin 3 haftada dars yo'q. Mijozga boshqa guruhni taklif qil yoki ask_teacher ishlat.");

  const leadId = await ensureLead(ctx);
  // Reuse the student only for a retry of the same person (another group after "group full");
  // a second child of the same parent gets its own student.
  let studentId = ctx.chat.studentId;
  if (studentId) {
    const prev = await db.student.findFirst({ where: { id: studentId, centerId: ctx.centerId }, select: { firstName: true, lastName: true } });
    const same = (a: string, b: string) => a.toLocaleLowerCase("uz") === b.toLocaleLowerCase("uz");
    if (!prev || !same(prev.firstName, firstName) || !same(prev.lastName, lastName)) studentId = null;
  }
  if (!studentId) {
    const phone = ctx.chat.phone;
    studentId = await db.$transaction((tx) =>
      createStudentWithFamily(
        tx,
        { ...AGENT, centerId: ctx.centerId },
        {
          firstName,
          lastName,
          phone: forSelf ? phone : null,
          guardianPhone: forSelf ? null : phone,
          guardianName: forSelf ? null : parentName || ctx.personName || null,
          relation: forSelf ? null : "parent",
          branchId: group.branchId,
          source: "Telegram AI",
          leadId,
        },
        // A typed number is unverified: it must never attach a child to someone else's family wallet.
        ctx.chat.phoneSource === "telegram" ? { canJoinFamily: async () => true } : {},
      ),
    );
    await saveChat(ctx, { studentId });
  }

  try {
    await enrollStudent({ ...AGENT, centerId: ctx.centerId }, { studentId, groupId: group.id, startDate: lesson.date, trial: true });
  } catch (e) {
    if (e instanceof UserError) throw new AgentToolError(`${makeT("uz")(e.key, e.vars)}. Mijozga boshqa guruhni taklif qil.`);
    throw e;
  }
  await saveChat(ctx, { trialGroupId: group.id });
  await db.leadNote.create({
    data: { leadId, text: `🤖 Sinov darsi: ${group.name} · ${formatDate(lesson.date)} ${lesson.startTime}\nMaqsad: ${goal}\nDaraja: ${level}`, actor: "AGENT" },
  });
  return {
    ok: true,
    group: group.name,
    trial_lesson: lessonView(lesson.date, lesson.startTime, todayISO(now)),
    address: group.branch.address ? `${group.branch.name}, ${group.branch.address}` : group.branch.name,
    teacher: group.teacher.name,
    price_first_lesson: 0,
  };
}

async function notifyTeacher(ctx: AgentCtx, input: Record<string, unknown>) {
  const message = str(input, "message");
  if (!ctx.chat.trialGroupId) throw new AgentToolError("Avval book_trial bilan sinov darsiga yozing.");
  const leadId = await ensureLead(ctx);
  const [group, lead, student] = await Promise.all([
    db.group.findUniqueOrThrow({ where: { id: ctx.chat.trialGroupId }, select: { name: true, teacherId: true } }),
    db.lead.findUniqueOrThrow({ where: { id: leadId }, select: { name: true, phone: true } }),
    ctx.chat.studentId ? db.student.findUnique({ where: { id: ctx.chat.studentId }, select: { firstName: true, lastName: true } }) : null,
  ]);
  const delivered = await db.$transaction(async (tx) => {
    const teacher = await staffChat(tx, group.teacherId);
    const chats = teacher ? [teacher] : await ownerChats(tx, ctx.centerId);
    const who = student ? `${student.firstName} ${student.lastName}` : lead.name;
    await enqueue(tx, ctx.centerId, chats, (l) =>
      [
        l === "ru" ? `🤖 <b>Новый пробный ученик</b> · ${esc(group.name)}` : `🤖 <b>Yangi sinov o'quvchisi</b> · ${esc(group.name)}`,
        `${esc(who)} · +${lead.phone}`,
        "",
        esc(message),
        "",
        `${appUrl()}/leads/${leadId}`,
      ].join("\n"),
    );
    await tx.leadNote.create({ data: { leadId, text: `🤖 O'qituvchiga: ${message}`, actor: "AGENT" } });
    return chats.length > 0;
  });
  return { ok: true, delivered };
}

async function askTeacher(ctx: AgentCtx, input: Record<string, unknown>) {
  const question = str(input, "question");
  if (!ctx.chat.phone) throw new AgentToolError("Ustoz mijoz bilan bog'lanishi uchun avval request_phone bilan telefon raqamini oling.");
  const leadId = await ensureLead(ctx);
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, select: { name: true, phone: true } });
  const delivered = await db.$transaction(async (tx) => {
    const chats = await ownerChats(tx, ctx.centerId);
    await enqueue(tx, ctx.centerId, chats, (l) =>
      [
        l === "ru" ? "🤖❓ <b>Вопрос клиента</b> (AI-агент не может ответить сам)" : "🤖❓ <b>Mijoz savoli</b> (AI agent o'zi javob bera olmaydi)",
        `${esc(lead.name)} · +${lead.phone}`,
        "",
        esc(question),
        "",
        `${appUrl()}/leads/${leadId}`,
      ].join("\n"),
    );
    await tx.leadNote.create({ data: { leadId, text: `🤖❓ ${question}`, actor: "AGENT" } });
    return chats.length > 0;
  });
  // honest about the channel: without a linked owner chat the question waits on the lead page
  return delivered ? { ok: true, delivered: true } : { ok: true, delivered: false, note: "Ustozga Telegram ulanmagan: savol lead sahifasiga yozildi, administrator ko'radi." };
}

/** Run one tool call for this chat. */
export function executeTool(ctx: AgentCtx, name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "list_groups":
      return listGroups(ctx, input);
    case "request_phone":
      return requestPhone(ctx);
    case "book_trial":
      return bookTrial(ctx, input);
    case "notify_teacher":
      return notifyTeacher(ctx, input);
    case "ask_teacher":
      return askTeacher(ctx, input);
    default:
      throw new AgentToolError(`Noma'lum vosita: ${name}`);
  }
}
