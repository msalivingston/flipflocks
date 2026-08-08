import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/seo-config";

type MetadataImage = {
  alt?: string;
  height?: number | null;
  url: string;
  width?: number | null;
};

export function buildPublicMetadata({
  canonicalPath,
  description,
  image,
  largeImage = false,
  title,
}: {
  canonicalPath: string;
  description: string;
  image?: MetadataImage | null;
  largeImage?: boolean;
  title: string;
}): Metadata {
  const canonicalUrl = absoluteUrl(canonicalPath);
  const resolvedImage = image ? resolveMetadataImage(image) : null;

  return {
    alternates: { canonical: canonicalUrl },
    description,
    title,
    openGraph: {
      description,
      siteName: "FlockFront",
      title,
      type: "website",
      url: canonicalUrl,
      ...(resolvedImage ? { images: [resolvedImage] } : {}),
    },
    twitter: {
      card: resolvedImage && largeImage ? "summary_large_image" : "summary",
      description,
      title,
      ...(resolvedImage ? { images: [resolvedImage.url] } : {}),
    },
  };
}

export function cleanMetadataText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() || "";
}

export function truncateMetadataText(value: string, maxLength = 160) {
  const normalized = cleanMetadataText(value);

  if (normalized.length <= maxLength) return normalized;

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

export function withFlockFrontBrand(value: string) {
  const normalized = cleanMetadataText(value);

  return /(?:^|\|)\s*flockfront$/i.test(normalized)
    ? normalized
    : `${normalized} | FlockFront`;
}

function resolveMetadataImage(image: MetadataImage) {
  const url = /^https?:\/\//i.test(image.url)
    ? image.url
    : absoluteUrl(image.url);

  return {
    url,
    ...(image.alt ? { alt: image.alt } : {}),
    ...(image.width ? { width: image.width } : {}),
    ...(image.height ? { height: image.height } : {}),
  };
}
