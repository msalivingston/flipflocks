// Keep the optimizer allowlist and listing-photo eligibility in sync. Other
// existing image sources continue to render directly, as they did before.
export function getListingImageRemotePattern(supabaseUrl: string | undefined) {
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:" || url.port || url.username || url.password) {
      return null;
    }
    return {
      protocol: "https" as const,
      hostname: url.hostname,
      port: "",
      pathname: "/storage/v1/object/public/seller-media/**",
      search: "",
    };
  } catch {
    return null;
  }
}

export function isOptimizableListingImage(
  src: string,
  supabaseUrl: string | undefined,
) {
  const pattern = getListingImageRemotePattern(supabaseUrl);
  if (!pattern) return false;
  try {
    const url = new URL(src);
    return url.protocol === "https:" && url.hostname === pattern.hostname &&
      url.port === "" && url.username === "" && url.password === "" &&
      url.search === "" && url.hash === "" &&
      url.pathname.startsWith("/storage/v1/object/public/seller-media/");
  } catch {
    return false;
  }
}
