// Telegram side of Sabaq's own sales agent (src/lib/sales-agent). A stranger who opens the shared bot with
// no center link, or writes to it, talks to Sabaq; the team gets leads and questions in SALES_TELEGRAM_CHAT_ID
// (default OPS_TELEGRAM_CHAT_ID) and answers them by replying there.
//
// The callers in index.ts check first that the chat is not a linked family/staff chat and not talking to a
// center's agent, so this never takes over a customer of a center.
import { Keyboard, type Api, type Context } from "grammy";
import { normalizePhone } from "@/lib/phone";
import type { Locale } from "@/lib/i18n";
import { salesAgentEnabled, salesTeamChatId } from "@/lib/env";
import { SALES_MARK, activeSalesChat, handleSalesMessage, openSalesChat, recordOnboardingFile, recordSalesPhone, salesChatOfTeamMessage, salesText, teamReplyMarker } from "@/lib/sales-agent/service";
import type { OnboardingFile } from "@/lib/sales-agent/onboarding";
import { db } from "@/lib/db";
import { looksLikePhone, queueTurn } from "./agent";

const phoneButton = (l: Locale) => new Keyboard().requestContact(l === "ru" ? "📱 Отправить номер" : "📱 Raqamni yuborish").resized().oneTime();

function personName(ctx: Context): string {
  return [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ").trim();
}

async function notifier(api: Api): Promise<(html: string) => Promise<number | null>> {
  const team = salesTeamChatId();
  return async (html) => {
    if (!team) return null;
    try {
      const m = await api.sendMessage(team, html.slice(0, 4000), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
      return m.message_id;
    } catch (e) {
      console.error("[sales] team notify", e);
      return null;
    }
  };
}

/** Copies the person's own file messages into the team chat, in the order they were sent. */
function fileSender(api: Api, chatId: string): (files: OnboardingFile[]) => Promise<void> {
  return async (files) => {
    const team = salesTeamChatId();
    if (!team) return;
    for (const f of files) {
      await api.copyMessage(team, chatId, f.messageId).catch((e) => console.error("[sales] copy file", f.name, e));
    }
  };
}

async function runFor(api: Api, chatRowId: string, chatId: string, text: string, l: Locale): Promise<void> {
  await api.sendChatAction(chatId, "typing").catch(() => {});
  const r = await handleSalesMessage({ chatRowId, text, locale: l, notifyTeam: await notifier(api), sendFilesToTeam: fileSender(api, chatId) });
  for (const [i, t] of r.replies.entries()) {
    const last = i === r.replies.length - 1;
    await api.sendMessage(chatId, t.slice(0, 4000), last && r.askPhone ? { reply_markup: phoneButton(l) } : {});
  }
}

function schedule(ctx: Context, chatRowId: string, text: string, l: Locale): void {
  const api = ctx.api;
  const chatId = String(ctx.chat!.id);
  void queueTurn(`sales:${chatId}`, text, (t) => runFor(api, chatRowId, chatId, t, l)).catch(async (e) => {
    console.error("[sales] turn", e);
    await api.sendMessage(chatId, salesText("error", l)).catch(() => {});
  });
}

const who = (ctx: Context) => ({ name: personName(ctx), username: ctx.from?.username ?? null });

/** Plain /start from a stranger. */
export async function salesOnStart(ctx: Context, l: Locale): Promise<boolean> {
  if (!salesAgentEnabled() || ctx.chat?.type !== "private") return false;
  const chat = await openSalesChat(String(ctx.chat.id), who(ctx));
  console.log(`[sales] start chat=${chat.id}`);
  schedule(ctx, chat.id, SALES_MARK.start, l);
  return true;
}

/** Free text from a stranger. A typed phone is caught here and kept from the model. */
export async function salesOnText(ctx: Context, text: string, l: Locale): Promise<boolean> {
  if (!salesAgentEnabled() || ctx.chat?.type !== "private") return false;
  const chat = await openSalesChat(String(ctx.chat.id), who(ctx));
  if ((chat.awaitingPhone || !chat.phone) && looksLikePhone(text)) {
    const phone = normalizePhone(text);
    if (!phone) {
      await ctx.reply(l === "ru" ? "Номер неполный или неверный. Напишите его в виде +998 90 123 45 67 или нажмите кнопку ниже." : "Bu raqam to'liq emas yoki noto'g'ri. Uni +998 90 123 45 67 ko'rinishida yozing yoki pastdagi tugmani bosing.", { reply_markup: phoneButton(l) });
      return true;
    }
    await recordSalesPhone(chat.id, phone);
    await ctx.reply("✅", { reply_markup: { remove_keyboard: true } });
    schedule(ctx, chat.id, SALES_MARK.phone, l);
    return true;
  }
  schedule(ctx, chat.id, text.slice(0, 2000), l);
  return true;
}

/** A document or photo from a stranger who is setting up their center in the chat (student list, exercises). */
export async function salesOnFile(ctx: Context, l: Locale): Promise<boolean> {
  if (!salesAgentEnabled() || ctx.chat?.type !== "private" || !ctx.message) return false;
  const chat = await activeSalesChat(String(ctx.chat.id));
  if (!chat) return false;
  const m = ctx.message;
  const doc = m.document;
  // the biggest size of a photo is the last one
  const photo = m.photo?.at(-1);
  if (!doc && !photo) return false;
  const file: OnboardingFile = {
    kind: doc ? "document" : "photo",
    fileId: doc?.file_id ?? photo!.file_id,
    name: doc?.file_name ?? `rasm-${m.message_id}.jpg`,
    mime: doc?.mime_type ?? (photo ? "image/jpeg" : null),
    size: doc?.file_size ?? photo?.file_size ?? null,
    messageId: m.message_id,
    caption: m.caption?.slice(0, 1000) ?? null,
    at: new Date().toISOString(),
  };
  const marker = await recordOnboardingFile(chat.id, file);
  if (!marker) return false;
  schedule(ctx, chat.id, marker, l);
  return true;
}

/** A stranger's own contact that linked to nobody: the sales conversation keeps it. */
export async function salesOnContact(ctx: Context, phone: string | null, l: Locale): Promise<boolean> {
  if (!salesAgentEnabled() || !phone || ctx.chat?.type !== "private") return false;
  const chat = await activeSalesChat(String(ctx.chat.id));
  if (!chat) return false;
  await recordSalesPhone(chat.id, phone);
  await ctx.reply("✅", { reply_markup: { remove_keyboard: true } });
  schedule(ctx, chat.id, SALES_MARK.phone, l);
  return true;
}

/**
 * The team chat replying to a "🤖 Sabaq" notification: the text goes to the person, and the agent hears it
 * as a marker, so the conversation goes on from there. Returns false when it is not such a reply.
 */
export async function salesOnTeamReply(ctx: Context, text: string): Promise<boolean> {
  const team = salesTeamChatId();
  const replied = ctx.message?.reply_to_message;
  if (!team || String(ctx.chat?.id) !== team || !replied || replied.from?.id !== ctx.me.id) return false;
  const chat = await salesChatOfTeamMessage(replied.message_id);
  if (!chat) return false;
  try {
    await ctx.api.sendMessage(chat.chatId, text.slice(0, 4000));
  } catch (e) {
    console.error("[sales] team reply", e);
    await ctx.reply("⚠️ Yuborib bo'lmadi (odam botni bloklagan bo'lishi mumkin).");
    return true;
  }
  // the agent does not answer this one: the marker joins the person's next message (consecutive user turns merge)
  const messages = [...((chat.messages ?? []) as unknown[]), { role: "user", content: teamReplyMarker(text.slice(0, 4000)) }];
  await db.salesChat.update({ where: { id: chat.id }, data: { messages: JSON.parse(JSON.stringify(messages)), lastMessageAt: new Date() } });
  await ctx.reply("✅ Yuborildi.");
  return true;
}
