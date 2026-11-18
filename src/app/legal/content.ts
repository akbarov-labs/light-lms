// Public offer and privacy policy (uz / ru). DRAFT texts for a lawyer to review before launch.
// Tokens: {name} product, {entity} company, {site} site address, {plans} plan list, {version} text version.

export type LegalDoc = { title: string; sections: { h: string; p: string[] }[] };
type Docs = { offer: LegalDoc; privacy: LegalDoc };

const uz: Docs = {
  offer: {
    title: "Ommaviy oferta",
    sections: [
      {
        h: "1. Umumiy qoidalar",
        p: [
          "Ushbu hujjat {entity} (bundan keyin — Ijrochi) tomonidan {name} dasturiy xizmatidan (bundan keyin — Tizim) foydalanish bo'yicha ommaviy ofertadir (O'zbekiston Respublikasi Fuqarolik kodeksiga muvofiq).",
          "Buyurtmachi — Tizimda ro'yxatdan o'tgan o'quv markazi, uning egasi yoki vakolatli shaxsi. Faol o'quvchi — Tizimda kamida bitta faol (yoki muzlatilgan) guruh yozuvi bor o'quvchi. Tarif — faol o'quvchilar soniga bog'liq xizmat rejasi.",
        ],
      },
      {
        h: "2. Shartnoma predmeti",
        p: [
          "Ijrochi Buyurtmachiga internet orqali Tizimdan foydalanish huquqini beradi: lidlar, o'quvchilar, guruhlar, davomat, to'lovlar, qarzdorlar, o'qituvchi oyligi, hisobotlar, Telegram bot va boshqa imkoniyatlar. Buyurtmachi tanlangan tarif bo'yicha haq to'laydi.",
          "Tizim \"boricha\" taqdim etiladi; Ijrochi uni doimiy ravishda yangilab, yaxshilab boradi.",
        ],
      },
      {
        h: "3. Ofertani qabul qilish (aksept)",
        p: [
          "Buyurtmachi {site} saytida ro'yxatdan o'tib, \"Ommaviy oferta va Maxfiylik siyosati bilan tanishdim va roziman\" belgisini qo'yganda oferta to'liq va so'zsiz qabul qilingan hisoblanadi. Qabul qilingan sana va matn versiyasi ({version}) Tizimda saqlanadi.",
        ],
      },
      {
        h: "4. Tariflar va to'lov tartibi",
        p: [
          "Amaldagi tariflar: {plans}. Barcha tariflarda imkoniyatlar bir xil, farq faqat faol o'quvchilar sonining chegarasida.",
          "To'lov oyma-oy oldindan, Ijrochi ko'rsatgan rekvizitlar bo'yicha amalga oshiriladi. Bir yilga oldindan to'langanda 2 oy bepul beriladi.",
          "Faol o'quvchilar soni tarif chegarasiga yetganda yangi o'quvchini faollashtirish to'xtatiladi; Buyurtmachi tarifni oshirishi mumkin. Mavjud ma'lumotlar hech qachon o'chirilmaydi.",
          "Ijrochi tarif narxlarini kamida 30 kun oldin xabar qilib o'zgartirishi mumkin. To'langan davr uchun narx o'zgarmaydi.",
        ],
      },
      {
        h: "5. Ijrochining majburiyatlari",
        p: [
          "Tizimning ishlashini ta'minlash, texnik ishlarni iloji boricha tungi vaqtda o'tkazish, ma'lumotlarning har kungi zaxira nusxasini olish.",
          "Buyurtmachi ma'lumotlarini maxfiy saqlash va ularni faqat Maxfiylik siyosatida ko'rsatilgan maqsadlarda qayta ishlash.",
          "Buyurtmachi murojaatlariga ish kunlari davomida javob berish.",
        ],
      },
      {
        h: "6. Buyurtmachining majburiyatlari",
        p: [
          "Tizimga kiritiladigan o'quvchilar, ota-onalar va xodimlar ma'lumotlari uchun ularning (yoki qonuniy vakillarining) roziligini olish — Buyurtmachi bu ma'lumotlarning egasi va operatori hisoblanadi.",
          "Login va parollarni uchinchi shaxslarga bermaslik, xodimlarga faqat zarur ruxsatlarni berish.",
          "Tarif haqini o'z vaqtida to'lash va Tizimdan qonunga zid maqsadlarda foydalanmaslik.",
        ],
      },
      {
        h: "7. Javobgarlik",
        p: [
          "Ijrochining javobgarligi Buyurtmachi oxirgi 3 oyda to'lagan summa bilan cheklanadi. Ijrochi bilvosita zararlar va boy berilgan foyda uchun javob bermaydi.",
          "Uchinchi tomon xizmatlari (Payme, Telegram, internet provayderi) ishidagi uzilishlar uchun Ijrochi javob bermaydi.",
          "Engib bo'lmaydigan kuch holatlarida tomonlar javobgarlikdan ozod etiladi.",
        ],
      },
      {
        h: "8. Muddat va bekor qilish",
        p: [
          "Shartnoma aksept qilingan kundan boshlab muddatsiz amal qiladi. Buyurtmachi istalgan vaqtda Tizimdan foydalanishni to'xtatishi mumkin; to'langan davr qaytarilmaydi.",
          "Shartnoma tugagach, Buyurtmachi 30 kun ichida o'z ma'lumotlarini (CSV/Excel) yuklab olishi mumkin. Shundan so'ng ma'lumotlar o'chiriladi, qonun talab qilgan hollar bundan mustasno.",
          "Buyurtmachi shartnomani qo'pol buzsa (to'lov 30 kundan ortiq kechiksa, Tizimdan noqonuniy foydalanilsa), Ijrochi kirishni oldindan ogohlantirib to'xtatishi mumkin.",
        ],
      },
      {
        h: "9. Nizolarni hal qilish",
        p: ["Nizolar avvalo muzokaralar yo'li bilan hal qilinadi. Kelishuvga erishilmasa, O'zbekiston Respublikasi qonunchiligiga muvofiq sudda ko'riladi."],
      },
      {
        h: "10. Ijrochi rekvizitlari",
        p: ["{requisites}"],
      },
    ],
  },
  privacy: {
    title: "Maxfiylik siyosati",
    sections: [
      {
        h: "1. Kim uchun va nima haqida",
        p: [
          "Ushbu siyosat {entity} (Ijrochi) {name} Tizimida shaxsga doir ma'lumotlarni qanday yig'ishi, saqlashi va himoya qilishini tushuntiradi. U \"Shaxsga doir ma'lumotlar to'g'risida\"gi O'zbekiston Respublikasi Qonuniga muvofiq tuzilgan.",
          "O'quv markazi (Buyurtmachi) o'z o'quvchilari, ota-onalari va xodimlari ma'lumotlarining egasi va operatori hisoblanadi. Ijrochi bu ma'lumotlarni faqat markaz topshirig'i bilan, Tizim ishlashi uchun qayta ishlaydi.",
        ],
      },
      {
        h: "2. Qanday ma'lumotlar yig'iladi",
        p: [
          "Markaz egasi va xodimlari: ism, telefon raqami, parol (faqat shifrlangan xesh ko'rinishida), rol va ruxsatlar, til.",
          "Markaz kiritgan ma'lumotlar: o'quvchilar va ota-onalarning ismi, telefoni, tug'ilgan sanasi (ixtiyoriy), guruhlar, davomat, baholar, to'lovlar va qarzlar.",
          "Texnik ma'lumotlar: IP-manzil (kirish urinishlarini cheklash uchun), sessiya cookie fayli, amallar jurnali (audit).",
          "Telegram bot ishlatilsa — Telegram chat identifikatori va ulangan telefon raqami.",
        ],
      },
      {
        h: "3. Maqsadlar",
        p: [
          "Tizim xizmatini ko'rsatish: hisob-kitob, cheklar, eslatmalar, hisobotlar.",
          "Xavfsizlik: kirishni himoya qilish, firibgarlikning oldini olish, amallarni audit qilish.",
          "Buyurtmachi bilan aloqa: hisob, tarif va texnik xabarlar. Reklama yuborilmaydi.",
        ],
      },
      {
        h: "4. Saqlash joyi va muddati",
        p: [
          "Ma'lumotlar Germaniyadagi data-markazda joylashgan serverlarda saqlanadi. Germaniya shaxsga doir ma'lumotlarning teng himoyasini ta'minlaydigan davlatlar ro'yxatiga kiritilgan («Shaxsga doir ma'lumotlar to'g'risida»gi Qonunning 27¹-moddasi). Har kecha zaxira nusxa olinadi, zaxiralar 14 kun saqlanadi.",
          "Ma'lumotlar Buyurtmachi bilan shartnoma amal qilgan davrda va tugaganidan keyin 30 kun saqlanadi, so'ng o'chiriladi (qonun boshqacha talab qilgan hollar bundan mustasno). To'lov yozuvlari hech qachon tahrirlanmaydi — xato to'lov bekor qilish yozuvi bilan to'g'rilanadi.",
        ],
      },
      {
        h: "5. Kimga beriladi",
        p: [
          "Ma'lumotlar sotilmaydi va reklama uchun berilmaydi.",
          "Faqat xizmat uchun zarur hollarda: ota-ona onlayn to'lov qilsa — Payme'ga (summa va to'lov identifikatori); Telegram bot ishlatilsa — Telegram'ga (xabar matni); qonunda belgilangan hollarda — vakolatli davlat organlariga.",
        ],
      },
      {
        h: "6. Himoya choralari",
        p: [
          "Ulanish HTTPS orqali shifrlanadi; parollar faqat xesh ko'rinishida saqlanadi; kirish urinishlari cheklanadi; xodimlar faqat o'z roli va filiali doirasidagi ma'lumotni ko'radi; pul va holatga oid barcha amallar jurnalga yoziladi.",
        ],
      },
      {
        h: "7. Sizning huquqlaringiz",
        p: [
          "Ma'lumotlaringiz bilan tanishish, ularni tuzatish, o'chirishni yoki qayta ishlashni to'xtatishni talab qilish, roziligingizni qaytarib olish huquqiga egasiz.",
          "O'quvchi yoki ota-ona bo'lsangiz, avvalo o'z o'quv markazingizga murojaat qiling. Markaz egasi yoki xodimi bo'lsangiz — Ijrochiga: {contacts}.",
        ],
      },
      {
        h: "8. Cookie fayllari",
        p: ["Faqat zarur cookie'lar ishlatiladi: kirish sessiyasi, tanlangan til va filial. Kuzatuv yoki reklama cookie'lari ishlatilmaydi."],
      },
      {
        h: "9. O'zgarishlar",
        p: ["Siyosat yangilansa, yangi versiya shu sahifada e'lon qilinadi va muhim o'zgarishlar haqida markaz egalariga xabar beriladi. Amaldagi versiya: {version}."],
      },
    ],
  },
};

