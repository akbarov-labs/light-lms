// Nightly isolation and job re-run safety on the real database. Run: npm run test:integration
// Breakage is simulated with temporary Postgres triggers, so production code has no test hooks.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, fromISODate, monthRange, shiftMonth, todayISO, type ISODate } from "@/lib/dates";
import { dailyReport, jobProblems, nightly, reminders, teacherReminders } from "@/worker/jobs";
import { refreshFreezeStatuses } from "@/lib/services/enrollments";
import { generateLessons } from "@/lib/services/lessons";

const today = todayISO();
const SLUG = "jobs-test";
let centerId = "";
let branchId = "";
let courseId = "";
let teacherId = "";
let code = 9000;

async function group(name: string, extra: { status?: "ACTIVE" | "PLANNED"; startDate?: ISODate } = {}) {
  const g = await db.group.create({
    data: {
      centerId,
      branchId,
      courseId,
      teacherId,
      code: code++,
      name,
      startDate: fromISODate(extra.startDate ?? monthRange(shiftMonth(today.slice(0, 7), -1)).start),
      status: extra.status ?? "ACTIVE",
      slots: { create: [1, 3, 5].map((weekday) => ({ weekday, startTime: "14:00", endTime: "15:30" })) },
    },
  });
  return g.id;
}

async function enroll(groupId: string, name: string, chatId?: string) {
  const family = await db.family.create({ data: { centerId, name } });
  if (chatId) await db.guardian.create({ data: { familyId: family.id, name, phone: `99890${chatId}`, telegramChatId: chatId, isPrimary: true } });
  const student = await db.student.create({ data: { centerId, familyId: family.id, branchId, firstName: name, lastName: "Test" } });
  const start = fromISODate(monthRange(shiftMonth(today.slice(0, 7), -1)).start);
  const e = await db.enrollment.create({ data: { studentId: student.id, groupId, startDate: start, activatedAt: start, status: "ACTIVE" } });
  return { enrollmentId: e.id, familyId: family.id, studentId: student.id };
}

async function withTrigger<T>(table: string, condition: string, fn: () => Promise<T>): Promise<T> {
  const name = `test_break_${table.toLowerCase()}`;
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'corrupt row (test)'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT OR UPDATE ON "${table}" FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  try {
    return await fn();
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "${table}"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
  }
}

beforeAll(async () => {
  const c = await db.center.create({ data: { name: "Jobs test", slug: `${SLUG}-${Date.now()}` } });
  centerId = c.id;
  branchId = (await db.branch.create({ data: { centerId, name: "Main" } })).id;
  courseId = (await db.course.create({ data: { centerId, name: "English", pricingType: "SUBSCRIPTION", price: 300_000, renewal: "CALENDAR" } })).id;
  teacherId = (
    await db.user.create({ data: { centerId, phone: `99893${String(Date.now()).slice(-7)}`, name: "Teacher", passwordHash: "x", role: "TEACHER", isTeacher: true, perms: [], telegramChatId: "2001" } })
  ).id;
});

// remove this file's center completely, so the other test files see the database as they left it
afterAll(async () => {
  const enrollment = { group: { centerId } };
  await db.notification.deleteMany({ where: { centerId } });
  await db.auditLog.deleteMany({ where: { centerId } });
  await db.ledgerEntry.deleteMany({ where: { centerId } });
  await db.enrollmentFreeze.deleteMany({ where: { enrollment } });
  await db.attendance.deleteMany({ where: { enrollment } });
  await db.enrollment.deleteMany({ where: enrollment });
  await db.lesson.deleteMany({ where: { group: { centerId } } });
  await db.group.deleteMany({ where: { centerId } });
  await db.guardian.deleteMany({ where: { family: { centerId } } });
  await db.student.deleteMany({ where: { centerId } });
  await db.family.deleteMany({ where: { centerId } });
  await db.course.deleteMany({ where: { centerId } });
  await db.user.deleteMany({ where: { centerId } });
  await db.branch.deleteMany({ where: { centerId } });
  await db.center.delete({ where: { id: centerId } });
});

