import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { buildCsp, securityHeaders } from "@/lib/auth/headers";
import { rawAppUrl } from "@/lib/env";

const PUBLIC = [/^\/login/, /^\/signup/, /^\/welcome/, /^\/legal\//, /^\/demo$/, /^\/f\//, /^\/pay\//, /^\/api\/payme/, /^\/api\/click\//, /^\/api\/uzum\//, /^\/api\/tg\//, /^\/tg(\/|$)/, /^\/rc\//, /^\/v(\/|$)/, /^\/api\/health/, /^\/_next\//, /^\/favicon/];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Per-request nonce: Next adds it to its own scripts when it sees it in the request's CSP header.
  const nonce = btoa(crypto.randomUUID());
  const https = (rawAppUrl() ?? "").startsWith("https://") || req.headers.get("x-forwarded-proto") === "https";
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV !== "production", https });

  const pass = () => {
    const h = new Headers(req.headers);
    h.set("x-nonce", nonce);
    h.set("content-security-policy", csp);
    return withHeaders(NextResponse.next({ request: { headers: h } }));
  };
  const withHeaders = (res: NextResponse) => {
    res.headers.set("content-security-policy", csp);
    for (const [k, v] of securityHeaders(https)) res.headers.set(k, v);
    return res;
  };

  if (PUBLIC.some((r) => r.test(pathname))) return pass();
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    // visitors without a session see the product site at the root; staff see their dashboard
    if (pathname === "/") {
      const url = req.nextUrl.clone();
      url.pathname = "/welcome";
      const h = new Headers(req.headers);
      h.set("x-nonce", nonce);
      h.set("content-security-policy", csp);
      return withHeaders(NextResponse.rewrite(url, { request: { headers: h } }));
    }
    if (pathname.startsWith("/api/")) return withHeaders(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return withHeaders(NextResponse.redirect(url));
  }
  // after an admin reset the user must choose their own password first
  if (session.pwc && pathname !== "/password") {
    if (pathname.startsWith("/api/")) return withHeaders(NextResponse.json({ error: "password change required" }, { status: 403 }));
    const url = req.nextUrl.clone();
    url.pathname = "/password";
    url.search = "";
    return withHeaders(NextResponse.redirect(url));
  }
  return pass();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
