import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { isUniqueViolation } from "./db-errors";

const err = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError("x", { code, clientVersion: "7", meta });

describe("isUniqueViolation", () => {
  // the shape @prisma/adapter-pg produces (captured from a real duplicate insert)
  const adapter = err("P2002", {
    modelName: "Center",
    driverAdapterError: { name: "DriverAdapterError", cause: { originalCode: "23505", kind: "UniqueConstraintViolation", constraint: { index: "Center_paymeKey_key" }, table: "Center" } },
  });

  it("matches the driver adapter meta by index name", () => {
    expect(isUniqueViolation(adapter)).toBe(true);
    expect(isUniqueViolation(adapter, "paymeKey")).toBe(true);
    expect(isUniqueViolation(adapter, "slug")).toBe(false);
  });

  it("matches field lists and the Prisma 6 target shape", () => {
    expect(isUniqueViolation(err("P2002", { driverAdapterError: { cause: { constraint: { fields: ["paymeKey"] } } } }), "paymeKey")).toBe(true);
    expect(isUniqueViolation(err("P2002", { target: ["paymeKey"] }), "paymeKey")).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isUniqueViolation(err("P2025"))).toBe(false);
    expect(isUniqueViolation(new Error("P2002"))).toBe(false);
  });
});
