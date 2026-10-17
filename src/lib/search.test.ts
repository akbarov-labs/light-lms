import { describe, expect, it } from "vitest";
import { parseSearch, studentSearchSql } from "./search";

describe("studentSearchSql", () => {
  it("limits every UNION arm to the center (short terms can't use trigram indexes)", () => {
    const sql = studentSearchSql("al 998", "center-1");
    const arms = sql.sql.split(" UNION ");
    expect(arms).toHaveLength(3);
    for (const arm of arms) expect(arm).toMatch(/\."centerId" = \?/);
    expect(sql.values.filter((v) => v === "center-1")).toHaveLength(3);
  });

  it("TRUE for an empty query, FALSE when nothing can match", () => {
    expect(studentSearchSql("", "c").sql).toBe("TRUE");
    expect(studentSearchSql("12", "c").sql).toBe("FALSE");
    expect(parseSearch("Ali 90 123")).toEqual({ words: ["Ali"], digits: "90123" });
  });
});
