"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
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

// selected states: solid fills with text that clears 4.5:1
const ON: Record<Status, string> = {
  PRESENT: "border-emerald-700 bg-emerald-700 text-white",
  ABSENT: "border-red-600 bg-red-600 text-white",
  LATE: "border-amber-500 bg-amber-400 text-amber-950",
  EXCUSED: "border-sky-700 bg-sky-700 text-white",
};

const input = "h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15 disabled:bg-zinc-50 sm:h-9 sm:text-sm";

export function AttendanceForm({
  action,
  lessonId,
  rows,
  labels,
  maxGrade,
  topic,
  disabled,
  stickyClass = "bottom-4",
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  lessonId: string;
  rows: RosterRow[];
  labels: Record<Status | "grade" | "comment" | "save" | "allPresent" | "topic" | "trial" | "empty" | "unsaved" | "notMarkedYet" | "gradeComment" | "savedAll", string>;
  maxGrade: number;
  topic: string | null;
  disabled?: boolean;
  /** where the save bar sticks (above a phone's bottom nav) */
  stickyClass?: string;
}) {
  const initial = Object.fromEntries(rows.map((r) => [r.studentId, r.status ?? "PRESENT"])) as Record<string, Status>;
  const [state, setState] = useState<Record<string, Status>>(initial);
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.studentId, r.grade !== null || !!r.comment])));
  const [touched, setTouched] = useState(false);
  const [savedOnce, setSavedOnce] = useState(rows.some((r) => r.status !== null));
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-zinc-500">{labels.empty}</p>;
  const set = (id: string, s: Status) => {
    setState((x) => ({ ...x, [id]: s }));
    setTouched(true);
  };
  const banner = disabled ? null : touched ? labels.unsaved : savedOnce ? labels.savedAll : labels.notMarkedYet;
  return (
    <ActionForm action={action} className="space-y-3" onDone={() => { setTouched(false); setSavedOnce(true); }}>
      <input type="hidden" name="lessonId" value={lessonId} />
      <div className="flex flex-wrap items-center gap-2">
        <input name="topic" defaultValue={topic ?? ""} placeholder={labels.topic} aria-label={labels.topic} className={cx(input, "min-w-0 flex-1")} disabled={disabled} onChange={() => setTouched(true)} />
        <button
          type="button"
          disabled={disabled}
          className="h-11 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 sm:h-9"
          onClick={() => {
            setState(Object.fromEntries(rows.map((r) => [r.studentId, "PRESENT" as Status])));
            setTouched(true);
          }}
        >
          {labels.allPresent}
        </button>
      </div>
      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-line bg-white">
        {rows.map((r) => (
          <li key={r.studentId} className="p-3 sm:flex sm:items-center sm:gap-3">
            <input type="hidden" name="studentId" value={r.studentId} />
            <input type="hidden" name={`status.${r.studentId}`} value={state[r.studentId]} />
            <div className="mb-2 flex min-w-0 items-center gap-2 sm:mb-0 sm:flex-1">
              <span className="truncate font-medium text-zinc-900">{r.name}</span>
              {r.trial && <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">{labels.trial}</span>}
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [r.studentId]: !o[r.studentId] }))}
                aria-expanded={open[r.studentId]}
                aria-label={`${labels.gradeComment}: ${r.name}`}
                className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 sm:hidden"
              >
                <Plus className={cx("h-4 w-4 transition-transform", open[r.studentId] && "rotate-45")} aria-hidden />
              </button>
            </div>
            <div role="radiogroup" aria-label={r.name} className="grid grid-cols-4 gap-1.5 sm:w-[380px]">
              {(["PRESENT", "ABSENT", "LATE", "EXCUSED"] as Status[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={state[r.studentId] === s}
                  disabled={disabled}
                  onClick={() => set(r.studentId, s)}
                  className={cx("h-11 rounded-lg border px-1 text-[13px] font-medium transition-colors sm:h-9", state[r.studentId] === s ? ON[s] : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300")}
                >
                  {labels[s]}
                </button>
              ))}
            </div>
            <div className={cx("mt-2 gap-1.5 sm:mt-0 sm:flex", open[r.studentId] ? "flex" : "hidden")}>
              <input name={`grade.${r.studentId}`} type="number" inputMode="numeric" min={0} max={maxGrade} defaultValue={r.grade ?? ""} placeholder={labels.grade} aria-label={`${labels.grade}: ${r.name}`} className={cx(input, "w-20 sm:w-16")} disabled={disabled} onChange={() => setTouched(true)} />
              <input name={`comment.${r.studentId}`} defaultValue={r.comment ?? ""} placeholder={labels.comment} aria-label={`${labels.comment}: ${r.name}`} className={cx(input, "min-w-0 flex-1 sm:w-40")} disabled={disabled} onChange={() => setTouched(true)} />
            </div>
          </li>
        ))}
      </ul>
      {!disabled && (
        <div className={cx("sticky z-10 flex items-center justify-between gap-3 rounded-xl border border-line bg-white/95 p-2 pl-4 shadow-pop backdrop-blur", stickyClass)}>
          <span className={cx("text-[13px]", touched || !savedOnce ? "font-medium text-amber-700" : "text-zinc-500")}>{banner}</span>
          <SubmitButton className="h-11 px-5 sm:h-9">{labels.save}</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}
