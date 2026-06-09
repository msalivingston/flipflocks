"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../_components/seller-context";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SellerCard,
  SellerPageHeader,
  StatusBadge,
} from "../_components/seller-ui";
import {
  ListingPhotosSection,
  type ListingPhotoItem,
} from "../listings/[listingBatchId]/listing-photos-section";
import {
  breedLibrarySelect,
  buildLibraryByBreedId,
  buildSpeciesNameById,
  getProfileDescription,
  sellerBreedProfileSelect,
  sellerMediaSelect,
  speciesSelect,
  type BreedLibraryItem,
  type BreedSpecies,
  type SellerBreedProfile,
} from "./breed-data";

type BreedDraft = {
  displayName: string;
  sellerDescription: string;
};

const buyerDescriptionMaxLength = 1000;

export function BreedDetail({ breedProfileId }: { breedProfileId: string }) {
  const { seller } = useSellerContext();
  const router = useRouter();
  const storeId = seller?.store_id ?? "";
  const [species, setSpecies] = useState<BreedSpecies[]>([]);
  const [libraryBreeds, setLibraryBreeds] = useState<BreedLibraryItem[]>([]);
  const [profile, setProfile] = useState<SellerBreedProfile | null>(null);
  const [mediaItems, setMediaItems] = useState<ListingPhotoItem[]>([]);
  const [draft, setDraft] = useState<BreedDraft | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isResettingDescription, setIsResettingDescription] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!storeId) return;

    let isMounted = true;

    async function loadBreed() {
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
          .eq("id", breedProfileId)
          .maybeSingle<SellerBreedProfile>(),
      ]);

      if (!isMounted) return;

      const firstError =
        speciesResult.error ?? breedResult.error ?? profileResult.error;

      if (firstError) {
        setLoadError(firstError.message);
        setIsLoading(false);
        return;
      }

      const nextProfile = profileResult.data;

      setSpecies(speciesResult.data ?? []);
      setLibraryBreeds(breedResult.data ?? []);
      setProfile(nextProfile ?? null);
      setDraft(
        nextProfile
          ? {
              displayName: nextProfile.display_name,
              sellerDescription: nextProfile.seller_description ?? "",
            }
          : null,
      );

      if (!nextProfile) {
        setMediaItems([]);
        setIsLoading(false);
        return;
      }

      const { data: mediaData, error: mediaLoadError } = await supabase
        .from("seller_media_management")
        .select(sellerMediaSelect)
        .eq("store_id", storeId)
        .eq("entity_type", "seller_breed_profile")
        .eq("entity_id", nextProfile.id)
        .returns<ListingPhotoItem[]>();

      if (!isMounted) return;

      setMediaItems(mediaData ?? []);
      setMediaError(mediaLoadError?.message ?? null);
      setIsLoading(false);
    }

    void loadBreed();

    return () => {
      isMounted = false;
    };
  }, [breedProfileId, reloadKey, storeId]);

  const speciesById = useMemo(() => buildSpeciesNameById(species), [species]);
  const libraryByBreedId = useMemo(
    () => buildLibraryByBreedId(libraryBreeds),
    [libraryBreeds],
  );
  const speciesName = profile
    ? speciesById.get(profile.species_id) ?? "Species"
    : "Species";
  const catalogBreed =
    profile?.breed_id ? libraryByBreedId.get(profile.breed_id) ?? null : null;
  const defaultDescription = catalogBreed?.description?.trim() ?? "";
  const defaultPhotoUrl = catalogBreed?.image_url?.trim() ?? "";
  const descriptionPreview = profile
    ? getProfileDescription(profile, libraryByBreedId)
    : "";

  function updateDraft(updates: Partial<BreedDraft>) {
    setDraft((current) => (current ? { ...current, ...updates } : current));
    setSaveError(null);
    setSuccessMessage(null);
  }

  async function saveChanges() {
    if (!profile || !draft || isSaving) return;

    if (!draft.displayName.trim()) {
      setSaveError("Add a breed name.");
      return;
    }

    if (draft.sellerDescription.length > buyerDescriptionMaxLength) {
      setSaveError(
        `Buyer description must be ${buyerDescriptionMaxLength} characters or less.`,
      );
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSuccessMessage(null);

    const { error } = await supabase.rpc("seller_upsert_breed_profile", {
      p_breed_id: profile.breed_id,
      p_custom_breed_name: profile.custom_breed_name,
      p_display_name: draft.displayName.trim(),
      p_seller_breed_profile_id: profile.id,
      p_seller_description: draft.sellerDescription.trim() || null,
      p_seller_notes: profile.seller_notes,
      p_species_id: profile.species_id,
      p_store_id: storeId,
      p_visibility_status: profile.visibility_status,
    });

    if (error) {
      setSaveError(error.message);
      setIsSaving(false);
      return;
    }

    setSuccessMessage("Breed saved.");
    setIsSaving(false);
    setReloadKey((current) => current + 1);
  }

  async function resetDescription() {
    if (!profile || !draft || !defaultDescription || isResettingDescription) {
      return;
    }

    const shouldReset = window.confirm(
      "Replace your custom buyer description with the FlipFlocks default description for this breed?",
    );

    if (!shouldReset) return;

    setIsResettingDescription(true);
    setSaveError(null);
    setSuccessMessage(null);

    const { error } = await supabase.rpc("seller_upsert_breed_profile", {
      p_breed_id: profile.breed_id,
      p_custom_breed_name: profile.custom_breed_name,
      p_display_name: draft.displayName.trim() || profile.display_name,
      p_seller_breed_profile_id: profile.id,
      p_seller_description: defaultDescription,
      p_seller_notes: profile.seller_notes,
      p_species_id: profile.species_id,
      p_store_id: storeId,
      p_visibility_status: profile.visibility_status,
    });

    if (error) {
      setSaveError(error.message);
      setIsResettingDescription(false);
      return;
    }

    setDraft((current) =>
      current ? { ...current, sellerDescription: defaultDescription } : current,
    );
    setSuccessMessage("Buyer description reset to the default.");
    setIsResettingDescription(false);
    setReloadKey((current) => current + 1);
  }

  async function removeBreed() {
    if (!profile || !draft || isRemoving) return;

    setIsRemoving(true);
    setSaveError(null);
    setSuccessMessage(null);

    const { data: activeInventory, error: inventoryError } = await supabase
      .from("seller_inventory_management")
      .select("inventory_item_id")
      .eq("store_id", storeId)
      .eq("seller_breed_profile_id", profile.id)
      .neq("inventory_visibility_status", "archived")
      .neq("listing_batch_visibility_status", "archived")
      .limit(1);

    if (inventoryError) {
      setSaveError(inventoryError.message);
      setIsRemoving(false);
      return;
    }

    if ((activeInventory ?? []).length > 0) {
      setSaveError(
        "This breed is currently used by active inventory. Archive or update that inventory before removing the breed.",
      );
      setIsRemoving(false);
      return;
    }

    const shouldRemove = window.confirm(
      "Remove this breed from your library? You can add it again later from the breed library.",
    );

    if (!shouldRemove) {
      setIsRemoving(false);
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
      setSaveError(error.message);
      setIsRemoving(false);
      return;
    }

    router.push("/dashboard/breeds");
  }

  if (isLoading) return <LoadingState label="Loading breed" />;

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-5xl px-5 py-5 sm:px-7">
        <ErrorState title="Breed could not load" message={loadError} />
      </div>
    );
  }

  if (!profile || !draft) {
    return (
      <div className="mx-auto w-full max-w-5xl px-5 py-5 sm:px-7">
        <EmptyState
          title="Breed not found"
          description="This breed may have been archived or may not belong to this seller account."
          action={
            <Link className="seller-secondary-button" href="/dashboard/breeds">
              Back to Breeds
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <>
      <SellerPageHeader
        title={profile.display_name}
        description={descriptionPreview || "Manage this breed's storefront presentation."}
        action={
          <Link className="seller-secondary-button" href="/dashboard/breeds">
            Back to Breeds
          </Link>
        }
      />

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5 sm:px-7">
        {successMessage ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
            {successMessage}
          </div>
        ) : null}

        <SellerCard className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-stone-950">
              Breed Information
            </h2>
            <StatusBadge status={speciesName} />
          </div>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Edit the breed-level content buyers see on your storefront.
          </p>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Species
              <input className="seller-form-field" disabled value={speciesName} />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Breed name
              <input
                className="seller-form-field"
                value={draft.displayName}
                onChange={(event) =>
                  updateDraft({ displayName: event.target.value })
                }
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-stone-700 md:col-span-2">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>Buyer description</span>
                {defaultDescription ? (
                  <button
                    className="seller-small-button"
                    disabled={isResettingDescription}
                    onClick={() => void resetDescription()}
                    type="button"
                  >
                    {isResettingDescription ? "Resetting" : "Reset Description"}
                  </button>
                ) : null}
              </span>
              <textarea
                className="seller-form-field min-h-36 resize-y py-3"
                maxLength={buyerDescriptionMaxLength}
                value={draft.sellerDescription}
                onChange={(event) =>
                  updateDraft({ sellerDescription: event.target.value })
                }
              />
            </label>
          </div>

          <div className="mt-5">
            <button
              className="seller-primary-button"
              disabled={isSaving}
              onClick={() => void saveChanges()}
              type="button"
            >
              {isSaving ? "Saving" : "Save Changes"}
            </button>
          </div>

          {saveError ? (
            <div className="mt-4">
              <ErrorState title="Breed was not saved" message={saveError} />
            </div>
          ) : null}
        </SellerCard>

        {defaultPhotoUrl ? (
          <SellerCard className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-stone-950">
                  Default Breed Photos
                </h2>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  Resetting custom photos to catalog defaults needs a safe media
                  copy flow before it can be enabled.
                </p>
              </div>
              <button className="seller-secondary-button" disabled type="button">
                Reset Photos
              </button>
            </div>
          </SellerCard>
        ) : null}

        {mediaError ? (
          <SellerCard className="p-5">
            <h2 className="text-lg font-semibold text-stone-950">Breed Photos</h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Photos could not load right now. You can still update breed
              information.
            </p>
          </SellerCard>
        ) : (
          <ListingPhotosSection
            canManage={profile.visibility_status !== "archived"}
            description="Manage the photos buyers see for this breed."
            emptyDescription="Add clear breed photos once, then reuse them wherever this breed appears."
            entityId={profile.id}
            entityType="seller_breed_profile"
            listingBatchId={profile.id}
            mediaItems={mediaItems}
            mode="public-content"
            storeId={storeId}
            title="Breed Photos"
            onReload={() => setReloadKey((current) => current + 1)}
          />
        )}

        <SellerCard className="border-red-200 p-5">
          <h2 className="text-lg font-semibold text-stone-950">Remove Breed</h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Remove this breed from your active breed library. You can add it
            again later from the breed library.
          </p>
          <div className="mt-4">
            <button
              className="seller-secondary-button border-red-300 text-red-700 hover:bg-red-50"
              disabled={isRemoving}
              onClick={() => void removeBreed()}
              type="button"
            >
              {isRemoving ? "Checking" : "Remove Breed"}
            </button>
          </div>
        </SellerCard>
      </main>
    </>
  );
}
