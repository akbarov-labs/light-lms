// Homework in the bot (pilot). A student — or a parent for a younger child — answers question by question:
// choice questions are letter buttons on one message edited in place, number questions are typed, or a
// photo of the notebook is read by a model and confirmed. Every answer is saved at once. "✅ Check" shows
// which answers are wrong (never the right ones) with a hint where the slip has a shape; right answers
// lock, the student fixes the rest, up to settings.homework.attempts checks. The class results are the
// teacher's at the next lesson (src/components/homework-panel.tsx).
import { InlineKeyboard, type Context } from "grammy";
import type { Locale } from "@/lib/i18n";
import { esc } from "@/lib/messages";
import { formatDate, formatDateTime } from "@/lib/dates";
import { answerSheet, checkSubmission, openHomeworkFor, saveAnswer, saveAnswers, sheetDone, sheetEditable, startAnswering, type AnswerSheet } from "@/lib/services/homework";
import type { CheckResult } from "@/lib/homework/grade";
import { readAnswersFromPhoto, type PhotoMediaType, type ReadAnswer } from "@/lib/homework/photo";
import { attemptKey, checkAttempts, recordAttempt, RULES } from "@/lib/auth/ratelimit";
import { dbAttemptStore } from "@/lib/auth/attempts-db";
import { telegramBotToken } from "@/lib/env";
import { db } from "@/lib/db";
import { fullName } from "@/lib/format";
import { B } from "./texts";
import { chatStudentsLite } from "./data";

/**
 * hw:o:<homeworkId>:<studentId> open · hw:a:<sub>:<q>:<letter> answer · hw:g:<sub>:<q> go to · hw:s:<sub> summary ·
 * hw:c:<sub> check · hw:f:<sub> fix the wrong ones · hw:p:<sub> save what a photo read · hw:x:<sub> drop it
 */
export const HOMEWORK_CB = /^hw:(o|a|g|s|c|f|p|x):([a-z0-9]{1,40})(?::([a-z0-9]{1,40}))?(?::([A-E]))?$/;

/**
 * Per chat (single worker process: memory is enough): the sheet it has open and the question it is on, so a
 * typed answer or a photo lands there; and what the last photo read, until the student saves or drops it.
 */
const typing = new Map<string, { submissionId: string; q: number | null; at: number }>();
const pendingPhoto = new Map<string, { submissionId: string; answers: ReadAnswer[]; at: number }>();
const TTL = 30 * 60_000;
const MAX_CHATS = 2000;

function remember<T>(map: Map<string, T>, chatId: string, value: T) {
  map.delete(chatId);
  map.set(chatId, value);
  while (map.size > MAX_CHATS) map.delete(map.keys().next().value!);
}

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const due = (s: { dueAt: Date | null }, l: Locale) => (s.dueAt ? formatDateTime(s.dueAt) : B.hwDueNext[l]);
const left = (s: AnswerSheet) => Math.max(0, s.attempts - s.checks);
const nums = (qs: number[]) => qs.map((q) => q + 1).join(", ");

/** May this chat answer for this student: the student's own linked chat or a linked guardian of the family. */
async function mayAnswer(chatId: string, studentId: string): Promise<boolean> {
  return (await chatStudentsLite(chatId)).some((s) => s.id === studentId);
}

async function studentName(studentId: string): Promise<string> {
  const s = await db.student.findUnique({ where: { id: studentId }, select: { firstName: true, lastName: true } });
  return s ? fullName(s) : "";
}

