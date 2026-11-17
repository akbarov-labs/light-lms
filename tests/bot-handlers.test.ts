// Telegram bot handlers (src/worker/bot/index.ts) end to end: real grammY routing and the real
// database, with the Telegram API replaced by a recorder. Run: npm run test:integration
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";
import { db } from "@/lib/db";
import { addDays, fromISODate, todayISO } from "@/lib/dates";
import { UserError } from "@/lib/user-error";
import { createBot, saveErrorText } from "@/worker/bot";
import { B } from "@/worker/bot/texts";

const today = todayISO();
// chat id = Telegram user id in a private chat
const PARENT = 920000001;
const TEACHER = 920000002;
const OWNER = 920000003;
const OTHER_TEACHER = 920000004;
const STRANGER = 920000005;
const PHONE = { parent: "998936660101", teacher: "998936660202", owner: "998936660303", other: "998936660404" };

let bot: Bot;
let calls: { method: string; payload: Record<string, unknown> }[] = [];
let update = 1;
let centerId = "";
let teacherId = "";
let groupId = "";
let lessonToday = "";
let lessonTomorrow = "";
let otherLesson = "";
let ali = "";
let laylo = "";
let richFails = false;

function chat(id: number, type: "private" | "group" = "private") {
  return type === "private" ? { id, type, first_name: "T" } : { id: -id, type, title: "G" };
}
function from(id: number, lang = "uz") {
  return { id, is_bot: false, first_name: "T", language_code: lang };
}
function message(user: number, extra: Record<string, unknown>, opts: { lang?: string; chatType?: "private" | "group" } = {}): Update {
  return { update_id: update++, message: { message_id: update, date: 0, chat: chat(user, opts.chatType), from: from(user, opts.lang), ...extra } } as unknown as Update;
}
const text = (user: number, t: string, opts?: { lang?: string }) => message(user, { text: t }, opts);
const command = (user: number, cmd: string, opts?: { lang?: string; chatType?: "private" | "group" }) =>
  message(user, { text: `/${cmd}`, entities: [{ type: "bot_command", offset: 0, length: cmd.length + 1 }] }, opts);
const contact = (user: number, phone: string, owner = user, lang = "uz") =>
  message(user, { contact: { phone_number: phone, first_name: "T", user_id: owner } }, { lang });
function callback(user: number, data: string): Update {
  return {
    update_id: update++,
    callback_query: { id: String(update), from: from(user), chat_instance: "1", data, message: { message_id: 77, date: 0, chat: chat(user), text: "x" } },
  } as unknown as Update;
}

async function send(u: Update) {
  calls = [];
  await bot.handleUpdate(u);
  return calls;
}
const replies = () => calls.filter((c) => c.method === "sendMessage");
const lastReply = () => replies().at(-1)!;
const answer = () => calls.find((c) => c.method === "answerCallbackQuery");
type Btn = { text: string; callback_data?: string; url?: string; request_contact?: boolean };
const buttons = (c: { payload: Record<string, unknown> }) => ((c.payload.reply_markup as { keyboard?: Btn[][]; inline_keyboard?: Btn[][] })?.keyboard ?? (c.payload.reply_markup as { inline_keyboard?: Btn[][] })?.inline_keyboard ?? []).flat();
const labels = (c: { payload: Record<string, unknown> }) => buttons(c).map((b) => b.text);

