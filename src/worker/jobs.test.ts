import { describe, expect, it } from "vitest";
import { forEachLimit, jobProblems } from "./jobs";

describe("jobProblems", () => {
  it("names failed steps and failed items, ignores clean counts", () => {
    expect(jobProblems({ failedSteps: "billing", lessonsFailed: 2, syncFailed: 0 })).toBe("failed steps: billing; lessonsFailed=2");
    expect(jobProblems({ lessons: 10, syncFailed: 0, freezeFailed: 0, sentNotificationsPurged: 4, failedNotificationsPurged: 3 })).toBeNull();
  });
});

describe("forEachLimit", () => {
  it("processes every item with at most `limit` in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const done: number[] = [];
    await forEachLimit(
      Array.from({ length: 23 }, (_, i) => i),
      4,
      async (i) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1 + (i % 3)));
        done.push(i);
        inFlight--;
      },
    );
    expect(peak).toBe(4);
    expect(done.sort((a, b) => a - b)).toEqual(Array.from({ length: 23 }, (_, i) => i));
    await forEachLimit([], 4, async () => {
      throw new Error("never");
    });
  });
});
