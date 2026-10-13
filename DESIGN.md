---
name: lms-light
description: White-label admin for small learning centers — front-desk cash, debts, groups and attendance.
colors:
  accent-default: "#2563EB"
  accent-fg: "#FFFFFF"
  canvas: "#FAFAFA"
  surface: "#FFFFFF"
  line: "#E4E4E7"
  divider: "#F4F4F5"
  ink: "#09090B"
  text: "#18181B"
  text-body: "#3F3F46"
  text-muted: "#71717A"
  icon-muted: "#A1A1AA"
  fill-hover: "#F4F4F5"
  debt: "#DC2626"
  debt-tint: "#FEF2F2"
  ok: "#047857"
  ok-tint: "#ECFDF5"
  warn: "#B45309"
  warn-tint: "#FFFBEB"
  chart-latest: "#18181B"
  chart-bar: "#E4E4E7"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
    fontFeature: "\"tnum\""
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.33
  receipt:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
  hero-sm:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 600
    lineHeight: 1.05
  hero-md:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "52px"
    fontWeight: 600
    lineHeight: 1.05
  hero:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "60px"
    fontWeight: 600
    lineHeight: 1.05
  section-sm:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.1
  section:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 600
    lineHeight: 1.1
  lead:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
  body-large:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  micro:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.45
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent-default}"
    textColor: "{colors.accent-fg}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "#FAFAFA"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "#52525B"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.fill-hover}"
    textColor: "{colors.text}"
  button-sm:
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "16px"
  badge:
    rounded: "{rounded.pill}"
    padding: "2px 8px"
    typography: "{typography.caption}"
  nav-item:
    textColor: "#52525B"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "36px"
  nav-item-active:
    backgroundColor: "{colors.fill-hover}"
    textColor: "{colors.ink}"
---

# Design System: lms-light

## Overview

**Creative North Star: "The Quiet Ledger"**

The category standard played straight, at the craft level of Stripe Dashboard, Linear, Vercel/Geist and Notion. The screen is a calm grey-white ledger where nothing competes with the one fact the receptionist needs: who owes what, and what to do next. Density is moderate to high, built for someone at a front desk all day, but every row has air and every number lines up.

The system is white-label: the learning center's own color is the only brand color, and it shows up in exactly three places. Everything else is monochrome zinc. This rejects the generic "Tailwind template" look (slate cards, uppercase eyebrow labels, unicode glyph icons, walls of colored buttons), not the SaaS convention itself.

Money is the product. A payment always shows a summary before it is committed and a toast or receipt after. Red means debt and nothing else.

**Key Characteristics:**
- Monochrome zinc on a near-white canvas, white surfaces, 1px hairlines, almost no shadow.
- One accent, the center's color, with a contrast-computed foreground.
- Geist Sans with tabular figures everywhere money or counts appear.
- Line icons (Lucide, 1.75 stroke in nav) instead of glyphs.
- One primary action per header; everything else secondary, ghost or inside a "⋯" menu.

## Colors

A neutral zinc ramp carries the whole interface; color is reserved for meaning.

