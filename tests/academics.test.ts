// Report cards on the database: drafts, comments and access, sending (snapshot + parent message), auto-send job.
// Run: npm run test:integration
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fromISODate } from "@/lib/dates";
import { boardRows, cardData, ensureCards, saveComments, sendCards } from "@/lib/services/report-cards";
import { reportCardsJob } from "@/worker/jobs";
import { UserError } from "@/lib/user-error";

const MONTH = "2026-08";
let centerId = "";
let groupId = "";
let teacherId = "";
let otherTeacherId = "";
let aliEnrollment = "";
let aliId = "";
const lessonIds: string[] = [];

beforeAll(async () => {
  const slug = `acad-${Date.now()}`;
  const c = await db.center.create({ data: { name: "Akademik markaz", slug, settings: { gradeScale: "5" } } });
  centerId = c.id;
  const branch = await db.branch.create({ data: { centerId, name: "Markaz" } });
  const teacher = await db.user.create({ data: { centerId, phone: `99890${String(Date.now()).slice(-7)}`, name: "Ustoz", passwordHash: "x", role: "TEACHER", isTeacher: true, branches: { create: { branchId: branch.id } } } });
  teacherId = teacher.id;
  otherTeacherId = (await db.user.create({ data: { centerId, phone: `99891${String(Date.now()).slice(-7)}`, name: "Boshqa", passwordHash: "x", role: "TEACHER", isTeacher: true } })).id;
  const course = await db.course.create({ data: { centerId, name: "English A1", level: "A1", pricingType: "SUBSCRIPTION", price: 500_000 } });
  const g = await db.group.create({ data: { centerId, branchId: branch.id, courseId: course.id, teacherId, code: 1, name: "A1 ertalab", startDate: fromISODate("2026-07-01") } });
  groupId = g.id;
  const fam = await db.family.create({ data: { centerId, name: "Valiyevlar", guardians: { create: { name: "Ona", phone: "998901112233", telegramChatId: "777001", isPrimary: true } } } });
  const ali = await db.student.create({ data: { centerId, familyId: fam.id, firstName: "Ali", lastName: "Valiyev" } });
  aliId = ali.id;
  const vali = await db.student.create({ data: { centerId, familyId: fam.id, firstName: "Vali", lastName: "Valiyev" } });
  const trial = await db.student.create({ data: { centerId, familyId: fam.id, firstName: "Sinov", lastName: "Bola" } });
  aliEnrollment = (await db.enrollment.create({ data: { studentId: ali.id, groupId, startDate: fromISODate("2026-07-01"), activatedAt: fromISODate("2026-07-01"), status: "ACTIVE" } })).id;
  const valiE = await db.enrollment.create({ data: { studentId: vali.id, groupId, startDate: fromISODate("2026-07-01"), activatedAt: fromISODate("2026-07-01"), status: "ACTIVE" } });
  await db.enrollment.create({ data: { studentId: trial.id, groupId, startDate: fromISODate("2026-08-10"), status: "TRIAL" } });
  const plan: [string, "PRESENT" | "ABSENT" | "LATE", number | null][] = [
    ["2026-08-03", "PRESENT", 5],
    ["2026-08-05", "LATE", 4],
    ["2026-08-07", "ABSENT", null],
    ["2026-08-10", "PRESENT", 3],
  ];
  for (const [date, status, grade] of plan) {
    const l = await db.lesson.create({ data: { groupId, date: fromISODate(date), startTime: "09:00", endTime: "10:30", teacherId, status: "HELD", topic: `Mavzu ${date.slice(8)}` } });
    lessonIds.push(l.id);
    await db.attendance.create({ data: { lessonId: l.id, studentId: ali.id, enrollmentId: aliEnrollment, status, grade, comment: date === "2026-08-10" ? "Uy vazifasi yo'q" : null } });
    await db.attendance.create({ data: { lessonId: l.id, studentId: vali.id, enrollmentId: valiE.id, status: "PRESENT", grade: 5 } });
  }
  await db.lesson.create({ data: { groupId, date: fromISODate("2026-08-12"), startTime: "09:00", endTime: "10:30", teacherId, status: "CANCELLED" } });
});

