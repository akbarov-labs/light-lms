import { Prisma } from "@/generated/prisma/client";

type AdapterMeta = { target?: unknown; driverAdapterError?: { cause?: { constraint?: { index?: string; fields?: string[] } } } };

/**
 * A unique-constraint violation (P2002), optionally on a given column. Prisma 6 named the columns in
 * `meta.target`; with the pg driver adapter (Prisma 7) the meta carries the constraint (index name or
 * fields) instead — both shapes are accepted.
 */
export function isUniqueViolation(e: unknown, field?: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  if (!field) return true;
  const meta = (e.meta ?? {}) as AdapterMeta;
  const constraint = meta.driverAdapterError?.cause?.constraint;
  const names = [String(meta.target ?? ""), constraint?.index ?? "", ...(constraint?.fields ?? [])];
  return names.some((n) => n.includes(field));
}
