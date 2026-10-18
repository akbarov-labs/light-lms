// Security response headers. Imported by the proxy (src/proxy.ts) for every response.

/**
 * Off-site form/redirect targets of the public pay page: the providers' checkouts. Chrome checks
 * form-action on the redirect that follows a form submit, so each provider must be listed.
 */
const CHECKOUTS = "https://checkout.paycom.uz https://checkout.test.paycom.uz https://my.click.uz https://www.uzumbank.uz";

/** Telegram Web (web.telegram.org) shows Mini Apps in an iframe; the mobile and desktop apps use a webview. */
export const TELEGRAM_FRAME_ANCESTORS = "https://web.telegram.org";

/**
 * Content-Security-Policy with a per-request nonce. 'strict-dynamic' lets Next's nonce'd
 * bootstrap load its chunks; nothing else may run. Dev needs eval for React Refresh.
 */
export function buildCsp(nonce: string, opts: { dev: boolean; https: boolean; frameAncestors?: string }): string {
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
    `form-action 'self' ${CHECKOUTS}`,
    `frame-ancestors ${opts.frameAncestors ?? "'none'"}`,
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** Static headers for every response; HSTS only when the site is actually served over HTTPS. */
export function securityHeaders(https: boolean, opts: { embeddable?: boolean } = {}): [string, string][] {
  const h: [string, string][] = [
    ["x-content-type-options", "nosniff"],
    // the Mini App is framed by Telegram Web: its CSP frame-ancestors names who may, XFO would forbid all
    ...(opts.embeddable ? [] : ([["x-frame-options", "DENY"]] as [string, string][])),
    ["referrer-policy", "strict-origin-when-cross-origin"],
    ["permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"],
    ["cross-origin-opener-policy", "same-origin"],
  ];
  if (https) h.push(["strict-transport-security", "max-age=31536000; includeSubDomains"]);
  return h;
}
