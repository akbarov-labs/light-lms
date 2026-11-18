# lms-light

O'quv markazlari uchun CRM/LMS (Uzbekiston): lidlar, guruhlar, davomat, oylik to'lovlar, qarzlar, o'qituvchi oyligi, Telegram bot, Payme.
CRM/LMS for private education centers in Uzbekistan.

## Holat / Status

<!-- STATUS:START -->
**Uy vazifasi, 2-bosqich yadrosi (18.11.2026, `worktree-homework-core` branch, sinov):** Sozlamalarda yoqiladi (standart o'chiq). O'qituvchi dars sahifasida (`/lessons/<id>` va telefondan `/t/lessons/<id>`) javoblar kalitini yozadi: harf (A–E) yoki son (-4, 2.5, 3/4), bir nechta to'g'ri javob `2|-2`; tushib qolgan savol raqami darhol ko'rsatiladi. Dars tugagach bot xabar beradi: belgilangan sinfdan boshlab (standart 9) o'quvchining o'ziga, kichiklarga ota-onasiga (o'quvchida "Maktab sinfi" maydoni). O'quvchi yoki ota-ona botdagi «📝 Uy vazifasi» tugmasi orqali savolma-savol javob beradi (harf tugmalari, son yoziladi), keyingi dars boshlanguncha o'zgartirishi mumkin; baho o'quvchiga ko'rsatilmaydi. Tekshirishni faqat kod qiladi (model emas). Keyingi dars sahifasida natija savol tartibida: hamma to'g'ri yechgan savollar yashirilgan, xato javoblar nima yozilgani bo'yicha guruhlangan, kim javob bermagan. Rasmdan o'qish, joylashtirish testi, ota-ona hisobotlari hali yo'q (mijoz javoblari kutilmoqda). Tekshirildi: typecheck, lint, 462 unit test, 216 baza testi (15 tasi uy vazifasi: bot oqimi soxta Telegram bilan), brauzerda o'qituvchi sahifasi (kalit, xato raqamlash, natijalar, telefon kengligi) va sozlamalar. Haqiqiy bot bilan sinalmagan.
*English:* homework core (pilot, off by default): the teacher's answer key per lesson, students or parents (by school grade) answer in the bot, code grades, results per question at the next lesson with all-correct questions hidden. Photo reading, placement test and parent reports wait for the client's answers. Verified by unit, DB and browser checks; not tried with a real bot yet.
**sabaq.uz va Sabaq AI yordamchisi (18.11.2026, `feat/sabaq-uz` branch):** Sabaq — "o'qituvchining AI yordamchisi"; yangi logo ("s."). Sayt va demo sabaq.uz ga ko'chadi (serverdagi qadamlar DEPLOY.md §11c). `SALES_AGENT=true` bilan botga markaz havolasisiz yozgan har kim (o'qituvchi, markaz egasi) Sabaqning AI yordamchisi bilan gaplashadi: savollarga sayt matni va tariflar asosida javob beradi, boshlamoqchi bo'lsa raqamini tugma bilan oladi va lidni jamoa chatiga yuboradi; javobi yo'q savolni ham yuboradi, jamoa o'sha xabarga reply qilsa javob mijozga boradi. Saytdagi "Bog'lanish" havolalari botga boradi. Tekshirildi: typecheck, unit va baza testlari (soxta model bilan). 18.11.2026 da productionga chiqdi (`6f1e3b1`, uy vazifasisiz): sabaq.uz ishlaydi, sabaq.akbarovlabs.uz 301 bilan sabaq.uz ga o'tadi, saytdagi havolalar @sabaquz_bot ga boradi. Botdagi yordamchi haqiqiy model bilan jonli sinaldi: javob, raqam tugmasi, lid jamoa chatiga, reply mijozga yetadi. Keyingi qadam (DEPLOY.md §11e; 2026-yil martdan qonun Germaniyadagi serverga ruxsat beradi, §0): Contabo'da ikki stek — sabaq.uz haqiqiy markazlar uchun (har kecha backup), demo.sabaq.uz demo; serverda hali yoqilmagan.
*English:* Sabaq is positioned as the teacher's AI assistant, with a new "s." logo. The site and demo move to sabaq.uz (server steps in DEPLOY.md §15). With `SALES_AGENT=true`, anyone who writes to the bot without a center link talks to Sabaq's own AI assistant, which answers from the landing copy and plans, collects the phone with a button and sends leads and open questions to the team chat; a reply there reaches the customer. The site's contact links point at the bot. Checked: typecheck, unit and DB tests (scripted model). Live in production on 2026-11-18 (`6f1e3b1`, without homework): sabaq.uz serves, sabaq.akbarovlabs.uz redirects 301 to it, contact links point at @sabaquz_bot. The bot's assistant was tried live with the real model: answers, phone button, lead to the team chat, reply back to the customer. Next (DEPLOY.md §15b; since March 2026 the law allows a server in Germany, §0): two stacks on Contabo — sabaq.uz for real centers (nightly backups) and demo.sabaq.uz for the demo; not switched on on the server yet.

