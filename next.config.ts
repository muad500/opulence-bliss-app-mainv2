import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: {
    "/api/account/document-updates/*/pdf": ["./legal-packs/**/*.pdf"],
    "/api/admin/document-changes": ["./legal-packs/**/*.pdf"],
    "/api/legal/*/pdf": ["./legal-packs/2026-10-01/*.pdf"],
    "/provider/join/policies/*/pdf": ["./legal-packs/2026-10-01/*.pdf"],
    "/api/cron/booking-notifications": ["./legal-packs/2026-10-01/*.pdf"],
    "/api/cron/launch-operations": ["./legal-packs/2026-10-01/*.pdf"],
    "/api/cron/account-security-alerts": ["./legal-packs/2026-10-01/*.pdf"],
  },
  turbopack: { root: process.cwd() },
  //cacheComponents: true,
};

export default nextConfig;
