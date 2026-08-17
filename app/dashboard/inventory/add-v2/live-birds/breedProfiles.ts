import { formatBreedDisplayName } from "@/lib/breed-identity";
import { supabase } from "@/lib/supabase";
import {
  getCatalogBreedSnapshotRpcArgs,
  pickFeaturedMedia,
  sellerBreedProfileSelect,
  toDisplayImageUrl,
  type BreedLibraryItem,
  type SellerBreedProfile,
} from "../../../breeds/breed-data";
import type { ListingPhotoItem } from "../../../listings/[listingBatchId]/listing-photos-section";
import { fallbackBreedOptions } from "./constants";
import type { BreedOption, SpeciesOption } from "./types";

type BreedProfileUpsertResult = {
  seller_breed_profile_id?: string | null;
};

export function getBreedOptionsForSpecies({
  catalogBreeds,
  mediaItems,
  sellerBreedProfiles,
  species,
}: {
  catalogBreeds: BreedLibraryItem[];
  mediaItems: ListingPhotoItem[];
  sellerBreedProfiles: SellerBreedProfile[];
  species: SpeciesOption;
}) {
  const profilesForSpecies = species.id
    ? sellerBreedProfiles.filter((profile) => profile.species_id === species.id)
    : sellerBreedProfiles;
  const profilesByBreedId = new Map(
    profilesForSpecies
      .filter((profile) => profile.breed_id)
      .map((profile) => [profile.breed_id, profile] as const),
  );
  const catalogOptions = catalogBreeds
    .filter((breed) => !species.id || breed.species_id === species.id)
    .map((breed) => {
      const profile = profilesByBreedId.get(breed.id);

      if (profile) {
        return getBreedOptionForProfile({
          catalogBreeds,
          mediaItems,
          profile,
        });
      }

      return {
        id: null,
        label: formatBreedDisplayName(breed.breed_name, breed.variety),
        speciesId: breed.species_id,
        breedId: breed.id,
        catalogImageUrl: breed.image_url,
        catalogDescription: breed.description,
        sellerPhotoUrl: null,
        sellerDescription: null,
        source: "catalog_breed" as const,
      };
    });
  const customProfileOptions = profilesForSpecies
    .filter((profile) => !profile.breed_id)
    .map((profile) =>
      getBreedOptionForProfile({
        catalogBreeds,
        mediaItems,
        profile,
      }),
    );
  const options = [...catalogOptions, ...customProfileOptions];

  return options.length > 0 ? options : fallbackBreedOptions;
}

export function getBreedOptionForProfile({
  catalogBreeds,
  mediaItems,
  profile,
}: {
  catalogBreeds: BreedLibraryItem[];
  mediaItems: ListingPhotoItem[];
  profile: SellerBreedProfile;
}): BreedOption {
  const catalogBreed = profile.breed_id
    ? catalogBreeds.find((breed) => breed.id === profile.breed_id) ?? null
    : null;
  const profileMediaItems = mediaItems.filter(
    (item) => item.entity_id === profile.id,
  );
  const featuredMedia = pickFeaturedMedia(profileMediaItems);
  const sellerPhotoUrl = toDisplayImageUrl(featuredMedia?.public_url) || null;

  return {
    id: profile.id,
    label: profile.display_name,
    speciesId: profile.species_id,
    breedId: profile.breed_id,
    catalogImageUrl: catalogBreed?.image_url ?? null,
    catalogDescription: null,
    sellerPhotoUrl,
    sellerDescription: profile.seller_description,
    source: "seller_profile",
  };
}

export function getBreedDescriptionFromOption(
  option: BreedOption | null | undefined,
) {
  return (
    option?.sellerDescription?.trim() ||
    option?.catalogDescription?.trim() ||
    ""
  );
}

export async function createSellerBreedProfileFromCatalogBreed({
  breedId,
  catalogBreeds,
  storeId,
}: {
  breedId: string;
  catalogBreeds: BreedLibraryItem[];
  storeId: string;
}): Promise<
  | { ok: true; profile: SellerBreedProfile }
  | { ok: false; message: string }
> {
  const catalogBreed = catalogBreeds.find((breed) => breed.id === breedId);

  if (!catalogBreed) {
    return { ok: false, message: "That catalog breed could not be found." };
  }

  const upsertResult = await supabase.rpc("seller_upsert_breed_profile", {
    ...getCatalogBreedSnapshotRpcArgs(catalogBreed),
    p_seller_breed_profile_id: null,
    p_seller_notes: null,
    p_species_id: catalogBreed.species_id,
    p_store_id: storeId,
    p_visibility_status: "active",
  });

  if (upsertResult.error) {
    return { ok: false, message: upsertResult.error.message };
  }

  const upsertRows = Array.isArray(upsertResult.data)
    ? (upsertResult.data as BreedProfileUpsertResult[])
    : [];
  const createdProfileId =
    upsertRows[0]?.seller_breed_profile_id ??
    (upsertResult.data as BreedProfileUpsertResult | null)
      ?.seller_breed_profile_id;

  if (!createdProfileId) {
    return {
      ok: false,
      message: "The breed could not be added to your personal breed library.",
    };
  }

  const profileResult = await supabase
    .from("seller_breed_profiles")
    .select(sellerBreedProfileSelect)
    .eq("store_id", storeId)
    .eq("id", createdProfileId)
    .maybeSingle<SellerBreedProfile>();

  if (profileResult.error) {
    return { ok: false, message: profileResult.error.message };
  }

  if (!profileResult.data) {
    return {
      ok: false,
      message: "The new breed profile could not be loaded.",
    };
  }

  return { ok: true, profile: profileResult.data };
}

export function upsertSellerBreedProfile(
  profiles: SellerBreedProfile[],
  nextProfile: SellerBreedProfile,
) {
  const existingIndex = profiles.findIndex(
    (profile) => profile.id === nextProfile.id,
  );

  if (existingIndex === -1) {
    return [...profiles, nextProfile];
  }

  return profiles.map((profile, index) =>
    index === existingIndex ? nextProfile : profile,
  );
}
