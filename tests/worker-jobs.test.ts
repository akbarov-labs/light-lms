// Nightly isolation and job re-run safety on the real database. Run: npm run test:integration
// Breakage is simulated with temporary Postgres triggers, so production code has no test hooks.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, fromISODate, monthRange, shiftMonth, todayISO, type ISODate } from "@/lib/dates";
import { dailyReport, jobProblems, nightly, ownerReport, reminders, teacherReminders } from "@/worker/jobs";
import { refreshFreezeStatuses } from "@/lib/services/enrollments";
import { generateLessons } from "@/lib/services/lessons";
import { weeklyParentReports } from "@/lib/services/weekly-report";
import { weekdayOf } from "@/lib/dates";

const today = todayISO();
const SLUG = "jobs-test";
let centerId = "";
let branchId = "";
let courseId = "";
let teacherId = "";
let code = 9000;

async function group(name: string, extra: { status?: "ACTIVE" | "PLANNED"; startDate?: ISODate; branchId?: string } = {}) {
  const g = await db.group.create({
    data: {
      centerId,
      branchId: extra.branchId ?? branchId,
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

const extraCenters: string[] = [];

// remove this file's centers completely, so the other test files see the database as they left it
afterAll(async () => {
  for (const id of [...extraCenters, centerId]) await wipeCenter(id);
});

async function wipeCenter(centerId: string) {
  const enrollment = { group: { centerId } };
  await db.notification.deleteMany({ where: { centerId } });
  await db.auditLog.deleteMany({ where: { centerId } });
  await db.ledgerEntry.deleteMany({ where: { centerId } });
  await db.enrollmentFreeze.deleteMany({ where: { enrollment } });
  await db.attendance.deleteMany({ where: { enrollment } });
  await db.homeworkSubmission.deleteMany({ where: { homework: { centerId } } });
  await db.homework.deleteMany({ where: { centerId } });
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
}

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

    expect(await reminders(day)).toEqual({ upcoming: 0, debts: 0, centersFailed: 0, remindersFailed: 0 });
    expect((await teacherReminders(day)).sent).toBe(0);
    expect((await dailyReport(day)).sent).toBe(0);
    expect((await mine()).length).toBe(after.length);
  });
});