describe("nightly isolation", () => {
  it("a broken group and a failing step do not stop billing", async () => {
    const good = await group("Good group");
    const broken = await group("Broken group");
    const planned = await group("Planned group", { status: "PLANNED", startDate: addDays(today, -1) });
    const { enrollmentId } = await enroll(good, "Payer");

    const res = await withTrigger("Lesson", `NEW."groupId" = '${broken}'`, () => withTrigger("Group", `NEW.id = '${planned}' AND NEW.status = 'ACTIVE'`, () => nightly(today)));

    expect(res.lessonsFailed).toBe(1);
    expect(res.failedSteps).toBe("activateGroups");
    expect(String(res.activateGroupsError)).toMatch(/corrupt row/);
    expect(res.syncFailed).toBe(0);
    expect(typeof res.billingMs).toBe("number");
    expect(jobProblems(res)).toMatch(/failed steps: activateGroups; lessonsFailed=1/);
    // the good group still got its lessons and the enrollment its charges
    expect(await db.lesson.count({ where: { groupId: good } })).toBeGreaterThan(0);
    expect(await db.lesson.count({ where: { groupId: broken } })).toBe(0);
    expect(await db.ledgerEntry.count({ where: { enrollmentId, type: "CHARGE" } })).toBeGreaterThan(0);
    // without the triggers the next night catches up
    const again = await nightly(today);
    expect(again.failedSteps).toBeUndefined();
    expect(again.lessonsFailed).toBe(0);
    expect(jobProblems(again)).toBeNull();
    expect(await db.lesson.count({ where: { groupId: broken } })).toBeGreaterThan(0);
  });

  it("one enrollment that cannot be updated does not stop the other freeze changes", async () => {
    const g = await group("Freeze group");
    const a = await enroll(g, "FreezeA");
    const b = await enroll(g, "FreezeB");
    for (const e of [a, b]) await db.enrollmentFreeze.create({ data: { enrollmentId: e.enrollmentId, fromDate: fromISODate(addDays(today, -1)), toDate: fromISODate(addDays(today, 5)) } });
    const r = await withTrigger("Enrollment", `NEW.id = '${a.enrollmentId}'`, () => refreshFreezeStatuses(today));
    expect(r.failed).toBe(1);
    expect(r.changed).toBeGreaterThanOrEqual(1);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: b.enrollmentId } })).status).toBe("FROZEN");
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: a.enrollmentId } })).status).toBe("ACTIVE");
  });
});

describe("re-running jobs sends nothing twice", () => {
  it("reminders, teacher reminders and the daily report are deduplicated", async () => {
    // "today" three days before next month, so the 3-days-ahead reminder fires for calendar subscriptions
    const nextMonth = monthRange(shiftMonth(today.slice(0, 7), 1)).start;
    const day = addDays(nextMonth, -3);
    const g = await group("Reminder group");
    await generateLessons(g, { today: day });
    const payer = await enroll(g, "Remind", "2002");
    // a debt that is exactly 7 days old on `day`
    const debtor = await db.family.create({ data: { centerId, name: "Debtor" } });
    await db.guardian.create({ data: { familyId: debtor.id, name: "Debtor", phone: "998902003", telegramChatId: "2003" } });
    await db.ledgerEntry.create({ data: { centerId, familyId: debtor.id, type: "CHARGE", amount: -50_000, method: "SYSTEM", description: "old charge", date: fromISODate(addDays(day, -7)) } });
    await db.lesson.create({ data: { groupId: g, date: fromISODate(day), startTime: "18:00", endTime: "19:30", teacherId } });
    await db.user.create({ data: { centerId, phone: `99894${String(Date.now()).slice(-7)}`, name: "Owner", passwordHash: "x", role: "OWNER", perms: [], telegramChatId: "2004" } });

    const mine = () => db.notification.findMany({ where: { centerId }, select: { chatId: true, dedupeKey: true } });
    const first = await reminders(day);
    expect(Number(first.upcoming)).toBeGreaterThanOrEqual(1);
    expect(Number(first.debts)).toBeGreaterThanOrEqual(1);
    const t1 = await teacherReminders(day);
    expect(Number(t1.sent)).toBeGreaterThanOrEqual(1);
    const d1 = await dailyReport(day);
    expect(Number(d1.sent)).toBeGreaterThanOrEqual(1);
    const after = await mine();
    expect(after.some((n) => n.chatId === "2002" && n.dedupeKey === `remind:${payer.enrollmentId}:${nextMonth}:2002`)).toBe(true);
    expect(after.some((n) => n.chatId === "2003" && n.dedupeKey === `debt-overdue:${debtor.id}:${day}:2003`)).toBe(true);
    expect(after.some((n) => n.chatId === "2001" && n.dedupeKey?.startsWith(`teacher:${teacherId}:${day}`))).toBe(true);
    expect(after.some((n) => n.chatId === "2004" && n.dedupeKey?.startsWith("report:"))).toBe(true);

    expect(await reminders(day)).toEqual({ upcoming: 0, debts: 0 });
    expect((await teacherReminders(day)).sent).toBe(0);
    expect((await dailyReport(day)).sent).toBe(0);
    expect((await mine()).length).toBe(after.length);
  });
});
