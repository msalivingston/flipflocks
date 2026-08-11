import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import imageFamilyPlan from "../_shared/breed-image-family-plan.json" with { type: "json" };

const configuredCorsOrigin = Deno.env.get("FLIPFLOCKS_PUBLIC_API_ORIGIN");
const corsHeaders = {
  "Access-Control-Allow-Origin": configuredCorsOrigin ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

const CATALOG_BUCKET = "catalog-images";
const WORKBENCH_BUCKET = "breed-image-workbench";
const MAX_REFERENCE_SIZE_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const REFERENCE_TOKEN_TTL_SECONDS = 30 * 60;
const MAX_REFERENCE_RESULTS = 5;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_MODEL = Deno.env.get("OPENAI_BREED_IMAGE_MODEL")?.trim() || "gpt-image-2";
const IMAGE_SIZE = Deno.env.get("OPENAI_BREED_IMAGE_SIZE")?.trim() || "1024x1024";
const IMAGE_QUALITY = Deno.env.get("OPENAI_BREED_IMAGE_QUALITY")?.trim() || "medium";
const REFERENCE_SEARCH_MODEL = Deno.env.get("OPENAI_BREED_REFERENCE_SEARCH_MODEL")?.trim() || "gpt-5.6";
const APPROVED_PROMPT_ENV = "FLOCKFRONT_BREED_IMAGE_PROMPT";

type PlanRecord = {
  stable_id: string;
  slug: string;
  breed: string;
  variety: string;
  breed_category: string;
  image_strategy: string;
  proposed_image_family: string;
  proposed_master_record: string;
  defining_visual_traits: string;
  derivative_change_needed: string;
  confidence: string;
  review_notes: string;
};

type BreedRow = {
  id: string;
  breed_name: string;
  breed_slug: string;
  category: string | null;
  image_url: string | null;
  is_active: boolean;
  is_custom: boolean;
  sort_order: number;
  species: { slug: string } | null;
};

type ReviewRow = {
  breed_id: string;
  status: string;
  candidate_storage_path: string | null;
  generation_mode: string | null;
  last_error: string | null;
  generated_at: string | null;
  approved_at: string | null;
  skipped_at: string | null;
};

type ReferenceTokenPayload = {
  breed_id: string;
  image_url: string;
  source_website_url: string;
  expires_at: number;
};

type ReferenceCandidate = {
  id: string;
  image_url: string;
  thumbnail_url: string;
  source_website_url: string;
  source_domain: string;
  caption: string;
  token: string;
};

type PublicErrorCode =
  | "configuration_error"
  | "generation_failed"
  | "invalid_request"
  | "invalid_reference"
  | "master_not_approved"
  | "not_found"
  | "reference_search_failed"
  | "save_failed"
  | "unauthorized";

class PublicSafeError extends Error {
  constructor(
    readonly code: PublicErrorCode,
    readonly publicMessage: string,
    readonly status = 400,
  ) {
    super(publicMessage);
    this.name = "PublicSafeError";
  }
}

const plan = imageFamilyPlan as PlanRecord[];
const planById = new Map(plan.map((record) => [record.stable_id, record]));

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

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = corsHeaders,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function errorResponse(
  code: PublicErrorCode,
  message: string,
  status: number,
  headers: Record<string, string>,
) {
  return jsonResponse({ error: { code, message } }, status, headers);
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function requiredText(value: FormDataEntryValue | null, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new PublicSafeError("invalid_request", `${fieldName} is required`);
  }
  return value.trim();
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function referenceSigningKey(serviceRoleKey: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(serviceRoleKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function createReferenceToken(payload: ReferenceTokenPayload, serviceRoleKey: string) {
  const encodedPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await referenceSigningKey(serviceRoleKey),
    new TextEncoder().encode(encodedPayload),
  );
  return `${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function verifyReferenceToken(token: string, breedId: string, serviceRoleKey: string) {
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) {
    throw new PublicSafeError("invalid_reference", "The selected web reference is invalid. Find references again.");
  }

  let payload: ReferenceTokenPayload;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await referenceSigningKey(serviceRoleKey),
      base64UrlToBytes(encodedSignature),
      new TextEncoder().encode(encodedPayload),
    );
    if (!valid) throw new Error("Invalid signature");
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encodedPayload))) as ReferenceTokenPayload;
  } catch {
    throw new PublicSafeError("invalid_reference", "The selected web reference is invalid. Find references again.");
  }

  if (payload.breed_id !== breedId || payload.expires_at <= Math.floor(Date.now() / 1000)) {
    throw new PublicSafeError("invalid_reference", "The selected web reference expired. Find references again.");
  }
  return payload;
}

function safeHttpsUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 ||
    parts[0] === 127 ||
    parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

function isUnsafeReferenceUrl(value: string) {
  const parsed = safeHttpsUrl(value);
  if (!parsed) return true;
  const hostname = parsed.hostname.toLowerCase();
  return hostname === "localhost" || hostname.endsWith(".local") || hostname.includes(":") || isPrivateIpv4(hostname);
}

function referenceSearchPrompt(record: PlanRecord) {
  const exactIdentity = record.variety ? `${record.breed} - ${record.variety}` : record.breed;
  return [
    `Search for real photographic image references of the exact chicken catalog identity: ${exactIdentity}.`,
    `Breed: ${record.breed}.`,
    `Variety: ${record.variety || "none"}.`,
    "Prioritize live adult hens and roosters from established hatcheries, poultry breed clubs, agricultural or university sources, recognized poultry organizations, and credible breeder catalogs.",
    "Prefer images that clearly show real-world plumage, markings, silhouette, comb, legs, and defining breed traits.",
    "Avoid artwork, decorative objects, logos, AI-generated images, recipes, and unrelated similarly named breeds.",
    "For commercial, project, proprietary, or variable populations, do not substitute a vaguely similar heritage breed.",
    "Return several useful candidates for a human to choose; do not select one as authoritative.",
  ].join("\n");
}

async function findReferenceImages(record: PlanRecord, serviceRoleKey: string) {
  const apiKey = requiredEnv("OPENAI_API_KEY");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: REFERENCE_SEARCH_MODEL,
      reasoning: { effort: "low" },
      tools: [{
        type: "web_search",
        search_content_types: ["image", "text"],
        image_settings: { max_results: MAX_REFERENCE_RESULTS, caption: true },
      }],
      include: ["web_search_call.results"],
      input: referenceSearchPrompt(record),
    }),
  });
  const payload = await response.json().catch(() => null) as {
    output?: Array<{
      type?: string;
      results?: Array<{
        type?: string;
        image_url?: string;
        thumbnail_url?: string;
        source_website_url?: string;
        caption?: string;
      }>;
    }>;
    error?: { message?: string };
  } | null;

  if (!response.ok || !payload?.output) {
    console.error("OpenAI breed reference search failed", response.status, payload?.error?.message);
    throw new PublicSafeError("reference_search_failed", "Reference search failed. Review the server logs and try again.", 502);
  }

  const rawResults = payload.output
    .filter((item) => item.type === "web_search_call")
    .flatMap((item) => item.results ?? [])
    .filter((item) => item.type === "image_result" && item.image_url && item.source_website_url);
  const seen = new Set<string>();
  const candidates: ReferenceCandidate[] = [];

  for (const result of rawResults) {
    if (candidates.length >= MAX_REFERENCE_RESULTS) break;
    const imageUrl = result.image_url?.trim() ?? "";
    const sourceWebsiteUrl = result.source_website_url?.trim() ?? "";
    const thumbnailUrl = result.thumbnail_url?.trim() || imageUrl;
    const parsedImage = safeHttpsUrl(imageUrl);
    const parsedSource = safeHttpsUrl(sourceWebsiteUrl);
    const parsedThumbnail = safeHttpsUrl(thumbnailUrl);
    if (!parsedImage || !parsedSource || !parsedThumbnail || isUnsafeReferenceUrl(imageUrl) || seen.has(imageUrl)) continue;
    seen.add(imageUrl);
    const token = await createReferenceToken({
      breed_id: record.stable_id,
      image_url: imageUrl,
      source_website_url: sourceWebsiteUrl,
      expires_at: Math.floor(Date.now() / 1000) + REFERENCE_TOKEN_TTL_SECONDS,
    }, serviceRoleKey);
    candidates.push({
      id: crypto.randomUUID(),
      image_url: imageUrl,
      thumbnail_url: thumbnailUrl,
      source_website_url: sourceWebsiteUrl,
      source_domain: parsedSource.hostname.replace(/^www\./, ""),
      caption: result.caption?.trim() || `${record.breed}${record.variety ? ` - ${record.variety}` : ""}`,
      token,
    });
  }

  return candidates;
}

function parseMasterSlug(record: PlanRecord) {
  const [, slug = ""] = record.proposed_master_record.split("|");
  return slug.trim();
}

function generationMode(record: PlanRecord) {
  if (record.image_strategy === "VARIETY_DERIVATIVE") return "derivative";
  if (record.image_strategy === "VARIABLE_PHENOTYPE") return "representative";
  return "master";
}

function storageSuffix() {
  const stamp = new Date().toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${stamp}-${random}`;
}

function normalizeMimeType(file: File) {
  const mimeType = file.type.toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new PublicSafeError("invalid_request", "Reference image must be JPG, PNG, or WebP");
  }
  if (file.size <= 0 || file.size > MAX_REFERENCE_SIZE_BYTES) {
    throw new PublicSafeError("invalid_request", "Reference image must be 10 MB or smaller");
  }
  return mimeType;
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function buildPrompt(record: PlanRecord, hasReferenceImage: boolean) {
  const approvedPrompt = Deno.env.get(APPROVED_PROMPT_ENV)?.trim();
  if (!approvedPrompt) {
    throw new PublicSafeError(
      "configuration_error",
      `The approved catalog-image prompt has not been configured in ${APPROVED_PROMPT_ENV}.`,
      503,
    );
  }

  const recordFacts = [
    "Catalog record facts:",
    `- Breed: ${record.breed}`,
    `- Variety: ${record.variety || "none"}`,
    `- Breed Category: ${record.breed_category}`,
    `- Image strategy: ${record.image_strategy}`,
    `- Defining visual traits: ${record.defining_visual_traits}`,
  ];

  if (record.image_strategy === "VARIETY_DERIVATIVE") {
    recordFacts.push(
      "Use the first supplied image as the approved family master.",
      "Preserve its bird morphology, pose, framing, camera perspective, lighting, background, and overall composition.",
      `Change only these variety-specific characteristics: ${record.derivative_change_needed}`,
    );
    if (hasReferenceImage) {
      recordFacts.push(
        "Use the second supplied image only as real-world guidance for the target variety's plumage color, lacing, barring, mottling, pattern placement, and other variety-specific visible traits.",
        "Do not copy the target reference's background, pose, framing, camera perspective, lighting, or composition; those remain controlled by the approved family master and the catalog prompt.",
      );
    }
  } else if (hasReferenceImage) {
    recordFacts.push(
      "Use the supplied reference image as real-world guidance for accurate coloration, markings, silhouette, and defining breed traits.",
      "Do not copy its background, pose, framing, camera perspective, lighting, or composition; follow the catalog prompt for those choices.",
    );
  }

  if (record.image_strategy === "VARIABLE_PHENOTYPE") {
    recordFacts.push(
      "Create a credible representative phenotype guided by the selected reference; do not imply that it is a fixed exhibition or breed-standard phenotype.",
    );
  }

  return `${approvedPrompt}\n\n${recordFacts.join("\n")}`;
}

async function loadImageFile(
  serviceClient: ReturnType<typeof createClient>,
  imageUrl: string,
  fileName: string,
) {
  const normalized = imageUrl.trim();
  let bytes: Uint8Array;
  let mimeType = "image/png";

  const catalogPrefix = `${CATALOG_BUCKET}/`;
  const publicPrefix = `/storage/v1/object/public/${CATALOG_BUCKET}/`;

  if (normalized.startsWith(catalogPrefix) || normalized.startsWith(publicPrefix)) {
    const storagePath = normalized.startsWith(catalogPrefix)
      ? normalized.slice(catalogPrefix.length)
      : normalized.slice(publicPrefix.length);
    const { data, error } = await serviceClient.storage.from(CATALOG_BUCKET).download(storagePath);
    if (error || !data) throw new PublicSafeError("not_found", "Approved master image could not be loaded", 409);
    bytes = new Uint8Array(await data.arrayBuffer());
    mimeType = data.type || mimeType;
  } else {
    let resolvedUrl = normalized;
    if (normalized.startsWith("/")) {
      const publicOrigin = configuredCorsOrigin?.replace(/\/$/, "");
      if (!publicOrigin) throw new PublicSafeError("configuration_error", "Public site origin is required to load this approved master image", 503);
      resolvedUrl = `${publicOrigin}${normalized}`;
    }
    const parsed = new URL(resolvedUrl);
    if (!new Set(["https:", "http:"]).has(parsed.protocol)) {
      throw new PublicSafeError("invalid_request", "Approved master image URL is unsupported", 409);
    }
    const response = await fetch(parsed);
    if (!response.ok) throw new PublicSafeError("not_found", "Approved master image could not be loaded", 409);
    bytes = new Uint8Array(await response.arrayBuffer());
    mimeType = response.headers.get("content-type")?.split(";")[0] || mimeType;
  }

  return new File([bytes], fileName, { type: mimeType });
}

async function loadWebReferenceFile(payload: ReferenceTokenPayload) {
  if (isUnsafeReferenceUrl(payload.image_url)) {
    throw new PublicSafeError("invalid_reference", "The selected web reference URL is unsupported. Choose another reference.");
  }
  const response = await fetch(payload.image_url, {
    headers: { Accept: "image/jpeg,image/png,image/webp" },
    redirect: "follow",
  });
  if (!response.ok || isUnsafeReferenceUrl(response.url)) {
    throw new PublicSafeError("invalid_reference", "The selected web reference could not be loaded. Choose another reference.", 422);
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() ?? "";
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (!ALLOWED_IMAGE_TYPES.has(mimeType) || declaredSize > MAX_REFERENCE_SIZE_BYTES) {
    throw new PublicSafeError("invalid_reference", "The selected web reference must be a JPG, PNG, or WebP image no larger than 10 MB.", 422);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length <= 0 || bytes.length > MAX_REFERENCE_SIZE_BYTES) {
    throw new PublicSafeError("invalid_reference", "The selected web reference must be no larger than 10 MB.", 422);
  }
  return new File([bytes], `web-reference.${extensionForMimeType(mimeType)}`, { type: mimeType });
}

async function callOpenAiGeneration(prompt: string) {
  const apiKey = requiredEnv("OPENAI_API_KEY");
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      size: IMAGE_SIZE,
      quality: IMAGE_QUALITY,
      output_format: "webp",
    }),
  });
  return readOpenAiImage(response);
}

