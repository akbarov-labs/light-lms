// Strings for the first pilot's needs: billing months from a chosen day, daily debt reminders, owner-only
// discounts, Paynet. Spread into uz.ts / ru.ts.
export const pilotUz = {
  "courses.renewalDay": "Oy qaysi kundan boshlanadi",
  "courses.renewalDayHint": "1 = oddiy oy. 15 = har oyning 15-sanasidan keyingi oyning 14-sanasigacha; to'lov ham 15-sanada yoziladi.",
  "courses.fromDay": "har oy {d}-sanadan",
  "perm.discounts": "Chegirma va maxsus narx",
  "reports.attendanceToday": "Bugun darsda: {came} keldi, {absent} kelmadi",
  "reports.trialsToday": "Sinov darsiga keldi: {n}",
  "reports.homeworkToday": "Uy vazifasini tekshirtirdi: {n}",
  "settings.notify.debtDaily": "Qarzdorlarga har kuni muloyim eslatma (SMS faqat 3, 7, 14, 30-kunlari)",
};

export const pilotRu: Record<keyof typeof pilotUz, string> = {
  "courses.renewalDay": "С какого числа начинается месяц",
  "courses.renewalDayHint": "1 = обычный месяц. 15 = с 15-го по 14-е следующего месяца; оплата начисляется 15-го.",
  "courses.fromDay": "каждый месяц с {d}-го",
  "perm.discounts": "Скидки и особая цена",
  "reports.attendanceToday": "Сегодня на уроках: пришли {came}, не пришли {absent}",
  "reports.trialsToday": "Пришли на пробный урок: {n}",
  "reports.homeworkToday": "Проверили домашнее задание: {n}",
  "settings.notify.debtDaily": "Должникам вежливое напоминание каждый день (SMS только на 3, 7, 14, 30-й день)",
};
