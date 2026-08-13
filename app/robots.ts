import type { MetadataRoute } from "next";
import {
  INDEXING_ENABLED,
  PRODUCTION_ORIGIN,
} from "@/lib/seo-config";

const PRIVATE_PATHS = [
  "/admin",
  "/auth",
  "/dashboard",
  "/dev",
  "/embed",
  "/listings",
  "/login",
  "/onboarding",
  "/reset-password",
  "/sign-in",
  "/signup",
  "/store/*/cart",
  "/store/*/checkout",
  "/store/*/items",
] as const;

export default function robots(): MetadataRoute.Robots {
  if (INDEXING_ENABLED) {
    return {
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: [...PRIVATE_PATHS],
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
