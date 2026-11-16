// The lead agent's tools: what the model may ask for, and the code that does it.
//
// The model only ever asks; this code decides. Every write goes through the same services the admin uses
// (createStudentWithFamily, enrollStudent, the Notification queue), so capacity checks, billing, audit and
// parent messages work exactly as for a human admin — with actor AGENT on every audit row and lead note.
// The contact phone lives in the AgentChat row and is never put into anything the model reads.
// What the person sees besides the agent's own words (group cards with a button, a map pin) is rendered
// here by code into ctx.out, so prices, times and addresses are never retyped by the model.
import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { addDays, formatDate, fromISODate, nowTimeHHmm, toISODate, todayISO, weekdayOf, diffDays } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { esc } from "@/lib/messages";
import { appUrl } from "@/lib/env";
import { makeT, type Locale } from "@/lib/i18n";
import { enqueue, staffChat, type Chat } from "@/lib/notify";
import { UserError } from "@/lib/user-error";
import { createStudentWithFamily } from "@/lib/services/students";
import { cancelTrialBooking, enrollStudent } from "@/lib/services/enrollments";
import { AgentToolError, type AgentTool } from "./loop";
import type { PromptState } from "./prompt";

/** The conversation state the tools read and update (a slice of the AgentChat row). */
export interface AgentChatState {
  id: string;
  chatId: string;
  leadId: string | null;
  studentId: string | null;
  /** every student this chat booked */
  studentIds: string[];
  trialGroupId: string | null;
  phone: string | null;
  phoneSource: string | null;
  awaitingPhone: boolean;
}

/** Something to send to the person, in order: the agent's text, a group card, a map pin. */
export type Outbound =
  | { kind: "text"; text: string }
  | { kind: "card"; html: string; groupId: string; button: string }
  | { kind: "venue"; latitude: number; longitude: number; title: string; address: string };

export interface AgentCtx {
  centerId: string;
  chat: AgentChatState;
  /** the person's Telegram name: the lead's name until a student is booked */
  personName: string;
  /** the chat's language: cards and labels rendered by code */
  locale?: Locale;
  /** what this turn sends besides plain replies; texts are added by the service in the same order */
  out?: Outbound[];
  now?: Date;
}

const AGENT = { userId: null, actor: "AGENT" as const };
const SLOT_DAYS = ["Du", "Se", "Chor", "Pay", "Ju", "Sha", "Yak"]; // GroupSlot.weekday 1..7
const WEEKDAYS = ["dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba", "yakshanba"];
const SLOT_DAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEKDAYS_RU = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
/** Cards per show_groups call: more is a wall of messages, not help. */
export const MAX_CARDS = 5;