beforeAll(async () => {
  const c = await db.center.create({ data: { name: "Bot handler markazi", slug: "bot-handlers", phone: "998712223344" } });
  centerId = c.id;
  const branch = await db.branch.create({ data: { centerId, name: "Yunusobod", address: "Amir Temur 5" } });
  const hash = await bcrypt.hash("x-password-1", 4);
  const teacher = await db.user.create({ data: { centerId, phone: PHONE.teacher, name: "Malika Teacher", passwordHash: hash, role: "TEACHER", isTeacher: true, perms: [] } });
  const other = await db.user.create({ data: { centerId, phone: PHONE.other, name: "Other Teacher", passwordHash: hash, role: "TEACHER", isTeacher: true, perms: [] } });
  await db.user.create({ data: { centerId, phone: PHONE.owner, name: "Owner", passwordHash: hash, role: "OWNER", perms: [] } });
  teacherId = teacher.id;
  const course = await db.course.create({ data: { centerId, name: "IELTS", pricingType: "SUBSCRIPTION", price: 500_000 } });
  const group = await db.group.create({ data: { centerId, branchId: branch.id, courseId: course.id, teacherId, code: 1, name: "IELTS-1 bot", startDate: fromISODate(addDays(today, -40)) } });
  groupId = group.id;
  const otherGroup = await db.group.create({ data: { centerId, branchId: branch.id, courseId: course.id, teacherId: other.id, code: 2, name: "IELTS-2 bot", startDate: fromISODate(addDays(today, -40)) } });
  lessonToday = (await db.lesson.create({ data: { groupId, date: fromISODate(today), startTime: "15:00", endTime: "16:30", teacherId } })).id;
  lessonTomorrow = (await db.lesson.create({ data: { groupId, date: fromISODate(addDays(today, 1)), startTime: "15:00", endTime: "16:30", teacherId } })).id;
  otherLesson = (await db.lesson.create({ data: { groupId: otherGroup.id, date: fromISODate(today), startTime: "17:00", endTime: "18:30", teacherId: other.id } })).id;

  const fam = await db.family.create({ data: { centerId, name: "Rahimovlar" } });
  await db.guardian.create({ data: { familyId: fam.id, name: "Jamshid Rahimov", phone: PHONE.parent, isPrimary: true } });
  const start = fromISODate(addDays(today, -30));
  for (const [first, last] of [["Ali", "Rahimov"], ["Laylo", "Rahimova"]] as const) {
    const s = await db.student.create({ data: { centerId, familyId: fam.id, branchId: branch.id, firstName: first, lastName: last } });
    await db.enrollment.create({ data: { studentId: s.id, groupId, startDate: start, activatedAt: start, status: "ACTIVE" } });
    if (first === "Ali") ali = s.id;
    else laylo = s.id;
  }
  await db.ledgerEntry.create({ data: { centerId, familyId: fam.id, type: "PAYMENT", amount: 150_000, method: "CASH", description: "Naqd", date: fromISODate(addDays(today, -5)) } });

  bot = createBot("123:test");
  bot.botInfo = { id: 1, is_bot: true, first_name: "LMS", username: "lms_test_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as Bot["botInfo"];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "sendRichMessage" && richFails) return { ok: false, error_code: 400, description: "Bad Request: rich messages are not supported" } as never;
    const result = method === "sendMessage" || method === "sendRichMessage" ? { message_id: 1, date: 0, chat: { id: 1, type: "private" }, text: "" } : true;
    return { ok: true, result } as never;
  });
});

beforeEach(() => {
  calls = [];
});

