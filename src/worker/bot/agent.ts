// Telegram side of the AI lead agent (src/lib/agent). A stranger opens t.me/<bot>?start=<center-slug>,
// the center's agent answers. Three entry points, each returns false when the message is not the agent's.
//
// Turns run in the background: grammY handles updates one by one, so awaiting a 5–15 s model call here
// would make every other user of the bot (teachers marking attendance) wait. Because turns now run in
// parallel, each chat has a queue: a second message waits for the running turn, and messages that pile
// up meanwhile are merged into one turn — two turns never write the same history at once.
import { Keyboard, type Api, type Context } from "grammy";
import type { AgentChat } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import type { Locale } from "@/lib/i18n";
import { MARK, activeAgentChat, agentCenterBySlug, agentText, handleAgentMessage, openAgentChat, recordPhone } from "@/lib/agent/service";
import { linkChat } from "./data";

const queues = new Map<string, { running: boolean; pending: string[] }>();

/** Run `turn` for this chat after any running one; texts queued meanwhile go in as one message. */
export function queueTurn(key: string, text: string, turn: (text: string) => Promise<void>): Promise<void> {
  let q = queues.get(key);
  if (!q) queues.set(key, (q = { running: false, pending: [] }));
  q.pending.push(text);
  if (q.running) return Promise.resolve();
  q.running = true;
  const state = q;
  return (async () => {
    try {
      while (state.pending.length) await turn(state.pending.splice(0).join("\n"));
    } catch (e) {
      console.error("[agent] queue", e);
    } finally {
      queues.delete(key);
    }
  })();
}

function personName(ctx: Context): string {
  return [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ").trim();
}

async function runFor(api: Api, chat: AgentChat, text: string, name: string, l: Locale): Promise<void> {
  await api.sendChatAction(chat.chatId, "typing").catch(() => {});
  const r = await handleAgentMessage({ chatRowId: chat.id, text, personName: name, locale: l });
  for (const [i, reply] of r.replies.entries()) {
    const last = i === r.replies.length - 1;
    const markup = last && r.askPhone ? { reply_markup: new Keyboard().requestContact(l === "ru" ? "📱 Отправить номер" : "📱 Raqamni yuborish").resized().oneTime() } : {};
    await api.sendMessage(chat.chatId, reply.slice(0, 4000), markup);
  }
  // A booked trial with a Telegram-verified number: link the chat like a contact share would, so this
  // family gets schedule, reminders and the bot menu. A typed number never links (it is unverified).
  if (r.booked) {
    const fresh = await db.agentChat.findUnique({ where: { id: chat.id } });
    if (fresh?.phone && fresh.phoneSource === "telegram") await linkChat(chat.chatId, fresh.phone, l);
  }
}

function schedule(ctx: Context, chat: AgentChat, text: string, l: Locale): void {
  const api = ctx.api;
  const name = personName(ctx);
  void queueTurn(chat.chatId, text, (t) => runFor(api, chat, t, name, l)).catch(async (e) => {
    console.error("[agent] turn", e);
    await api.sendMessage(chat.chatId, agentText("error", l)).catch(() => {});
  });
}

/** /start <slug>: open the center's agent. */
export async function agentOnStart(ctx: Context, payload: string, l: Locale): Promise<boolean> {
  if (!ctx.chat || ctx.chat.type !== "private" || !payload) return false;
  const center = await agentCenterBySlug(payload.trim().toLowerCase());
  if (!center) return false;
  const chat = await openAgentChat(center.id, String(ctx.chat.id));
  schedule(ctx, chat, MARK.start, l);
  return true;
}

/** A shared contact while the agent waits for a phone. The caller already checked it is the user's own. */
export async function agentOnContact(ctx: Context, phone: string | null, l: Locale): Promise<boolean> {
  if (!ctx.chat || !phone) return false;
  const chat = await activeAgentChat(String(ctx.chat.id));
  if (!chat || (!chat.awaitingPhone && chat.phone)) return false;
  await recordPhone(chat, phone, "telegram", personName(ctx));
  await ctx.reply("✅", { reply_markup: { remove_keyboard: true } });
  schedule(ctx, chat, MARK.phone, l);
  return true;
}

const PHONE_LIKE = /^[+\d\s()-]{9,20}$/;

/** Free text in a chat that is talking to an agent. A typed phone is caught here and kept from the model. */
export async function agentOnText(ctx: Context, text: string, l: Locale): Promise<boolean> {
  if (!ctx.chat || ctx.chat.type !== "private") return false;
  const chat = await activeAgentChat(String(ctx.chat.id));
  if (!chat) return false;
  const phone = chat.awaitingPhone && PHONE_LIKE.test(text.trim()) ? normalizePhone(text) : null;
  if (phone) {
    await recordPhone(chat, phone, "typed", personName(ctx));
    await ctx.reply("✅", { reply_markup: { remove_keyboard: true } });
    schedule(ctx, chat, MARK.phone, l);
    return true;
  }
  schedule(ctx, chat, text.slice(0, 2000), l);
  return true;
}
