import { absoluteUrl, PRODUCTION_ORIGIN } from "@/lib/seo-config";

export const FLOCKFRONT_ORGANIZATION_ID = `${PRODUCTION_ORIGIN}/#organization`;
export const FLOCKFRONT_WEBSITE_ID = `${PRODUCTION_ORIGIN}/#website`;

export const HOMEPAGE_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@id": FLOCKFRONT_ORGANIZATION_ID,
      "@type": "Organization",
      logo: absoluteUrl("/branding/flockfront-logo-final.png"),
      name: "FlockFront",
      url: PRODUCTION_ORIGIN,
    },
    {
      "@id": FLOCKFRONT_WEBSITE_ID,
      "@type": "WebSite",
      name: "FlockFront",
      publisher: {
        "@id": FLOCKFRONT_ORGANIZATION_ID,
      },
      url: PRODUCTION_ORIGIN,
    },
  ],
} as const;

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    const escapes: Record<string, string> = {
      "<": "\\u003c",
      ">": "\\u003e",
      "&": "\\u0026",
      "\u2028": "\\u2028",
      "\u2029": "\\u2029",
    };

    return escapes[character];
  });
}
