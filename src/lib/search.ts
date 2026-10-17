// Student search: every word must match a first or last name; 3+ digits also match student/guardian phones.
// Each column is matched with its own (I)LIKE '%term%' so the per-column GIN trigram indexes
// (Student.firstName/lastName/phone, Guardian.phone — migration 20261017000100) can serve it (audit P4).
import { Prisma } from "@prisma/client";

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

/** SQL condition for a student row aliased `s` (TRUE for an empty query, FALSE when nothing can match). */
export function studentSearchSql(q: string | undefined, s = "s"): Prisma.Sql {
  const p = parseSearch(q);
  if (!p) return Prisma.sql`TRUE`;
  const a = Prisma.raw(`"${s}"`);
  const arms: Prisma.Sql[] = [];
  if (p.words.length) {
    arms.push(Prisma.sql`(${Prisma.join(p.words.map((w) => Prisma.sql`(${a}."firstName" ILIKE ${likeAny(w)} OR ${a}."lastName" ILIKE ${likeAny(w)})`), " AND ")})`);
  }
  if (p.digits) {
    const like = likeAny(p.digits);
    arms.push(Prisma.sql`${a}.phone LIKE ${like}`);
    arms.push(Prisma.sql`${a}."familyId" IN (SELECT sg."familyId" FROM "Guardian" sg WHERE sg.phone LIKE ${like})`);
  }
  return arms.length ? Prisma.sql`(${Prisma.join(arms, " OR ")})` : Prisma.sql`FALSE`;
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
