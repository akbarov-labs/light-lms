// Security fixes from docs/AUDIT-2026-10-17.md §3.2 on the real database. Run: npm run test:integration
import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { setPlatformAdmin } from "@/lib/platform";
import { assertLeadRefs, buildCtx, loadUser } from "@/lib/ctx-core";
import { UserError } from "@/lib/user-error";
import { unlinkChat, unlinkIfPhoneChanged, unlinkRef } from "@/lib/telegram-links";
import { createResetCodeForChat } from "@/lib/auth/password";
import { chatRoles, chatStudents, linkChat } from "@/worker/bot/data";

process.env.AUTH_SECRET ??= "integration-test-secret-0123456789-abcdefgh";

let centerId = "";
let branchId = "";

type Role = "OWNER" | "MANAGER" | "ADMIN" | "TEACHER";

async function staff(phone: string, data: { role?: Role; perms?: string[]; isTeacher?: boolean; telegramChatId?: string | null } = {}) {
  const role = data.role ?? "ADMIN";
  const fields = { role, perms: data.perms ?? [], isTeacher: data.isTeacher ?? role === "TEACHER", telegramChatId: data.telegramChatId ?? null };
  const u = await db.user.upsert({
    where: { phone },
    update: { ...fields, archivedAt: null, platformAdmin: false, centerId },
    create: { ...fields, centerId, phone, name: `Staff ${phone.slice(-4)}`, passwordHash: await bcrypt.hash("x-password-1", 4) },
  });
  await db.userBranch.deleteMany({ where: { userId: u.id } });
  await db.userBranch.create({ data: { userId: u.id, branchId } });
  return u;
}

async function ctxOf(userId: string) {
  return buildCtx((await loadUser(userId))!);
}

beforeAll(async () => {
  const c = await db.center.upsert({ where: { slug: "sec-test" }, update: { disabledAt: null }, create: { name: "Security test", slug: "sec-test" } });
  centerId = c.id;
  const b = (await db.branch.findFirst({ where: { centerId } })) ?? (await db.branch.create({ data: { centerId, name: "Main" } }));
  branchId = b.id;
});

describe("S1 platform admin is a database flag", () => {
  it("grant/revoke by the operator script is audited; a phone alone gives nothing", async () => {
    const u = await staff("998977780001", { role: "OWNER" });
    expect((await ctxOf(u.id)).isPlatformAdmin).toBe(false);
    expect((await setPlatformAdmin("+998 97 778 00 01", true)).changed).toBe(true);
    expect((await ctxOf(u.id)).isPlatformAdmin).toBe(true);
    expect((await setPlatformAdmin("977780001", true)).changed).toBe(false);
    await setPlatformAdmin("977780001", false);
    expect((await ctxOf(u.id)).isPlatformAdmin).toBe(false);
    expect(await db.auditLog.count({ where: { entityId: u.id, action: { in: ["platform.grant", "platform.revoke"] } } })).toBe(2);
    await expect(setPlatformAdmin("998900000099", true)).rejects.toThrow();
  });
});

describe("S6 lead references stay inside the center", () => {
  it("another center's course, branch or staff, or an archived assignee, are refused", async () => {
    const owner = await staff("998977780501", { role: "OWNER" });
    const ctx = await ctxOf(owner.id);
    const other = await db.center.upsert({ where: { slug: "sec-other" }, update: {}, create: { name: "Other", slug: "sec-other" } });
    const foreignCourse = await db.course.create({ data: { centerId: other.id, name: "Foreign", pricingType: "SUBSCRIPTION", price: 100_000 } });
    const foreignBranch = await db.branch.create({ data: { centerId: other.id, name: "Foreign branch" } });
    const foreignStaff = await db.user.upsert({
      where: { phone: "998977780502" },
      update: {},
      create: { centerId: other.id, phone: "998977780502", name: "Foreign", role: "ADMIN", perms: [], passwordHash: "x" },
    });
    const ownCourse = await db.course.create({ data: { centerId, name: "Own", pricingType: "SUBSCRIPTION", price: 100_000 } });
    const archived = await staff("998977780503");
    await db.user.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });

    await expect(assertLeadRefs(ctx, { courseId: foreignCourse.id })).rejects.toThrow(UserError);
    await expect(assertLeadRefs(ctx, { branchId: foreignBranch.id })).rejects.toThrow(UserError);
    await expect(assertLeadRefs(ctx, { assignedToId: foreignStaff.id })).rejects.toThrow(UserError);
    await expect(assertLeadRefs(ctx, { assignedToId: archived.id })).rejects.toThrow(UserError);
    await expect(assertLeadRefs(ctx, { courseId: ownCourse.id, branchId, assignedToId: owner.id })).resolves.toBeUndefined();
    // a lead that already points at the archived person can still be edited
    await expect(assertLeadRefs(ctx, { assignedToId: archived.id }, { courseId: null, assignedToId: archived.id })).resolves.toBeUndefined();
  });
});

