// Runs once when the Next.js server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertStrongAuthSecret } = await import("./lib/auth/startup");
  assertStrongAuthSecret("web");
}
