import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const money = ["src/lib/billing/**", "src/lib/salary/**", "src/lib/payments/**"];

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // `npm run test:coverage`: the money code only. Its database adapters (billing sync, salary
    // service, Payme repo/links/provider) are exercised by the integration suite, not unit tests.
    coverage: {
      provider: "v8",
      include: money,
      exclude: ["**/*.test.ts", "src/lib/billing/testkit.ts", "src/lib/billing/sync.ts", "src/lib/salary/service.ts", "src/lib/payments/payme-repo.ts", "src/lib/payments/links.ts", "src/lib/payments/provider.ts"],
      reporter: ["text-summary", "text"],
      thresholds: Object.fromEntries(money.map((g) => [g, { lines: 90, statements: 90, functions: 90, branches: 80 }])),
    },
  },
});
