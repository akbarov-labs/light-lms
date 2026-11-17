// Telegram message texts (uz / ru). Plain text with a little HTML (<b>) — the bot sends parse_mode=HTML.
import { formatDate, monthLabel, type ISODate } from "./dates";
import { formatMoney } from "./money";
import type { Locale } from "./i18n";
import { telegramDateTime } from "./env";

const m = (l: Locale, uz: string, ru: string) => (l === "ru" ? ru : uz);
const money = (n: number, l: Locale) => formatMoney(n, l === "ru" ? "сум" : "so'm");
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Unix time of a Tashkent wall-clock moment. Uzbekistan is UTC+5 all year (no DST since 1992), the
 * timezone every center uses (dates.ts TZ).
 */
export function tashkentUnix(date: ISODate, time = "12:00"): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) / 1000 - 5 * 3600;
}

/**
 * Bot API 9.5 date_time entity in HTML parse mode: Telegram shows `unix` in the reader's timezone and
 * format; `text` (the usual Tashkent text) is what older apps — and SMS, which strips tags — show.
 * Plain `text` unless TELEGRAM_DATE_TIME=true. Date-only values use noon Tashkent (format "d"), so the
 * date stays the same day from UTC−7 to UTC+12 instead of slipping to the day before west of Tashkent.
 */
export function tgTime(text: string, unix: number, format: "d" | "dt" | "wdt", on = telegramDateTime()): string {
  return on ? `<tg-time unix="${unix}" format="${format}">${text}</tg-time>` : text;
}

/** The message without date_time entities (inner text kept) — the fallback if Telegram refuses them. */
export function stripTgTime(html: string): string {
  return html.replace(/<tg-time\b[^>]*>/g, "").replace(/<\/tg-time>/g, "");
}

/** Lesson start "dd.MM.yyyy HH:mm" as a date_time entity (when on). */
export const lessonAt = (date: ISODate, time: string) => tgTime(`${formatDate(date)} ${time}`, tashkentUnix(date, time), "dt");
/** A payment date "dd.MM.yyyy" as a date_time entity (when on). */
export const dueOn = (date: ISODate) => tgTime(formatDate(date), tashkentUnix(date), "d");

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
      `🔔 <b>${esc(p.center)}</b>\n${esc(p.student)} — ${esc(p.group)}\n${dueOn(p.date)} dan yangi oy uchun to'lov: <b>${money(p.amount, l)}</b>`,
      `🔔 <b>${esc(p.center)}</b>\n${esc(p.student)} — ${esc(p.group)}\nОплата за новый месяц с ${dueOn(p.date)}: <b>${money(p.amount, l)}</b>`,
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
      `❗️ <b>${esc(p.center)}</b>\n${esc(p.student)} bugungi darsga kelmadi: ${esc(p.group)}, ${lessonAt(p.date, p.time)}`,
      `❗️ <b>${esc(p.center)}</b>\n${esc(p.student)} не пришёл(ла) на урок: ${esc(p.group)}, ${lessonAt(p.date, p.time)}`,
    ),
  trialBooked: (l: Locale, p: { center: string; student: string; group: string; date: ISODate; time: string; address: string | null }) =>
    m(
      l,
      `📌 <b>${esc(p.center)}</b>\n${esc(p.student)} sinov darsiga yozildi: ${esc(p.group)}\n${lessonAt(p.date, p.time)}${p.address ? `\nManzil: ${esc(p.address)}` : ""}`,
      `📌 <b>${esc(p.center)}</b>\n${esc(p.student)} записан(а) на пробный урок: ${esc(p.group)}\n${lessonAt(p.date, p.time)}${p.address ? `\nАдрес: ${esc(p.address)}` : ""}`,
    ),
  teacherReminder: (l: Locale, p: { lessons: string[] }) =>
    m(
      l,
      `✍️ Bugungi darslar uchun davomat belgilanmagan:\n${p.lessons.map((x) => `• ${esc(x)}`).join("\n")}`,
      `✍️ Не отмечена посещаемость за сегодня:\n${p.lessons.map((x) => `• ${esc(x)}`).join("\n")}`,
    ),
  examResult: (l: Locale, p: { center: string; student: string; exam: string; date: ISODate; score: number; maxScore: number; passed: boolean | null; level: string | null }) =>
    m(
      l,
      `📝 <b>${esc(p.center)}</b>\n${esc(p.student)} — ${esc(p.exam)} (${formatDate(p.date)})\nNatija: <b>${p.score} / ${p.maxScore}</b>${p.passed === null ? "" : p.passed ? " — o'tdi ✅" : " — o'tmadi"}${p.level ? `\nDaraja: ${esc(p.level)}` : ""}`,
      `📝 <b>${esc(p.center)}</b>\n${esc(p.student)} — ${esc(p.exam)} (${formatDate(p.date)})\nРезультат: <b>${p.score} / ${p.maxScore}</b>${p.passed === null ? "" : p.passed ? " — сдал(а) ✅" : " — не сдал(а)"}${p.level ? `\nУровень: ${esc(p.level)}` : ""}`,
    ),
  reportCard: (l: Locale, p: { center: string; student: string; group: string; month: string; attendancePct: number | null; gradeAvg: number | null; url: string }) =>
    m(
      l,
      `📘 <b>${esc(p.center)}</b>\n${esc(p.student)} — ${esc(p.group)}\n${monthLabel(p.month, "uz")} oyi hisoboti${p.attendancePct !== null ? `\nDavomat: ${p.attendancePct}%` : ""}${p.gradeAvg !== null ? `\nO'rtacha baho: ${p.gradeAvg}` : ""}\n${p.url}`,
      `📘 <b>${esc(p.center)}</b>\n${esc(p.student)} — ${esc(p.group)}\nТабель за ${monthLabel(p.month, "ru").toLowerCase()}${p.attendancePct !== null ? `\nПосещаемость: ${p.attendancePct}%` : ""}${p.gradeAvg !== null ? `\nСредний балл: ${p.gradeAvg}` : ""}\n${p.url}`,
    ),
};
