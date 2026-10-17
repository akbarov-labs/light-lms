import { describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
vi.mock("@/lib/db", () => ({ db: { $queryRaw: (...a: unknown[]) => queryRaw(...a) } }));
const { GET } = await import("./route");

describe("/api/health (S10)", () => {
  it("is ok when the database answers", async () => {
    queryRaw.mockResolvedValueOnce([{ "?column?": 1 }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, db: "up" });
  });

  it("returns a generic 503 and keeps the error text in the server log", async () => {
    queryRaw.mockRejectedValueOnce(new Error("password authentication failed for user lms at db:5432"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ ok: false });
    expect(body).not.toMatch(/password|lms|5432/);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