describe("linking", () => {
  it("/start from an unknown chat asks for the phone with a contact button", async () => {
    await send(command(STRANGER, "start"));
    expect(lastReply().payload.text).toBe(B.welcome.uz);
    expect(buttons(lastReply())).toEqual([expect.objectContaining({ text: B.shareContact.uz, request_contact: true })]);
  });

  it("/start answers in Russian when Telegram's language is ru", async () => {
    await send(command(STRANGER, "start", { lang: "ru" }));
    expect(lastReply().payload.text).toBe(B.welcome.ru);
  });

  it("someone else's contact card links nothing", async () => {
    await send(contact(STRANGER, PHONE.parent, PARENT));
    expect(lastReply().payload.text).toBe(B.ownContact.uz);
    expect(await db.telegramLink.count({ where: { chatId: String(STRANGER) } })).toBe(0);
  });

  it("an unknown phone is told to contact the center and the keyboard is removed", async () => {
    await send(contact(STRANGER, "+998 93 000 00 00"));
    expect(lastReply().payload.text).toBe(B.notFound.uz);
    expect(lastReply().payload.reply_markup).toEqual({ remove_keyboard: true });
  });

  it("a guardian's own contact links the chat and shows only the family menu", async () => {
    await send(contact(PARENT, "+998 93 666 01 01"));
    expect(lastReply().payload.text).toBe(B.linked.uz);
    const l = labels(lastReply());
    expect(l).toEqual(expect.arrayContaining([B.balanceBtn.uz, B.scheduleBtn.uz, B.attendanceBtn.uz, B.paymentsBtn.uz, B.centerBtn.uz]));
    expect(l).not.toContain(B.todayBtn.uz);
    expect(l).not.toContain(B.reportBtn.uz);
    expect(await db.guardian.count({ where: { phone: PHONE.parent, telegramChatId: String(PARENT) } })).toBe(1);
  });

  it("a teacher gets the teacher menu, an owner the report button", async () => {
    await send(contact(TEACHER, PHONE.teacher, TEACHER, "ru"));
    expect(lastReply().payload.text).toBe(B.linked.ru);
    expect(labels(lastReply())).toEqual([B.todayBtn.ru, B.salaryBtn.ru, B.weekBtn.ru]);
    await send(contact(OWNER, PHONE.owner));
    expect(labels(lastReply())).toEqual([B.reportBtn.uz]);
    await send(contact(OTHER_TEACHER, PHONE.other));
  });

  it("/start from a linked chat goes straight to the menu", async () => {
    await send(command(PARENT, "start"));
    expect(lastReply().payload.text).toBe(B.linked.uz);
    expect(labels(lastReply())).toContain(B.balanceBtn.uz);
  });

  it("/lang switches the chat's language and the menu with it, and back", async () => {
    await send(command(PARENT, "lang"));
    expect(lastReply().payload.text).toBe(B.lang.ru);
    expect(labels(lastReply())).toContain(B.balanceBtn.ru);
    expect((await db.telegramLink.findFirst({ where: { chatId: String(PARENT) } }))?.locale).toBe("ru");
    // the stored locale wins over Telegram's language from now on
    await send(command(PARENT, "start", { lang: "uz" }));
    expect(lastReply().payload.text).toBe(B.linked.ru);
    await send(command(PARENT, "lang"));
    expect(lastReply().payload.text).toBe(B.lang.uz);
  });
});

describe("parent menu", () => {
  it("balance replies in HTML with the family's children and no pay button without Payme", async () => {
    await send(text(PARENT, B.balanceBtn.uz));
    const r = lastReply();
    expect(r.payload.parse_mode).toBe("HTML");
    expect(r.payload.text).toContain(B.balance.uz);
    expect(r.payload.text).toContain("Rahimov Ali");
    expect(r.payload.text).toContain("Rahimova Laylo");
    expect(r.payload.reply_markup).toBeUndefined();
  });

  it("the Russian button label works the same as the Uzbek one", async () => {
    await send(text(PARENT, B.balanceBtn.ru));
    expect(lastReply().payload.text).toContain("Rahimov Ali");
  });

  it("schedule, attendance, payments and center each answer", async () => {
    await send(text(PARENT, B.scheduleBtn.uz));
    expect(lastReply().payload.text).toContain("IELTS-1 bot");
    expect(lastReply().payload.text).not.toContain("IELTS-2 bot");
    await send(text(PARENT, B.attendanceBtn.uz));
    expect(lastReply().payload.text).toContain(B.attendance.uz);
    await send(text(PARENT, B.paymentsBtn.uz));
    expect(lastReply().payload.text).toContain("150");
    await send(text(PARENT, B.centerBtn.uz));
    expect(lastReply().payload.text).toContain("Bot handler markazi");
    expect(lastReply().payload.text).toContain("Amir Temur 5");
  });

  it("attendance as a rich message when TELEGRAM_RICH_MESSAGES=true, the plain text when Telegram refuses it", async () => {
    process.env.TELEGRAM_RICH_MESSAGES = "true";
    try {
      await send(text(PARENT, B.attendanceBtn.uz));
      expect(calls.map((c) => c.method)).toEqual(["sendRichMessage"]);
      const html = (calls[0].payload.rich_message as { html: string }).html;
      expect(html).toContain(`<h3>✅ ${B.attendance.uz} (30)</h3>`);
      expect(html).toContain("<h4>👤 Rahimov Ali");
      richFails = true;
      await send(text(PARENT, B.attendanceBtn.uz));
      expect(calls.map((c) => c.method)).toEqual(["sendRichMessage", "sendMessage"]);
      expect(lastReply().payload.text).toContain(B.attendance.uz);
    } finally {
      delete process.env.TELEGRAM_RICH_MESSAGES;
      richFails = false;
    }
    await send(text(PARENT, B.attendanceBtn.uz));
    expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
  });

  it("an unlinked chat pressing a family button is told to /start", async () => {
    await send(text(STRANGER, B.balanceBtn.uz));
    expect(lastReply().payload.text).toBe(B.notLinked.uz);
  });

  it("free text gets the hint and the menu again", async () => {
    await send(text(PARENT, "salom"));
    expect(lastReply().payload.text).toBe(B.notLinked.uz);
    expect(labels(lastReply())).toContain(B.balanceBtn.uz);
  });

  it("teacher and owner buttons are refused to a parent", async () => {
    for (const btn of [B.todayBtn.uz, B.weekBtn.uz, B.salaryBtn.uz, B.reportBtn.uz]) {
      await send(text(PARENT, btn));
      expect(lastReply().payload.text).toBe(B.forbidden.uz);
    }
  });
});

