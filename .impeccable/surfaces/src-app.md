---
version: 1
slug: "src-app"
primary_target: "src/app"
related_targets: []
---

# Surface brief: admin app (src/app)

Scope: the whole web admin (owner/manager/admin) plus teacher mobile pages (/t), public lead form and pay page. Mode: Operate.
Audience/job: reception admin at the front desk all day (payments, debts, enrollments, leads); owner on a phone; teacher marking attendance on a phone.
Constraints: white-label (center accent color is the only brand color, must keep contrast with any accent), uz/ru, Next.js 15 + Tailwind 3, server components.
Critique inputs: .impeccable/critique/2026-10-12T00-25-17Z__src-app.md (24/40).

## Direction contract
THESIS: The category standard played straight at Stripe/Linear/Geist/Notion craft. It refuses the generic "Tailwind template" look (slate cards, uppercase labels, unicode glyph icons, button walls), not the convention itself.
OWN-WORLD: Monochrome zinc neutrals on a #FAFAFA canvas, white surfaces, 1px #E4E4E7 hairlines, 12px card radius, almost no shadow; Geist Sans with tabular figures; one accent = the center's color, used only for the primary action, focus and active nav; semantic red only for money owed.
STORY: The admin sees what to do now and one unambiguous money truth per screen; every money action shows a summary before and a toast/receipt after.
FIRST VIEWPORT: Left sidebar with grouped sections and line icons; top bar with global search (⌘K), "+ To'lov" quick action, branch switcher and user menu; page header with one primary action; content tables with right-aligned tabular amounts and a single "⋯" row menu.
FORM: canon (category standard), user-selected over the rolled "Kassa daftari" (position 3 of the grounded list), seed key 364c55d8.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
