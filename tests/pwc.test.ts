// S9: a pending forced password change blocks server actions too, not only page navigation.
// Run: npm run test:integration
import { beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

process.env.AUTH_SECRET ??= "integration-test-secret-0123456789-abcdefgh";

const jar = new Map<string, string>();
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
  unstable_rethrow: (e: unknown) => {
    if (e instanceof Error && e.message.startsWith("NEXT_REDIRECT")) throw e;
  },
}));

const { db } = await import("@/lib/db");
const { signSession, SESSION_COOKIE } = await import("@/lib/session");
const { actionCtx, getCtx, getCtxForPasswordChange } = await import("@/lib/ctx");
const { runAction } = await import("@/lib/action");

let userId = "";
let centerId = "";

beforeAll(async () => {
  const c = await db.center.upsert({ where: { slug: "pwc-test" }, update: { disabledAt: null }, create: { name: "PWC test", slug: "pwc-test" } });
  centerId = c.id;
  const u = await db.user.upsert({
    where: { phone: "998977790001" },
    update: { mustChangePassword: true, passwordChangedAt: null, archivedAt: null },
    create: { centerId, phone: "998977790001", name: "Reset user", role: "ADMIN", perms: ["leads"], passwordHash: await bcrypt.hash("temp-pass-1", 4), mustChangePassword: true },
  });
  userId = u.id;
});

describe("S9 forced password change", () => {
  it("actions redirect to /password while the change is pending; only the password context works", async () => {
    jar.set(SESSION_COOKIE, await signSession({ sub: userId, cid: centerId, pwc: true }));
    await expect(actionCtx()).rejects.toThrow(/NEXT_REDIRECT \/password/);
    await expect(runAction("leads", async () => ({ message: "should not run" }))).rejects.toThrow(/NEXT_REDIRECT \/password/);
    expect(await getCtx()).toBeNull();
    expect((await getCtxForPasswordChange())?.userId).toBe(userId);
  });

  it("the DB flag counts even without the session claim", async () => {
    jar.set(SESSION_COOKIE, await signSession({ sub: userId, cid: centerId }));
    await expect(actionCtx()).rejects.toThrow(/NEXT_REDIRECT \/password/);
  });

  it("after the change everything works again", async () => {
    await db.user.update({ where: { id: userId }, data: { mustChangePassword: false } });
    jar.set(SESSION_COOKIE, await signSession({ sub: userId, cid: centerId }));
    expect((await actionCtx("leads")).userId).toBe(userId);
    expect(await runAction("leads", async () => ({ message: "ran" }))).toMatchObject({ ok: true, message: "ran" });
  });
});