// ---------------------------------------------------------------- tool definitions (sent to the model)

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "list_groups",
    description:
      "Markazdagi ochiq guruhlar (faqat senga, mijoz ko'rmaydi): kurs, daraja, narx, kunlar va vaqt, filial, o'qituvchi, bo'sh joylar, " +
      "guruh qachon ochilgani (group_started_on yoki group_starts_on) va eng yaqin 3 ta dars (next_lessons, birinchisi eng yaqini). " +
      "Narx, jadval, bo'sh joy yoki sana haqida gapirishdan OLDIN doim shu vositani chaqir. Mijozga ko'rsatish uchun show_groups ishlat.",
    input_schema: {
      type: "object",
      properties: { course: { type: "string", description: "Ixtiyoriy: kurs nomidan bir qism (masalan \"matematika\"). Berilmasa hammasi." } },
      required: [],
    },
  },
  {
    name: "show_groups",
    description:
      `Tanlangan guruhlarni mijozga kartochka qilib yuboradi: kunlar, vaqt, narx, o'qituvchi, manzil, bo'sh joy, eng yaqin dars va "Sinov darsiga yozilish" tugmasi. ` +
      `Ko'pi bilan ${MAX_CARDS} ta, eng moslarini tanla. Kartadagi ma'lumotni matnda qaytadan yozma.`,
    input_schema: {
      type: "object",
      properties: { group_ids: { type: "array", items: { type: "string" }, description: "list_groups natijasidagi id lar" } },
      required: ["group_ids"],
    },
  },
  {
    name: "send_location",
    description: "Filialning xaritadagi joylashuvini mijozga yuboradi (Telegram'da xarita nuqtasi). Faqat promptda \"xaritada joylashuvi bor\" deb belgilangan filial uchun.",
    input_schema: {
      type: "object",
      properties: { branch_id: { type: "string", description: "promptdagi filiallar ro'yxatidagi branch_id" } },
      required: ["branch_id"],
    },
  },
  {
    name: "request_phone",
    description:
      "Mijozga \"Raqamni yuborish\" tugmasini ko'rsatadi. Faqat mijoz sinov darsiga yozilmoqchi bo'lganda chaqir: savollarga javob uchun raqam kerak emas. " +
      "Raqamni matn qilib yozishni so'rama: tugmani bosish kifoya. Raqam olinganda \"[telefon raqam olindi]\" belgisi keladi.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "book_trial",
    description:
      "O'quvchini tanlangan guruhning bepul sinov darsiga yozadi (markaz tizimiga o'quvchi sifatida qo'shadi). " +
      "Faqat telefon raqam olingandan keyin, va mijozga sinov darsining aniq sanasi va vaqtini aytib, roziligini olgandan keyin chaqir. Natijada sana, vaqt va manzil qaytadi.",
    input_schema: {
      type: "object",
      properties: {
        group_id: { type: "string", description: "list_groups natijasidagi id" },
        lesson_date: { type: "string", description: "Mijoz rozi bo'lgan dars sanasi, next_lessons dagi ko'rinishda (masalan \"18.11.2026\"). Berilmasa eng yaqin dars." },
        student_first_name: { type: "string" },
        student_last_name: { type: "string" },
        for_self: { type: "boolean", description: "true: mijoz o'zi o'qiydi; false: farzandi yoki boshqa odam uchun yozilyapti" },
        parent_name: { type: "string", description: "for_self=false bo'lsa: yozayotgan ota-onaning ismi" },
        goal: { type: "string", description: "Nima uchun kelyapti: maktab, olimpiada, DTM va h.k." },
        level_summary: {
          type: "string",
          description: "Berilgan har bir savol va mijozning javobi AYNAN, baholamasdan (masalan: \"2x+6=14, x=? — javob: 5\"). Savol berilmagan bo'lsa: \"savol berilmadi\". O'qituvchi o'zi tekshiradi.",
        },
      },
      required: ["group_id", "student_first_name", "student_last_name", "for_self", "goal", "level_summary"],
    },
  },
  {
    name: "cancel_trial",
    description:
      "Shu suhbatda yozilgan sinov darsini bekor qiladi (joy bo'shaydi, o'qituvchiga xabar boradi). Mijoz voz kechsa yoki boshqa sanaga ko'chirmoqchi bo'lsa chaqir: " +
      "ko'chirish = cancel_trial, keyin yangi lesson_date bilan book_trial. Bekor qilishni administratorga yuborma: o'zing qil.",
    input_schema: {
      type: "object",
      properties: {
        group_id: { type: "string", description: "Bekor qilinadigan sinov darsining guruhi (book_trial dagi group_id)" },
        reason: { type: "string", description: "Mijoz aytgan sabab, qisqa" },
      },
      required: ["group_id", "reason"],
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
      "U javobni shu Telegram chatiga bot orqali yozadi (raqam bo'lsa, qo'ng'iroq ham qilishi mumkin), shuning uchun raqam shart emas. Qoidalarda javobi bor savol uchun chaqirma.",
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

/** Upcoming lessons per group (up to `perGroup`), within 3 weeks; today's count until their start time. */
async function upcomingLessonList(groupIds: string[], now: Date, perGroup = 3): Promise<Map<string, { date: string; startTime: string }[]>> {
  const today = todayISO(now);
  const time = nowTimeHHmm(now);
  const lessons = await db.lesson.findMany({
    where: { groupId: { in: groupIds }, status: { not: "CANCELLED" }, date: { gte: fromISODate(today), lte: fromISODate(addDays(today, 21)) } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    select: { groupId: true, date: true, startTime: true },
  });
  const out = new Map<string, { date: string; startTime: string }[]>();
  for (const l of lessons) {
    const date = toISODate(l.date);
    if (date === today && l.startTime <= time) continue;
    const list = out.get(l.groupId) ?? [];
    if (list.length < perGroup) out.set(l.groupId, [...list, { date, startTime: l.startTime }]);
  }
  return out;
}

/** The first lesson per group that has not started yet. */
async function upcomingLessons(groupIds: string[], now: Date): Promise<Map<string, { date: string; startTime: string }>> {
  const lists = await upcomingLessonList(groupIds, now, 1);
  return new Map([...lists].map(([id, l]) => [id, l[0]]));
}

/** "18.11.2026" → "2026-11-18" (the format list_groups shows the model). */
function parseShownDate(s: string): string | null {
  const m = s.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

async function ownerChats(tx: Tx, centerId: string): Promise<Chat[]> {
  const owners = await tx.user.findMany({ where: { centerId, role: "OWNER", archivedAt: null, telegramChatId: { not: null } }, select: { telegramChatId: true, locale: true } });
  return owners.map((o) => ({ chatId: o.telegramChatId!, locale: o.locale === "ru" ? "ru" : "uz" }));
}

/**
 * The lead for this chat. It exists from the person's first message, with or without a phone, so the
 * center sees everyone who wrote. When a phone arrives it is put on the lead — or, if another open lead
 * already has that number (the public form, an earlier chat), this chat moves to it and the phoneless
 * one is archived: one person, one lead.
 */
export async function ensureLead(ctx: AgentCtx): Promise<string> {
  const phone = ctx.chat.phone;
  if (ctx.chat.leadId && !phone) return ctx.chat.leadId;
  const how = ctx.chat.phoneSource === "telegram" ? "Telegram kontakt" : "qo'lda yozilgan";
  const today = fromISODate(todayISO(ctx.now));
  const leadId = await db.$transaction(async (tx) => {
    const own = ctx.chat.leadId ? await tx.lead.findUnique({ where: { id: ctx.chat.leadId }, select: { id: true, phone: true, nextContactAt: true } }) : null;
    if (own && (!phone || own.phone === phone)) return own.id;
    // a typed number never replaces a number already on the lead; a Telegram-verified one may
    if (own?.phone && ctx.chat.phoneSource !== "telegram") return own.id;
    const other = phone
      ? await tx.lead.findFirst({
          where: { centerId: ctx.centerId, phone, archivedAt: null, stage: { notIn: ["ENROLLED", "LOST"] }, ...(own ? { id: { not: own.id } } : {}) },
          orderBy: { createdAt: "asc" },
        })
      : null;
    if (other) {
      await tx.leadNote.create({ data: { leadId: other.id, text: `🤖 ↻ Telegram'da AI agentga yozdi (raqam: ${how})`, actor: "AGENT" } });
      if (own) {
        await tx.leadNote.updateMany({ where: { leadId: own.id }, data: { leadId: other.id } });
        await tx.agentChat.updateMany({ where: { leadId: own.id }, data: { leadId: other.id } });
        await tx.lead.update({ where: { id: own.id }, data: { archivedAt: new Date() } });
        await audit(tx, { centerId: ctx.centerId, ...AGENT, entity: "Lead", entityId: own.id, action: "merge.agent", after: { into: other.id } });
      }
      return other.id;
    }
    if (own) {
      await tx.lead.update({ where: { id: own.id }, data: { phone, nextContactAt: own.nextContactAt ?? today } });
      await tx.leadNote.create({ data: { leadId: own.id, text: `🤖 Telefon raqam qoldirdi (${how})`, actor: "AGENT" } });
      await audit(tx, { centerId: ctx.centerId, ...AGENT, entity: "Lead", entityId: own.id, action: "update.agent", before: { phone: own.phone }, after: { phone } });
      return own.id;
    }
    const lead = await tx.lead.create({
      data: { centerId: ctx.centerId, name: ctx.personName.slice(0, 120) || "Telegram", phone, source: "Telegram AI", nextContactAt: phone ? today : null },
    });
    await tx.leadNote.create({ data: { leadId: lead.id, text: phone ? `🤖 Telegram'da AI agentga yozdi (raqam: ${how})` : "🤖 Telegram'da AI agentga yozdi (raqam hali yo'q)", actor: "AGENT" } });
    await audit(tx, { centerId: ctx.centerId, ...AGENT, entity: "Lead", entityId: lead.id, action: "create.agent", after: { name: lead.name, phone } });
    return lead.id;
  });
  if (leadId !== ctx.chat.leadId) await saveChat(ctx, { leadId });
  return leadId;
}

/** Students this chat booked (studentIds; studentId for chats from before the list existed). */
function chatStudents(ctx: AgentCtx): string[] {
  return [...new Set([...ctx.chat.studentIds, ...(ctx.chat.studentId ? [ctx.chat.studentId] : [])])];
}

/** The conversation's facts for the state block: phone status and open trial bookings, from the database. */
export async function chatState(ctx: AgentCtx): Promise<PromptState> {
  const students = chatStudents(ctx);
  const today = todayISO(ctx.now);
  const trials = students.length
    ? await db.enrollment.findMany({
        where: { studentId: { in: students }, status: "TRIAL", endDate: null, group: { centerId: ctx.centerId } },
        include: { student: { select: { firstName: true, lastName: true } }, group: { select: { id: true, name: true, branch: { select: { name: true, address: true } } } } },
        orderBy: { startDate: "asc" },
      })
    : [];
  const lessons = trials.length
    ? await db.lesson.findMany({
        where: { OR: trials.map((t) => ({ groupId: t.groupId, date: t.startDate })), status: { not: "CANCELLED" } },
        select: { groupId: true, date: true, startTime: true },
        orderBy: { startTime: "asc" },
      })
    : [];
  return {
    phone: ctx.chat.phone ? (ctx.chat.phoneSource === "telegram" ? "telegram" : "typed") : null,
    trials: trials.map((t) => {
      const date = toISODate(t.startDate);
      const lesson = lessons.find((l) => l.groupId === t.groupId && toISODate(l.date) === date);
      return {
        student: `${t.student.firstName} ${t.student.lastName}`,
        group: t.group.name,
        groupId: t.group.id,
        date: formatDate(date),
        weekday: WEEKDAYS[weekdayOf(date) - 1],
        time: lesson?.startTime ?? "?",
        address: t.group.branch.address ? `${t.group.branch.name}, ${t.group.branch.address}` : t.group.branch.name,
        daysFromToday: diffDays(date, today),
      };
    }),
  };
}

// ---------------------------------------------------------------- executors

type OpenGroup = Awaited<ReturnType<typeof loadGroups>>[number];

async function loadGroups(ctx: AgentCtx, where: { course?: string; ids?: string[] }) {
  return db.group.findMany({
    where: {
      centerId: ctx.centerId,
      status: { in: ["ACTIVE", "PLANNED"] },
      ...(where.ids ? { id: { in: where.ids } } : {}),
      ...(where.course ? { course: { name: { contains: where.course, mode: "insensitive" } } } : {}),
    },
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
}

function priceText(g: OpenGroup, l: Locale): string {
  const price = g.priceOverride ?? g.course.price;
  const cur = l === "ru" ? "сум" : "so'm";
  if (g.course.pricingType === "SUBSCRIPTION") return `${formatMoney(price, cur)} / ${l === "ru" ? "мес" : "oy"}`;
  const what = g.course.packageLessons ? (l === "ru" ? `${g.course.packageLessons} уроков` : `${g.course.packageLessons} dars`) : l === "ru" ? "весь курс" : "butun kurs";
  const split = g.course.installments > 1 ? (l === "ru" ? `, в ${g.course.installments} платежа` : `, ${g.course.installments} bo'lib to'lash`) : "";
  return `${formatMoney(price, cur)} (${what}${split})`;
}

const seatsLeft = (g: OpenGroup) => (g.capacity ? Math.max(0, g.capacity - g._count.enrollments) : null);
const branchText = (g: OpenGroup) => (g.branch.address ? `${g.branch.name}, ${g.branch.address}` : g.branch.name);

async function listGroups(ctx: AgentCtx, input: Record<string, unknown>) {
  const now = ctx.now ?? new Date();
  const course = typeof input.course === "string" && input.course.trim() ? input.course.trim() : undefined;
  const groups = await loadGroups(ctx, { course });
  const today = todayISO(now);
  const next = await upcomingLessonList(groups.map((g) => g.id), now);
  return groups.map((g) => {
    const start = toISODate(g.startDate);
    const seats = seatsLeft(g);
    return {
      id: g.id,
      name: g.name,
      course: g.course.name,
      level: g.course.level,
      price: priceText(g, "uz"),
      schedule: g.slots.map((s) => `${SLOT_DAYS[s.weekday - 1]} ${s.startTime}-${s.endTime}`).join(", "),
      branch: branchText(g),
      teacher: g.teacher.name,
      ...(start <= today ? { group_started_on: formatDate(start) } : { group_starts_on: formatDate(start) }),
      seats_left: seats ?? "cheklanmagan",
      next_lessons: (next.get(g.id) ?? []).map((n) => lessonView(n.date, n.startTime, today)),
    };
  });
}

/** A group card as the person sees it (HTML): every fact comes from the database, none from the model. */
function cardHtml(g: OpenGroup, n: { date: string; startTime: string } | undefined, today: string, l: Locale): string {
  const ru = l === "ru";
  const days = ru ? SLOT_DAYS_RU : SLOT_DAYS;
  const start = toISODate(g.startDate);
  const seats = seatsLeft(g);
  const since = start <= today ? (ru ? `занимается с ${formatDate(start)}` : `${formatDate(start)} dan beri o'qiyapti`) : ru ? `старт ${formatDate(start)}` : `${formatDate(start)} da boshlanadi`;
  const lines = [
    `<b>${esc(g.name)}</b> · ${esc(g.course.name)}`,
    `🗓 ${esc(g.slots.map((s) => `${days[s.weekday - 1]} ${s.startTime}-${s.endTime}`).join(", ") || "—")}`,
    `👩‍🏫 ${esc(g.teacher.name)}`,
    `📍 ${esc(branchText(g))}`,
    `💰 ${esc(priceText(g, l))}`,
    `👥 ${seats === null ? "" : `${ru ? "Свободных мест" : "Bo'sh joy"}: ${seats} · `}${since}`,
  ];
  if (n) lines.push(`➡️ ${ru ? "Ближайший урок" : "Eng yaqin dars"}: ${formatDate(n.date)}, ${(ru ? WEEKDAYS_RU : WEEKDAYS)[weekdayOf(n.date) - 1]} ${n.startTime}`);
  return lines.join("\n");
}

async function showGroups(ctx: AgentCtx, input: Record<string, unknown>) {
  const ids = Array.isArray(input.group_ids) ? [...new Set(input.group_ids.filter((x): x is string => typeof x === "string"))] : [];
  if (ids.length === 0) throw new AgentToolError("'group_ids' bo'sh. list_groups natijasidan id larni ber.");
  if (ids.length > MAX_CARDS) throw new AgentToolError(`Ko'pi bilan ${MAX_CARDS} ta guruh. Eng moslarini tanla.`);
  const now = ctx.now ?? new Date();
  const groups = await loadGroups(ctx, { ids });
  const missing = ids.filter((id) => !groups.some((g) => g.id === id));
  if (missing.length) throw new AgentToolError(`Bunday ochiq guruh yo'q: ${missing.join(", ")}. Id'ni list_groups natijasidan ol.`);
  const next = await upcomingLessons(ids, now);
  const today = todayISO(now);
  const l = ctx.locale ?? "uz";
  for (const id of ids) {
    const g = groups.find((x) => x.id === id)!;
    ctx.out?.push({ kind: "card", html: cardHtml(g, next.get(id), today, l), groupId: id, button: l === "ru" ? "✍️ Записаться на пробный урок" : "✍️ Sinov darsiga yozilish" });
  }
  return { ok: true, shown: ids.map((id) => groups.find((g) => g.id === id)!.name), note: "Kartalar mijozga yuborildi. Ma'lumotni matnda takrorlama." };
}

async function sendLocation(ctx: AgentCtx, input: Record<string, unknown>) {
  const branchId = str(input, "branch_id");
  const b = await db.branch.findFirst({ where: { id: branchId, centerId: ctx.centerId, archivedAt: null } });
  if (!b) throw new AgentToolError("Bunday filial yo'q. branch_id ni promptdagi filiallar ro'yxatidan ol.");
  if (b.latitude === null || b.longitude === null) throw new AgentToolError("Bu filialning xaritadagi joylashuvi kiritilmagan. Manzilni matn bilan ayt.");
  ctx.out?.push({ kind: "venue", latitude: b.latitude, longitude: b.longitude, title: b.name, address: b.address ?? b.name });
  return { ok: true, sent: b.name };
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
  const wanted = typeof input.lesson_date === "string" && input.lesson_date.trim() ? parseShownDate(input.lesson_date) : null;
  if (typeof input.lesson_date === "string" && input.lesson_date.trim() && !wanted) throw new AgentToolError("lesson_date ko'rinishi noto'g'ri: \"18.11.2026\" kabi yoz.");
  const lessons = (await upcomingLessonList([group.id], now, 30)).get(group.id) ?? [];
  const lesson = wanted ? lessons.find((l) => l.date === wanted) : lessons[0];
  if (!lessons.length) throw new AgentToolError("Bu guruhda yaqin 3 haftada dars yo'q. Mijozga boshqa guruhni taklif qil yoki ask_teacher ishlat.");
  if (!lesson) throw new AgentToolError(`Bu guruhda ${input.lesson_date} kuni dars yo'q (yoki boshlanib bo'lgan). Yaqin darslar: ${lessons.slice(0, 3).map((l) => formatDate(l.date)).join(", ")}.`);

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
  if (!ctx.chat.studentIds.includes(studentId)) await saveChat(ctx, { studentIds: [...ctx.chat.studentIds, studentId] });

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

async function cancelTrial(ctx: AgentCtx, input: Record<string, unknown>) {
  const groupId = str(input, "group_id");
  const reason = str(input, "reason").slice(0, 300);
  const students = chatStudents(ctx);
  if (!students.length) throw new AgentToolError("Bu suhbatda yozilgan sinov darsi yo'q.");
  // only a trial this conversation booked, still open
  const e = await db.enrollment.findFirst({
    where: { studentId: { in: students }, groupId, status: "TRIAL", endDate: null, group: { centerId: ctx.centerId } },
    include: { group: { select: { name: true, teacherId: true } } },
  });
  if (!e) throw new AgentToolError("Bu guruhda shu mijozning ochiq sinov darsi yo'q. group_id ni book_trial natijasidan ol.");
  try {
    await cancelTrialBooking({ ...AGENT, centerId: ctx.centerId }, e.id);
  } catch (err) {
    if (err instanceof UserError) throw new AgentToolError("Bu sinov darsini bot bekor qila olmaydi (u bo'lib o'tgan yoki to'lov bor). ask_teacher bilan administratorga yubor.");
    throw err;
  }
  const leadId = await ensureLead(ctx);
  const start = formatDate(toISODate(e.startDate));
  await db.$transaction(async (tx) => {
    await tx.leadNote.create({ data: { leadId, text: `🤖 Sinov darsi bekor qilindi: ${e.group.name} · ${start}\nSabab: ${reason}`, actor: "AGENT" } });
    // no open trial left: the funnel must not show a booking that no longer exists
    const open = await tx.enrollment.count({ where: { studentId: { in: students }, status: "TRIAL", endDate: null } });
    if (!open) await tx.lead.updateMany({ where: { id: leadId, stage: "TRIAL_BOOKED" }, data: { stage: "CONTACTED" } });
    const teacher = await staffChat(tx, e.group.teacherId);
    const chats = teacher ? [teacher] : await ownerChats(tx, ctx.centerId);
    await enqueue(tx, ctx.centerId, chats, (l) =>
      [
        l === "ru" ? `🤖 <b>Пробный урок отменён</b> · ${esc(e.group.name)} · ${start}` : `🤖 <b>Sinov darsi bekor qilindi</b> · ${esc(e.group.name)} · ${start}`,
        esc(reason),
        `${appUrl()}/leads/${leadId}`,
      ].join("\n"),
    );
  });
  if (ctx.chat.trialGroupId === groupId) await saveChat(ctx, { trialGroupId: null });
  return { ok: true, cancelled: e.group.name, lesson_date: start };
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
        `${esc(who)}${lead.phone ? ` · +${lead.phone}` : ""}`,
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
  const leadId = await ensureLead(ctx);
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, select: { name: true, phone: true } });
  const delivered = await db.$transaction(async (tx) => {
    const chats = await ownerChats(tx, ctx.centerId);
    await enqueue(tx, ctx.centerId, chats, (l) =>
      [
        l === "ru" ? "🤖❓ <b>Вопрос клиента</b> (AI-агент не может ответить сам)" : "🤖❓ <b>Mijoz savoli</b> (AI agent o'zi javob bera olmaydi)",
        lead.phone
          ? `${esc(lead.name)} · +${lead.phone}`
          : `${esc(lead.name)} · ${l === "ru" ? "📵 без номера: ответьте со страницы лида, бот передаст" : "📵 raqamsiz: javobni lead sahifasidan yozing, bot yetkazadi"}`,
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
    case "show_groups":
      return showGroups(ctx, input);
    case "send_location":
      return sendLocation(ctx, input);
    case "request_phone":
      return requestPhone(ctx);
    case "book_trial":
      return bookTrial(ctx, input);
    case "cancel_trial":
      return cancelTrial(ctx, input);
    case "notify_teacher":
      return notifyTeacher(ctx, input);
    case "ask_teacher":
      return askTeacher(ctx, input);
    default:
      throw new AgentToolError(`Noma'lum vosita: ${name}`);
  }
}
