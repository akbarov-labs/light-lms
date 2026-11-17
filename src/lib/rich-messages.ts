// Rich-message forms (Bot API 10.1 sendRichMessage, "Rich HTML style") of the long parent messages in
// messages.ts: a heading, short paragraphs and compact tables. Same words as the plain texts; the plain
// text is always queued too and is what goes out when TELEGRAM_RICH_MESSAGES is off or Telegram refuses
// the rich form. Rich HTML accepts only &lt; &gt; &amp; &quot; … as named entities — esc() produces those.
import { formatDate, monthLabel, type ISODate } from "./dates";
import { formatMoney } from "./money";
import type { Locale } from "./i18n";
import { esc } from "./messages";

const m = (l: Locale, uz: string, ru: string) => (l === "ru" ? ru : uz);
const money = (n: number, l: Locale) => formatMoney(n, l === "ru" ? "сум" : "so'm");

/** One compact two-column table (label | value); rows with a null value are left out. Values are HTML. */
export function richTable(rows: [label: string, valueHtml: string | null][]): string {
  const kept = rows.filter((r): r is [string, string] => r[1] !== null);
  if (kept.length === 0) return "";
  return `<table bordered compact>${kept.map(([k, v]) => `<tr><td>${esc(k)}</td><td align="right">${v}</td></tr>`).join("")}</table>`;
}

const pay = (l: Locale, url: string | null) => (url ? `<p>${m(l, "To'lash", "Оплатить")}: ${esc(url)}</p>` : "");

export const richMsg = {
  paymentReceived: (l: Locale, p: { center: string; student: string; amount: number; balance: number; date: ISODate }) =>
    `<h3>✅ ${esc(p.center)}</h3>` +
    `<p>${m(l, "To'lov qabul qilindi", "Оплата получена")}: <b>${money(p.amount, l)}</b> (${formatDate(p.date)})</p>` +
    richTable([
      [m(l, "O'quvchi", "Ученик"), esc(p.student)],
      [m(l, "Balans", "Баланс"), money(p.balance, l)],
    ]),
  reminder: (l: Locale, p: { center: string; student: string; group: string; amount: number; date: ISODate; payUrl: string | null }) =>
    `<h3>🔔 ${esc(p.center)}</h3>` +
    `<p>${esc(p.student)} — ${esc(p.group)}</p>` +
    `<p>${m(l, `${formatDate(p.date)} dan yangi oy uchun to'lov`, `Оплата за новый месяц с ${formatDate(p.date)}`)}: <b>${money(p.amount, l)}</b></p>` +
    pay(l, p.payUrl),
  debt: (l: Locale, p: { center: string; debt: number; payUrl: string | null }) =>
    `<h3>⚠️ ${esc(p.center)}</h3>` +
    `<p>${m(l, `Sizda qarzdorlik bor: <b>${money(p.debt, l)}</b>. Iltimos, to'lovni amalga oshiring.`, `У вас задолженность: <b>${money(p.debt, l)}</b>. Пожалуйста, оплатите.`)}</p>` +
    pay(l, p.payUrl),
  reportCard: (l: Locale, p: { center: string; student: string; group: string; month: string; attendancePct: number | null; gradeAvg: number | null; url: string }) =>
    `<h3>📘 ${esc(p.center)}</h3>` +
    `<p><b>${esc(p.student)}</b> — ${esc(p.group)}</p>` +
    `<h4>${m(l, `${monthLabel(p.month, "uz")} oyi hisoboti`, `Табель за ${monthLabel(p.month, "ru").toLowerCase()}`)}</h4>` +
    richTable([
      [m(l, "Davomat", "Посещаемость"), p.attendancePct !== null ? `${p.attendancePct}%` : null],
      [m(l, "O'rtacha baho", "Средний балл"), p.gradeAvg !== null ? String(p.gradeAvg) : null],
    ]) +
    `<p>${esc(p.url)}</p>`,
};

/** The bot's "✅ Davomat" reply as a rich message: one heading + compact table per child. */
export interface AttendanceSummary {
  title: string;
  children: { name: string; present: number; total: number; rows: { date: string; mark: string; grade: number | null; group: string }[] }[];
}

export function richAttendance(s: AttendanceSummary): string {
  let out = `<h3>${esc(s.title)}</h3>`;
  for (const c of s.children) {
    out += `<h4>👤 ${esc(c.name)} — ${c.present}/${c.total}</h4>`;
    if (c.rows.length === 0) continue;
    const grades = c.rows.some((r) => r.grade !== null);
    out +=
      `<table bordered striped compact>` +
      c.rows.map((r) => `<tr><td>${esc(r.date)}</td><td align="center">${esc(r.mark)}</td>${grades ? `<td align="center">${r.grade ?? ""}</td>` : ""}<td>${esc(r.group)}</td></tr>`).join("") +
      `</table>`;
  }
  return out;
}
