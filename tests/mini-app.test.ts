// Telegram Mini App on the database: the API verifies Telegram's signature, then shows only the chat's own family.
// Run: npm run test:integration
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, fromISODate, todayISO } from "@/lib/dates";
import { syncEnrollment } from "@/lib/billing/sync";
import { linkChat } from "@/worker/bot/data";
import { portalFor } from "@/lib/portal";
import { initDataHash } from "@/lib/telegram-webapp";
import { POST } from "@/app/api/tg/data/route";

const TOKEN = "777:mini-app-test";
const CHAT = "930000101";
const OTHER = "930000102";
const today = todayISO();

function initData(userId: string, token = TOKEN, authDate = Math.floor(Date.now() / 1000)) {
  const p = new URLSearchParams({ query_id: "Q", user: JSON.stringify({ id: Number(userId), first_name: "Ona", language_code: "uz" }), auth_date: String(authDate) });
  p.set("hash", initDataHash([...p.entries()], token));
  return p.toString();
}
const call = (body: string) => POST(new Request("http://localhost/api/tg/data", { method: "POST", body }));

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  const c = await db.center.create({ data: { name: "Mini markaz", slug: `mini-${Date.now()}`, phone: "998711110000", paymeMerchantId: "m", paymeKey: `k-${Date.now()}` } });
  const branch = await db.branch.create({ data: { centerId: c.id, name: "Markaz", address: "Navoiy 1" } });
  const teacher = await db.user.create({ data: { centerId: c.id, phone: "998947770001", name: "Ustoz", passwordHash: "x", role: "TEACHER", isTeacher: true } });
  const course = await db.course.create({ data: { centerId: c.id, name: "Kids English", pricingType: "SUBSCRIPTION", price: 400_000 } });
  const g = await db.group.create({ data: { centerId: c.id, branchId: branch.id, courseId: course.id, teacherId: teacher.id, code: 1, name: "Kids-1", startDate: fromISODate(addDays(today, -40)) } });
  const l1 = await db.lesson.create({ data: { groupId: g.id, date: fromISODate(addDays(today, -2)), startTime: "15:00", endTime: "16:00", teacherId: teacher.id, status: "HELD" } });
  await db.lesson.create({ data: { groupId: g.id, date: fromISODate(addDays(today, 1)), startTime: "15:00", endTime: "16:00", teacherId: teacher.id } });
  const fam = await db.family.create({ data: { centerId: c.id, name: "Nazarovlar", guardians: { create: { name: "Ona", phone: "998947770010", isPrimary: true } } } });
  const kid = await db.student.create({ data: { centerId: c.id, familyId: fam.id, branchId: branch.id, firstName: "Sevara", lastName: "Nazarova" } });
  const e = await db.enrollment.create({ data: { studentId: kid.id, groupId: g.id, startDate: fromISODate(addDays(today, -30)), activatedAt: fromISODate(addDays(today, -30)), status: "ACTIVE" } });
  await db.attendance.create({ data: { lessonId: l1.id, studentId: kid.id, enrollmentId: e.id, status: "LATE", grade: 4 } });
  await syncEnrollment(e.id, { asOf: today });
  const other = await db.family.create({ data: { centerId: c.id, name: "Begona", guardians: { create: { name: "Ota", phone: "998947770020" } } } });
  await db.student.create({ data: { centerId: c.id, familyId: other.id, firstName: "Begona", lastName: "Bola" } });
  await linkChat(CHAT, "998947770010", "uz");
});

describe("Mini App", () => {
  it("refuses unsigned, foreign-bot or stale init data", async () => {
    expect((await call("")).status).toBe(401);
    expect((await call(initData(CHAT, "1:other-bot"))).status).toBe(401);
    expect((await call(initData(CHAT, TOKEN, Math.floor(Date.now() / 1000) - 2 * 86_400))).status).toBe(401);
  });
  it("a linked parent sees their child: debt, pay link, schedule, attendance", async () => {
    const r = await call(initData(CHAT));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { locale: string; data: Awaited<ReturnType<typeof portalFor>> };
    expect(j.locale).toBe("uz");
    const d = j.data;
    expect(d.family).toBe(true);
    expect(d.families).toHaveLength(1);
    const f = d.families[0];
    expect(f.students.map((s) => s.name)).toEqual(["Nazarova Sevara"]);
    expect(f.balance).toBeLessThan(0);
    expect(f.payUrl).toMatch(new RegExp(`/pay/${f.id}$`));
    expect(f.students[0].groups[0]).toMatchObject({ name: "Kids-1", teacher: "Ustoz", branch: "Markaz" });
    expect(d.schedule.map((l) => l.group)).toEqual(["Kids-1"]);
    expect(d.attendance).toEqual([expect.objectContaining({ status: "LATE", grade: 4, student: "Nazarova Sevara" })]);
    // nothing of the other family leaks
    expect(JSON.stringify(d)).not.toContain("Begona");
  });
  it("an unlinked Telegram user gets an empty portal", async () => {
    const r = await call(initData(OTHER));
    const j = (await r.json()) as { data: Awaited<ReturnType<typeof portalFor>> };
    expect(j.data).toMatchObject({ family: false, teacher: null, adminUrl: null, families: [] });
  });
  it("no bot token → 503", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect((await call(initData(CHAT))).status).toBe(503);
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  });
});
