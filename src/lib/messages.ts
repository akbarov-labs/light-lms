// Telegram message texts (uz / ru). Plain text with a little HTML (<b>) — the bot sends parse_mode=HTML.
import { formatDate, monthLabel, type ISODate } from "./dates";
import { formatMoney } from "./money";
import type { Locale } from "./i18n";

const m = (l: Locale, uz: string, ru: string) => (l === "ru" ? ru : uz);
const money = (n: number, l: Locale) => formatMoney(n, l === "ru" ? "сум" : "so'm");
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function payLine(l: Locale, url: string | null): string {
  return url ? `\n\n${m(l, "To'lash", "Оплатить")}: ${url}` : "";
}

export const msg = {
  paymentReceived: (l: Locale, p: { center: string; student: string; amount: number; balance: number; date: ISODate }) =>
    m(
      l,
      `✅ <b>${esc(p.center)}</b>\nTo'lov qabul qilindi: <b>${money(p.amount, l)}</b> (${formatDate(p.date)})\nO'quvchi: ${esc(p.student)}\nBalans: ${money(p.balance, l)}`,
      `✅ <b>${esc(p.center)}</b>\nОплата получена: <b>${money(p.amount, l)}</b> (${formatDate(p.date)})\nУченик: ${esc(p.student)}\nБаланс: ${money(p.balance, l)}`,
    ),
  reminder: (l: Locale, p: { center: string; student: string; group: string; amount: number; date: ISODate; payUrl: string | null }) =>
    m(
      l,
      `🔔 <b>${esc(p.center)}</b>\n${esc(p.student)} — ${esc(p.group)}\n${formatDate(p.date)} dan yangi oy uchun to'lov: <b>${money(p.amount, l)}</b>`,
      `🔔 <b>${esc(p.center)}</b>\n${esc(p.student)} — ${esc(p.group)}\nОплата за новый месяц с ${formatDate(p.date)}: <b>${money(p.amount, l)}</b>`,
    ) + payLine(l, p.payUrl),
  debt: (l: Locale, p: { center: string; debt: number; payUrl: string | null }) =>
    m(
      l,
      `⚠️ <b>${esc(p.center)}</b>\nSizda qarzdorlik bor: <b>${money(p.debt, l)}</b>. Iltimos, to'lovni amalga oshiring.`,
      `⚠️ <b>${esc(p.center)}</b>\nУ вас задолженность: <b>${money(p.debt, l)}</b>. Пожалуйста, оплатите.`,
    ) + payLine(l, p.payUrl),
  absent: (l: Locale, p: { center: string; student: string; group: string; date: ISODate; time: string }) =>
    m(
      l,
      `❗️ <b>${esc(p.center)}</b>\n${esc(p.student)} bugungi darsga kelmadi: ${esc(p.group)}, ${formatDate(p.date)} ${p.time}`,
      `❗️ <b>${esc(p.center)}</b>\n${esc(p.student)} не пришёл(ла) на урок: ${esc(p.group)}, ${formatDate(p.date)} ${p.time}`,
    ),
  trialBooked: (l: Locale, p: { center: string; student: string; group: string; date: ISODate; time: string; address: string | null }) =>
    m(
      l,
      `📌 <b>${esc(p.center)}</b>\n${esc(p.student)} sinov darsiga yozildi: ${esc(p.group)}\n${formatDate(p.date)} ${p.time}${p.address ? `\nManzil: ${esc(p.address)}` : ""}`,
      `📌 <b>${esc(p.center)}</b>\n${esc(p.student)} записан(а) на пробный урок: ${esc(p.group)}\n${formatDate(p.date)} ${p.time}${p.address ? `\nАдрес: ${esc(p.address)}` : ""}`,
    ),
  teacherReminder: (l: Locale, p: { lessons: string[] }) =>
    m(
      l,
      `✍️ Bugungi darslar uchun davomat belgilanmagan:\n${p.lessons.map((x) => `• ${esc(x)}`).join("\n")}`,
      `✍️ Не отмечена посещаемость за сегодня:\n${p.lessons.map((x) => `• ${esc(x)}`).join("\n")}`,
    ),
  reportCard: (l: Locale, p: { center: string; student: string; group: string; month: string; attendancePct: number | null; gradeAvg: number | null; url: string }) =>
    m(
      l,
      `📘 <b>${esc(p.center)}</b>\n${esc(p.student)} — ${esc(p.group)}\n${monthLabel(p.month, "uz")} oyi hisoboti${p.attendancePct !== null ? `\nDavomat: ${p.attendancePct}%` : ""}${p.gradeAvg !== null ? `\nO'rtacha baho: ${p.gradeAvg}` : ""}\n${p.url}`,
      `📘 <b>${esc(p.center)}</b>\n${esc(p.student)} — ${esc(p.group)}\nТабель за ${monthLabel(p.month, "ru").toLowerCase()}${p.attendancePct !== null ? `\nПосещаемость: ${p.attendancePct}%` : ""}${p.gradeAvg !== null ? `\nСредний балл: ${p.gradeAvg}` : ""}\n${p.url}`,
    ),
};
