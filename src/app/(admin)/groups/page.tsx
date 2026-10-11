import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { branchWhere, requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, toISODate } from "@/lib/dates";
import { groupTone, slotSummary } from "@/lib/format";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Pagination, Table, Td, Th, Tr } from "@/components/ui";
import { Input, Select } from "@/components/fields";

const PAGE = 30;

export default async function GroupsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStaff();
  const { t } = ctx;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = sp.status ?? "current";
  const where: Prisma.GroupWhereInput = {
    centerId: ctx.centerId,
    ...branchWhere(ctx),
    ...(status === "current" ? { status: { in: ["ACTIVE", "PLANNED"] } } : status !== "all" ? { status: status as "ACTIVE" } : {}),
    ...(sp.teacherId ? { teacherId: sp.teacherId } : {}),
    ...(sp.courseId ? { courseId: sp.courseId } : {}),
    ...(sp.q ? { OR: [{ name: { contains: sp.q, mode: "insensitive" } }, ...(/^\d+$/.test(sp.q) ? [{ code: Number(sp.q) }] : [])] } : {}),
  };
  const [groups, total, teachers, courses] = await Promise.all([
    db.group.findMany({
      where,
      include: {
        course: { select: { name: true } },
        teacher: { select: { name: true } },
        room: { select: { name: true } },
        branch: { select: { name: true } },
        slots: true,
        _count: { select: { enrollments: { where: { endDate: null, status: { in: ["TRIAL", "ACTIVE", "FROZEN"] } } } } },
      },
      orderBy: [{ status: "asc" }, { code: "desc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
    }),
    db.group.count({ where }),
    db.user.findMany({ where: { centerId: ctx.centerId, archivedAt: null, OR: [{ isTeacher: true }, { role: "TEACHER" }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.course.findMany({ where: { centerId: ctx.centerId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader
        title={t("nav.groups")}
        actions={
          <>
            {ctx.can("export") && <LinkButton variant="secondary" href={`/api/export/groups?${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString()}`}>{t("common.export")}</LinkButton>}
            {ctx.can("groups.edit") && <LinkButton href="/groups/new">+ {t("groups.new")}</LinkButton>}
          </>
        }
      />
      <form className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Input name="q" defaultValue={sp.q} placeholder={`${t("common.search")}…`} className="col-span-2 sm:col-span-1" />
        <Select name="status" defaultValue={status}>
          <option value="current">{t("group.ACTIVE")} + {t("group.PLANNED")}</option>
          <option value="all">{t("common.all")}</option>
          {(["ACTIVE", "PLANNED", "FINISHED", "ARCHIVED"] as const).map((s) => <option key={s} value={s}>{t(`group.${s}`)}</option>)}
        </Select>
        <Select name="teacherId" defaultValue={sp.teacherId ?? ""}>
          <option value="">{t("common.teacher")}: {t("common.all")}</option>
          {teachers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Select name="courseId" defaultValue={sp.courseId ?? ""}>
          <option value="">{t("common.course")}: {t("common.all")}</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <button className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white">{t("common.filter")}</button>
      </form>
      <Card pad={false}>
        {groups.length === 0 ? (
          <EmptyState>{t("common.empty")}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr><Th>#</Th><Th>{t("common.group")}</Th><Th>{t("common.teacher")}</Th><Th>{t("groups.schedule")}</Th><Th>{t("common.room")}</Th><Th className="text-right">{t("groups.studentsCount")}</Th><Th>{t("common.start")}</Th><Th>{t("common.status")}</Th></tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Tr key={g.id}>
                  <Td className="text-slate-400">{g.code}</Td>
                  <Td>
                    <Link href={`/groups/${g.id}`} className="font-medium text-slate-900 hover:text-accent">{g.name}</Link>
                    <div className="text-xs text-slate-500">{g.course.name}{!ctx.activeBranchId && ` · ${g.branch.name}`}</div>
                  </Td>
                  <Td>{g.teacher.name}</Td>
                  <Td className="text-xs">{slotSummary(g.slots, t)}</Td>
                  <Td>{g.room?.name ?? "—"}</Td>
                  <Td className="text-right">{g._count.enrollments}{g.capacity ? <span className="text-slate-400"> / {g.capacity}</span> : null}</Td>
                  <Td className="whitespace-nowrap">{formatDate(toISODate(g.startDate))}</Td>
                  <Td><Badge tone={groupTone[g.status]}>{t(`group.${g.status}`)}</Badge></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pages={Math.ceil(total / PAGE)} params={sp} path="/groups" t={t} />
      </Card>
    </>
  );
}
