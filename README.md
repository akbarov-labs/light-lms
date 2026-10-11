# lms-light

O'quv markazlari uchun CRM/LMS (Uzbekiston): lidlar, guruhlar, davomat, oylik to'lovlar, qarzlar, o'qituvchi oyligi, Telegram bot, Payme.
CRM/LMS for private education centers in Uzbekistan.

## Holat / Status

<!-- STATUS:START -->
_Yakuniy holat tekshiruvdan keyin yoziladi._
<!-- STATUS:END -->

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
| `npm run typecheck` / `npm run lint` / `npm run build` | tekshiruvlar |
| `npm run job:nightly` (`job:billing`, `job:reminders`, `job:teacher-reminders`, `job:daily-report`, `job:notifications`, `job:lessons`) | jobni qo'lda ishga tushirish; sana berish mumkin: `npm run job:nightly -- 2026-10-01` |

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
