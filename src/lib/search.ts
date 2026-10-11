import type { Prisma } from "@prisma/client";

/** Student search: every word must match a name; digits also match student/guardian phones. */
export function studentSearch(q: string | undefined): Prisma.StudentWhereInput {
  const query = (q ?? "").trim();
  if (!query) return {};
  const digits = query.replace(/\D/g, "");
  const words = query.split(/\s+/).filter((w) => /\D/.test(w));
  const or: Prisma.StudentWhereInput[] = [];
  if (words.length) {
    or.push({ AND: words.map((w) => ({ OR: [{ firstName: { contains: w, mode: "insensitive" } }, { lastName: { contains: w, mode: "insensitive" } }] })) });
  }
  if (digits.length >= 3) {
    or.push({ phone: { contains: digits } }, { family: { guardians: { some: { phone: { contains: digits } } } } });
  }
  return or.length ? { OR: or } : { id: "-" };
}