const ru: Docs = {
  offer: {
    title: "Публичная оферта",
    sections: [
      {
        h: "1. Общие положения",
        p: [
          "Настоящий документ — публичная оферта {entity} (далее — Исполнитель) на использование программного сервиса {name} (далее — Система) в соответствии с Гражданским кодексом Республики Узбекистан.",
          "Заказчик — учебный центр, зарегистрированный в Системе, его владелец или уполномоченное лицо. Активный ученик — ученик, у которого в Системе есть хотя бы одна активная (или замороженная) запись в группе. Тариф — план обслуживания в зависимости от числа активных учеников.",
        ],
      },
      {
        h: "2. Предмет договора",
        p: [
          "Исполнитель предоставляет Заказчику право пользования Системой через интернет: лиды, ученики, группы, посещаемость, оплаты, должники, зарплата преподавателей, отчёты, Telegram-бот и другие возможности. Заказчик оплачивает выбранный тариф.",
          "Система предоставляется «как есть»; Исполнитель постоянно её обновляет и улучшает.",
        ],
      },
      {
        h: "3. Акцепт оферты",
        p: [
          "Оферта считается принятой полностью и безоговорочно, когда Заказчик регистрируется на сайте {site} и отмечает «Я ознакомился и согласен с Публичной офертой и Политикой конфиденциальности». Дата акцепта и версия текста ({version}) сохраняются в Системе.",
        ],
      },
      {
        h: "4. Тарифы и порядок оплаты",
        p: [
          "Действующие тарифы: {plans}. Во всех тарифах одинаковые возможности, различается только лимит активных учеников.",
          "Оплата производится помесячно, авансом, по реквизитам Исполнителя. При оплате за год вперёд — 2 месяца бесплатно.",
          "Когда число активных учеников достигает лимита тарифа, активация новых учеников приостанавливается; Заказчик может перейти на старший тариф. Существующие данные никогда не удаляются.",
          "Исполнитель вправе менять цены, уведомив не менее чем за 30 дней. Цена оплаченного периода не меняется.",
        ],
      },
      {
        h: "5. Обязанности Исполнителя",
        p: [
          "Обеспечивать работу Системы, проводить технические работы по возможности ночью, ежедневно делать резервные копии данных.",
          "Хранить данные Заказчика конфиденциально и обрабатывать их только в целях, указанных в Политике конфиденциальности.",
          "Отвечать на обращения Заказчика в рабочие дни.",
        ],
      },
      {
        h: "6. Обязанности Заказчика",
        p: [
          "Получать согласие учеников, родителей и сотрудников (или их законных представителей) на обработку вносимых данных — Заказчик является собственником и оператором этих данных.",
          "Не передавать логины и пароли третьим лицам, давать сотрудникам только необходимые права.",
          "Своевременно оплачивать тариф и не использовать Систему в противоправных целях.",
        ],
      },
      {
        h: "7. Ответственность",
        p: [
          "Ответственность Исполнителя ограничена суммой, оплаченной Заказчиком за последние 3 месяца. Исполнитель не отвечает за косвенные убытки и упущенную выгоду.",
          "Исполнитель не отвечает за перебои в работе сторонних сервисов (Payme, Telegram, интернет-провайдер).",
          "Стороны освобождаются от ответственности при обстоятельствах непреодолимой силы.",
        ],
      },
      {
        h: "8. Срок и расторжение",
        p: [
          "Договор действует бессрочно с даты акцепта. Заказчик может прекратить пользование Системой в любой момент; оплаченный период не возвращается.",
          "После прекращения договора Заказчик в течение 30 дней может выгрузить свои данные (CSV/Excel). Затем данные удаляются, кроме случаев, предусмотренных законом.",
          "При грубом нарушении договора Заказчиком (просрочка оплаты более 30 дней, незаконное использование) Исполнитель вправе приостановить доступ, предварительно уведомив.",
        ],
      },
      {
        h: "9. Разрешение споров",
        p: ["Споры решаются путём переговоров, а при недостижении согласия — в суде в соответствии с законодательством Республики Узбекистан."],
      },
      {
        h: "10. Реквизиты Исполнителя",
        p: ["{requisites}"],
      },
    ],
  },
  privacy: {
    title: "Политика конфиденциальности",
    sections: [
      {
        h: "1. Для кого и о чём",
        p: [
          "Политика объясняет, как {entity} (Исполнитель) собирает, хранит и защищает персональные данные в Системе {name}. Составлена в соответствии с Законом Республики Узбекистан «О персональных данных».",
          "Учебный центр (Заказчик) является собственником и оператором данных своих учеников, родителей и сотрудников. Исполнитель обрабатывает эти данные только по поручению центра и для работы Системы.",
        ],
      },
      {
        h: "2. Какие данные собираются",
        p: [
          "Владелец и сотрудники центра: имя, номер телефона, пароль (только в виде зашифрованного хэша), роль и права, язык.",
          "Данные, вносимые центром: имена и телефоны учеников и родителей, дата рождения (по желанию), группы, посещаемость, оценки, оплаты и долги.",
          "Технические данные: IP-адрес (для ограничения попыток входа), cookie сессии, журнал действий (аудит).",
          "При использовании Telegram-бота — идентификатор чата Telegram и привязанный номер телефона.",
        ],
      },
      {
        h: "3. Цели",
        p: [
          "Оказание услуг Системы: расчёты, чеки, напоминания, отчёты.",
          "Безопасность: защита входа, предотвращение мошенничества, аудит действий.",
          "Связь с Заказчиком: сообщения о счёте, тарифе и технические уведомления. Реклама не рассылается.",
        ],
      },
      {
        h: "4. Место и срок хранения",
        p: [
          "Данные хранятся на серверах в дата-центре в Германии. Германия включена в перечень государств, обеспечивающих равноценную защиту персональных данных (статья 27¹ Закона «О персональных данных»). Каждую ночь делается резервная копия, копии хранятся 14 дней.",
          "Данные хранятся в течение действия договора с Заказчиком и 30 дней после его прекращения, затем удаляются (если закон не требует иного). Записи об оплатах никогда не редактируются — ошибочная оплата исправляется записью отмены.",
        ],
      },
      {
        h: "5. Кому передаются",
        p: [
          "Данные не продаются и не передаются для рекламы.",
          "Только когда это необходимо для услуги: при онлайн-оплате родителем — в Payme (сумма и идентификатор платежа); при использовании Telegram-бота — в Telegram (текст сообщения); в случаях, предусмотренных законом, — уполномоченным государственным органам.",
        ],
      },
      {
        h: "6. Меры защиты",
        p: [
          "Соединение шифруется по HTTPS; пароли хранятся только в виде хэша; попытки входа ограничены; сотрудники видят только данные своей роли и филиала; все действия с деньгами и статусами записываются в журнал.",
        ],
      },
      {
        h: "7. Ваши права",
        p: [
          "Вы вправе знакомиться со своими данными, требовать их исправления, удаления или прекращения обработки, отозвать согласие.",
          "Если вы ученик или родитель — сначала обратитесь в свой учебный центр. Если вы владелец или сотрудник центра — к Исполнителю: {contacts}.",
        ],
      },
      {
        h: "8. Файлы cookie",
        p: ["Используются только необходимые cookie: сессия входа, выбранный язык и филиал. Отслеживающие и рекламные cookie не используются."],
      },
      {
        h: "9. Изменения",
        p: ["При обновлении политики новая версия публикуется на этой странице, о существенных изменениях сообщается владельцам центров. Действующая версия: {version}."],
      },
    ],
  },
};

export const LEGAL = { uz, ru };
