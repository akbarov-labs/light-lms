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
