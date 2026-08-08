export const knownFlockFrontBrowserOrigins = Object.freeze([
  "https://www.flockfront.com",
  "https://flockfront.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

type FlockFrontCorsOptions = {
  allowedHeaders?: string;
  allowedMethods?: string;
  configuredOrigin?: string | null;
};

export type FlockFrontCorsPolicy = {
  headers: Record<string, string>;
  originAllowed: boolean;
};

const defaultAllowedHeaders =
  "authorization, x-client-info, apikey, content-type";

function normalizeConfiguredOrigin(value: string | null | undefined): string | null {
  const candidate = value?.trim();

  if (!candidate || candidate === "*") return null;

  try {
    const parsed = new URL(candidate);

    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== candidate
    ) {
      return null;
    }

    return parsed.origin;
  } catch {
    return null;
  }
}

export function resolveFlockFrontCors(
  requestOrigin: string | null,
  options: FlockFrontCorsOptions = {},
): FlockFrontCorsPolicy {
  const allowedOrigins = new Set<string>(knownFlockFrontBrowserOrigins);
  const configuredOrigin = normalizeConfiguredOrigin(options.configuredOrigin);

  if (configuredOrigin) allowedOrigins.add(configuredOrigin);

  const originAllowed = !requestOrigin || allowedOrigins.has(requestOrigin);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      options.allowedHeaders ?? defaultAllowedHeaders,
    "Access-Control-Allow-Methods": options.allowedMethods ?? "POST, OPTIONS",
    "Vary": "Origin",
  };

  if (requestOrigin && originAllowed) {
    headers["Access-Control-Allow-Origin"] = requestOrigin;
  }

  return { headers, originAllowed };
}