### Primary
- **Center Accent** (runtime `--accent`, default #2563EB): the learning center's brand color, set per tenant through `accentVars()`. Used only for the primary button, the keyboard focus ring and input focus border, and the active nav icon. Its foreground (`--accent-fg`) is computed by luminance so white or near-black text always reads on it.

### Neutral
- **Canvas** (#FAFAFA): the app background behind cards.
- **Surface** (#FFFFFF): cards, tables, dialogs, the top bar and sidebar.
- **Hairline** (#E4E4E7): card borders, sidebar and top-bar dividers.
- **Row Divider** (#F4F4F5): lines between table rows and card header rules; also the hover and active fill.
- **Ink** (#09090B): page titles and the active nav label.
- **Text** (#18181B): primary text, money values that are not debt.
- **Body Text** (#3F3F46): table cell text and labels.
- **Muted Text** (#71717A): secondary lines, hints, placeholders (4.8:1 on white).
- **Muted Icon** (#A1A1AA): idle nav icons and decorative icons only, never text.

### Semantic
- **Debt Red** (#DC2626, tint #FEF2F2): money owed. Debt figures, "Qarz qoladi" lines, debtor badges.
- **Paid Green** (#047857, tint #ECFDF5): active status badges, credit amounts, "present" marks.
- **Warning Amber** (#B45309, tint #FFFBEB): trial status, late marks, pending states.
- Sky (#0369A1) and violet appear only as badge tones for informational states.

### Named Rules
**The Three Places Rule.** The center accent appears on the primary button, the focus ring and the active nav icon. Not on links, headings, chart bars, stats or badges.

**The Red Means Owed Rule.** Red is used only for money owed (and money going backwards: reversals, a loss), destructive confirmations, and the "absent" attendance mark. A zero balance, a total, a cancelled lesson or a chart is never red.

**The Neutral Link Rule.** Links are ink with a zinc-300 underline that darkens on hover (`decoration-zinc-300 hover:decoration-zinc-900`); they never borrow the accent.

## Typography

**Display Font:** Geist Sans (with ui-sans-serif, system-ui)
**Label/Mono Font:** Geist Mono, used only on the printable receipt

**Character:** One neutral grotesque at tight tracking on titles; hierarchy comes from size and weight, not from color or case. Cyrillic is covered for the Russian locale.

### Hierarchy
- **Display** (600, 28px, -0.02em, tabular): the single money figure at the top of a student page.
- **Headline** (600, 22px, -0.02em): page titles in the page header; stat values step from 20px to 22px at 2xl.
- **Title** (600, 13px): card headers.
- **Body** (400, 14px): table cells, form values, dialog text. Inputs render at 16px on phones to prevent iOS zoom, 14px from `sm`.
- **Label** (500, 13px): field labels, stat labels, back links.
- **Caption** (500, 12px): badges, table column headers, sub-lines under names, nav group labels.

### Product site ramp (landing, legal pages only)
- **Hero** (600, 40 → 52 → 60px by breakpoint, -0.035em, line-height 1.05): the one landing headline.
- **Section** (600, 32 → 40px, -0.03em): landing section headings.
- **Lead** (400, 17px, line-height 1.6): the paragraph under a section heading.
- **Body large** (400–600, 15px): feature text, FAQ, legal text.
- **Micro** (500, 11px): chips on demo UI fragments only, never body copy.

### Named Rules
**The Tabular Money Rule.** Every table and every `.tnum` element uses tabular figures; amounts are right-aligned and formatted as "1 300 000 so'm" with thin grouping.

**The No Eyebrow Rule.** No uppercase letter-spaced labels above headings. Group and column labels are sentence case at 12px in muted text.

## Layout

A fixed 240px left sidebar (from `lg`), a 56px sticky translucent top bar, and a content column capped at 1280px with 16 / 24 / 32px side padding (base / sm / lg). On phones the sidebar becomes an off-canvas drawer behind a 44px hamburger, and global search drops to its own row under the top bar.

Page rhythm: page header (title, optional subtitle, actions aligned right, 24px below), then cards stacked with 16px gaps. Stat rows are two columns until `xl`, then four. Two-column card grids switch on at `xl` so tables never squeeze at laptop widths. Tables scroll horizontally inside their card rather than wrap; on phones, dense tables (family periods) become stacked rows with a second line.

Teacher pages (`/t`) are phone-first with a bottom tab bar; sticky save strips sit above it.

## Elevation & Depth

Flat by default. Depth comes from tonal layering: a #FAFAFA canvas, white surfaces, 1px hairlines. Shadows appear only on things that float above the page.

### Shadow Vocabulary
- **Pop** (`box-shadow: 0 8px 24px -6px rgb(9 9 11 / 0.18), 0 2px 6px -2px rgb(9 9 11 / 0.08)`): dialogs, the command palette, row menus, toasts.
- **Hairline lift** (`shadow-sm`): the printable receipt card only.

### Named Rules
**The Float-Only Shadow Rule.** If it does not overlay other content, it has no shadow; cards and stats rely on the hairline.

## Shapes

Gently rounded, consistent by tier: 12px on cards, stats and the money block; 8px on buttons, inputs, nav items and menu items; 16px on dialogs and the command palette; full pills on badges and segmented-control tracks. Borders are always 1px. Icons are 16px (14px inside small buttons) line icons.

## Components

### Buttons
- **Shape:** gently rounded (8px), 36px tall (32px small), 14px horizontal padding (10px small), 14px/13px medium text, 6px icon gap.
- **Primary:** center accent fill with contrast-computed text; hover darkens via `brightness(0.94)`, active `0.9`. One per page header at most.
- **Secondary:** white with a zinc-200 border; hover lifts the border to zinc-300 and the fill to zinc-50. "Add" actions inside cards use secondary with a leading Plus icon.
- **Ghost:** no border, zinc-600 text, zinc-100 fill on hover. Used for tertiary header actions such as "Arxivlash".
- **Danger:** red-600 fill, only inside a confirmation step.
- **Pending:** submit buttons show an inline spinner and disable while the server action runs.

### Badges
- **Style:** pill, 12px medium text, tinted background with a 6px status dot (gray, green, red, amber, sky, violet).
- **Use:** enrollment and lead status, discount chips. Never as buttons.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** white on the canvas.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px hairline (#E4E4E7).
- **Header:** min 48px, 13px semibold title left, actions right, divider below.
- **Internal Padding:** 16px; tables run edge to edge (`pad={false}`).

### Inputs / Fields
- **Style:** 36px, 8px radius, zinc-200 border, white fill; hover zinc-300.
- **Focus:** border turns accent plus a 3px accent ring at 15% opacity.
- **Label:** 13px medium zinc-700 above, 6px gap; hints 12px muted below.
- **Disabled:** zinc-50 fill, muted text.
- **Money input:** live digit grouping as you type, "so'm" suffix, a hidden digits-only field submits.

### Tables
- Header row 36px, zinc-50 tint, 12px muted labels; rows 1px zinc-100 dividers with a zinc-50 hover; first and last cells get 16px padding. Money columns right-aligned and tabular. Row actions collapse into a single "⋯" menu, with at most one inline contextual action (e.g. "Faollashtirish" for trials).

### Navigation
- **Sidebar:** grouped sections (12px muted group labels), 36px items with a 16px line icon. Idle: zinc-600 text, zinc-400 icon. Hover: zinc-50 fill. Active: zinc-100 fill, ink text, accent icon, `aria-current="page"`.
- **Top bar:** ⌘K search trigger, "+ To'lov" quick pay (small primary), branch select, avatar menu with language rows and logout.
- **Teacher bottom tabs:** icon over label; active label goes ink and the icon takes the accent.

### Payment Flow (signature)
Two steps in one card. Step one: enrollment select pre-picked to the one with debt, money input with the current debt shown beside the label, date, method as a segmented control. Step two: a tinted summary panel with the amount at 28px, method, student, group and date, and one consequence line ("Qarz qoladi: X" in red, "Ortiqcha" or "Qarz to'liq yopiladi"). Confirming opens the receipt, which prints in Geist Mono and shows "Qolgan qarz" rather than a signed balance.

### Language Menu
One picker everywhere (`LanguageMenu`, `src/components/language-menu.tsx`). Trigger: ghost, 36px, Lucide `Languages` icon in muted zinc, the current language, a 14px chevron that turns when open; `compact` shows the code (UZ / RU) and drops the chevron on phones. Menu: 176px floating panel, 12px radius, pop shadow, rows of each language written in its own script (O'zbekcha, Русский) with a check on the current one. Pickers at the foot of a page open upward. Announced in both languages ("Til · Язык") so a visitor who cannot read the current one still finds it. Monochrome: the accent never appears here. Inside the account menu the same rows sit under a "Til" label. No flags (a language is not a country).

### Command Palette
A 576px dialog with 16px radius and the pop shadow: search input, grouped results (students, groups, pages) with line icons, family debt on the right in red, and a ↵ hint on the active row. In pay mode, picking a student jumps straight to that family's payment form.

## Do's and Don'ts

### Do:
- **Do** keep the center accent to the primary button, focus ring and active nav icon.
- **Do** right-align every amount with tabular figures and the "so'm" suffix.
- **Do** show one money truth per screen, with a summary before any money action and a toast or receipt after.
- **Do** use Lucide line icons at 16px; label icon-only buttons with `aria-label`.
- **Do** use 16px inputs on phones and 44px touch targets for attendance marks and the hamburger.
- **Do** put secondary row actions in the "⋯" menu instead of adding buttons.

### Don't:
- **Don't** use red for anything other than money owed, reversals/loss, destructive confirmation, or the absent mark; a zero debt is ink, not red.
- **Don't** color links, headings or charts with the accent; the latest chart period is ink (#18181B), the rest zinc-200.
- **Don't** add uppercase letter-spaced eyebrow labels or unicode glyph icons (→, ✓, ✕, ＋).
- **Don't** put shadows on cards or stats.
- **Don't** use `text-zinc-400` for readable text; muted text is zinc-500.
- **Don't** show a signed balance to parents; say "Qolgan qarz" or "Oldindan to'langan".
