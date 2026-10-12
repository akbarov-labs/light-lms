// Public "create your center" signup: bot check and slug rules. Pure functions (tested); per-IP limits use
// RULES.signupIp / signupCreatedIp in lib/auth/ratelimit.ts; the DB side is in app/signup/actions.ts.

/** A human needs at least this long to fill the form; faster posts are bots. */
export const MIN_FILL_MS = 3_000;
/** A form older than this is stale (reload the page). */
export const MAX_FILL_MS = 24 * 3600_000;

/** Honeypot + timing: a filled hidden field, a missing/forged timestamp or an instant post is a bot. */
export function looksLikeBot(f: { honeypot: string | null | undefined; startedAt: string | null | undefined }, now: Date): boolean {
  if (f.honeypot && f.honeypot.trim() !== "") return true;
  const started = Number(f.startedAt);
  if (!Number.isFinite(started) || started <= 0) return true;
  const elapsed = now.getTime() - started;
  return elapsed < MIN_FILL_MS || elapsed > MAX_FILL_MS;
}

const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu",
  я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h", "№": "",
};

/** URL slug for the public lead form (/f/<slug>): latin, digits and dashes, 2–40 chars. */
export function slugify(name: string): string {
  const latin = [...name.toLowerCase()].map((ch) => CYRILLIC[ch] ?? ch).join("");
  const s = latin
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ʻʼ'`‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return s.length >= 2 ? s : "markaz";
}

/** First free slug: base, base-2, base-3 … (`taken` = slugs already in use with this prefix). */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const s = `${base}-${i}`;
    if (!used.has(s)) return s;
  }
  return `${base}-${Date.now().toString(36)}`;
}
