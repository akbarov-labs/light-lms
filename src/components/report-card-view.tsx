// One report card, as parents and staff see it (screen + A4 print). Server component, no data access.
import type { ReportCardData } from "@/lib/services/report-cards";
import type { TFn } from "@/lib/i18n";
import { formatDate, monthLabel } from "@/lib/dates";
import { LOW_ATTENDANCE_PCT, type Rating } from "@/lib/academics/progress";
import { attendanceMark } from "@/lib/format";
import { cx } from "./ui";

const ratingTone: Record<Rating, string> = {
  EXCELLENT: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  GOOD: "bg-sky-50 text-sky-800 ring-sky-200",
  FAIR: "bg-amber-50 text-amber-800 ring-amber-200",
  ATTENTION: "bg-red-50 text-red-800 ring-red-200",
};

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 print:p-2">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="tnum mt-0.5 text-2xl font-semibold tracking-[-0.01em]">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

export function ReportCardView({ data, t, locale, note }: { data: ReportCardData; t: TFn; locale: "uz" | "ru"; note?: string }) {
  const p = data.progress;
  const scaleMax = data.gradeScale === "100" ? 100 : 5;
  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs sm:p-7 print:border-0 print:p-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-zinc-500">{data.center}</div>
          <h1 className="mt-0.5 text-xl font-semibold tracking-[-0.01em]">{data.student}</h1>
          <div className="mt-1 text-sm text-zinc-600">{t("rc.cardTitle", { month: monthLabel(data.month, locale) })}</div>
        </div>
        {p.rating && <span className={cx("rounded-full px-3 py-1 text-sm font-semibold ring-1", ratingTone[p.rating])}>{t(`rc.rating.${p.rating}`)}</span>}
      </header>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <div><dt className="inline text-zinc-500">{t("rc.group")}: </dt><dd className="inline">{data.group} #{data.groupCode}</dd></div>
        <div><dt className="inline text-zinc-500">{t("rc.course")}: </dt><dd className="inline">{data.course}{data.level ? ` · ${data.level}` : ""}</dd></div>
        <div><dt className="inline text-zinc-500">{t("rc.teacher")}: </dt><dd className="inline">{data.teacher}</dd></div>
      </dl>

      {note && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 print:hidden">{note}</p>}

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Figure label={t("rc.lessons")} value={String(p.lessons)} hint={`${t("rc.present")} ${p.present} · ${t("rc.late")} ${p.late} · ${t("rc.absent")} ${p.absent}${p.excused ? ` · ${t("rc.excused")} ${p.excused}` : ""}`} />
        <Figure label={t("rc.attendance")} value={p.attendancePct === null ? "—" : `${p.attendancePct}%`} hint={p.unmarked ? `${t("rc.unmarked")}: ${p.unmarked}` : undefined} />
        <Figure
          label={t("rc.gradeAvg")}
          value={p.gradeAvg === null ? "—" : `${p.gradeAvg} / ${scaleMax}`}
          hint={p.gradeAvg === null ? t("rc.noGrades") : p.trend ? `${p.trend === "up" ? "↑" : p.trend === "down" ? "↓" : "="} ${t(`rc.trend.${p.trend}`)}` : undefined}
        />
      </section>

      {p.attendancePct !== null && p.attendancePct < LOW_ATTENDANCE_PCT && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{t("rc.lowAttendance", { pct: p.attendancePct })}</p>
      )}

      {data.comment && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold">{t("rc.comment")}</h2>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-zinc-700">{data.comment}</p>
        </section>
      )}

      {data.exams.length > 0 && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold">{t("rc.exams")}</h2>
          <ul className="mt-1 divide-y divide-zinc-100 text-sm">
            {data.exams.map((x, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span>{formatDate(x.date)} · {x.title}{x.level ? ` · ${x.level}` : ""}</span>
                <span className="tnum font-medium">{x.score} / {x.maxScore}{x.passed !== null && <span className={x.passed ? "text-emerald-700" : "text-red-700"}> · {x.passed ? t("rc.passed") : t("rc.failed")}</span>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.comments.length > 0 && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold">{t("rc.lessonComments")}</h2>
          <ul className="mt-1 space-y-1 text-sm text-zinc-700">
            {p.comments.map((c, i) => <li key={i}><span className="tnum text-zinc-500">{formatDate(c.date).slice(0, 5)}</span> — {c.text}</li>)}
          </ul>
        </section>
      )}

      {p.lines.length > 0 && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold">{t("rc.journal")}</h2>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-zinc-500"><th className="py-1 pr-3 font-medium">{t("rc.date")}</th><th className="py-1 pr-3 font-medium">{t("rc.mark")}</th><th className="py-1 pr-3 font-medium">{t("rc.grade")}</th><th className="py-1 font-medium">{t("rc.topic")}</th></tr></thead>
              <tbody className="divide-y divide-zinc-100">
                {p.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="tnum whitespace-nowrap py-1 pr-3">{formatDate(l.date).slice(0, 5)}</td>
                    <td className="py-1 pr-3" title={l.status ? t(`rc.${l.status === "PRESENT" ? "present" : l.status === "LATE" ? "late" : l.status === "ABSENT" ? "absent" : "excused"}`) : t("rc.unmarked")}>{l.status ? attendanceMark[l.status] : "·"}</td>
                    <td className="tnum py-1 pr-3">{l.grade ?? ""}</td>
                    <td className="py-1 text-zinc-600">{l.topic ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </article>
  );
}
