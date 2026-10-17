// Server actions and Payme on the real database for the audit fixes (S2, R5). Run: npm run test:integration
// Next's request APIs are mocked: the session cookie is signed for the acting user.
import { beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

process.env.AUTH_SECRET ??= "integration-test-secret-0123456789-abcdefgh";

const jar = new Map<string, string>();
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => new Headers(),
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
const { saveCenterAction, saveStaffAction } = await import("@/app/(admin)/settings/actions");
const { handlePayme } = await import("@/lib/payments/payme");
const { prismaPaymeRepo, FISCAL_TITLE } = await import("@/lib/payments/payme-repo");
const { familyBalance } = await import("@/lib/services/wallet");
const { readSettings } = await import("@/lib/settings");

let centerA = "";
let centerB = "";
let branchA = "";

async function user(phone: string, centerId: string, role: "OWNER" | "MANAGER" | "ADMIN", perms: string[]) {
  const u = await db.user.upsert({
    where: { phone },
    update: { role, perms, archivedAt: null, mustChangePassword: false, passwordChangedAt: null },
    create: { centerId, phone, name: `U ${phone.slice(-4)}`, role, perms, passwordHash: await bcrypt.hash("x-password-1", 4) },
  });
  await db.userBranch.deleteMany({ where: { userId: u.id } });
  if (centerId === centerA) await db.userBranch.create({ data: { userId: u.id, branchId: branchA } });
  return u;
}

async function actAs(u: { id: string; centerId: string }) {
  jar.clear();
  jar.set(SESSION_COOKIE, await signSession({ sub: u.id, cid: u.centerId }));
}

function form(o: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
}

const centerForm = (slug: string, extra: Record<string, string> = {}) =>
  form({ name: `Center ${slug}`, slug, accentColor: "#2563eb", locale: "uz", gradeScale: "5", paymeMerchantId: `m-${slug}`, ...extra });

beforeAll(async () => {
  const a = await db.center.upsert({ where: { slug: "act-a" }, update: { paymeKey: null, paymeMerchantId: null }, create: { name: "A", slug: "act-a" } });
  const b = await db.center.upsert({ where: { slug: "act-b" }, update: { paymeKey: null, paymeMerchantId: null }, create: { name: "B", slug: "act-b" } });
  centerA = a.id;
  centerB = b.id;
  branchA = ((await db.branch.findFirst({ where: { centerId: centerA } })) ?? (await db.branch.create({ data: { centerId: centerA, name: "Main" } }))).id;
});

describe("S2 saveStaffAction", () => {
  it("a manager without export creating an ADMIN (no permsTouched) → no export", async () => {
    const manager = await user("998977791001", centerA, "MANAGER", ["staff.manage", "payments.take", "leads", "students.edit", "groups.edit"]);
    await actAs(manager);
    await db.user.deleteMany({ where: { phone: "998977791002" } });
    const r = await saveStaffAction(null, form({ name: "New admin", phone: "977791002", role: "ADMIN", password: "temp-pass-123", branchIds: branchA }));
    expect(r).toMatchObject({ ok: true });
    const created = await db.user.findUniqueOrThrow({ where: { phone: "998977791002" } });
    expect(created.perms).not.toContain("export");
    expect(created.perms.sort()).toEqual(["groups.edit", "leads", "payments.take", "students.edit"]);
    expect(created.platformAdmin).toBe(false);
    // a forged platformAdmin field is ignored
    await saveStaffAction(null, form({ id: created.id, name: "New admin", phone: "977791002", role: "ADMIN", platformAdmin: "true", branchIds: branchA }));
    expect((await db.user.findUniqueOrThrow({ where: { id: created.id } })).platformAdmin).toBe(false);
  });
});

describe("R5 Payme", () => {
  it("a Payme key already used by another center is refused with a clear message", async () => {
    const ownerA = await user("998977791101", centerA, "OWNER", []);
    const ownerB = await user("998977791102", centerB, "OWNER", []);
    await actAs(ownerA);
    expect(await saveCenterAction(null, centerForm("act-a", { paymeKey: "shared-key" }))).toMatchObject({ ok: true });
    await actAs(ownerB);
    const r = await saveCenterAction(null, centerForm("act-b", { paymeKey: "shared-key" }));
    expect(r?.error).toMatch(/Payme/);
    expect((await db.center.findUniqueOrThrow({ where: { id: centerB } })).paymeKey).toBeNull();
    expect(await saveCenterAction(null, centerForm("act-b", { paymeKey: "key-b" }))).toMatchObject({ ok: true });
  });

  it("fiscal data: invalid input is refused, valid input is saved and sent in CheckPerformTransaction", async () => {
    const ownerA = await user("998977791101", centerA, "OWNER", []);
    await actAs(ownerA);
    const bad = await saveCenterAction(null, centerForm("act-a", { fiscalIkpu: "123", fiscalPackageCode: "1545632", fiscalVat: "0" }));
    expect(bad?.error).toBeTruthy();
    expect(await saveCenterAction(null, centerForm("act-a", { fiscalIkpu: "10305008002000000", fiscalPackageCode: "1545632", fiscalVat: "12" }))).toMatchObject({ ok: true });
    expect(readSettings((await db.center.findUniqueOrThrow({ where: { id: centerA } })).settings).paymeFiscal).toEqual({ ikpu: "10305008002000000", packageCode: "1545632", vatPercent: 12 });

    const fam = await db.family.create({ data: { centerId: centerA, name: "Payme fam" } });
    const auth = `Basic ${Buffer.from("Paycom:shared-key").toString("base64")}`;
    const rpc = (method: string, params: object) => handlePayme({ auth, body: JSON.stringify({ id: 1, method, params }) }, prismaPaymeRepo);
    expect((await rpc("CheckPerformTransaction", { amount: 25_000_000, account: { family_id: fam.id } })).result).toEqual({
      allow: true,
      detail: { receipt_type: 0, items: [{ title: FISCAL_TITLE, price: 25_000_000, count: 1, code: "10305008002000000", package_code: "1545632", vat_percent: 12 }] },
    });
    // all three fields cleared → no fiscal detail any more
    await saveCenterAction(null, centerForm("act-a"));
    expect((await rpc("CheckPerformTransaction", { amount: 25_000_000, account: { family_id: fam.id } })).result).toEqual({ allow: true });
  });

  it("parallel transactions for one family both post; another center's family is refused (−31050)", async () => {
    const fam = await db.family.create({ data: { centerId: centerA, name: "Parallel fam" } });
    const famB = await db.family.create({ data: { centerId: centerB, name: "Other center fam" } });
    const auth = `Basic ${Buffer.from("Paycom:shared-key").toString("base64")}`;
    const t0 = Date.now();
    const rpc = (method: string, params: object, now = t0) => handlePayme({ auth, body: JSON.stringify({ id: 1, method, params }) }, prismaPaymeRepo, now);
    const before = await familyBalance(fam.id);
    expect((await rpc("CreateTransaction", { id: "par-1", time: t0, amount: 10_000_000, account: { family_id: fam.id } })).result).toMatchObject({ state: 1 });
    expect((await rpc("CreateTransaction", { id: "par-2", time: t0, amount: 20_000_000, account: { family_id: fam.id } })).result).toMatchObject({ state: 1 });
    expect((await rpc("PerformTransaction", { id: "par-2" }, t0 + 1000)).result).toMatchObject({ state: 2 });
    expect((await rpc("PerformTransaction", { id: "par-1" }, t0 + 2000)).result).toMatchObject({ state: 2 });
    expect(await familyBalance(fam.id)).toBe(before + 300_000);
    expect(await db.auditLog.count({ where: { entity: "PaymeTransaction", action: "perform", centerId: centerA } })).toBeGreaterThanOrEqual(2);

    const cross = await rpc("CreateTransaction", { id: "par-x", time: t0, amount: 10_000_000, account: { family_id: famB.id } });
    expect(cross.error).toMatchObject({ code: -31050, data: "family_id" });
    expect(await db.paymeTransaction.count({ where: { paymeId: "par-x" } })).toBe(0);
  });
});
