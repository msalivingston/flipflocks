import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const configuredCorsOrigin = Deno.env.get("FLIPFLOCKS_PUBLIC_API_ORIGIN");
const corsHeaders = {
  "Access-Control-Allow-Origin": configuredCorsOrigin ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

const CATALOG_BUCKET = "catalog-images";
const WORKBENCH_BUCKET = "breed-image-workbench";

type DeleteResult = {
  deleted_breed_id: string;
  deleted_breed_name: string;
  deleted_breed_slug: string;
  approved_image_url: string | null;
  candidate_storage_path: string | null;
  seller_profiles_detached: number;
  media_assets_detached: number;
  legacy_inventory_detached: number;
};

class PublicSafeError extends Error {
  constructor(
    readonly code: "invalid_request" | "not_found" | "save_failed" | "unauthorized",
    readonly publicMessage: string,
    readonly status = 400,
  ) {
    super(publicMessage);
    this.name = "PublicSafeError";
  }
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getCorsHeaders(req: Request): Record<string, string> {
  const requestOrigin = req.headers.get("Origin");
  if (
    requestOrigin &&
    (requestOrigin === configuredCorsOrigin ||
      requestOrigin.startsWith("http://localhost:") ||
      requestOrigin.startsWith("http://127.0.0.1:"))
  ) {
    return { ...corsHeaders, "Access-Control-Allow-Origin": requestOrigin };
  }
  return corsHeaders;
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function catalogStoragePath(value: string | null) {
  const normalized = value?.trim();
  if (!normalized) return null;

  const directPrefix = `${CATALOG_BUCKET}/`;
  const publicPrefix = `/storage/v1/object/public/${CATALOG_BUCKET}/`;
  if (normalized.startsWith(directPrefix)) return normalized.slice(directPrefix.length);
  if (normalized.startsWith(publicPrefix)) return normalized.slice(publicPrefix.length);

  try {
    const parsed = new URL(normalized);
    const marker = `/storage/v1/object/public/${CATALOG_BUCKET}/`;
    const markerIndex = parsed.pathname.indexOf(marker);
    return markerIndex >= 0 ? decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length)) : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const responseHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ error: { code: "invalid_request", message: "Method not allowed" } }, 405, responseHeaders);
  }

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) throw new PublicSafeError("unauthorized", "Authentication required", 401);

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new PublicSafeError("unauthorized", "Authentication required", 401);
    const { data: isAdmin, error: adminError } = await userClient.rpc("is_admin");
    if (adminError || isAdmin !== true) {
      throw new PublicSafeError("unauthorized", "Platform admin access required", 403);
    }

    const body = await req.json().catch(() => null) as { breed_id?: string } | null;
    const breedId = body?.breed_id?.trim();
    if (!breedId) throw new PublicSafeError("invalid_request", "Breed is required");

    const { data, error } = await userClient.rpc("admin_delete_default_catalog_breed", {
      p_breed_id: breedId,
    });
    if (error) {
      const notFound = error.message.includes("Breed not found");
      throw new PublicSafeError(
        notFound ? "not_found" : "save_failed",
        notFound ? "Breed not found." : error.message,
        notFound ? 404 : 409,
      );
    }

    const result = (data as DeleteResult[] | null)?.[0];
    if (!result) throw new PublicSafeError("save_failed", "Breed deletion returned no result", 500);

    const storageWarnings: string[] = [];
    if (result.candidate_storage_path) {
      const { error: candidateError } = await serviceClient.storage
        .from(WORKBENCH_BUCKET)
        .remove([result.candidate_storage_path]);
      if (candidateError) {
        console.error("Deleted breed candidate cleanup failed", candidateError);
        storageWarnings.push("The unapproved candidate image could not be removed automatically.");
      }
    }

    const approvedPath = catalogStoragePath(result.approved_image_url);
    if (approvedPath) {
      const { data: remainingBreeds, error: remainingError } = await serviceClient
        .from("breeds")
        .select("image_url")
        .not("image_url", "is", null);
      if (remainingError) {
        console.error("Deleted breed image ownership check failed", remainingError);
        storageWarnings.push("The approved catalog image ownership check could not be completed.");
      } else {
        const isStillUsed = (remainingBreeds ?? []).some(
          (breed) => catalogStoragePath(breed.image_url) === approvedPath,
        );
        if (!isStillUsed) {
          const { error: approvedError } = await serviceClient.storage
            .from(CATALOG_BUCKET)
            .remove([approvedPath]);
          if (approvedError) {
            console.error("Deleted breed approved image cleanup failed", approvedError);
            storageWarnings.push("The approved catalog image could not be removed automatically.");
          }
        }
      }
    }

    return jsonResponse({ deleted: result, storage_warnings: storageWarnings }, 200, responseHeaders);
  } catch (error) {
    if (error instanceof PublicSafeError) {
      return jsonResponse(
        { error: { code: error.code, message: error.publicMessage } },
        error.status,
        responseHeaders,
      );
    }
    console.error("Admin catalog breed delete failure", error);
    return jsonResponse(
      { error: { code: "save_failed", message: "Breed deletion is temporarily unavailable" } },
      500,
      responseHeaders,
    );
  }
});
