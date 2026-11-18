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
- sabaq.uz ga ko'chish (bir marta, serverda): 1) DNS: `sabaq.uz` va `www.sabaq.uz` A yozuvi → 169.58.243.86. 2) `/opt/apps/sabaq/.env`: `DOMAIN=sabaq.uz`, `APP_URL=https://sabaq.uz`, `SALES_AGENT=true`, hamda yordamchi ishlashi uchun `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY` va `OPS_TELEGRAM_CHAT_ID` (yoki `SALES_TELEGRAM_CHAT_ID`). 3) Serverdagi compose nusxasini yangilang (quyidagi "Serverdagi compose faylini o'zgartirish" bandi): unda `SALES_*` o'zgaruvchilari va `sabaq.akbarovlabs.uz` → `https://sabaq.uz` 301 yorlig'i bor; edge-caddy domenni yorliqdan o'qiydi, sertifikatni o'zi oladi. 4) Actions → **Promote to production**. `www.sabaq.uz` uchun avval DNS yozuvi, so'ng uni `caddy_1` qatoriga qo'shing. Bot Mini App manzilini `APP_URL` dan oladi.
- Serverga birinchi marta qo'shish — Reads reposidagi `docs/add-app.md`: `deploy/prepare-app sabaq ~/dev/sites/light-lms/deploy/server`, so'ng serverda `sudo add-app --images "web worker tools" --up-flags "--remove-orphans" sabaq ghcr.io/akbarov-labs/light-lms <.env bor papka>`.
- Serverdagi compose faylini o'zgartirish (yangi o'zgaruvchi yoki Caddy yorlig'i): deploy `/opt/apps/sabaq/docker-compose.prod.yml` dagi root nusxasidan foydalanadi, CI uni yangilamaydi. `prepare-app` + `add-app` faqat birinchi qo'shish uchun: `add-app` bor faylni hech qachon almashtirmaydi. Mac'da: `git show origin/main:deploy/server/docker-compose.prod.yml | ssh sarvar@169.58.243.86 'cat > /tmp/sabaq-compose.prod.yml'`; serverda: `sudo cp /opt/apps/sabaq/docker-compose.prod.yml{,.bak}`, `sudo install -m 644 -o root -g root /tmp/sabaq-compose.prod.yml /opt/apps/sabaq/docker-compose.prod.yml`, tekshirish `sudo grep <o'zgaruvchi> /opt/apps/sabaq/docker-compose.prod.yml`; so'ng **Promote to production**. Staging uchun xuddi shu, `/opt/apps/sabaq-staging/docker-compose.staging.yml`.

## 11d. Haqiqiy markazlar serveri: sabaq.uz O'zbekistonda

Hozir sabaq.uz — demo (Contabo, har kecha tozalanadi), unda haqiqiy markaz ochib bo'lmaydi. Reja: sayt va haqiqiy markazlar O'zbekistondagi VPS'ga, demo esa `demo.sabaq.uz` ga o'tadi.

| Server | Manzil | Nima | Bot |
|---|---|---|---|
| O'zbekistondagi VPS (shu hujjatdagi oddiy o'rnatish, `docker-compose.prod.yml`) | `sabaq.uz` (+ `www`) | sayt, haqiqiy markazlar, `/signup` ochiq, Sabaqning AI yordamchisi | @sabaquz_bot |
| Contabo, `/opt/apps/sabaq` | `demo.sabaq.uz` | demo, har kecha tozalanadi; `/signup` sabaq.uz ga yuboradi | alohida demo bot |

`sabaq.akbarovlabs.uz` o'zi `demo.sabaq.uz` ga yo'naladi (serverdagi compose yorlig'i `DOMAIN` dan oladi), compose'ni o'zgartirish kerak emas.

**A. Tayyorgarlik** (hech narsa buzilmaydi):
1. O'zbekistondagi data-markazdan VPS (§0, §1: 2 vCPU, 4 GB RAM, 40 GB).
2. @BotFather: demo uchun yangi bot (masalan `@sabaq_demo_bot`), rasmi `public/brand/sabaq-avatar-512.png`.
3. DNS: `sabaq.uz` va `www.sabaq.uz` TTL'ini 300 ga tushiring; `demo.sabaq.uz` A → 169.58.243.86; `uz.sabaq.uz` A → yangi VPS IP.
4. VPS'da §2–5. `.env` (`.env.prod.example` dan): `DOMAIN=uz.sabaq.uz`, `POSTGRES_PASSWORD`, `AUTH_SECRET`, `OPS_TELEGRAM_CHAT_ID`; `TELEGRAM_BOT_TOKEN` hozircha **bo'sh** (@sabaquz_bot'ni Contabo ishlatyapti). Kod: `git checkout <sinalgan commit>`.
5. Sinov: `https://uz.sabaq.uz/api/health`; o'zingizga platforma admini (§8 `platform-admin.ts grant`); `create-owner.ts` bilan test markaz, kirib ko'ring, so'ng `/platform` dan o'chiring.

