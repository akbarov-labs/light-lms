import type { Ctx } from "@/lib/ctx";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { HeldLesson, SalaryResult } from "@/lib/salary/engine";
import { Card, EmptyState, Table, Td, Th, Tr } from "./ui";

/** Salary breakdown: per-group lines, adjustments, then every lesson with the students counted. */
export function SalaryBreakdown({ ctx, result, lessons, showLessons = true }: { ctx: Ctx; result: SalaryResult; lessons?: HeldLesson[]; showLessons?: boolean }) {
  const { t } = ctx;
  return (
    <div className="space-y-4">
      <Card pad={false} title={t("salary.live")}>
        {result.warnings.includes("noRule") && <p className="m-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">{t("salary.noRule")}</p>}
        <Table>
          <thead><tr><Th>{t("common.group")}</Th><Th className="text-right">{t("salary.lessonsHeld")}</Th><Th className="text-right">{t("salary.studentLessons")}</Th><Th className="text-right">{t("salary.earnedBase")}</Th><Th className="text-right">{t("common.amount")}</Th></tr></thead>
          <tbody>
            {result.base > 0 && <Tr><Td>{t("salary.base")}</Td><Td /><Td /><Td /><Td className="text-right font-medium">{formatMoney(result.base)}</Td></Tr>}
            {result.lines.map((l) => (
              <Tr key={l.groupId}>
                <Td>{l.groupName}</Td>
                <Td className="text-right">{l.lessonsHeld}</Td>
                <Td className="text-right">{l.studentLessons}</Td>
                <Td className="whitespace-nowrap text-right">{formatMoney(l.earnedBase)}</Td>
                <Td className="whitespace-nowrap text-right font-medium">{formatMoney(l.amount)}</Td>
              </Tr>
            ))}
            {result.adjustments.map((a, i) => (
              <Tr key={a.id ?? i}><Td colSpan={4} className="text-sm">{a.amount > 0 ? "＋" : "−"} {a.reason}</Td><Td className={a.amount < 0 ? "whitespace-nowrap text-right text-rose-600" : "whitespace-nowrap text-right text-emerald-700"}>{formatMoney(a.amount)}</Td></Tr>
            ))}
            <Tr><Td className="font-semibold">{t("common.total")}</Td><Td className="text-right font-semibold">{result.lessonsHeld}</Td><Td /><Td /><Td className="whitespace-nowrap text-right text-base font-semibold">{formatMoney(result.total)}</Td></Tr>
          </tbody>
        </Table>
      </Card>
      {showLessons && lessons && (
        <Card pad={false} title={t("salary.lessons")}>
          {lessons.length === 0 ? (
            <EmptyState>{t("common.empty")}</EmptyState>
          ) : (
            <Table>
              <thead><tr><Th>{t("common.date")}</Th><Th>{t("common.group")}</Th><Th>{t("common.students")}</Th><Th className="text-right">{t("salary.earnedBase")}</Th></tr></thead>
              <tbody>
                {lessons.map((l) => (
                  <Tr key={l.lessonId}>
                    <Td className="whitespace-nowrap text-xs">{formatDate(l.date)}</Td>
                    <Td className="text-xs">{l.groupName}</Td>
                    <Td className="text-xs">{l.students.map((s) => `${s.studentName}${s.trial ? " (sinov)" : ""}`).join(", ") || "—"}</Td>
                    <Td className="whitespace-nowrap text-right text-xs">{formatMoney(Math.round(l.students.reduce((x, s) => x + s.value, 0)))}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
