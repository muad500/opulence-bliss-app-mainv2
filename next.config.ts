import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: {
    "/api/legal/*/pdf": ["./legal-packs/2026-10-01/*.pdf"],
    "/provider/join/policies/*/pdf": ["./legal-packs/2026-10-01/*.pdf"],
    "/api/cron/booking-notifications": ["./legal-packs/2026-10-01/*.pdf"],
    "/api/cron/account-security-alerts": ["./legal-packs/2026-10-01/*.pdf"],
  },
  turbopack: { root: process.cwd() },
  //cacheComponents: true,
};

export default nextConfig;
