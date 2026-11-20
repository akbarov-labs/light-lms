// Strings for the math tutor in the bot (settings.tutor, src/lib/tutor). Spread into uz.ts / ru.ts.
// The bot texts are in Uzbek Latin and Russian; a student writing in Cyrillic Uzbek or Karakalpak still
// gets the model's own replies in their language (the prompt), only these fixed texts are not.
export const tutorUz = {
  "settings.tutor": "Matematika yordamchisi (AI)",
  "settings.tutorHint":
    "O'quvchilar va ota-onalar botga istalgan mavzuda matematika savolini yozadi: AI avval yo'naltiradi, qadamma-qadam; o'quvchi topa olmasa, o'xshash misolni ishlab ko'rsatadi. Uy vazifasi va test javoblarini aytmaydi. Yozishmalar tashqi AI xizmatiga (Anthropic, AQSh) yuboriladi; sarf AI agentining oylik limitidan.",
  "settings.tutorEnabled": "Matematika yordamchisini yoqish",
  "settings.tutorDaily": "Bir chat uchun kunlik xabarlar",
  "settings.tutorDailyHint": "Undan keyin yordamchi ertagacha javob bermaydi.",
  "tutor.btn": "🧑‍🏫 Savol berish",
  "tutor.intro":
    "🧑‍🏫 <b>Matematika yordamchisi</b>\nMatematikadan istalgan savolingizni shu yerga yozing: mavzuni tushuntiraman va misolni qadamma-qadam o'zingiz yechishingizga yordam beraman.\n\nUy vazifasi va test javoblarini aytmayman — ularni o'zingiz yechasiz. Savolni matn bilan yozing (masalan: <i>2x + 3 = 11 ni qanday yechaman?</i>). Kuniga {n} ta xabar.",
  "tutor.off": "Matematika yordamchisi hozir o'chirilgan.",
  "tutor.dailyLimit": "Bugungi savollar soni tugadi ({n} ta). Ertaga yana yozing!",
  "tutor.paused": "Yordamchi hozir javob bera olmaydi. Savolingizni ustozingizga darsda bering.",
  "tutor.error": "Kechirasiz, texnik nosozlik bo'ldi. Bir ozdan keyin qayta yozing.",
  "tutor.refused": "Kechirasiz, bu savolga javob bera olmayman. Matematikadan boshqa savol bering.",
  "tutor.sheet":
    "Bu uy vazifasi yoki testga o'xshaydi: ularning javobini aytmayman. Bitta misolni tanlab yozing va qayerda qiynalayotganingizni ayting — birga qadamma-qadam yechamiz.",
  "tutor.leak":
    "Bu savol ochiq uy vazifangizga tegishli, shuning uchun javobini aytolmayman. Qaysi qadamda qiynalayotganingizni yozing — yo'l-yo'riq beraman yoki o'xshash misolni ko'rsataman.",
  "tutor.sheetOpen": "Siz hozir uy vazifasi ustida ishlayapsiz: bu vaqtda yordamchi javob bermaydi. Vazifadagi oxirgi harakatingizdan 30 daqiqa o'tgach savol bering.",
  "tutor.photo":
    "Matematika yordamchisi hozircha faqat matn bilan yozilgan savolni o'qiydi: misolni matn bilan yozing (masalan: 2x + 3 = 11).\nUy vazifasi javoblarini rasm bilan yubormoqchi bo'lsangiz, avval «📝 Uy vazifasi» tugmasi orqali vazifani oching.",
};

export const tutorRu: Record<keyof typeof tutorUz, string> = {
  "settings.tutor": "Помощник по математике (ИИ)",
  "settings.tutorHint":
    "Ученики и родители пишут боту вопрос по математике на любую тему: ИИ сначала направляет, шаг за шагом; если ученик не находит решение, разбирает похожий пример. Ответы домашних заданий и тестов не говорит. Переписка отправляется во внешний ИИ-сервис (Anthropic, США); расход — из месячного лимита ИИ-агента.",
  "settings.tutorEnabled": "Включить помощника по математике",
  "settings.tutorDaily": "Сообщений в день на один чат",
  "settings.tutorDailyHint": "После этого помощник не отвечает до завтра.",
  "tutor.btn": "🧑‍🏫 Задать вопрос",
  "tutor.intro":
    "🧑‍🏫 <b>Помощник по математике</b>\nНапишите сюда любой вопрос по математике: объясню тему и помогу решить пример самостоятельно, шаг за шагом.\n\nОтветы домашних заданий и тестов не говорю — их вы решаете сами. Пишите вопрос текстом (например: <i>как решить 2x + 3 = 11?</i>). До {n} сообщений в день.",
  "tutor.off": "Помощник по математике сейчас выключен.",
  "tutor.dailyLimit": "Вопросы на сегодня закончились ({n}). Пишите завтра!",
  "tutor.paused": "Помощник сейчас не может ответить. Задайте вопрос учителю на уроке.",
  "tutor.error": "Извините, произошла техническая ошибка. Напишите чуть позже.",
  "tutor.refused": "Извините, на этот вопрос я ответить не могу. Задайте другой вопрос по математике.",
  "tutor.sheet":
    "Похоже на домашнее задание или тест: их ответы я не говорю. Выберите один пример и напишите, где застряли, — решим вместе шаг за шагом.",
  "tutor.leak":
    "Этот вопрос из вашего открытого домашнего задания, поэтому ответ я сказать не могу. Напишите, на каком шаге застряли, — подскажу или покажу похожий пример.",
  "tutor.sheetOpen": "Вы сейчас работаете над домашним заданием: в это время помощник не отвечает. Задайте вопрос через 30 минут после последнего действия в задании.",
  "tutor.photo":
    "Пока помощник по математике читает только вопросы, написанные текстом: напишите пример текстом (например: 2x + 3 = 11).\nЧтобы отправить ответы домашнего задания фото, сначала откройте задание кнопкой «📝 Домашнее задание».",
};
