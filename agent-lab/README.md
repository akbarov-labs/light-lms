# agent-lab — AI agentni qo'lda o'rganish

LMS kodiga tegmaydigan alohida papka. Bu yerda agent qanday ishlashini kichik,
ishlaydigan qismlarda o'rganamiz. Keyin o'rganganimizni haqiqiy LMS'ga olib o'tamiz.

## Ishga tushirish

```bash
cd agent-lab
npm install
cp .env.example .env   # ichiga ANTHROPIC_API_KEY ni qo'ying
npm run 01
```

API kalit: console.anthropic.com → API Keys → Create Key. Hisobga ozgina kredit
kerak bo'ladi (5 dollar o'rganish uchun bemalol yetadi). Har bir suhbat qancha turganini `/narx` buyrug'i ko'rsatadi.

## 01-raw-loop.ts — qo'lda yozilgan agent sikli

Matematika markaziga yangi mijoz yozadi. Agent darajasini aniqlaydi, guruh topadi,
lead yaratadi, sinov darsiga yozadi va o'qituvchiga xabar beradi. Baza soxta.

Fayl 6 qismdan iborat: soxta baza → vositalar tavsifi → vositalar kodi →
system prompt → **agent sikli** → terminal. Eng muhimi `agentTurn()` funksiyasi.

Ekranda nimani ko'rasiz:
- `[qadam N] stop_reason=...`: bitta API chaqiruv. `tool_use` model vosita so'radi, `end_turn` javob berdi degani.
- `🔧 list_groups({...})`: model so'ragan vosita va parametrlari.
- `↳ ...`: bizning kod qaytargan natija (model keyingi qadamda shuni o'qiydi).
- Sariq ramka: o'qituvchiga ketgan xabar.

Buyruqlar: `/xotira` (model har safar ko'radigan massiv), `/baza` (vositalar nimani o'zgartirdi),
`/narx` (token va dollar), `/yangi` (suhbatni tozalash), `/chiqish`.

## Tajribalar (shu tartibda qiling)

1. **Oddiy suhbat.** "Assalomu alaykum, o'g'lim 7-sinfda, algebradan qiynalyapti" deb boshlang
   va oxirigacha boring. Keyin `/xotira`: 4-5 ta xabar yozdingiz, massivda esa ancha ko'p. Nega?
2. **Tokenlar o'sishi.** Har qadamdagi "kirish" tokenlariga qarang: har safar kattalashadi,
   chunki butun tarix qayta yuboriladi. Context management nega kerakligi shu yerdan ko'rinadi.
3. **Xato bilan ishlash.** Telefonni "12345" deb yozing. Vosita xato qaytaradi, model esa
   o'zi qayta so'raydi. Biz faqat xato matnini yaxshi yozdik, xolos.
4. **To'la guruh.** 7-8 sinfning soat 15:00 dagi guruhini so'rang (g2, joy yo'q). Agent nima qiladi?
5. **To'qib chiqarish testi.** Agent guruhlarni ko'rmasdan oldin "narxi qancha?" deb so'rang.
   Keyin `SYSTEM_PROMPT` dan "Hech qachon o'zingdan to'qima" qatorini va `list_groups`
   tavsifidagi ogohlantirishni olib tashlab, yana sinab ko'ring.
6. **Tavsif kuchi.** `book_trial` tavsifidan "Faqat create_lead dan keyin" qismini o'chiring.
   Agent tartibni buzadimi? Kod (`book_trial` ichidagi tekshiruv) uni baribir to'xtatadimi?
7. **Rus tilida** yozib ko'ring.
8. **Effort.** `effort: "medium"` ni `"low"` ga o'zgartiring: tezlik, narx va sifat qanday o'zgaradi?

Har tajribadan keyin bitta savolga javob bering: **bu xatti-harakatni prompt
boshqaryaptimi yoki kod?** Bu loyihadagi eng muhim savol: xavfsizlik va pul
masalasi doim kodda bo'lishi kerak, promptda emas.
