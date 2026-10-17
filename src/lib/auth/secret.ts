// AUTH_SECRET strength rules. No Node-only imports: instrumentation.ts is also compiled for the edge runtime.

/** Values shipped in this repo as examples/dev defaults — never acceptable in a real deployment. */
const KNOWN_WEAK = new Set(["dev-only-secret-change-me-0123456789abcdef", "change-me-to-a-long-random-string", "changeme", "secret"]);

export interface SecretCheck {
  ok: boolean;
  problems: string[];
}

/** Missing, or a value printed in this repo (the dev compose fallback, .env.example): anyone can forge sessions. */
export function isPublicSecret(secret: string | undefined): boolean {
  const s = (secret ?? "").trim();
  return !s || KNOWN_WEAK.has(s) || /change[-_]?me/i.test(s);
}

/** APP_URL points at this machine only (localhost / 127.0.0.1 / ::1), or is unset (npm run dev). */
export function isLocalAppUrl(appUrl: string | undefined = process.env.APP_URL): boolean {
  if (!appUrl) return true;
  try {
    const host = new URL(appUrl).hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/** AUTH_SECRET must be long, not a known example value and not trivially repetitive. */
export function checkAuthSecret(secret: string | undefined): SecretCheck {
  const problems: string[] = [];
  const s = secret ?? "";
  if (!s) problems.push("AUTH_SECRET is not set");
  else {
    if (s.length < 32) problems.push(`AUTH_SECRET is ${s.length} characters; use at least 32 (openssl rand -base64 32)`);
    if (KNOWN_WEAK.has(s) || /change[-_]?me/i.test(s)) problems.push("AUTH_SECRET is an example value from the repo");
    if (new Set(s).size < 10) problems.push("AUTH_SECRET has too few distinct characters");
  }
  return { ok: problems.length === 0, problems };
}

/** A real deployment = the public URL is HTTPS. Local `docker compose up` (http://localhost) stays lenient. */
export function isHttpsDeployment(appUrl: string | undefined = process.env.APP_URL): boolean {
  return (appUrl ?? "").startsWith("https://");
}
