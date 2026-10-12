// The nightly demo wipe must refuse to touch a database that holds real centers. Run: npm run test:integration
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDemo } from "@/worker/demo-reset";

describe("demo reset safety net", () => {
  afterAll(() => {
    delete process.env.DEMO_MODE;
  });

  it("does nothing when DEMO_MODE is off", async () => {
    delete process.env.DEMO_MODE;
    expect(await resetDemo()).toEqual({ skipped: "DEMO_MODE is off" });
  });

  it("refuses to wipe when a non-demo center is older than two days", async () => {
    const old = new Date(Date.now() - 5 * 86_400_000);
    await db.center.upsert({ where: { slug: "real-center-guard" }, update: { createdAt: old }, create: { name: "Real center", slug: "real-center-guard", createdAt: old } });
    const before = await db.center.count();
    process.env.DEMO_MODE = "true";
    await expect(resetDemo()).rejects.toThrow(/refusing to reset/);
    expect(await db.center.count()).toBe(before);
  });
});
