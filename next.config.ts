import type { NextConfig } from "next";
import { INDEXING_ENABLED } from "./lib/seo-config";
import { getListingImageRemotePattern } from "./lib/storefront-images";

const listingImagePattern = getListingImageRemotePattern(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);

const nextConfig: NextConfig = {
  images: {
    remotePatterns: listingImagePattern ? [listingImagePattern] : [],
  },
  async headers() {
    const routeHeaders = [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'",
          },
        ],
      },
      {
        source: "/embed/store/:slug",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors https:",
          },
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow",
          },
        ],
      },
    ];

    if (!INDEXING_ENABLED) {
      routeHeaders[0].headers.push({
        key: "X-Robots-Tag",
        value: "noindex, nofollow",
      });
    }

    return routeHeaders;
  },
};

export default nextConfig;