async function callOpenAiEdit(prompt: string, images: File[]) {
  const apiKey = requiredEnv("OPENAI_API_KEY");
  const body = new FormData();
  body.append("model", IMAGE_MODEL);
  body.append("prompt", prompt);
  body.append("size", IMAGE_SIZE);
  body.append("quality", IMAGE_QUALITY);
  body.append("output_format", "webp");
  images.forEach((image) => body.append("image[]", image));

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });
  return readOpenAiImage(response);
}

async function readOpenAiImage(response: Response) {
  const payload = await response.json().catch(() => null) as {
    data?: Array<{ b64_json?: string }>;
    error?: { message?: string };
  } | null;
  if (!response.ok || !payload?.data?.[0]?.b64_json) {
    console.error("OpenAI breed image generation failed", response.status, payload?.error?.message);
    throw new PublicSafeError("generation_failed", "Image generation failed. Review the server logs and try again.", 502);
  }
  return Uint8Array.from(atob(payload.data[0].b64_json), (character) => character.charCodeAt(0));
}

async function loadActiveChickenBreeds(serviceClient: ReturnType<typeof createClient>) {
  const { data, error } = await serviceClient
    .from("breeds")
    .select("id, breed_name, breed_slug, category, image_url, is_active, is_custom, sort_order, species:species_id!inner(slug)")
    .eq("is_active", true)
    .eq("is_custom", false)
    .eq("species.slug", "chicken")
    .order("sort_order", { ascending: true })
    .returns<BreedRow[]>();
  if (error) throw new Error(`Unable to load active chicken breeds: ${error.message}`);
  return data ?? [];
}

