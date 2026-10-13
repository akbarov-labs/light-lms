# HANDOFF — lms-light (CRM/LMS for private education centers in Uzbekistan)

> Written 2026-10-11 by Claude (claude.ai chat session) for the Claude Code session that will BUILD this.
> Everything Sardor and Claude discussed and decided is in this file. Read it fully before writing code.
> Owner: Sardor (itsakbarov). He speaks Uzbek (Latin) and English; prefers short, plain, standup-style updates.

---

## 0. Your mission (read first)

Build the **complete MVP** described below, **end to end, without stopping until it is done and verified**.
Sardor's exact words: "don't stop till finished", "make decisions yourself, all responsibility on you",
"everything should be inside docker", "payments for now not required — if you can do them also",
"don't use extra paid services".

Hard rules:
- **Everything runs in Docker** via `docker compose up --build` (Postgres, web app, worker). Sardor has Docker on this Mac — use it, actually run it, fix real errors.
- **No paid services.** No cloud deploys (no Vercel/Neon/Supabase/etc.), no paid APIs. Everything local in Docker.
- **Do not ask questions** — all product decisions are made below. If something is not covered, decide like a senior product engineer, write the decision into `DECISIONS.md` (append), and continue.
- **Do not stop at a partial state.** Work through the build order (§14) until every acceptance check (§15) passes.
- Commit to git as you go (local repo in this folder; small, meaningful commits). Do not push anywhere unless Sardor asks.
- When finished, write a short final report for Sardor at the top of `README.md` ("Holat / Status") in plain language: what works, how to run, demo logins, what is left.

