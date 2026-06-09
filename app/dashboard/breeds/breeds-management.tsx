"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../_components/seller-context";
import {
  EmptyState,
  ErrorState,
  FilterControl,
  LoadingState,
  SellerCard,
  StatusBadge,
} from "../_components/seller-ui";
import type { ListingPhotoItem } from "../listings/[listingBatchId]/listing-photos-section";
import {
  breedLibrarySelect,
  buildLibraryByBreedId,
  buildSpeciesNameById,
  getBreedInitials,
  getProfileDescription,
  groupProfilesBySpecies,
  pickFeaturedMedia,
  sellerBreedProfileSelect,
  sellerMediaSelect,
  sortBreedLibrary,
  speciesSelect,
  toDisplayImageUrl,
  truncateText,
  type BreedLibraryItem,
  type BreedSpecies,
  type SellerBreedProfile,
} from "./breed-data";

type BreedProfileUpsertResult = {
  seller_breed_profile_id: string;
};

export function BreedsManagement() {
  const { seller } = useSellerContext();
  const router = useRouter();
  const storeId = seller?.store_id ?? "";
  const [species, setSpecies] = useState<BreedSpecies[]>([]);
  const [libraryBreeds, setLibraryBreeds] = useState<BreedLibraryItem[]>([]);
  const [profiles, setProfiles] = useState<SellerBreedProfile[]>([]);
  const [mediaItems, setMediaItems] = useState<ListingPhotoItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removingProfileId, setRemovingProfileId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    function openAddModal() {
      setIsModalOpen(true);
    }

    const trigger = document.querySelector("[data-breeds-add-trigger]");
    trigger?.addEventListener("click", openAddModal);

    return () => {
      trigger?.removeEventListener("click", openAddModal);
    };
  }, []);

  useEffect(() => {
    if (!storeId) return;

    let isMounted = true;

    async function loadBreeds() {
      setIsLoading(true);
      setLoadError(null);
      setMediaError(null);

      const [speciesResult, breedResult, profileResult] = await Promise.all([
        supabase
          .from("species")
          .select(speciesSelect)
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("common_name", { ascending: true })
          .returns<BreedSpecies[]>(),
        supabase
          .from("breeds")
          .select(breedLibrarySelect)
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("breed_name", { ascending: true })
          .returns<BreedLibraryItem[]>(),
        supabase
          .from("seller_breed_profiles")
          .select(sellerBreedProfileSelect)
          .eq("store_id", storeId)
          .neq("visibility_status", "archived")
          .eq("moderation_status", "normal")
          .order("display_name", { ascending: true })
          .returns<SellerBreedProfile[]>(),
      ]);

      if (!isMounted) return;

      const firstError =
        speciesResult.error ?? breedResult.error ?? profileResult.error;

      if (firstError) {
        setLoadError(firstError.message);
        setIsLoading(false);
        return;
      }

      const nextProfiles = profileResult.data ?? [];

      setSpecies(speciesResult.data ?? []);
      setLibraryBreeds(breedResult.data ?? []);
      setProfiles(nextProfiles);

      if (nextProfiles.length === 0) {
        setMediaItems([]);
        setIsLoading(false);
        return;
      }

      const { data: mediaData, error: mediaLoadError } = await supabase
        .from("seller_media_management")
        .select(sellerMediaSelect)
        .eq("store_id", storeId)
        .eq("entity_type", "seller_breed_profile")
        .in(
          "entity_id",
          nextProfiles.map((profile) => profile.id),
        )
        .returns<ListingPhotoItem[]>();

      if (!isMounted) return;

      setMediaItems(mediaData ?? []);
      setMediaError(mediaLoadError?.message ?? null);
      setIsLoading(false);
    }

    void loadBreeds();

    return () => {
      isMounted = false;
    };
  }, [reloadKey, storeId]);

  const libraryByBreedId = useMemo(
    () => buildLibraryByBreedId(libraryBreeds),
    [libraryBreeds],
  );
  const speciesById = useMemo(() => buildSpeciesNameById(species), [species]);
  const groups = useMemo(
    () => groupProfilesBySpecies(profiles, species),
    [profiles, species],
  );
  const mediaByProfileId = useMemo(() => {
    const grouped = new Map<string, ListingPhotoItem[]>();

    for (const item of mediaItems) {
      grouped.set(item.entity_id, [...(grouped.get(item.entity_id) ?? []), item]);
    }

    return grouped;
  }, [mediaItems]);

  async function removeBreed(profile: SellerBreedProfile) {
    if (removingProfileId) return;

    setRemovingProfileId(profile.id);
    setActionError(null);

    const { data: activeInventory, error: inventoryError } = await supabase
      .from("seller_inventory_management")
      .select("inventory_item_id")
      .eq("store_id", storeId)
      .eq("seller_breed_profile_id", profile.id)
      .neq("inventory_visibility_status", "archived")
      .neq("listing_batch_visibility_status", "archived")
      .limit(1);

    if (inventoryError) {
      setActionError(inventoryError.message);
      setRemovingProfileId(null);
      return;
    }

    if ((activeInventory ?? []).length > 0) {
      setActionError(
        "This breed is currently used by active inventory. Archive or update that inventory before removing the breed.",
      );
      setRemovingProfileId(null);
      return;
    }

    const shouldRemove = window.confirm(
      "Remove this breed from your library? You can add it again later from the breed library.",
    );

    if (!shouldRemove) {
      setRemovingProfileId(null);
      return;
    }

    const { error } = await supabase.rpc("seller_upsert_breed_profile", {
      p_breed_id: profile.breed_id,
      p_custom_breed_name: profile.custom_breed_name,
      p_display_name: profile.display_name,
      p_seller_breed_profile_id: profile.id,
      p_seller_description: profile.seller_description,
      p_seller_notes: profile.seller_notes,
      p_species_id: profile.species_id,
      p_store_id: storeId,
      p_visibility_status: "archived",
    });

    if (error) {
      setActionError(error.message);
      setRemovingProfileId(null);
      return;
    }

    setProfiles((current) => current.filter((item) => item.id !== profile.id));
    setMediaItems((current) =>
      current.filter((item) => item.entity_id !== profile.id),
    );
    setRemovingProfileId(null);
  }

  if (isLoading) return <LoadingState label="Loading breeds" />;

  if (loadError) {
    return (
      <ErrorState
        message={loadError}
        action={
          <button
            className="seller-secondary-button"
            onClick={() => setReloadKey((current) => current + 1)}
            type="button"
          >
            Reload breeds
          </button>
        }
      />
    );
  }

  return (
    <>
      <SellerCard className="overflow-hidden">
        {profiles.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No breeds yet"
              description="Add the breeds you raise to start shaping your storefront presentation."
              action={
                <button
                  className="seller-primary-button"
                  onClick={() => setIsModalOpen(true)}
                  type="button"
                >
                  Add Breed
                </button>
              }
            />
          </div>
        ) : (
          <div className="divide-y divide-stone-200">
            {actionError ? (
              <div className="bg-red-50 px-5 py-3 text-sm font-medium text-red-800">
                {actionError}
              </div>
            ) : null}
            {mediaError ? (
              <div className="bg-amber-50 px-5 py-3 text-sm font-medium text-amber-900">
                Breed photos could not load right now. Breed details are still available.
              </div>
            ) : null}
            {groups.map((group) => (
              <section key={group.species.id} className="px-4 py-4 sm:px-5">
                <div className="flex items-center gap-3 border-b border-stone-200 pb-3">
                  <span className="text-lg text-emerald-800" aria-hidden="true">
                    {getSpeciesMark(group.species.slug)}
                  </span>
                  <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-stone-950">
                    {group.species.common_name}
                  </h2>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
                    {group.profiles.length}
                  </span>
                </div>
                <div className="divide-y divide-stone-100">
                  {group.profiles.map((profile) => (
                    <BreedRow
                      key={profile.id}
                      description={getProfileDescription(profile, libraryByBreedId)}
                      isRemoving={removingProfileId === profile.id}
                      mediaItems={mediaByProfileId.get(profile.id) ?? []}
                      profile={profile}
                      onRemove={() => void removeBreed(profile)}
                    />
                  ))}
                </div>
              </section>
            ))}
            <div className="grid gap-3 border-t border-stone-200 bg-stone-50 px-5 py-4 text-sm font-semibold text-stone-700 sm:grid-cols-3">
              <span>{profiles.length} Active Breeds</span>
              <span>{groups.length} Species</span>
              <span>Used on Storefront</span>
            </div>
          </div>
        )}
      </SellerCard>

      {isModalOpen ? (
        <AddBreedModal
          libraryBreeds={sortBreedLibrary(libraryBreeds, species)}
          profiles={profiles}
          species={species}
          speciesById={speciesById}
          storeId={storeId}
          onClose={() => setIsModalOpen(false)}
          onAdded={(breedProfileId) => {
            setIsModalOpen(false);
            setReloadKey((current) => current + 1);
            router.push(`/dashboard/breeds/${breedProfileId}`);
          }}
        />
      ) : null}
    </>
  );
}

