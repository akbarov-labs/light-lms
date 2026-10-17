// Student search: every word must match a first or last name; 3+ digits also match student/guardian phones.
// Each column is matched with its own (I)LIKE '%term%' so the per-column GIN trigram indexes
// (Student.firstName/lastName/phone, Guardian.phone — migration 20261017000100) can serve it (audit P4).
import { Prisma } from "@/generated/prisma/client";

export interface ParsedSearch {
  /** Words with at least one non-digit: each must match firstName or lastName. */
  words: string[];
  /** All digits of the query when there are 3+: matches Student.phone or a guardian's phone. */
  digits: string | null;
}

export function parseSearch(q: string | undefined): ParsedSearch | null {
  const query = (q ?? "").trim().slice(0, 100);
  if (!query) return null;
  const digits = query.replace(/\D/g, "");
  return { words: query.split(/\s+/).filter((w) => /\D/.test(w)).slice(0, 6), digits: digits.length >= 3 ? digits : null };
}

/** `%term%` with LIKE wildcards in the term taken literally. */
function likeAny(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * SQL condition for a student row aliased `s` (TRUE for an empty query, FALSE when nothing can match).
 * Written as `s.id IN (… UNION …)`: each arm is a plain (I)LIKE on one table that its GIN index can
 * answer, and the planner sees a small id set — an OR across tables would make it scan every student.
 */
export function studentSearchSql(q: string | undefined, s = "s"): Prisma.Sql {
  const p = parseSearch(q);
  if (!p) return Prisma.sql`TRUE`;
  const arms: Prisma.Sql[] = [];
  if (p.words.length) {
    const all = p.words.map((w) => Prisma.sql`(sn."firstName" ILIKE ${likeAny(w)} OR sn."lastName" ILIKE ${likeAny(w)})`);
    arms.push(Prisma.sql`SELECT sn.id FROM "Student" sn WHERE ${Prisma.join(all, " AND ")}`);
  }
  if (p.digits) {
    const like = likeAny(p.digits);
    arms.push(Prisma.sql`SELECT sp.id FROM "Student" sp WHERE sp.phone LIKE ${like}`);
    arms.push(Prisma.sql`SELECT sf.id FROM "Guardian" sg JOIN "Student" sf ON sf."familyId" = sg."familyId" WHERE sg.phone LIKE ${like}`);
  }
  if (!arms.length) return Prisma.sql`FALSE`;
  return Prisma.sql`${Prisma.raw(`"${s}"`)}.id IN (${Prisma.join(arms, " UNION ")})`;
}

/** The same rule as a Prisma filter (kept for Prisma-side callers; tests check both agree). */
export function studentSearch(q: string | undefined): Prisma.StudentWhereInput {
  const p = parseSearch(q);
  if (!p) return {};
  const or: Prisma.StudentWhereInput[] = [];
  if (p.words.length) {
    or.push({ AND: p.words.map((w) => ({ OR: [{ firstName: { contains: w, mode: "insensitive" } }, { lastName: { contains: w, mode: "insensitive" } }] })) });
  }
  if (p.digits) {
    or.push({ phone: { contains: p.digits } }, { family: { guardians: { some: { phone: { contains: p.digits } } } } });
  }
  return or.length ? { OR: or } : { id: "-" };
}
