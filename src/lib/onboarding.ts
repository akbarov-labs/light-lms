// Setup wizard progress, stored in Center.onboarding (JSON). Pure helpers; actions live in app/(admin)/setup.
import { z } from "zod";

export const SETUP_STEPS = ["branch", "course", "group", "teacher"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export type StepState = "done" | "skipped";

const schema = z.object({
  steps: z.record(z.enum(SETUP_STEPS), z.enum(["done", "skipped"])).default({}),
  courseId: z.string().optional(),
  groupId: z.string().optional(),
  teacherId: z.string().optional(),
  dismissedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export type Onboarding = z.infer<typeof schema>;

export function readOnboarding(raw: unknown): Onboarding {
  const p = schema.safeParse(raw ?? {});
  return p.success ? p.data : { steps: {} };
}

export function isSetupStep(v: unknown): v is SetupStep {
  return typeof v === "string" && (SETUP_STEPS as readonly string[]).includes(v);
}

/** First step that is neither done nor skipped; null = all handled. */
export function currentStep(o: Onboarding): SetupStep | null {
  return SETUP_STEPS.find((s) => !o.steps[s]) ?? null;
}

export function doneCount(o: Onboarding): number {
  return SETUP_STEPS.filter((s) => o.steps[s] === "done").length;
}

/** Banner on the dashboard: the owner has not finished or dismissed the wizard. */
export function setupPending(o: Onboarding): boolean {
  return !o.completedAt && !o.dismissedAt;
}

/** Record a step result; the wizard completes once every step is done or skipped. */
export function markStep(o: Onboarding, step: SetupStep, state: StepState, now: Date, extra: Partial<Pick<Onboarding, "courseId" | "groupId" | "teacherId">> = {}): Onboarding {
  // a done step stays done even if the user later comes back and skips it
  const prev = o.steps[step];
  const steps = { ...o.steps, [step]: prev === "done" ? "done" : state };
  const next: Onboarding = { ...o, ...extra, steps };
  if (!next.completedAt && SETUP_STEPS.every((s) => steps[s])) next.completedAt = now.toISOString();
  return next;
}

export function dismiss(o: Onboarding, now: Date): Onboarding {
  return { ...o, dismissedAt: o.dismissedAt ?? now.toISOString() };
}
