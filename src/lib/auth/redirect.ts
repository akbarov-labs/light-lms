// Where to go after login (`?next=`). Only a path on this site — never another host.

const BASE = "http://x.invalid";

/**
 * Accept `next` only if it is a path ("/…") without control characters that, resolved against a
 * dummy origin, stays on that origin. Browsers strip tab/newline inside URLs, so "/\t/evil.com"
 * becomes "//evil.com" — hence the control-character ban before the origin check.
 */
export function safeNextPath(next: unknown): string | null {
  if (typeof next !== "string" || !next.startsWith("/") || next.length > 2000) return null;
  if (/[\x00-\x1f\x7f]/.test(next)) return null;
  try {
    const url = new URL(next, BASE);
    if (url.origin !== BASE) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}
