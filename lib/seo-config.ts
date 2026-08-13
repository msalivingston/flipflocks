import type { Metadata } from "next";

export const PRODUCTION_ORIGIN = "https://www.flockfront.com";

// Public indexing is enabled only for the Vercel Production environment.
// Preview, development, and local builds remain blocked.
export function isIndexingEnabled(
  environment: {
    VERCEL_ENV?: string;
  } = {
    VERCEL_ENV: process.env.VERCEL_ENV,
  },
) {
  return environment.VERCEL_ENV === "production";
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
