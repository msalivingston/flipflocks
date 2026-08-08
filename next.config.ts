import type { NextConfig } from "next";
import { INDEXING_ENABLED } from "./lib/seo-config";

const nextConfig: NextConfig = {
  async headers() {
    if (INDEXING_ENABLED) return [];

    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
