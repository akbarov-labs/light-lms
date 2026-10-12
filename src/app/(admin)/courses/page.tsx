import type { Course } from "@prisma/client";
import { requireStaff, type Ctx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { parsePriceHistory } from "@/lib/billing/sync";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { Field, FormGrid, Input, Textarea } from "@/components/fields";
import { ActionForm, Modal, ModalForm, SubmitButton } from "@/components/client";
import { PricingFields } from "./pricing-fields";
import { saveCourseAction, toggleCourseArchiveAction } from "./actions";

function CourseForm({ ctx, course }: { ctx: Ctx; course?: Course }) {
  const { t } = ctx;
  const l = {
    pricingType: t("courses.pricingType"),
    SUBSCRIPTION: t("pricing.SUBSCRIPTION"),
    PACKAGE: t("pricing.PACKAGE"),
    renewal: t("courses.renewal"),
    CALENDAR: t("renewal.CALENDAR"),
    GROUP_START: t("renewal.GROUP_START"),
    STUDENT_START: t("renewal.STUDENT_START"),
    pricePerMonth: t("courses.pricePerMonth"),
    pricePackage: t("courses.pricePackage"),
    packageLessons: t("courses.packageLessons"),
    packageLessonsHint: t("courses.packageLessonsHint"),
    installments: t("courses.installments"),
    priceFrom: t("courses.priceFrom"),
    priceFromHint: t("courses.priceFromHint"),
  };
  return (
    <ModalForm action={saveCourseAction} className="space-y-3">
      {course && <input type="hidden" name="id" value={course.id} />}
      <FormGrid>
        <Field label={t("common.name")}><Input name="name" defaultValue={course?.name} required /></Field>
        <Field label={t("courses.level")}><Input name="level" defaultValue={course?.level ?? ""} /></Field>
        <Field label={t("courses.lessonMinutes")}><Input name="lessonMinutes" type="number" min={15} defaultValue={course?.lessonMinutes ?? 90} /></Field>
        <Field label={t("courses.lessonsPerWeek")}><Input name="lessonsPerWeek" type="number" min={1} defaultValue={course?.lessonsPerWeek ?? 3} /></Field>
        <Field label={t("courses.durationMonths")}><Input name="durationMonths" type="number" min={1} defaultValue={course?.durationMonths ?? ""} /></Field>
      </FormGrid>
      <PricingFields
        l={l}
        initial={course ? { pricingType: course.pricingType, price: course.price, renewal: course.renewal, packageLessons: course.packageLessons, installments: course.installments, isEdit: true } : undefined}
      />
      <Field label={t("common.description")}><Textarea name="description" defaultValue={course?.description ?? ""} /></Field>
      <SubmitButton>{course ? t("common.save") : t("common.create")}</SubmitButton>
    </ModalForm>
  );
}

export default async function CoursesPage() {
  const ctx = await requireStaff();
  const { t } = ctx;
  const courses = await db.course.findMany({
    where: { centerId: ctx.centerId },
    include: { _count: { select: { groups: { where: { status: { in: ["ACTIVE", "PLANNED"] } } } } } },
    orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
  });
  const canEdit = ctx.can("groups.edit");
  return (
    <>
      <PageHeader
        title={t("nav.courses")}
        actions={
          <>
            {ctx.can("export") && <LinkButton variant="secondary" href="/api/export/courses">{t("common.export")}</LinkButton>}
            {canEdit && <Modal label={`+ ${t("courses.new")}`} title={t("courses.new")} wide><CourseForm ctx={ctx} /></Modal>}
          </>
        }
      />
      <Card pad={false}>
        {courses.length === 0 ? (
          <EmptyState>{t("common.empty")}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr><Th>{t("common.name")}</Th><Th>{t("courses.pricingType")}</Th><Th className="text-right">{t("common.price")}</Th><Th>{t("courses.lessonMinutes")}</Th><Th>{t("common.groups")}</Th><Th /></tr>
            </thead>
            <tbody>
              {courses.map((c) => {
                const history = parsePriceHistory(c.priceHistory);
                const upcoming = history.find((h) => h.price === c.price && h.from > new Date().toISOString().slice(0, 10));
                return (
                  <Tr key={c.id} className={c.archivedAt ? "opacity-50" : ""}>
                    <Td className="font-medium text-zinc-900">{c.name}{c.level && <span className="ml-1 text-xs text-zinc-500">· {c.level}</span>}</Td>
                    <Td>
                      <Badge tone={c.pricingType === "SUBSCRIPTION" ? "blue" : "violet"}>{t(`pricing.${c.pricingType}`)}</Badge>
                      <div className="mt-1 text-xs text-zinc-500">
                        {c.pricingType === "SUBSCRIPTION"
                          ? t(`renewal.${c.renewal}`)
                          : `${c.packageLessons === 1 ? t("courses.perLesson") : c.packageLessons ? t("courses.lessonsN", { n: c.packageLessons }) : t("courses.wholeCourse")}${c.installments > 1 ? ` · ${c.installments}×` : ""}`}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap text-right font-medium">
                      {formatMoney(c.price)}
                      {upcoming && <div className="text-xs font-normal text-amber-700">{t("courses.priceChanged", { date: formatDate(upcoming.from), price: formatMoney(upcoming.price) })}</div>}
                    </Td>
                    <Td>{c.lessonMinutes} {t("common.minutes")}{c.lessonsPerWeek ? ` · ${c.lessonsPerWeek}×` : ""}</Td>
                    <Td>{c._count.groups}</Td>
                    <Td className="whitespace-nowrap text-right">
                      {canEdit && (
                        <div className="flex justify-end gap-1">
                          <Modal label={t("common.edit")} title={c.name} variant="secondary" size="sm" wide><CourseForm ctx={ctx} course={c} /></Modal>
                          <ActionForm action={toggleCourseArchiveAction}>
                            <input type="hidden" name="id" value={c.id} />
                            <SubmitButton variant="ghost" size="sm" confirm={t("common.confirm")}>{c.archivedAt ? t("common.restore") : t("common.archive")}</SubmitButton>
                          </ActionForm>
                        </div>
                      )}
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
