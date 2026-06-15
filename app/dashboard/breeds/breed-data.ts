"use client";

import { supabase } from "@/lib/supabase";
import type { ListingPhotoItem } from "../listings/[listingBatchId]/listing-photos-section";

export type BreedSpecies = {
  id: string;
  common_name: string;
  slug: string;
  sort_order: number | null;
};

export type BreedLibraryItem = {
  id: string;
  species_id: string;
  breed_name: string;
  breed_slug: string;
  description: string | null;
  bird_type: string | null;
  egg_color: string | null;
  annual_egg_production: string | null;
  image_url: string | null;
  sort_order: number | null;
};

export type SellerBreedProfile = {
  id: string;
  store_id: string;
  species_id: string;
  breed_id: string | null;
  custom_breed_name: string | null;
  display_name: string;
  seller_description: string | null;
  seller_notes: string | null;
  visibility_status: string;
  moderation_status: string;
  bird_type: string | null;
  egg_color: string | null;
  annual_egg_production: string | null;
};

type RestoreCatalogDefaultPhotoResponse = {
  already_present?: boolean;
  error?: {
    code?: string;
    details?: Record<string, unknown> | null;
    message?: string;
  };
  message?: string;
};

type FunctionErrorContext = {
  context?: Response;
  message?: string;
  name?: string;
};

export type RestoreCatalogDefaultPhotoBestEffortResult =
  | { ok: true }
  | { ok: false; message: string };

export const speciesSelect = "id, common_name, slug, sort_order";
export const breedLibrarySelect =
  "id, species_id, breed_name, breed_slug, description, bird_type, egg_color, annual_egg_production, image_url, sort_order";
export const sellerBreedProfileSelect =
  "id, store_id, species_id, breed_id, custom_breed_name, display_name, seller_description, seller_notes, visibility_status, moderation_status, bird_type, egg_color, annual_egg_production";
export const sellerMediaSelect =
  "media_asset_id, media_link_id, store_id, entity_type, entity_id, display_context, public_url, alt_text, caption, sort_order, is_featured, crop_metadata, moderation_status, asset_status, visibility_status, original_filename, content_type, file_size_bytes, width_px, height_px, source_type, source_breed_id, source_image_url";

export function buildSpeciesNameById(species: BreedSpecies[]) {
  return new Map(species.map((item) => [item.id, item.common_name]));
}

export function buildLibraryByBreedId(breeds: BreedLibraryItem[]) {
  return new Map(breeds.map((item) => [item.id, item]));
}

export function getProfileDescription(
  profile: SellerBreedProfile,
  libraryByBreedId: Map<string, BreedLibraryItem>,
) {
  return (
    profile.seller_description?.trim() ||
    (profile.breed_id
      ? libraryByBreedId.get(profile.breed_id)?.description?.trim()
      : "") ||
    ""
  );
}

export function groupProfilesBySpecies(
  profiles: SellerBreedProfile[],
  species: BreedSpecies[],
) {
  const speciesById = new Map(species.map((item) => [item.id, item]));
  const grouped = new Map<string, SellerBreedProfile[]>();

  for (const profile of profiles) {
    grouped.set(profile.species_id, [
      ...(grouped.get(profile.species_id) ?? []),
      profile,
    ]);
  }

  return Array.from(grouped, ([speciesId, speciesProfiles]) => ({
    species: speciesById.get(speciesId) ?? {
      id: speciesId,
      common_name: "Other Species",
      slug: "other",
      sort_order: 999,
    },
    profiles: speciesProfiles
      .slice()
      .sort((first, second) =>
        first.display_name.localeCompare(second.display_name),
      ),
  })).sort((first, second) => {
    const order =
      (first.species.sort_order ?? 999) - (second.species.sort_order ?? 999);

    if (order !== 0) return order;

    return first.species.common_name.localeCompare(second.species.common_name);
  });
}

export function sortBreedLibrary(
  breeds: BreedLibraryItem[],
  species: BreedSpecies[],
) {
  const speciesById = new Map(species.map((item) => [item.id, item]));

  return breeds.slice().sort((first, second) => {
    const firstSpecies = speciesById.get(first.species_id);
    const secondSpecies = speciesById.get(second.species_id);
    const speciesOrder =
      (firstSpecies?.sort_order ?? 999) - (secondSpecies?.sort_order ?? 999);

    if (speciesOrder !== 0) return speciesOrder;

    const sortOrder =
      (first.sort_order ?? 9999) - (second.sort_order ?? 9999);

    if (sortOrder !== 0) return sortOrder;

    return first.breed_name.localeCompare(second.breed_name);
  });
}

