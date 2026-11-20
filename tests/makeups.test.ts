// Make-up lessons: absences wait for a make-up, booking is allowed only on the center's make-up days, the
// family is told once, staff mark the outcome, another center sees nothing.
// Run: npm run test:integration
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, fromISODate, todayISO, weekdayOf } from "@/lib/dates";
import { buildCtx, loadUser } from "@/lib/ctx-core";
import { UserError } from "@/lib/user-error";
import { missedWithoutMakeup, nextAllowedDay, planMakeups, plannedMakeups, setMakeupStatus } from "@/lib/services/makeups";

const today = todayISO();
let centerId = "";
let otherCenterId = "";
let ownerId = "";
let otherOwnerId = "";
let studentId = "";
let lessonId = "";
const ctxOf = async (userId: string) => buildCtx((await loadUser(userId))!);

beforeAll(async () => {
  centerId = (await db.center.create({ data: { name: "Otrabotka markazi", slug: "makeups-test", settings: { makeupWeekdays: [7] } } })).id;
  otherCenterId = (await db.center.create({ data: { name: "Boshqa", slug: "makeups-other" } })).id;
  ownerId = (await db.user.create({ data: { centerId, phone: "998937770401", name: "Ega", passwordHash: "x", role: "OWNER", perms: [] } })).id;
  otherOwnerId = (await db.user.create({ data: { centerId: otherCenterId, phone: "998937770402", name: "Boshqa ega", passwordHash: "x", role: "OWNER", perms: [] } })).id;
  const branchId = (await db.branch.create({ data: { centerId, name: "Asosiy" } })).id;
  const course = await db.course.create({ data: { centerId, name: "Matematika", pricingType: "SUBSCRIPTION", price: 350_000 } });
  const g = await db.group.create({ data: { centerId, branchId, courseId: course.id, teacherId: ownerId, code: 1, name: "9-sinf", startDate: fromISODate(addDays(today, -30)), status: "ACTIVE" } });
  const family = await db.family.create({ data: { centerId, name: "Oila" } });
  await db.guardian.create({ data: { familyId: family.id, name: "Ona", phone: "998901110401", telegramChatId: "4401", isPrimary: true } });
  studentId = (await db.student.create({ data: { centerId, familyId: family.id, firstName: "Ali", lastName: "Valiyev" } })).id;
  const e = await db.enrollment.create({ data: { studentId, groupId: g.id, startDate: fromISODate(addDays(today, -30)), activatedAt: fromISODate(addDays(today, -30)), status: "ACTIVE" } });
  const lesson = (d: string) => db.lesson.create({ data: { groupId: g.id, date: fromISODate(d), startTime: "14:00", endTime: "17:00", teacherId: ownerId, status: "HELD" } });
  const missed = await lesson(addDays(today, -2));
  const came = await lesson(addDays(today, -4));
  const longAgo = await lesson(addDays(today, -40));
  lessonId = missed.id;
  await db.attendance.createMany({
    data: [
      { lessonId: missed.id, studentId, enrollmentId: e.id, status: "ABSENT" },
      { lessonId: came.id, studentId, enrollmentId: e.id, status: "PRESENT" },
      { lessonId: longAgo.id, studentId, enrollmentId: e.id, status: "ABSENT" },
    ],
  });
});

describe("make-up lessons", () => {
  it("finds the next allowed day", () => {
    const sunday = nextAllowedDay(today, [7]);
    expect(weekdayOf(sunday)).toBe(7);
    expect(sunday >= today && sunday <= addDays(today, 6)).toBe(true);
    expect(nextAllowedDay(today, [1, 2, 3, 4, 5, 6, 7])).toBe(today);
  });

  it("lists recent absences only, books them on Sunday only, and tells the family once", async () => {
    const ctx = await ctxOf(ownerId);
    const missed = await missedWithoutMakeup(ctx, today);
    expect(missed.map((m) => m.lessonId)).toEqual([lessonId]);

    const sunday = nextAllowedDay(addDays(today, 1), [7]);
    const monday = addDays(sunday, 1);
    await expect(planMakeups(ctx, [{ studentId, lessonId }], monday, "10:00", today)).rejects.toThrow(UserError);
    await expect(planMakeups(ctx, [{ studentId, lessonId }], sunday, "25:00", today)).rejects.toThrow(UserError);
    await expect(planMakeups(ctx, [{ studentId, lessonId }], addDays(sunday, -7 * 52), "10:00", today)).rejects.toThrow(UserError);

    expect(await planMakeups(ctx, [{ studentId, lessonId }], sunday, "10:00", today)).toBe(1);
    expect(await planMakeups(ctx, [{ studentId, lessonId }], sunday, "11:00", today)).toBe(0);
    expect(await missedWithoutMakeup(ctx, today)).toEqual([]);
    const notes = await db.notification.findMany({ where: { centerId, dedupeKey: { startsWith: `makeup:${studentId}:${lessonId}` } } });
    expect(notes.map((n) => n.chatId)).toEqual(["4401"]);
    expect(notes[0].text).toContain("10:00");

    const [mk] = await plannedMakeups(ctx, today);
    expect(mk).toMatchObject({ time: "10:00", status: "PLANNED" });
    await setMakeupStatus(ctx, mk.id, "DONE");
    expect((await db.makeup.findUniqueOrThrow({ where: { id: mk.id } })).status).toBe("DONE");
  });

  it("another center sees and touches nothing", async () => {
    const other = await ctxOf(otherOwnerId);
    expect(await missedWithoutMakeup(other, today)).toEqual([]);
    expect(await plannedMakeups(other, today)).toEqual([]);
    expect(await planMakeups(other, [{ studentId, lessonId }], nextAllowedDay(addDays(today, 1), [1, 2, 3, 4, 5, 6, 7]), "10:00", today)).toBe(0);
    const mk = await db.makeup.findFirstOrThrow({ where: { centerId } });
    await expect(setMakeupStatus(other, mk.id, "MISSED")).rejects.toThrow(UserError);
  });
});
