import Link from "next/link";
import { Plus } from "lucide-react";
import { branchWhere, requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, toISODate, todayISO } from "@/lib/dates";
import { examStats } from "@/lib/academics/exams";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/fields";
import { Modal, ModalForm, SubmitButton } from "@/components/client";
import { createExamAction } from "./actions";

export default async function ExamsPage() {
  const ctx = await requireStaff();
  const { t } = ctx;
  const scope = branchWhere(ctx);
  const [exams, groups, courses] = await Promise.all([
    db.exam.findMany({
      where: { centerId: ctx.centerId, archivedAt: null, ...(scope.branchId ? { OR: [{ branchId: scope.branchId }, { group: { branchId: scope.branchId } }] } : {}) },
      include: { group: { select: { name: true, code: true } }, course: { select: { name: true } }, results: { select: { score: true, passed: true } }, _count: { select: { certificates: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 200,
    }),
    db.group.findMany({ where: { centerId: ctx.centerId, status: { in: ["ACTIVE", "PLANNED"] }, ...scope }, select: { id: true, name: true, code: true }, orderBy: { code: "desc" } }),
    db.course.findMany({ where: { centerId: ctx.centerId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader
        title={t("nav.exams")}
        actions={
          ctx.can("groups.edit") && (
            <Modal label={t("exams.new")} icon={<Plus className="h-4 w-4" aria-hidden />} title={t("exams.new")} wide>
              <ModalForm action={createExamAction} className="space-y-3">
                <FormGrid>
                  <Field label={t("exams.kind")}>
                    <Select name="kind" defaultValue="LEVEL">
                      {(["PLACEMENT", "LEVEL", "FINAL", "MOCK"] as const).map((k) => <option key={k} value={k}>{t(`exams.kind.${k}`)}</option>)}
                    </Select>
                  </Field>
                  <Field label={t("exams.name")}><Input name="title" required maxLength={120} /></Field>
                  <Field label={t("common.date")}><Input type="date" name="date" defaultValue={todayISO()} required /></Field>
                  <Field label={t("exams.group")}>
                    <Select name="groupId" defaultValue="">
                      <option value="">{t("exams.noGroup")}</option>
                      {groups.map((g) => <option key={g.id} value={g.id}>{g.name} #{g.code}</option>)}
                    </Select>
                  </Field>
                  <Field label={t("exams.course")}>
                    <Select name="courseId" defaultValue="">
                      <option value="">{t("exams.anyCourse")}</option>
                      {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </Field>
                  <Field label={t("exams.maxScore")}><Input type="number" name="maxScore" min={1} max={10000} defaultValue={100} /></Field>
                  <Field label={t("exams.passScore")} hint={t("exams.passHint")}><Input type="number" name="passScore" min={0} max={10000} /></Field>
                </FormGrid>
                <Field label={t("exams.sections")} hint={t("exams.sectionsHint")}><Textarea name="sections" rows={3} placeholder={"Listening: 25\nReading: 25\nWriting: 25\nSpeaking: 25"} /></Field>
                <Field label={t("exams.bands")} hint={t("exams.bandsHint")}><Textarea name="bands" rows={3} placeholder={"0: A1\n40: A2\n70: B1"} /></Field>
                <SubmitButton>{t("common.create")}</SubmitButton>
              </ModalForm>
            </Modal>
          )
        }
      />
      <Card pad={false}>
        {exams.length === 0 ? (
          <EmptyState title={t("exams.none")}>{t("exams.noneHint")}</EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>{t("common.date")}</Th><Th>{t("exams.name")}</Th><Th>{t("exams.kind")}</Th><Th>{t("exams.group")}</Th><Th className="text-right">{t("exams.results")}</Th><Th className="text-right">{t("exams.passed")}</Th><Th /></tr></thead>
            <tbody>
              {exams.map((e) => {
                const st = examStats(e.results);
                return (
                  <Tr key={e.id}>
                    <Td className="whitespace-nowrap text-xs">{formatDate(toISODate(e.date))}</Td>
                    <Td><Link href={`/exams/${e.id}`} className="font-medium hover:underline hover:decoration-zinc-400">{e.title}</Link></Td>
                    <Td className="text-xs">{t(`exams.kind.${e.kind}`)}</Td>
                    <Td className="text-xs">{e.group ? `${e.group.name} #${e.group.code}` : (e.course?.name ?? "—")}</Td>
                    <Td className="tnum text-right">{st.count}{st.avg !== null && <span className="text-xs text-zinc-500"> · {st.avg}</span>}</Td>
                    <Td className="tnum text-right">{e.passScore === null ? "—" : `${st.passed}/${st.count}`}</Td>
                    <Td className="text-right">
                      {e.publishedAt && <Badge tone="green">{t("rc.SENT")}</Badge>}
                      {e._count.certificates > 0 && <> <Badge tone="violet" dot={false}>{e._count.certificates} × {t("cert.title")}</Badge></>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
