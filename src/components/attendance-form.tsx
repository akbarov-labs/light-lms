"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "./client";
import { cx } from "./ui";

type Status = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
type ActionState = { ok?: boolean; error?: string; message?: string; at?: number } | null;

export interface RosterRow {
  studentId: string;
  name: string;
  trial: boolean;
  status: Status | null;
  grade: number | null;
  comment: string | null;
}

const COLORS: Record<Status, string> = {
  PRESENT: "bg-emerald-600 text-white border-emerald-600",
  ABSENT: "bg-rose-600 text-white border-rose-600",
  LATE: "bg-amber-500 text-white border-amber-500",
  EXCUSED: "bg-sky-600 text-white border-sky-600",
};

export function AttendanceForm({
  action,
  lessonId,
  rows,
  labels,
  maxGrade,
  topic,
  disabled,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  lessonId: string;
  rows: RosterRow[];
  labels: Record<Status | "grade" | "comment" | "save" | "allPresent" | "topic" | "trial" | "empty", string>;
  maxGrade: number;
  topic: string | null;
  disabled?: boolean;
}) {
  const [state, setState] = useState<Record<string, Status>>(() => Object.fromEntries(rows.map((r) => [r.studentId, r.status ?? "PRESENT"])));
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-slate-500">{labels.empty}</p>;
  return (
    <ActionForm action={action} className="space-y-3">
      <input type="hidden" name="lessonId" value={lessonId} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input name="topic" defaultValue={topic ?? ""} placeholder={labels.topic} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" disabled={disabled} />
        <button type="button" disabled={disabled} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setState(Object.fromEntries(rows.map((r) => [r.studentId, "PRESENT" as Status])))}>
          {labels.allPresent}
        </button>
      </div>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {rows.map((r) => (
          <li key={r.studentId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
            <input type="hidden" name="studentId" value={r.studentId} />
            <input type="hidden" name={`status.${r.studentId}`} value={state[r.studentId]} />
            <div className="min-w-0 flex-1 font-medium text-slate-900">
              {r.name}
              {r.trial && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">{labels.trial}</span>}
            </div>
            <div className="grid grid-cols-4 gap-1">
              {(["PRESENT", "ABSENT", "LATE", "EXCUSED"] as Status[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={disabled}
                  onClick={() => setState((x) => ({ ...x, [r.studentId]: s }))}
                  className={cx("min-h-[40px] rounded-lg border px-2 text-xs font-medium transition", state[r.studentId] === s ? COLORS[s] : "border-slate-300 bg-white text-slate-600")}
                >
                  {labels[s]}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              <input name={`grade.${r.studentId}`} type="number" min={0} max={maxGrade} defaultValue={r.grade ?? ""} placeholder={labels.grade} className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-sm" disabled={disabled} />
              <input name={`comment.${r.studentId}`} defaultValue={r.comment ?? ""} placeholder={labels.comment} className="w-full min-w-0 rounded-lg border border-slate-300 px-2 py-2 text-sm sm:w-40" disabled={disabled} />
            </div>
          </li>
        ))}
      </ul>
      {!disabled && <SubmitButton className="w-full py-3 sm:w-auto">{labels.save}</SubmitButton>}
    </ActionForm>
  );
}