describe("reminders, teacher reminders and the daily report are isolated per center / recipient", () => {
  it("one center whose notifications cannot be queued does not stop the others", async () => {
    const D = addDays(today, 2);
    const uniq = String(Date.now()).slice(-6);
    // center B: a debtor 7 days overdue, a teacher with a lesson on D, an owner — all linked in Telegram
    const b = (await db.center.create({ data: { name: "Jobs test B", slug: `${SLUG}-b-${Date.now()}` } })).id;
    extraCenters.push(b);
    const bBranch = (await db.branch.create({ data: { centerId: b, name: "B main" } })).id;
    const bCourse = (await db.course.create({ data: { centerId: b, name: "Math", pricingType: "SUBSCRIPTION", price: 100_000 } })).id;
    const bTeacher = await db.user.create({ data: { centerId: b, phone: `998951${uniq}`, name: "B teacher", passwordHash: "x", role: "TEACHER", isTeacher: true, perms: [], telegramChatId: "7001" } });
    const bOwner = await db.user.create({ data: { centerId: b, phone: `998952${uniq}`, name: "B owner", passwordHash: "x", role: "OWNER", perms: [], telegramChatId: "7002" } });
    const bGroup = await db.group.create({ data: { centerId: b, branchId: bBranch, courseId: bCourse, teacherId: bTeacher.id, code: 1, name: "B group", startDate: fromISODate(addDays(today, -30)) } });
    await db.lesson.create({ data: { groupId: bGroup.id, date: fromISODate(D), startTime: "10:00", endTime: "11:00", teacherId: bTeacher.id } });
    const bFamily = await db.family.create({ data: { centerId: b, name: "B debtor" } });
    await db.guardian.create({ data: { familyId: bFamily.id, name: "B debtor", phone: `998953${uniq}`, telegramChatId: "7003" } });
    await db.ledgerEntry.create({ data: { centerId: b, familyId: bFamily.id, type: "CHARGE", amount: -50_000, method: "SYSTEM", description: "old", date: fromISODate(addDays(D, -7)) } });
    // the same in this file's center (A), whose notification inserts will fail
    const aGroup = await group("Isolation group");
    await db.lesson.create({ data: { groupId: aGroup, date: fromISODate(D), startTime: "10:00", endTime: "11:00", teacherId } });
    await db.user.create({ data: { centerId, phone: `998954${uniq}`, name: "A owner", passwordHash: "x", role: "OWNER", perms: [], telegramChatId: "7004" } });
    const aFamily = await db.family.create({ data: { centerId, name: "A debtor" } });
    await db.guardian.create({ data: { familyId: aFamily.id, name: "A debtor", phone: `998955${uniq}`, telegramChatId: "7005" } });
    await db.ledgerEntry.create({ data: { centerId, familyId: aFamily.id, type: "CHARGE", amount: -50_000, method: "SYSTEM", description: "old", date: fromISODate(addDays(D, -7)) } });

    const [r, t, d] = await withTrigger("Notification", `NEW."centerId" = '${centerId}'`, async () => [await reminders(D), await teacherReminders(D), await dailyReport(D)] as const);

    expect(Number(r.remindersFailed)).toBeGreaterThanOrEqual(1);
    expect(r.centersFailed).toBe(0);
    expect(Number(t.teachersFailed)).toBe(1);
    expect(Number(d.reportsFailed)).toBeGreaterThanOrEqual(1);
    for (const res of [r, t, d]) expect(jobProblems(res)).toMatch(/Failed=/);
    const bNotes = await db.notification.findMany({ where: { centerId: b }, select: { chatId: true, dedupeKey: true } });
    expect(bNotes.some((n) => n.chatId === "7003" && n.dedupeKey === `debt-overdue:${bFamily.id}:${D}:7003`)).toBe(true);
    expect(bNotes.some((n) => n.chatId === "7001" && n.dedupeKey === `teacher:${bTeacher.id}:${D}:7001`)).toBe(true);
    expect(bNotes.some((n) => n.chatId === "7002" && n.dedupeKey === `report:${bOwner.id}:${D}:7002`)).toBe(true);
    expect(await db.notification.count({ where: { centerId, chatId: { in: ["7004", "7005"] } } })).toBe(0);

    // without the trigger the next run catches up for center A and reports no problems
    const again = [await reminders(D), await teacherReminders(D), await dailyReport(D)];
    for (const res of again) expect(jobProblems(res)).toBeNull();
    expect(await db.notification.count({ where: { centerId, chatId: { in: ["7004", "7005"] } } })).toBe(2);
  });
});

describe("owner report scope (F2)", () => {
  it("a branch-limited manager counts only new and leaving students of their branches", async () => {
    const other = (await db.branch.create({ data: { centerId, name: "Other" } })).id;
    const gOther = await group("Other group", { branchId: other });
    const gMain = await group("Main group 2");
    // one new student per branch, each leaving its group today
    for (const [g, b] of [
      [gOther, other],
      [gMain, branchId],
    ]) {
      const family = await db.family.create({ data: { centerId, name: "Leavers" } });
      const s = await db.student.create({ data: { centerId, familyId: family.id, branchId: b, firstName: "New", lastName: "Leaver" } });
      await db.enrollment.create({ data: { studentId: s.id, groupId: g, startDate: fromISODate(addDays(today, -10)), endDate: fromISODate(today), status: "LEFT" } });
    }
    const manager = await db.user.create({
      data: { centerId, phone: `99896${String(Date.now()).slice(-7)}`, name: "Manager", passwordHash: "x", role: "MANAGER", perms: ["finance.view"], branches: { create: [{ branchId: other }] } },
    });
    const text = await ownerReport(manager.id, today);
    expect(text).toMatch(/: \+1 · [^\n]*: −1\n/);
    // the owner sees both branches (and the students of earlier tests)
    const owner = await db.user.findFirstOrThrow({ where: { centerId, role: "OWNER" } });
    const [, plus, minus] = /: \+(\d+) · [^\n]*: −(\d+)\n/.exec((await ownerReport(owner.id, today))!)!;
    expect(Number(plus)).toBeGreaterThanOrEqual(2);
    expect(Number(minus)).toBe(2);
  });
});

