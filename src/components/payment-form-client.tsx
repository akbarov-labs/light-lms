"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { takePaymentAction } from "@/app/(admin)/payments/actions";
import { MoneyInput } from "./client";
import { buttonClass, cx } from "./ui";

export interface PayOption {
  id: string;
  label: string;
  who: string;
  debt: number;
}

type Labels = Record<"amount" | "method" | "date" | "forGroup" | "anyGroup" | "note" | "continue" | "confirm" | "edit" | "confirmTitle" | "debtNow" | "family", string> & { methods: Record<"CASH" | "CARD" | "TRANSFER", string> };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cx(buttonClass("primary"), "w-full sm:w-auto")}>
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {label}
    </button>
  );
}

const field = "block w-full h-9 rounded-lg border border-zinc-200 bg-white px-3 text-base sm:text-sm text-zinc-900 hover:border-zinc-300 focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15";

/** Take a payment in two steps: fill (pre-filled with this student's debt), then confirm the summary. */
export function PaymentFormClient({ familyId, studentId, options, defaultOption, familyDebt, familyWho, today, labels }: { familyId: string; studentId?: string; options: PayOption[]; defaultOption: string; familyDebt: number; familyWho: string; today: string; labels: Labels }) {
  const [state, action] = useActionState(takePaymentAction, null);
  const [step, setStep] = useState<"fill" | "confirm">("fill");
  const [opt, setOpt] = useState(defaultOption);
  const chosen = options.find((o) => o.id === opt);
  const suggested = chosen ? chosen.debt : familyDebt;
  const [amount, setAmount] = useState(suggested);
  const [amountKey, setAmountKey] = useState(0);
  const [method, setMethod] = useState<"CASH" | "CARD" | "TRANSFER">("CASH");
  const [date, setDate] = useState(today);
  const who = chosen ? chosen.who : `${familyWho} (${labels.family})`;
  const debtNow = useMemo(() => (chosen ? chosen.debt : familyDebt), [chosen, familyDebt]);

  return (
    <form action={action} className="space-y-4" onSubmit={(e) => { if (step === "fill") { e.preventDefault(); if (amount > 0) setStep("confirm"); } }}>
      <input type="hidden" name="familyId" value={familyId} />
      {studentId && <input type="hidden" name="studentId" value={studentId} />}
      <input type="hidden" name="enrollmentId" value={opt} />
      <input type="hidden" name="method" value={method} />
      <input type="hidden" name="date" value={date} />
      <div className={cx("space-y-4", step === "confirm" && "hidden")}>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{labels.forGroup}</span>
          <select
            className={field}
            value={opt}
            onChange={(e) => {
              setOpt(e.target.value);
              const next = options.find((o) => o.id === e.target.value);
              setAmount(next ? next.debt : familyDebt);
              setAmountKey((k) => k + 1);
            }}
          >
            <option value="">{labels.anyGroup}{familyDebt > 0 ? ` · ${formatMoney(familyDebt)}` : ""}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}{o.debt > 0 ? ` · ${formatMoney(o.debt)}` : ""}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.4fr_1fr]">
          <label className="block">
            <span className="mb-1.5 flex justify-between text-[13px] font-medium text-zinc-700">
              {labels.amount}
              {debtNow > 0 && <span className="tnum font-normal text-zinc-500">{labels.debtNow}: <span className="text-red-600">{formatMoney(debtNow)}</span></span>}
            </span>
            <MoneyInput key={amountKey} name="amount" defaultValue={amount > 0 ? amount : ""} onValue={setAmount} required autoFocus />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{labels.date}</span>
            <input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
        </div>
        <fieldset>
          <legend className="mb-1.5 block text-[13px] font-medium text-zinc-700">{labels.method}</legend>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-1">
            {(["CASH", "CARD", "TRANSFER"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} className={cx("h-8 rounded-md text-[13px] font-medium transition-colors", method === m ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-900")}>
                {labels.methods[m]}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{labels.note}</span>
          <input name="note" className={field} />
        </label>
        <button type="submit" disabled={amount <= 0} className={cx(buttonClass("primary"), "w-full sm:w-auto")}>{labels.continue}</button>
      </div>
      {step === "confirm" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-zinc-50 p-4">
            <div className="text-[13px] text-zinc-500">{labels.confirmTitle}</div>
            <div className="tnum mt-1 text-[28px] font-semibold tracking-[-0.02em] text-zinc-950">{formatMoney(amount)}</div>
            <div className="mt-1 text-sm text-zinc-600">{labels.methods[method]} · {who} · {date.split("-").reverse().join(".")}</div>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" onClick={() => setStep("fill")} className={cx(buttonClass("secondary"), "w-full sm:w-auto")}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              {labels.edit}
            </button>
            <Submit label={labels.confirm} />
          </div>
        </div>
      )}
      {state?.error && (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {state.error}
        </p>
      )}
    </form>
  );
}
