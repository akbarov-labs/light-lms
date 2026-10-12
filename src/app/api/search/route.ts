// Global search for the command palette: students (with family debt) and groups, branch-scoped.
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { getCtx, studentScope } from "@/lib/ctx";
import { db } from "@/lib/db";
import { studentSearch } from "@/lib/search";
import { balancesFor } from "@/lib/services/wallet";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx || ctx.role === "TEACHER") return Response.json({ students: [], groups: [] }, { status: ctx ? 200 : 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length < 2) return Response.json({ students: [], groups: [] });
  const scope: Prisma.StudentWhereInput = ctx.branchIds ? (studentScope({ ...ctx, activeBranchId: null }) as Prisma.StudentWhereInput) : {};
  const [students, groups] = await Promise.all([
    db.student.findMany({
      where: { AND: [{ centerId: ctx.centerId, status: "ACTIVE" }, scope, studentSearch(q)] },
      select: { id: true, firstName: true, lastName: true, phone: true, familyId: true, enrollments: { where: { endDate: null }, select: { group: { select: { name: true } } } } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 8,
    }),
    db.group.findMany({
      where: {
        centerId: ctx.centerId,
        status: { in: ["ACTIVE", "PLANNED"] },
        ...(ctx.branchIds ? { branchId: { in: ctx.branchIds } } : {}),
        OR: [{ name: { contains: q, mode: "insensitive" } }, ...(/^\d+$/.test(q) ? [{ code: Number(q) }] : [])],
      },
      select: { id: true, name: true, code: true, teacher: { select: { name: true } } },
      take: 5,
    }),
  ]);
  const money = ctx.can("payments.take") || ctx.can("finance.view");
  const balances = money ? await balancesFor([...new Set(students.map((s) => s.familyId))]) : new Map<string, number>();
  return Response.json({
    students: students.map((s) => ({
      id: s.id,
      name: `${s.lastName} ${s.firstName}`,
      phone: s.phone,
      familyId: s.familyId,
      groups: s.enrollments.map((e) => e.group.name),
      debt: money ? Math.max(0, -(balances.get(s.familyId) ?? 0)) : null,
    })),
    groups: groups.map((g) => ({ id: g.id, name: g.name, code: g.code, teacher: g.teacher.name })),
  });
}
