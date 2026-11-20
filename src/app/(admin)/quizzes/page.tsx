import Link from "next/link";
import { ListChecks } from "lucide-react";
import { requireStaff } from "@/lib/ctx";
import { formatDate, toISODate } from "@/lib/dates";
import { quizList } from "@/lib/services/quizzes";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th, Tr, type Tone } from "@/components/ui";

const STATUS_TONE: Record<string, Tone> = { DRAFT: "gray", PUBLISHED: "green", CLOSED: "violet" };

export default async function QuizzesPage() {
  const ctx = await requireStaff("groups.edit");
  const { t } = ctx;
  const quizzes = await quizList(ctx);
  return (
    <>
      <PageHeader
        title={t("nav.quizzes")}
        subtitle={t("quizzes.subtitle")}
        actions={
          <>
            <LinkButton variant="secondary" href="/quizzes/placement">{t("quizzes.placement")}</LinkButton>
            <LinkButton href="/quizzes/new">{t("quizzes.new")}</LinkButton>
          </>
        }
      />
      {quizzes.length === 0 ? (
        <Card>
          <EmptyState icon={<ListChecks className="h-6 w-6" strokeWidth={1.5} />}>{t("quizzes.empty")}</EmptyState>
        </Card>
      ) : (
        <Card pad={false}>
          <Table>
            <thead>
              <tr>
                <Th>{t("quizzes.col.title")}</Th>
                <Th>{t("quizzes.col.group")}</Th>
                <Th>{t("quizzes.col.status")}</Th>
                <Th className="text-right">{t("quizzes.col.questions")}</Th>
                <Th className="text-right">{t("quizzes.col.finished")}</Th>
                <Th>{t("quizzes.col.created")}</Th>
              </tr>
            </thead>
            <tbody>
              {quizzes.map((q) => (
                <Tr key={q.id}>
                  <Td>
                    <Link href={`/quizzes/${q.id}`} className="font-medium text-zinc-900 hover:underline hover:decoration-zinc-400">{q.title}</Link>
                  </Td>
                  <Td>{q.group}</Td>
                  <Td><Badge tone={STATUS_TONE[q.status]}>{t(`quizzes.status.${q.status}`)}</Badge></Td>
                  <Td className="text-right tabular-nums">{t("quizzes.meta", { n: q.questions, m: q.minutes })}</Td>
                  <Td className="text-right tabular-nums">{q.status === "DRAFT" ? "—" : q.finished}</Td>
                  <Td className="whitespace-nowrap text-xs text-zinc-500">{formatDate(toISODate(q.createdAt))}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
