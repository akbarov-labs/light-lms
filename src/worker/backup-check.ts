// Daily: is there a fresh database backup? Reads the backups folder (mounted read-only into the worker in
// docker-compose.prod.yml). Catches every way backups silently stop: container down, cron broken, dump failing.
import { readdir, stat } from "node:fs/promises";
import type { JobResult } from "./jobs";

export const BACKUP_MAX_AGE_H = 26;

export async function newestBackup(dir: string): Promise<{ file: string; ageH: number } | null> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => /^lms-.*\.dump$/.test(n));
  } catch {
    return null;
  }
  let best: { file: string; mtime: number } | null = null;
  for (const n of names) {
    const m = (await stat(`${dir}/${n}`)).mtimeMs;
    if (!best || m > best.mtime) best = { file: n, mtime: m };
  }
  return best ? { file: best.file, ageH: Math.round(((Date.now() - best.mtime) / 3_600_000) * 10) / 10 } : null;
}

/** Returns the problem in words, or null when the newest backup is fresh. */
export async function backupProblem(dir: string): Promise<string | null> {
  const b = await newestBackup(dir);
  if (!b) return `no backups found in ${dir}`;
  if (b.ageH > BACKUP_MAX_AGE_H) return `newest backup ${b.file} is ${b.ageH} h old (limit ${BACKUP_MAX_AGE_H} h)`;
  return null;
}

export async function backupCheck(dir: string, alert: (key: string, text: string) => Promise<unknown>): Promise<JobResult> {
  const problem = await backupProblem(dir);
  if (problem) await alert("backup", `Backup problem: ${problem}. Check: docker compose -f docker-compose.prod.yml logs backup`);
  return { ok: problem ? 0 : 1, ...(problem ? { problem } : {}) };
}
