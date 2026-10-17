// Query-string parsing for list pages: anything unknown is ignored, never passed to Prisma (audit B14).
import { z } from "zod";

/** The value when it is one of `values`, else undefined (unknown enum values are ignored, not a 500). */
export function enumParam<const T extends readonly [string, ...string[]]>(values: T, v: unknown): T[number] | undefined {
  const r = z.enum(values).safeParse(v);
  return r.success ? r.data : undefined;
}

const pageSchema = z.coerce.number().int().min(1).max(100_000);

/** 1-based page number; junk ("abc", "1.5", "-3", arrays) → 1. */
export function pageParam(v: unknown): number {
  const r = pageSchema.safeParse(Array.isArray(v) ? v[0] : v);
  return r.success ? r.data : 1;
}

/** A single string param (repeated params arrive as arrays) — trimmed, empty → undefined. */
export function strParam(v: unknown): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string") return undefined;
  const t = s.trim();
  return t ? t.slice(0, 200) : undefined;
}

export const GROUP_STATUSES = ["PLANNED", "ACTIVE", "FINISHED", "ARCHIVED"] as const;
type GroupStatus = (typeof GROUP_STATUSES)[number];

/** Groups list status filter: "all", one GroupStatus, else (missing/unknown) the current ones. */
export function groupStatusWhere(v: unknown): { status?: GroupStatus | { in: GroupStatus[] } } {
  if (v === "all") return {};
  const s = enumParam(GROUP_STATUSES, v);
  return s ? { status: s } : { status: { in: ["ACTIVE", "PLANNED"] } };
}

/** A group code typed as digits — only when it fits the Int column (a bigger number made Prisma throw). */
export function groupCodeParam(q: string | undefined): number | undefined {
  return q && /^\d{1,9}$/.test(q) ? Number(q) : undefined;
}
