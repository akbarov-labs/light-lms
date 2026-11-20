import Link from "next/link";
import { Library } from "lucide-react";
import { requireStaff } from "@/lib/ctx";
import { bankOverview } from "@/lib/services/questions";
import { Card, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui";

export default async function QuestionsPage() {
  const ctx = await requireStaff();
  const { t } = ctx;
  const topics = await bankOverview(ctx.centerId);
  const total = topics.filter((x) => x.depth === 0).reduce((s, x) => s + x.total, 0);
  return (
    <>
      <PageHeader title={t("nav.questions")} subtitle={t("questions.subtitle")} />
      {total === 0 ? (
        <Card>
          <EmptyState icon={<Library className="h-6 w-6" strokeWidth={1.5} />}>{t("questions.empty")}</EmptyState>
        </Card>
      ) : (
        <>
          <p className="mb-4 max-w-3xl text-sm text-zinc-600">{t("questions.howKeys")}</p>
          <Card pad={false}>
            <Table>
              <thead>
                <tr>
                  <Th>{t("questions.topic")}</Th>
                  <Th className="text-right">{t("questions.total")}</Th>
                  <Th className="text-right">{t("questions.f.check")}</Th>
                  <Th className="text-right">{t("questions.f.sure")}</Th>
                  <Th className="text-right">{t("questions.f.approved")}</Th>
                  <Th className="text-right">{t("questions.f.rejected")}</Th>
                </tr>
              </thead>
              <tbody>
                {topics.map((x) => (
                  <Tr key={x.id}>
                    <Td>
                      <Link href={`/questions/${x.id}`} className={x.depth === 0 ? "font-medium hover:underline" : "hover:underline"} style={{ paddingLeft: `${x.depth * 1.25}rem` }}>
                        <span className="tabular-nums text-zinc-500">{x.code}.</span> {x.title}
                      </Link>
                    </Td>
                    <Td className="text-right tabular-nums">{x.total}</Td>
                    <Td className={x.check ? "text-right tabular-nums text-amber-700" : "text-right tabular-nums text-zinc-400"}>{x.check}</Td>
                    <Td className="text-right tabular-nums">{x.sure}</Td>
                    <Td className={x.approved ? "text-right tabular-nums text-emerald-700" : "text-right tabular-nums text-zinc-400"}>{x.approved}</Td>
                    <Td className="text-right tabular-nums text-zinc-400">{x.rejected}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}
