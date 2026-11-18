# DEPLOY — lms-light'ni VPS'ga o'rnatish

O'zbekcha birinchi, [English below](#english).

Bitta oddiy Ubuntu VPS'da hammasi Docker ichida ishlaydi: **Caddy** (avtomatik HTTPS) → **web** (Next.js) → **Postgres**, yonida **worker** (Telegram bot + jadval ishlari) va **backup** (har kecha `pg_dump`, 14 kun saqlanadi). Pullik xizmat kerak emas.

---

## 0. Muhim: shaxsga doir ma'lumotlar O'zbekistonda saqlanishi kerak

Tizimda o'quvchilar, ota-onalar va xodimlarning ismi, telefoni, tug'ilgan sanasi, to'lovlari saqlanadi — bu **shaxsga doir ma'lumotlar**.
"Shaxsga doir ma'lumotlar to'g'risida"gi Qonun (O'RQ-547, 27¹-modda, 2021-yildan) O'zbekiston fuqarolarining shaxsga doir ma'lumotlarini **O'zbekiston hududidagi serverlarda** to'plash, saqlash va qayta ishlashni talab qiladi. Ma'lumotlar bazasini davlat reyestrida ro'yxatdan o'tkazish talabi ham bor.

Shuning uchun:
- VPS'ni **O'zbekistondagi data-markazda** joylashgan provayderdan oling (chet eldagi Hetzner/DigitalOcean va h.k. emas).
- Zaxira nusxalarni ham O'zbekistondagi boshqa serverga yoki markazning o'z kompyuteriga ko'chiring.
- Sotishdan oldin yurist bilan tekshiring (bu yuridik maslahat emas).

## 1. Nima kerak

- Ubuntu 22.04 yoki 24.04 VPS: kamida 2 vCPU, 2 GB RAM (4 GB tavsiya), 40 GB disk.
- Domen yoki subdomen (masalan `crm.markaz.uz`) va uning DNS sozlamalariga kirish.
- Kompyuteringizda SSH.

## 2. Serverni tayyorlash

```bash
ssh root@SERVER_IP
apt update && apt -y upgrade
adduser lms && usermod -aG sudo lms          # alohida foydalanuvchi
rsync --archive --chown=lms:lms ~/.ssh /home/lms   # SSH kalitingizni ko'chirish
```

Faqat 22, 80 va 443 portlarni ochiq qoldiring:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw enable
apt -y install unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
```

Docker o'rnatish (rasmiy skript) va `lms` foydalanuvchisiga ruxsat:

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker lms
```

Keyin `lms` bo'lib qayta kiring: `ssh lms@SERVER_IP`.

> Eslatma: Docker o'zi ochgan portlar `ufw`'ni aylanib o'tadi. `docker-compose.prod.yml` faqat 80 va 443 ni ochadi; baza va ilova porti tashqariga chiqmaydi.

## 3. DNS

Domen panelida **A yozuv**: `crm.markaz.uz → SERVER_IP`. Tekshirish: `ping crm.markaz.uz` server IP'sini ko'rsatishi kerak. Bu ishlamasa, Caddy sertifikat ololmaydi.

## 4. Kodni joylash va sozlash

```bash
git clone <repo-url> lms-light && cd lms-light      # yoki arxivni scp bilan yuklang
cp .env.prod.example .env
openssl rand -hex 24        # → POSTGRES_PASSWORD
openssl rand -base64 32     # → AUTH_SECRET
nano .env                   # DOMAIN, POSTGRES_PASSWORD, AUTH_SECRET, (ixtiyoriy) TELEGRAM_BOT_TOKEN
chmod 600 .env
```

`AUTH_SECRET` kuchsiz yoki namunadagi qiymat bo'lsa, ilova HTTPS rejimida **ishga tushmaydi** (logda sababi yoziladi).

## 5. Ishga tushirish

```bash
docker compose -f docker-compose.prod.yml config --quiet && echo OK   # .env to'g'riligini tekshirish
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
curl -s https://crm.markaz.uz/api/health        # {"ok":true,"db":"up",...}
```

Birinchi build 3–6 daqiqa davom etadi. Caddy sertifikatni o'zi oladi va yangilab turadi.

## 6. Birinchi markaz va egasi

Production bazasi bo'sh boshlanadi (`SEED_DEMO=false`). Markaz, birinchi filial va egasini yarating:

```bash
docker compose -f docker-compose.prod.yml run --rm migrate \
  npx tsx scripts/create-owner.ts --center "Ziyo O'quv Markazi" --slug ziyo --name "Sardor Akbarov" --phone 901234567
```

Skript **vaqtinchalik parol** chiqaradi. Birinchi kirishda ega o'z parolini o'rnatadi. Keyin Sozlamalar → Xodimlar orqali boshqa xodimlarni qo'shadi.

## 7. Telegram bot (ixtiyoriy, lekin tavsiya)

@BotFather'dan token oling → `.env` dagi `TELEGRAM_BOT_TOKEN` → `docker compose -f docker-compose.prod.yml up -d worker web`.
Bot ota-onalarga balans va eslatmalar yuboradi, o'qituvchilarga davomat, xodimlarga **parol tiklash kodi** (`/parol` buyrug'i yoki saytdagi "Parolni unutdingizmi?").