describe("daily debt reminders (first pilot)", () => {
  it("off: only days 3, 7, 14, 30; on: every day from the due day, Telegram only between escalation days", async () => {
    const day = addDays(today, 40);
    const fam = await db.family.create({ data: { centerId, name: "Daily debtor" } });
    await db.guardian.create({ data: { familyId: fam.id, name: "Daily", phone: "998902005", telegramChatId: "2005" } });
    await db.ledgerEntry.create({ data: { centerId, familyId: fam.id, type: "CHARGE", amount: -70_000, method: "SYSTEM", description: "month", date: fromISODate(addDays(day, -5)) } });
    const notes = (d: string, channel: "TELEGRAM" | "SMS" = "TELEGRAM") => db.notification.count({ where: { centerId, channel, dedupeKey: { startsWith: `debt-overdue:${fam.id}:${d}` } } });

    await reminders(day);
    expect(await notes(day)).toBe(0);

    const c = await db.center.findUniqueOrThrow({ where: { id: centerId } });
    const s = (c.settings ?? {}) as Record<string, unknown>;
    await db.center.update({ where: { id: centerId }, data: { settings: { ...s, notify: { ...((s.notify as object) ?? {}), debtDaily: true } } } });
    try {
      await reminders(day);
      expect(await notes(day)).toBe(1);
      expect(await notes(day, "SMS")).toBe(0);
      // the due day itself counts too
      const due = addDays(day, -5);
      await reminders(due);
      expect(await notes(due)).toBe(1);
    } finally {
      await db.center.update({ where: { id: centerId }, data: { settings: c.settings ?? {} } });
    }
  });
});

describe("weekly report to families", () => {
  it("off by default; on: the week's lessons and homework go to the family once, on the center's day", async () => {
    const day = addDays(today, 60);
    const g = await group("Weekly group");
    const s = await enroll(g, "Weekly", "2006");
    const lesson = (d: ISODate) => db.lesson.create({ data: { groupId: g, date: fromISODate(d), startTime: "14:00", endTime: "15:30", teacherId, status: "HELD" } });
    const l1 = await lesson(addDays(day, -5));
    const l2 = await lesson(addDays(day, -3));
    const old = await lesson(addDays(day, -9));
    for (const [l, status] of [[l1, "PRESENT"], [l2, "ABSENT"], [old, "ABSENT"]] as const) {
      await db.attendance.create({ data: { lessonId: l.id, studentId: s.studentId, enrollmentId: s.enrollmentId, status } });
    }
    const hw = await db.homework.create({ data: { centerId, groupId: g, lessonId: l1.id, answers: ["A", "12", "C"] } });
    await db.homeworkSubmission.create({ data: { homeworkId: hw.id, studentId: s.studentId, answers: ["A", "12", "B"], firstAnswers: ["A", "11", "B"], checks: 2 } });
    await db.homework.create({ data: { centerId, groupId: g, lessonId: l2.id, answers: ["B"] } });

    const notes = () => db.notification.findMany({ where: { centerId, dedupeKey: { startsWith: `weekly:${s.studentId}:` } }, select: { text: true } });
    expect((await weeklyParentReports(day)).centers).toBe(0);
    expect(await notes()).toEqual([]);

    const c = await db.center.findUniqueOrThrow({ where: { id: centerId } });
    const settings = (c.settings ?? {}) as Record<string, unknown>;
    await db.center.update({ where: { id: centerId }, data: { settings: { ...settings, parentReports: { weekly: true, weekday: weekdayOf(day), hour: 18 } } } });
    try {
      expect((await weeklyParentReports(day, 17)).centers).toBe(0);
      const r = await weeklyParentReports(day, 18);
      expect(r).toMatchObject({ centers: 1, failed: 0 });
      const [n] = await notes();
      expect(n.text).toContain("Weekly Test");
      // 2 lessons this week (the one 9 days ago is last week), came to 1
      expect(n.text).toContain("2 tadan 1 tasiga keldi");
      // first check counts: 1 of 3; the sheet nobody answered says so
      expect(n.text).toContain("1/3");
      expect(n.text).toContain("topshirilmadi");
      expect((await weeklyParentReports(day, 18)).sent).toBe(0);
    } finally {
      await db.center.update({ where: { id: centerId }, data: { settings: c.settings ?? {} } });
    }
  });
});