**B. Ko'chish** (taxminan 15 daqiqa; sayt to'xtamaydi, bot bir necha daqiqa javob bermaydi):
6. DNS: `sabaq.uz` va `www.sabaq.uz` A → VPS IP.
7. Darhol, VPS `.env`: `DOMAIN=sabaq.uz`, `EXTRA_DOMAINS=www.sabaq.uz uz.sabaq.uz`, `DEMO_URL=https://demo.sabaq.uz/demo` → `docker compose -f docker-compose.prod.yml up -d`. Caddy sertifikatni o'zi oladi (`logs caddy`). DNS o'zgarmasdan oldin `DOMAIN=sabaq.uz` qo'ymang: Let's Encrypt muvaffaqiyatsiz urinishlardan keyin bir soatgacha kuttiradi.
8. Contabo `/opt/apps/sabaq/.env`: `DOMAIN=demo.sabaq.uz`, `APP_URL=https://demo.sabaq.uz`, `MAIN_SITE_URL=https://sabaq.uz`, `TELEGRAM_BOT_TOKEN=<demo bot>`, `SALES_AGENT=` va `SALES_TELEGRAM_CHAT_ID=` bo'sh → Actions → **Promote to production**. Endi @sabaquz_bot bo'sh.
9. VPS `.env`: `TELEGRAM_BOT_TOKEN=<@sabaquz_bot>`, `SALES_AGENT=true`, `ANTHROPIC_API_KEY` (kerak bo'lsa `SALES_TELEGRAM_CHAT_ID`) → `docker compose -f docker-compose.prod.yml up -d web worker`.
10. Tekshirish: `sabaq.uz/api/health`; `www.sabaq.uz` va `uz.sabaq.uz` → 301 sabaq.uz; `sabaq.akbarovlabs.uz` → demo.sabaq.uz; `demo.sabaq.uz/demo` ochiladi; `sabaq.uz/signup` forma; saytda "Demoni ko'rish"; botga markaz havolasisiz yozing — yordamchi javob beradi.

⚠️ Bitta bot tokeni bilan bir vaqtda faqat bitta server ishlaydi: 8-qadamdan oldin VPS'ga @sabaquz_bot tokenini qo'ymang. Ko'chishdan oldingi sotuv suhbatlari demo bazasida qoladi: ularning jamoa chatidagi xabariga reply endi yetmaydi, mijozga o'zingiz yozing.

**C. Keyin:** zaxira nusxalarni O'zbekistondagi boshqa joyga ko'chiring (§9); yangilash — §10 (`git pull`, build). Bazani davlat reyestrida ro'yxatdan o'tkazish va yurist (§0). `ANTHROPIC_API_KEY` suhbatlarni AQShdagi xizmatga yuboradi: Sabaq yordamchisi faqat markaz egalari bilan gaplashadi va raqam modelga bormaydi; markazlarning o'z AI agentini (Sozlamalar) yurist tasdiqlamaguncha yoqmang.

**D. Birinchi markaz.**
1. Mijozdan oling: markaz nomi, egasining ismi va telefoni; filiallar; kurslar va narxi; guruhlar (kurs, o'qituvchi, kunlar, vaqt, xona); o'qituvchilar (ism, telefon, oylik qoidasi); o'quvchilar Excel'da: Familiya, Ism, Telefon, Ota-ona telefoni, Guruh kodi (#), Balans (qarz minus bilan).
2. Markaz va ega: `docker compose -f docker-compose.prod.yml run --rm migrate npx tsx scripts/create-owner.ts --center "<nom>" --slug <slug> --name "<ega>" --phone <telefon>` → vaqtinchalik parolni egaga bering (ega o'zi `sabaq.uz/signup` dan ham ochishi mumkin).
3. Ega kiradi → sozlash ustasi (filial, kurs, guruh, o'qituvchi) → Sozlamalar → Xodimlar: qolgan o'qituvchi va administratorlar → qolgan kurs va guruhlar → O'quvchilar → Import: Excel'ni "CSV UTF-8" qilib yuklang (eski qarz va oldindan to'lov ochilish balansi bo'ladi; qayta yuklash ikki marta yaratmaydi).
4. Ota-onalar va o'qituvchilar @sabaquz_bot'ga /start → "raqamni yuborish": raqami bazada bo'lsa, o'zi ulanadi.

## 11e. Hozircha: haqiqiy markazlar Contabo'da (sabaq.uz)

O'zbekistondagi server (§11d) tayyor bo'lguncha haqiqiy markazlar Contabo'dagi `/opt/apps/sabaq` da ishlaydi. ⚠️ Bu §0 ga zid: shaxsga doir ma'lumotlar chet eldagi serverda turadi. Bu egasining ongli qarori (2026-11-18): MChJ ochilib, O'zbekistondagi server (Pro-Data) olingach, baza §11d bo'yicha ko'chiriladi (backup → restore).

`deploy/server/docker-compose.prod.yml` endi ikkita stek, bitta **Promote to production** ikkalasini yangilaydi:
- **live** (`db`, `migrate`, `web`, `worker`, `backup`) — `DOMAIN` (sabaq.uz, `www` → sabaq.uz): haqiqiy markazlar, `/signup` ochiq, @sabaquz_bot va AI yordamchi. `DEMO_MODE`/`SEED_DEMO` compose'da `false` qilib qo'yilgan, `.env` ularni o'zgartira olmaydi. Har kecha 02:30 da backup, deploy oldidan ham (`hooks/pre-up`).
- **demo** (`demo-db`, `demo-migrate`, `demo-web`, `demo-worker`) — `DEMO_DOMAIN` (demo.sabaq.uz): namunaviy ma'lumot, har kecha tozalanadi, o'z boti, `/signup` sabaq.uz ga yuboradi. `sabaq.akbarovlabs.uz` → demo.sabaq.uz.

**O'tish (bir marta):**
1. DNS: `demo.sabaq.uz` A → 169.58.243.86 (`www.sabaq.uz` allaqachon bor). Demo uchun @BotFather'da yangi bot (ixtiyoriy; bo'sh bo'lsa demoda bot yo'q).
2. Serverda: `free -h` (ikki stek ~3.5 GB xotira oladi) va `id -u` (backup fayllari egasi).
3. `sudo nano /opt/apps/sabaq/.env` — qo'shing: `DEMO_DOMAIN=demo.sabaq.uz`, `DEMO_POSTGRES_PASSWORD=` (`openssl rand -hex 24`), `DEMO_AUTH_SECRET=` (`openssl rand -base64 32`), `DEMO_TELEGRAM_BOT_TOKEN=`, `BACKUP_UID=<id -u>`, kerak bo'lsa `DEMO_ANTHROPIC_API_KEY=`. `DEMO_MODE`, `SEED_DEMO`, `MAIN_SITE_URL`, `DEMO_URL`, `APP_URL` qatorlarini o'chiring (endi compose belgilaydi). `DOMAIN=sabaq.uz`, `POSTGRES_PASSWORD`, `AUTH_SECRET`, `TELEGRAM_BOT_TOKEN`, `SALES_AGENT=true` qoladi.
4. Yangi compose va hook'ni serverga qo'ying (§11c "Serverdagi compose faylini o'zgartirish"), hook uchun: Mac'da `git show origin/main:deploy/hooks/pre-up | ssh sarvar@169.58.243.86 'cat > /tmp/sabaq-pre-up'`; serverda `sudo install -d -m 755 -o root -g root /opt/apps/sabaq/hooks` va `sudo install -m 755 -o root -g root /tmp/sabaq-pre-up /opt/apps/sabaq/hooks/pre-up`.
5. Actions → **Promote to production**. `db` yangi `live_pgdata` hajmi bilan bo'sh boshlanadi; demo o'zini to'ldiradi.
6. Tekshirish: `sabaq.uz/api/health`, `sabaq.uz/signup` forma, `www.sabaq.uz` → sabaq.uz, `demo.sabaq.uz/demo`, `sabaq.akbarovlabs.uz` → demo.sabaq.uz, `sudo docker logs sabaq-backup-1`.
7. Bir hafta o'tib, eski demo bazasini o'chiring: `sudo docker volume rm sabaq_pgdata` (unda eski demo va sinov sotuv suhbatlari bor).

**Serverda skript ishlatish** (markaz ochish, platforma admini, parol tiklash):
```bash
cd /opt/apps/sabaq && TAG=$(sudo docker inspect -f '{{.Config.Image}}' sabaq-web-1 | sed 's/.*://')
sudo IMAGE_TAG=$TAG docker compose -f docker-compose.prod.yml run --rm migrate npx tsx scripts/create-owner.ts --center "<nom>" --slug <slug> --name "<ega>" --phone <telefon>
```
Platforma admini: avval o'zingizga hisob (masalan `sabaq.uz/signup` dan), so'ng xuddi shunday `scripts/platform-admin.ts grant <telefon>`. Birinchi markaz uchun nima yig'ish va qadamlar — §11d D.

**Backup:** `/opt/apps/sabaq/backups/lms-*.dump`, 14 kun. Qo'lda: `sudo docker exec sabaq-backup-1 backup`. Serverdan tashqariga (server yo'qolsa, nusxalar ham yo'qoladi) Mac'dan har kuni: `rsync -av sarvar@169.58.243.86:/opt/apps/sabaq/backups/ ~/sabaq-backups/` (fayllar `BACKUP_UID` niki, sudo kerak emas). Tiklash: `deploy/restore.sh` dagi qadamlar, konteyner nomlari `sabaq-db-1`, `sabaq-web-1`, `sabaq-worker-1`. Oxirgi backup 26 soatdan eski bo'lsa, `OPS_TELEGRAM_CHAT_ID` ga xabar keladi.

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
- Moving to sabaq.uz (once, on the server): 1) DNS: A records for `sabaq.uz` and `www.sabaq.uz` → 169.58.243.86. 2) `/opt/apps/sabaq/.env`: `DOMAIN=sabaq.uz`, `APP_URL=https://sabaq.uz`, `SALES_AGENT=true`, plus `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY` and `OPS_TELEGRAM_CHAT_ID` (or `SALES_TELEGRAM_CHAT_ID`), without which the assistant stays off. 3) Refresh the compose file on the server (see "Changing the server's compose file" below): it passes the `SALES_*` variables and carries the `sabaq.akbarovlabs.uz` → `https://sabaq.uz` 301 label; edge-caddy reads the domain off the labels and gets the certificate itself. 4) Actions → **Promote to production**. For `www.sabaq.uz`, add its DNS record first, then add it to the `caddy_1` line. The bot takes its Mini App URL from `APP_URL`.
- Adding it to the server the first time follows `docs/add-app.md` in the Reads repo: `deploy/prepare-app sabaq ~/dev/sites/light-lms/deploy/server`, then on the server `sudo add-app --images "web worker tools" --up-flags "--remove-orphans" sabaq ghcr.io/akbarov-labs/light-lms <folder with the .env>`.
- Changing the server's compose file (a new variable or Caddy label): deploys use the root-owned copy at `/opt/apps/sabaq/docker-compose.prod.yml`, which CI never updates. `prepare-app` + `add-app` are for the first setup only: `add-app` never overwrites a file that exists. On the Mac: `git show origin/main:deploy/server/docker-compose.prod.yml | ssh sarvar@169.58.243.86 'cat > /tmp/sabaq-compose.prod.yml'`; on the server: `sudo cp /opt/apps/sabaq/docker-compose.prod.yml{,.bak}`, `sudo install -m 644 -o root -g root /tmp/sabaq-compose.prod.yml /opt/apps/sabaq/docker-compose.prod.yml`, check with `sudo grep <variable> /opt/apps/sabaq/docker-compose.prod.yml`; then **Promote to production**. Staging is the same with `/opt/apps/sabaq-staging/docker-compose.staging.yml`.