const teacher = () => ({ userId: teacherId, centerId, canEdit: false, branchIds: null });

describe("report cards", () => {
  it("drafts for every activated enrollment of the month; the unactivated trial gets none", async () => {
    expect(await ensureCards(centerId, groupId, MONTH)).toBe(2);
    expect(await ensureCards(centerId, groupId, MONTH)).toBe(0);
    const rows = await boardRows(centerId, groupId, MONTH);
    expect(rows.map((r) => r.data.student)).toEqual(["Valiyev Ali", "Valiyev Vali"]);
  });
  it("live numbers come from attendance", async () => {
    const card = await db.reportCard.findUniqueOrThrow({ where: { enrollmentId_month: { enrollmentId: aliEnrollment, month: MONTH } } });
    const d = await cardData(card.id);
    expect(d.progress).toMatchObject({ lessons: 4, present: 2, late: 1, absent: 1, attendancePct: 75, gradeAvg: 4, gradePct: 80, rating: "GOOD" });
    expect(d.progress.comments).toEqual([{ date: "2026-08-10", text: "Uy vazifasi yo'q" }]);
    expect(d).toMatchObject({ course: "English A1", level: "A1", teacher: "Ustoz", center: "Akademik markaz", gradeScale: "5" });
  });
  it("the group's teacher writes comments; another teacher may not", async () => {
    const card = await db.reportCard.findUniqueOrThrow({ where: { enrollmentId_month: { enrollmentId: aliEnrollment, month: MONTH } } });
    expect(await saveComments(teacher(), groupId, MONTH, [{ cardId: card.id, comment: "  Yaxshi harakat qildi  " }])).toBe(1);
    expect(await saveComments(teacher(), groupId, MONTH, [{ cardId: card.id, comment: "Yaxshi harakat qildi" }])).toBe(0);
    expect((await db.reportCard.findUniqueOrThrow({ where: { id: card.id } })).teacherComment).toBe("Yaxshi harakat qildi");
    await expect(saveComments({ userId: otherTeacherId, centerId, canEdit: false, branchIds: null }, groupId, MONTH, [{ cardId: card.id, comment: "x" }])).rejects.toBeInstanceOf(UserError);
  });
  it("sending freezes the numbers and queues the parent's message once", async () => {
    const card = await db.reportCard.findUniqueOrThrow({ where: { enrollmentId_month: { enrollmentId: aliEnrollment, month: MONTH } } });
    expect(await sendCards({ userId: null, centerId }, [card.id])).toEqual({ sent: 1, skipped: 0 });
    expect(await sendCards({ userId: null, centerId }, [card.id])).toEqual({ sent: 0, skipped: 1 });
    const sent = await db.reportCard.findUniqueOrThrow({ where: { id: card.id } });
    expect(sent.status).toBe("SENT");
    const n = await db.notification.findMany({ where: { centerId, dedupeKey: { startsWith: `reportcard:${card.id}` } } });
    expect(n).toHaveLength(1);
    expect(n[0].text).toContain(`/rc/${sent.token}`);
    expect(n[0].text).toContain("75%");
    // later attendance edits do not change a sent card
    await db.attendance.update({ where: { lessonId_studentId: { lessonId: lessonIds[2], studentId: aliId } }, data: { status: "PRESENT" } });
    expect((await cardData(card.id)).progress.attendancePct).toBe(75);
    // a sent card's comment can't be changed
    expect(await saveComments(teacher(), groupId, MONTH, [{ cardId: card.id, comment: "boshqa" }])).toBe(0);
  });
  it("the auto-send job sends last month's drafts only on the chosen day", async () => {
    await db.center.update({ where: { id: centerId }, data: { settings: { gradeScale: "5", reportCards: { autoSend: true, sendDay: 3 } } } });
    expect((await reportCardsJob("2026-09-02")).reportCardsSent).toBe(0);
    const r = await reportCardsJob("2026-09-03");
    expect(r).toMatchObject({ month: MONTH, reportCardsSent: 1, groupsFailed: 0 });
    expect(await db.reportCard.count({ where: { groupId, month: MONTH, status: "DRAFT" } })).toBe(0);
  });
});