async function listWorkbench(serviceClient: ReturnType<typeof createClient>) {
  const breeds = await loadActiveChickenBreeds(serviceClient);
  const { data: reviewRows, error: reviewError } = await serviceClient
    .from("admin_breed_image_reviews")
    .select("breed_id, status, candidate_storage_path, generation_mode, last_error, generated_at, approved_at, skipped_at")
    .in("breed_id", breeds.map((breed) => breed.id))
    .returns<ReviewRow[]>();
  if (reviewError) throw new Error(`Unable to load breed image review state: ${reviewError.message}`);

  const breedsBySlug = new Map(breeds.map((breed) => [breed.breed_slug, breed]));
  const reviewsByBreedId = new Map((reviewRows ?? []).map((review) => [review.breed_id, review]));

  if (breeds.length !== plan.length) {
    throw new Error(`Finalized image-family plan has ${plan.length} records but the active chicken catalog has ${breeds.length}`);
  }

  return Promise.all(breeds.map(async (breed) => {
    const record = planById.get(breed.id);
    if (!record || record.slug !== breed.breed_slug) {
      throw new Error(`Image-family plan does not match active breed ${breed.id} (${breed.breed_slug})`);
    }

    const review = reviewsByBreedId.get(breed.id);
    const masterSlug = parseMasterSlug(record);
    const masterBreed = breedsBySlug.get(masterSlug);
    const masterApproved = record.image_strategy !== "VARIETY_DERIVATIVE" || Boolean(masterBreed?.image_url?.trim());
    let candidateUrl: string | null = null;

    if (review?.candidate_storage_path) {
      const { data } = await serviceClient.storage
        .from(WORKBENCH_BUCKET)
        .createSignedUrl(review.candidate_storage_path, SIGNED_URL_TTL_SECONDS);
      candidateUrl = data?.signedUrl ?? null;
    }

    const status = review?.status === "candidate_ready"
      ? "candidate_ready"
      : review?.status === "generation_failed"
        ? "generation_failed"
        : review?.status === "skipped"
          ? "skipped"
          : review?.status === "generating"
            ? "generating"
            : breed.image_url?.trim()
              ? "approved"
              : !masterApproved
                ? "waiting_for_master"
                : "not_generated";

    return {
      stable_id: breed.id,
      slug: breed.breed_slug,
      breed_name: breed.breed_name,
      base_breed: record.breed,
      variety: record.variety || null,
      breed_category: breed.category,
      image_strategy: record.image_strategy,
      proposed_image_family: record.proposed_image_family,
      proposed_master_record: record.proposed_master_record,
      approved_image_url: breed.image_url,
      candidate_image_url: candidateUrl,
      status,
      last_error: review?.last_error ?? null,
      master_approved: masterApproved,
    };
  }));
}

