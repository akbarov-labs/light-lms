// Runs once when the Next.js server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertStrongAuthSecret } = await import("./lib/auth/startup");
  assertStrongAuthSecret("web");
}

/** Any unhandled server error (page, action, route) → the operator's Telegram (when configured). */
export async function onRequestError(err: unknown, request: { path: string; method: string }, context: { routePath?: string; routeType?: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { alertOps } = await import("./lib/ops-alert");
  const e = err as { message?: string; digest?: string };
  const route = context.routePath ?? request.path.split("?")[0];
  await alertOps(`web:${route}:${e.digest ?? e.message ?? "error"}`, `Server error (${context.routeType ?? "request"}) ${request.method} ${route}: ${(e.message ?? String(err)).slice(0, 300)}${e.digest ? ` [digest ${e.digest}]` : ""}`);
}
