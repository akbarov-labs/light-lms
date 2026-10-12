# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Reception administrator** (primary): works at a laptop all day at the front desk of a private education center. Daily job: take leads and calls, book trial lessons, enroll students into groups, take payments and print receipts, chase debts.
- **Center owner / manager**: checks revenue, debt, new vs. left students and teacher load, mostly on a phone; approves salaries; manages settings and staff.
- **Teacher**: on a phone during or right after a lesson; marks attendance and grades, checks their own salary so far.
- **Parent / student**: does not use the web admin; uses the Telegram bot and the public pay page / lead form.

## Product Purpose

A cloud CRM/LMS that runs the whole business of a private education center in Uzbekistan (o'quv markazi): leads → trial lesson → group, schedule and attendance, monthly tuition and debts, teacher salaries, expenses and reports. Success: a center drops Excel on day one, and an admin never needs a manual to know why a student owes money or what a teacher earned.

## Positioning

Against ModMe (the local leader): cheaper and self-serve to start, Telegram-first for parents/teachers, online payment (Payme) built into every reminder, and money that is correct by construction — billing is derived from lessons and self-heals, nothing is edited or deleted, every number traces back to lessons and ledger rows.

## Operating Context

- First segment: language centers (also IT schools, exam prep, kids clubs).
- Front desk: phone calls, cash/card payments, printed 80mm/A6 receipts, parents standing at the counter asking "how much do I owe?".
- Families with siblings share one wallet; debt is shown per group.
- Teachers mark attendance on a phone between lessons; a lesson becomes "held" when attendance is saved.
- Languages: Uzbek (Latin) default, Russian second. Money "1 250 000 so'm", dates dd.MM.yyyy, timezone Asia/Tashkent.

## Capabilities and Constraints

- Roles: Owner, Manager (branch-scoped), Admin, Teacher, plus permission switches (finance view, take payments, refunds, archive, export, leads, students/groups edit, staff, settings).
- Multi-branch; branch switcher in the top bar.
- Two pricing types (monthly subscription, package), pro-rating by real lessons, trial → activation, transfer, freeze, leave, discounts, family wallet with FIFO allocation.
- Fixed lead stages: New → Contacted → Trial booked → Trial done → Enrolled / Lost.
- Everything runs locally in Docker; no paid services.
- Stack is set: Next.js 15 (App Router, server components/actions), Tailwind 3, Prisma/Postgres.

## Brand Commitments

- **White-label**: each center's own name, logo and accent color lead; the platform stays in the background (working name "lms-light", final product name undecided). The interface must look right with any center accent color.
- **Category standard, executed at full craft** (chosen 2026-10-12 over distinctive directions): a clean modern SaaS admin. The craft bar is set by Stripe Dashboard (money and table precision), Linear (speed, keyboard, compact hierarchy), Vercel/Geist (monochrome rigor, typography) and Notion (approachable for non-technical staff).

## Evidence on Hand

- Real product spec: HANDOFF.md; decisions: DECISIONS.md.
- Deterministic demo center ("Demo O'quv Markazi") seeded from prisma/seed-demo.ts.
- No customer logos, testimonials or pricing proof exist yet — do not fabricate them.

## Product Principles

1. The next action first: every screen answers "what do I do now?" before "what can I do?".
2. One money truth per screen: never show two different "owes" numbers without saying whose they are.
3. Money moments get reassurance: summary before, confirmation and receipt after.
4. Fast at the counter, calm on the phone: dense and keyboard-friendly for the admin, thumb-sized and forgiving for teachers and owners.
5. The center's brand, not ours.

## Accessibility & Inclusion

- WCAG 2.1 AA contrast for text, including with any center accent color.
- Touch targets ≥ 44px on teacher/mobile screens; 16px inputs on phones.
- Labels on every input (not placeholder-only); visible keyboard focus.