describe("S3 Telegram links follow the phone, the archive flag and the center switch", () => {
  it("a guardian's phone change unlinks the old chat in the same transaction", async () => {
    const fam = await db.family.create({ data: { centerId, name: "Sec family" } });
    const g = await db.guardian.create({ data: { familyId: fam.id, name: "Ona", phone: "998977780101" } });
    await db.student.create({ data: { centerId, familyId: fam.id, firstName: "Ali", lastName: "Sec" } });
    const chat = "sec-chat-guardian";
    await linkChat(chat, "998977780101", "uz");
    expect((await chatStudents(chat)).map((s) => s.familyId)).toEqual([fam.id]);
    await db.$transaction(async (tx) => {
      await tx.guardian.update({ where: { id: g.id }, data: { phone: "998977780102" } });
      expect(await unlinkIfPhoneChanged(tx, "GUARDIAN", g.id, "998977780101", "998977780102")).toBe(true);
    });
    expect(await db.telegramLink.count({ where: { refId: g.id } })).toBe(0);
    expect((await db.guardian.findUniqueOrThrow({ where: { id: g.id } })).telegramChatId).toBeNull();
    expect(await chatStudents(chat)).toEqual([]);
    expect((await chatRoles(chat)).family).toBe(false);
  });

  it("a phone changed behind the bot's back is caught on the next update", async () => {
    const u = await staff("998977780201", { role: "TEACHER" });
    const chat = "sec-chat-stale";
    await linkChat(chat, "998977780201", "uz");
    expect((await chatRoles(chat)).teacher?.id).toBe(u.id);
    await db.user.update({ where: { id: u.id }, data: { phone: "998977780202" } });
    expect(await createResetCodeForChat(chat)).toBeNull();
    expect((await chatRoles(chat)).teacher).toBeNull();
    expect(await db.telegramLink.count({ where: { chatId: chat } })).toBe(0);
    await db.user.update({ where: { id: u.id }, data: { phone: "998977780201" } });
  });

  it("archived staff and disabled centers get no menu and no /parol code", async () => {
    const u = await staff("998977780301", { role: "TEACHER" });
    const chat = "sec-chat-staff";
    await linkChat(chat, "998977780301", "uz");
    expect((await chatRoles(chat)).teacher?.id).toBe(u.id);

    await db.center.update({ where: { id: centerId }, data: { disabledAt: new Date() } });
    expect((await chatRoles(chat)).teacher).toBeNull();
    expect(await createResetCodeForChat(chat)).toBeNull();
    await db.center.update({ where: { id: centerId }, data: { disabledAt: null } });
    // switched back on: the link was only ignored, not lost
    expect((await chatRoles(chat)).teacher?.id).toBe(u.id);
    expect(await createResetCodeForChat(chat)).not.toBeNull();

    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: u.id }, data: { archivedAt: new Date() } });
      await unlinkRef(tx, "STAFF", u.id);
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).telegramChatId).toBeNull();
    expect((await chatRoles(chat)).teacher).toBeNull();
    expect(await createResetCodeForChat(chat)).toBeNull();
  });

  it("unlinkChat forgets everything a chat was linked to", async () => {
    await staff("998977780401", { role: "TEACHER" });
    await linkChat("sec-chat-all", "998977780401", "uz");
    await db.$transaction((tx) => unlinkChat(tx, "sec-chat-all"));
    expect(await db.telegramLink.count({ where: { chatId: "sec-chat-all" } })).toBe(0);
    expect(await db.user.count({ where: { telegramChatId: "sec-chat-all" } })).toBe(0);
  });
});
