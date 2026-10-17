// FormData → typed values with zod. Empty strings become undefined.
import { z } from "zod";
import { isISODate, isMonth } from "./dates";
import { MAX_AMOUNT, parseMoney } from "./money";
import { normalizePhone } from "./phone";

export function formObject(fd: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    out[k] = s === "" ? undefined : s;
  }
  return out;
}

export function formList(fd: FormData, key: string): string[] {
  return fd
    .getAll(key)
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
}

const empty = (v: unknown) => (v === "" || v === null ? undefined : v);

export const zStr = z.preprocess(empty, z.string().trim().min(1).max(500));
export const zOptStr = z.preprocess(empty, z.string().trim().max(2000).optional());
export const zId = z.preprocess(empty, z.string().min(1).max(64));
export const zOptId = z.preprocess(empty, z.string().min(1).max(64).optional());
export const zDate = z.preprocess(empty, z.string().refine(isISODate, "date"));
export const zOptDate = z.preprocess(empty, z.string().refine(isISODate, "date").optional());
/** "YYYY-MM" (MM 01–12, year 2000–2100): salary month, adjustments, payslips. */
export const zMonth = z.preprocess(empty, z.string().refine(isMonth, "month"));
export const zTime = z.preprocess(empty, z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm"));
export const zMoney = z.preprocess((v) => parseMoney(empty(v)), z.number().int().min(0).max(MAX_AMOUNT));
export const zOptMoney = z.preprocess((v) => (empty(v) === undefined ? undefined : parseMoney(v)), z.number().int().min(0).max(MAX_AMOUNT).optional());
export const zInt = (min = 0, max = 1_000_000) => z.preprocess((v) => (empty(v) === undefined ? undefined : Number(v)), z.number().int().min(min).max(max));
export const zOptInt = (min = 0, max = 1_000_000) =>
  z.preprocess((v) => (empty(v) === undefined ? undefined : Number(v)), z.number().int().min(min).max(max).optional());
export const zBool = z.preprocess((v) => v === "on" || v === "true" || v === "1" || v === true, z.boolean());
export const zPhone = z.preprocess((v) => normalizePhone(typeof v === "string" ? v : undefined) ?? "invalid", z.string().regex(/^998\d{9}$/, "phone"));
export const zOptPhone = z.preprocess(
  (v) => (empty(v) === undefined ? undefined : (normalizePhone(String(v)) ?? "invalid")),
  z.string().regex(/^998\d{9}$/, "phone").optional(),
);
export const zTags = z.preprocess(
  (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []),
  z.array(z.string().max(40)).max(20),
);
