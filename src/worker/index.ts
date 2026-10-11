// Worker process: cron jobs (Asia/Tashkent), the notification queue and the Telegram bot.
import cron from "node-cron";
import { db } from "@/lib/db";
import { TZ } from "@/lib/dates";
import { createBot } from "./bot";
import { processNotifications, type Sender } from "./notifications";
import { dailyReport, nightly, reminders, teacherReminders, type JobResult } from "./jobs";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[worker]", ...a);

async function run(name: string, job: () => Promise<JobResult>) {
  const t0 = Date.now();
  log(`job ${name} start`);
  try {
    const res = await job();
    log(`job ${name} done in ${Date.now() - t0}ms`, JSON.stringify(res));
  } catch (e) {
    log(`job ${name} FAILED`, e);
  }
}

async function main() {
  await db.$queryRaw`SELECT 1`;
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  let send: Sender | null = null;
  if (token) {
    const bot = createBot(token);
    send = async (chatId, text) => {
      await bot.api.sendMessage(chatId, text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    };
    bot.start({ drop_pending_updates: true, onStart: (me) => log(`bot @${me.username} polling`) }).catch((e) => log("bot stopped", e));
  } else {
    log("TELEGRAM_BOT_TOKEN is empty — bot disabled, notifications stay queued; jobs still run");
  }

  const opts = { timezone: TZ };
  cron.schedule("30 0 * * *", () => run("nightly", () => nightly()), opts);
  cron.schedule("0 10 * * *", () => run("reminders", () => reminders()), opts);
  cron.schedule("0 20 * * *", () => run("teacher-reminders", () => teacherReminders()), opts);
  cron.schedule("0 21 * * *", () => run("daily-report", () => dailyReport()), opts);

  // catch up once on start so a fresh install has lessons and charges right away
  await run("nightly (startup)", () => nightly());

  let busy = false;
  setInterval(async () => {
    if (!send || busy) return;
    busy = true;
    try {
      const r = await processNotifications(send);
      if (r.sent || r.failed) log("notifications", JSON.stringify(r));
    } catch (e) {
      log("notifications error", e);
    } finally {
      busy = false;
    }
  }, 5_000);
  log(`started (TZ ${TZ})`);
}

process.on("SIGTERM", async () => {
  await db.$disconnect();
  process.exit(0);
});

main().catch((e) => {
  console.error("[worker] fatal", e);
  process.exit(1);
});
