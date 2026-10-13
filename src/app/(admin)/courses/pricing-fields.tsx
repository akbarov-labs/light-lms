"use client";

import { useState } from "react";

type Labels = Record<"pricingType" | "SUBSCRIPTION" | "PACKAGE" | "renewal" | "CALENDAR" | "GROUP_START" | "STUDENT_START" | "pricePerMonth" | "pricePackage" | "packageLessons" | "packageLessonsHint" | "installments" | "priceFrom" | "priceFromHint", string>;

const input =
  "block h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 transition-[border-color,box-shadow] hover:border-zinc-300 focus:border-accent focus:outline-hidden focus:ring-[3px] focus:ring-accent/15 sm:text-sm";
const label = "mb-1.5 block text-[13px] font-medium text-zinc-700";

export function PricingFields({ l, initial }: { l: Labels; initial?: { pricingType: string; price: number; renewal: string; packageLessons: number | null; installments: number; isEdit: boolean } }) {
  const [type, setType] = useState(initial?.pricingType ?? "SUBSCRIPTION");
  const [price, setPrice] = useState(String(initial?.price ?? ""));
  const priceChanged = initial?.isEdit && price.replace(/\D/g, "") !== String(initial.price);
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
      <label className="block">
        <span className={label}>{l.pricingType}</span>
        <select name="pricingType" className={input} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="SUBSCRIPTION">{l.SUBSCRIPTION}</option>
          <option value="PACKAGE">{l.PACKAGE}</option>
        </select>
      </label>
      <label className="block">
        <span className={label}>{type === "SUBSCRIPTION" ? l.pricePerMonth : l.pricePackage}</span>
        <input name="price" inputMode="numeric" required className={input} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="600 000" />
      </label>
      {priceChanged && (
        <label className="block sm:col-span-2">
          <span className={label}>{l.priceFrom}</span>
          <input type="date" name="priceFrom" className={input} />
          <span className="mt-1.5 block text-xs text-zinc-500">{l.priceFromHint}</span>
        </label>
      )}
      {type === "SUBSCRIPTION" ? (
        <label className="block sm:col-span-2">
          <span className={label}>{l.renewal}</span>
          <select name="renewal" className={input} defaultValue={initial?.renewal ?? "CALENDAR"}>
            <option value="CALENDAR">{l.CALENDAR}</option>
            <option value="GROUP_START">{l.GROUP_START}</option>
            <option value="STUDENT_START">{l.STUDENT_START}</option>
          </select>
        </label>
      ) : (
        <>
          <label className="block">
            <span className={label}>{l.packageLessons}</span>
            <input name="packageLessons" type="number" min={1} className={input} defaultValue={initial?.packageLessons ?? ""} />
            <span className="mt-1.5 block text-xs text-zinc-500">{l.packageLessonsHint}</span>
          </label>
          <label className="block">
            <span className={label}>{l.installments}</span>
            <input name="installments" type="number" min={1} max={24} className={input} defaultValue={initial?.installments ?? 1} />
          </label>
        </>
      )}
    </div>
  );
}
