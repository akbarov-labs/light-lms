// Opens a center from a setup done in the bot chat (src/lib/sales-agent/onboarding.ts), after the team has
// read the summary the bot sent. On the server (DEPLOY.md §11e, "Running a script"):
//
//   … run --rm migrate npx tsx scripts/create-from-onboarding.ts <SalesChat id> --dry-run
//       what would be created, or every problem with the draft at once
//   … run --rm migrate npx tsx scripts/create-from-onboarding.ts <SalesChat id> [--slug <slug>] [--plan PRO]
//       creates the center, owner, branches, courses, teachers (+ salary rules) and groups (+ lessons);
//       prints the logins with temporary passwords and each group's code (#) for the student file
//   cat students.csv | … run -T --rm migrate npx tsx scripts/create-from-onboarding.ts <SalesChat id> --students - [--dry-run]
//       imports the student list into that center: the usual CSV import (Students → Import), same columns
//
// The SalesChat id is in the team chat message ("🏫 Sabaq: markaz sozlash so'rovi"). A Telegram chat id works too.
import { readFileSync } from "node:fs";
import type { Plan } from "../src/generated/prisma/client";
import { db } from "../src/lib/db";
import { buildCtx, loadUser } from "../src/lib/ctx-core";
import { planFromDraft, readOnboarding } from "../src/lib/sales-agent/onboarding";
import { createCenterFromPlan } from "../src/lib/sales-agent/create-center";
import { importStudents } from "../src/app/(admin)/students/import/import-core";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const PLANS: Plan[] = ["FREE", "START", "GROWTH", "PRO"];

async function main() {
  const id = args[0];
  if (!id || id.startsWith("--")) {
    console.error("usage: tsx scripts/create-from-onboarding.ts <SalesChat id | Telegram chat id> [--dry-run] [--slug s] [--plan PRO] [--students <file|->]");
    process.exit(1);
  }
  const chat = await db.salesChat.findFirst({ where: { OR: [{ id }, { chatId: id }] } });
  if (!chat) throw new Error(`no SalesChat ${id}`);
  const o = readOnboarding(chat.onboarding);
  const dry = flag("dry-run");

  const students = value("students");
  if (students) {
    if (o.status !== "created" || !o.centerId) throw new Error("create the center first (this chat's setup is not created yet)");
    const owner = await db.user.findFirst({ where: { centerId: o.centerId, role: "OWNER" }, orderBy: { createdAt: "asc" }, select: { id: true } });
    const user = owner && (await loadUser(owner.id));
    if (!user) throw new Error("the center has no owner");
    const text = readFileSync(students === "-" ? 0 : students, "utf8");
    const r = await importStudents(buildCtx(user, { locale: "uz" }), text, dry);
    console.log(`${dry ? "[dry run] " : ""}${r.message}`);
    console.log(`new: ${r.created}, already there: ${r.existing}`);
    r.errors.forEach((e) => console.log(`  error: ${e}`));
    r.warnings.forEach((w) => console.log(`  check: ${w}`));
    return;
  }

  if (o.status === "created") throw new Error(`already created: center ${o.centerId}`);
  if (o.status !== "submitted") console.warn(`note: the owner has not confirmed the summary yet (status: ${o.status})`);
  const p = planFromDraft(o.draft, chat.phone);
  if (!p.ok) {
    console.error("The draft is not ready:");
    p.errors.forEach((e) => console.error(`  - ${e}`));
    console.error("Fix it with the owner in the chat (reply to the team message), then run again.");
    process.exit(1);
  }
  const { plan } = p;
  const tariff = (value("plan")?.toUpperCase() ?? "PRO") as Plan;
  if (!PLANS.includes(tariff)) throw new Error(`--plan must be one of ${PLANS.join(", ")}`);
  console.log(`Center: ${plan.center.name}  (plan ${tariff})`);
  console.log(`Owner: ${plan.owner.name} +${plan.owner.phone}${plan.owner.teaches ? " (also teaches)" : ""}`);
  plan.branches.forEach((b) => console.log(`Branch: ${b.name}${b.rooms.length ? ` — rooms: ${b.rooms.join(", ")}` : ""}`));
  plan.courses.forEach((c) => console.log(`Course: ${c.name} — ${c.price} ${c.pricingType}${c.packageLessons ? ` ×${c.packageLessons}` : ""}`));
  plan.teachers.forEach((t) => console.log(`Teacher: ${t.name} +${t.phone} — ${t.salary ? JSON.stringify(t.salary) : "NO SALARY RULE"}`));
  plan.groups.forEach((g) => console.log(`Group: ${g.name} — ${plan.courses[g.course].name}, ${g.teacher === "owner" ? plan.owner.name : plan.teachers[g.teacher].name}, ${g.slots.map((s) => `${s.weekday} ${s.startTime}-${s.endTime}`).join(", ")}`));
  if (Object.keys(plan.settings).length) console.log(`Settings: ${JSON.stringify(plan.settings)}`);
  if (dry) return console.log("[dry run] nothing written");

  const made = await createCenterFromPlan(plan, { slug: value("slug"), plan: tariff, source: `create-from-onboarding ${chat.id}` });
  await db.salesChat.update({ where: { id: chat.id }, data: { onboarding: JSON.parse(JSON.stringify({ ...o, status: "created", centerId: made.centerId })) } });
  console.log(`\nCreated "${plan.center.name}" (${made.slug}). Logins — each must set a new password at first sign-in:`);
  console.log(`  owner   ${made.owner.name}  ${made.owner.phone}  ${made.owner.password}`);
  made.teachers.forEach((t) => console.log(`  teacher ${t.name}  ${t.phone}  ${t.password}`));
  console.log("Group codes for the student file (column 5, Guruh kodi):");
  made.groups.forEach((g) => console.log(`  #${g.code}  ${g.name}`));
  console.log("Send each person their own login (reply to the team message reaches the owner).");
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
