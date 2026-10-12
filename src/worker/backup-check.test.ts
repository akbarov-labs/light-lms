import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { backupCheck, backupProblem } from "./backup-check";

describe("backup check", () => {
  it("reports a missing folder or no dumps", async () => {
    expect(await backupProblem("/definitely/not/here")).toMatch(/no backups/);
    const dir = await mkdtemp(join(tmpdir(), "bk-"));
    await writeFile(join(dir, "notes.txt"), "x");
    expect(await backupProblem(dir)).toMatch(/no backups/);
  });

  it("is quiet for a fresh dump and alerts for a stale one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bk-"));
    const f = join(dir, "lms-20261012-023000.dump");
    await writeFile(f, "dump");
    const alert = vi.fn(async () => true);
    expect(await backupCheck(dir, alert)).toEqual({ ok: 1 });
    expect(alert).not.toHaveBeenCalled();
    const old = new Date(Date.now() - 30 * 3_600_000);
    await utimes(f, old, old);
    const r = await backupCheck(dir, alert);
    expect(r.ok).toBe(0);
    expect(alert).toHaveBeenCalledOnce();
  });
});
