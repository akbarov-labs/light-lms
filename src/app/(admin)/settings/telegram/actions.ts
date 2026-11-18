"use server";

// Settings → Telegram bot: a center's own bot through Telegram managed bots (docs/TELEGRAM-MANAGED-BOTS.md).
// Every change is the OWNER's: the bot speaks for the center under its name.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { formObject } from "@/lib/forms";
import { UserError } from "@/lib/user-error";
import type { Ctx } from "@/lib/ctx";
import { CODE_PREFIX, changeBotStatus, createBotRequest, managedBotsOn, tellFamilies } from "@/lib/managed-bots/service";
import { managerCall } from "@/lib/managed-bots/api";

async function assertOwner(ctx: Ctx) {
  if (ctx.role !== "OWNER") throw new UserError("error.forbidden");
  const c = await db.center.findUniqueOrThrow({ where: { id: ctx.centerId }, select: { ownBotAllowed: true } });
  if (!managedBotsOn() || !c.ownBotAllowed) throw new UserError("ownBot.wrongState");
}

let sharedUsername: string | null = null;
async function sharedBotUsername(): Promise<string> {
  sharedUsername ??= (await managerCall<{ username: string }>("getMe")).username;
  return sharedUsername;
}

/** "Create bot": a one-time code, then Telegram opens the shared bot with it. */
export async function createOwnBotAction(_: ActionState, _fd: FormData): Promise<ActionState> {
  let url = "";
  const res = await runAction("settings", async (ctx) => {
    await assertOwner(ctx);
    const bot = await db.centerBot.findUnique({ where: { centerId: ctx.centerId }, select: { status: true } });
    if (bot && bot.status !== "GONE") throw new UserError("ownBot.wrongState");
    const username = await sharedBotUsername().catch(() => {
      throw new UserError("ownBot.telegramFailed");
    });
    const code = await createBotRequest(ctx.centerId, ctx.userId);
    url = `https://t.me/${username}?start=${CODE_PREFIX}${code}`;
  });
  if (url) redirect(url);
  return res;
}

export async function changeOwnBotAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("settings", async (ctx) => {
    await assertOwner(ctx);
    const f = z.object({ change: z.enum(["launch", "pause", "resume"]) }).parse(formObject(fd));
    try {
      await changeBotStatus(ctx.centerId, ctx.userId, f.change);
    } catch (e) {
      if (e instanceof UserError) throw e;
      console.error("[own-bot] status change", (e as { description?: string }).description ?? e);
      throw new UserError("ownBot.telegramFailed");
    }
    revalidatePath("/settings/telegram");
  });
}

export async function tellFamiliesAction(_: ActionState, _fd: FormData): Promise<ActionState> {
  return runAction("settings", async (ctx) => {
    await assertOwner(ctx);
    const n = await tellFamilies(ctx.centerId, ctx.userId);
    return { message: ctx.t("ownBot.told", { n }) };
  });
}
