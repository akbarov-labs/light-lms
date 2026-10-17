// Small helpers shared by the worker entry point, the jobs and the notification queue.

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Short error text for job results and ops alerts: the last line of the message (Prisma puts the cause there). */
export function errText(e: unknown, max = 200): string {
  const lines = (e instanceof Error ? e.message : String(e)).split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines[lines.length - 1] ?? "error").slice(0, max);
}
