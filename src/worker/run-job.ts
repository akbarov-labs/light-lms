// `npm run job:<name>` — run one job by hand (optionally for a date: npm run job:nightly -- 2026-10-01).
import { db } from "@/lib/db";
import { generateAllLessons } from "@/lib/services/lessons";
import { billingSync, dailyReport, nightly, reminders, teacherReminders } from "./jobs";
import { processNotifications } from "./notifications";
import { resetDemo } from "./demo-reset";
import { todayISO } from "@/lib/dates";

const [name, date] = process.argv.slice(2);
const today = date ?? todayISO();

const jobs: Record<string, () => Promise<unknown>> = {
  nightly: () => nightly(today),
  lessons: () => generateAllLessons(today),
  billing: () => billingSync(today),
  reminders: () => reminders(today),
  "teacher-reminders": () => teacherReminders(today),
  "daily-report": () => dailyReport(today),
  "demo-reset": async () => ({ ...(await resetDemo()), ...(await nightly(today)) }),
  notifications: async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return "TELEGRAM_BOT_TOKEN empty — nothing sent";
    const { Bot } = await import("grammy");
    const bot = new Bot(token);
    return processNotifications((chatId, text) => bot.api.sendMessage(chatId, text, { parse_mode: "HTML" }).then(() => undefined));
  },
};

const job = jobs[name];
if (!job) {
  console.error(`unknown job "${name}". Jobs: ${Object.keys(jobs).join(", ")}`);
  process.exit(1);
}
job()
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