export function pickFeaturedMedia(items: ListingPhotoItem[]) {
  const activeItems = items
    .filter(
      (item) =>
        item.visibility_status === "active" &&
        item.asset_status === "active" &&
        item.moderation_status === "approved",
    )
    .sort(compareMedia);

  return activeItems.find((item) => item.is_featured) ?? activeItems[0] ?? null;
}

export function compareMedia(
  first: ListingPhotoItem,
  second: ListingPhotoItem,
) {
  const featuredOrder = Number(second.is_featured) - Number(first.is_featured);

  if (featuredOrder !== 0) return featuredOrder;

  return (first.sort_order ?? 0) - (second.sort_order ?? 0);
}

export function toDisplayImageUrl(value: string | null | undefined) {
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (value.startsWith("/") && supabaseUrl) {
    return `${supabaseUrl}${value}`;
  }

  if (value.startsWith("/")) return value;

  const storagePath = `/storage/v1/object/public/${value}`;

  return supabaseUrl ? `${supabaseUrl}${storagePath}` : storagePath;
}

export function getBreedInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;

  return `${value.slice(0, maxLength - 1).trim()}...`;
}

export async function restoreCatalogDefaultPhotoBestEffort(
  sellerBreedProfileId: string,
): Promise<RestoreCatalogDefaultPhotoBestEffortResult> {
  if (!sellerBreedProfileId) {
    return { ok: false, message: "Breed profile was missing." };
  }

  try {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    if (sessionError || !accessToken) {
      console.warn("default breed photo restore skipped: missing session", {
        message: sessionError?.message,
        sellerBreedProfileId,
      });

      return {
        ok: false,
        message: "Default photo could not be added automatically.",
      };
    }

    const { data, error } =
      await supabase.functions.invoke<RestoreCatalogDefaultPhotoResponse>(
        "seller-restore-catalog-breed-photo",
        {
          body: {
            seller_breed_profile_id: sellerBreedProfileId,
          },
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

    if (data?.already_present) {
      return { ok: true };
    }

    if (data?.error) {
      const noOpCodes = new Set([
        "already_present",
        "invalid_request",
        "not_found",
        "photo_limit_reached",
      ]);

      console.warn("default breed photo restore returned an expected result", {
        code: data.error.code,
        details: data.error.details,
        message: data.error.message,
        sellerBreedProfileId,
      });

      if (data.error.code && noOpCodes.has(data.error.code)) {
        return { ok: true };
      }

      return {
        ok: false,
        message: data.error.message ?? "Default photo could not be added automatically.",
      };
    }

    if (error) {
      const functionError = await readRestoreCatalogDefaultPhotoError(error);

      console.warn("default breed photo restore failed", {
        code: functionError?.code,
        details: functionError?.details,
        message: functionError?.message,
        sellerBreedProfileId,
        supabaseMessage: toFunctionErrorContext(error)?.message,
      });

      if (
        functionError?.code &&
        ["already_present", "invalid_request", "not_found", "photo_limit_reached"].includes(
          functionError.code,
        )
      ) {
        return { ok: true };
      }

      return {
        ok: false,
        message:
          functionError?.message ??
          "Default photo could not be added automatically.",
      };
    }

    return { ok: true };
  } catch (error) {
    console.warn("default breed photo restore failed unexpectedly", {
      error,
      sellerBreedProfileId,
    });

    return {
      ok: false,
      message: "Default photo could not be added automatically.",
    };
  }
}

async function readRestoreCatalogDefaultPhotoError(error: unknown) {
  const response = toFunctionErrorContext(error)?.context;

  if (!response) return null;

  try {
    const body = (await response.clone().json()) as RestoreCatalogDefaultPhotoResponse;

    return {
      code: body.error?.code,
      details: body.error?.details,
      message: body.error?.message,
    };
  } catch (readError) {
    console.warn("default breed photo restore error body could not be read", {
      error: readError,
      status: response.status,
    });

    return null;
  }
}

function toFunctionErrorContext(error: unknown): FunctionErrorContext | null {
  if (!error || typeof error !== "object") return null;

  return error as FunctionErrorContext;
}
