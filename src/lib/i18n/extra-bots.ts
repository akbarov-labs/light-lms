// Strings for a center's own Telegram bot (managed bots, docs/TELEGRAM-MANAGED-BOTS.md). Spread into uz.ts / ru.ts.
export const botsUz = {
  "settings.telegramBot": "Telegram bot",
  "ownBot.title": "O'z Telegram botingiz",
  "ownBot.intro":
    "Ota-onalar markazingiz nomi va rasmi bilan botdan foydalanadi. Bot Telegram'da sizniki bo'ladi, uni biz boshqaramiz: jadval, to'lovlar, xabarlar, davomat va AI yordamchi xuddi hozirgidek ishlaydi. Botda faqat sizning markazingiz ma'lumotlari ko'rinadi.",
  "ownBot.notAllowed": "O'z boti — qo'shimcha xizmat. Yoqish uchun biz bilan bog'laning.",
  "ownBot.ownerOnly": "Botni faqat markaz egasi yaratadi va boshqaradi.",
  "ownBot.create": "Bot yaratish",
  "ownBot.createHint":
    "Tugma Telegram'da bizning botimizni ochadi. U yerda «Botni yaratish»ni bosing — bot nomi va manzilini o'zingiz tanlaysiz. Havola 10 daqiqa amal qiladi. Avval botimizga o'z raqamingizni yuborgan bo'lishingiz kerak.",
  "ownBot.link": "Bot",
  "ownBot.status": "Holati",
  "ownBot.status.TESTING": "Sinovda",
  "ownBot.status.ACTIVE": "Ishlayapti",
  "ownBot.status.PAUSED": "To'xtatilgan",
  "ownBot.status.GONE": "Uzilgan",
  "ownBot.testingHint":
    "Hozir botni faqat siz ko'rasiz. Oching, menyu va AI yordamchini tekshiring, keyin «Ishga tushirish»ni bosing: bot hamma uchun ochiladi va markaz xabarlari u orqali boradi.",
  "ownBot.launch": "Ishga tushirish",
  "ownBot.activeHint":
    "Botni ochgan ota-onalar va xodimlar xabarlarni shu botdan oladi. Hali ochmaganlar umumiy botdan olishda davom etadi — hech bir xabar yo'qolmaydi. Raqamini avval yuborganlar qayta yubormaydi.",
  "ownBot.started": "Botni ochganlar",
  "ownBot.pause": "To'xtatish",
  "ownBot.pauseConfirm": "Botni to'xtatasizmi? Xabarlar umumiy bot orqali boradi.",
  "ownBot.resume": "Qayta yoqish",
  "ownBot.pausedHint": "Bot to'xtatilgan: xabarlar umumiy bot orqali boradi. Bot Telegram'da sizniki bo'lib qoladi.",
  "ownBot.goneHint":
    "Botga ulanib bo'lmadi (o'chirilgan yoki boshqaruv olib tashlangan). Xabarlar umumiy bot orqali boradi. Yangi bot yaratishingiz mumkin.",
  "ownBot.lastError": "Sabab",
  "ownBot.tellFamilies": "Ota-onalarga xabar berish",
  "ownBot.tellFamiliesHint": "Botni hali ochmagan ota-onalarga umumiy bot orqali yangi bot havolasi bilan bitta xabar yuboriladi. Qayta bossangiz, takror yuborilmaydi.",
  "ownBot.told": "{n} ta xabar navbatga qo'yildi.",
  "ownBot.wrongState": "Bu amal botning hozirgi holatida mumkin emas. Sahifani yangilang.",
  "ownBot.telegramFailed": "Telegram so'rovni rad etdi. Birozdan keyin qayta urinib ko'ring.",
  "ownBot.movedMessage": "📣 <b>{center}</b> endi o'z Telegram botiga ega: {bot}\nJadval, to'lovlar va xabarlar endi o'sha yerda. Botni ochib /start bosing.",
  "platform.ownBot": "O'z boti",
  "platform.ownBotText":
    "Markaz o'z Telegram botini yarata oladi (Sozlamalar → Telegram bot). Ruxsat olinsa, bot to'xtaydi va xabarlar umumiy bot orqali boradi.",
  "platform.ownBotAllow": "Ruxsat berish",
  "platform.ownBotRevoke": "Ruxsatni olish",
};