describe("teacher menu", () => {
  it("today's lessons are the teacher's own, one inline button each", async () => {
    await send(text(TEACHER, B.todayBtn.ru));
    expect(lastReply().payload.text).toBe(B.pickLesson.ru);
    expect(buttons(lastReply())).toEqual([{ text: "15:00 IELTS-1 bot", callback_data: `L:${lessonToday}` }]);
  });

  it("week and salary answer for the teacher", async () => {
    await send(text(TEACHER, B.weekBtn.ru));
    expect(lastReply().payload.text).toContain("IELTS-1 bot");
    expect(lastReply().payload.text).not.toContain("IELTS-2 bot");
    await send(text(TEACHER, B.salaryBtn.ru));
    expect(lastReply().payload.text).toContain(B.salaryNow.ru);
    expect(lastReply().payload.text).toContain("сум");
  });

  it("a teacher with no lessons today is told so", async () => {
    await db.lesson.update({ where: { id: lessonToday }, data: { status: "CANCELLED" } });
    await send(text(TEACHER, B.todayBtn.ru));
    expect(lastReply().payload.text).toBe(B.noLessons.ru);
    await db.lesson.update({ where: { id: lessonToday }, data: { status: "SCHEDULED" } });
  });

  it("an archived teacher loses the teacher menu at once", async () => {
    await db.user.update({ where: { id: teacherId }, data: { archivedAt: new Date() } });
    await send(text(TEACHER, B.todayBtn.ru));
    // refused in the chat's language; the stale link is dropped on this update
    expect(lastReply().payload.text).toBe(B.forbidden.ru);
    expect(await db.telegramLink.count({ where: { chatId: String(TEACHER) } })).toBe(0);
    await db.user.update({ where: { id: teacherId }, data: { archivedAt: null } });
    await send(contact(TEACHER, PHONE.teacher, TEACHER, "ru"));
    expect(labels(lastReply())).toContain(B.todayBtn.ru);
  });
});

