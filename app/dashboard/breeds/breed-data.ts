"use client";

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
};

export const speciesSelect = "id, common_name, slug, sort_order";
export const breedLibrarySelect =
  "id, species_id, breed_name, breed_slug, description, image_url, sort_order";
export const sellerBreedProfileSelect =
  "id, store_id, species_id, breed_id, custom_breed_name, display_name, seller_description, seller_notes, visibility_status, moderation_status";
export const sellerMediaSelect =
  "media_asset_id, media_link_id, store_id, entity_type, entity_id, display_context, public_url, alt_text, caption, sort_order, is_featured, moderation_status, asset_status, visibility_status, original_filename, content_type, file_size_bytes, width_px, height_px";

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
  if (value.startsWith("/")) return value;

  return `/storage/v1/object/public/${value}`;
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