export const botsRu: Record<keyof typeof botsUz, string> = {
  "settings.telegramBot": "Telegram-бот",
  "ownBot.title": "Собственный Telegram-бот",
  "ownBot.intro":
    "Родители пользуются ботом с названием и аватаром вашего центра. Бот в Telegram принадлежит вам, управляем им мы: расписание, платежи, уведомления, посещаемость и AI-помощник работают как сейчас. В боте видны только данные вашего центра.",
  "ownBot.notAllowed": "Собственный бот — дополнительная услуга. Чтобы включить, свяжитесь с нами.",
  "ownBot.ownerOnly": "Создавать бота и управлять им может только владелец центра.",
  "ownBot.create": "Создать бота",
  "ownBot.createHint":
    "Кнопка откроет наш бот в Telegram. Там нажмите «Создать бота» — имя и адрес бота выбираете сами. Ссылка действует 10 минут. Сначала нужно отправить нашему боту свой номер.",
  "ownBot.link": "Бот",
  "ownBot.status": "Статус",
  "ownBot.status.TESTING": "Проверка",
  "ownBot.status.ACTIVE": "Работает",
  "ownBot.status.PAUSED": "Остановлен",
  "ownBot.status.GONE": "Отключён",
  "ownBot.testingHint":
    "Сейчас бот видите только вы. Откройте его, проверьте меню и AI-помощника, затем нажмите «Запустить»: бот откроется для всех, и уведомления центра пойдут через него.",
  "ownBot.launch": "Запустить",
  "ownBot.activeHint":
    "Родители и сотрудники, открывшие бот, получают уведомления в нём. Те, кто ещё не открыл, получают их в общем боте — ни одно сообщение не теряется. Кто уже отправлял номер, повторно не отправляет.",
  "ownBot.started": "Открыли бот",
  "ownBot.pause": "Остановить",
  "ownBot.pauseConfirm": "Остановить бота? Уведомления пойдут через общий бот.",
  "ownBot.resume": "Включить снова",
  "ownBot.pausedHint": "Бот остановлен: уведомления идут через общий бот. Бот в Telegram остаётся вашим.",
  "ownBot.goneHint":
    "Не удалось подключиться к боту (удалён или управление снято). Уведомления идут через общий бот. Можно создать нового бота.",
  "ownBot.lastError": "Причина",
  "ownBot.tellFamilies": "Сообщить родителям",
  "ownBot.tellFamiliesHint": "Родителям, которые ещё не открыли бот, через общий бот уйдёт одно сообщение со ссылкой на новый бот. Повторное нажатие не отправит его снова.",
  "ownBot.told": "В очередь поставлено сообщений: {n}.",
  "ownBot.wrongState": "Это действие недоступно в текущем состоянии бота. Обновите страницу.",
  "ownBot.telegramFailed": "Telegram отклонил запрос. Попробуйте чуть позже.",
  "ownBot.movedMessage": "📣 У <b>{center}</b> теперь свой Telegram-бот: {bot}\nРасписание, платежи и уведомления теперь там. Откройте бот и нажмите /start.",
  "platform.ownBot": "Свой бот",
  "platform.ownBotText":
    "Центр сможет создать собственный Telegram-бот (Настройки → Telegram-бот). Если снять разрешение, бот остановится, и уведомления пойдут через общий бот.",
  "platform.ownBotAllow": "Разрешить",
  "platform.ownBotRevoke": "Снять разрешение",
};
