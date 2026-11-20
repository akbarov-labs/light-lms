import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { bankOverview } from "@/lib/services/questions";
import { MAX_QUESTIONS } from "@/lib/services/quizzes";
import { MAX_MINUTES } from "@/lib/quizzes/timing";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { Field, FormGrid, Input, Select } from "@/components/fields";
import { ActionForm, SubmitButton } from "@/components/client";
import { createQuizAction } from "../actions";

export default async function NewQuizPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStaff("groups.edit");
  const { t } = ctx;
  const [groups, topics] = await Promise.all([
    db.group.findMany({
      where: { centerId: ctx.centerId, status: { in: ["ACTIVE", "PLANNED"] }, ...(ctx.branchIds ? { branchId: { in: ctx.branchIds } } : {}) },
      select: { id: true, name: true, code: true, currentTopicId: true },
      orderBy: { code: "asc" },
    }),
    bankOverview(ctx.centerId),
  ]);
  const usable = topics.filter((x) => x.approved > 0);
  const group = groups.find((g) => g.id === sp.group);
  return (
    <>
      <PageHeader title={t("quizzes.new")} back={{ href: "/quizzes", label: t("nav.quizzes") }} />
      <Card className="max-w-2xl">
        {usable.length === 0 ? (
          <EmptyState compact>{t("quizzes.noBank")}</EmptyState>
        ) : (
          <ActionForm action={createQuizAction} className="space-y-4">
            <FormGrid>
              <Field label={t("quizzes.group")}>
                <Select name="groupId" required defaultValue={group?.id ?? ""}>
                  <option value="" disabled>—</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name} #{g.code}</option>)}
                </Select>
              </Field>
              <Field label={t("quizzes.topic")} hint={t("quizzes.topicHint")}>
                <Select name="topicId" required defaultValue={usable.some((x) => x.id === group?.currentTopicId) ? group!.currentTopicId! : ""}>
                  <option value="" disabled>—</option>
                  {usable.map((x) => (
                    <option key={x.id} value={x.id}>{"  ".repeat(x.depth)}{x.code}. {x.title} ({x.approved})</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("quizzes.count")}>
                <Input name="count" type="number" min={1} max={MAX_QUESTIONS} defaultValue={10} required />
              </Field>
              <Field label={t("quizzes.minutes")}>
                <Input name="minutes" type="number" min={1} max={MAX_MINUTES} defaultValue={20} required />
              </Field>
            </FormGrid>
            <Field label={t("quizzes.titleField")} hint={t("quizzes.titleHint")}>
              <Input name="title" maxLength={200} />
            </Field>
            <SubmitButton>{t("quizzes.create")}</SubmitButton>
          </ActionForm>
        )}
      </Card>
    </>
  );
}
