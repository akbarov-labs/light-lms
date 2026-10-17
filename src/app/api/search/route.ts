// Global search for the command palette: students (with family debt) and groups, branch-scoped.
import type { NextRequest } from "next/server";
import { getCtx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { groupCodeParam } from "@/lib/queries/params";
import { inOrder, studentIds } from "@/lib/queries/students";
import { balancesFor } from "@/lib/services/wallet";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx || ctx.role === "TEACHER") return Response.json({ students: [], groups: [] }, { status: ctx ? 200 : 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length < 2) return Response.json({ students: [], groups: [] });
  // the palette searches every branch the user may see, not just the switcher's choice
  const code = groupCodeParam(q);
  const [{ ids }, groups] = await Promise.all([
    studentIds({ ...ctx, activeBranchId: null }, { q, status: "ACTIVE" }, { skip: 0, take: 8, count: false }),
    db.group.findMany({
      where: {
        centerId: ctx.centerId,
        status: { in: ["ACTIVE", "PLANNED"] },
        ...(ctx.branchIds ? { branchId: { in: ctx.branchIds } } : {}),
        OR: [{ name: { contains: q, mode: "insensitive" } }, ...(code !== undefined ? [{ code }] : [])],
      },
      select: { id: true, name: true, code: true, teacher: { select: { name: true } } },
      take: 5,
    }),
  ]);
  const students = inOrder(
    ids,
    await db.student.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, phone: true, familyId: true, enrollments: { where: { endDate: null }, select: { group: { select: { name: true } } } } },
    }),
  );
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