function header(s: AnswerSheet, name: string, l: Locale): string {
  return [
    `📝 <b>${esc(s.groupName)}</b> · ${formatDate(s.lessonDate)}${s.state === "late" ? ` · ${B.hwLateTag[l]}` : ""}`,
    name ? `👤 ${esc(name)}` : null,
    s.note ? esc(s.note) : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The next question after q that can still be changed (skips locked ones), or null at the end. */
function nextOpen(s: AnswerSheet, q: number): number | null {
  const locked = new Set(s.locked);
  for (let i = q + 1; i < s.kinds.length; i++) if (!locked.has(i)) return i;
  return null;
}

function questionView(s: AnswerSheet, q: number, name: string, l: Locale): { text: string; keyboard: InlineKeyboard } {
  const kind = s.kinds[q];
  const current = s.answers[q];
  const locked = s.locked.includes(q);
  const text = [
    header(s, name, l),
    "",
    `<b>${B.hwQuestion[l].replaceAll("{i}", String(q + 1)).replace("{n}", String(s.kinds.length))}</b>`,
    locked ? B.hwLocked[l] : kind === "choice" ? B.hwTapLetter[l] : B.hwTypeNumber[l],
    current ? B.hwCurrent[l].replace("{a}", `<b>${esc(current)}</b>${locked ? " 🔒" : ""}`) : null,
    !locked && s.photos && q === 0 && s.checks === 0 ? `\n${B.hwPhotoHint[l]}` : null,
  ]
    .filter((x) => x !== null)
    .join("\n");
  const kb = new InlineKeyboard();
  if (kind === "choice" && !locked) {
    for (const letter of s.letters) kb.text(current === letter ? `✓ ${letter}` : letter, `hw:a:${s.submissionId}:${q}:${letter}`);
    kb.row();
  }
  if (q > 0) kb.text(B.hwPrev[l], `hw:g:${s.submissionId}:${q - 1}`);
  const next = nextOpen(s, q);
  kb.text(B.hwSkip[l], next !== null ? `hw:g:${s.submissionId}:${next}` : `hw:s:${s.submissionId}`);
  kb.row().text(B.hwAll[l], `hw:s:${s.submissionId}`);
  return { text, keyboard: kb };
}

function resultLines(r: CheckResult, l: Locale): string[] {
  if (r.wrong.length === 0 && r.blank.length === 0) return [`<b>${B.hwResult[l].replace("{c}", String(r.correct)).replace("{n}", String(r.total))}</b>`, B.hwAllRight[l]];
  const hints = r.wrong.filter((w) => w.hint).map((w) => (w.hint === "sign" ? B.hwHintSign[l] : B.hwHintDecimal[l]).replace("{n}", String(w.q + 1)));
  return [
    `<b>${B.hwResult[l].replace("{c}", String(r.correct)).replace("{n}", String(r.total))}</b>`,
    r.wrong.length ? B.hwWrongList[l].replace("{list}", nums(r.wrong.map((w) => w.q))) : null,
    r.blank.length ? B.hwBlankList[l].replace("{list}", nums(r.blank)) : null,
    ...hints,
  ].filter((x): x is string => x !== null);
}

function summaryView(s: AnswerSheet, name: string, l: Locale): { text: string; keyboard: InlineKeyboard } {
  const answered = s.answers.filter((a) => a !== "").length;
  const locked = new Set(s.locked);
  const wrongAtCheck = new Set(s.lastCheck?.wrong.map((w) => w.q) ?? []);
  const mark = (i: number) => (locked.has(i) ? " 🔒" : wrongAtCheck.has(i) ? " ❌" : "");
  const cells = s.answers.map((a, i) => `${i + 1}) ${a ? `<b>${esc(a)}</b>` : "—"}${mark(i)}`);
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 5) rows.push(cells.slice(i, i + 5).join("   "));
  const editable = sheetEditable(s);
  const footer: string[] = [];
  if (s.lastCheck) footer.push(...resultLines(s.lastCheck, l));
  if (s.state === "late" && s.checks === 0) footer.push(B.hwLateNote[l]);
  if (sheetDone(s)) footer.push(s.lastCheck && s.lastCheck.correct === s.lastCheck.total ? "" : B.hwNoTriesLeft[l]);
  else if (s.attempts > 0 && editable) footer.push(s.checks > 0 ? B.hwTryAgain[l].replace("{left}", String(left(s))) : B.hwSummaryCheck[l].replace("{left}", String(left(s))).replace("{due}", due(s, l)));
  else footer.push(B.hwSummaryHint[l].replace("{due}", due(s, l)));
  const text = [header(s, name, l), "", `<b>${B.hwSummary[l].replace("{a}", String(answered)).replace("{n}", String(s.kinds.length))}</b>`, ...rows, "", ...footer.filter(Boolean)].join("\n");
  const kb = new InlineKeyboard();
  if (editable) {
    s.answers.forEach((a, i) => {
      kb.text(locked.has(i) ? `${i + 1} 🔒` : wrongAtCheck.has(i) ? `${i + 1} ❌` : a ? `${i + 1} ✓` : `${i + 1}`, `hw:g:${s.submissionId}:${i}`);
      if ((i + 1) % 5 === 0) kb.row();
    });
    kb.row();
    if (s.attempts > 0 && answered > 0) kb.text(B.hwCheckBtn[l].replace("{left}", String(left(s))), `hw:c:${s.submissionId}`);
  }
  return { text, keyboard: kb };
}

/** First question still to answer or fix, or null when every open question has an answer. */
const firstBlank = (s: AnswerSheet) => {
  const locked = new Set(s.locked);
  const i = s.answers.findIndex((a, q) => a === "" && !locked.has(q));
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
  remember(typing, chatId, { submissionId: s.submissionId, q: q !== null && sheetEditable(s) ? q : null, at: Date.now() });
  if (q === null || !sheetEditable(s)) return show(ctx, summaryView(s, name, l), edit);
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
      `👤 <b>${esc(h.studentName)}</b> · ${esc(h.groupName)} (${formatDate(h.lessonDate)})${h.late ? ` · ${B.hwLateTag[l]}` : ""}`,
      ...(h.note ? [esc(h.note)] : []),
      [
        B.hwAnswered[l].replace("{a}", String(h.answered)).replace("{n}", String(h.questions)),
        h.checked ? B.hwCheckedTag[l].replace("{c}", String(h.checked.correct)).replace("{n}", String(h.questions)) : null,
        B.hwDue[l].replace("{due}", due(h, l)),
      ]
        .filter(Boolean)
        .join(" · "),
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
    // a sheet already checked opens on its summary (the result and what is left to fix)
    return showStep(ctx, chatId, s, s.checks > 0 ? null : firstBlank(s), l, false);
  }
  const s = await answerSheet(id);
  if (!s || !(await mayAnswer(chatId, s.studentId))) return void (await ctx.answerCallbackQuery({ text: B.forbidden[l] }));
  if (s.state !== "open" && s.state !== "late") return closed(ctx, l);
  if (op === "s") {
    await ctx.answerCallbackQuery();
    return showStep(ctx, chatId, s, null, l, true);
  }
  if (op === "x") {
    pendingPhoto.delete(chatId);
    await ctx.answerCallbackQuery();
    return showStep(ctx, chatId, s, null, l, true);
  }
  if (op === "p") return savePhoto(ctx, chatId, s, l);
  if (op === "c") {
    const r = await checkSubmission(s.submissionId, chatId);
    if (!r.ok) {
      if (r.reason === "closed") return closed(ctx, l);
      return void (await ctx.answerCallbackQuery({ text: r.reason === "empty" ? B.hwEmpty[l] : B.hwDone[l] }));
    }
    await ctx.answerCallbackQuery({ text: B.hwResult[l].replace("{c}", String(r.result.correct)).replace("{n}", String(r.result.total)) });
    const view = summaryView(r.sheet, await studentName(r.sheet.studentId), l);
    if (sheetEditable(r.sheet) && (r.result.wrong.length || r.result.blank.length)) view.keyboard.row().text(B.hwFixBtn[l], `hw:f:${s.submissionId}`);
    remember(typing, chatId, { submissionId: s.submissionId, q: null, at: Date.now() });
    return show(ctx, view, true);
  }
  if (op === "f") {
    await ctx.answerCallbackQuery();
    const wrong = s.lastCheck?.wrong.map((w) => w.q).filter((q) => !s.locked.includes(q)) ?? [];
    return showStep(ctx, chatId, s, wrong[0] ?? firstBlank(s), l, true);
  }
  const q = Number(arg);
  if (!Number.isInteger(q) || q < 0 || q >= s.kinds.length) return void (await ctx.answerCallbackQuery());
  if (op === "g") {
    await ctx.answerCallbackQuery(s.locked.includes(q) ? { text: B.hwLocked[l] } : undefined);
    return showStep(ctx, chatId, s, q, l, true);
  }
  // op === "a": a letter for question q
  const r = await saveAnswer(s.submissionId, q, letter ?? "", chatId);
  if (!r.ok) {
    if (r.reason === "closed") return closed(ctx, l);
    return void (await ctx.answerCallbackQuery(r.reason === "locked" ? { text: B.hwLocked[l] } : r.reason === "done" ? { text: B.hwDone[l] } : undefined));
  }
  await ctx.answerCallbackQuery({ text: `${q + 1}) ${letter}` });
  return showStep(ctx, chatId, r.sheet, nextOpen(r.sheet, q), l, true);
}

