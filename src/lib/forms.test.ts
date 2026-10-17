import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formObject, zBool, zDate, zId, zInt, zMoney, zOptDate, zOptId, zOptInt, zOptMoney, zOptPhone, zOptStr, zPhone, zStr, zTags, zTime } from "./forms";

const schema = z.object({
  name: zStr,
  note: zOptStr,
  groupId: zId,
  branchId: zOptId,
  start: zDate,
  end: zOptDate,
  time: zTime,
  price: zMoney,
  discount: zOptMoney,
  count: zInt(1, 10),
  limit: zOptInt(0, 5),
  active: zBool,
  phone: zPhone,
  phone2: zOptPhone,
  tags: zTags,
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

const required = { name: " Ali ", groupId: "g1", start: "2026-10-01", time: "09:30", price: "350 000", count: "3", phone: "90 123 45 67" };

describe("form schemas", () => {
  it("parses a minimal form: optional fields missing or empty stay undefined", () => {
    const out = schema.parse(formObject(fd({ ...required, note: "", branchId: " ", end: "", discount: "", limit: "", phone2: "" })));
    expect(out).toEqual({ name: "Ali", groupId: "g1", start: "2026-10-01", time: "09:30", price: 350_000, count: 3, active: false, phone: "998901234567", tags: [] });
  });

  it("parses every field when present", () => {
    const out = schema.parse(
      formObject(fd({ ...required, note: "x", branchId: "b1", end: "2026-12-31", discount: "10000", limit: "2", active: "on", phone2: "+998 91 000 00 00", tags: "a, b,,c" })),
    );
    expect(out).toMatchObject({ note: "x", branchId: "b1", end: "2026-12-31", discount: 10_000, limit: 2, active: true, phone2: "998910000000", tags: ["a", "b", "c"] });
  });

  it("rejects missing required fields and bad values with the field paths", () => {
    const r = schema.safeParse(formObject(fd({ ...required, name: "", start: "2026-13-01", time: "25:00", price: "-1", count: "11", phone: "123" })));
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join("."));
    expect(paths.sort()).toEqual(["count", "name", "phone", "price", "start", "time"]);
    const msgs = r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
    expect(msgs).toMatchObject({ start: "date", time: "HH:mm", phone: "phone" });
  });

  it("a missing required key is an error, not undefined", () => {
    const r = schema.safeParse(formObject(fd({ ...required, groupId: "" })));
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join("."))).toEqual(["groupId"]);
  });
});