## 15a. The real-centers server: sabaq.uz in Uzbekistan

Today sabaq.uz is the demo (Contabo, wiped every night), so no real center can be opened there. The plan: the site and real centers move to a VPS in Uzbekistan, and the demo moves to `demo.sabaq.uz`.

| Server | Address | What | Bot |
|---|---|---|---|
| VPS in Uzbekistan (the plain setup in this file, `docker-compose.prod.yml`) | `sabaq.uz` (+ `www`) | site, real centers, `/signup` open, Sabaq's AI assistant | @sabaquz_bot |
| Contabo, `/opt/apps/sabaq` | `demo.sabaq.uz` | demo, wiped nightly; `/signup` sends to sabaq.uz | a separate demo bot |

`sabaq.akbarovlabs.uz` follows to `demo.sabaq.uz` by itself (the server compose label takes `DOMAIN`), so that compose file needs no change.

**A. Prepare** (nothing breaks):
1. A VPS in an Uzbek data center (§0, §1: 2 vCPU, 4 GB RAM, 40 GB).
2. @BotFather: a new bot for the demo (e.g. `@sabaq_demo_bot`), picture `public/brand/sabaq-avatar-512.png`.
3. DNS: lower the TTL of `sabaq.uz` and `www.sabaq.uz` to 300; `demo.sabaq.uz` A → 169.58.243.86; `uz.sabaq.uz` A → the new VPS IP.
4. On the VPS, §2–5. `.env` (from `.env.prod.example`): `DOMAIN=uz.sabaq.uz`, `POSTGRES_PASSWORD`, `AUTH_SECRET`, `OPS_TELEGRAM_CHAT_ID`; leave `TELEGRAM_BOT_TOKEN` **empty** for now (Contabo is using @sabaquz_bot). Code: `git checkout <a tested commit>`.
5. Try it: `https://uz.sabaq.uz/api/health`; make yourself platform admin (§8 `platform-admin.ts grant`); create a test center with `create-owner.ts`, sign in, then delete it from `/platform`.

