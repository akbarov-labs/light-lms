"use client";

import { useState } from "react";
import { Input } from "@/components/fields";
import { formatDate, monthRange, shiftMonth } from "@/lib/dates";

/**
 * "Valid from" date of a salary rule. A rule applies to whole months (the rule valid on the 1st
 * decides the month), so a date that is not the 1st gets a note saying when it really starts.
 * `warning` carries a "{date}" placeholder.
 */
export function RuleDateField({ defaultValue, warning }: { defaultValue: string; warning: string }) {
  const [value, setValue] = useState(defaultValue);
  const midMonth = /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.endsWith("-01");
  return (
    <>
      <Input type="date" name="validFrom" value={value} onChange={(e) => setValue(e.target.value)} required />
      {midMonth && (
        <span className="mt-1 block text-xs text-amber-700" role="status">
          {warning.replace("{date}", formatDate(monthRange(shiftMonth(value.slice(0, 7), 1)).start))}
        </span>
      )}
    </>
  );
}
