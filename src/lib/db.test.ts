import { describe, expect, it } from "vitest";
import { DEFAULT_POOL_MAX, DEFAULT_POOL_TIMEOUT_MS, poolOptions } from "./db";

describe("poolOptions", () => {
  it("defaults to 20 connections and a 15 s wait", () => {
    expect(poolOptions({})).toEqual({ max: DEFAULT_POOL_MAX, connectionTimeoutMillis: DEFAULT_POOL_TIMEOUT_MS });
    expect(poolOptions({})).toEqual({ max: 20, connectionTimeoutMillis: 15_000 });
  });

  it("reads DB_POOL_MAX and DB_POOL_TIMEOUT_MS", () => {
    expect(poolOptions({ DB_POOL_MAX: "10", DB_POOL_TIMEOUT_MS: " 30000 " })).toEqual({ max: 10, connectionTimeoutMillis: 30_000 });
  });

  it("ignores garbage, zero and negative values; caps absurd ones", () => {
    for (const bad of ["", "abc", "0", "-5", "2.5"]) expect(poolOptions({ DB_POOL_MAX: bad, DB_POOL_TIMEOUT_MS: bad })).toEqual({ max: 20, connectionTimeoutMillis: 15_000 });
    expect(poolOptions({ DB_POOL_MAX: "100000" }).max).toBe(500);
  });
});
