import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // the project folder is the root even if a parent folder has its own lockfile
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  // security headers (CSP with a per-request nonce, HSTS) are set in src/middleware.ts
};

export default nextConfig;
