import Link from "next/link";
import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { sharedBotUsername } from "@/lib/contact-telegram";
import { PLACEMENT_COUNT, placementResults } from "@/lib/services/quizzes";
import { MAX_MINUTES } from "@/lib/quizzes/timing";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { Checkbox, Field, FormGrid, Input, Select } from "@/components/fields";
import { ActionForm, SubmitButton } from "@/components/client";
import { placeAttemptAction, savePlacementAction } from "../actions";

/** The start link: the center's own bot when it is open to everyone, else the shared bot with the center's slug. */
async function startLink(centerId: string, slug: string): Promise<string | null> {
  const own = await db.centerBot.findFirst({ where: { centerId, status: "ACTIVE" }, select: { username: true } });
  if (own) return `https://t.me/${own.username}?start=pt`;
  const shared = await sharedBotUsername();
  return shared ? `https://t.me/${shared}?start=pt_${slug}` : null;
}

export default async function PlacementPage() {
  const ctx = await requireStaff("groups.edit");
  const { t } = ctx;
  const [{ template, rows, groups }, link] = await Promise.all([placementResults(ctx), startLink(ctx.centerId, ctx.center.slug)]);
  const canPlace = ctx.can("students.edit");
  const groupName = new Map(groups.map((g) => [g.id, `${g.name} #${g.code}${g.topicCode ? ` · ${g.topicCode}` : ""}`]));
  const anyTopic = groups.some((g) => g.topicCode);

  return (
    <>
      <PageHeader back={{ href: "/quizzes", label: t("nav.quizzes") }} title={t("quizzes.placement")} subtitle={t("quizzes.placementSubtitle")} />
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title={t("quizzes.placementSettings")}>
          {!template && <p className="mb-3 text-sm text-amber-700">{t("quizzes.placementNotSet")}</p>}
          <ActionForm action={savePlacementAction} className="space-y-3">
            <FormGrid cols={3}>
              <Field label={t("quizzes.placementCount")}>
                <Input name="count" type="number" min={PLACEMENT_COUNT.min} max={PLACEMENT_COUNT.max} defaultValue={template?.questionCount || PLACEMENT_COUNT.default} required />
              </Field>
              <Field label={t("quizzes.placementPass")}>
                <Input name="passPercent" type="number" min={1} max={100} defaultValue={template?.passPercent ?? 70} required />
              </Field>
              <Field label={t("quizzes.minutes")}>
                <Input name="minutes" type="number" min={1} max={MAX_MINUTES} defaultValue={template?.minutes ?? 30} required />
              </Field>
            </FormGrid>
            <Checkbox name="open" label={t("quizzes.placementOpen")} defaultChecked={template ? template.status === "PUBLISHED" : true} />
            <SubmitButton>{t("common.save")}</SubmitButton>
          </ActionForm>
        </Card>
        <Card title={t("quizzes.placementLink")}>
          {link ? (
            <>
              <p className="break-all font-mono text-sm text-zinc-900">{link}</p>
              <p className="mt-2 text-sm text-zinc-600">{t("quizzes.placementLinkHint")}</p>
            </>
          ) : (
            <p className="text-sm text-zinc-600">{t("quizzes.placementNoLink")}</p>
          )}
          {!anyTopic && <p className="mt-3 text-sm text-amber-700">{t("quizzes.noGroupTopics")}</p>}
        </Card>
      </div>

      <Card pad={false} title={t("quizzes.results")}>
        {rows.length === 0 ? (
          <EmptyState compact>{t("quizzes.placementNone")}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("quizzes.col.student")}</Th>
                <Th>{t("quizzes.col.reached")}</Th>
                <Th className="text-right">{t("quizzes.col.score")}</Th>
                <Th>{t("quizzes.col.verdict")}</Th>
                <Th>{t("quizzes.col.suggested")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap">
                    {r.studentId ? <Link href={`/students/${r.studentId}`} className="font-medium hover:underline">{r.name}</Link> : r.leadId ? <Link href={`/leads/${r.leadId}`} className="font-medium hover:underline">{r.name}</Link> : <span className="font-medium">{r.name}</span>}
                    <div className="text-xs text-zinc-500">
                      {r.phone ? formatPhone(r.phone) : ""} · {r.studentId ? t("quizzes.knownStudent") : t("quizzes.lead")} · {formatDateTime(r.startedAt)}
                    </div>
                  </Td>
                  <Td className="text-sm">{r.topic ?? "—"}</Td>
                  <Td className="text-right tabular-nums font-medium">{r.correct === null ? <Badge tone="amber">{t(`quizzes.state.${r.state}`)}</Badge> : `${r.correct}/${r.total} · ${r.percent}%`}</Td>
                  <Td>{r.passed === null ? "—" : <Badge tone={r.passed ? "green" : "amber"}>{r.passed ? t("quizzes.passedYes") : t("quizzes.passedNo")}</Badge>}</Td>
                  <Td>
                    {r.placedGroup ? (
                      <span className="text-sm text-emerald-700">{t("quizzes.placedIn", { group: r.placedGroup })}</span>
                    ) : r.state === "submitted" && canPlace && groups.length > 0 ? (
                      <ActionForm action={placeAttemptAction} className="flex items-center gap-2">
                        <input type="hidden" name="attemptId" value={r.id} />
                        <Select name="groupId" defaultValue={r.suggestedGroupId ?? ""} required className="min-w-48">
                          <option value="" disabled>—</option>
                          {groups.map((g) => <option key={g.id} value={g.id}>{groupName.get(g.id)}{g.id === r.suggestedGroupId ? " ★" : ""}</option>)}
                        </Select>
                        <SubmitButton size="sm" confirm={t("quizzes.placeConfirm")}>{t("quizzes.place")}</SubmitButton>
                      </ActionForm>
                    ) : (
                      <span className="text-sm text-zinc-600">{r.suggestedGroupId ? groupName.get(r.suggestedGroupId) : "—"}</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
