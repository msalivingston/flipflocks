export const storefrontPreviewFallbackHref = "/dashboard/store-admin";

const previewReturnToOrigin = "https://preview.flockfront.internal";
const maxPreviewReturnToLength = 2048;

export function getSafeStorefrontPreviewReturnTo(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxPreviewReturnToLength ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f]/.test(value)
  ) {
    return null;
  }

  let destination: URL;

  try {
    destination = new URL(value, previewReturnToOrigin);
  } catch {
    return null;
  }

  if (
    destination.origin !== previewReturnToOrigin ||
    !isSellerDashboardPath(destination.pathname)
  ) {
    return null;
  }

  return `${destination.pathname}${destination.search}${destination.hash}`;
}

export function getStorefrontPreviewReturnHref(value: unknown) {
  return getSafeStorefrontPreviewReturnTo(value) ?? storefrontPreviewFallbackHref;
}

export function buildStorefrontPreviewHref(
  storeSlug: string,
  returnTo: unknown,
) {
  const query = new URLSearchParams({
    preview: "1",
    returnTo: getStorefrontPreviewReturnHref(returnTo),
  });

  return `/store/${storeSlug}?${query.toString()}`;
}

function isSellerDashboardPath(pathname: string) {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}
