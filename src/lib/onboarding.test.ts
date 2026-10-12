import { describe, expect, it } from "vitest";
import { currentStep, dismiss, doneCount, markStep, readOnboarding, setupPending } from "./onboarding";

const now = new Date("2026-10-12T10:00:00Z");

describe("onboarding progress", () => {
  it("starts at the branch step", () => {
    const o = readOnboarding({});
    expect(currentStep(o)).toBe("branch");
    expect(setupPending(o)).toBe(true);
    expect(doneCount(o)).toBe(0);
  });

  it("tolerates junk in the JSON column", () => {
    expect(readOnboarding("nope")).toEqual({ steps: {} });
    expect(readOnboarding(null).steps).toEqual({});
  });

  it("walks the steps in order, skipped steps count as handled", () => {
    let o = readOnboarding({});
    o = markStep(o, "branch", "done", now);
    expect(currentStep(o)).toBe("course");
    o = markStep(o, "course", "done", now, { courseId: "c1" });
    o = markStep(o, "group", "skipped", now);
    expect(currentStep(o)).toBe("teacher");
    expect(o.completedAt).toBeUndefined();
    o = markStep(o, "teacher", "done", now);
    expect(currentStep(o)).toBeNull();
    expect(o.completedAt).toBe(now.toISOString());
    expect(o.courseId).toBe("c1");
    expect(doneCount(o)).toBe(3);
    expect(setupPending(o)).toBe(false);
  });

  it("keeps a done step done when skipped later", () => {
    const o = markStep(markStep(readOnboarding({}), "branch", "done", now), "branch", "skipped", now);
    expect(o.steps.branch).toBe("done");
  });

  it("dismissing hides the banner but keeps progress", () => {
    const o = dismiss(markStep(readOnboarding({}), "branch", "done", now), now);
    expect(setupPending(o)).toBe(false);
    expect(currentStep(o)).toBe("course");
    expect(dismiss(o, new Date("2030-01-01")).dismissedAt).toBe(now.toISOString());
  });
});
