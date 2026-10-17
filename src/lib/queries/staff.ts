// Staff pickers shared by forms and filters.
import { db } from "@/lib/db";

/** Active teachers of the center (role TEACHER or staff who also teach), by name. */
export function listTeachers(centerId: string, opts: { exceptId?: string } = {}) {
  return db.user.findMany({
    where: { centerId, archivedAt: null, OR: [{ isTeacher: true }, { role: "TEACHER" }], ...(opts.exceptId ? { id: { not: opts.exceptId } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