**B. Move** (about 15 minutes; the site stays up, the bot is silent for a few minutes):
6. DNS: `sabaq.uz` and `www.sabaq.uz` A → the VPS IP.
7. Right away, VPS `.env`: `DOMAIN=sabaq.uz`, `EXTRA_DOMAINS=www.sabaq.uz uz.sabaq.uz`, `DEMO_URL=https://demo.sabaq.uz/demo` → `docker compose -f docker-compose.prod.yml up -d`. Caddy gets the certificates itself (`logs caddy`). Don't set `DOMAIN=sabaq.uz` before DNS has moved: after failed attempts Let's Encrypt makes you wait up to an hour.
8. Contabo `/opt/apps/sabaq/.env`: `DOMAIN=demo.sabaq.uz`, `APP_URL=https://demo.sabaq.uz`, `MAIN_SITE_URL=https://sabaq.uz`, `TELEGRAM_BOT_TOKEN=<demo bot>`, `SALES_AGENT=` and `SALES_TELEGRAM_CHAT_ID=` empty → Actions → **Promote to production**. @sabaquz_bot is now free.
9. VPS `.env`: `TELEGRAM_BOT_TOKEN=<@sabaquz_bot>`, `SALES_AGENT=true`, `ANTHROPIC_API_KEY` (and `SALES_TELEGRAM_CHAT_ID` if not the ops chat) → `docker compose -f docker-compose.prod.yml up -d web worker`.
10. Check: `sabaq.uz/api/health`; `www.sabaq.uz` and `uz.sabaq.uz` → 301 to sabaq.uz; `sabaq.akbarovlabs.uz` → demo.sabaq.uz; `demo.sabaq.uz/demo` opens; `sabaq.uz/signup` shows the form; the site shows "See the demo"; write to the bot without a center link and the assistant answers.

