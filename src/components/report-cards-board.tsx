// A group's report cards for one month: numbers per student, the teacher's comment, send to parents.
import Link from "next/link";
import type { TFn } from "@/lib/i18n";
import type { ReportCardData } from "@/lib/services/report-cards";
import { saveReportCardsAction } from "@/app/report-cards/actions";
import { ActionForm, SubmitButton } from "./client";
import { Badge, Card, EmptyState, cx } from "./ui";
import { Textarea } from "./fields";

export interface BoardRow {
  id: string;
  status: "DRAFT" | "SENT";
  data: ReportCardData;
}

export function MonthPicker({ month, label, filter, hidden }: { month: string; label: string; filter: string; hidden?: Record<string, string> }) {
  return (
    <form className="mb-4 flex flex-wrap items-center gap-2">
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input type="month" name="month" defaultValue={month} aria-label={label} className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm" />
      <button className="h-9 rounded-lg bg-zinc-900 px-3.5 text-sm font-medium text-white hover:bg-zinc-800">{filter}</button>
    </form>
  );
}

export function ReportCardsBoard({ rows, groupId, month, canSend, t }: { rows: BoardRow[]; groupId: string; month: string; canSend: boolean; t: TFn }) {
  if (rows.length === 0) return <Card><EmptyState compact>{t("rc.noStudents")}</EmptyState></Card>;
  const drafts = rows.filter((r) => r.status === "DRAFT").length;
  return (
    <ActionForm action={saveReportCardsAction} className="space-y-3">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="month" value={month} />
      <ul className="space-y-3">
        {rows.map((r) => {
          const p = r.data.progress;
          return (
            <li key={r.id} className="rounded-xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{r.data.student}</div>
                  <div className="tnum mt-0.5 text-xs text-zinc-500">
                    {t("rc.lessons")}: {p.lessons} · {t("rc.attendance")}: {p.attendancePct === null ? "—" : `${p.attendancePct}%`} · {t("rc.gradeAvg")}: {p.gradeAvg ?? "—"}
                    {p.rating && <> · {t(`rc.rating.${p.rating}`)}</>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={r.status === "SENT" ? "green" : "gray"}>{t(`rc.${r.status}`)}</Badge>
                  <Link href={`/report-cards/${r.id}`} className="text-sm font-medium text-zinc-700 underline underline-offset-4 hover:text-zinc-950">{t("rc.open")}</Link>
                </div>
              </div>
              {r.status === "DRAFT" ? (
                <Textarea name={`comment:${r.id}`} defaultValue={r.data.comment ?? ""} rows={2} maxLength={1000} placeholder={t("rc.commentPlaceholder")} aria-label={`${t("rc.comment")}: ${r.data.student}`} className="mt-3" />
              ) : (
                r.data.comment && <p className={cx("mt-3 whitespace-pre-line text-sm text-zinc-700")}>{r.data.comment}</p>
              )}
            </li>
          );
        })}
      </ul>
      {drafts > 0 && (
        <div className="sticky bottom-20 z-10 flex flex-wrap justify-end gap-2 rounded-xl border border-line bg-white/95 p-2 shadow-pop backdrop-blur-sm sm:bottom-4">
          <SubmitButton variant="secondary">{t("rc.saveComments")}</SubmitButton>
          {canSend && <SubmitButton name="intent" value="send" confirm={t("rc.sendConfirm")}>{t("rc.send")}</SubmitButton>}
        </div>
      )}
    </ActionForm>
  );
}