function BreedRow({
  description,
  isRemoving,
  mediaItems,
  onRemove,
  profile,
}: {
  description: string;
  isRemoving: boolean;
  mediaItems: ListingPhotoItem[];
  onRemove: () => void;
  profile: SellerBreedProfile;
}) {
  const featuredPhoto = pickFeaturedMedia(mediaItems);

  return (
    <div className="grid gap-3 py-4 sm:grid-cols-[72px_minmax(0,1fr)_auto_auto] sm:items-center">
      <BreedThumbnail
        altText={featuredPhoto?.alt_text ?? profile.display_name}
        imageUrl={featuredPhoto?.public_url}
        name={profile.display_name}
      />
      <div className="min-w-0">
        <h3 className="font-semibold text-stone-950">{profile.display_name}</h3>
        <p className="mt-1 max-w-xl text-sm leading-6 text-stone-600">
          {description
            ? truncateText(description, 140)
            : "No buyer description yet."}
        </p>
      </div>
      <StatusBadge status={profile.visibility_status === "active" ? "active" : "hidden"} />
      <div className="flex flex-wrap items-center gap-2">
        <Link
          className="seller-secondary-button"
          href={`/dashboard/breeds/${profile.id}`}
        >
          Edit
        </Link>
        <button
          className="seller-secondary-button border-red-300 text-red-700 hover:bg-red-50"
          disabled={isRemoving}
          onClick={onRemove}
          type="button"
        >
          {isRemoving ? "Checking" : "Remove"}
        </button>
      </div>
    </div>
  );
}

