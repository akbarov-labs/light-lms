// Startup guard shared by the web server (instrumentation.ts) and the worker.
import { checkAuthSecret, isHttpsDeployment } from "./secret";

/**
 * A real deployment (APP_URL is https://) refuses to start with a weak AUTH_SECRET.
 * Local http installs only warn, so `docker compose up` with the dev default keeps working.
 */
export function assertStrongAuthSecret(who: string): void {
  const check = checkAuthSecret(process.env.AUTH_SECRET);
  if (check.ok) return;
  const msg = `[${who}] weak AUTH_SECRET: ${check.problems.join("; ")}`;
  if (isHttpsDeployment()) {
    console.error(`${msg}. Refusing to start. Generate one with: openssl rand -base64 32`);
    process.exit(1);
  }
  console.warn(`${msg} (allowed only because APP_URL is not https)`);
}
