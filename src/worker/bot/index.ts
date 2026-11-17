// Telegram bot (grammY, long polling) — HANDOFF §9.
import { Bot, InlineKeyboard, Keyboard, type Context } from "grammy";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { formatMoney } from "@/lib/money";
import { esc } from "@/lib/messages";
import { todayISO } from "@/lib/dates";
import { saveAttendance, type AttendanceStatus } from "@/lib/services/attendance";
import { lessonRoster } from "@/lib/roster";
import { liveSalary } from "@/lib/salary/service";
import { makeT, type Locale } from "@/lib/i18n";
import { UserError } from "@/lib/user-error";
import { ownerReport } from "../jobs";
import { createResetCodeForChat } from "@/lib/auth/password";
import { B, buttonKey } from "./texts";
import { appUrl, telegramRichMessages } from "@/lib/env";
import { richRefused } from "../notifications";
import {
  attendanceReply,
  balanceText,
  centerText,
  chatLocale,
  chatRoles,
  linkChat,
  paymentsText,
  scheduleText,
  setChatLocale,
  teacherLessonsToday,
  teacherWeekText,
} from "./data";

const CYCLE: AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];

/** The Mini App URL, or null: Telegram opens Mini Apps only over HTTPS. */
export function miniAppUrl(): string | null {
  const base = appUrl();
  return base.startsWith("https://") ? `${base}/tg` : null;
}
/** Unsaved attendance per chat + lesson (single worker process, so memory is enough). */
const drafts = new Map<string, Map<string, AttendanceStatus>>();
/** Abandoned drafts are never saved; keep the newest ones only. */
const MAX_DRAFTS = 500;

function remember(key: string, draft: Map<string, AttendanceStatus>) {
  drafts.set(key, draft);
  while (drafts.size > MAX_DRAFTS) drafts.delete(drafts.keys().next().value!);
}

/** What the teacher sees when saving fails: the translated reason, never an internal message. */
export function saveErrorText(e: unknown, l: Locale): string {
  if (e instanceof UserError) return makeT(l)(e.key, e.vars).slice(0, 200);
  console.error("[bot] attendance save failed", e);
  return makeT(l)("error.generic");
}

async function localeOf(ctx: Context): Promise<Locale> {
  const chatId = String(ctx.chat?.id ?? "");
  return (await chatLocale(chatId)) ?? (ctx.from?.language_code === "ru" ? "ru" : "uz");
}

async function menu(chatId: string, l: Locale): Promise<Keyboard> {
  const roles = await chatRoles(chatId);
  const kb = new Keyboard();
  if (roles.family) kb.text(B.balanceBtn[l]).text(B.scheduleBtn[l]).row().text(B.attendanceBtn[l]).text(B.paymentsBtn[l]).text(B.centerBtn[l]).row();
  if (roles.teacher) kb.text(B.todayBtn[l]).text(B.salaryBtn[l]).text(B.weekBtn[l]).row();
  if (roles.owner) kb.text(B.reportBtn[l]).row();
  return kb.resized();
}

function rosterKeyboard(lessonId: string, rows: { studentId: string; name: string }[], draft: Map<string, AttendanceStatus>, l: Locale) {
  const kb = new InlineKeyboard();
  // by student id, not position: the roster can change while the message is open
  rows.forEach((r) => kb.text(`${r.name} — ${B.status[l][draft.get(r.studentId) ?? "PRESENT"]}`, `A:${lessonId}:${r.studentId}`).row());
  return kb.text(B.save[l], `S:${lessonId}`);
}

