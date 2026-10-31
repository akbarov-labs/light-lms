# Demo video — ssenariy (2–3 daqiqa)

Maqsad: o'quv markazi egasi videoni ko'rib, "bu bizning muammomizni hal qiladi" desin va bepul ro'yxatdan o'tsin.
Yozish: demo server (yoki lokal `http://localhost:3010`, demo login `90 123 45 67` / `demo1234`), ekran 1440×900,
brauzer 110% zoom, sichqoncha sekin. Ovoz — o'zbekcha, oddiy, "biz" emas "siz" deb.

| Vaqt | Ekranda | Aytiladi |
|---|---|---|
| 0:00–0:12 | Sayt (`/`), sarlavha, o'ngdagi to'lov kartochkasi | "O'quv markazingizda kim qancha qarzligini bilish uchun Excel yoki daftar ochasizmi? Bu tizimda hammasi bitta joyda va xatosiz." |
| 0:12–0:25 | Saytdagi to'lov namunasi: 500 000 → "Qarz qoladi: 400 000" → Tasdiqlash → chek | "To'lov kiritdingiz — qancha qarz qolgani darhol ko'rinadi, chek chiqadi." |
| 0:25–0:45 | Panelga kirish → **Bugun** sahifasi | "Ertalab administrator 'Bugun' sahifasini ochadi: bugungi darslar, davomat belgilanmagan darslar, qarzdorlar." |
| 0:45–1:05 | **Lidlar** kanbani → lidni "Sinovga yozildi"ga o'tkazish → o'quvchi sahifasi → **Faollashtirish** | "Instagram yoki qo'ng'iroqdan kelgan lid — sinov darsi — guruh. Faollashtirsangiz, oylik to'lov o'zi hisoblanadi, oy o'rtasida kelsa — faqat qolgan darslar uchun." |
| 1:05–1:30 | Yuqoridagi **+ To'lov** → ism yozish → summa → tasdiqlash oynasi → chek | "Ota-ona keldi: '+ To'lov', ismini yozasiz, summa — tizim tasdiqlashdan oldin qancha qarz qolishini ko'rsatadi. Chek chop etiladi." |
| 1:30–1:45 | **Qarzdorlar** → belgilash → "Eslatma yuborish" | "Qarzdorlarga Telegram orqali eslatma ketadi — ichida Payme havolasi. 3, 7, 14, 30 kunda o'zi ham yuboradi." |
| 1:45–2:00 | Telefon o'lchamida `/t` → darsni ochish → davomat | "O'qituvchi dars tugashi bilan telefondan davomat belgilaydi — oyligi ham shundan hisoblanadi." |
| 2:00–2:20 | **Oyliklar** → o'qituvchi → hisob | "Oy oxirida oylik tayyor: o'tilgan darslar, foiz, bonus. 'To'landi' — xarajatga o'zi yoziladi." |
| 2:20–2:35 | **Boshqaruv paneli** (tushum, qarz, grafik) | "Ega telefondan ham ko'radi: tushum, qarz, yangi va ketgan o'quvchilar." |
| 2:35–2:50 | Sayt → **Narxlar** → "Markazni bepul yaratish" | "50 tagacha o'quvchi — bepul. 5 daqiqada sozlanadi. Havolasi videoning tagida." |

Eslatmalar
- Videoda faqat demo ma'lumot bo'lsin (haqiqiy o'quvchi ismi/telefoni yo'q).
- Telegram bot va Payme kadrlari — bot tokeni va Payme test kaliti ulangandan keyin haqiqiy ekrandan yozing; ungacha saytdagi bot namunasi kadridan foydalaning.
- Oxirgi kadrda: sayt manzili va Telegram aloqa (`src/config/brand.ts` dagi `contact.telegram`).
- Ruscha versiya — xuddi shu ssenariy, interfeys tilini "Русский" ga o'tkazib.
