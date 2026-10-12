import { formatMoney } from "@/lib/money";

/** Minimal responsive SVG column chart (no client JS). Values are UZS. */
export function BarChart({ data, height = 180 }: { data: { label: string; value: number }[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / Math.max(1, data.length);
  const short = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v));
  return (
    <svg viewBox={`0 0 100 ${height / 3}`} className="h-auto w-full" role="img" preserveAspectRatio="none" style={{ height }}>
      {data.map((d, i) => {
        const h = Math.max(0, (d.value / max) * (height / 3 - 12));
        const x = i * w + w * 0.18;
        const y = height / 3 - 6 - h;
        return (
          <g key={`${i}-${d.label}`}>
            <title>{`${d.label}: ${formatMoney(d.value)}`}</title>
            <rect x={x} y={y} width={w * 0.64} height={h} rx={0.8} className="fill-accent/80" />
            <text x={x + w * 0.32} y={Math.max(4, y - 1.2)} textAnchor="middle" className="fill-zinc-600" style={{ fontSize: 2.6 }}>{short(d.value)}</text>
            <text x={x + w * 0.32} y={height / 3 - 1.5} textAnchor="middle" className="fill-zinc-500" style={{ fontSize: 2.6 }}>{d.label}</text>
          </g>
        );
      })}
    </svg>
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
          <div className="mt-1 h-1.5 rounded-full bg-zinc-100"><div className="h-1.5 rounded-full bg-accent/70" style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
