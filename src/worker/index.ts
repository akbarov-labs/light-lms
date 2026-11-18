// Worker process: cron jobs (Asia/Tashkent), the notification queue and the Telegram bot.
import { writeFile } from "node:fs/promises";
import cron, { type ScheduledTask } from "node-cron";
import type { Bot } from "grammy";
import { db } from "@/lib/db";
import { TZ } from "@/lib/dates";
import { ALLOWED_UPDATES, createBot, miniAppUrl } from "./bot";
import { BotPool } from "./bot/pool";
import { managedBotsOn } from "@/lib/managed-bots/service";
import { processNotifications, routedSender, telegramSender, type Sender } from "./notifications";
import { errText, sleep } from "./util";
import { dailyReport, jobProblems, nightly, reminders, reportCardsJob, teacherReminders, type JobResult } from "./jobs";
import { lockKeyFor, withJobLock } from "./job-lock";
import { assertStrongAuthSecret } from "@/lib/auth/startup";
import { refreshAllBalances } from "@/lib/billing/balance-cache";
import { demoMode } from "@/config/brand";
import { resetDemo } from "./demo-reset";
import { alertOps, opsAlertsEnabled } from "@/lib/ops-alert";
import { backupCheck } from "./backup-check";
import { telegramBotToken } from "@/lib/env";
import type { NotificationChannel } from "@/generated/prisma/client";
import { smsDryRun, smsSender } from "./sms-sender";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[worker]", ...a);

/** Touched every 30 s while the event loop is alive; the compose healthcheck fails when it is older than 2 min. */
const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE?.trim() || "/tmp/worker-heartbeat";
const HEARTBEAT_MS = 30_000;
const QUEUE_TICK_MS = 5_000;
/** On SIGTERM: how long to wait for the bot and the in-flight notification batch (compose gives 20 s). */
const DRAIN_MS = 10_000;

let stopping = false;
let bot: Bot | null = null;
let pool: BotPool | null = null;
const tasks: ScheduledTask[] = [];
const timers: NodeJS.Timeout[] = [];
const queueAbort = new AbortController();
const queueRuns = new Map<NotificationChannel, Promise<void>>();

/**
 * Run a job under its advisory lock; skip when another worker or a manual run already has it.
 * `idle(result)` true = nothing happened: a frequent job logs only runs that did something.
 */
async function run(name: string, job: () => Promise<JobResult>, lockKey = lockKeyFor(name), idle?: (r: JobResult) => boolean) {
  if (stopping) return;
  const t0 = Date.now();
  if (!idle) log(`job ${name} start`);
  try {
    const r = await withJobLock(lockKey, job);
    if (!r.ran) {
      log(`job ${name} skipped: "${lockKey}" is already running (another worker or a manual run)`);
      return;
    }
    if (!idle?.(r.result)) log(`job ${name} done in ${Date.now() - t0}ms`, JSON.stringify(r.result));
    const problem = jobProblems(r.result);
    if (problem) await alertOps(`job:${name}`, `Worker job "${name}" finished with problems: ${problem}`.slice(0, 400));
  } catch (e) {
    log(`job ${name} FAILED`, e);
    await alertOps(`job:${name}`, `Worker job "${name}" failed: ${errText(e, 300)}`);
  }
}

function schedule(expr: string, name: string, job: () => Promise<JobResult>, idle?: (r: JobResult) => boolean) {
  // noOverlap: a run still going when the next one is due is not started twice in this process
  tasks.push(cron.schedule(expr, () => run(name, job, lockKeyFor(name), idle), { timezone: TZ, name, noOverlap: true }));
}

function beat() {
  writeFile(HEARTBEAT_FILE, new Date().toISOString()).catch((e) => log("heartbeat write failed", e));
}

function startQueue(send: Sender, channel: NotificationChannel) {
  let pausedUntil = 0;
  const tick = async () => {
    if (stopping || Date.now() < pausedUntil) return;
    const r = await processNotifications(send, { signal: queueAbort.signal, channel });
    if (r.rateLimitedMs) pausedUntil = Date.now() + r.rateLimitedMs;
    if (r.sent || r.failed || r.retried || r.reclaimed || r.rateLimitedMs) log(`notifications ${channel}`, JSON.stringify(r));
  };
  timers.push(
    setInterval(() => {
      if (queueRuns.has(channel)) return;
      queueRuns.set(
        channel,
        tick()
          .catch((e) => log(`notifications ${channel} error`, e))
          .finally(() => queueRuns.delete(channel)),
      );
    }, QUEUE_TICK_MS),
  );
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log(`${signal}: stopping`);
  for (const t of timers) clearInterval(t);
  await Promise.allSettled(tasks.map((t) => t.stop()));
  queueAbort.abort(); // the batch stops after the message in flight and gives the rest back to the queue
  const drained = await Promise.race([
    Promise.allSettled([bot?.stop(), pool?.stopAll(), ...queueRuns.values()]).then(() => true),
    sleep(DRAIN_MS).then(() => false),
  ]);
  if (!drained) log(`gave up waiting after ${DRAIN_MS}ms (unsent rows return to the queue after 10 min)`);
  await db.$disconnect().catch(() => {});
  log("stopped");
  process.exit(0);
}

