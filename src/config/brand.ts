// Product identity, contacts and legal details — the one file to edit when the name or company changes.
// Empty strings are hidden on public pages (never shown as placeholders); legal pages show a "draft" note
// until `legal.entity` is filled in.
import { demoUrl, isDemoMode, mainSiteUrl } from "@/lib/env";

export const BRAND = {
  /** Product name shown in titles, the landing page, receipts' footer and legal texts. */
  name: "Sabaq",
  /** Short line under the name in the landing header and footer. */
  tagline: { uz: "O'quv markazlari uchun CRM", ru: "CRM для учебных центров" },
  contact: {
    /** e.g. "998901234567" — shown formatted, used for tel: links. */
    phone: "",
    /** Telegram username without @, e.g. "sabaq_support". */
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
  return isDemoMode();
}

/** Where the landing page's "See the demo" button goes: DEMO_URL, else /demo on a demo server, else nowhere. */
export function demoHref(): string | null {
  const url = demoUrl();
  if (url) return url;
  return demoMode() ? "/demo" : null;
}

/** Where "create your own center" points from a demo server (the real site's /signup). */
export function signupHref(): string {
  const site = mainSiteUrl();
  return site ? `${site}/signup` : "/signup";
}

/** A demo server with no main site to send signups to: /signup shows the contacts instead of the form,
 * so no real center is created in a database that is wiped every night. */
export function signupClosed(): boolean {
  return demoMode() && !mainSiteUrl();
}
