import { Plus } from "lucide-react";
import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { branchWhere, requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, toISODate } from "@/lib/dates";
import { groupTone, slotSummary } from "@/lib/format";
import { enumParam, GROUP_STATUSES, groupCodeParam, groupStatusWhere, pageParam, strParam } from "@/lib/queries/params";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Pagination, Table, Td, Th, Tr } from "@/components/ui";
import { Input, Select } from "@/components/fields";
import { listTeachers } from "@/lib/queries/staff";

const PAGE = 30;

export default async function GroupsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStaff();
  const { t } = ctx;
  const page = pageParam(sp.page);
  const status = sp.status === "all" || enumParam(GROUP_STATUSES, sp.status) ? sp.status! : "current";
  const q = strParam(sp.q);
  const code = groupCodeParam(q);
  const where: Prisma.GroupWhereInput = {
    centerId: ctx.centerId,
    ...branchWhere(ctx),
    ...groupStatusWhere(status),
    ...(sp.teacherId ? { teacherId: sp.teacherId } : {}),
    ...(sp.courseId ? { courseId: sp.courseId } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, ...(code !== undefined ? [{ code }] : [])] } : {}),
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
    listTeachers(ctx.centerId),
    db.course.findMany({ where: { centerId: ctx.centerId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader
        title={t("nav.groups")}
        actions={
          <>
            {ctx.can("export") && <LinkButton variant="secondary" href={`/api/export/groups?${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString()}`}>{t("common.export")}</LinkButton>}
            {ctx.can("groups.edit") && <LinkButton href="/groups/new"><Plus className="h-4 w-4" aria-hidden />{t("groups.new")}</LinkButton>}
          </>
        }
      />
      <form className="mb-4 flex flex-wrap items-center gap-2 *:w-full *:min-w-0 sm:*:w-auto">
        <Input name="q" type="search" defaultValue={sp.q} placeholder={`${t("common.search")}…`} aria-label={t("common.search")} className="sm:w-64!" />
        <Select name="status" aria-label={t("common.status")} defaultValue={status}>
          <option value="current">{t("group.ACTIVE")} + {t("group.PLANNED")}</option>
          <option value="all">{t("common.all")}</option>
          {(["ACTIVE", "PLANNED", "FINISHED", "ARCHIVED"] as const).map((s) => <option key={s} value={s}>{t(`group.${s}`)}</option>)}
        </Select>
        <Select name="teacherId" aria-label={t("common.teacher")} defaultValue={sp.teacherId ?? ""}>
          <option value="">{t("common.teacher")}: {t("common.all")}</option>
          {teachers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Select name="courseId" aria-label={t("common.course")} defaultValue={sp.courseId ?? ""}>
          <option value="">{t("common.course")}: {t("common.all")}</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <button className="h-9 rounded-lg bg-zinc-900 px-3.5 text-sm font-medium text-white hover:bg-zinc-800">{t("common.filter")}</button>
      </form>
      <Card pad={false}>
        {groups.length === 0 ? (
          sp.q || sp.teacherId || sp.courseId || (sp.status && sp.status !== "current") ? (
            <EmptyState action={<LinkButton variant="secondary" size="sm" href="/groups">{t("empty.clear")}</LinkButton>}>{t("empty.filtered")}</EmptyState>
          ) : (
            <EmptyState title={t("empty.groupsTitle")} action={ctx.can("groups.edit") && <LinkButton variant="secondary" size="sm" href="/groups/new"><Plus className="h-3.5 w-3.5" aria-hidden />{t("groups.new")}</LinkButton>}>
              {t("empty.groups")}
            </EmptyState>
          )
        ) : (
          <Table>
            <thead>
              <tr><Th>#</Th><Th>{t("common.group")}</Th><Th>{t("common.teacher")}</Th><Th>{t("groups.schedule")}</Th><Th>{t("common.room")}</Th><Th className="text-right">{t("groups.studentsCount")}</Th><Th>{t("common.start")}</Th><Th>{t("common.status")}</Th></tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Tr key={g.id}>
                  <Td className="text-zinc-500">{g.code}</Td>
                  <Td>
                    <Link href={`/groups/${g.id}`} className="font-medium text-zinc-900 hover:underline hover:decoration-zinc-400">{g.name}</Link>
                    <div className="text-xs text-zinc-500">{g.course.name}{!ctx.activeBranchId && ` · ${g.branch.name}`}</div>
                  </Td>
                  <Td>{g.teacher.name}</Td>
                  <Td className="text-xs">{slotSummary(g.slots, t)}</Td>
                  <Td>{g.room?.name ?? "—"}</Td>
                  <Td className={g.capacity && g._count.enrollments > g.capacity ? "text-right font-medium text-red-600" : "text-right"} title={g.capacity && g._count.enrollments > g.capacity ? t("groups.overCapacity") : undefined}>{g._count.enrollments}{g.capacity ? <span className={g._count.enrollments > g.capacity ? "" : "text-zinc-500"}> / {g.capacity}</span> : null}</Td>
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