## 8. Xavfsizlik (ilovada nima bor)

- **Kirish urinishlari cheklangan**: bitta raqamga 15 daqiqada 5 ta noto'g'ri parol → 15 daqiqa blok; bitta IP'dan 15 daqiqada 30 ta. Xabar o'zbek/rus tilida.
- **Parolni tiklash**: ega/menejer Sozlamalar → Xodimlar → ⋯ → "Parolni tiklash" (vaqtinchalik parol, birinchi kirishda almashtiriladi). Xodim Telegram botga ulangan bo'lsa — 6 xonali kod (10 daqiqa, 5 urinish).
- Parol o'zgarganda eski sessiyalar (boshqa qurilmalar) bekor bo'ladi.
- HTTPS, HSTS, CSP (nonce), `frame-ancestors 'none'`, `Secure`/`HttpOnly` cookie.
- Oxirgi chora (yagona ega parolni unutdi va Telegram ulanmagan):
  ```bash
  docker compose -f docker-compose.prod.yml run --rm migrate npx tsx scripts/reset-password.ts 901234567
  ```
- **Platforma admini** (`/platform`: barcha markazlar, tarif, markazni o'chirish) faqat server operatori tomonidan beriladi — telefon raqami bilan emas, bazadagi belgi bilan (audit jurnaliga yoziladi):
  ```bash
  docker compose -f docker-compose.prod.yml run --rm migrate npx tsx scripts/platform-admin.ts grant 901234567
  docker compose -f docker-compose.prod.yml run --rm migrate npx tsx scripts/platform-admin.ts revoke 901234567
  ```
- `AUTH_SECRET` namunadagi/dev qiymatda bo'lsa, `APP_URL` `localhost` bo'lmagan har qanday serverda (http bo'lsa ham) ilova ishga tushmaydi.
- `X-Forwarded-For` faqat `TRUST_PROXY=true` bo'lsa ishoniladi (prod compose'da Caddy orqasida yoqilgan). Ilovani proksisiz ochiq portda ishlatsangiz — `false` qoldiring, aks holda IP bo'yicha cheklovlarni chetlab o'tish mumkin.

## 9. Zaxira nusxalar (backup)

- Har kecha **02:30 (Toshkent)** `backup` konteyneri `pg_dump` qiladi → `./backups/lms-YYYYMMDD-HHMMSS.dump`. **14 kundan** eskilari o'chiriladi (`BACKUP_KEEP_DAYS`). Yangi nusxa muvaffaqiyatli bo'lgandagina eskilari o'chadi.
- Hozir qo'lda nusxa olish:
  ```bash
  docker compose -f docker-compose.prod.yml exec backup sh /usr/local/bin/backup.sh
  ```
- Jurnal: `docker compose -f docker-compose.prod.yml logs backup`
- **Serverdan tashqariga ham ko'chiring** (server yo'qolsa, nusxalar ham yo'qoladi), masalan har kuni boshqa kompyuterdan:
  ```bash
  rsync -av lms@SERVER_IP:lms-light/backups/ ~/lms-backups/
  ```
  `.env` faylining nusxasini ham xavfsiz joyda saqlang.

### Tiklash (restore)

```bash
./deploy/restore.sh backups/lms-20261012-023000.dump
```

Skript: avval hozirgi bazadan xavfsizlik nusxasini oladi → web va worker'ni to'xtatadi → bazani bitta tranzaksiyada tiklaydi (`pg_restore --clean --single-transaction`) → migratsiyalarni qo'llaydi → web va worker'ni qayta yoqadi.
Faylni istalgan joydan berish mumkin (skript uni backup konteyneriga ko'chiradi va avval tekshiradi). **Oyiga bir marta tiklashni sinab ko'ring** (masalan test serverda) — tekshirilmagan backup backup emas.

## 10. Yangilash

```bash
cd lms-light
docker compose -f docker-compose.prod.yml exec backup sh /usr/local/bin/backup.sh   # avval nusxa
git pull
docker compose -f docker-compose.prod.yml up -d --build    # migratsiyalar avtomatik
docker image prune -f
```

## 11. Loglar

```bash
docker compose -f docker-compose.prod.yml logs -f --tail=100 web worker caddy
```
Har bir konteyner logi 10 MB × 5 fayl bilan cheklangan (disk to'lib qolmaydi).

## 11a. Sayt, demo server va brend

- **Sayt (landing)**: tizimga kirmagan mehmon `/` manzilida mahsulot sahifasini ko'radi (narxlar, savollar, oferta). Xodim kirgan bo'lsa — o'z paneli.
- **Nom, aloqa, rekvizitlar**: hammasi bitta faylda — `src/config/brand.ts` (`name`, `contact`, `legal`). To'ldirgach qayta build qiling. `legal.entity` bo'sh bo'lsa, oferta va maxfiylik sahifalarida "loyiha" belgisi chiqadi.
- **Demo server** (alohida, ikkinchi kichik VPS yoki shu serverda boshqa papka/domen, masalan `demo.example.uz`): `.env` da `DEMO_MODE=true`, `SEED_DEMO=true`, `MAIN_SITE_URL=https://crm.example.uz`. Mehmon `/demo` orqali parolsiz demo markazga kiradi; parollar, xodimlar va markaz sozlamalari qulflangan; har kecha 04:00 da baza tozalanib, bugungi sana bilan qayta to'ldiriladi (qo'lda: `docker compose -f docker-compose.prod.yml exec worker node run-job.mjs demo-reset`).
- **Asosiy serverda** `DEMO_URL=https://demo.example.uz/demo` qo'ying — saytda "Demoni ko'rish" tugmasi paydo bo'ladi.
- ⚠️ `DEMO_MODE=true` ni **hech qachon** haqiqiy markazlar bor serverga qo'ymang. Himoya bor: 2 kundan eski boshqa markaz topilsa, tozalash to'xtaydi — lekin bunga tayanmang.

## 11b. Ogohlantirishlar (monitoring, bepul)

- `.env` da `TELEGRAM_BOT_TOKEN` va `OPS_TELEGRAM_CHAT_ID` (o'z chat ID'ingiz: botga yozing, so'ng `https://api.telegram.org/bot<TOKEN>/getUpdates` dan `message.chat.id`) qo'ying.
- Shunda Telegram'ga xabar keladi: saytda server xatosi, tungi ish (hisob-kitob, eslatma) xatosi, worker to'xtashi, **har kuni 09:00 da oxirgi backup 26 soatdan eski bo'lsa**. Bir xil xabar 10 daqiqada bir martadan ko'p kelmaydi.
- Qo'shimcha (ixtiyoriy): bepul tashqi tekshiruv (masalan, UptimeRobot) `https://<domen>/api/health` manzilini har 5 daqiqada tekshirsin — server butunlay o'chsa ham bilasiz.
- Worker'ning o'z tekshiruvi bor: har 30 soniyada "yurak urishi" fayli yangilanadi; 2 daqiqadan eski bo'lsa `docker compose ps` da worker `unhealthy` ko'rinadi. Worker ishlar ustma-ust tushmaydi (ikkinchi nusxa yoki qo'lda ishga tushirilgan ish o'tkazib yuboriladi).

## 11c. Bizning sayt va demo: sabaq.uz

sabaq.uz (avval sabaq.akbarovlabs.uz) — Sabaq sayti va demosi, akbarov-labs umumiy serverida (Contabo, chet elda) turadi — faqat namunaviy ma'lumot, har kecha tozalanadi. **Haqiqiy markazlar bu serverga qo'yilmaydi** (§0): ular uchun O'zbekistondagi VPS va shu hujjatdagi oddiy o'rnatish.

- Fayllar: `deploy/server/docker-compose.prod.yml` (demo, `/opt/apps/sabaq`) va `docker-compose.staging.yml` (`/opt/apps/sabaq-staging`, parol bilan, `sabaq.staging.sarvarlogs.uz`). Ikkalasi serverda root'niki; CI faqat image tegini aytadi.
- `main`'ga har push → tekshiruv (lint, typecheck, testlar) → 3 ta image (`ghcr.io/akbarov-labs/light-lms/{web,worker,tools}`) → staging. Demoga: Actions → **Promote to production** → Run workflow.
- Demo serverda `MAIN_SITE_URL` bo'sh: `/signup` forma o'rniga aloqani ko'rsatadi, ro'yxatdan o'tish yopiq. `SALES_AGENT=true` bilan saytdagi "Bog'lanish" havolalari botga boradi: yangi mijozlarga Sabaqning AI yordamchisi javob beradi, lid va savollar `SALES_TELEGRAM_CHAT_ID` (yoki `OPS_TELEGRAM_CHAT_ID`) chatiga keladi; o'sha xabarga reply qilsangiz, javob mijozga boradi.
- sabaq.uz ga ko'chish (bir marta, serverda): 1) DNS: `sabaq.uz` va `www.sabaq.uz` A yozuvi → 169.58.243.86. 2) `/opt/apps/sabaq/.env`: `DOMAIN=sabaq.uz`, `APP_URL=https://sabaq.uz`, `SALES_AGENT=true` (kerak bo'lsa `SALES_TELEGRAM_CHAT_ID`). 3) Serverdagi compose nusxasini yangilang (`deploy/prepare-app sabaq ~/dev/sites/light-lms/deploy/server`, Reads repo `docs/add-app.md`): unda `SALES_*` o'zgaruvchilari va `sabaq.akbarovlabs.uz` → `https://sabaq.uz` 301 yorlig'i bor; edge-caddy domenni yorliqdan o'qiydi, sertifikatni o'zi oladi. 4) Actions → **Promote to production**. `www.sabaq.uz` uchun avval DNS yozuvi, so'ng uni `caddy_1` qatoriga qo'shing. Bot Mini App manzilini `APP_URL` dan oladi.
- Serverga birinchi marta qo'shish — Reads reposidagi `docs/add-app.md`: `deploy/prepare-app sabaq ~/dev/sites/light-lms/deploy/server`, so'ng serverda `sudo add-app --images "web worker tools" --up-flags "--remove-orphans" sabaq ghcr.io/akbarov-labs/light-lms <.env bor papka>`.

