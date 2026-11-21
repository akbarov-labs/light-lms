// The placement test's start link: t.me/<shared bot>?start=pt_<center slug>, or t.me/<center's own bot>?start=pt.
// The bot answers with a button that opens the test in the Mini App (the test itself runs there, signed with
// the init data like the rest of the Mini App).
import { InlineKeyboard, type Context } from "grammy";
import type { Locale } from "@/lib/i18n";
import { appUrl } from "@/lib/env";
import { webAppUrl } from "@/lib/telegram-webapp";
import { placementCenter, placementTemplate } from "@/lib/services/quizzes";
import { PLACEMENT_BTN, placementStartText } from "@/lib/quizzes/texts";
import type { BotScope } from "@/lib/managed-bots/scope";

/** Deep-link payload prefix of a placement start link. */
export const PLACEMENT_PREFIX = "pt";

/** /start pt_<slug> (shared bot) or /start pt (a center's own bot). False when the payload is not a placement link. */
export async function placementOnStart(ctx: Context, payload: string, scope: BotScope | null, l: Locale): Promise<boolean> {
  if (!ctx.chat || ctx.chat.type !== "private") return false;
  const m = /^pt(?:_([a-z0-9-]{2,40}))?$/i.exec(payload.trim());
  if (!m) return false;
  // a center's own bot is that center's: a slug in its link is ignored, as for every other payload
  const center = await placementCenter(scope ? null : (m[1]?.toLowerCase() ?? null), scope?.centerId ?? null);
  if (!center) return false;
  const template = await placementTemplate(center.id);
  if (!template || template.status !== "PUBLISHED") {
    await ctx.reply(l === "ru" ? "Вступительный тест сейчас закрыт. Позвоните в центр." : "Kirish testi hozir yopiq. Markazga qo'ng'iroq qiling.");
    return true;
  }
  const url = webAppUrl(appUrl(), `/tg/placement?c=${encodeURIComponent(center.slug)}`, scope?.botId);
  await ctx.reply(placementStartText(l, center.name), { parse_mode: "HTML", ...(url ? { reply_markup: new InlineKeyboard().webApp(PLACEMENT_BTN[l], url) } : {}) });
  return true;
}