async function loadBreed(serviceClient: ReturnType<typeof createClient>, breedId: string) {
  const breeds = await loadActiveChickenBreeds(serviceClient);
  const breed = breeds.find((item) => item.id === breedId);
  const record = planById.get(breedId);
  if (!breed || !record || breed.breed_slug !== record.slug) {
    throw new PublicSafeError("not_found", "Active chicken breed was not found in the finalized image-family plan", 404);
  }
  return { breed, breeds, record };
}

async function markFailed(
  serviceClient: ReturnType<typeof createClient>,
  breedId: string,
  userId: string,
  error: unknown,
  previousCandidatePath: string | null,
) {
  const message = error instanceof PublicSafeError ? error.publicMessage : "Image generation failed";
  await serviceClient.from("admin_breed_image_reviews").upsert({
    breed_id: breedId,
    status: previousCandidatePath ? "candidate_ready" : "generation_failed",
    candidate_storage_path: previousCandidatePath,
    last_error: message.slice(0, 1000),
    generated_by_user_id: userId,
    updated_at: new Date().toISOString(),
  });
}

async function generateCandidate(
  serviceClient: ReturnType<typeof createClient>,
  breedId: string,
  referenceImage: File | null,
  webReferenceToken: string | null,
  serviceRoleKey: string,
  userId: string,
) {
  const { breed, breeds, record } = await loadBreed(serviceClient, breedId);
  const mode = generationMode(record);
  const masterSlug = parseMasterSlug(record);
  const masterBreed = breeds.find((item) => item.breed_slug === masterSlug);

  if (mode === "derivative" && !masterBreed?.image_url?.trim()) {
    throw new PublicSafeError("master_not_approved", "Approve the required master image before generating this derivative", 409);
  }
  if (referenceImage && webReferenceToken) {
    throw new PublicSafeError("invalid_request", "Choose either a web reference or an uploaded reference, not both");
  }

  const { data: previousReview } = await serviceClient
    .from("admin_breed_image_reviews")
    .select("candidate_storage_path")
    .eq("breed_id", breedId)
    .maybeSingle<{ candidate_storage_path: string | null }>();

  await serviceClient.from("admin_breed_image_reviews").upsert({
    breed_id: breedId,
    status: "generating",
    generation_mode: mode,
    last_error: null,
    generated_by_user_id: userId,
    updated_at: new Date().toISOString(),
  });

  try {
    const selectedReference = webReferenceToken
      ? await loadWebReferenceFile(await verifyReferenceToken(webReferenceToken, breedId, serviceRoleKey))
      : referenceImage;
    if (selectedReference) normalizeMimeType(selectedReference);
    const prompt = buildPrompt(record, Boolean(selectedReference));
    const inputImages: File[] = [];
    if (mode === "derivative" && masterBreed?.image_url) {
      inputImages.push(await loadImageFile(serviceClient, masterBreed.image_url, `${masterBreed.breed_slug}-approved-master`));
    }
    if (selectedReference) {
      inputImages.push(selectedReference);
    }

    const outputBytes = inputImages.length > 0
      ? await callOpenAiEdit(prompt, inputImages)
      : await callOpenAiGeneration(prompt);
    const candidatePath = `candidates/${breed.id}/${storageSuffix()}.webp`;
    const { error: uploadError } = await serviceClient.storage
      .from(WORKBENCH_BUCKET)
      .upload(candidatePath, outputBytes, {
        contentType: "image/webp",
        cacheControl: "3600",
        upsert: false,
      });
    if (uploadError) throw new PublicSafeError("save_failed", "Generated candidate could not be stored", 500);

    const { error: saveError } = await serviceClient.from("admin_breed_image_reviews").upsert({
      breed_id: breed.id,
      status: "candidate_ready",
      candidate_storage_path: candidatePath,
      generation_mode: mode,
      last_error: null,
      generated_by_user_id: userId,
      generated_at: new Date().toISOString(),
      approved_by_user_id: null,
      approved_at: null,
      skipped_at: null,
      updated_at: new Date().toISOString(),
    });
    if (saveError) {
      await serviceClient.storage.from(WORKBENCH_BUCKET).remove([candidatePath]);
      throw new PublicSafeError("save_failed", "Generated candidate state could not be saved", 500);
    }

    if (previousReview?.candidate_storage_path && previousReview.candidate_storage_path !== candidatePath) {
      await serviceClient.storage.from(WORKBENCH_BUCKET).remove([previousReview.candidate_storage_path]);
    }
  } catch (error) {
    await markFailed(
      serviceClient,
      breedId,
      userId,
      error,
      previousReview?.candidate_storage_path ?? null,
    );
    throw error;
  }
}

