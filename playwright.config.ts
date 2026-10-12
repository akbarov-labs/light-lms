import { defineConfig, devices } from "@playwright/test";

// End-to-end + accessibility tests against a running stack with demo data (never production):
//   docker compose up -d   →   E2E_BASE_URL=http://localhost:3010 npm run test:e2e
// One worker: the tests share one database and its rate limits.
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3010",
    locale: "uz-UZ",
    timezoneId: "Asia/Tashkent",
    // each run looks like a fresh visitor to the login/signup rate limits
    extraHTTPHeaders: { "x-forwarded-for": `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