**AI lead agenti, 1-bosqich (16.11.2026, `feat/agent-lab` branch):** Telegram'da `t.me/<bot>?start=<markaz-slug>` havolasi orqali markazning AI yordamchisi (o'zini AI deb tanishtiradi) yangi mijozni kutib oladi: avval savollarga javob beradi, tajribasini so'raydi, mos guruhlarni kod chizgan kartochkalarda ("Sinov darsiga yozilish" tugmasi bilan) ko'rsatadi, so'ralsa filial xaritasini yuboradi, o'qituvchi haqida faqat uning ochiq bio'sini aytadi, telefonni faqat yozilishda Telegram kontakt tugmasi orqali oladi (raqam modelga yuborilmaydi), sanani kelishib bepul sinov darsiga yozadi (admin bilan bir xil servislar orqali), o'qituvchiga xabar beradi. Bekor qilish yoki ko'chirishni so'rasa, mijozga "Ha, bekor qilish" tugmasini yuboradi: bron faqat tugma bosilganda bekor bo'ladi. Agent javob bera olmagan savol egasiga Telegram'da boradi; ega shu xabarga reply qilsa, javob mijozga yetadi va agent suhbatni davom ettiradi. Xodimlar uchun suhbat to'liq saqlanadi. Daraja savollariga javobni o'zi baholamaydi, aynan yozib o'qituvchiga qoldiradi. Yozgan har bir odam darhol lead bo'ladi; raqam qoldirmaganlar "📵 Raqamsiz" filtrida, xodim ularga lead sahifasidan bot orqali yozadi va agent suhbatni davom ettiradi. Egasining kunlik hisobotida Telegram AI lead'lari soni. Filialga xaritadagi nuqta (koordinata yoki Google/Yandex/2GIS havolasi), o'qituvchiga bio maydoni. Standart holatda O'CHIQ: `ANTHROPIC_API_KEY` (pullik xizmat) + markaz uchun `npx tsx scripts/agent.ts on <slug>`. Har markazga oylik token limiti, har chatga tezlik cheklovi. Model: Claude Haiku 5.5 (`AGENT_MODEL`). Tekshirildi: typecheck, lint, build, unit va baza testlari (soxta model bilan), haqiqiy model evallari (`npm run agent:evals`, 23 holat, hammasi 3/3). To'rt jonli sinov (demo) xatolari tuzatildi; mijozning yozuvlari va telefon holati har xabarda bazadan agentga beriladi (uzun suhbatda unutmaydi); prompt caching (evallarda xarajat −72%, jonli sinovda −61%: 3 suhbat ≈ $0.015). Oxirgi tuzatishlar (reply orqali javob, bekor qilish tugmasi, xato raqam, qayta so'ramaslik) jonli qayta sinalmagan. Haqiqiy markazlarda yoqishdan oldin: shaxsiy ma'lumotlarni chet el API'siga yuborish masalasi hal bo'lishi kerak (DEPLOY.md §0).

**Telegram Bot API yangiliklari (17.11.2026, `sardor/bot-api-rich-403550` branch, sinov bosqichi):** hisobot kartalari, to'lov/qarz xabarlari va «✅ Davomat» javobi rich xabar sifatida (sarlavha + jadval) — `TELEGRAM_RICH_MESSAGES=true` bilan yoqiladi, Telegram rad etsa oddiy matn ketadi; dars vaqti va to'lov sanasi o'quvchining mahalliy vaqtida (`TELEGRAM_DATE_TIME=true`). Ikkalasi ham standart holatda o'chiq; SMS, to'lov va qarz hisob-kitobi o'zgarmagan. Uy vazifasi checklist'lari qurilmadi (Telegram Business talab qiladi) — [docs/TELEGRAM-CHECKLISTS.md](docs/TELEGRAM-CHECKLISTS.md); har bir farzand uchun alohida mavzu — reja: [docs/TELEGRAM-CHILD-TOPICS.md](docs/TELEGRAM-CHILD-TOPICS.md). Haqiqiy bot bilan sinalmagan.
*English:* rich messages (Bot API 10.1) for report cards, payment/debt notices and the attendance summary behind `TELEGRAM_RICH_MESSAGES`, with automatic plain-text fallback; `date_time` entities (9.5) for lesson times and payment dates behind `TELEGRAM_DATE_TIME`. Both off by default; SMS, payment and debt logic unchanged. Checklists need Telegram Business (note only); per-child private topics designed, not built. Verified by unit and DB tests; not tried with a real bot yet.

**v2 (18.10.2026, `feat/v2` branch):** Click va Uzum Bank to'lovlari, Eskiz orqali SMS (Telegram'siz ota-onalarga), oylik hisobot kartalari, imtihonlar va sertifikatlar (QR bilan tekshiriladi), Telegram Mini App (`/tg`). AI yordamchi — keyingi bosqich. Tekshirildi: typecheck, lint, 379 unit test, 158 baza testi, 13 brauzer testi (yangi sahifalar WCAG AA bo'yicha xatosiz), `next build`, noldan Docker. Haqiqiy kalitlar bilan sinalmagan: Click, Uzum (xato kodlari Uzum menejeri bilan tasdiqlanishi kerak), Eskiz, Mini App haqiqiy bot va https domen bilan.

**O'zbekcha (17.10.2026):** MVP tayyor va `docker compose up --build` bilan noldan ishga tushadi (Postgres, migratsiya + demo, web, worker).

Ishlaydi:
- Lidlar (kanban, ochiq forma `/f/demo`, izohlar, o'quvchiga aylantirish), o'quvchilar va oilalar (aka-ukalar bitta hamyon), guruhlar (jadval, xona/o'qituvchi to'qnashuvi tekshiruvi), darslar (bekor qilish, ko'chirish, o'rinbosar).
- Sinov → faollashtirish, ko'chirish, muzlatish, chiqish, chegirma — hammasi avtomatik qayta hisoblanadi (hisob-kitob dvigateli, 60+ test).
- To'lovlar, chek, bekor qilish (faqat ruxsat bilan), qaytarish, qarzdorlar + eslatma, oila hamyoni.
- O'qituvchi oyligi (4 model, bonus/jarima, qulflash, to'landi → xarajat), xarajatlar, hisobotlar, egasi paneli, "Bugun" sahifasi, audit jurnali, CSV eksport (Excel uchun), Excel/CSV import.
- O'qituvchi telefondan `/t`: bugungi darslar, davomat, oylik. O'zbek/rus tili.
- SaaS: yangi markaz o'zi ro'yxatdan o'tadi (`/signup`), 4 qadamli sozlash ustasi (filial/xonalar → kurs → guruh → o'qituvchi), tariflar (Bepul ≤50, Start ≤150, Growth ≤400, Pro ≤1000 faol o'quvchi; Sozlamalar → Tarif; birinchi 20 ta "asoschi markaz" — 6 oy bepul, keyin umrbod 50%), platforma admini (`/platform`: barcha markazlar, tarifni o'zgartirish, markazni o'chirish).
- Sayt (landing) `/` da — kirmagan mehmon uchun: jonli to'lov namunasi (summa → qolgan qarz → chek), imkoniyatlar, narxlar, savollar; uz/ru. Ommaviy oferta va maxfiylik siyosati (`/legal/offer`, `/legal/privacy`, loyiha — yurist tekshirsin); ro'yxatdan o'tishda rozilik belgisi (sana va versiya saqlanadi). Demo server rejimi (`DEMO_MODE=true`: `/demo` parolsiz kirish, xavfli amallar qulf, har kecha 04:00 da qayta tiklanadi). Nom, aloqa va rekvizitlar bitta faylda: `src/config/brand.ts`. Demo video ssenariysi: [docs/DEMO-VIDEO.md](docs/DEMO-VIDEO.md).
- Telegram bot (token qo'yilsa): raqam bo'yicha ulanish, balans, jadval, davomat, to'lov havolasi, o'qituvchi davomati, kunlik hisobot. Payme Merchant API (kalit qo'yilsa).

Mustaqil audit (17.10.2026, [docs/AUDIT-2026-10-17.md](docs/AUDIT-2026-10-17.md)): baho 7,4 → 8,6 / 10. Ikki tekshiruv bosqichida topilgan barcha xatolar tuzatildi (pul kiritishda vergul 100× xatosi, o'qituvchi oyligi bo'lib to'lashda, platforma admini telefon orqali, xabarlar ikki marta yuborilishi, tungi ish to'xtab qolishi va boshqalar); Next 16, Prisma 7, Zod 4, Vitest 5, ESLint 10 ga o'tildi.

Keyin: Telegram bot tugmalari to'liq testlandi (2 ta xato tuzatildi), qarz muddati va qarzdorlar ro'yxati oila balansi keshidan o'qiladi (10 000 o'quvchida 52 ms → 8 ms).

Tekshirildi: typecheck, lint, 325 unit test (pul kodi qamrovi 99%), 129 ta baza testi, 10 ta brauzer (Playwright) testi — 26 sahifa WCAG 2.1 AA bo'yicha (axe) xatosiz, telefonda yon tomonga siljimaydi; 2 000 o'quvchili markazda har bir sahifa 0,4 soniyadan tez; `npm audit` bo'yicha ma'lum zaiflik 0 ta (Tailwind 4 ga o'tildi, ko'rinish o'zgarmadi — 21 sahifa piksel bo'yicha solishtirildi); `next build`, noldan Docker (`down -v && up --build`), brauzerda asosiy oqimlar (lid → sinov → faollashtirish → to'lov → chek → bekor qilish, ko'chirish, o'qituvchi telefondan davomat, oylikni qulflash → xarajat → foyda, rus tili); mustaqil ko'rib chiqish topgan barcha xatolar tuzatildi va qayta tekshirildi.

Eslatma: bu Macda 3000-portni boshqa loyiha band qilgan, shuning uchun `.env` da `WEB_PORT=3010` (http://localhost:3010).

Ogohlantirishlar: server xatosi, ish xatosi va eski backup haqida Telegram xabari (`OPS_TELEGRAM_CHAT_ID`). Yangi markaz uchun "Boshlash uchun 4 qadam" va har bir bo'sh sahifada keyingi qadam.

Production (VPS) tayyorgarligi: kirish urinishlarini cheklash (raqam + IP, 15 daqiqa blok, uz/ru xabar), parolni tiklash (ega/menejer — vaqtinchalik parol; xodim — Telegram botdan kod), parol o'zgarsa eski sessiyalar bekor, CSP/HSTS/xavfsiz cookie, kuchsiz `AUTH_SECRET` bilan HTTPS'da ishga tushmaydi. `docker-compose.prod.yml`: Caddy (avtomatik HTTPS), har kecha backup (14 kun) + tiklash skripti, log rotatsiyasi. Qo'llanma: [DEPLOY.md](DEPLOY.md) (shaxsiy ma'lumotlar O'zbekistonda saqlanishi kerak).

Sizdan kerak: mahsulot nomi va rekvizitlar (`src/config/brand.ts`), O'zbekistondagi server + domen, bot tokeni, Payme test kaliti, oferta matnini yurist tekshiruvi, pilot markazlar.

Qolgan: AI yordamchi. v2 (Click, Uzum, SMS, hisobot kartalari, imtihon va sertifikat, Mini App) qurildi — yuqoriga qarang. Bot haqiqiy token bilan sinalmagan (token yo'q edi); Payme test kassada sinalmagan (faqat testlar bilan). Haqiqiy domen va Let's Encrypt sertifikati sinalmagan (lokal `localhost` sertifikati bilan sinaldi).

**English:** The full MVP runs from a clean clone with `docker compose up --build`. Everything in HANDOFF §5 marked MVP is built: CRM, groups/lessons/attendance, the billing engine (self-healing, idempotent), payments and debts, teacher salaries, expenses, reports, owner dashboard, teacher mobile pages, Telegram bot, Payme endpoint, CSV export/import, audit log, uz/ru. SaaS onboarding: self-serve signup at `/signup`, a skippable 4-step setup wizard, plan limits on active students (Settings → Plan) and a platform admin area at `/platform` (granted with `scripts/platform-admin.ts`). Product site at `/` for visitors (playable payment demo, features, pricing, FAQ; uz/ru), public offer and privacy policy drafts (`/legal/*`, lawyer review pending) with recorded signup consent, a public demo server mode (`DEMO_MODE=true`: password-free `/demo`, risky actions locked, nightly re-seed), brand/contacts/company details in `src/config/brand.ts`, demo video script in `docs/DEMO-VIDEO.md`. Independent audit (2026-10-17, [docs/AUDIT-2026-10-17.md](docs/AUDIT-2026-10-17.md)): 7.4 → 8.6/10 after two review rounds; every finding fixed (decimal-comma 100× amounts, installment salary from uncollected money, platform admin by phone, double-sent notifications, one bad group stopping the nightly billing, and more); upgraded to Next 16, Prisma 7, Zod 4, Vitest 5, ESLint 10. Follow-up the same day: the Telegram bot handlers are tested end to end (two bugs fixed), and debt aging, the debtors list and debt reminders read a trigger-maintained family balance cache (aging 52 ms → 8 ms at 10 000 students). Verified with typecheck, lint, 325 unit tests (money code 99% line coverage), 129 DB integration tests, 10 Playwright end-to-end tests (26 pages with zero serious/critical axe WCAG 2.1 AA violations, no sideways scrolling on phones), every page under 0.4 s at 2 000 students (`scripts/scale-test.ts`), 0 known vulnerabilities in production dependencies, production build, a clean Docker run and browser walkthroughs; an independent review's findings were fixed. Production readiness: login limiting (per phone + per IP, DB-backed), password reset (admin temporary password; Telegram code for linked staff), sessions revoked on password change, nonce CSP + HSTS + secure cookies, startup refusal of a weak `AUTH_SECRET` over HTTPS, and `docker-compose.prod.yml` with Caddy auto-HTTPS, nightly backups (14 days) with a restore script and log rotation — see [DEPLOY.md](DEPLOY.md). Dependencies: `npm audit` reports 0 known vulnerabilities after the move to Tailwind 4 (pixel-diffed against Tailwind 3 on 21 pages; see DECISIONS.md). Not verified live: the bot with a real token, Payme against its test cashbox, and a real domain/Let's Encrypt certificate (tested locally with Caddy's localhost certificate). Waiting on the owner: product name and company details, a server in Uzbekistan + domain, bot token, Payme test keys, lawyer review of the legal texts, pilot centers. v2 (2026-10-18, branch `feat/v2`): Click SHOP-API and Uzum Bank Merchant API payments, SMS through each center's own Eskiz account (dry run locally), monthly report cards (teacher comments, frozen snapshot, public parent link), exams with sections/pass marks/placement levels and certificates verifiable by QR at `/v/<code>`, and a Telegram Mini App at `/tg` (signed init data, no third-party script). Verified with typecheck, lint, 379 unit tests, 158 DB tests, 13 Playwright tests (new pages pass the axe scan), `next build` and a clean Docker run; not yet tried against live Click/Uzum/Eskiz accounts or a real bot on an https domain. Next: the AI assistant.
<!-- STATUS:END -->

## Testlar / Tests

```bash
npm test                    # unit (billing, salary, Payme, rules)
npm run test:coverage       # unit + coverage; money code (billing/salary/payments) must stay ≥ 90% lines
npm run test:integration    # database tests (separate lms_test database)
E2E_BASE_URL=http://localhost:3010 npm run test:e2e   # browser + accessibility, on a demo-data stack
DATABASE_URL=... npx tsx scripts/scale-test.ts         # 2 000-student load data (never production)
```

## Ishga tushirish / Run

```bash
cp .env.example .env        # ixtiyoriy: hamma qiymatning standarti bor
docker compose up --build
```

- Ilova / app: http://localhost:3000 (port band bo'lsa `.env` da `WEB_PORT=3010`)
- Tekshiruv / health: http://localhost:3000/api/health
- Bo'sh bazaga demo markaz avtomatik yoziladi (`SEED_DEMO=true`).
- Hammasini o'chirib, noldan boshlash: `docker compose down -v && docker compose up --build`

Containers: `db` (Postgres 16), `migrate` (migratsiya + demo seed, bir marta), `web` (Next.js), `worker` (cron + Telegram bot + xabarlar navbati).

### Demo loginlar (parol hammasida `demo1234`)

| Rol | Telefon | Ism |
|---|---|---|
| Egasi / Owner | 90 123 45 67 | Sardor Akbarov |
| Menejer | 90 123 45 68 | Dilnoza Rahimova (ikkala filial) |
| Administrator | 90 123 45 69 | Malika Tursunova (Chilonzor) |
| Kassir (faqat to'lov) | 90 123 45 70 | Jasur Kamolov (Yunusobod) |
| O'qituvchi | 90 123 45 71 | Aziza Karimova — telefondan `/t` |
| O'qituvchi | 90 123 45 72 | Bobur Aliyev |
| O'qituvchi | 90 123 45 73 | Nodira Saidova |
| Admin + o'qituvchi | 90 123 45 74 | Otabek Yusupov |

Ochiq lid formasi: http://localhost:3000/f/demo

### Telegram bot (ixtiyoriy)

1. @BotFather dan token oling, `.env` ga `TELEGRAM_BOT_TOKEN=...` yozing, `docker compose up -d worker`.
2. Botda `/start` → raqamni yuborish. Raqam ota-ona, o'quvchi yoki xodim telefoniga mos kelsa — ulanadi.
3. Token bo'lmasa bot o'chiq, worker baribir ishlaydi (darslar, hisob-kitob, eslatmalar navbatga yoziladi).

### Payme (ixtiyoriy)

Sozlamalar → Payme: Merchant ID va kalit. Payme kabinetiga endpoint: `<APP_URL>/api/payme`. Kalit bo'lmasa to'lov tugmalari ko'rinmaydi.
Ota-onaga yuboriladigan havola: `<APP_URL>/pay/<familyId>` → Payme checkout.

### Click va Uzum Bank (ixtiyoriy)

- **Click**: Sozlamalar → Click: Service ID, Merchant ID, maxfiy kalit. Click kabinetida Prepare = `<APP_URL>/api/click/prepare`, Complete = `<APP_URL>/api/click/complete` (bitta manzil so'ralsa: `<APP_URL>/api/click/shop`).
- **Uzum Bank**: Sozlamalar → Uzum: serviceId, login, parol (Uzum menejeri beradi). Webhook manzili: `<APP_URL>/api/uzum` (Uzum oxiriga `/check`, `/create`, `/confirm`, `/reverse`, `/status` qo'shadi).
- Ulangan har bir tizim `/pay/<familyId>` sahifasida o'z tugmasi bilan chiqadi; to'lov avtomatik balansga tushadi, bekor qilinsa qaytariladi.

### SMS (ixtiyoriy, Eskiz.uz)

Sozlamalar → SMS: markazning o'z Eskiz email/paroli va yuboruvchi nomi. Qaysi xabarlar SMS bilan ham ketishini belgilang (standart: faqat Telegram'ga ulanmagan oilalarga). Eskiz faqat kabinetda tasdiqlangan shablon matnlarini yuboradi. Lokal Docker'da `SMS_DRY_RUN=true` — SMS yuborilmaydi, worker logiga yoziladi (`docker compose logs worker`).

### Hisobot kartalari, imtihonlar, sertifikatlar

- Guruh → **Oylik hisobot**: har bir o'quvchi uchun davomat, o'rtacha baho, reyting; o'qituvchi izoh yozadi (`/t/reports`), ofis ota-onalarga yuboradi. Ota-ona havolasi: `/rc/<token>`. Sozlamalarda avtomatik yuborish (har oyning N-kuni, 11:00).
- **Imtihonlar** (`/exams`): darajani aniqlash testi (lidlar uchun ham), daraja / yakuniy / mock imtihon, bo'limlar, o'tish bali. Natijalar ota-onalarga yuboriladi, o'tganlarga sertifikat (A4, QR kod).
- **Sertifikatlar** (`/certificates`): istalgan kishi `/v/<kod>` da tekshiradi; o'chirilmaydi — bekor qilinadi.

### Telegram Mini App

Bot tokeni va **https** `APP_URL` bo'lsa, botning menyu tugmasi "📱 Ilova" ni ochadi (`/tg`): balans, to'lash, jadval, davomat, hisobot va sertifikatlar. Telegram Mini App'ni faqat https orqali ochadi, shuning uchun lokal `http://localhost` da tugma chiqmaydi.

### Yangi markaz va platforma admini / Signup and platform admin

- Yangi markaz: http://localhost:3000/signup → markaz, egasi va filial yaratiladi, keyin sozlash ustasi `/setup` ochiladi (istalgan qadamni o'tkazib yuborish mumkin).
- Tarif limiti faol o'quvchilarga qo'yiladi (sinovdagilar hisobga olinmaydi). Limit to'lsa yangi o'quvchini faollashtirib bo'lmaydi; mavjudlari ishlayveradi. To'lov tizimi hali ulanmagan — tarifni platforma admini qo'lda o'zgartiradi.
- Platforma admini (`/platform`): `npx tsx scripts/platform-admin.ts grant 901234567` (Docker'da: `docker compose run --rm migrate npx tsx scripts/platform-admin.ts grant 901234567`). Bu bazadagi belgi — telefon raqami bilan avtomatik berilmaydi; `revoke` bilan olib tashlanadi.

## Ishlab chiqish / Development

```bash
docker compose up -d db                 # faqat Postgres (localhost:5433)
npm install
npm run db:migrate && npm run seed      # bo'sh bazaga demo
npm run dev                              # http://localhost:3000
npm run worker:dev                       # cron + bot
```

| Buyruq | Nima qiladi |
|---|---|
| `npm test` | unit testlar (billing, oylik, Payme, telefon, sanalar, CSV, ruxsatlar) |
| `npm run test:integration` | baza bilan testlar (`lms_test` bazasini o'zi yaratadi) |
| `npm run test:coverage` | unit testlar + qamrov (pul kodi ≥ 90%) |
| `npm run typecheck` / `npm run lint` / `npm run build` | tekshiruvlar |
| `npm run job:nightly` (`job:billing`, `job:reminders`, `job:teacher-reminders`, `job:daily-report`, `job:report-cards`, `job:notifications`, `job:sms`, `job:lessons`) | jobni qo'lda ishga tushirish; sana berish mumkin: `npm run job:nightly -- 2026-10-01`. Docker'da: `docker compose exec worker node run-job.mjs nightly`. Chiqish kodi 2 = shu ish allaqachon ishlayapti (ikki marta ishlamaydi) |
| `npm run seed` | bo'sh bazaga demo markazni yozadi |

Telefondan sinash (bir Wi-Fi tarmog'ida): `.env` da `WEB_BIND=0.0.0.0` — standart holatda ilova faqat shu kompyuterdan ochiladi (`127.0.0.1`).

### Worker jadvali (Asia/Tashkent)

- 00:30 — darslar 60 kun oldinga, guruh holatlari, muzlatishlar, barcha ochiq yozuvlar bo'yicha hisob-kitob (+ qarz xabari)
- 10:00 — yangi oy to'lovi eslatmasi (N kun oldin) va qarz eslatmalari (3/7/14/30 kun)
- 20:00 — davomat belgilanmagan o'qituvchilarga eslatma
- 11:00 — oylik hisobot kartalarini avtomatik yuborish (yoqilgan markazlarda, tanlangan kunda)
- 21:00 — egasi/menejerga kunlik hisobot
- har 5 soniyada — Telegram xabarlar navbati (≤25 xabar/s) va SMS navbati (≤5 SMS/s)

### Muammolar / Troubleshooting

- **`docker compose up` / `docker pull` osilib qolsa** (macOS): Docker Desktop kalitlar zanjiri (keychain) so'rovini kutayotgan bo'lishi mumkin. Ochiq rasm (image)larni kalitsiz tortish:
  ```bash
  mkdir -p /tmp/dcfg && echo '{"cliPluginsExtraDirs":["/Applications/Docker.app/Contents/Resources/cli-plugins"]}' > /tmp/dcfg/config.json
  DOCKER_CONFIG=/tmp/dcfg docker compose up --build
  ```
- **3000 port band**: `.env` da `WEB_PORT=3010` va `APP_URL=http://localhost:3010`.

## Tuzilma / Structure

```
prisma/            schema, migrations, seed-demo.ts (deterministik demo)
src/lib/billing    hisob-kitob dvigateli (sof funksiyalar + testlar), sync.ts (baza)
src/lib/salary     oylik dvigateli + servis
src/lib/payments   Payme, Click, Uzum (sof handlerlar + testlar, Prisma repo'lar)
src/lib/academics  hisobot kartasi va imtihon hisob-kitobi (sof funksiyalar + testlar)
src/lib/sms        Eskiz SMS mijozi, HTML → SMS matni
src/lib/services   darslar, yozuvlar (enrollment), davomat, to'lovlar, lidlar
src/app/(admin)    admin panel sahifalari va server action'lar
src/app/t          o'qituvchi (telefon) sahifalari
src/app/f/[slug]   ochiq lid formasi;  src/app/pay/[id] — to'lov sahifasi (Payme/Click/Uzum)
src/app/tg         Telegram Mini App;  src/app/rc/[token] — ota-ona hisobot kartasi;  src/app/v — sertifikat tekshiruvi
src/worker         cron joblar, xabarlar navbati, Telegram bot (grammY)
tests/             baza bilan integratsion testlar
```

Barcha qarorlar: `HANDOFF.md` (spetsifikatsiya) va `DECISIONS.md` (qo'shimcha qarorlar).