/** A typed answer for the question this chat is on. False when the chat is not answering homework. */
export async function homeworkOnText(ctx: Context, text: string, l: Locale): Promise<boolean> {
  const chatId = String(ctx.chat?.id ?? "");
  const t = typing.get(chatId);
  if (!t || t.q === null) return false;
  if (Date.now() - t.at > TTL) {
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
    if (r.reason === "closed" || r.reason === "done") {
      typing.delete(chatId);
      await ctx.reply(r.reason === "closed" ? B.hwClosed[l] : B.hwDone[l]);
      return true;
    }
    if (r.reason === "notFound") {
      typing.delete(chatId);
      return false;
    }
    if (r.reason === "locked") {
      await ctx.reply(B.hwLocked[l]);
      return true;
    }
    await ctx.reply(s.kinds[t.q] === "choice" ? B.hwBadLetter[l].replace("{letters}", s.letters.join(", ")) : B.hwBadNumber[l]);
    return true;
  }
  await showStep(ctx, chatId, r.sheet, nextOpen(r.sheet, t.q), l, false);
  return true;
}

// ------------------------------------------------------------------ photos

export type PhotoDownloader = (ctx: Context, fileId: string) => Promise<{ data: Uint8Array; mediaType: PhotoMediaType } | null>;

/** Telegram's file download: photos come as JPEG. */
const telegramDownload: PhotoDownloader = async (ctx, fileId) => {
  const file = await ctx.api.getFile(fileId);
  const token = telegramBotToken();
  if (!file.file_path || !token) return null;
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!res.ok) return null;
  const type = res.headers.get("content-type");
  const mediaType: PhotoMediaType = type === "image/png" ? "image/png" : type === "image/webp" ? "image/webp" : "image/jpeg";
  return { data: new Uint8Array(await res.arrayBuffer()), mediaType };
};

