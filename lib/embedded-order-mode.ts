export const embeddedOrderModeWebsiteUrlMaxLength = 2048;

export type EmbeddedOrderModeSearchParams = {
  orderMode?: string | string[];
  return?: string | string[];
};

export type EmbeddedOrderModeContext = {
  mode: "embed";
  returnUrl: string;
  storeSlug: string;
};

export type WebsiteUrlValidationResult =
  | { ok: true; value: string | null }
  | { error: string; ok: false };

const embeddedOrderModeValue = "embed";
const internalNavigationOrigin = "https://navigation.flockfront.internal";
const unsafeControlCharacters = /[\u0000-\u001f\u007f]/;

export function validateSellerWebsiteUrl(
  value: unknown,
): WebsiteUrlValidationResult {
  if (typeof value !== "string") {
    return invalidWebsiteUrl("Website URL must be a valid absolute HTTPS URL.");
  }

  if (value.length > embeddedOrderModeWebsiteUrlMaxLength) {
    return invalidWebsiteUrl(
      `Website URL must be ${embeddedOrderModeWebsiteUrlMaxLength} characters or fewer.`,
    );
  }

  if (unsafeControlCharacters.test(value) || value.includes("\\")) {
    return invalidWebsiteUrl(
      "Website URL cannot contain control characters or backslashes.",
    );
  }

  const normalizedInput = value.trim();

  if (!normalizedInput) return { ok: true, value: null };

  if (normalizedInput.startsWith("//")) {
    return invalidWebsiteUrl("Website URL must be a valid absolute HTTPS URL.");
  }

  let url: URL;

  try {
    url = new URL(normalizedInput);
  } catch {
    return invalidWebsiteUrl("Website URL must be a valid absolute HTTPS URL.");
  }

  if (url.protocol !== "https:") {
    return invalidWebsiteUrl("Website URL must use HTTPS.");
  }

  if (url.username || url.password) {
    return invalidWebsiteUrl("Website URL cannot include a username or password.");
  }

  if (!url.hostname || url.origin === "null") {
    return invalidWebsiteUrl("Website URL must include a valid hostname.");
  }

  const normalizedUrl = url.toString();

  if (normalizedUrl.length > embeddedOrderModeWebsiteUrlMaxLength) {
    return invalidWebsiteUrl(
      `Website URL must be ${embeddedOrderModeWebsiteUrlMaxLength} characters or fewer.`,
    );
  }

  return { ok: true, value: normalizedUrl };
}

export function resolveEmbeddedOrderModeContext({
  searchParams,
  storeSlug,
  websiteUrl,
}: {
  searchParams: EmbeddedOrderModeSearchParams;
  storeSlug: string;
  websiteUrl: unknown;
}): EmbeddedOrderModeContext | null {
  if (
    searchParams.orderMode !== embeddedOrderModeValue ||
    typeof searchParams.return !== "string"
  ) {
    return null;
  }

  const configuredWebsite = validateSellerWebsiteUrl(websiteUrl);
  const candidateReturn = validateSellerWebsiteUrl(searchParams.return);

  if (
    !configuredWebsite.ok ||
    !configuredWebsite.value ||
    !candidateReturn.ok ||
    !candidateReturn.value
  ) {
    return null;
  }

  const configuredOrigin = new URL(configuredWebsite.value).origin;
  const candidateOrigin = new URL(candidateReturn.value).origin;

  if (configuredOrigin !== candidateOrigin) return null;

  return {
    mode: embeddedOrderModeValue,
    returnUrl: candidateReturn.value,
    storeSlug,
  };
}

export function buildEmbeddedOrderModeHref(
  href: string,
  context: EmbeddedOrderModeContext | null | undefined,
) {
  if (!context) return href;

  let destination: URL;

  try {
    destination = new URL(href, internalNavigationOrigin);
  } catch {
    return href;
  }

  const storePath = `/store/${context.storeSlug}`;

  if (
    destination.origin !== internalNavigationOrigin ||
    (destination.pathname !== storePath &&
      !destination.pathname.startsWith(`${storePath}/`))
  ) {
    return href;
  }

  destination.searchParams.set("orderMode", embeddedOrderModeValue);
  destination.searchParams.set("return", context.returnUrl);

  return `${destination.pathname}${destination.search}${destination.hash}`;
}

function invalidWebsiteUrl(error: string): WebsiteUrlValidationResult {
  return { error, ok: false };
}