async function teacherFor(chatId: string) {
  return (await chatRoles(chatId)).teacher;
}

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    const l = await localeOf(ctx);
    const chatId = String(ctx.chat.id);
    const roles = await chatRoles(chatId);
    if (roles.family || roles.teacher || roles.owner) {
      await ctx.reply(B.linked[l], { reply_markup: await menu(chatId, l) });
      return;
    }
    await ctx.reply(B.welcome[l], { reply_markup: new Keyboard().requestContact(B.shareContact[l]).resized().oneTime() });
  });

  bot.command("lang", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const next: Locale = (await localeOf(ctx)) === "uz" ? "ru" : "uz";
    await setChatLocale(chatId, next);
    await ctx.reply(B.lang[next], { reply_markup: await menu(chatId, next) });
  });

  // staff password reset: the code goes only to the chat already linked to that staff phone
  bot.command(["parol", "reset"], async (ctx) => {
    const l = await localeOf(ctx);
    if (ctx.chat.type !== "private") return;
    const r = await createResetCodeForChat(String(ctx.chat.id));
    if (!r) return void (await ctx.reply(B.resetNotStaff[l]));
    await ctx.reply(B.resetCode[l].replace("{code}", r.code), { parse_mode: "HTML" });
  });

  bot.on("message:contact", async (ctx) => {
    const l: Locale = ctx.from.language_code === "ru" ? "ru" : "uz";
    const contact = ctx.message.contact;
    if (contact.user_id !== ctx.from.id) {
      await ctx.reply(B.ownContact[l]);
      return;
    }
    const phone = normalizePhone(contact.phone_number);
    const chatId = String(ctx.chat.id);
    const linked = phone ? await linkChat(chatId, phone, l) : { guardians: 0, students: 0, staff: [] };
    if (!linked.guardians && !linked.students && linked.staff.length === 0) {
      await ctx.reply(B.notFound[l], { reply_markup: { remove_keyboard: true } });
      return;
    }
    await ctx.reply(B.linked[l], { reply_markup: await menu(chatId, l) });
    const app = miniAppUrl();
    if (app && (linked.guardians || linked.students)) {
      const t = makeT(l);
      await ctx.reply(t("tg.openAppHint"), { reply_markup: new InlineKeyboard().webApp(t("tg.openApp"), app) });
    }
  });

  bot.on("message:text", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const l = await localeOf(ctx);
    const key = buttonKey(ctx.message.text);
    const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
    switch (key) {
      case "balanceBtn": {
        const { text, payUrls } = await balanceText(chatId, l);
        const kb = new InlineKeyboard();
        payUrls.forEach((p) => kb.url(p.label, p.url).row());
        await ctx.reply(text, { ...html, reply_markup: payUrls.length ? kb : undefined });
        return;
      }
      case "scheduleBtn":
        await ctx.reply(await scheduleText(chatId, l), html);
        return;
      case "attendanceBtn": {
        const { text, rich } = await attendanceReply(chatId, l);
        if (rich && telegramRichMessages()) {
          try {
            await ctx.replyWithRichMessage({ html: rich });
            return;
          } catch (e) {
            // Telegram refused the rich form: answer with the usual text (anything else goes to bot.catch)
            if (!richRefused(e)) throw e;
            console.warn("[bot] rich attendance refused, sending text", (e as { description?: string }).description ?? e);
          }
        }
        await ctx.reply(text, html);
        return;
      }
      case "paymentsBtn":
        await ctx.reply(await paymentsText(chatId, l), html);
        return;
      case "centerBtn":
        await ctx.reply(await centerText(chatId, l), html);
        return;
      case "todayBtn": {
        const teacher = await teacherFor(chatId);
        if (!teacher) return void (await ctx.reply(B.forbidden[l]));
        const lessons = await teacherLessonsToday(teacher.id);
        if (lessons.length === 0) return void (await ctx.reply(B.noLessons[l]));
        const kb = new InlineKeyboard();
        lessons.forEach((x) => kb.text(`${x.startTime} ${x.group.name}${x._count.attendance ? " ✓" : ""}`, `L:${x.id}`).row());
        await ctx.reply(B.pickLesson[l], { reply_markup: kb });
        return;
      }
      case "weekBtn": {
        const teacher = await teacherFor(chatId);
        if (!teacher) return void (await ctx.reply(B.forbidden[l]));
        await ctx.reply(await teacherWeekText(teacher.id, l), html);
        return;
      }
      case "salaryBtn": {
        const teacher = await teacherFor(chatId);
        if (!teacher) return void (await ctx.reply(B.forbidden[l]));
        const month = todayISO().slice(0, 7);
        const [{ result }, last] = await Promise.all([
          liveSalary(teacher.centerId, teacher.id, month),
          db.payslip.findFirst({ where: { teacherId: teacher.id, status: { not: "DRAFT" } }, orderBy: { month: "desc" } }),
        ]);
        const cur = l === "ru" ? "сум" : "so'm";
        const lines = [`💵 <b>${B.salaryNow[l]} (${month}): ${formatMoney(result.total, cur)}</b>`, ...result.lines.map((x) => `• ${esc(x.groupName)}: ${x.lessonsHeld} × → ${formatMoney(x.amount, cur)}`)];
        if (last) lines.push(`\n${B.lastPayslip[l]} (${last.month}): ${formatMoney(last.total, cur)} · ${last.status}`);
        await ctx.reply(lines.join("\n"), html);
        return;
      }
      case "reportBtn": {
        const owner = (await chatRoles(chatId)).owner;
        const text = owner ? await ownerReport(owner.id) : null;
        await ctx.reply(text ?? B.forbidden[l], html);
        return;
      }
      default:
        await ctx.reply(B.notLinked[l], { reply_markup: await menu(chatId, l) });
    }
  });

  bot.on("callback_query:data", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    const l = await localeOf(ctx);
    const [op, lessonId, studentId] = ctx.callbackQuery.data.split(":");
    const teacher = await teacherFor(chatId);
    const lesson = lessonId ? await db.lesson.findUnique({ where: { id: lessonId }, include: { group: { select: { name: true, teacherId: true, centerId: true } } } }) : null;
    if (!teacher || !lesson || lesson.group.centerId !== teacher.centerId || (lesson.teacherId !== teacher.id && lesson.group.teacherId !== teacher.id)) {
      await ctx.answerCallbackQuery({ text: B.forbidden[l] });
      return;
    }
    const rows = await lessonRoster(lessonId);
    const key = `${chatId}:${lessonId}`;
    let draft = drafts.get(key);
    if (!draft) {
      draft = new Map(rows.map((r) => [r.studentId, (r.status ?? "PRESENT") as AttendanceStatus]));
      remember(key, draft);
    }
    if (op === "L") {
      await ctx.answerCallbackQuery();
      if (rows.length === 0) return void (await ctx.reply(B.noStudents[l]));
      await ctx.reply(`<b>${esc(lesson.group.name)}</b> · ${lesson.startTime}\n${B.rosterHint[l]}`, { parse_mode: "HTML", reply_markup: rosterKeyboard(lessonId, rows, draft, l) });
      return;
    }
    if (op === "A") {
      // a student no longer on the roster (or an old position-based button) only redraws the list
      const r = rows.find((x) => x.studentId === studentId);
      if (r) draft.set(r.studentId, CYCLE[(CYCLE.indexOf(draft.get(r.studentId) ?? "PRESENT") + 1) % CYCLE.length]);
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup({ reply_markup: rosterKeyboard(lessonId, rows, draft, l) });
      return;
    }
    if (op === "S") {
      try {
        await saveAttendance(
          { userId: teacher.id, centerId: teacher.centerId },
          lessonId,
          rows.map((r) => ({ studentId: r.studentId, status: draft!.get(r.studentId) ?? "PRESENT", grade: r.grade, comment: r.comment })),
          { onlyTeacherId: teacher.id },
        );
        drafts.delete(key);
        await ctx.answerCallbackQuery({ text: B.saved[l] });
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
        await ctx.reply(B.saved[l]);
      } catch (e) {
        await ctx.answerCallbackQuery({ text: saveErrorText(e, l), show_alert: true });
      }
    }
  });

  bot.catch((err) => console.error("[bot]", err.error));
  return bot;
}