let download: PhotoDownloader = telegramDownload;
let photoCreate: Parameters<typeof readAnswersFromPhoto>[0]["create"];

/** For tests: replace the Telegram download and the model call. */
export function setHomeworkPhotoDeps(deps: { download?: PhotoDownloader; create?: typeof photoCreate } | null) {
  download = deps?.download ?? telegramDownload;
  photoCreate = deps?.create;
}

function photoView(s: AnswerSheet, answers: ReadAnswer[], name: string, l: Locale): { text: string; keyboard: InlineKeyboard } {
  const cells = answers.map((a) => `${a.q + 1}) <b>${esc(a.raw)}</b>${a.unsure ? " ⚠️" : ""}`);
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 5) rows.push(cells.slice(i, i + 5).join("   "));
  const text = [
    header(s, name, l),
    "",
    `<b>${B.hwPhotoRead[l].replace("{k}", String(answers.length))}</b>`,
    ...rows,
    "",
    answers.some((a) => a.unsure) ? B.hwPhotoUnsure[l] : null,
    B.hwPhotoConfirm[l],
  ]
    .filter((x) => x !== null)
    .join("\n");
  const kb = new InlineKeyboard().text(B.hwPhotoSave[l], `hw:p:${s.submissionId}`).text(B.hwPhotoCancel[l], `hw:x:${s.submissionId}`);
  return { text, keyboard: kb };
}

/**
 * A photo from a family chat. True when it was about homework (handled here, also when refused); false when
 * the chat has no homework sheet open, so the caller can ignore it.
 */
