// The time limit of a test attempt (pure). The clock starts when the student opens the test; past the deadline
// nothing is accepted and the attempt is finished by code (on the next read, or by the worker).

/** An answer sent in the last second may arrive a little late over a phone network. */
export const GRACE_MS = 10_000;

export const MIN_MINUTES = 1;
export const MAX_MINUTES = 240;

export const deadlineOf = (startedAt: Date, minutes: number) => new Date(startedAt.getTime() + minutes * 60_000);

export type AttemptState = "open" | "expired" | "submitted";

export function attemptState(a: { deadlineAt: Date; submittedAt: Date | null }, now: Date): AttemptState {
  if (a.submittedAt) return "submitted";
  return now.getTime() > a.deadlineAt.getTime() + GRACE_MS ? "expired" : "open";
}

/** Seconds left to show on the countdown (0 when over). */
export const secondsLeft = (deadlineAt: Date, now: Date) => Math.max(0, Math.ceil((deadlineAt.getTime() - now.getTime()) / 1000));

/** Minutes the student used: from the start to the submit, at most the limit. */
export function minutesUsed(a: { startedAt: Date; submittedAt: Date | null; deadlineAt: Date }): number | null {
  if (!a.submittedAt) return null;
  const end = Math.min(a.submittedAt.getTime(), a.deadlineAt.getTime());
  return Math.max(0, Math.round((end - a.startedAt.getTime()) / 60_000));
}
