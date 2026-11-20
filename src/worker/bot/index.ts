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
import { CANCEL, PICK, agentOnCancel, agentOnCenterStart, agentOnContact, agentOnPick, agentOnRestart, agentOnStart, agentOnText } from "./agent";
import { withBotScope, type BotScope } from "@/lib/managed-bots/scope";
import { CODE_PREFIX, markBotBlocked, markBotChat, onManagedBotUpdate, openBotRequest, suggestedUsername, type UpdateResult } from "@/lib/managed-bots/service";
import { answerFromTelegram } from "@/lib/agent/service";
import { HOMEWORK_CB, homeworkMenu, homeworkOnCallback, homeworkOnPhoto, homeworkOnText } from "./homework";
import { chatTutorOn, tutorButton, tutorOnPhoto, tutorOnText } from "./tutor";
import { PLACEMENT_PREFIX, placementOnStart } from "./quizzes";
import { SALES_ACCESS, salesOnAccess, salesOnContact, salesOnFile, salesOnStart, salesOnTeamReply, salesOnText } from "./sales";
import { appUrl, telegramRichMessages } from "@/lib/env";
import { richRefused } from "../notifications";
import {
  attendanceReply,
  balanceText,
  centerText,
  chatHomeworkOn,
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

/** The Mini App URL, or null: Telegram opens Mini Apps only over HTTPS. A center's own bot adds ?b=<bot id>
 * so /api/tg/data checks the init data with that bot's token and shows that center only. */
export function miniAppUrl(botId?: string): string | null {
  const base = appUrl();
  return base.startsWith("https://") ? `${base}/tg${botId ? `?b=${botId}` : ""}` : null;
}

/** Update types every bot asks for: the default set may leave out managed_bot (Bot API 9.6). */
export const ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member", "managed_bot"] as const;

export interface BotOptions {
  /** A center's own bot: everything it shows and does is that center's (null = the shared bot). */
  scope?: BotScope | null;
  /** Shared bot only: a managed bot was attached, or its token or owner changed (the pool restarts it). */
  onManagedBot?: (r: UpdateResult) => void;
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
  if (roles.family) {
    const [homework, tutor] = await Promise.all([chatHomeworkOn(chatId), chatTutorOn(chatId)]);
    if (homework) kb.text(B.homeworkBtn[l]);
    if (tutor) kb.text(B.tutorBtn[l]);
    if (homework || tutor) kb.row();
  }
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

/** Shared bot, /start nb_<code>: the OWNER checked, Telegram's "create a bot" button is shown. */
async function startBotCreation(ctx: Context, code: string, l: Locale): Promise<void> {
  if (!ctx.chat || ctx.chat.type !== "private") return;
  const r = await openBotRequest(code, String(ctx.chat.id));
  if (!r.ok) {
    console.log(`[bot] bot creation refused: ${r.reason} chat=${ctx.chat.id}`);
    const text = { expired: B.nbExpired, notOwner: B.nbNotOwner, hasBot: B.nbHasBot, off: B.nbOff }[r.reason][l];
    await ctx.reply(text);
    return;
  }
  const button = { text: B.nbButton[l], request_managed_bot: { request_id: Math.floor(Math.random() * 2 ** 31), suggested_name: r.centerName.slice(0, 64), suggested_username: suggestedUsername(r.slug) } };
  await ctx.reply(B.nbAsk[l].replace("{center}", esc(r.centerName)), { parse_mode: "HTML", reply_markup: { keyboard: [[button]], resize_keyboard: true, one_time_keyboard: true } });
}

async function teacherFor(chatId: string) {
  return (await chatRoles(chatId)).teacher;
}

export function createBot(token: string, opts: BotOptions = {}): Bot {
  const bot = new Bot(token);
  const scope = opts.scope ?? null;

  // TELEGRAM_DEBUG_UPDATES=true: log each update's kind (field names only, never content) — live tests
  if (process.env.TELEGRAM_DEBUG_UPDATES === "true") {
    bot.use((ctx, next) => {
      const kinds = Object.keys(ctx.update).filter((k) => k !== "update_id");
      const fields = ctx.message ? Object.keys(ctx.message).filter((k) => !["message_id", "date", "chat", "from"].includes(k)) : [];
      console.log(`[bot] update ${ctx.update.update_id} ${scope ? `center=${scope.centerId}` : "shared"}: ${kinds.join(",")}${fields.length ? ` (${fields.join(",")})` : ""}`);
      return next();
    });
  }

  // every handler below runs in this bot's scope: a center's own bot reads that center's data only
  bot.use((ctx, next) =>
    withBotScope(scope, async () => {
      if (scope && ctx.chat?.type === "private") {
        const member = ctx.myChatMember?.new_chat_member.status;
        if (member === "kicked") await markBotBlocked(scope.botId, String(ctx.chat.id));
        else await markBotChat(scope.botId, String(ctx.chat.id)).catch((e) => console.error("[bot] bot chat", e));
      }
      await next();
    }),
  );

  if (!scope) {
    // Telegram reports a created managed bot (and later token/owner changes) to the shared bot
    bot.on("managed_bot", async (ctx) => {
      const r = await onManagedBotUpdate(ctx.update.managed_bot);
      console.log(`[bot] managed_bot ${r.kind} bot=${ctx.update.managed_bot.bot.id}`);
      opts.onManagedBot?.(r);
    });
    // the service message in the owner's chat may come before or after the update: either one attaches
    bot.on("message:managed_bot_created", async (ctx) => {
      const l = await localeOf(ctx);
      const created = ctx.message.managed_bot_created.bot;
      let row = await db.centerBot.findUnique({ where: { botId: String(created.id) } });
      if (!row) {
        const r = await onManagedBotUpdate({ user: ctx.from, bot: created });
        console.log(`[bot] managed_bot_created ${r.kind} bot=${created.id}`);
        opts.onManagedBot?.(r);
        row = r.kind === "attached" ? r.bot : null;
      }
      const ok = row && row.ownerTgId === String(ctx.from.id);
      await ctx.reply(ok ? B.nbReady[l].replace("{bot}", row!.username) : B.nbIgnored[l], { reply_markup: { remove_keyboard: true } });
    });
  }

  bot.command("start", async (ctx) => {
    const l = await localeOf(ctx);
    const chatId = String(ctx.chat.id);
    if (!scope && ctx.match.startsWith(CODE_PREFIX)) return void (await startBotCreation(ctx, ctx.match.slice(CODE_PREFIX.length), l));
    // t.me/<bot>?start=pt_<center-slug> (a center's own bot: ?start=pt): the placement test's start link
    if (ctx.match.startsWith(PLACEMENT_PREFIX) && (await placementOnStart(ctx, ctx.match, scope, l))) return;
    // t.me/<bot>?start=<center-slug>: the center's AI lead agent (when that center switched it on); a center's
    // own bot ignores payloads: it is that center's bot, and a slug must not pull in another center
    if (!scope && ctx.match && (await agentOnStart(ctx, ctx.match, l))) return;
    const roles = await chatRoles(chatId);
    if (roles.family || roles.teacher || roles.owner) {
      await ctx.reply(B.linked[l], { reply_markup: await menu(chatId, l) });
      return;
    }
    // a center's own bot: anyone else talks to that center's AI agent (when it is on)
    if (scope && (await agentOnCenterStart(ctx, scope.centerId, l))) return;
    // a stranger already talking to a center's agent: plain /start goes on with that conversation
    if (!scope && (await agentOnRestart(ctx, l))) return;
    // anyone else (most likely a teacher or center owner who found Sabaq): Sabaq's own AI assistant (SALES_AGENT).
    // Never in a center's own bot: that bot speaks for the center, not for Sabaq.
    if (!scope && (await salesOnStart(ctx, l))) return;
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
    if (await agentOnContact(ctx, phone, l)) return;
    const chatId = String(ctx.chat.id);
    const linked = phone ? await linkChat(chatId, phone, l) : { guardians: 0, students: 0, staff: [] };
    // links are global (one person, one chat id in every bot); a center's own bot only counts its center
    const roles = scope ? await chatRoles(chatId) : null;
    const found = roles ? roles.family || !!roles.teacher || !!roles.owner : linked.guardians || linked.students || linked.staff.length > 0;
    if (!found) {
      if (!scope && (await salesOnContact(ctx, phone, l))) return;
      await ctx.reply(B.notFound[l], { reply_markup: { remove_keyboard: true } });
      return;
    }
    await ctx.reply(B.linked[l], { reply_markup: await menu(chatId, l) });
    const app = miniAppUrl(scope?.botId);
    if (app && (roles ? roles.family : linked.guardians || linked.students)) {
      const t = makeT(l);
      await ctx.reply(t("tg.openAppHint"), { reply_markup: new InlineKeyboard().webApp(t("tg.openApp"), app) });
    }
  });

  // files: a family's notebook photo for the homework it has open; a stranger setting up their center
  // in the chat (student list, homework PDFs)
  bot.on(["message:document", "message:photo"], async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const roles = await chatRoles(String(ctx.chat.id));
    if (roles.family) {
      const l = await localeOf(ctx);
      // no homework sheet open and the tutor on: a photo of a problem is not read (yet), the tutor says so
      if (await tutorOnPhoto(ctx, l)) return;
      return void (await homeworkOnPhoto(ctx, l));
    }
    if (roles.teacher || roles.owner) return;
    await salesOnFile(ctx, await localeOf(ctx));
  });

  bot.on("message:text", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const l = await localeOf(ctx);
    // staff answering a customer's question: a reply to the bot's own "🤖❓" notification goes to the customer
    const replied = ctx.message.reply_to_message;
    // the Sabaq team answering a sales lead's question (a reply to a "🤖 Sabaq" notification)
    if (!scope && (await salesOnTeamReply(ctx, ctx.message.text))) return;
    if (ctx.chat.type === "private" && replied?.from?.id === ctx.me.id && replied.text) {
      const r = await answerFromTelegram({ staffChatId: chatId, repliedText: replied.text, text: ctx.message.text });
      if (r) return void (await ctx.reply(B[r === "sent" ? "answerSent" : r === "forbidden" ? "forbidden" : "answerNotFound"][l]));
    }
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
      case "homeworkBtn":
        await homeworkMenu(ctx, chatId, l);
        return;
      case "tutorBtn":
        await tutorButton(ctx, chatId, l);
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
        // a typed answer to the homework question this chat is on
        if (await homeworkOnText(ctx, ctx.message.text, l)) return;
        if (await agentOnText(ctx, ctx.message.text, l)) return;
        // a linked student's or parent's math question (their center turned the tutor on)
        if (await tutorOnText(ctx, ctx.message.text, l)) return;
        {
          const roles = await chatRoles(chatId);
          if (!scope && !roles.family && !roles.teacher && !roles.owner && (await salesOnText(ctx, ctx.message.text, l))) return;
        }
        await ctx.reply(B.notLinked[l], { reply_markup: await menu(chatId, l) });
    }
  });

  // a group card's "book a trial" button (AI lead agent); registered first, the generic handler below is attendance
  bot.callbackQuery(PICK, async (ctx) => agentOnPick(ctx, ctx.match[1], await localeOf(ctx)));
  // the Sabaq team approving or rejecting a "try Sabaq" application (team chat only)
  bot.callbackQuery(SALES_ACCESS, async (ctx) => salesOnAccess(ctx, ctx.match[1] === "a", ctx.match[2]));
  // the agent's "cancel this trial?" buttons: the booking is cancelled only here, by the person's press
  bot.callbackQuery(CANCEL, async (ctx) => agentOnCancel(ctx, ctx.match[1] === "y", ctx.match[2], await localeOf(ctx)));
  // homework answers (pilot): open / letter / go to question / summary
  bot.callbackQuery(HOMEWORK_CB, async (ctx) => homeworkOnCallback(ctx, ctx.match, await localeOf(ctx)));

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
