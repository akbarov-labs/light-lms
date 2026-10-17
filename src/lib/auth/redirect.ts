// Where to go after login (`?next=`). Only a path on this site — never another host.

const BASE = "http://x.invalid";

/**
 * Accept `next` only if it is a path ("/…") without control characters that, resolved against a
 * dummy origin, stays on that origin. Browsers strip tab/newline inside URLs, so "/\t/evil.com"
 * becomes "//evil.com" — hence the control-character ban before the origin check.
 *
 * The path part must also be plain: no "." / ".." segments, no backslash and no percent-encoded
 * dot, slash or backslash. URL parsing resolves dot segments, so "/..//evil.com" (or
 * "/%2e%2e//evil.com", "/x/../\evil.com") normalises to "//evil.com" — a protocol-relative
 * redirect off-site. App links never need any of these.
 */
export function safeNextPath(next: unknown): string | null {
  if (typeof next !== "string" || !next.startsWith("/") || next.length > 2000) return null;
  if (/[\x00-\x1f\x7f]/.test(next)) return null;
  const path = next.split(/[?#]/, 1)[0];
  if (path.includes("\\")) return null;
  if (/%(2e|2f|5c)/i.test(path)) return null;
  if (path.split("/").some((seg) => seg === "." || seg === "..")) return null;
  try {
    const url = new URL(next, BASE);
    if (url.origin !== BASE) return null;
    const out = url.pathname + url.search + url.hash;
    if (out.startsWith("//") || out.startsWith("/\\")) return null;
    return out;
  } catch {
    return null;
  }
}
