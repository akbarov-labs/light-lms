import { Check, Clock3, ShieldCheck, X } from "lucide-react";

const ICON = { PRESENT: Check, ABSENT: X, LATE: Clock3, EXCUSED: ShieldCheck } as const;

/** Attendance status as a drawn icon (web); the Telegram bot keeps its own text marks. */
export function AttendanceMark({ status, label }: { status: keyof typeof ICON; label: string }) {
  const Icon = ICON[status];
  return <Icon className="h-3.5 w-3.5" aria-label={label} strokeWidth={2.25} />;
}
