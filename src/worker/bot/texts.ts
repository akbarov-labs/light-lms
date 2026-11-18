// Bot texts (uz / ru). Button labels are matched in both languages.
import { HOMEWORK_BTN } from "@/lib/homework/texts";

export const B = {
  welcome: {
    uz: "Assalomu alaykum! O'quv markazingiz botiga xush kelibsiz.\nDavom etish uchun telefon raqamingizni yuboring 👇",
    ru: "Здравствуйте! Добро пожаловать в бот учебного центра.\nЧтобы продолжить, отправьте свой номер телефона 👇",
  },
  shareContact: { uz: "📱 Raqamni yuborish", ru: "📱 Отправить номер" },
  ownContact: { uz: "Iltimos, o'zingizning raqamingizni tugma orqali yuboring.", ru: "Пожалуйста, отправьте свой номер кнопкой." },
  notFound: {
    uz: "Raqamingiz topilmadi, o'quv markazingiz administratoriga murojaat qiling.",
    ru: "Ваш номер не найден, обратитесь к администратору учебного центра.",
  },
  linked: { uz: "✅ Ulandingiz! Menyudan kerakli bo'limni tanlang.", ru: "✅ Готово! Выберите раздел в меню." },
  resetCode: {
    uz: "🔐 Parolni tiklash kodi: <b>{code}</b>\nKod 10 daqiqa amal qiladi. Uni saytdagi «Parolni unutdingizmi?» → «Kodim bor» sahifasida kiriting.\nKodni hech kimga bermang.",
    ru: "🔐 Код для сброса пароля: <b>{code}</b>\nКод действует 10 минут. Введите его на сайте: «Забыли пароль?» → «У меня есть код».\nНикому не сообщайте код.",
  },
  resetNotStaff: {
    uz: "Bu buyruq faqat markaz xodimlari uchun (yoki so'rovlar soni oshib ketdi — 1 soatdan keyin urinib ko'ring).",
    ru: "Команда только для сотрудников центра (или превышен лимит запросов — попробуйте через час).",
  },
  notLinked: { uz: "Avval /start bosing va raqamingizni yuboring.", ru: "Сначала нажмите /start и отправьте номер." },
  balanceBtn: { uz: "💰 Balans", ru: "💰 Баланс" },
  scheduleBtn: { uz: "📅 Jadval", ru: "📅 Расписание" },
  attendanceBtn: { uz: "✅ Davomat", ru: "✅ Посещаемость" },
  paymentsBtn: { uz: "🧾 To'lovlar", ru: "🧾 Платежи" },
  centerBtn: { uz: "ℹ️ Markaz", ru: "ℹ️ Центр" },
  todayBtn: { uz: "📚 Bugungi darslar", ru: "📚 Уроки сегодня" },
  salaryBtn: { uz: "💵 Oylik", ru: "💵 Зарплата" },
  weekBtn: { uz: "📅 Hafta jadvali", ru: "📅 Расписание недели" },
  reportBtn: { uz: "📊 Hisobot", ru: "📊 Отчёт" },
  homeworkBtn: HOMEWORK_BTN,
  hwNone: { uz: "Hozir ochiq uy vazifasi yo'q. Yangi vazifa berilganda xabar keladi.", ru: "Сейчас открытых домашних заданий нет. Когда зададут новое, придёт сообщение." },
  hwListTitle: { uz: "Ochiq uy vazifalari", ru: "Открытые домашние задания" },
  hwAnswered: { uz: "Javob berilgan: {a}/{n}", ru: "Отвечено: {a}/{n}" },
  hwDue: { uz: "Muddat: {due}", ru: "Срок: {due}" },
  hwDueNext: { uz: "keyingi darsgacha", ru: "до следующего урока" },
  hwQuestion: { uz: "{i}-savol ({i}/{n})", ru: "Вопрос {i} из {n}" },
  hwTypeNumber: { uz: "Javobni son bilan yozing: masalan -4, 2.5 yoki 3/4.", ru: "Напишите ответ числом: например -4, 2.5 или 3/4." },
  hwTapLetter: { uz: "To'g'ri javob harfini bosing.", ru: "Нажмите букву правильного ответа." },
  hwCurrent: { uz: "Hozirgi javob: {a}", ru: "Текущий ответ: {a}" },
  hwPrev: { uz: "◀ Oldingi", ru: "◀ Назад" },
  hwSkip: { uz: "O'tkazish ▶", ru: "Пропустить ▶" },
  hwAll: { uz: "📋 Barcha javoblar", ru: "📋 Все ответы" },
  hwSummary: { uz: "Javoblaringiz ({a}/{n})", ru: "Ваши ответы ({a}/{n})" },
  hwSummaryHint: {
    uz: "✅ Hammasi saqlangan. {due} gacha o'zgartirish mumkin: savol raqamini bosing.\nNatijani o'qituvchi keyingi darsda ko'rsatadi.",
    ru: "✅ Всё сохранено. Изменить можно до {due}: нажмите номер вопроса.\nРезультаты учитель покажет на следующем уроке.",
  },
  hwBadNumber: { uz: "Bu savolga son yozing: masalan -4, 2.5 yoki 3/4.", ru: "На этот вопрос напишите число: например -4, 2.5 или 3/4." },
  hwBadLetter: { uz: "Bu savolda harflardan birini bosing yoki yozing: {letters}.", ru: "В этом вопросе нажмите или напишите одну из букв: {letters}." },
  hwClosed: { uz: "⏰ Javob berish muddati tugagan.", ru: "⏰ Срок ответов истёк." },
  balance: { uz: "Oila balansi", ru: "Баланс семьи" },
  charged: { uz: "hisoblangan", ru: "начислено" },
  paid: { uz: "to'langan", ru: "оплачено" },
  debt: { uz: "qarz", ru: "долг" },
  nextCharge: { uz: "Keyingi to'lov", ru: "Следующая оплата" },
  pay: { uz: "To'lash (Payme)", ru: "Оплатить (Payme)" },
  schedule: { uz: "Keyingi 7 kun", ru: "Ближайшие 7 дней" },
  attendance: { uz: "Davomat, kun", ru: "Посещаемость, дней" },
  payments: { uz: "Oxirgi to'lovlar", ru: "Последние платежи" },
  none: { uz: "yo'q", ru: "нет" },
  week: { uz: "Hafta jadvali", ru: "Расписание недели" },
  noLessons: { uz: "Bugun darslaringiz yo'q.", ru: "Сегодня у вас нет уроков." },
  pickLesson: { uz: "Darsni tanlang:", ru: "Выберите урок:" },
  rosterHint: { uz: "Holatni o'zgartirish uchun o'quvchini bosing, keyin «Saqlash».", ru: "Нажмите на ученика, чтобы сменить статус, затем «Сохранить»." },
  save: { uz: "💾 Saqlash", ru: "💾 Сохранить" },
  saved: { uz: "✅ Davomat saqlandi.", ru: "✅ Посещаемость сохранена." },
  noStudents: { uz: "Bu darsda o'quvchi yo'q.", ru: "На этом уроке нет учеников." },
  salaryNow: { uz: "Shu oy hozircha", ru: "В этом месяце пока" },
  lastPayslip: { uz: "Oxirgi oylik", ru: "Последняя зарплата" },
  lang: { uz: "Til o'zgartirildi: O'zbekcha", ru: "Язык изменён: Русский" },
  forbidden: { uz: "Ruxsat yo'q.", ru: "Нет доступа." },
  answerSent: {
    uz: "✅ Javobingiz mijozga yuborildi. Mijoz yozsa, AI yordamchi suhbatni shundan davom ettiradi.",
    ru: "✅ Ответ отправлен клиенту. Когда клиент ответит, AI-помощник продолжит разговор с учётом вашего ответа.",
  },
  // a center's own bot (managed bots), created from the shared bot
  nbAsk: {
    uz: "🤖 <b>{center}</b> uchun o'z botingizni yaratamiz.\nPastdagi tugmani bosing: Telegram oynasida bot nomi va manzilini tekshirib, «Yaratish»ni bosing. Bot sizniki bo'ladi, uni biz boshqaramiz.",
    ru: "🤖 Создадим собственный бот для <b>{center}</b>.\nНажмите кнопку ниже: в окне Telegram проверьте имя и адрес бота и нажмите «Создать». Бот будет вашим, управлять им будем мы.",
  },
  nbButton: { uz: "🤖 Botni yaratish", ru: "🤖 Создать бота" },
  nbExpired: {
    uz: "Bu havola eskirgan. Sozlamalar → Telegram bot sahifasida «Bot yaratish»ni qayta bosing.",
    ru: "Ссылка устарела. Нажмите «Создать бота» ещё раз в Настройки → Telegram-бот.",
  },
  nbNotOwner: {
    uz: "Botni faqat markaz egasi yaratadi. Avval shu botga o'z raqamingizni yuboring (/start), keyin havolani qayta oching.",
    ru: "Создать бота может только владелец центра. Сначала отправьте этому боту свой номер (/start), затем откройте ссылку снова.",
  },
  nbHasBot: { uz: "Markazingizda bot allaqachon bor.", ru: "У вашего центра уже есть бот." },
  nbOff: { uz: "O'z boti bu markaz uchun yoqilmagan.", ru: "Собственный бот для этого центра не включён." },
  nbReady: {
    uz: "✅ @{bot} tayyor! Hozircha uni faqat siz ko'rasiz: oching, tekshiring, keyin Sozlamalar → Telegram bot sahifasida «Ishga tushirish»ni bosing.",
    ru: "✅ @{bot} готов! Пока его видите только вы: откройте, проверьте, затем нажмите «Запустить» в Настройки → Telegram-бот.",
  },
  nbIgnored: {
    uz: "Bot yaratildi, lekin markazga ulanmadi (havola eskirgan bo'lishi mumkin). Sozlamalardan qayta urinib ko'ring.",
    ru: "Бот создан, но не подключён к центру (возможно, ссылка устарела). Попробуйте снова из настроек.",
  },
  answerNotFound: { uz: "Bu mijozning suhbati topilmadi. Lead sahifasidan yozing.", ru: "Разговор с этим клиентом не найден. Напишите со страницы лида." },
  days: {
    uz: ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"],
    ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  },
  status: {
    uz: { PRESENT: "✓ keldi", ABSENT: "✗ kelmadi", LATE: "⏱ kechikdi", EXCUSED: "E sababli" },
    ru: { PRESENT: "✓ был", ABSENT: "✗ не был", LATE: "⏱ опоздал", EXCUSED: "E уваж." },
  },
} as const;

export type BotLocale = "uz" | "ru";

/** Which button was pressed, whatever the language. */
export function buttonKey(text: string): keyof typeof B | null {
  const keys = ["balanceBtn", "scheduleBtn", "attendanceBtn", "paymentsBtn", "centerBtn", "todayBtn", "salaryBtn", "weekBtn", "reportBtn", "homeworkBtn"] as const;
  for (const k of keys) if (B[k].uz === text || B[k].ru === text) return k;
  return null;
}