export async function homeworkOnPhoto(ctx: Context, l: Locale): Promise<boolean> {
  const chatId = String(ctx.chat?.id ?? "");
  const photos = ctx.message?.photo;
  const doc = ctx.message?.document;
  const fileId = photos?.length ? photos[photos.length - 1].file_id : doc && /^image\/(jpeg|png|webp)$/.test(doc.mime_type ?? "") ? doc.file_id : null;
  if (!fileId) return false;
  const t = typing.get(chatId);
  if (!t || Date.now() - t.at > TTL) {
    await ctx.reply(B.hwPhotoNoSheet[l]);
    return true;
  }
  const s = await answerSheet(t.submissionId);
  if (!s || !(await mayAnswer(chatId, s.studentId))) {
    await ctx.reply(B.hwPhotoNoSheet[l]);
    return true;
  }
  if (!sheetEditable(s)) {
    await ctx.reply(s.state === "open" || s.state === "late" ? B.hwDone[l] : B.hwClosed[l]);
    return true;
  }
  if (!s.photos) {
    await ctx.reply(B.hwPhotoOff[l]);
    return true;
  }
  const key = attemptKey.homeworkPhoto(chatId);
  const verdict = await checkAttempts(dbAttemptStore, [{ key, rule: RULES.homeworkPhoto }]);
  if (!verdict.allowed) {
    await ctx.reply(B.hwPhotoLimit[l]);
    return true;
  }
  await recordAttempt(dbAttemptStore, [key], false);
  await ctx.reply(B.hwPhotoReading[l]);
  const center = await db.homework.findUnique({ where: { id: s.homeworkId }, select: { centerId: true } });
  const image = await download(ctx, fileId).catch(() => null);
  const r = image && center ? await readAnswersFromPhoto({ centerId: center.centerId, image: image.data, mediaType: image.mediaType, kinds: s.kinds, create: photoCreate }) : ({ ok: false, reason: "failed" } as const);
  if (!r.ok) {
    await ctx.reply(r.reason === "off" ? B.hwPhotoOff[l] : r.reason === "limit" ? B.hwPhotoLimit[l] : B.hwPhotoFailed[l]);
    return true;
  }
  // a locked (right) answer is never replaced by what a photo read
  const answers = r.answers.filter((a) => !s.locked.includes(a.q));
  if (answers.length === 0) {
    await ctx.reply(B.hwPhotoAllLocked[l]);
    return true;
  }
  remember(pendingPhoto, chatId, { submissionId: s.submissionId, answers, at: Date.now() });
  await show(ctx, photoView(s, answers, await studentName(s.studentId), l), false);
  return true;
}

async function savePhoto(ctx: Context, chatId: string, s: AnswerSheet, l: Locale) {
  const p = pendingPhoto.get(chatId);
  if (!p || p.submissionId !== s.submissionId || Date.now() - p.at > TTL) {
    await ctx.answerCallbackQuery({ text: B.hwPhotoGone[l], show_alert: true });
    return ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
  }
  pendingPhoto.delete(chatId);
  const r = await saveAnswers(s.submissionId, p.answers.map((a) => ({ q: a.q, raw: a.raw })), chatId);
  if (!r.ok) {
    if (r.reason === "closed") return closed(ctx, l);
    return void (await ctx.answerCallbackQuery({ text: B.hwDone[l] }));
  }
  await ctx.answerCallbackQuery({ text: B.hwPhotoSave[l] });
  const view = summaryView(r.sheet, await studentName(r.sheet.studentId), l);
  if (r.skipped?.length) view.text += `\n\n${B.hwPhotoSkipped[l].replace("{list}", nums(r.skipped))}`;
  remember(typing, chatId, { submissionId: s.submissionId, q: null, at: Date.now() });
  return show(ctx, view, true);
}

/** A homework sheet is open in this chat (a question or its summary shown, touched within the last 30 minutes). */
export function homeworkSheetOpen(chatId: string, now = Date.now()): boolean {
  const t = typing.get(chatId);
  return !!t && now - t.at <= TTL;
}

/** For tests: forget every chat's open sheet and pending photo. */
export function resetHomeworkTyping() {
  typing.clear();
  pendingPhoto.clear();
}