describe("attendance from the bot", () => {
  it("opening a lesson shows the roster, everyone present until changed", async () => {
    await send(callback(TEACHER, `L:${lessonToday}`));
    expect(answer()).toBeTruthy();
    const r = lastReply();
    expect(r.payload.text).toContain("IELTS-1 bot");
    expect(buttons(r)).toEqual([
      { text: `Rahimov Ali — ${B.status.ru.PRESENT}`, callback_data: `A:${lessonToday}:${ali}` },
      { text: `Rahimova Laylo — ${B.status.ru.PRESENT}`, callback_data: `A:${lessonToday}:${laylo}` },
      { text: B.save.ru, callback_data: `S:${lessonToday}` },
    ]);
  });

  it("tapping a student cycles the status and redraws the keyboard", async () => {
    await send(callback(TEACHER, `A:${lessonToday}:${laylo}`));
    const edit = calls.find((c) => c.method === "editMessageReplyMarkup")!;
    expect(labels(edit)).toContain(`Rahimova Laylo — ${B.status.ru.ABSENT}`);
    await send(callback(TEACHER, `A:${lessonToday}:${laylo}`));
    expect(labels(calls.find((c) => c.method === "editMessageReplyMarkup")!)).toContain(`Rahimova Laylo — ${B.status.ru.LATE}`);
    await send(callback(TEACHER, `A:${lessonToday}:${laylo}`));
    await send(callback(TEACHER, `A:${lessonToday}:${laylo}`));
    expect(labels(calls.find((c) => c.method === "editMessageReplyMarkup")!)).toContain(`Rahimova Laylo — ${B.status.ru.PRESENT}`);
    await send(callback(TEACHER, `A:${lessonToday}:${laylo}`)); // → ABSENT for the save below
  });

  it("a button targets its student even after the roster changed under the open message", async () => {
    // a new student whose name sorts first joins while the roster is open: positions shift by one
    const fam = await db.family.create({ data: { centerId, name: "Abdullayevlar" } });
    const s = await db.student.create({ data: { centerId, familyId: fam.id, firstName: "Bobur", lastName: "Abdullayev" } });
    const e = await db.enrollment.create({ data: { studentId: s.id, groupId, startDate: fromISODate(addDays(today, -1)), activatedAt: fromISODate(addDays(today, -1)), status: "ACTIVE" } });
    await send(callback(TEACHER, `A:${lessonToday}:${ali}`));
    const l = labels(calls.find((c) => c.method === "editMessageReplyMarkup")!);
    expect(l).toContain(`Rahimov Ali — ${B.status.ru.ABSENT}`);
    expect(l).toContain(`Abdullayev Bobur — ${B.status.ru.PRESENT}`);
    expect(l).toContain(`Rahimova Laylo — ${B.status.ru.ABSENT}`);
    await send(callback(TEACHER, `A:${lessonToday}:${ali}`));
    await send(callback(TEACHER, `A:${lessonToday}:${ali}`));
    await send(callback(TEACHER, `A:${lessonToday}:${ali}`)); // back to PRESENT
    // an old position-based button (or a student who left) changes nothing
    await send(callback(TEACHER, `A:${lessonToday}:0`));
    expect(labels(calls.find((c) => c.method === "editMessageReplyMarkup")!)).toContain(`Abdullayev Bobur — ${B.status.ru.PRESENT}`);
    await db.enrollment.delete({ where: { id: e.id } });
  });

  it("save writes the attendance, clears the keyboard and confirms", async () => {
    await send(callback(TEACHER, `S:${lessonToday}`));
    expect(answer()!.payload.text).toBe(B.saved.ru);
    expect(calls.find((c) => c.method === "editMessageReplyMarkup")!.payload.reply_markup).toBeUndefined();
    expect(lastReply().payload.text).toBe(B.saved.ru);
    const rows = await db.attendance.findMany({ where: { lessonId: lessonToday }, select: { studentId: true, status: true, markedById: true } });
    expect(rows.sort((a, b) => a.studentId.localeCompare(b.studentId))).toEqual(
      [
        { studentId: ali, status: "PRESENT", markedById: teacherId },
        { studentId: laylo, status: "ABSENT", markedById: teacherId },
      ].sort((a, b) => a.studentId.localeCompare(b.studentId)),
    );
  });

  it("reopening a saved lesson starts from what was saved", async () => {
    await send(callback(TEACHER, `L:${lessonToday}`));
    expect(labels(lastReply())).toContain(`Rahimova Laylo — ${B.status.ru.ABSENT}`);
  });

  it("today's list marks a lesson that already has attendance", async () => {
    await send(text(TEACHER, B.todayBtn.ru));
    expect(labels(lastReply())).toEqual(["15:00 IELTS-1 bot ✓"]);
  });

  it("a failed save shows the translated reason, not an error key", async () => {
    await send(callback(TEACHER, `S:${lessonTomorrow}`));
    expect(answer()!.payload).toMatchObject({ text: "Нельзя отметить посещаемость будущего урока", show_alert: true });
    expect(await db.attendance.count({ where: { lessonId: lessonTomorrow } })).toBe(0);
  });

  it("another teacher's lesson, a forged id, a parent or a stranger are all refused", async () => {
    for (const [user, data] of [
      [TEACHER, `L:${otherLesson}`],
      [TEACHER, `S:${otherLesson}`],
      [TEACHER, "S:not-a-lesson"],
      [TEACHER, "S"],
      [OTHER_TEACHER, `S:${lessonToday}`],
      [PARENT, `S:${lessonToday}`],
      [STRANGER, `A:${lessonToday}:${ali}`],
    ] as const) {
      await send(callback(user, data));
      expect(answer()!.payload.text, `${user} ${data}`).toBe(user === TEACHER ? B.forbidden.ru : B.forbidden.uz);
      expect(replies()).toEqual([]);
    }
    expect(await db.attendance.count({ where: { lessonId: otherLesson } })).toBe(0);
  });
});