⚠️ One bot token runs on one server at a time: don't put the @sabaquz_bot token on the VPS before step 8. Sales conversations from before the move stay in the demo database: replying to their team-chat messages no longer reaches the person, so write to them yourself.

**C. Afterwards:** copy backups to another place in Uzbekistan (§9); updates per §10 (`git pull`, build). Register the database with the state register and check with a lawyer (§0). `ANTHROPIC_API_KEY` sends conversations to a US service: Sabaq's assistant only talks to center owners and never sees the phone number; keep the centers' own AI agent (Settings) off until a lawyer has approved it.

**D. The first center.**
1. Collect from the customer: center name, owner's name and phone; branches; courses and prices; groups (course, teacher, days, time, room); teachers (name, phone, salary rule); students in Excel: Last name, First name, Phone, Parent phone, Group code (#), Balance (debt negative).
2. Center and owner: `docker compose -f docker-compose.prod.yml run --rm migrate npx tsx scripts/create-owner.ts --center "<name>" --slug <slug> --name "<owner>" --phone <phone>` → give the owner the temporary password (or the owner signs up at `sabaq.uz/signup`).
3. The owner signs in → setup wizard (branch, course, group, teacher) → Settings → Staff: the other teachers and admins → the other courses and groups → Students → Import: the Excel saved as "CSV UTF-8" (old debts and prepayments become opening balances; importing again creates nothing twice).
4. Parents and teachers open @sabaquz_bot → /start → "share my number": if the number is in the database, they are linked.

## 15b. For now: real centers on Contabo (sabaq.uz)

