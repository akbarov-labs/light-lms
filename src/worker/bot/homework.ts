// Homework in the bot (pilot). A student — or a parent for a younger child — answers question by question:
// choice questions are letter buttons on one message edited in place, number questions are typed. Every
// answer is saved at once and can be changed until the next lesson. No grade is shown here: the results
// are for the teacher to go through at the next lesson (src/components/homework-panel.tsx).
import { InlineKeyboard, type Context } from "grammy";
import type { Locale } from "@/lib/i18n";
import { esc } from "@/lib/messages";
import { formatDate, formatDateTime } from "@/lib/dates";
import { answerSheet, openHomeworkFor, saveAnswer, startAnswering, type AnswerSheet } from "@/lib/services/homework";
import { db } from "@/lib/db";
import { fullName } from "@/lib/format";
import { B } from "./texts";
import { chatStudentsLite } from "./data";

/** hw:o:<homeworkId>:<studentId> open · hw:a:<sub>:<q>:<letter> answer · hw:g:<sub>:<q> go to · hw:s:<sub> summary */
export const HOMEWORK_CB = /^hw:(o|a|g|s):([a-z0-9]{1,40})(?::([a-z0-9]{1,40}))?(?::([A-E]))?$/;

/** The question each chat is on, so a typed answer lands on it (single worker process: memory is enough). */
const typing = new Map<string, { submissionId: string; q: number; at: number }>();
const TYPING_TTL = 30 * 60_000;
const MAX_TYPING = 2000;

function setTyping(chatId: string, submissionId: string, q: number) {
  typing.delete(chatId);
  typing.set(chatId, { submissionId, q, at: Date.now() });
  while (typing.size > MAX_TYPING) typing.delete(typing.keys().next().value!);
}

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const due = (s: { dueAt: Date | null }, l: Locale) => (s.dueAt ? formatDateTime(s.dueAt) : B.hwDueNext[l]);

/** May this chat answer for this student: the student's own linked chat or a linked guardian of the family. */
async function mayAnswer(chatId: string, studentId: string): Promise<boolean> {
  return (await chatStudentsLite(chatId)).some((s) => s.id === studentId);
}

async function studentName(studentId: string): Promise<string> {
  const s = await db.student.findUnique({ where: { id: studentId }, select: { firstName: true, lastName: true } });
  return s ? fullName(s) : "";
}

function header(s: AnswerSheet, name: string): string {
  return [`📝 <b>${esc(s.groupName)}</b> · ${formatDate(s.lessonDate)}`, name ? `👤 ${esc(name)}` : null, s.note ? esc(s.note) : null].filter(Boolean).join("\n");
}

function questionView(s: AnswerSheet, q: number, name: string, l: Locale): { text: string; keyboard: InlineKeyboard } {
  const kind = s.kinds[q];
  const current = s.answers[q];
  const text = [
    header(s, name),
    "",
    `<b>${B.hwQuestion[l].replaceAll("{i}", String(q + 1)).replace("{n}", String(s.kinds.length))}</b>`,
    kind === "choice" ? B.hwTapLetter[l] : B.hwTypeNumber[l],
    current ? B.hwCurrent[l].replace("{a}", `<b>${esc(current)}</b>`) : null,
  ]
    .filter((x) => x !== null)
    .join("\n");
  const kb = new InlineKeyboard();
  if (kind === "choice") {
    for (const letter of s.letters) kb.text(current === letter ? `✓ ${letter}` : letter, `hw:a:${s.submissionId}:${q}:${letter}`);
    kb.row();
  }
  if (q > 0) kb.text(B.hwPrev[l], `hw:g:${s.submissionId}:${q - 1}`);
  kb.text(B.hwSkip[l], q + 1 < s.kinds.length ? `hw:g:${s.submissionId}:${q + 1}` : `hw:s:${s.submissionId}`);
  kb.row().text(B.hwAll[l], `hw:s:${s.submissionId}`);
  return { text, keyboard: kb };
}

function summaryView(s: AnswerSheet, name: string, l: Locale): { text: string; keyboard: InlineKeyboard } {
  const answered = s.answers.filter((a) => a !== "").length;
  const cells = s.answers.map((a, i) => `${i + 1}) ${a ? `<b>${esc(a)}</b>` : "—"}`);
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 5) rows.push(cells.slice(i, i + 5).join("   "));
  const text = [header(s, name), "", `<b>${B.hwSummary[l].replace("{a}", String(answered)).replace("{n}", String(s.kinds.length))}</b>`, ...rows, "", B.hwSummaryHint[l].replace("{due}", due(s, l))].join("\n");
  const kb = new InlineKeyboard();
  s.answers.forEach((a, i) => {
    kb.text(a ? `${i + 1} ✓` : `${i + 1}`, `hw:g:${s.submissionId}:${i}`);
    if ((i + 1) % 5 === 0) kb.row();
  });
  return { text, keyboard: kb };
}

/** First unanswered question, or null when every question has an answer. */
const firstBlank = (s: AnswerSheet) => {
  const i = s.answers.findIndex((a) => a === "");
  return i === -1 ? null : i;
};

