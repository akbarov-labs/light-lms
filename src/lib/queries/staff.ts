// Staff pickers shared by forms and filters.
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/**
 * "Is a teacher" as a User filter: role TEACHER, or staff (owner/manager/admin) who also teach. Spread it
 * into a `where` (it uses `OR`, so combine with another OR through `AND: [...]`).
 */
export const teacherWhere = { OR: [{ isTeacher: true }, { role: "TEACHER" }] } as const satisfies Prisma.UserWhereInput;

/** The same rule for a loaded row. */
export function isTeacherRow(u: { isTeacher: boolean; role: string }): boolean {
  return u.isTeacher || u.role === "TEACHER";
}

/** Active teachers of the center (role TEACHER or staff who also teach), by name. */
export function listTeachers(centerId: string, opts: { exceptId?: string } = {}) {
  return db.user.findMany({
    where: { centerId, archivedAt: null, ...teacherWhere, ...(opts.exceptId ? { id: { not: opts.exceptId } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
