import type { MetadataRoute } from "next";
import {
  INDEXING_ENABLED,
  PRODUCTION_ORIGIN,
} from "@/lib/seo-config";

export default function robots(): MetadataRoute.Robots {
  if (INDEXING_ENABLED) {
    return {
      rules: {
        userAgent: "*",
        allow: "/",
      },
      sitemap: `${PRODUCTION_ORIGIN}/sitemap.xml`,
      host: PRODUCTION_ORIGIN,
    };
  }

  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
    host: PRODUCTION_ORIGIN,
  };
}
