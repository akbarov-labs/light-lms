"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

const input =
  "block h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 transition-[border-color,box-shadow] hover:border-zinc-300 focus:border-accent focus:outline-hidden focus:ring-[3px] focus:ring-accent/15 sm:text-sm";

/** Room names: existing rooms can be renamed (not removed here), new rows can be added and removed. */
export function RoomsEditor({ initial, labels }: { initial: { id: string; name: string }[]; labels: { placeholder: string; add: string; remove: string } }) {
  const [rows, setRows] = useState(() => (initial.length ? initial : [{ id: "", name: "" }]).map((r, i) => ({ ...r, key: i })));
  const [next, setNext] = useState(rows.length);
  const firstNew = initial.length ? initial.length : 1;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2">
          <input type="hidden" name="rooms.id" value={r.id} />
          <input
            name="rooms.name"
            defaultValue={r.name}
            placeholder={labels.placeholder}
            maxLength={60}
            autoFocus={r.key >= firstNew}
            className={input}
            aria-label={labels.placeholder}
          />
          {!r.id && rows.length > 1 && (
            <button type="button" onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900" aria-label={labels.remove}>
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          setRows((x) => [...x, { id: "", name: "", key: next }]);
          setNext((n) => n + 1);
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] font-medium text-zinc-800 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {labels.add}
      </button>
    </div>
  );
}

function addMinutes(hhmm: string, m: number): string {
  const [h, mm] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return hhmm;
  const total = Math.min(23 * 60 + 59, h * 60 + mm + m);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Weekday toggles + one start/end time for all of them; the end follows the course's lesson length. */
export function ScheduleFields({ days, minutes, labels }: { days: string[]; minutes: number; labels: { days: string; start: string; end: string } }) {
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState(addMinutes("09:00", minutes));
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-1.5 block text-[13px] font-medium text-zinc-700">{labels.days}</legend>
        <div className="flex flex-wrap gap-1.5">
          {days.map((d, i) => (
            <label key={i} className="relative">
              <input type="checkbox" name="days" value={i + 1} defaultChecked={i === 0 || i === 2 || i === 4} className="peer sr-only" />
              <span className="flex h-9 min-w-[44px] cursor-pointer select-none items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 transition-colors hover:border-zinc-300 peer-checked:border-zinc-900 peer-checked:bg-zinc-900 peer-checked:text-white peer-focus-visible:ring-[3px] peer-focus-visible:ring-accent/25">
                {d}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{labels.start}</span>
          <input
            type="time"
            name="startTime"
            required
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              setEnd(addMinutes(e.target.value, minutes));
            }}
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{labels.end}</span>
          <input type="time" name="endTime" required value={end} onChange={(e) => setEnd(e.target.value)} className={input} />
        </label>
      </div>
    </div>
  );
}
