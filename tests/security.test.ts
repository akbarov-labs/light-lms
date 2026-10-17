// Security fixes from docs/AUDIT-2026-10-17.md §3.2 on the real database. Run: npm run test:integration
import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { setPlatformAdmin } from "@/lib/platform";
import { buildCtx, loadUser } from "@/lib/ctx-core";

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
