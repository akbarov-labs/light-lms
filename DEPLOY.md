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
Fayl `BACKUP_DIR` papkasida (standart: `./backups`) bo'lishi kerak. **Oyiga bir marta tiklashni sinab ko'ring** (masalan test serverda) — tekshirilmagan backup backup emas.

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

## 9. Backups

- Nightly at **02:30 Asia/Tashkent** the `backup` service writes `./backups/lms-YYYYMMDD-HHMMSS.dump` (`pg_dump -Fc`, verified with `pg_restore --list`) and deletes dumps older than **14 days** — only after a successful new dump.
- Backup now: `docker compose -f docker-compose.prod.yml exec backup sh /usr/local/bin/backup.sh`
- Copy them **off the server** daily, e.g. `rsync -av lms@SERVER_IP:lms-light/backups/ ~/lms-backups/`, and keep a copy of `.env`.

### Restore

```bash
./deploy/restore.sh backups/lms-20261012-023000.dump
```
Takes a safety backup of the current database, stops web and worker, restores in one transaction (`pg_restore --clean --if-exists --single-transaction`), applies migrations, starts web and worker. The file must be inside `BACKUP_DIR` (default `./backups`). **Test a restore monthly** on a spare machine.

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
