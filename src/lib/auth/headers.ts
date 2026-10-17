// Security response headers. Imported by the proxy (src/proxy.ts) for every response.

/** Payme checkout is the only off-site form/redirect target (public pay page). */
const PAYME = "https://checkout.paycom.uz https://checkout.test.paycom.uz";

/**
 * Content-Security-Policy with a per-request nonce. 'strict-dynamic' lets Next's nonce'd
 * bootstrap load its chunks; nothing else may run. Dev needs eval for React Refresh.
 */
export function buildCsp(nonce: string, opts: { dev: boolean; https: boolean }): string {
  const { dev, https } = opts;
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // React style={} attributes and next/font inline styles
    "style-src 'self' 'unsafe-inline'",
    // center logo is an arbitrary https URL set in settings
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${PAYME}`,
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** Static headers for every response; HSTS only when the site is actually served over HTTPS. */
export function securityHeaders(https: boolean): [string, string][] {
  const h: [string, string][] = [
    ["x-content-type-options", "nosniff"],
    ["x-frame-options", "DENY"],
    ["referrer-policy", "strict-origin-when-cross-origin"],
    ["permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"],
    ["cross-origin-opener-policy", "same-origin"],
  ];
  if (https) h.push(["strict-transport-security", "max-age=31536000; includeSubDomains"]);
  return h;
}
