# lms-light

O'quv markazlari uchun CRM/LMS (Uzbekiston): lidlar, guruhlar, davomat, oylik to'lovlar, qarzlar, o'qituvchi oyligi, Telegram bot, Payme.
CRM/LMS for private education centers in Uzbekistan.

## Holat / Status

<!-- STATUS:START -->
**O'zbekcha (13.10.2026):** MVP tayyor va `docker compose up --build` bilan noldan ishga tushadi (Postgres, migratsiya + demo, web, worker).

Ishlaydi:
- Lidlar (kanban, ochiq forma `/f/demo`, izohlar, o'quvchiga aylantirish), o'quvchilar va oilalar (aka-ukalar bitta hamyon), guruhlar (jadval, xona/o'qituvchi to'qnashuvi tekshiruvi), darslar (bekor qilish, ko'chirish, o'rinbosar).
- Sinov → faollashtirish, ko'chirish, muzlatish, chiqish, chegirma — hammasi avtomatik qayta hisoblanadi (hisob-kitob dvigateli, 60+ test).
- To'lovlar, chek, bekor qilish (faqat ruxsat bilan), qaytarish, qarzdorlar + eslatma, oila hamyoni.
- O'qituvchi oyligi (4 model, bonus/jarima, qulflash, to'landi → xarajat), xarajatlar, hisobotlar, egasi paneli, "Bugun" sahifasi, audit jurnali, CSV eksport (Excel uchun), Excel/CSV import.
- O'qituvchi telefondan `/t`: bugungi darslar, davomat, oylik. O'zbek/rus tili.
- SaaS: yangi markaz o'zi ro'yxatdan o'tadi (`/signup`), 4 qadamli sozlash ustasi (filial/xonalar → kurs → guruh → o'qituvchi), tariflar (Bepul ≤30, Start ≤100, Growth ≤300, Pro ≤1000 faol o'quvchi; Sozlamalar → Tarif), platforma admini (`/platform`: barcha markazlar, tarifni o'zgartirish, markazni o'chirish).
- Sayt (landing) `/` da — kirmagan mehmon uchun: jonli to'lov namunasi (summa → qolgan qarz → chek), imkoniyatlar, narxlar, savollar; uz/ru. Ommaviy oferta va maxfiylik siyosati (`/legal/offer`, `/legal/privacy`, loyiha — yurist tekshirsin); ro'yxatdan o'tishda rozilik belgisi (sana va versiya saqlanadi). Demo server rejimi (`DEMO_MODE=true`: `/demo` parolsiz kirish, xavfli amallar qulf, har kecha 04:00 da qayta tiklanadi). Nom, aloqa va rekvizitlar bitta faylda: `src/config/brand.ts`. Demo video ssenariysi: [docs/DEMO-VIDEO.md](docs/DEMO-VIDEO.md).
- Telegram bot (token qo'yilsa): raqam bo'yicha ulanish, balans, jadval, davomat, to'lov havolasi, o'qituvchi davomati, kunlik hisobot. Payme Merchant API (kalit qo'yilsa).

Tekshirildi: typecheck, lint, 170 unit test, 23 ta baza testi, 9 ta brauzer (Playwright) testi — 26 sahifa WCAG 2.1 AA bo'yicha (axe) xatosiz, telefonda yon tomonga siljimaydi; 2 000 o'quvchili markazda har bir sahifa 0,4 soniyadan tez; `npm audit` bo'yicha ma'lum zaiflik 0 ta (Tailwind 4 ga o'tildi, ko'rinish o'zgarmadi — 21 sahifa piksel bo'yicha solishtirildi); `next build`, noldan Docker (`down -v && up --build`), brauzerda asosiy oqimlar (lid → sinov → faollashtirish → to'lov → chek → bekor qilish, ko'chirish, o'qituvchi telefondan davomat, oylikni qulflash → xarajat → foyda, rus tili); mustaqil ko'rib chiqish topgan barcha xatolar tuzatildi va qayta tekshirildi.

Eslatma: bu Macda 3000-portni boshqa loyiha band qilgan, shuning uchun `.env` da `WEB_PORT=3010` (http://localhost:3010).

Ogohlantirishlar: server xatosi, ish xatosi va eski backup haqida Telegram xabari (`OPS_TELEGRAM_CHAT_ID`). Yangi markaz uchun "Boshlash uchun 4 qadam" va har bir bo'sh sahifada keyingi qadam.

Production (VPS) tayyorgarligi: kirish urinishlarini cheklash (raqam + IP, 15 daqiqa blok, uz/ru xabar), parolni tiklash (ega/menejer — vaqtinchalik parol; xodim — Telegram botdan kod), parol o'zgarsa eski sessiyalar bekor, CSP/HSTS/xavfsiz cookie, kuchsiz `AUTH_SECRET` bilan HTTPS'da ishga tushmaydi. `docker-compose.prod.yml`: Caddy (avtomatik HTTPS), har kecha backup (14 kun) + tiklash skripti, log rotatsiyasi. Qo'llanma: [DEPLOY.md](DEPLOY.md) (shaxsiy ma'lumotlar O'zbekistonda saqlanishi kerak).

Sizdan kerak: mahsulot nomi va rekvizitlar (`src/config/brand.ts`), O'zbekistondagi server + domen, bot tokeni, Payme test kaliti, oferta matnini yurist tekshiruvi, pilot markazlar.

Qolgan / v2: Click, Uzum, SMS, baholar va oylik hisobot kartasi, imtihon va sertifikat, Telegram Mini App. Bot haqiqiy token bilan sinalmagan (token yo'q edi); Payme test kassada sinalmagan (faqat testlar bilan). Haqiqiy domen va Let's Encrypt sertifikati sinalmagan (lokal `localhost` sertifikati bilan sinaldi).

**English:** The full MVP runs from a clean clone with `docker compose up --build`. Everything in HANDOFF §5 marked MVP is built: CRM, groups/lessons/attendance, the billing engine (self-healing, idempotent), payments and debts, teacher salaries, expenses, reports, owner dashboard, teacher mobile pages, Telegram bot, Payme endpoint, CSV export/import, audit log, uz/ru. SaaS onboarding: self-serve signup at `/signup`, a skippable 4-step setup wizard, plan limits on active students (Settings → Plan) and a platform admin area at `/platform` (phones in `PLATFORM_ADMIN_PHONES`). Product site at `/` for visitors (playable payment demo, features, pricing, FAQ; uz/ru), public offer and privacy policy drafts (`/legal/*`, lawyer review pending) with recorded signup consent, a public demo server mode (`DEMO_MODE=true`: password-free `/demo`, risky actions locked, nightly re-seed), brand/contacts/company details in `src/config/brand.ts`, demo video script in `docs/DEMO-VIDEO.md`. Verified with typecheck, lint, 170 unit + 23 DB integration tests, 9 Playwright end-to-end tests (26 pages with zero serious/critical axe WCAG 2.1 AA violations, no sideways scrolling on phones), every page under 0.4 s at 2 000 students (`scripts/scale-test.ts`), 0 known vulnerabilities in production dependencies, production build, a clean Docker run and browser walkthroughs; an independent review's findings were fixed. Production readiness: login limiting (per phone + per IP, DB-backed), password reset (admin temporary password; Telegram code for linked staff), sessions revoked on password change, nonce CSP + HSTS + secure cookies, startup refusal of a weak `AUTH_SECRET` over HTTPS, and `docker-compose.prod.yml` with Caddy auto-HTTPS, nightly backups (14 days) with a restore script and log rotation — see [DEPLOY.md](DEPLOY.md). Dependencies: `npm audit` reports 0 known vulnerabilities after the move to Tailwind 4 (pixel-diffed against Tailwind 3 on 21 pages; see DECISIONS.md). Not verified live: the bot with a real token, Payme against its test cashbox, and a real domain/Let's Encrypt certificate (tested locally with Caddy's localhost certificate). Waiting on the owner: product name and company details, a server in Uzbekistan + domain, bot token, Payme test keys, lawyer review of the legal texts, pilot centers. Next (v2): Click, Uzum, SMS, report cards, exams/certificates, Mini App.
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
| `npm run job:nightly` (`job:billing`, `job:reminders`, `job:teacher-reminders`, `job:daily-report`, `job:notifications`, `job:lessons`) | jobni qo'lda ishga tushirish; sana berish mumkin: `npm run job:nightly -- 2026-10-01`. Docker'da: `docker compose exec worker node run-job.mjs nightly`. Chiqish kodi 2 = shu ish allaqachon ishlayapti (ikki marta ishlamaydi) |
| `npm run seed` | bo'sh bazaga demo markazni yozadi |

Telefondan sinash (bir Wi-Fi tarmog'ida): `.env` da `WEB_BIND=0.0.0.0` — standart holatda ilova faqat shu kompyuterdan ochiladi (`127.0.0.1`).

### Worker jadvali (Asia/Tashkent)

- 00:30 — darslar 60 kun oldinga, guruh holatlari, muzlatishlar, barcha ochiq yozuvlar bo'yicha hisob-kitob (+ qarz xabari)
- 10:00 — yangi oy to'lovi eslatmasi (N kun oldin) va qarz eslatmalari (3/7/14/30 kun)
- 20:00 — davomat belgilanmagan o'qituvchilarga eslatma
- 21:00 — egasi/menejerga kunlik hisobot
- har 5 soniyada — Telegram xabarlar navbati (≤25 xabar/s)

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
src/lib/payments   Payme Merchant API (+ testlar), provider interfeysi (Click/Uzum v2)
src/lib/services   darslar, yozuvlar (enrollment), davomat, to'lovlar, lidlar
src/app/(admin)    admin panel sahifalari va server action'lar
src/app/t          o'qituvchi (telefon) sahifalari
src/app/f/[slug]   ochiq lid formasi;  src/app/pay/[id] — Payme to'lov sahifasi
src/worker         cron joblar, xabarlar navbati, Telegram bot (grammY)
tests/             baza bilan integratsion testlar
```

Barcha qarorlar: `HANDOFF.md` (spetsifikatsiya) va `DECISIONS.md` (qo'shimcha qarorlar).