function AddBreedModal({
  libraryBreeds,
  onAdded,
  onClose,
  profiles,
  species,
  speciesById,
  storeId,
}: {
  libraryBreeds: BreedLibraryItem[];
  onAdded: (breedProfileId: string) => void;
  onClose: () => void;
  profiles: SellerBreedProfile[];
  species: BreedSpecies[];
  speciesById: Map<string, string>;
  storeId: string;
}) {
  const [query, setQuery] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState("all");
  const [addingBreedId, setAddingBreedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const existingBreedIds = useMemo(
    () =>
      new Set(
        profiles
          .map((profile) => profile.breed_id)
          .filter((value): value is string => Boolean(value)),
      ),
    [profiles],
  );
  const filteredBreeds = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return libraryBreeds
      .filter((breed) => {
        if (existingBreedIds.has(breed.id)) return false;
        if (speciesFilter !== "all" && breed.species_id !== speciesFilter) {
          return false;
        }
        if (!normalizedQuery) return true;

        return breed.breed_name.toLowerCase().includes(normalizedQuery);
      })
      .slice(0, 20);
  }, [existingBreedIds, libraryBreeds, query, speciesFilter]);

  async function addBreed(breed: BreedLibraryItem) {
    if (addingBreedId) return;

    setAddingBreedId(breed.id);
    setError(null);

    const { data, error: addError } = await supabase.rpc(
      "seller_upsert_breed_profile",
      {
        p_breed_id: breed.id,
        p_custom_breed_name: null,
        p_display_name: breed.breed_name,
        p_seller_breed_profile_id: null,
        p_seller_description: breed.description,
        p_seller_notes: null,
        p_species_id: breed.species_id,
        p_store_id: storeId,
        p_visibility_status: "active",
      },
    );

    if (addError) {
      setError(addError.message);
      setAddingBreedId(null);
      return;
    }

    const upsertResult = data as
      | BreedProfileUpsertResult
      | BreedProfileUpsertResult[]
      | null;
    const breedProfileId = Array.isArray(upsertResult)
      ? upsertResult[0]?.seller_breed_profile_id
      : upsertResult?.seller_breed_profile_id;

    if (!breedProfileId) {
      setError("Breed was added, but the new breed profile could not be opened.");
      setAddingBreedId(null);
      return;
    }

    setAddingBreedId(null);
    onAdded(breedProfileId);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/60 px-3 py-4 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">Add Breed</h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Search our breed library to find and add a breed to your collection.
            </p>
          </div>
          <button
            aria-label="Close Add Breed"
            className="rounded-md px-2 py-1 text-2xl leading-none text-stone-500 hover:bg-stone-100 hover:text-stone-950"
            onClick={onClose}
            type="button"
          >
            x
          </button>
        </div>

        <div className="grid gap-3 border-b border-stone-200 px-5 py-4 sm:grid-cols-[1fr_220px]">
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            <span className="sr-only">Search breeds</span>
            <input
              className="seller-form-field"
              placeholder="Search breeds by name..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <FilterControl
            label="Species"
            options={[
              { label: "All Species", value: "all" },
              ...species.map((item) => ({
                label: item.common_name,
                value: item.id,
              })),
            ]}
            value={speciesFilter}
            onChange={setSpeciesFilter}
          />
        </div>

        {error ? (
          <div className="px-5 pt-4">
            <ErrorState title="Breed was not added" message={error} />
          </div>
        ) : null}

        <div className="max-h-[54vh] overflow-y-auto px-5">
          {filteredBreeds.length === 0 ? (
            <div className="py-8 text-center">
              <h3 className="font-semibold text-stone-950">No matching breeds</h3>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                Try a different search or species filter.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-stone-100">
              {filteredBreeds.map((breed) => (
                <div
                  key={breed.id}
                  className="grid gap-3 py-4 sm:grid-cols-[64px_minmax(150px,0.8fr)_minmax(0,1fr)_auto] sm:items-center"
                >
                  <BreedThumbnail
                    imageUrl={breed.image_url}
                    name={breed.breed_name}
                    size="small"
                  />
                  <div>
                    <h3 className="font-semibold text-stone-950">
                      {breed.breed_name}
                    </h3>
                    <p className="mt-1 text-sm text-stone-600">
                      {speciesById.get(breed.species_id) ?? "Species"}
                    </p>
                  </div>
                  <p className="text-sm leading-6 text-stone-600">
                    {breed.description
                      ? truncateText(breed.description, 120)
                      : "No default description yet."}
                  </p>
                  <button
                    className="seller-secondary-button"
                    disabled={addingBreedId === breed.id}
                    onClick={() => void addBreed(breed)}
                    type="button"
                  >
                    {addingBreedId === breed.id ? "Adding" : "Add"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-stone-200 bg-stone-50 px-5 py-4 text-sm text-stone-700">
          Can&apos;t find what you&apos;re looking for? Request a breed from
          support.
        </div>
      </div>
    </div>
  );
}

function BreedThumbnail({
  altText,
  imageUrl,
  name,
  size = "default",
}: {
  altText?: string;
  imageUrl?: string | null;
  name: string;
  size?: "default" | "small";
}) {
  const displayUrl = toDisplayImageUrl(imageUrl);
  const dimensions = size === "small" ? "h-14 w-14" : "h-16 w-16";

  if (displayUrl) {
    return (
      <div
        aria-label={altText ?? name}
        className={`${dimensions} rounded-md bg-cover bg-center`}
        role="img"
        style={{ backgroundImage: `url("${displayUrl}")` }}
      />
    );
  }

  return (
    <div
      className={`${dimensions} flex items-center justify-center rounded-md bg-emerald-50 text-sm font-bold text-emerald-800`}
      aria-hidden="true"
    >
      {getBreedInitials(name)}
    </div>
  );
}

function getSpeciesMark(slug: string) {
  if (slug === "duck") return "D";
  if (slug === "goose") return "G";
  if (slug === "turkey") return "T";

  return "B";
}
