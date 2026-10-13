"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";

export interface SlotRow {
  weekday: number;
  startTime: string;
  endTime: string;
}

const cls = "rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm shadow-xs";

export function SlotsEditor({ initial, days, addLabel, removeLabel = "×", defaultMinutes = 90 }: { initial: SlotRow[]; days: string[]; addLabel: string; removeLabel?: string; defaultMinutes?: number }) {
  const [rows, setRows] = useState<SlotRow[]>(initial.length ? initial : [{ weekday: 1, startTime: "09:00", endTime: "10:30" }]);
  const addMinutes = (hhmm: string, m: number) => {
    const [h, mm] = hhmm.split(":").map(Number);
    const total = Math.min(23 * 60 + 59, h * 60 + mm + m);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };
  const set = (i: number, patch: Partial<SlotRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select name="slots.weekday" value={r.weekday} onChange={(e) => set(i, { weekday: Number(e.target.value) })} className={cls}>
            {days.map((d, k) => <option key={k} value={k + 1}>{d}</option>)}
          </select>
          <input type="time" name="slots.start" value={r.startTime} required className={cls} onChange={(e) => set(i, { startTime: e.target.value, endTime: addMinutes(e.target.value, defaultMinutes) })} />
          <span className="text-zinc-500">–</span>
          <input type="time" name="slots.end" value={r.endTime} required className={cls} onChange={(e) => set(i, { endTime: e.target.value })} />
          {rows.length > 1 && (
            <button type="button" className="rounded-sm p-1 text-zinc-500 hover:text-red-600" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label={removeLabel}><X className="h-4 w-4" aria-hidden /></button>
          )}
        </div>
      ))}
      <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100" onClick={() => setRows((x) => [...x, { ...(x[x.length - 1] ?? { weekday: 1, startTime: "09:00", endTime: "10:30" }), weekday: Math.min(7, (x[x.length - 1]?.weekday ?? 0) + 2) }])}>
        <Plus className="h-4 w-4" aria-hidden />
        {addLabel}
      </button>
    </div>
  );
}
