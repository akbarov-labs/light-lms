// Advisory job locks on the real database. Run: npm run test:integration
import { describe, expect, it } from "vitest";
import { lockKeyFor, withJobLock } from "@/worker/job-lock";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("withJobLock", () => {
  it("a second run of the same job is skipped while the first one runs", async () => {
    let runs = 0;
    const job = async () => {
      runs++;
      await sleep(300);
      return runs;
    };
    const [a, b] = await Promise.all([withJobLock("lock-test", job), withJobLock("lock-test", job)]);
    expect(runs).toBe(1);
    expect([a.ran, b.ran].sort()).toEqual([false, true]);
    // released when the run ends
    expect(await withJobLock("lock-test", async () => "again")).toEqual({ ran: true, result: "again" });
  });

  it("different jobs run side by side", async () => {
    const [a, b] = await Promise.all([withJobLock("lock-a", () => sleep(100).then(() => 1)), withJobLock("lock-b", () => sleep(100).then(() => 2))]);
    expect(a).toEqual({ ran: true, result: 1 });
    expect(b).toEqual({ ran: true, result: 2 });
  });

  it("a failing job rethrows and frees the lock", async () => {
    await expect(withJobLock("lock-err", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect((await withJobLock("lock-err", async () => 1)).ran).toBe(true);
  });

  it("billing, lessons and demo reset share the nightly lock", () => {
    expect(["nightly", "billing", "lessons", "demo-reset"].map(lockKeyFor)).toEqual(["nightly", "nightly", "nightly", "nightly"]);
    expect(lockKeyFor("reminders")).toBe("reminders");
  });
});
