// Telegram bot read models (src/worker/bot/data.ts) and the notification enqueue helper on the real database.
// A chat sees only the families it is linked to. Run: npm run test:integration
import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { addDays, fromISODate, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { enqueue, familyChats } from "@/lib/notify";
import { syncEnrollment } from "@/lib/billing/sync";
import { familyBalance } from "@/lib/services/wallet";
import { attendanceText, balanceText, centerText, chatRoles, linkChat, paymentsText, scheduleText, teacherLessonsToday, teacherWeekText } from "@/worker/bot/data";

const today = todayISO();
const CHAT_A = "910000001";
const CHAT_B = "910000002";
const CHAT_T = "910000003";
const PHONE_A = "998935550101";
const PHONE_B = "998935550202";
const PHONE_T = "998935550303";

let centerId = "";
let familyA = "";
let teacherId = "";
let otherTeacherId = "";

beforeAll(async () => {
  const c = await db.center.create({ data: { name: "Bot test markazi", slug: "bot-test", phone: "998711112233" } });
  centerId = c.id;
  const branch = await db.branch.create({ data: { centerId, name: "Chilonzor", address: "Bunyodkor 1" } });
  const hash = await bcrypt.hash("x-password-1", 4);
  const teacher = await db.user.create({ data: { centerId, phone: PHONE_T, name: "Aziza Teacher", passwordHash: hash, role: "TEACHER", isTeacher: true, perms: [] } });
  const other = await db.user.create({ data: { centerId, phone: "998935550404", name: "Other Teacher", passwordHash: hash, role: "TEACHER", isTeacher: true, perms: [] } });
  teacherId = teacher.id;
  otherTeacherId = other.id;
  const course = await db.course.create({ data: { centerId, name: "General English", pricingType: "SUBSCRIPTION", price: 600_000 } });
  const group = await db.group.create({ data: { centerId, branchId: branch.id, courseId: course.id, teacherId, code: 1, name: "GE-A1 bot", startDate: fromISODate(addDays(today, -40)) } });
  const otherGroup = await db.group.create({ data: { centerId, branchId: branch.id, courseId: course.id, teacherId: otherTeacherId, code: 2, name: "GE-B1 bot", startDate: fromISODate(addDays(today, -40)) } });
  const lessonToday = await db.lesson.create({ data: { groupId: group.id, date: fromISODate(today), startTime: "09:00", endTime: "10:30", teacherId, status: "HELD" } });
  await db.lesson.create({ data: { groupId: group.id, date: fromISODate(addDays(today, 2)), startTime: "09:00", endTime: "10:30", teacherId } });
  await db.lesson.create({ data: { groupId: otherGroup.id, date: fromISODate(today), startTime: "11:00", endTime: "12:30", teacherId: otherTeacherId } });

  // family A: two siblings, one guardian; family B: one child, not enrolled
  const fa = await db.family.create({ data: { centerId, name: "Karimovlar" } });
  familyA = fa.id;
  await db.guardian.create({ data: { familyId: fa.id, name: "Dilshod Karimov", phone: PHONE_A, isPrimary: true } });
  const ali = await db.student.create({ data: { centerId, familyId: fa.id, branchId: branch.id, firstName: "Ali", lastName: "Karimov" } });
  await db.student.create({ data: { centerId, familyId: fa.id, branchId: branch.id, firstName: "Laylo", lastName: "Karimova" } });
  const e = await db.enrollment.create({ data: { studentId: ali.id, groupId: group.id, startDate: fromISODate(addDays(today, -30)), activatedAt: fromISODate(addDays(today, -30)), status: "ACTIVE" } });
  await db.attendance.create({ data: { lessonId: lessonToday.id, studentId: ali.id, enrollmentId: e.id, status: "PRESENT", grade: 5 } });
  await db.ledgerEntry.create({ data: { centerId, familyId: fa.id, studentId: ali.id, type: "PAYMENT", amount: 200_000, method: "CASH", description: "Naqd", date: fromISODate(addDays(today, -20)) } });
  // charges come from the engine, so the nightly billing sync of other test files finds nothing to post here
  await syncEnrollment(e.id, { asOf: today });

  const fb = await db.family.create({ data: { centerId, name: "Saidovlar" } });
  await db.guardian.create({ data: { familyId: fb.id, name: "Nodira Saidova", phone: PHONE_B, isPrimary: true } });
  await db.student.create({ data: { centerId, familyId: fb.id, branchId: branch.id, firstName: "Bekzod", lastName: "Saidov" } });
});

describe("bot linking and roles", () => {
  it("links a guardian chat by phone and finds every child of the family", async () => {
    const r = await linkChat(CHAT_A, PHONE_A, "uz");
    expect(r).toMatchObject({ guardians: 1, students: 0 });
    const roles = await chatRoles(CHAT_A);
    expect(roles.family).toBe(true);
    expect(roles.teacher).toBeNull();
  });

  it("an unknown phone links nothing and the menus say so", async () => {
    const r = await linkChat("910000099", "998930000000", "uz");
    expect(r).toEqual({ guardians: 0, students: 0, staff: [] });
    const { text, payUrls } = await balanceText("910000099", "uz");
    expect(payUrls).toEqual([]);
    expect(text).not.toContain("Karimov");
  });

  it("links a teacher chat as staff", async () => {
    await linkChat(CHAT_T, PHONE_T, "ru");
    const roles = await chatRoles(CHAT_T);
    expect(roles.teacher?.id).toBe(teacherId);
    expect(roles.family).toBe(false);
  });
});

describe("parent menus show only the linked family", () => {
  it("balance: family balance and per-group debt, never another family", async () => {
    await linkChat(CHAT_B, PHONE_B, "uz");
    const balance = await familyBalance(familyA);
    expect(balance).toBeLessThan(200_000); // the engine charged the subscription
    const a = await balanceText(CHAT_A, "uz");
    expect(a.text).toContain(formatMoney(balance));
    expect(a.text).toContain("Karimov Ali");
    expect(a.text).toContain("Karimova Laylo");
    expect(a.text).not.toContain("Bekzod");
    expect(a.payUrls).toEqual([]); // Payme not configured → no pay button
    const b = await balanceText(CHAT_B, "uz");
    expect(b.text).toContain("Bekzod");
    expect(b.text).not.toContain("Karimov");
  });

  it("schedule, attendance and payments are scoped the same way", async () => {
    const sched = await scheduleText(CHAT_A, "uz");
    expect(sched).toContain("GE-A1 bot");
    expect(sched).not.toContain("GE-B1 bot");
    const att = await attendanceText(CHAT_A, "uz");
    expect(att).toContain("1/1");
    expect(att).toContain("(5)");
    const pays = await paymentsText(CHAT_A, "uz");
    expect(pays).toContain(formatMoney(200_000));
    expect(await paymentsText(CHAT_B, "uz")).not.toContain(formatMoney(200_000));
    const center = await centerText(CHAT_A, "uz");
    expect(center).toContain("Bot test markazi");
    expect(center).toContain("Bunyodkor 1");
  });

  it("Russian chats get сум", async () => {
    const a = await balanceText(CHAT_A, "ru");
    expect(a.text).toContain("сум");
  });
});

describe("teacher menus", () => {
  it("today's lessons and the week are the teacher's own", async () => {
    const lessons = await teacherLessonsToday(teacherId);
    expect(lessons.map((l) => l.group.name)).toEqual(["GE-A1 bot"]);
    const week = await teacherWeekText(teacherId, "uz");
    expect(week).toContain("GE-A1 bot");
    expect(week).not.toContain("GE-B1 bot");
  });
});

describe("notification enqueue", () => {
  it("queues one row per linked chat and a dedupe key makes a re-run harmless", async () => {
    const chats = await db.$transaction((tx) => familyChats(tx, familyA));
    expect(chats).toEqual([{ chatId: CHAT_A, locale: "uz" }]);
    const first = await db.$transaction((tx) => enqueue(tx, centerId, chats, (l) => `test ${l}`, "bot-test:dedupe"));
    const again = await db.$transaction((tx) => enqueue(tx, centerId, chats, (l) => `test ${l}`, "bot-test:dedupe"));
    expect(first).toBe(1);
    expect(again).toBe(0);
    expect(await db.notification.count({ where: { centerId, chatId: CHAT_A } })).toBe(1);
  });
});
