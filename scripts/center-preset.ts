// Puts a center's answers from the setup questionnaire into its settings in one go, so nothing is forgotten
// on the day it goes live. The values below are the first pilot's (a tutor center: 2 free trial lessons,
// billing reminders from the due day every day, the owner's report at 19:00, homework in the bot with photos).
// Center-specific text (the AI agent's rules: prices, discounts, refunds) never lives in this public repo:
// it comes from a local file with --rules.
//
//   … run --rm migrate npx tsx scripts/center-preset.ts <center id|slug> --dry-run
//       prints the settings before and after, changes nothing
//   cat rules.txt | … run -T --rm migrate npx tsx scripts/center-preset.ts <center id|slug> [--rules -] [--plan GROWTH]
//
// Billing from the 15th is set on the course (Courses → "Oy qaysi kundan boshlanadi"), not here.
import { readFileSync } from "node:fs";
import type { Plan, Prisma } from "../src/generated/prisma/client";
import { db } from "../src/lib/db";
import { readSettings, type CenterSettings } from "../src/lib/settings";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const PLANS: Plan[] = ["FREE", "START", "GROWTH", "PRO"];

export function applyPreset(s: CenterSettings, rules?: string): CenterSettings {
  return {
    ...s,
    trialLessons: 2,
    // the due-day note comes from the daily debt reminder (it starts on the due day), not a day before
    reminderDaysBefore: 0,
    notify: { ...s.notify, reminder: true, debt: true, debtDaily: true, absence: true, dailyReport: true },
    dailyReportHour: 19,
    // "qoldirilgan dars faqat yakshanbada"
    makeupWeekdays: [7],
    homework: { ...s.homework, enabled: true, photos: true, directFromGrade: 9, dueMinutesBefore: 60, lateDays: 7, attempts: 3, remindHoursBefore: 3 },
    // results reach parents only when the owner sends them
    reportCards: { ...s.reportCards, autoSend: false },
    agent: rules === undefined ? s.agent : { ...s.agent, rules: rules.trim().slice(0, 4000) },
  };
}

async function main() {
  const id = args[0];
  if (!id || id.startsWith("--")) {
    console.error("usage: tsx scripts/center-preset.ts <center id|slug> [--dry-run] [--rules <file|->] [--plan GROWTH]");
    process.exit(1);
  }
  const center = await db.center.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!center) throw new Error(`no center ${id}`);
  const rulesArg = value("rules");
  const rules = rulesArg === undefined ? undefined : readFileSync(rulesArg === "-" ? 0 : rulesArg, "utf8");
  const plan = value("plan");
  if (plan && !PLANS.includes(plan as Plan)) throw new Error(`plan must be one of ${PLANS.join(", ")}`);

  const before = readSettings(center.settings);
  const after = applyPreset(before, rules);
  console.log(`${center.name} (${center.slug})`);
  for (const key of Object.keys(after) as (keyof CenterSettings)[]) {
    const a = JSON.stringify(before[key]);
    const b = JSON.stringify(after[key]);
    if (a !== b) console.log(`  ${key}: ${a}\n    → ${b}`);
  }
  if (plan && plan !== center.plan) console.log(`  plan: ${center.plan} → ${plan}`);
  if (flag("dry-run")) {
    console.log("dry run: nothing changed");
    return;
  }
  await db.center.update({ where: { id: center.id }, data: { settings: after as unknown as Prisma.InputJsonValue, ...(plan ? { plan: plan as Plan } : {}) } });
  console.log("saved. Still by hand: the course's billing day (15), the bot token, ANTHROPIC_API_KEY on the server.");
}

if (process.argv[1]?.endsWith("center-preset.ts")) {
  main()
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
