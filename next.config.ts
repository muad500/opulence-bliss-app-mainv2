import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  //cacheComponents: true,
  async redirects() {
    return [
      {
        source: "/",
        has: [{ type: "host", value: "admin.opulencebliss.com" }],
        destination: "/staff/login",
        permanent: false,
      },
      {
        source: "/services/massage",
        destination: "/services/cleaning",
        permanent: true,
      },
      {
        source: "/blog/benefits-of-massage-at-home",
        destination: "/blog",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
