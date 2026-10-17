// Prisma CLI config (migrate, generate). Prisma 7 no longer reads .env itself: load it here for local
// runs; in Docker the variables come from the environment (an existing variable is never overwritten).
import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile();
} catch {
  // no .env file — fine
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // `prisma generate` (Docker build, npm install) runs without a database URL
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
