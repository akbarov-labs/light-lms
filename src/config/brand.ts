// Product identity, contacts and legal details — the one file to edit when the name or company changes.
// Empty strings are hidden on public pages (never shown as placeholders); legal pages show a "draft" note
// until `legal.entity` is filled in.

export const BRAND = {
  /** Product name shown in titles, the landing page, receipts' footer and legal texts. */
  name: "lms-light",
  /** Short line under the name in the landing header and footer. */
  tagline: { uz: "O'quv markazlari uchun CRM", ru: "CRM для учебных центров" },
  contact: {
    /** e.g. "998901234567" — shown formatted, used for tel: links. */
    phone: "",
    /** Telegram username without @, e.g. "lmslight_support". */
    telegram: "",
    email: "",
  },
  legal: {
    /** Legal name of the company that sells the service, e.g. "\"Ilm Soft\" MChJ". */
    entity: "",
    /** STIR (taxpayer number). */
    tin: "",
    address: "",
    /** Bank details line for the public offer, e.g. "h/r 2020 8000 ..., MFO 00000, Bank ...". */
    bank: "",
    /** City where the offer is published. */
    city: "Toshkent",
    /** Version/date of the current offer and privacy texts; signup stores it with the consent. */
    version: "2026-10-12",
  },
} as const;

/** Runtime switches that differ per server (see .env.example). */
export function demoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

/** Where the landing page's "See the demo" button goes: DEMO_URL, else /demo on a demo server, else nowhere. */
export function demoHref(): string | null {
  const url = process.env.DEMO_URL?.trim();
  if (url) return url;
  return demoMode() ? "/demo" : null;
}

/** Where "create your own center" points from a demo server (the real site's /signup). */
export function signupHref(): string {
  const site = process.env.MAIN_SITE_URL?.trim().replace(/\/$/, "");
  return site ? `${site}/signup` : "/signup";
}
