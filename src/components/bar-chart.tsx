import { formatMoney } from "@/lib/money";
import { cx } from "./ui";

/** Column chart in plain HTML: crisp text at any width, the latest period in ink, the rest quiet. */
export function BarChart({ data, height = 180, units = { mln: "mln", k: "ming" } }: { data: { label: string; value: number }[]; height?: number; units?: { mln: string; k: string } }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const short = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace(".0", "")} ${units.mln}` : v >= 1000 ? `${Math.round(v / 1000)} ${units.k}` : String(v));
  return (
    <div role="img" aria-label={data.map((d) => `${d.label}: ${formatMoney(d.value)}`).join(", ")}>
      <div className="flex items-end gap-3 border-b border-zinc-200" style={{ height }}>
        {data.map((d, i) => {
          const last = i === data.length - 1;
          return (
            <div key={`${i}-${d.label}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" title={`${d.label}: ${formatMoney(d.value)}`}>
              <span className={cx("tnum whitespace-nowrap text-xs", last ? "font-medium text-zinc-900" : "text-zinc-500")}>{short(d.value)}</span>
              <div className={cx("w-full max-w-[56px] rounded-t-md", last ? "bg-zinc-900" : "bg-zinc-200")} style={{ height: `${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * (height - 28))}px` }} />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-3">
        {data.map((d, i) => (
          <span key={`${i}-${d.label}`} className={cx("min-w-0 flex-1 truncate text-center text-xs", i === data.length - 1 ? "font-medium text-zinc-900" : "text-zinc-500")}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

/** Horizontal share bars for small breakdowns (methods, categories, funnel stages). */
export function ShareBars({ rows, money = true }: { rows: { label: string; value: number }[]; money?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="flex justify-between gap-2"><span className="truncate text-zinc-700">{r.label}</span><span className="whitespace-nowrap font-medium">{money ? formatMoney(r.value) : r.value}</span></div>
          <div className="mt-1 h-1.5 rounded-full bg-zinc-100"><div className="h-1.5 rounded-full bg-zinc-400" style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