## 12. Muammolar

- **Sertifikat olinmadi**: DNS A yozuvini, 80/443 portlar ochiqligini tekshiring; `logs caddy`.
- **web ishga tushmaydi, logda "weak AUTH_SECRET"**: `.env` da `AUTH_SECRET=$(openssl rand -base64 32)` qiymatini qo'ying.
- **Xodim bloklandi** (ko'p noto'g'ri parol): 15 daqiqa kuting yoki ega/menejer parolni tiklasin — tiklash blokni ham olib tashlaydi.
- **Disk to'ldi**: `docker system df`, `du -sh backups`; `BACKUP_KEEP_DAYS` ni kamaytiring.

---

<a id="english"></a>
# DEPLOY — installing lms-light on a VPS (English)

Everything runs in Docker on one plain Ubuntu VPS: **Caddy** (automatic HTTPS) → **web** (Next.js) → **Postgres**, plus **worker** (Telegram bot + scheduled jobs) and **backup** (nightly `pg_dump`, kept 14 days). No paid services.

## 0. Important: Uzbek personal data must stay in Uzbekistan

The system stores names, phones, birth dates and payments of students, parents and staff — **personal data**.
The Law "On Personal Data" (ZRU-547, Article 27¹, in force since 2021) requires personal data of Uzbek citizens to be collected, stored and processed **on servers physically located in Uzbekistan**, and personal-data databases to be registered in the state register.

So:
- Rent the VPS from a provider with a **data center in Uzbekistan** (not Hetzner/DigitalOcean abroad).
- Copy backups to another machine in Uzbekistan (or the center's own computer).
- Check with a lawyer before selling (this is not legal advice).

## 1. Requirements

Ubuntu 22.04/24.04, ≥2 vCPU, 2 GB RAM (4 GB recommended), 40 GB disk; a (sub)domain and access to its DNS; SSH.

## 2. Prepare the server

```bash
ssh root@SERVER_IP
apt update && apt -y upgrade
adduser lms && usermod -aG sudo lms
rsync --archive --chown=lms:lms ~/.ssh /home/lms
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw enable
apt -y install unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
curl -fsSL https://get.docker.com | sh
usermod -aG docker lms
```
Log in again as `lms`. Ports published by Docker bypass `ufw`; the prod compose file publishes only 80 and 443 (database and app ports stay internal).

## 3. DNS

Create an **A record** `crm.example.uz → SERVER_IP`. Caddy cannot get a certificate until it resolves.

## 4. Code and settings

```bash
git clone <repo-url> lms-light && cd lms-light
cp .env.prod.example .env
openssl rand -hex 24        # → POSTGRES_PASSWORD
openssl rand -base64 32     # → AUTH_SECRET
nano .env                   # DOMAIN, POSTGRES_PASSWORD, AUTH_SECRET, optional TELEGRAM_BOT_TOKEN
chmod 600 .env
```
Over HTTPS the app **refuses to start** with a weak or example `AUTH_SECRET` (the reason is logged).

## 5. Start

```bash
docker compose -f docker-compose.prod.yml config --quiet && echo OK
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
curl -s https://crm.example.uz/api/health
```

## 6. First center and owner

The production database starts empty (`SEED_DEMO=false`):
```bash
docker compose -f docker-compose.prod.yml run --rm migrate \
  npx tsx scripts/create-owner.ts --center "Ziyo Learning Center" --slug ziyo --name "Owner Name" --phone 901234567
```
It prints a **temporary password**; the owner sets their own at first sign-in, then adds staff in Settings → Staff.

## 7. Telegram bot (optional, recommended)

Put the @BotFather token in `TELEGRAM_BOT_TOKEN`, then `docker compose -f docker-compose.prod.yml up -d worker web`. The bot also delivers **password reset codes** to staff (`/parol` command, or "Forgot password?" on the login page).

## 8. Security built into the app

- **Login limiting**: 5 wrong passwords per phone in 15 min → 15-min lock; 30 failures per IP in 15 min. Message in Uzbek/Russian.
- **Password reset**: owner/manager → Settings → Staff → ⋯ → "Reset password" (temporary password, must be changed at next sign-in); staff linked to the bot can get a 6-digit code (10 min, 5 tries).
- Changing a password signs out all other sessions.
- HTTPS, HSTS, nonce-based CSP, `frame-ancestors 'none'`, `Secure`/`HttpOnly` cookies.
- Last resort (the only owner lost the password, no Telegram link):
  `docker compose -f docker-compose.prod.yml run --rm migrate npx tsx scripts/reset-password.ts 901234567`
- **Platform admin** (`/platform`: every center, plans, disabling a center) is a database flag granted only by the server operator — never by phone number; every change is audited:
  `docker compose -f docker-compose.prod.yml run --rm migrate npx tsx scripts/platform-admin.ts grant 901234567` (`revoke` to take it away).
- With the example/dev `AUTH_SECRET` the app refuses to start on any host other than `localhost`, even over plain http.
- `X-Forwarded-For` is trusted only when `TRUST_PROXY=true` (set in the prod compose, behind Caddy). Running the app on an open port without a proxy? Leave it `false`, otherwise anyone can dodge the per-IP limits.

## 9. Backups

- Nightly at **02:30 Asia/Tashkent** the `backup` service writes `./backups/lms-YYYYMMDD-HHMMSS.dump` (`pg_dump -Fc`, verified with `pg_restore --list`) and deletes dumps older than **14 days** — only after a successful new dump.
- Backup now: `docker compose -f docker-compose.prod.yml exec backup sh /usr/local/bin/backup.sh`
- Copy them **off the server** daily, e.g. `rsync -av lms@SERVER_IP:lms-light/backups/ ~/lms-backups/`, and keep a copy of `.env`.

### Restore

```bash
./deploy/restore.sh backups/lms-20261012-023000.dump
```
Takes a safety backup of the current database, stops web and worker, restores in one transaction (`pg_restore --clean --if-exists --single-transaction`), applies migrations, starts web and worker. The dump can be anywhere (the script copies it into the backup container and checks it first). **Test a restore monthly** on a spare machine.

## 10. Updating

```bash
docker compose -f docker-compose.prod.yml exec backup sh /usr/local/bin/backup.sh
git pull
docker compose -f docker-compose.prod.yml up -d --build     # migrations run automatically
docker image prune -f
```

## 11. Logs

`docker compose -f docker-compose.prod.yml logs -f --tail=100 web worker caddy` — every container's log is capped at 10 MB × 5 files.

## 12. Trying the production setup on a laptop

`DOMAIN=localhost`, `HTTP_PORT=8080`, `HTTPS_PORT=8443`, `APP_URL=https://localhost:8443` in a test env file, then
`docker compose -f docker-compose.prod.yml --env-file <that file> up -d --build`. Caddy serves `localhost` with its own local certificate (the browser warns; that is expected).

## 13. Site, demo server and brand

- **Landing**: visitors without a session see the product site at `/` (pricing, FAQ, legal links); signed-in staff get their dashboard.
- **Name, contacts, company details**: one file, `src/config/brand.ts` (`name`, `contact`, `legal`); rebuild after editing. While `legal.entity` is empty the offer and privacy pages carry a "draft" note.
- **Demo server** (separate, e.g. `demo.example.uz`): `DEMO_MODE=true`, `SEED_DEMO=true`, `MAIN_SITE_URL=https://crm.example.uz`. `/demo` signs visitors in as the demo owner with no password; passwords, staff and center settings are locked; at 04:00 every night the database is wiped and re-seeded dated to today (by hand: `docker compose -f docker-compose.prod.yml exec worker node run-job.mjs demo-reset`).
- **Main server**: set `DEMO_URL=https://demo.example.uz/demo` to show "See the demo" on the landing page.
- ⚠️ **Never** set `DEMO_MODE=true` on the server with real centers. The reset refuses to run if it finds another center older than two days, but do not rely on that.

## 14. Alerts (free monitoring)

- Set `TELEGRAM_BOT_TOKEN` and `OPS_TELEGRAM_CHAT_ID` (your chat id: message the bot, then read `message.chat.id` at `https://api.telegram.org/bot<TOKEN>/getUpdates`).
- You then get a Telegram message for server errors, failed nightly jobs, a worker crash, and **at 09:00 daily if the newest backup is older than 26 hours**. The same alert repeats at most every 10 minutes.
- Optional: a free external check (e.g. UptimeRobot) on `https://<domain>/api/health` every 5 minutes tells you when the whole server is down.
- The worker has its own health signal: a heartbeat file touched every 30 s; older than 2 minutes → `docker compose ps` shows the worker `unhealthy`. Jobs never overlap (a second replica or a manual run while the job is running is skipped).

## 15. Our site and demo: sabaq.uz

sabaq.uz (formerly sabaq.akbarovlabs.uz) is Sabaq's site and public demo, on the shared akbarov-labs server (Contabo, abroad): sample data only, wiped every night. **Real centers never go on that server** (§0): they get a VPS in Uzbekistan with the plain setup above.

- Files: `deploy/server/docker-compose.prod.yml` (the demo, `/opt/apps/sabaq`) and `docker-compose.staging.yml` (`/opt/apps/sabaq-staging`, password protected, `sabaq.staging.sarvarlogs.uz`). Both are root-owned on the server; CI only names the image tag.
- Every push to `main` → checks (lint, typecheck, unit tests) → three images (`ghcr.io/akbarov-labs/light-lms/{web,worker,tools}`) → staging. To the demo: Actions → **Promote to production** → Run workflow.
- The demo has no `MAIN_SITE_URL`, so `/signup` shows the contacts instead of the form and signing up is closed. With `SALES_AGENT=true` the site's contact links go to the bot: Sabaq's AI assistant answers new customers, leads and questions arrive in `SALES_TELEGRAM_CHAT_ID` (or `OPS_TELEGRAM_CHAT_ID`), and a reply to such a message goes back to the customer.
- Moving to sabaq.uz (once, on the server): 1) DNS: A records for `sabaq.uz` and `www.sabaq.uz` → 169.58.243.86. 2) `/opt/apps/sabaq/.env`: `DOMAIN=sabaq.uz`, `APP_URL=https://sabaq.uz`, `SALES_AGENT=true` (and `SALES_TELEGRAM_CHAT_ID` if not the ops chat). 3) Refresh the compose file on the server (`deploy/prepare-app sabaq ~/dev/sites/light-lms/deploy/server`, Reads repo `docs/add-app.md`): it passes the `SALES_*` variables and carries the `sabaq.akbarovlabs.uz` → `https://sabaq.uz` 301 label; edge-caddy reads the domain off the labels and gets the certificate itself. 4) Actions → **Promote to production**. For `www.sabaq.uz`, add its DNS record first, then add it to the `caddy_1` line. The bot takes its Mini App URL from `APP_URL`.
- Adding it to the server the first time follows `docs/add-app.md` in the Reads repo: `deploy/prepare-app sabaq ~/dev/sites/light-lms/deploy/server`, then on the server `sudo add-app --images "web worker tools" --up-flags "--remove-orphans" sabaq ghcr.io/akbarov-labs/light-lms <folder with the .env>`.