Until the server in Uzbekistan (§15a) is ready, real centers run on Contabo in `/opt/apps/sabaq`. ⚠️ This goes against §0: personal data sits on a server abroad. It is the owner's deliberate call (2026-11-18): once the LLC exists and the Uzbek server (Pro-Data) is rented, the database moves there per §15a (backup → restore).

`deploy/server/docker-compose.prod.yml` now holds two stacks, and one **Promote to production** updates both:
- **live** (`db`, `migrate`, `web`, `worker`, `backup`) on `DOMAIN` (sabaq.uz, `www` → sabaq.uz): real centers, `/signup` open, @sabaquz_bot with the AI assistant. `DEMO_MODE`/`SEED_DEMO` are set to `false` in the compose file, so `.env` cannot turn them on. Backups nightly at 02:30 and before every deploy (`hooks/pre-up`).
- **demo** (`demo-db`, `demo-migrate`, `demo-web`, `demo-worker`) on `DEMO_DOMAIN` (demo.sabaq.uz): sample data wiped nightly, its own bot, `/signup` sends to sabaq.uz. `sabaq.akbarovlabs.uz` → demo.sabaq.uz.

**Switching over (once):**
1. DNS: `demo.sabaq.uz` A → 169.58.243.86 (`www.sabaq.uz` exists already). A new @BotFather bot for the demo (optional; empty = no bot on the demo).
2. On the server: `free -h` (both stacks take about 3.5 GB) and `id -u` (owner of the backup files).
3. `sudo nano /opt/apps/sabaq/.env` — add `DEMO_DOMAIN=demo.sabaq.uz`, `DEMO_POSTGRES_PASSWORD=` (`openssl rand -hex 24`), `DEMO_AUTH_SECRET=` (`openssl rand -base64 32`), `DEMO_TELEGRAM_BOT_TOKEN=`, `BACKUP_UID=<id -u>`, and `DEMO_ANTHROPIC_API_KEY=` if wanted. Delete the `DEMO_MODE`, `SEED_DEMO`, `MAIN_SITE_URL`, `DEMO_URL` and `APP_URL` lines (the compose file sets them now). `DOMAIN=sabaq.uz`, `POSTGRES_PASSWORD`, `AUTH_SECRET`, `TELEGRAM_BOT_TOKEN` and `SALES_AGENT=true` stay.
4. Put the new compose file and the hook on the server (§15 "Changing the server's compose file"); for the hook, on the Mac `git show origin/main:deploy/hooks/pre-up | ssh sarvar@169.58.243.86 'cat > /tmp/sabaq-pre-up'`, on the server `sudo install -d -m 755 -o root -g root /opt/apps/sabaq/hooks` and `sudo install -m 755 -o root -g root /tmp/sabaq-pre-up /opt/apps/sabaq/hooks/pre-up`.
5. Actions → **Promote to production**. `db` starts empty on the new `live_pgdata` volume; the demo seeds itself.
6. Check: `sabaq.uz/api/health`, the form at `sabaq.uz/signup`, `www.sabaq.uz` → sabaq.uz, `demo.sabaq.uz/demo`, `sabaq.akbarovlabs.uz` → demo.sabaq.uz, `sudo docker logs sabaq-backup-1`.
7. After a week, delete the old demo database: `sudo docker volume rm sabaq_pgdata` (it holds the old demo and the test sales chats).

**Running a script on the server** (open a center, platform admin, password reset):
```bash
cd /opt/apps/sabaq && TAG=$(sudo docker inspect -f '{{.Config.Image}}' sabaq-web-1 | sed 's/.*://')
sudo IMAGE_TAG=$TAG docker compose -f docker-compose.prod.yml run --rm migrate npx tsx scripts/create-owner.ts --center "<name>" --slug <slug> --name "<owner>" --phone <phone>
```
Platform admin: first an account for yourself (e.g. via `sabaq.uz/signup`), then the same way `scripts/platform-admin.ts grant <phone>`. What to collect for the first center and the steps: §15a D.

**Backups:** `/opt/apps/sabaq/backups/lms-*.dump`, 14 days. By hand: `sudo docker exec sabaq-backup-1 backup`. Off the server (lose the server and the copies go with it), daily from the Mac: `rsync -av sarvar@169.58.243.86:/opt/apps/sabaq/backups/ ~/sabaq-backups/` (the files belong to `BACKUP_UID`, no sudo needed). Restore: the steps in `deploy/restore.sh`, with containers `sabaq-db-1`, `sabaq-web-1`, `sabaq-worker-1`. A backup older than 26 hours sends an alert to `OPS_TELEGRAM_CHAT_ID`.
