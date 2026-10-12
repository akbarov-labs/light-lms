// Uzbekistan public holidays (fixed dates) — new centers start with these so no lessons land on them.
// Movable holidays (Ramazon/Qurbon hayit) are added by the center in Settings → Holidays.
import type { ISODate } from "./dates";

const FIXED: [string, string][] = [
  ["01-01", "Yangi yil"],
  ["03-08", "Xalqaro xotin-qizlar kuni"],
  ["03-21", "Navro'z"],
  ["05-09", "Xotira va qadrlash kuni"],
  ["09-01", "Mustaqillik kuni"],
  ["10-01", "O'qituvchi va murabbiylar kuni"],
  ["12-08", "Konstitutsiya kuni"],
];

export function uzPublicHolidays(years: number[]): { date: ISODate; name: string }[] {
  return years.flatMap((y) => FIXED.map(([md, name]) => ({ date: `${y}-${md}`, name })));
}