/** Edit the message the button was on; Telegram refuses an edit that changes nothing, which is fine. */
async function show(ctx: Context, view: { text: string; keyboard: InlineKeyboard }, edit: boolean) {
  if (edit) {
    try {
      await ctx.editMessageText(view.text, { ...html, reply_markup: view.keyboard });
      return;
    } catch (e) {
      if (String((e as { description?: string }).description ?? e).includes("message is not modified")) return;
      throw e;
    }
  }
  await ctx.reply(view.text, { ...html, reply_markup: view.keyboard });
}

async function showStep(ctx: Context, chatId: string, s: AnswerSheet, q: number | null, l: Locale, edit: boolean) {
  const name = await studentName(s.studentId);
  if (q === null) {
    typing.delete(chatId);
    return show(ctx, summaryView(s, name, l), edit);
  }
  setTyping(chatId, s.submissionId, q);
  return show(ctx, questionView(s, q, name, l), edit);
}

/** The "📝 Uy vazifasi" button: open homework of every student this chat may answer for. */
export async function homeworkMenu(ctx: Context, chatId: string, l: Locale) {
  const students = await chatStudentsLite(chatId);
  const open = await openHomeworkFor(students);
  if (open.length === 0) return void (await ctx.reply(B.hwNone[l]));
  const lines = [`📝 <b>${B.hwListTitle[l]}</b>`];
  const kb = new InlineKeyboard();
  for (const h of open) {
    lines.push(
      "",
      `👤 <b>${esc(h.studentName)}</b> · ${esc(h.groupName)} (${formatDate(h.lessonDate)})`,
      ...(h.note ? [esc(h.note)] : []),
      `${B.hwAnswered[l].replace("{a}", String(h.answered)).replace("{n}", String(h.questions))} · ${B.hwDue[l].replace("{due}", due(h, l))}`,
    );
    kb.text(`✍️ ${h.studentName.split(" ").slice(-1)[0]}: ${h.groupName}`.slice(0, 60), `hw:o:${h.homeworkId}:${h.studentId}`).row();
  }
  await ctx.reply(lines.join("\n"), { ...html, reply_markup: kb });
}

async function closed(ctx: Context, l: Locale) {
  await ctx.answerCallbackQuery({ text: B.hwClosed[l], show_alert: true });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
}

/** Every homework button. The chat's right to the student is checked again on each press. */
export async function homeworkOnCallback(ctx: Context, m: RegExpMatchArray | string, l: Locale) {
  if (typeof m === "string") return;
  const chatId = String(ctx.chat?.id ?? "");
  const [, op, id, arg, letter] = m;
  if (op === "o") {
    if (!arg || !(await mayAnswer(chatId, arg))) return void (await ctx.answerCallbackQuery({ text: B.forbidden[l] }));
    const s = await startAnswering(id, arg, chatId);
    if (s === "closed") return closed(ctx, l);
    if (!s) return void (await ctx.answerCallbackQuery({ text: B.forbidden[l] }));
    await ctx.answerCallbackQuery();
    return showStep(ctx, chatId, s, firstBlank(s), l, false);
  }
  const s = await answerSheet(id);
  if (!s || !(await mayAnswer(chatId, s.studentId))) return void (await ctx.answerCallbackQuery({ text: B.forbidden[l] }));
  if (s.state !== "open") return closed(ctx, l);
  if (op === "s") {
    await ctx.answerCallbackQuery();
    return showStep(ctx, chatId, s, null, l, true);
  }
  const q = Number(arg);
  if (!Number.isInteger(q) || q < 0 || q >= s.kinds.length) return void (await ctx.answerCallbackQuery());
  if (op === "g") {
    await ctx.answerCallbackQuery();
    return showStep(ctx, chatId, s, q, l, true);
  }
  // op === "a": a letter for question q
  const r = await saveAnswer(s.submissionId, q, letter ?? "", chatId);
  if (!r.ok) return r.reason === "closed" ? closed(ctx, l) : void (await ctx.answerCallbackQuery());
  await ctx.answerCallbackQuery({ text: `${q + 1}) ${letter}` });
  return showStep(ctx, chatId, r.sheet, q + 1 < r.sheet.kinds.length ? q + 1 : null, l, true);
}

/** A typed answer for the question this chat is on. False when the chat is not answering homework. */
export async function homeworkOnText(ctx: Context, text: string, l: Locale): Promise<boolean> {
  const chatId = String(ctx.chat?.id ?? "");
  const t = typing.get(chatId);
  if (!t) return false;
  if (Date.now() - t.at > TYPING_TTL) {
    typing.delete(chatId);
    return false;
  }
  const s = await answerSheet(t.submissionId);
  if (!s || !(await mayAnswer(chatId, s.studentId))) {
    typing.delete(chatId);
    return false;
  }
  const r = await saveAnswer(t.submissionId, t.q, text, chatId);
  if (!r.ok) {
    if (r.reason === "closed") {
      typing.delete(chatId);
      await ctx.reply(B.hwClosed[l]);
      return true;
    }
    if (r.reason === "notFound") {
      typing.delete(chatId);
      return false;
    }
    await ctx.reply(s.kinds[t.q] === "choice" ? B.hwBadLetter[l].replace("{letters}", s.letters.join(", ")) : B.hwBadNumber[l]);
    return true;
  }
  await showStep(ctx, chatId, r.sheet, t.q + 1 < r.sheet.kinds.length ? t.q + 1 : null, l, false);
  return true;
}

/** For tests: forget every chat's current question. */
export function resetHomeworkTyping() {
  typing.clear();
}
