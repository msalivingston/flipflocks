import type { Metadata } from "next";

export const PRODUCTION_ORIGIN = "https://www.flockfront.com";

const PRODUCTION_DEPLOYMENT = process.env.VERCEL_ENV === "production";

// Launch action: set SEO_INDEXING_ENABLED=true only in the Vercel Production
// environment. Preview, development, and local builds remain blocked regardless.
export const INDEXING_ENABLED =
  PRODUCTION_DEPLOYMENT && process.env.SEO_INDEXING_ENABLED === "true";

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