async function approveCandidate(serviceClient: ReturnType<typeof createClient>, breedId: string, userId: string) {
  const { breed } = await loadBreed(serviceClient, breedId);
  const { data: review, error: reviewError } = await serviceClient
    .from("admin_breed_image_reviews")
    .select("candidate_storage_path, status")
    .eq("breed_id", breedId)
    .maybeSingle<{ candidate_storage_path: string | null; status: string }>();
  if (reviewError || review?.status !== "candidate_ready" || !review.candidate_storage_path) {
    throw new PublicSafeError("invalid_request", "A generated candidate is required before approval", 409);
  }

  const { data: candidate, error: downloadError } = await serviceClient.storage
    .from(WORKBENCH_BUCKET)
    .download(review.candidate_storage_path);
  if (downloadError || !candidate) throw new PublicSafeError("not_found", "Candidate image could not be loaded", 409);

  const approvedPath = `catalog/breeds/chicken/${breed.breed_slug}/${storageSuffix()}.webp`;
  const { error: uploadError } = await serviceClient.storage.from(CATALOG_BUCKET).upload(
    approvedPath,
    new Uint8Array(await candidate.arrayBuffer()),
    { contentType: "image/webp", cacheControl: "31536000", upsert: false },
  );
  if (uploadError) throw new PublicSafeError("save_failed", "Approved image could not be stored", 500);

  const imageUrl = `${CATALOG_BUCKET}/${approvedPath}`;
  const { error: updateError } = await serviceClient.from("breeds").update({
    image_url: imageUrl,
    updated_at: new Date().toISOString(),
  }).eq("id", breed.id);
  if (updateError) {
    await serviceClient.storage.from(CATALOG_BUCKET).remove([approvedPath]);
    throw new PublicSafeError("save_failed", "Approved image could not be associated with the breed", 500);
  }

  const { error: reviewSaveError } = await serviceClient.from("admin_breed_image_reviews").upsert({
    breed_id: breed.id,
    status: "approved",
    candidate_storage_path: null,
    last_error: null,
    approved_by_user_id: userId,
    approved_at: new Date().toISOString(),
    skipped_at: null,
    updated_at: new Date().toISOString(),
  });
  if (reviewSaveError) console.error("Approved image review state update failed", reviewSaveError);
  await serviceClient.storage.from(WORKBENCH_BUCKET).remove([review.candidate_storage_path]);
}