async function main() {
  assertStrongAuthSecret("worker");
  await db.$queryRaw`SELECT 1`;
  beat();
  timers.push(setInterval(beat, HEARTBEAT_MS));

  const token = telegramBotToken();
  let send: Sender | null = null;
  if (token) {
    // centers' own bots (managed bots): polled next to the shared bot, which manages them
    const p = managedBotsOn() ? new BotPool(log) : null;
    pool = p;
    const b = createBot(token, { onManagedBot: (r) => p?.onManagedBot(r) });
    bot = b;
    // a row goes through the center's own bot when the person started it, else through the shared bot
    send = routedSender(telegramSender(b.api));
    b.start({ drop_pending_updates: true, allowed_updates: [...ALLOWED_UPDATES], onStart: (me) => {
      log(`bot @${me.username} polling`);
      if (p && !me.can_manage_bots) log("TELEGRAM_MANAGED_BOTS=true but Bot Management Mode is off for this bot in @BotFather — centers can't create bots");
    } }).catch((e) => log("bot stopped", e));
    if (p) {
      void p.reconcile();
      timers.push(setInterval(() => void p.reconcile(), 60_000));
      log("managed bots on — centers' own bots are polled by this worker");
    }
    // the chat menu button opens the Mini App for everyone (unlinked chats are told to share their phone)
    const app = miniAppUrl();
    if (app) b.api.setChatMenuButton({ menu_button: { type: "web_app", text: "📱 Ilova", web_app: { url: app } } }).then(() => log(`mini app menu button → ${app}`), (e) => log("mini app menu button failed", e));
    else log("Mini App needs an https APP_URL — menu button not set");
  } else {
    log("TELEGRAM_BOT_TOKEN is empty — bot disabled, notifications stay queued; jobs still run");
  }

  schedule("30 0 * * *", "nightly", () => nightly());
  schedule("0 10 * * *", "reminders", () => reminders());
  schedule("0 20 * * *", "teacher-reminders", () => teacherReminders());
  schedule("0 21 * * *", "daily-report", () => dailyReport());
  schedule("0 11 * * *", "report-cards", () => reportCardsJob());
  // family balance cache: pages refresh it themselves, this keeps that work off page views
  schedule("*/5 * * * *", "balances", () => refreshAllBalances(), (r) => !r.balancesRefreshed);
  // prod: the backups folder is mounted read-only at BACKUP_CHECK_DIR; alert if last night's dump is missing
  const backupDir = process.env.BACKUP_CHECK_DIR?.trim();
  if (backupDir) schedule("0 9 * * *", "backup-check", () => backupCheck(backupDir, alertOps));
  log(opsAlertsEnabled() ? "ops alerts → Telegram on" : "ops alerts off (set OPS_TELEGRAM_CHAT_ID + TELEGRAM_BOT_TOKEN)");
  if (demoMode()) {
    // public demo server: fresh demo data every night, then today's lessons and charges
    schedule("0 4 * * *", "demo-reset", async () => ({ ...(await resetDemo()), ...(await nightly()) }));
    log("DEMO_MODE on — the database is wiped and re-seeded every night at 04:00");
  }

  if (send) startQueue(send, "TELEGRAM");
  // SMS rows wait for a center with an Eskiz account; the queue runs with or without the bot
  startQueue(smsSender(), "SMS");
  if (smsDryRun()) log("SMS dry run — SMS rows are logged, not sent (SMS_DRY_RUN / DEMO_MODE)");
  log(`started (TZ ${TZ})`);

  // catch up once on start so a fresh install has lessons and charges right away (same lock as 00:30)
  await run("nightly (startup)", () => nightly(), "nightly");
}

process.on("unhandledRejection", (e) => {
  log("unhandled rejection", e);
  void alertOps("worker:unhandled", `Worker unhandled error: ${errText(e, 300)}`);
});
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

main().catch(async (e) => {
  console.error("[worker] fatal", e);
  await alertOps("worker:fatal", `Worker crashed on start: ${errText(e, 300)}`);
  process.exit(1);
});
