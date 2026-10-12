// Login limiting and password reset on the real database. Run: npm run test:integration
import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { dbAttemptStore, purgeOldAttempts } from "@/lib/auth/attempts-db";
import { attemptKey, checkAttempts, recordAttempt, RULES } from "@/lib/auth/ratelimit";
import { adminResetPassword, changeOwnPassword, createResetCodeForChat, resetWithCode } from "@/lib/auth/password";
import { RESET_CODE_MAX_TRIES } from "@/lib/auth/security";

process.env.AUTH_SECRET ??= "integration-test-secret-0123456789-abcdefgh";

const PHONE = "998977770001";
let user = { id: "", phone: PHONE, centerId: "" };

beforeAll(async () => {
  const center = await db.center.upsert({ where: { slug: "auth-test" }, update: {}, create: { name: "Auth test", slug: "auth-test" } });
  const u = await db.user.upsert({
    where: { phone: PHONE },
    update: { passwordHash: await bcrypt.hash("old-password-1", 4), telegramChatId: "777000111", mustChangePassword: false, passwordChangedAt: null },
    create: { centerId: center.id, phone: PHONE, name: "Reset Tester", role: "ADMIN", perms: [], passwordHash: await bcrypt.hash("old-password-1", 4), telegramChatId: "777000111" },
  });
  user = { id: u.id, phone: PHONE, centerId: center.id };
  await db.loginAttempt.deleteMany({});
  await db.passwordReset.deleteMany({ where: { userId: u.id } });
});

describe("LoginAttempt store", () => {
  it("locks after 5 failures, a success resets the phone counter", async () => {
    const key = attemptKey.loginPhone(PHONE);
    const check = () => checkAttempts(dbAttemptStore, [{ key, rule: RULES.loginPhone }]);
    for (let i = 0; i < 4; i++) await recordAttempt(dbAttemptStore, [key], false);
    expect((await check()).allowed).toBe(true);
    await recordAttempt(dbAttemptStore, [key], false);
    const v = await check();
    expect(v.allowed).toBe(false);
    expect(v.retryAfterMs).toBeGreaterThan(14 * 60_000);
    // a password reset clears the lock
    await adminResetPassword({ userId: user.id, centerId: user.centerId }, user);
    expect((await check()).allowed).toBe(true);
  });

  it("purges attempts older than two days, keeps the 24 h signup window intact", async () => {
    await db.loginAttempt.create({ data: { key: "login:ip:old", success: false, createdAt: new Date(Date.now() - 3 * 86400_000) } });
    await db.loginAttempt.create({ data: { key: "signup-created:ip:recent", success: false, createdAt: new Date(Date.now() - 36 * 3600_000) } });
    const r = await purgeOldAttempts();
    expect(r.attempts).toBeGreaterThanOrEqual(1);
    expect(await db.loginAttempt.count({ where: { key: "login:ip:old" } })).toBe(0);
    expect(await db.loginAttempt.count({ where: { key: "signup-created:ip:recent" } })).toBe(1);
  });
});

describe("admin reset", () => {
  it("sets a temporary password, forces a change, ends old sessions and is audited", async () => {
    const before = new Date(Date.now() - 1000);
    const temp = await adminResetPassword({ userId: user.id, centerId: user.centerId }, user);
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare(temp, u.passwordHash)).toBe(true);
    expect(u.mustChangePassword).toBe(true);
    expect(u.passwordChangedAt!.getTime()).toBeGreaterThan(before.getTime());
    expect(await db.auditLog.count({ where: { entityId: user.id, action: "password.reset" } })).toBeGreaterThanOrEqual(1);
    await changeOwnPassword(user, "my-own-pass-42");
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).mustChangePassword).toBe(false);
  });
});

describe("Telegram reset code", () => {
  it("only a linked staff chat gets a code", async () => {
    expect(await createResetCodeForChat("not-a-linked-chat")).toBeNull();
    expect(await createResetCodeForChat("777000111")).not.toBeNull();
  });

  it("wrong code burns a try; the right code sets the password once", async () => {
    await db.passwordReset.deleteMany({ where: { userId: user.id } });
    const r = (await createResetCodeForChat("777000111"))!;
    const wrong = r.code === "000000" ? "000001" : "000000";
    expect((await resetWithCode(PHONE, wrong, "brand-new-pass-1", "192.0.2.10")).result).toBe("invalid");
    expect((await db.passwordReset.findFirstOrThrow({ where: { userId: user.id } })).attempts).toBe(1);
    expect((await resetWithCode(PHONE, r.code, "brand-new-pass-1", "192.0.2.10")).result).toBe("ok");
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare("brand-new-pass-1", u.passwordHash)).toBe(true);
    expect(u.mustChangePassword).toBe(false);
    // used codes never work twice
    expect((await resetWithCode(PHONE, r.code, "another-pass-22", "192.0.2.10")).result).toBe("invalid");
  });

  it("a code dies after too many wrong tries, even if the right one comes later", async () => {
    await db.passwordReset.deleteMany({ where: { userId: user.id } });
    const r = (await createResetCodeForChat("777000111"))!;
    const wrong = r.code === "000000" ? "000001" : "000000";
    for (let i = 0; i < RESET_CODE_MAX_TRIES; i++) await resetWithCode(PHONE, wrong, "brand-new-pass-2", `192.0.2.${20 + i}`);
    expect((await resetWithCode(PHONE, r.code, "brand-new-pass-2", "192.0.2.99")).result).toBe("invalid");
  });

  it("an unknown phone gets the same answer as a wrong code", async () => {
    expect((await resetWithCode("998900000000", "123456", "brand-new-pass-3", "192.0.2.50")).result).toBe("invalid");
  });

  it("limits code guessing per IP", async () => {
    const ip = "192.0.2.200";
    for (let i = 0; i < RULES.resetVerifyIp.limit; i++) await resetWithCode("998900000000", "123456", "brand-new-pass-4", ip);
    expect((await resetWithCode("998900000000", "123456", "brand-new-pass-4", ip)).result).toBe("limited");
  });
});
