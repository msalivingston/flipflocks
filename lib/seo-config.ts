import type { Metadata } from "next";

export const PRODUCTION_ORIGIN = "https://www.flockfront.com";

// Launch action: set SEO_INDEXING_ENABLED=true only in the Vercel Production
// environment. Preview, development, and local builds remain blocked regardless.
export function isIndexingEnabled(
  environment: {
    SEO_INDEXING_ENABLED?: string;
    VERCEL_ENV?: string;
  } = {
    SEO_INDEXING_ENABLED: process.env.SEO_INDEXING_ENABLED,
    VERCEL_ENV: process.env.VERCEL_ENV,
  },
) {
  return (
    environment.VERCEL_ENV === "production" &&
    environment.SEO_INDEXING_ENABLED === "true"
  );
}

export const INDEXING_ENABLED = isIndexingEnabled();

export const NOINDEX_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: {
    index: false,
    follow: false,
    noimageindex: true,
  },
};

export function absoluteUrl(path = "/") {
  return new URL(path, `${PRODUCTION_ORIGIN}/`).toString();
}