describe("owner report", () => {
  it("an owner gets the report; a teacher is refused", async () => {
    await send(text(OWNER, B.reportBtn.uz));
    expect(lastReply().payload.text).not.toBe(B.forbidden.uz);
    expect(lastReply().payload.parse_mode).toBe("HTML");
    await send(text(TEACHER, B.reportBtn.ru));
    expect(lastReply().payload.text).toBe(B.forbidden.ru);
  });
});

describe("staff answer a customer's question by replying in Telegram", () => {
  it("a reply to the bot's own question notice reaches the customer; a teacher, or the same text quoted from elsewhere, does not", async () => {
    // a customer's agent chat and lead, as ask_teacher leaves them
    const lead = await db.lead.create({ data: { centerId, name: "Mijoz", source: "Telegram AI" } });
    const agentChat = await db.agentChat.create({ data: { centerId, chatId: "939800001", leadId: lead.id, lastMessageAt: new Date() } });
    const notice = `🤖❓ Mijoz savoli (AI agent o'zi javob bera olmaydi)\nMijoz · 📵 raqamsiz\n\nShanba guruh bormi?\n\n↩️ Mijozga javob berish uchun shu xabarga reply qiling: bot yetkazadi.\nhttp://localhost:3010/leads/${lead.id}?chat=${agentChat.id}`;
    const replyTo = (user: number, t: string, quoted: string, quotedFrom = 1) =>
      message(user, { text: t, reply_to_message: { message_id: 5, date: 0, chat: chat(user), from: { id: quotedFrom, is_bot: quotedFrom === 1, first_name: "X" }, text: quoted } });
    await send(replyTo(OWNER, "Ha, shanba 10:00 da bor", notice));
    expect(lastReply().payload.text).toBe(B.answerSent.uz);
    expect(await db.notification.findFirst({ where: { centerId, chatId: "939800001", text: "Ha, shanba 10:00 da bor" } })).not.toBeNull();
    // a teacher has no "leads" permission
    await send(replyTo(TEACHER, "men javob beraman", notice));
    expect([B.forbidden.uz, B.forbidden.ru]).toContain(lastReply().payload.text); // the teacher's chat switched to Russian earlier
    // the notice's text quoted from someone else's message is not the bot's: ordinary text, nothing forwarded
    await send(replyTo(OWNER, "boshqa gap", notice, OWNER));
    expect(lastReply().payload.text).not.toBe(B.answerSent.uz);
    expect(await db.notification.count({ where: { centerId, chatId: "939800001" } })).toBe(1);
  });
});

describe("password reset code", () => {
  it("a linked staff chat gets a code and a reset row", async () => {
    const before = await db.passwordReset.count({ where: { userId: teacherId } });
    await send(command(TEACHER, "parol"));
    expect(lastReply().payload.text).toMatch(/<b>\d{6}<\/b>/);
    expect(await db.passwordReset.count({ where: { userId: teacherId } })).toBe(before + 1);
  });

  it("a parent is told it is for staff, and a group chat is ignored", async () => {
    await send(command(PARENT, "reset"));
    expect(lastReply().payload.text).toBe(B.resetNotStaff.uz);
    await send(command(TEACHER, "parol", { chatType: "group" }));
    expect(replies()).toEqual([]);
  });
});

describe("saveErrorText", () => {
  it("translates expected errors and hides unexpected ones", () => {
    expect(saveErrorText(new UserError("error.notCovered"), "uz")).toBe("O'quvchi bu sanada guruhda emas");
    const err = console.error;
    console.error = () => {};
    try {
      expect(saveErrorText(new Error('relation "x" does not exist'), "ru")).toBe("Произошла ошибка");
    } finally {
      console.error = err;
    }
  });
});
