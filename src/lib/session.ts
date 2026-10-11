// Session token = signed JWT (HS256) in an httpOnly cookie. Edge-safe (used by middleware too).
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "lms_session";
export const SESSION_DAYS = 30;

export interface SessionPayload {
  sub: string; // user id
  cid: string; // center id
}

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET is missing or too short (min 16 chars)");
  return new TextEncoder().encode(s);
}

export async function signSession(p: SessionPayload): Promise<string> {
  return new SignJWT({ cid: p.cid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.cid !== "string") return null;
    return { sub: payload.sub, cid: payload.cid };
  } catch {
    return null;
  }
}
