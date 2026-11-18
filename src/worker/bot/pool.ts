// Center bots (managed bots) in the worker: one grammY bot per TESTING/ACTIVE CenterBot, each with long
// polling and the same handlers as the shared bot, scoped to its center. Reconciled with the table every
// minute and right after a managed_bot update. Polling keeps one open request per bot: fine for tens of
// bots in one process; past ~50 move to webhooks (docs/TELEGRAM-MANAGED-BOTS.md).
import type { Bot } from "grammy";
import type { CenterBot } from "@/generated/prisma/client";
import { botGone, forgetManagedBotToken, managedBotToken } from "@/lib/managed-bots/api";
import { markBotGone, runnableBots, type UpdateResult } from "@/lib/managed-bots/service";
import { alertOps } from "@/lib/ops-alert";
import { ALLOWED_UPDATES, createBot, miniAppUrl } from "./index";

export const MAX_POOL = 100;

type Log = (msg: string, e?: unknown) => void;

interface Running {
  bot: Bot;
  centerId: string;
  stopping?: boolean;
}

/** Commands, the Mini App button and descriptions of a center bot (once per worker start; cheap). */
async function setUp(bot: Bot, row: CenterBot): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start", description: "Boshlash / Начать" },
    { command: "lang", description: "Til / Язык" },
    { command: "parol", description: "Parolni tiklash (xodimlar) / Сброс пароля" },
  ]);
  const app = miniAppUrl(row.botId);
  if (app) await bot.api.setChatMenuButton({ menu_button: { type: "web_app", text: "📱 Ilova", web_app: { url: app } } });
}

export class BotPool {
  private bots = new Map<string, Running>();
  private busy: Promise<void> = Promise.resolve();

  constructor(private log: Log) {}

  get size(): number {
    return this.bots.size;
  }

  /** Start bots that should run, stop the rest. Calls are serialised. */
  reconcile(): Promise<void> {
    this.busy = this.busy.then(() => this.doReconcile()).catch((e) => this.log("bot pool reconcile failed", e));
    return this.busy;
  }

  /** A managed_bot update from the shared bot: attach → start, token change → restart. */
  onManagedBot(r: UpdateResult): void {
    if (r.kind === "token" || r.kind === "owner") {
      forgetManagedBotToken(r.bot.botId);
      if (r.kind === "token") void this.stop(r.bot.botId).then(() => this.reconcile());
      return;
    }
    if (r.kind === "attached") void this.reconcile();
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.bots.keys()].map((id) => this.stop(id)));
  }

  private async doReconcile(): Promise<void> {
    const rows = (await runnableBots()).slice(0, MAX_POOL);
    const want = new Map(rows.map((r) => [r.botId, r]));
    for (const id of this.bots.keys()) if (!want.has(id)) await this.stop(id);
    for (const row of rows) if (!this.bots.has(row.botId)) await this.start(row);
  }

  private async start(row: CenterBot): Promise<void> {
    let token: string;
    try {
      token = await managedBotToken(row.botId, { fresh: true });
    } catch (e) {
      if (botGone(e)) await this.gone(row, `getManagedBotToken: ${errText(e)}`);
      this.log(`center bot ${row.botId} (@${row.username}): token not available`, errText(e));
      return;
    }
    const bot = createBot(token, { scope: { centerId: row.centerId, botId: row.botId } });
    const running: Running = { bot, centerId: row.centerId };
    this.bots.set(row.botId, running);
    try {
      await bot.init();
      await setUp(bot, row);
    } catch (e) {
      this.bots.delete(row.botId);
      forgetManagedBotToken(row.botId);
      if (botGone(e)) await this.gone(row, `start: ${errText(e)}`);
      this.log(`center bot @${row.username} failed to start`, errText(e));
      return;
    }
    bot
      .start({ drop_pending_updates: true, allowed_updates: [...ALLOWED_UPDATES], onStart: (me) => this.log(`center bot @${me.username} polling (center ${row.centerId})`) })
      .catch(async (e) => {
        if (running.stopping) return;
        this.bots.delete(row.botId);
        forgetManagedBotToken(row.botId);
        // 401: the token changed under us; the next reconcile reads it again, or marks the bot gone
        this.log(`center bot @${row.username} stopped`, errText(e));
      });
  }

  /** Stop using a bot for good (deleted / no longer ours); Settings shows why, ops are told. */
  private async gone(row: CenterBot, why: string): Promise<void> {
    await markBotGone(row.botId, why);
    void alertOps(`center-bot:${row.botId}`, `Center bot @${row.username} (center ${row.centerId}) is gone: ${why}. Its messages go through the shared bot.`);
  }

  private async stop(botId: string): Promise<void> {
    const r = this.bots.get(botId);
    if (!r) return;
    r.stopping = true;
    this.bots.delete(botId);
    await r.bot.stop().catch(() => {});
    this.log(`center bot ${botId} stopped`);
  }
}

function errText(e: unknown): string {
  const err = e as { description?: string; message?: string };
  return String(err?.description ?? err?.message ?? e).slice(0, 300);
}