async function skipBreed(serviceClient: ReturnType<typeof createClient>, breedId: string, userId: string) {
  await loadBreed(serviceClient, breedId);
  const { data: review } = await serviceClient.from("admin_breed_image_reviews")
    .select("candidate_storage_path").eq("breed_id", breedId)
    .maybeSingle<{ candidate_storage_path: string | null }>();
  const { error } = await serviceClient.from("admin_breed_image_reviews").upsert({
    breed_id: breedId,
    status: "skipped",
    candidate_storage_path: null,
    last_error: null,
    generated_by_user_id: userId,
    skipped_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new PublicSafeError("save_failed", "Skip status could not be saved", 500);
  if (review?.candidate_storage_path) {
    await serviceClient.storage.from(WORKBENCH_BUCKET).remove([review.candidate_storage_path]);
  }
}

Deno.serve(async (req) => {
  const responseHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (req.method !== "POST") return errorResponse("invalid_request", "Method not allowed", 405, responseHeaders);

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = req.headers.get("Authorization");
    if (!authorization) return errorResponse("unauthorized", "Authentication required", 401, responseHeaders);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return errorResponse("unauthorized", "Authentication required", 401, responseHeaders);
    const { data: isAdmin, error: adminError } = await userClient.rpc("is_admin");
    if (adminError || isAdmin !== true) return errorResponse("unauthorized", "Platform admin access required", 403, responseHeaders);

    const contentType = req.headers.get("Content-Type") ?? "";
    let action: string;
    let breedId = "";
    let referenceImage: File | null = null;
    let webReferenceToken: string | null = null;

    if (contentType.toLowerCase().includes("multipart/form-data")) {
      const formData = await req.formData();
      action = requiredText(formData.get("action"), "action");
      breedId = requiredText(formData.get("breed_id"), "breed_id");
      const reference = formData.get("reference_image");
      referenceImage = reference instanceof File && reference.size > 0 ? reference : null;
      const token = formData.get("web_reference_token");
      webReferenceToken = typeof token === "string" && token.trim() ? token.trim() : null;
    } else {
      const body = await req.json().catch(() => ({})) as { action?: string; breed_id?: string };
      action = body.action?.trim() ?? "";
      breedId = body.breed_id?.trim() ?? "";
    }

    if (action === "list") {
      return jsonResponse({ records: await listWorkbench(serviceClient) }, 200, responseHeaders);
    }
    if (!breedId) throw new PublicSafeError("invalid_request", "breed_id is required");
    if (action === "find_references") {
      const { record } = await loadBreed(serviceClient, breedId);
      return jsonResponse({ references: await findReferenceImages(record, serviceRoleKey) }, 200, responseHeaders);
    }
    if (action === "generate") {
      await generateCandidate(serviceClient, breedId, referenceImage, webReferenceToken, serviceRoleKey, user.id);
    }
    else if (action === "approve") await approveCandidate(serviceClient, breedId, user.id);
    else if (action === "skip") await skipBreed(serviceClient, breedId, user.id);
    else throw new PublicSafeError("invalid_request", "Unsupported action");

    return jsonResponse({ records: await listWorkbench(serviceClient) }, 200, responseHeaders);
  } catch (error) {
    if (error instanceof PublicSafeError) {
      return errorResponse(error.code, error.publicMessage, error.status, responseHeaders);
    }
    console.error("Admin breed image workbench failure", error);
    return errorResponse("save_failed", "Breed image workbench is temporarily unavailable", 500, responseHeaders);
  }
});
