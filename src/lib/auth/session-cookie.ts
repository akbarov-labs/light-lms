// Issue the session cookie (login, password change). Secure flag follows HTTPS, also behind the proxy.
import { cookies, headers } from "next/headers";
import { SESSION_COOKIE, SESSION_DAYS, signSession, type SessionPayload } from "../session";
import { secureCookies } from "./security";

export async function issueSession(p: SessionPayload): Promise<void> {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  jar.set(SESSION_COOKIE, await signSession(p), {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(h),
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}