There is also a living plan doc on claude.ai ("Edu Center LMS — Product Plan", https://claude.ai/code/artifact/5626a75b-d5db-4cad-a30c-3846b8b98c9a). This file is a superset of it; you do not need to open it.

---

## 1. The business and market (context)

Private education centers in Uzbekistan (o'quv markazlari): language centers, IT schools, exam prep (DTM/IELTS/SAT), kids clubs, tutoring, driving schools. They run on Excel/Telegram or on a CRM. Their daily pain: leads → trial lesson → group, attendance, monthly tuition and **debts** (qarzdorlar), and **teacher salaries**.

### Competitors
| Product | Market | Notes | Price |
|---|---|---|---|
| **ModMe** (modme.uz) | Uzbekistan, the leader | Leads, groups, grading/rating, tasks, finance, payroll, debtors, student + teacher apps, gamification add-on. 330+ centers by early 2023; UzVC invested $100k at $1.25M valuation (2023). Founders: Jahongir Pulatov (Cambridge Learning Centre, Mars IT School) + Ruslan Yuldashev (ex-Yandex edtech). | Per active students, per 3 months: Start 0–100 = 1,500,000 UZS; Basic 100–300 = 3,120,000; Pro 300–1000 = 4,680,000; Premium 1000+ = 9,000,000. 6/12-month −10%, 12 months +2 months bonus. Gamification +150,000 UZS/month. ≈500k UZS/month for ≤100 students, ≈3M/month for 1000+. 7-day demo. Sales via Telegram @modme_sales, billing via @modmebillingbot. |
| EduCoin | Uzbekistan | CRM + student motivation | not public |
| Umai CRM | Kazakhstan | leads + WhatsApp/Instagram + AI bot + schedule + attendance + payroll in ONE tool | from 8,500 KZT/month |
| Alfa CRM, HolliHop, Paraplan | Russia/CIS | classic edu CRMs | per-center |
| Bitrix24 / amoCRM | generic | sales funnel only, no groups/attendance/payroll | per seat |

### Where we win (our positioning)
1. **Online tuition payment** — parent pays from a Telegram link (Payme first; Click/Uzum later), auto-marked paid.
2. **Telegram-first** — parents, students and teachers use a Telegram bot instead of installing apps.
3. **Cheaper, self-serve start** — free tier for small centers, set up in 15 minutes.
4. **Automatic debt chasing** — reminders before due date and when debt appears, with a pay link.
5. **Owner dashboard on the phone** — revenue, debt, churn, teacher load on one screen.
6. **Correct money** — billing and salary that never need manual fixing (ModMe spent ~2 years fixing this).

### Our SaaS pricing (proposal, for the landing/pricing page later — NOT needed in MVP code)
Free ≤30 active students; Start ≤100 = 249,000 UZS/mo; Growth ≤300 = 590,000; Pro ≤1,000 = 990,000; Network 1,000+ = custom. 14-day full trial, annual = 2 months free, free import from Excel/other CRM.

---

## 2. What ModMe's 44 release notes taught us (Jan 2021 → Jun 2023)

Sardor exported ModMe's Telegram update channel; Claude read every release note. Key facts (use them as **evidence of real center needs**, NOT as a spec to copy):

- **Billing took them 2 years.** Monthly mode only in v1.6.3 (Feb 2021). Start-date and full-course modes in v2.0.0. 12 vs 13 vs real-calendar lessons/month setting in v1.9.7. Six billing modes formalised + deduction code rewritten in v2.0.21 (Jun 2022): per lesson; monthly calendar; monthly period from group start; module (N lessons); monthly individual period from student activation; whole course. "Most automatic deduction errors fixed" only in v2.0.22.
- **Group transfer**: direct move v2.0.10; refund of unheld lessons in old group only v2.0.15–2.0.16. Student joins new group as *inactive*; activation triggers charge.
- **Activation/trial**: auto-activate after N attended lessons (v3.1.0); auto-archive new student after N consecutive misses; auto-remove debtor after N misses.
- **Teacher pay**: % of student payments or fixed (v1.6.3, "experimental"); no pay for non-activated students (v2.0.18); toggle to pay for trial students (v3.1.0); lesson-count bugs in module mode.
- **Payment report** wrongly counted discount/transfer credits as income until v2.0.17.
- **Unified balance** across a student's groups (v1.6.7); choosing which group a payment applies to (v2.1.0).
- **Payment cancellation**: original stays, reversal record added, balance recalculated (v1.9.3). Partial refunds (v2.0.1). Refunds counted as center expense.
- **Roles grew**: CEO/admin/cashier at launch → multi-role users, marketer, financier, branch director, limited admin.
- **Leads**: lead form (public link, logo, UTM routing), kanban with live updates for call centers, lead history, archive, tags, follow-up reminders in a daily task list, lost/left reports.
- **Siblings**: several students share one parent phone, each with own login (v1.9.9).
- **Automations (SMS)**: on payment, on trial add, birthday, 3 days before payment date, when auto-debit puts student in debt.
- **Public offer**: center uploads contract; student accepts at first login; timestamp stored (v1.5.15).
- **Excel export** added section by section over two years.
- **Holidays/days off** setting (v2.1.0). Passport series field (optional). Student tags. Teacher comments on students. Group comments. Center audit scorecard (6 areas, 60+ indicators). IP telephony with click-to-call. Workly staff-attendance integration. Facebook Pixel. Branded login page/colors.
- **Integrations they had**: Payme (v2.0.1/2.0.15), Apelsin (v2.0.21), SMS via Play Mobile. **Never mentioned in notes: Click, a Telegram bot.**
- Performance: they had to optimize list pages heavily (students list 1.37s → 109ms). Paginate and index from day one.

Lesson: get **money, transfers and leads** right from the first commit and you skip most of their history.

---

## 3. Product decisions (OUR calls — follow these)

Fewer concepts, each one correct. An admin should never need a manual to know why a student owes money or what a teacher earned.

| # | Decision | Why |
|---|---|---|
| 1 | **Two pricing types, not six modes.** *Subscription* = monthly price, renews on the 1st (default) / on the group's start date / on the student's own start date. *Package* = fixed price for N lessons or a whole course, optionally in installments. Per-lesson = package of 1 lesson. | Covers all six ModMe modes on one settings screen. |
| 2 | **Partial months pro-rated by real scheduled lessons.** No "12 or 13" setting. Holidays and center-cancelled lessons never charged. | Only rule a parent can check on a calendar. |
| 3 | **The lesson is the unit of truth.** Schedule generates lessons; every charge/credit/salary line is derived from lessons. | Transfers, freezes, cancellations and pay become one calculation. |
| 4 | **Center cancels → no charge, no teacher pay. Student misses → still charged, teacher still paid.** One setting "excused absence credits" (default off). | Removes most common dispute. |
| 5 | **Trial is free, own status.** Default 1 trial lesson; activation starts billing. No teacher pay for trial students unless setting on. | Trials are marketing. |
| 6 | **One wallet per family, debt shown per group.** Siblings share a parent and a balance; each enrollment shows its own charges/debt. | Parents pay once for two kids. |
| 7 | **Teacher pay = fixed, per lesson, % of earned tuition for lessons actually held, or base + %.** "Pay only from collected money" toggle, off by default. | Teachers teach, admins collect. |
| 8 | **Four roles + permission switches.** OWNER, MANAGER (branch-scoped), ADMIN, TEACHER. Switches: finance view, take payments, refunds/reversals, archive/delete, export, leads, settings. One person can also be a teacher. | Cashier = admin with only "take payments"; marketer = admin with leads only. |
| 9 | **Nothing is deleted.** Payments cancelled by reversing entry; people/groups archived. Audit log on everything money/status related. | Money trust. |
| 10 | **Telegram is the parent/student/teacher app.** No native app in year one. | Everyone has Telegram. |
| 11 | **Online payment is core.** Every reminder carries a pay link. MVP: Payme (works when keys added, disabled otherwise). Click/Uzum v2. | Cuts debt; main reason to switch. |
| 12 | **Fixed lead stages**: NEW → CONTACTED → TRIAL_BOOKED → TRIAL_DONE → ENROLLED / LOST. Lost reason required. Tags carry the rest. | Comparable conversion reports. |
| 13 | **A lesson counts as "held" when the teacher (or admin) marks attendance.** Past lessons left unmarked stay SCHEDULED and show as "attendance missing" on the dashboard. | Pushes teachers to mark attendance; salary follows reality. |

**Deliberately NOT in year one:** lesson-content editor/homework system (centers use Telegram groups), form builder, IP telephony, gamification, audit scorecards, branding beyond logo+color, SMS as main channel, native apps.

**Bets to validate with pilots** (keep them as settings so they are easy to flip): pay from earned vs collected; no homework in product; fixed lead stages; four roles.

---

## 4. Users and roles

| Role | Where | Daily needs |
|---|---|---|
| OWNER | phone web + Telegram reports | revenue, debt, new/left students, branch comparison, approve salaries, settings |
| MANAGER | web | own branches: numbers, teacher load, rooms, everything an owner can do inside those branches except center settings |
| ADMIN (reception) | web all day | leads, calls, trial lessons, enroll, take payments, receipts, chase debts |
| TEACHER | mobile web + Telegram bot | my groups, today's lessons, mark attendance/grades, my salary so far |
| Parent / Student | Telegram bot (+ public pay page) | schedule, attendance, balance/debt, pay online, announcements |

Default permission switches:
- OWNER: all.
- MANAGER: all except `settings` (center-level), limited to assigned branches.
- ADMIN: `payments.take`, `leads`, `students.edit`, `groups.edit`, `export`. (not `finance.view`, not `refunds`, not `archive`)
- TEACHER: none (sees only own groups/lessons/salary).
Switch list: `finance.view`, `payments.take`, `payments.refund` (reversal/refund), `archive`, `export`, `leads`, `students.edit`, `groups.edit`, `staff.manage`, `settings`.
Branch scoping: every query for MANAGER/ADMIN/TEACHER filters by the user's branches.

Login: phone number + password (OTP needs an SMS provider = paid → not in MVP). Phone normalized to `998XXXXXXXXX`.

---

## 5. Modules and scope

| Module | What it does | Phase |
|---|---|---|
| Center setup | Center, branches, rooms, working days, holidays, staff + roles/switches, onboarding wizard | MVP |
| Courses | name, level, lesson length (min), lessons/week (info), duration (months, info), pricing type + price + options | MVP |
| Groups & schedule | group = course + teacher + room + weekly slots (weekday + start/end time); start/end date; capacity; status; auto code number; **room and teacher clash check**; generates lessons | MVP |
| Lessons | generated from schedule (rolling 60 days ahead); cancel (with reason) / reschedule (move date/time) / substitute teacher; status SCHEDULED/HELD/CANCELLED | MVP |
| Students & families | student profile (name, phone, birth date, gender, tags, notes, source), family with guardians (parents) and shared wallet; siblings share family; status ACTIVE/ARCHIVED | MVP |
| Enrollments (`group_student`) | trial/active/frozen/left/transferred; transfer between groups mid-month; freezes; discounts; history | MVP |
| Attendance | per lesson: PRESENT/ABSENT/LATE/EXCUSED + optional grade (0–100 or 1–5 per center setting; default 1–5) + comment; marking it makes lesson HELD | MVP |
| Billing & payments | billing engine (§7), payments (cash/card/transfer/Payme), reversals, refunds, printable receipt, debtors list | MVP |
| Teacher salary | rules per teacher, live month view, bonuses/fines, lock month, mark paid, payslip export | MVP |
| Expenses | category, amount, branch, date, note; categories editable | MVP |
| Leads (CRM) | kanban with fixed stages, add manually, public lead form link (`/f/<centerSlug>`), source, interested course, assigned admin, next contact date (shows in "today's tasks"), notes timeline, lost reason, convert to student (+ enroll as trial) | MVP |
| Owner dashboard | revenue (payments) this month vs last, total debt, active students, new vs left this month, trial→active conversion, lessons without attendance, per-branch and per-teacher tables, 6-month revenue chart | MVP |
| Telegram bot | parents/students/teachers/owner link by phone; balance, schedule, attendance, pay link, reminders, teacher attendance marking, owner daily report (§9) | MVP |
| Online payment | Payme Merchant API (§10). Off until keys set. | MVP (Payme), v2 (Click, Uzum) |
| Export | CSV (UTF-8 with BOM so Excel opens Cyrillic/Uzbek correctly) on every list | MVP |
| Audit log | who/what/before/after/when for money, status, enrollment, attendance edits; viewable per student/group + global | MVP |
| Public offer | center uploads contract text; parent/student accepts in bot (button) → timestamp stored | v2 (nice if time) |
| SMS | gateway (Eskiz/Playmobile) for parents without Telegram | v2 |
| Grades & report cards | monthly report card to parent from grades | v2 |
| Exams & certificates | placement test, level exams, printable certificate | v2 |
| Lesson materials, gamification, marketing tools, online lessons, franchise network, public API | | Later |

### Must-have UX details
- Uzbek (Latin) default UI, Russian second; language switcher; all user-facing strings via i18n dictionaries (`uz`, `ru`). Money formatted `1 250 000 so'm`. Dates `dd.MM.yyyy`. Timezone **Asia/Tashkent** everywhere (store dates as DATE for lesson dates; timestamps in UTC).
- Fast search everywhere (student by name/phone, group by name/code).
- Every list paginated, filterable, exportable.
- Mobile-friendly admin (owner uses phone); teacher screens designed mobile-first.
- Global "Today" page for admins: today's lessons, trials today, leads to call today, debtors to remind.
- Clean, calm design: neutral background, one accent color (center can pick), readable tables. No gimmicks.

---

## 6. Data model

Multi-tenant: every row carries `centerId` (one Docker install can host several centers; MVP UI = one center per login). Money = **integer UZS** (no decimals). Never store a running balance as the source of truth — **balance = SUM(ledger)**.

```
Center        id, name, slug(unique), currency='UZS', timezone='Asia/Tashkent', locale='uz', accentColor, logoUrl,
              settings JSON { trialLessons:1, excusedAbsenceCredit:false, payTeacherForTrial:false,
                              payFromCollected:false, gradeScale:'5', reminderDaysBefore:3, lessonsAheadDays:60 },
              paymeMerchantId?, paymeKey?, paymeTestMode:true, createdAt
Branch        id, centerId, name, address?, phone?, archivedAt?
Room          id, branchId, name, capacity?, archivedAt?
User (staff)  id, centerId, phone(unique), name, passwordHash, role(OWNER|MANAGER|ADMIN|TEACHER), isTeacher(bool),
              perms String[], telegramChatId?, locale?, archivedAt?, createdAt
UserBranch    userId, branchId (PK both)
Course        id, centerId, name, level?, description?, lessonMinutes, lessonsPerWeek?, durationMonths?,
              pricingType(SUBSCRIPTION|PACKAGE), price,
              renewal(CALENDAR|GROUP_START|STUDENT_START)  -- subscription only
              packageLessons Int?  -- package: N lessons; null = whole course (all lessons of the group)
              installments Int @default(1) -- package only
              archivedAt?
Group         id, centerId, branchId, courseId, teacherId, roomId?, code(Int, auto per center), name,
              startDate, endDate?, capacity?, priceOverride?, status(PLANNED|ACTIVE|FINISHED|ARCHIVED), createdAt
GroupSlot     id, groupId, weekday(1=Mon..7=Sun), startTime('HH:mm'), endTime('HH:mm')
Lesson        id, groupId, date(DATE), startTime, endTime, teacherId (actual; substitute allowed), roomId?,
              status(SCHEDULED|HELD|CANCELLED), cancelReason?, topic?, heldAt?, markedById?
              @@unique([groupId, date, startTime])
Holiday       id, centerId, date, name   -- no lessons generated on these dates
Family        id, centerId, name (e.g. "Karimovlar oilasi"), createdAt
Guardian      id, familyId, name, phone, relation?(mother/father/...), telegramChatId?, isPrimary
Student       id, centerId, familyId, firstName, lastName, phone?, birthDate?, gender?, source?, tags String[],
              notes?, telegramChatId?, status(ACTIVE|ARCHIVED), createdAt
Enrollment    id, studentId, groupId, startDate, endDate?, activatedAt?,
              status(TRIAL|ACTIVE|FROZEN|LEFT|TRANSFERRED), priceOverride?, discountPercent?, discountAmount?,
              discountUntil?, discountReason?, leftReason?, transferredToId?, createdAt
              -- unique ACTIVE-ish row per (studentId, groupId) where endDate is null (partial unique index in SQL migration)
EnrollmentFreeze id, enrollmentId, fromDate, toDate, reason?
Attendance    id, lessonId, studentId, enrollmentId, status(PRESENT|ABSENT|LATE|EXCUSED), grade?, comment?,
              markedById, updatedAt   @@unique([lessonId, studentId])
LedgerEntry   id, centerId, familyId, studentId?, enrollmentId?, lessonId?,
              type(CHARGE|CREDIT|PAYMENT|REFUND|REVERSAL),
              amount Int (SIGNED from the family's point of view: PAYMENT +, CHARGE −, CREDIT +, REFUND −, REVERSAL = opposite of reversed),
              method?(CASH|CARD|TRANSFER|PAYME|CLICK|UZUM|SYSTEM), billingKey? (groups engine entries, see §7),
              period? ('2026-10'), description (human readable, e.g. "Oktyabr · General English A1 · 11/13 dars"),
              reversesId? (self-relation), date, createdById?, externalId? (payment provider txn), createdAt
SalaryRule    id, teacherId, model(PERCENT_EARNED|FIXED|PER_LESSON|BASE_PLUS_PERCENT), percent?, fixedAmount?,
              perLesson?, validFrom, createdAt   -- latest validFrom <= month start applies
SalaryAdjustment id, teacherId, month('YYYY-MM'), amount (signed: bonus +, fine −), reason, createdById, createdAt
Payslip       id, teacherId, month, status(DRAFT|LOCKED|PAID), total, lines JSON, lockedAt?, paidAt?, paidById?
              @@unique([teacherId, month])
Expense       id, centerId, branchId?, category, amount, date, note?, createdById, createdAt, reversedAt?
Lead          id, centerId, branchId?, name, phone, source?, courseId?, stage(NEW|CONTACTED|TRIAL_BOOKED|TRIAL_DONE|ENROLLED|LOST),
              assignedToId?, nextContactAt?, lostReason?, tags String[], studentId?, utm JSON?, createdAt, archivedAt?
LeadNote      id, leadId, text, createdById?, createdAt
AuditLog      id, centerId, userId?, entity, entityId, action, before JSON?, after JSON?, createdAt
PaymeTransaction id, centerId, paymeId(unique), familyId, amountTiyin, state(1|2|-1|-2), createTime(BigInt ms),
              performTime?, cancelTime?, reason?, ledgerEntryId?
TelegramLink  chatId(unique), kind(GUARDIAN|STUDENT|STAFF), refId, phone, createdAt
```
Indexes: every FK; (centerId, createdAt); Lesson(groupId,date); Lesson(teacherId,date); LedgerEntry(familyId); LedgerEntry(billingKey); Student name/phone search (trigram or ILIKE with index).

### Enrollment rules (Sardor asked about this specifically)
- Enrollment **is** the `group_student` link. A student can be in several groups and move between them mid-month; each stay is its own row with dates.
- **Transfer**: close old row (`endDate` = day before move, status TRANSFERRED, `transferredToId`), create new row from move date (status ACTIVE immediately — the student was already paying; or TRIAL if the center wants; default ACTIVE). Billing engine automatically credits unheld lessons in the old group and charges the new group pro-rata.
- **Never delete enrollments** — close them. Reports, salaries, history depend on them.
- One open row per student per group: partial unique index `(studentId, groupId) WHERE endDate IS NULL`.
- **Attendance only for students whose enrollment covers the lesson date** (and not frozen on that date).
- **Freeze**: `EnrollmentFreeze(from,to)`; one enrollment can pause many times; lessons inside freeze are not charged and not counted for teacher pay. Status FROZEN while today is inside a freeze.
- **Leave**: set endDate + status LEFT + leftReason; future lessons stop being charged (engine credits them).
- **Trial**: status TRIAL from enrollment startDate; free; after `trialLessons` attended lessons OR admin clicks "Activate", set `activatedAt` = date of the first billable lesson (default: next lesson date after activation, or today) and status ACTIVE. Billing starts at `activatedAt`. Not activated after trial → admin marks LEFT (lead lost reason optional).

---

## 7. Billing engine (the heart — implement as pure, unit-tested functions)

### Core idea: "expected vs posted", self-healing and idempotent
For each enrollment and each **billing unit** (subscription period, or package), the engine computes the **expected amount** the family owes for that unit from the lessons. It compares with the **sum of ledger entries already posted** under that unit's `billingKey` and posts only the **difference** (a CHARGE if more is owed, a CREDIT if less). Running it twice posts nothing the second time. Transfers, freezes, cancellations, leaving, discounts, schedule changes are all handled by re-running sync — no special-case refund code.

`billingKey` formats:
- Subscription: `sub:<enrollmentId>:<periodStart YYYY-MM-DD>`
- Package: `pkg:<enrollmentId>:<packageIndex>` (+ `:<installmentIndex>` if installments > 1)

`syncEnrollment(enrollmentId, asOf = today)` → loads enrollment, group, course, lessons (of the group in relevant range), freezes, holidays, attendance (for excused), existing ledger entries for the enrollment; computes expected; writes delta entries in one transaction; writes audit log. Call it after **any** change touching money: enrollment create/activate/transfer/freeze/leave/discount, lesson cancel/reschedule/restore, attendance EXCUSED change (when setting on), course/group price change, nightly job for all open enrollments.

### Effective price
`basePrice = enrollment.priceOverride ?? group.priceOverride ?? course.price`.
Discount applies if the unit start ≤ `discountUntil` (or discountUntil null): `price = basePrice − discountAmount` or `round(basePrice × (100 − discountPercent)/100)`. Never below 0.

### Chargeable lesson (for an enrollment)
A lesson of the enrollment's group is **chargeable** when ALL hold:
- `lesson.status != CANCELLED`
- `lesson.date >= enrollment.activatedAt` (TRIAL enrollments have no activatedAt → nothing chargeable)
- `lesson.date <= enrollment.endDate` (if set)
- lesson date not inside any freeze of the enrollment
- not (center setting `excusedAbsenceCredit` AND attendance for this student on this lesson is EXCUSED)
Student ABSENT → still chargeable (decision 4).

### Subscription
Periods by `course.renewal`:
- CALENDAR: calendar months (1st → last day).
- GROUP_START: months anchored on `group.startDate` day-of-month (e.g. 15th → 15th…14th next month; clamp day 29–31 to month end).
- STUDENT_START: months anchored on `enrollment.activatedAt` day-of-month.
For each period P that **has started** (`P.start <= asOf`) and overlaps the enrollment's billable window:
- `scheduled(P)` = all lessons of the group in P with status != CANCELLED **plus** cancelled ones (i.e. all generated lessons, holidays never generated). This is the denominator, so a cancellation lowers this student's charge without raising others'.
  - Edge: if `scheduled(P)` = 0 → expected 0.
- `chargeable(P)` = chargeable lessons in P (definition above).
- `expected(P) = round(price(P) × chargeable / scheduled)`; if `chargeable == scheduled` → exactly `price(P)` (no rounding drift).
- Round to whole so'm (Math.round). Optionally round to nearest 100 so'm — **do round to nearest 100** for parent-friendly numbers, except when chargeable == scheduled.
- **Prepaid**: when a period starts, the whole period's expected amount (assuming future lessons happen) is charged on day 1 of the period (or on activation day). Later cancellations/freezes/leaving produce CREDITs automatically via re-sync.
- Lessons must exist for the whole current period → lesson generation runs ≥ 60 days ahead.
- Description example: `"Oktyabr 2026 · General English A1 (#12) · 11/13 dars"`; for delta credits: `"Qayta hisob: 2 dars bekor qilindi"` (recalculation).

### Package
- `N = course.packageLessons ?? count(all lessons of the group from startDate to endDate)` (whole course; if group has no endDate, use course.durationMonths × lessonsPerWeek × 4.33 rounded, and recompute when endDate is set).
- `rate = price / N`.
- `consumed` = chargeable lessons with `date <= asOf` (held or past & not cancelled).
- While enrollment is open (no endDate, or endDate >= asOf): number of packages charged
  `k = max(1, ceil(consumed / N))`, plus one more when `consumed` is an exact multiple of N (> 0) **and** the group still has lessons scheduled after asOf (the next package is prepaid as soon as the previous one is used up).
  Expected for each package i (1..k) = `price`. With installments: installment j of package i is due once `asOf >= packageStart_i + (j-1) months`; expected = `price × dueInstallments / installments` (last installment absorbs rounding).
- When enrollment is closed (LEFT/TRANSFERRED, endDate < asOf): expected total = `round(consumed × rate)` (pay only what was used; the last package's unused part is credited). Put the correction under the last package's key.
- Per-lesson pricing = package with N = 1: each lesson is charged as the previous is consumed (prepaid 1 lesson ahead).

### Payments, wallet, debt
- PAYMENT entries are positive on the **family**; optional `enrollmentId` to direct it at a group.
- Family balance = SUM(amount) over family ledger. Negative = debt.
- **Debt per enrollment** (for display): allocate credits FIFO — first, payments pointed at an enrollment pay that enrollment's oldest charges; then undirected payments/credits pay the oldest outstanding charges across the family by date. Show per enrollment: charged, paid, debt; and per period/package whether paid.
- **Reversal**: never edit or delete; create a REVERSAL entry with `reversesId` and the opposite amount. Needs permission `payments.refund`.
- **Refund** (cash given back to a parent): REFUND entry (negative), needs `payments.refund`. Refunds are NOT expenses: revenue = payments − refunds; expenses are operating costs only.
- **Payment report counts only PAYMENT/REFUND/REVERSAL-of-payment** — never CHARGE/CREDIT (ModMe bug v2.0.17).
- Receipt: printable page (A6/80mm-friendly) with center name, student, amount, method, date, cashier, new balance, receipt number.

### Debtors list
Families/students with negative balance; columns: student(s), group(s), debt amount, days overdue (since oldest unpaid charge), last payment date, guardian phone, Telegram linked?; filters by branch/group/teacher/min amount; action "remind" (sends Telegram message with pay link) and "call" (tel: link); export.

---

## 8. Teacher salary engine

For teacher T and month M (Tashkent calendar month):
1. Rule = latest `SalaryRule` with `validFrom <= M.start` (if none → 0 with warning).
2. `held` = lessons in M with `teacherId = T` (actual teacher, so substitutes get the lesson) and status HELD.
3. Per held lesson L, per enrollment E of L's group that is **chargeable for L** (§7 definition; TRIAL enrollments count only if `payTeacherForTrial`, using the course base rate):
   - `earned(E,L)` = the family's per-lesson value for that lesson:
     - subscription: `price(P) / scheduled(P)` for the period P containing L
     - package: `price / N`
   - if `payFromCollected` is on: include only if E's billing unit containing L is fully paid at calculation time.
4. Amount by model:
   - PERCENT_EARNED: `percent% × Σ earned`
   - FIXED: `fixedAmount`
   - PER_LESSON: `perLesson × count(held)`
   - BASE_PLUS_PERCENT: `fixedAmount + percent% × Σ earned`
5. `+ Σ SalaryAdjustment(T, M)` (bonuses +, fines −).
6. Lines JSON per group: group, lessons held, student-lessons, earned base, amount; plus adjustments. Every number links back to lessons (payslip page lists lessons with students counted).
7. Live during the month (recomputed on view); **Lock** (owner/finance) freezes lines into Payslip (status LOCKED; later changes to that month don't alter it, show a warning "changed after lock" with diff); **Mark paid** records paidAt/paidBy and creates an Expense (category "Oylik / Salary", linked) so P&L is correct.
8. Teacher sees own live salary and payslips (web `/t` and bot).

### Reports (finance.view)
- Revenue (payments − refunds) by day/month, by branch, by method, by course/group/teacher.
- Expenses by category/branch; **Profit = revenue − expenses** (salaries included when marked paid).
- Debt total and aging (0–30, 31–60, 60+ days).
- Students: active, new, left (with reasons), trial→active conversion, by branch/course/teacher.
- Leads funnel: count per stage, conversion %, by source, by admin, lost reasons.
- Attendance: % per group/teacher, lessons without attendance.
---

## 9. Telegram bot (grammY, long polling, runs in the `worker` container)

Token from env `TELEGRAM_BOT_TOKEN`. If empty → bot disabled, worker logs one line and keeps running jobs. One bot per installation; it serves all centers (users matched by phone).

**Linking**: `/start` → bot asks to share contact (reply keyboard `request_contact`). Normalize phone; find matches: Guardian(s), Student(s), Staff user. Save `telegramChatId` on each match + `TelegramLink`. If none → "Raqamingiz topilmadi, o'quv markazingiz administratoriga murojaat qiling" (not found, contact the center). A parent with several children sees all of them.

**Parent / student menu** (reply keyboard, Uzbek default, Russian if user's Telegram language is ru, `/lang` to switch):
- 💰 Balans — family balance, per child per group: charged / paid / debt, next charge date & amount; button "To'lash (Payme)" if Payme enabled and debt > 0 → pay link.
- 📅 Jadval — next 7 days lessons per child (group, time, room, teacher).
- ✅ Davomat — last 30 days attendance per child (✓ ✗ ⏱ and grade).
- 🧾 To'lovlar — last 10 payments.
- ℹ️ Markaz — center name, branch address, admin phone.
**Teacher menu**: 📚 Bugungi darslar (today's lessons) → tap a lesson → inline keyboard with each student (cycle Present/Absent/Late/Excused) + "Saqlash" (save → lesson HELD, sync billing if needed); 💵 Oylik (salary so far this month + last payslip); 📅 Hafta jadvali.
**Owner/Manager**: 📊 Hisobot — today's/month's revenue, debt total, new/left students, lessons missing attendance; also auto daily report at 21:00 Tashkent.
**Notifications sent by worker** (to all linked guardians of the student; respect a per-center on/off setting each):
- payment received (with new balance),
- `reminderDaysBefore` days before next subscription period starts: amount due + pay link,
- debt appeared after charge: amount + pay link,
- absent from lesson (same day, after attendance saved),
- trial lesson booked (date/time/address),
- teacher: 10 min before lesson? → **No** (noise). Teacher: at 20:00 if today's lessons have no attendance → reminder.
All notification sends go through a queue table `Notification(id, centerId, chatId, text, status, error, createdAt, sentAt)` processed by the worker with rate limit (≤25 msg/s) so nothing is lost and sends are auditable. (Add this model to the schema.)

---

## 10. Payme (Merchant API) — build it, keep it OFF unless keys are set

Per center settings: `paymeMerchantId`, `paymeKey`, `paymeTestMode`. If not set → hide pay buttons everywhere.
**Pay link** (checkout): `https://checkout.paycom.uz/<base64("m=<merchantId>;ac.family_id=<familyId>;a=<amountTiyin>;c=<returnUrl>;l=uz")>` (test: `https://checkout.test.paycom.uz/…`). Amount in **tiyin = UZS × 100**. Default amount = current debt (or next due amount).
**Endpoint** Payme calls: `POST /api/payme` (JSON-RPC 2.0). Auth header `Authorization: Basic base64("Paycom:<paymeKey>")` → wrong → error `-32504`. Identify center by `account.family_id` → family → center; check that center's key.
Methods (implement all, idempotent, store in `PaymeTransaction`):
- `CheckPerformTransaction(amount, account)` → family exists (else `-31050`), amount > 0 and ≤ some sane max (else `-31001`) → `{allow: true}`.
- `CreateTransaction(id, time, amount, account)` → if exists with same id: return it (state must be 1, and not older than 12h timeout = 43,200,000 ms else cancel with reason 4 and return `-31008`); if another active (state 1) transaction exists for the same family → `-31050`-range "busy" error (`-31099`); else create state 1 → `{create_time, transaction: <our id>, state: 1}`.
- `PerformTransaction(id)` → not found `-31003`; state 1 → (timeout check) → post LedgerEntry PAYMENT (method PAYME, externalId = payme id), state 2, perform_time → `{transaction, perform_time, state: 2}`; already 2 → return same; cancelled → `-31008`.
- `CancelTransaction(id, reason)` → state 1 → state −1; state 2 → create REVERSAL of the payment, state −2; return `{transaction, cancel_time, state}`; idempotent.
- `CheckTransaction(id)` → `{create_time, perform_time, cancel_time, transaction, state, reason}`.
- `GetStatement(from, to)` → list transactions in range with fields Payme expects.
Error objects: `{code, message: {ru, uz, en}, data}`. **Before trusting these details, check them against Payme's official Merchant API docs (developer.help.paycom.uz) if reachable; if not reachable, implement as above and write a test suite with JSON fixtures for every method and error.** Notifications: on PerformTransaction → enqueue "payment received".
Click and Uzum: only create the interface (`PaymentProvider` with `buildPayLink`, `handleCallback`) so they slot in later; don't implement.

---

## 11. Worker jobs (node-cron or a simple scheduler, Asia/Tashkent)
- **00:30 nightly**: generate lessons for all ACTIVE/PLANNED groups up to `lessonsAheadDays` ahead (skip holidays; never duplicate — unique index); set group FINISHED after endDate; update FROZEN/ACTIVE statuses by freeze dates; **sync billing for every open enrollment** (asOf = today); recompute live payslips cache if any.
- **10:00**: reminders (period starts in N days; debts) → Notification queue.
- **20:00**: teachers with unmarked lessons today → reminder.
- **21:00**: owner/manager daily report.
- **Every 5 s**: process Notification queue.
Jobs must be idempotent and safe to re-run; log start/end/counts. Expose `npm run job:<name>` to run any job manually.

---

## 12. Tech stack and Docker (decided)

- **One TypeScript codebase**:
  - `Next.js 15` (App Router, React 19, server components + server actions) for the admin web, teacher mobile pages (`/t/...`), public lead form (`/f/<slug>`), public receipt/pay pages, and API routes (`/api/payme`, `/api/health`).
  - `Prisma 6` + **PostgreSQL 16**. Migrations committed (`prisma migrate`), plus a raw SQL migration for the partial unique index on Enrollment.
  - `worker` = Node process (`tsx` or compiled with `tsup`) running grammY bot + cron jobs, sharing `src/lib` with the web app.
  - Auth: phone + password (bcryptjs), session = signed JWT in httpOnly cookie (jose), secret from env `AUTH_SECRET`.
  - Validation: zod. Styling: Tailwind CSS. Charts: a tiny SVG component or `recharts` (light).
  - Tests: **vitest** — billing engine, salary engine, Payme handlers, phone normalizer, period math.
  - Pin exact dependency versions (no `^`), use stable releases ≥ 2 weeks old. Known-good set as of 2026-10: next 15.5.x, react 19.1.x, prisma 6.19.x, typescript 5.9.x, zod 3.25.x, tailwindcss 4.3.x, grammy 1.4x, jose 6.x, bcryptjs 3.x, vitest 3.2.x, tsx 4.20.x. Node 22 LTS images.
- **Docker** (`docker compose up --build` must work from a clean clone):
  - `db`: `postgres:16-alpine`, volume `pgdata`, healthcheck `pg_isready`.
  - `migrate`: one-shot, runs `prisma migrate deploy` then `seed` **only if** `SEED_DEMO=true` and DB empty; `web` and `worker` depend on it `service_completed_successfully`.
  - `web`: multi-stage Dockerfile (deps → build with `output: 'standalone'` → slim runtime as non-root), port `3000`, healthcheck `/api/health`.
  - `worker`: same image (different command) or separate target.
  - `.env.example` with every variable documented: `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, `TELEGRAM_BOT_TOKEN` (optional), `SEED_DEMO`, `TZ=Asia/Tashkent`.
  - Prisma: set `binaryTargets = ["native", "linux-musl-openssl-3.0.x", "linux-musl-arm64-openssl-3.0.x"]` (Sardor's Mac is Apple Silicon/arm64; alpine needs musl targets) and install `openssl` in alpine images.
  - Also support local dev without Docker: `npm run dev` + `npm run worker:dev` against a Postgres URL.
- Repo layout:
```
lms-light/
  HANDOFF.md  DECISIONS.md  README.md  CLAUDE.md
  docker-compose.yml  Dockerfile  .env.example  .dockerignore
  prisma/ schema.prisma  migrations/  seed.ts
  src/app/            (Next routes: (auth)/login, (admin)/..., t/..., f/[slug], r/[receiptId], api/payme, api/health)
  src/components/     (UI kit: table, form fields, dialog, badge, money, date, page header, empty state)
  src/lib/            db.ts auth.ts perms.ts i18n/ (uz.ts, ru.ts) money.ts dates.ts phone.ts audit.ts csv.ts
  src/lib/billing/    periods.ts lessons.ts engine.ts sync.ts allocation.ts  (+ *.test.ts)
  src/lib/salary/     engine.ts (+ test)
  src/lib/payments/   payme.ts provider.ts (+ test)
  src/worker/         index.ts bot/ jobs/
  tests/              integration tests (optional, against test DB)
```
---

## 13. Demo seed (so Sardor can click around immediately)
Center "Demo O'quv Markazi" (slug `demo`), 2 branches (Chilonzor, Yunusobod), 3 rooms each, holidays = real Uzbek public holidays in the seeded date range (1 Jan, 8 Mar, 21 Mar Navro'z, 9 May, 1 Sep Independence Day, 1 Oct Teachers' Day, 8 Dec Constitution Day).
Staff: owner `998901234567` / `demo1234`, manager, 2 admins (one "cashier" style switches), 4 teachers (one also admin). Print logins in README.
Courses: General English A1 (subscription, 600,000/month, calendar, 3×/week 90 min), IELTS Intensive (subscription, 900,000, student start, 3×/week), Python Foundation (package, whole course 4 months, 2,400,000 in 4 installments), Matematika DTM (subscription, 500,000, group start), Individual English (package N=1, 150,000/lesson).
8 groups with slots, start dates spread over the last 3 months; lessons generated; ~60 students in ~45 families (some siblings), mix of TRIAL/ACTIVE/FROZEN/LEFT/TRANSFERRED enrollments; attendance marked for past lessons (~85% present); payments so that ~25% of families have debt; a few reversals; expenses for 3 months; salary rules for all teachers (mix of models), last month locked & paid; 30 leads across all stages with notes. Realistic Uzbek names. Deterministic (seeded random) so tests can rely on it.

---

## 14. Build order (do it in this order; commit after each)
1. Scaffold repo, pinned deps, Tailwind, lint/format, `CLAUDE.md`, `.env.example`, Dockerfile + compose skeleton; **get `docker compose up` showing a "hello" page with DB connected FIRST** (catch Docker/Prisma/arm64 issues early).
2. Prisma schema (§6 + Notification), migrations, partial unique index, seed skeleton.
3. Auth, session, roles/permissions, branch scoping, i18n (uz/ru), app shell (sidebar, top bar with branch switcher + language), UI kit.
4. Billing core as pure functions + **thorough vitest suite** (§15 cases) BEFORE wiring UI. Then `syncEnrollment` with DB.
5. Settings: center, branches, rooms, holidays, staff.
6. Courses, groups (slots, clash check), lesson generation, lesson cancel/reschedule/substitute.
7. Students, families/guardians, enrollments (trial, activate, transfer, freeze, leave, discount), student page (groups, ledger, attendance, history).
8. Attendance (admin + teacher mobile `/t`), lesson HELD logic.
9. Payments (take, receipt, reverse, refund), debtors, family wallet/allocation view.
10. Salary engine + tests, salary pages (live, adjustments, lock, paid), teacher view.
11. Expenses, reports, owner dashboard, Today page.
12. Leads kanban, public lead form, notes, convert to student + trial enrollment.
13. CSV exports, audit log pages, search.
14. Worker: jobs + Notification queue; Telegram bot (§9).
15. Payme endpoint + tests + pay links (§10).
16. Full demo seed (§13). README (Uzbek + English) with run steps, logins, screenshots optional.
17. Verification pass (§15), fix everything, final status in README.

---

## 15. Acceptance checks (all must pass before you say "done")
**Automated (vitest)** — billing engine must cover at least:
- Calendar subscription, full month → exactly price.
- Join mid-month (5 of 13 lessons left) → round(price×5/13 to 100).
- Center cancels 1 lesson after month was charged → CREDIT of one lesson's value on next sync; second sync posts nothing.
- Student absent → no credit. EXCUSED with setting off → no credit; setting on → credit.
- Freeze 2 weeks inside a month → credit for frozen lessons; freeze spanning two months handled.
- Transfer on the 15th from group A (600k) to group B (800k), 12 lessons each per month, 6 held before move → A charged 300k, B charged 400k (after sync both sides).
- Leave mid-month → future lessons credited.
- Discount 20% until end of next month → applied to 2 periods then stops.
- Group-start and student-start anchors, including start on the 31st (clamp).
- Package N=12 → charged at start; after 12 consumed and more lessons ahead → second package charged; leave after 15 lessons → total = 15 × rate.
- Package whole course with 4 installments → installments become due monthly.
- Per-lesson (N=1) works.
- Holidays generate no lessons and are never charged.
- Idempotency: running sync N times = same ledger.
- Allocation: sibling family with one payment covers oldest charges first; directed payment covers its enrollment.
- Salary: each model; substitute teacher gets the lesson; trial students excluded unless setting; payFromCollected toggle; adjustments; lock freezes numbers.
- Payme: every method happy path + each error code + idempotency + timeout.
**Manual / end-to-end (do it in a real browser against `docker compose up`)**:
- Fresh `docker compose down -v && docker compose up --build` works on this Mac (arm64), app on http://localhost:3000, health OK, worker running.
- Log in as owner → dashboard shows seeded numbers.
- Create a branch, room, course, group with slots → lessons generated; clash with an occupied room/teacher is refused with a clear message.
- Create a lead → move to TRIAL_BOOKED → convert to student + trial enrollment → mark trial attendance → activate → charge appears pro-rated.
- Take a cash payment → receipt prints → debt drops → reverse it (with permission) → debt returns; admin without `payments.refund` cannot reverse.
- Transfer a student mid-month → both ledgers correct.
- Teacher logs in on a phone-sized viewport → marks attendance → lesson HELD → teacher salary updates.
- Owner locks last month's payslip, marks paid → expense created → profit report matches.
- Every list exports CSV that opens correctly in Excel (UTF-8 BOM).
- Switch language to Russian → UI translated.
- With a real bot token (if Sardor sets one) the bot links by phone and shows balance; without a token the worker runs jobs without crashing.
- `npm run typecheck`, `npm run lint`, `npm test`, `next build` all clean.
Then get an **independent review** (spawn a fresh subagent that did not write the code) of the billing engine, permissions (no data leak across centers/branches), and Payme handler. Fix what it finds.

---

## 16. Working rules for you (Claude Code session)
- Sardor is asleep/away; **keep going autonomously** until §15 passes. Don't wait for confirmations.
- Decide yourself; log non-obvious decisions in `DECISIONS.md` (one line each: date, decision, why).
- No paid services, no cloud deploys, no external accounts. Local Docker only.
- Keep secrets out of git (`.env` in .gitignore). Generate a random `AUTH_SECRET` for local `.env`.
- Prefer boring, well-known libraries; pin versions; no experimental flags.
- Write clean, typed code with small modules; money math only in `src/lib/billing` and `src/lib/salary`; never compute money in UI components.
- Every server action checks session + permission + branch scope + `centerId`. Write a helper and use it everywhere.
- Every money/status mutation writes an AuditLog row in the same transaction.
- If Docker build fails, fix it — don't work around by skipping Docker.
- When done: update README "Holat / Status" (Uzbek first, then English), list what works, how to run, logins, known gaps, next steps (v2 list: Click, Uzum, SMS, grades/report cards, exams, public offer, Mini App).
- Sardor's communication style: short, plain, standup-like. Final message to him ≤ 10 lines.

## 17. Open questions (answer with defaults now; pilots may change later)
- First segment: language centers vs IT schools vs exam prep → **default: language centers** (seed + copy aimed at them, but everything generic).
- Do pilots use ModMe or Excel today? → build an **Excel/CSV import** for students (name, phone, parent phone, group code, balance) if time allows after §15 — nice to have.
- How many centers already have their own Payme merchant? → unknown; keep Payme optional.
- Russian at launch? → yes, uz + ru.
- Product name/brand → working name **"lms-light"**; keep the name in one config constant so it's easy to rename.

## 18. Sources
- ModMe: https://modme.uz/uz , prices https://modme.uz/uz/prices
- ModMe release notes (from Sardor's Telegram export `~/Downloads/ChatExport_modme-copy/messages.html`): telegra.ph pages v1.4.1 … v3.1.4, e.g. https://telegra.ph/Modme-Platform-Update-v2021-06-14 (six billing modes), https://telegra.ph/Modme-Platform-Update-v310-10-24-2 (automations, IP telephony), https://telegra.ph/Modme-platformasinig-yangilangan-112-versiyasi-06-05 (v3.1.4)
- Spot.uz on ModMe (2023): https://www.spot.uz/ru/2023/03/07/modme-crm/ , https://www.spot.uz/ru/2023/02/18/uzvc/
- Umai CRM: https://www.umaicrm.kz/en
