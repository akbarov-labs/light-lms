// The exam results form → rows for saveResults (src/lib/services/exams.ts).
import type { ResultRow } from "@/lib/services/exams";

/** Fields: `<s|l>:<id>:total`, `<s|l>:<id>:sec:<i>`, `<s|l>:<id>:comment` (s = student, l = lead). */
export function parseResultForm(fd: FormData): ResultRow[] {
  const rows = new Map<string, ResultRow>();
  const num = (v: FormDataEntryValue) => {
    const s = String(v).trim().replace(",", ".");
    return s === "" ? null : Number(s);
  };
  for (const [key, value] of fd.entries()) {
    const m = /^([sl]):([A-Za-z0-9_-]{1,64}):(total|comment|sec:(\d{1,2}))$/.exec(key);
    if (!m) continue;
    const k = `${m[1]}:${m[2]}`;
    const row = rows.get(k) ?? (m[1] === "s" ? { studentId: m[2], sections: [] } : { leadId: m[2], sections: [] });
    if (m[3] === "total") row.total = num(value);
    else if (m[3] === "comment") row.comment = String(value);
    else row.sections![Number(m[4])] = num(value);
    rows.set(k, row);
  }
  return [...rows.values()].slice(0, 1000);
}
