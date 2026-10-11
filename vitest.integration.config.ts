import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// DB integration tests: run with `npm run test:integration` (needs Postgres; uses a separate lms_test database).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 60_000, hookTimeout: 120_000, fileParallelism: false },
});
