// Telegram side of the math tutor (src/lib/tutor). A linked student's or parent's free text goes to the tutor
// when their center turned it on; the "🧑‍🏫 Savol berish" button explains it. Turns run in the background with
// a queue per chat (queueTurn, as the lead agent): a model call takes seconds, and grammY handles updates one
// at a time, so awaiting it here would make every other user of the bot wait.
import type { Context } from "grammy";
import { makeT, type Locale } from "@/lib/i18n";
import { handleTutorMessage, tutorFor } from "@/lib/tutor/service";
import { tutorRoute } from "@/lib/tutor/route";
import { db } from "@/lib/db";
import { queueTurn } from "./agent";
import { homeworkSheetOpen } from "./homework";

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

/** Turns still running (tests wait for them). */
const running = new Set<Promise<void>>();

/** For tests: wait until every queued tutor turn has been answered. */
export async function tutorSettled(): Promise<void> {
  while (running.size) await Promise.all([...running]);
}

/** Show the tutor button: this chat's center has the tutor on (and the chat is a linked student or parent). */
export async function chatTutorOn(chatId: string): Promise<boolean> {
  return !!(await tutorFor(chatId));
}

/** The menu button: what the tutor does, or that it is off. */
export async function tutorButton(ctx: Context, chatId: string, l: Locale): Promise<void> {
  const t = makeT(l);
  const target = await tutorFor(chatId);
  await ctx.reply(target ? t("tutor.intro", { n: target.dailyMessages }) : t("tutor.off"), html);
}

/** Free text from a private chat. False when it is not the tutor's (the caller goes on as before). */
export async function tutorOnText(ctx: Context, text: string, l: Locale): Promise<boolean> {
  if (!ctx.chat || ctx.chat.type !== "private") return false;
  const chatId = String(ctx.chat.id);
  // cheap checks first: a command or an empty text never costs a database round trip
  if (tutorRoute({ text, eligible: true, sheetOpen: false }) === "skip") return false;
  const eligible = !!(await tutorFor(chatId));
  // a timed test running in this chat's Mini App: no help until it is finished
  const testOpen = eligible && !!(await db.quizAttempt.findFirst({ where: { chatId, submittedAt: null, deadlineAt: { gt: new Date() } }, select: { id: true } }));
  const sheetOpen = homeworkSheetOpen(chatId);
  const route = tutorRoute({ text, eligible, sheetOpen, testOpen });
  if (route === "skip") return false;
  if (route === "busy") {
    await ctx.reply(makeT(l)(testOpen && !sheetOpen ? "tutor.testOpen" : "tutor.sheetOpen"));
    return true;
  }
  const api = ctx.api;
  // messages that arrive while a turn runs are merged into the next one (queueTurn)
  const p = queueTurn(`tutor:${chatId}`, text, async (merged) => {
    try {
      await api.sendChatAction(chatId, "typing").catch(() => {});
      const r = await handleTutorMessage({ chatId, text: merged, locale: l });
      console.log(`[tutor] chat=${chatId} ${r.outcome}${r.leakedQ ? ` q=${r.leakedQ}` : ""}`);
      await api.sendMessage(chatId, r.html, html);
    } catch (e) {
      console.error("[tutor] turn", e);
      await api.sendMessage(chatId, makeT(l)("tutor.error")).catch(() => {});
    }
  });
  running.add(p);
  void p.finally(() => running.delete(p));
  return true;
}

/** A photo from a family chat with no homework sheet open: the tutor reads typed questions only (for now). */
export async function tutorOnPhoto(ctx: Context, l: Locale): Promise<boolean> {
  if (!ctx.chat || ctx.chat.type !== "private") return false;
  const chatId = String(ctx.chat.id);
  const doc = ctx.message?.document;
  const image = !!ctx.message?.photo?.length || /^image\//.test(doc?.mime_type ?? "");
  if (!image || homeworkSheetOpen(chatId) || !(await tutorFor(chatId))) return false;
  await ctx.reply(makeT(l)("tutor.photo"));
  return true;
}
