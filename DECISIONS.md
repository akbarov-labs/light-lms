# Decisions log

(one line per decision: date — decision — why)

2026-10-12 — Built in ~/dev/sites/light-lms (Sardor moved the handoff here) — the session's working folder.
2026-10-12 — WEB_PORT/DB_PORT are configurable in docker-compose (defaults 3000/5433); this Mac's port 3000 is taken by another project's container (tma-commerce-web), so the local .env uses WEB_PORT=3010 — never stop someone else's container.
2026-10-12 — Postgres is published only on 127.0.0.1 — local dev/tests can reach it, the network can't.
2026-10-12 — TelegramLink unique on (chatId, kind, refId) instead of chatId alone — one parent chat must link to several children/families and a teacher may also be a parent.
2026-10-12 — Notification has a unique dedupeKey — reminder jobs can re-run without sending twice.
2026-10-12 — Subscription denominator also counts slot dates outside the group's own start/end — a group that starts or ends mid-month is pro-rated instead of charging a full month for a few lessons.
2026-10-12 — Whole-course package for a student activated after the group started = only the lessons left, at the course's per-lesson rate — late joiners don't pay for lessons that already happened.
2026-10-12 — Activation charges the period holding the activation day immediately (pro-rated from that day), even when activation is set to the next lesson — the parent sees the amount due before the lesson, and the admin sees the charge right after activating.
2026-10-12 — Closed package with installments: the used amount fills installments in order; the rest is credited — keeps each installment key meaningful.
2026-10-12 — Billing sync takes a Postgres advisory lock per enrollment — two concurrent syncs can't post the same delta twice.
2026-10-12 — Allocation treats a REVERSAL like the entry it reverses (same unit/enrollment, opposite sign); keyless CREDITs count as wallet money.
2026-10-12 — Extra center setting transferAsTrial (default false) — HANDOFF says "or TRIAL if the center wants".
2026-10-12 — Course price changes are versioned (Course.priceHistory) and apply from a chosen date (default: next month) — a price edit never re-prices months already charged. Billing shape (pricing type, renewal, package size, installments) is locked once a course has enrollments; make a new course instead.
2026-10-12 — Student.branchId (home branch) added — branch-scoped admins must see students who are not in a group yet; scoping = home branch OR any enrollment in the branch.
2026-10-12 — Lesson.origDate/origStartTime remember a rescheduled lesson's original slot so lesson generation never recreates it.
2026-10-12 — Branches, rooms and holidays need the `settings` switch (center setup); managers manage staff (only ADMIN/TEACHER roles, only switches they hold themselves).
2026-10-12 — Changing a group's slots deletes future SCHEDULED lessons with no attendance and regenerates them; teacher/room changes move future lessons unless a substitute was set by hand.
2026-10-12 — Holiday added → that day's untouched lessons are removed and billing re-synced; holiday removed → lessons regenerated.
2026-10-12 — Finishing/archiving a group sets endDate=today (if empty) and removes its untouched future lessons.
2026-10-12 — Discounts and price overrides are allowed with `students.edit` (sibling discounts are daily admin work); every change is audited.
2026-10-12 — Expenses are never deleted: "reverse" sets reversedAt (needs payments.refund or archive); salary expenses can't be reversed while their payslip is PAID.
2026-10-12 — Salary rule chosen = latest validFrom ≤ month start (spec); the rule form defaults to the 1st of the viewed month. Locked payslips can be unlocked (not PAID ones) by finance.view.
2026-10-12 — Payme: the key identifies the center (center whose paymeKey matches); an expired (12h) pending transaction of the same family is auto-cancelled (reason 4) instead of blocking a new one; otherwise −31099.
2026-10-12 — Public pay page /pay/<familyId> (cuid, unguessable) shows only the center name, first names and the debt, then redirects to Payme checkout; Telegram pay links point there.
2026-10-12 — Lead stage follows the student automatically: trial booked → TRIAL_BOOKED, trial attended → TRIAL_DONE, activated → ENROLLED (never moves backwards or out of LOST).
2026-10-12 — Debt reminders escalate on days 3/7/14/30 after the oldest unpaid charge; admins can also send one manually from Debtors (once per family per day).
2026-10-12 — Public lead form: a repeat submission from a phone with an open lead becomes a note on that lead (no duplicates); honeypot field against bots.
2026-10-12 — Worker runs the nightly job once on start, so a fresh install has lessons/charges immediately.
2026-10-12 — DB integration tests use a separate `<db>_test` database (script drops/recreates only that schema); `npm test` stays DB-free.
2026-10-12 — Docker on this Mac: the credential helper (keychain) hangs pulls in non-interactive shells; builds were run with a credential-free DOCKER_CONFIG (README → Troubleshooting).
2026-10-12 — Student import (CSV/Excel-saved CSV): students join their group as ACTIVE with billing from the 1st of next month; the old system's balance becomes one keyless "opening balance" CHARGE (debt) or CREDIT (prepaid) — no double charge for the current month, and opening balances never count as revenue.
2026-10-12 — Money is shown as "1 250 000 so'm" in both languages (HANDOFF format); the Telegram bot uses "сум" for Russian chats.
2026-10-12 — Independent review fixes: enrollment price/discount changes are versioned (Enrollment.termsHistory, effective-from date, default 1st of current month) and group price overrides too (Group.priceHistory, default next month) — no change re-prices months already charged.
2026-10-12 — Only one discount applies: percent wins over a fixed amount.
2026-10-12 — A lesson before the enrollment's startDate is never chargeable; activation dates are clamped to startDate.
2026-10-12 — A whole-course package is always exactly one package; its lesson count = generated lessons + remaining slot dates (so schedule changes count real lessons); a closed one is capped at the package price. A package student leaving today is closed today.
2026-10-12 — Payme: Perform/Cancel lock the transaction row (SELECT … FOR UPDATE); a Perform that loses to a Cancel answers −31008; staff cannot reverse a Payme payment by hand (Payme cancels it); amounts must be whole so'm (tiyin % 100 = 0, else −31001); GetStatement reports Payme's own `time`.
2026-10-12 — Branch scope tightened: managers edit only staff who work entirely inside their branches and only replace their own branch assignments; salaries (pages, actions, exports) are limited to teachers of the user's branches; the global audit journal is for unscoped users (owner) only; receipts need payments.take/finance.view and family scope; joining an existing family (by phone or id) requires access to that family.
2026-10-12 — Import: opening balances need `payments.refund` and are only written to newly created families.
2026-10-12 — Mark-paid claims LOCKED→PAID atomically before booking the expense (no double expense on double click).
