"use client";

import { useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import type { Copy } from "./copy";

const DEBT = 900_000;
const CHIPS = [300_000, 500_000, 900_000, 1_000_000];

const fmt = (n: number) => `${String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} so'm`;
const fill = (s: string, amount: number) => s.replace("{amount}", fmt(amount));

/** The product's core promise, playable: type an amount, see exactly what stays owed, get the receipt. */
export function PayDemo({ c, center }: { c: Copy["pay"]; center: string }) {
  const [amount, setAmount] = useState(500_000);
  const [paidAt, setPaidAt] = useState<string | null>(null);
  const rest = DEBT - amount;

  const outcome =
    amount <= 0 ? null : rest > 0 ? (
      <span className="text-red-600">{fill(c.left, rest)}</span>
    ) : rest === 0 ? (
      <span className="inline-flex items-center gap-1.5 text-emerald-700"><Check className="h-4 w-4" aria-hidden />{c.closes}</span>
    ) : (
      <span className="text-zinc-700">{fill(c.over, -rest)}</span>
    );

  const confirm = () => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    setPaidAt(`${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`);
  };

  return (
    <div className="relative w-full max-w-[440px]">
      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_24px_60px_-28px_rgb(9_9_11/0.35)]">
        <div className="flex h-12 items-center justify-between border-b border-zinc-100 px-5">
          <span className="text-[13px] font-semibold text-zinc-900">{c.title}</span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">{c.label}</span>
        </div>

        {paidAt === null ? (
          <div className="p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700" aria-hidden>HB</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-zinc-900">{c.student}</div>
                <div className="truncate text-xs text-zinc-500">{c.group}</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-zinc-500">{c.debt}</div>
                <div className="tnum text-sm font-semibold text-red-600">{fmt(DEBT)}</div>
              </div>
            </div>

            <label className="mt-5 block">
              <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-zinc-700">
                {c.amount}
                <span className="text-xs font-normal text-zinc-500">{c.hint}</span>
              </span>
              <span className="flex h-12 items-center rounded-lg border border-zinc-200 bg-white px-3 transition-[border-color,box-shadow] focus-within:border-zinc-900 focus-within:ring-[3px] focus-within:ring-zinc-900/10 hover:border-zinc-300">
                <input
                  inputMode="numeric"
                  aria-label={c.amount}
                  value={amount ? String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ") : ""}
                  onChange={(e) => setAmount(Math.min(99_999_999, Number(e.target.value.replace(/\D/g, "")) || 0))}
                  className="tnum min-w-0 flex-1 bg-transparent text-lg font-semibold text-zinc-950 outline-none"
                />
                <span className="text-sm text-zinc-500">so&apos;m</span>
              </span>
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CHIPS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmount(v)}
                  aria-pressed={amount === v}
                  className="tnum h-8 rounded-md border border-zinc-200 px-2.5 text-xs text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 aria-pressed:border-zinc-900 aria-pressed:bg-zinc-900 aria-pressed:text-white"
                >
                  {String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}
                </button>
              ))}
            </div>

            <div className="mt-5 rounded-xl bg-zinc-50 px-4 py-3">
              <div className="tnum text-[28px] font-semibold leading-tight tracking-[-0.02em] text-zinc-950">{fmt(amount)}</div>
              <div className="mt-0.5 text-[13px] text-zinc-500">{c.method} · {c.student} · {c.group}</div>
              <div className="mt-3 min-h-[20px] border-t border-zinc-200 pt-3 text-[13px] font-medium" aria-live="polite">{outcome}</div>
            </div>

            <button
              type="button"
              disabled={amount <= 0}
              onClick={confirm}
              className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-lg bg-zinc-900 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
            >
              {c.confirm}
            </button>
          </div>
        ) : (
          <div className="p-5">
            <div className="receipt-print mx-auto max-w-[300px] font-mono text-[13px] text-zinc-800">
              <div className="text-center font-bold">{center}</div>
              <div className="mt-2 border-y border-dashed border-zinc-300 py-1 text-center text-[11px] uppercase">{c.receipt}</div>
              <div className="my-3 text-center text-[22px] font-bold">{fmt(amount)}</div>
              <dl className="space-y-1">
                {[
                  [c.rows[0], paidAt],
                  [c.rows[1], c.student],
                  [c.rows[2], c.group],
                  [c.rows[3], c.method],
                  rest > 0 ? [c.newDebt, fmt(rest)] : rest < 0 ? [c.prepaid, fmt(-rest)] : [c.newDebt, c.none],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3"><dt className="text-zinc-500">{k}</dt><dd className="text-right">{v}</dd></div>
                ))}
              </dl>
              <div className="mt-3 border-t border-dashed border-zinc-300 pt-2 text-center text-[11px]">{c.thanks}</div>
            </div>
            <button
              type="button"
              onClick={() => setPaidAt(null)}
              className="mt-5 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 text-sm font-medium text-zinc-800 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {c.again}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
