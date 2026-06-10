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
  annualEggProduction: string;
  birdType: string;
  displayName: string;
  eggColor: string;
  sellerDescription: string;
};

type RestoreDefaultPhotoResponse = {
  already_present?: boolean;
  media?: ListingPhotoItem | null;
  message?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

type FunctionErrorContext = {
  context?: Response;
  message?: string;
  name?: string;
};

const buyerDescriptionMaxLength = 1000;
const birdTypeOptions = [
  { label: "Layer", value: "layer" },
  { label: "Meat", value: "meat" },
  { label: "Dual Purpose", value: "dual_purpose" },
];
const eggColorOptions = [
  { label: "White", value: "white" },
  { label: "Light Brown", value: "light_brown" },
  { label: "Brown", value: "brown" },
  { label: "Dark Brown", value: "dark_brown" },
  { label: "Blue", value: "blue" },
  { label: "Blue-Green", value: "blue_green" },
  { label: "Green", value: "green" },
  { label: "Olive", value: "olive" },
];
const annualEggProductionOptions = [
  { label: "Less than 150 eggs/year", value: "under_150" },
  { label: "150–200 eggs/year", value: "150_200" },
  { label: "200–250 eggs/year", value: "200_250" },
  { label: "250–300 eggs/year", value: "250_300" },
  { label: "More than 300 eggs/year", value: "over_300" },
];

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
  const [isRestoringCatalogDefaults, setIsRestoringCatalogDefaults] =
    useState(false);
  const [isRestoringDefaultPhoto, setIsRestoringDefaultPhoto] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [photoActionError, setPhotoActionError] = useState<string | null>(null);
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
      setPhotoActionError(null);

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
              annualEggProduction: nextProfile.annual_egg_production ?? "",
              birdType: nextProfile.bird_type ?? "",
              displayName: nextProfile.display_name,
              eggColor: nextProfile.egg_color ?? "",
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
  const speciesSlug = profile
    ? species.find((item) => item.id === profile.species_id)?.slug ?? ""
    : "";
  const isChickenBreed = speciesSlug === "chicken";
  const catalogBreed =
    profile?.breed_id ? libraryByBreedId.get(profile.breed_id) ?? null : null;
  const defaultPhotoUrl = catalogBreed?.image_url?.trim() ?? "";
  const activeBreedPhotos = useMemo(
    () =>
      mediaItems.filter(
        (item) =>
          item.visibility_status === "active" &&
          item.asset_status === "active" &&
          item.moderation_status === "approved",
      ),
    [mediaItems],
  );
  const activeBreedPhotoCount = activeBreedPhotos.length;
  const hasActiveCatalogDefaultPhoto = Boolean(
    catalogBreed &&
      defaultPhotoUrl &&
      activeBreedPhotos.some(
        (item) =>
          item.source_type === "catalog_breed_image" &&
          item.source_breed_id === catalogBreed.id &&
          item.source_image_url === defaultPhotoUrl,
      ),
  );
  const canManagePhotos = profile?.visibility_status !== "archived";
  const canShowRestoreDefaultPhoto =
    Boolean(catalogBreed && defaultPhotoUrl && !hasActiveCatalogDefaultPhoto) &&
    !mediaError;
  const isBreedPhotoLimitReached = activeBreedPhotoCount >= 4;
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
      p_annual_egg_production: isChickenBreed
        ? draft.annualEggProduction || null
        : null,
      p_bird_type: isChickenBreed ? draft.birdType || null : null,
      p_egg_color: isChickenBreed ? draft.eggColor || null : null,
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

  async function restoreCatalogDefaults() {
    if (!profile || !draft || !catalogBreed || isRestoringCatalogDefaults) {
      return;
    }

    const restoreItems = [
      "Description",
      ...(isChickenBreed
        ? ["Bird Type", "Egg Color", "Annual Egg Production"]
        : []),
    ];
    const shouldRestore = window.confirm(
      [
        "Restore Catalog Defaults?",
        "",
        "Restore this breed's information from the FlipFlocks breed library?",
        "",
        "This will replace your customized:",
        ...restoreItems.map((item) => `* ${item}`),
        "",
        "Photos, listings, inventory, and other records will not be changed.",
      ].join("\n"),
    );

    if (!shouldRestore) return;

    setIsRestoringCatalogDefaults(true);
    setSaveError(null);
    setSuccessMessage(null);

    const restoredDescription = catalogBreed.description?.trim() ?? "";
    const restoredBirdType = isChickenBreed ? catalogBreed.bird_type ?? null : null;
    const restoredEggColor = isChickenBreed ? catalogBreed.egg_color ?? null : null;
    const restoredAnnualEggProduction = isChickenBreed
      ? catalogBreed.annual_egg_production ?? null
      : null;

    const { error } = await supabase.rpc("seller_upsert_breed_profile", {
      p_breed_id: profile.breed_id,
      p_custom_breed_name: profile.custom_breed_name,
      p_display_name: draft.displayName.trim() || profile.display_name,
      p_annual_egg_production: restoredAnnualEggProduction,
      p_bird_type: restoredBirdType,
      p_egg_color: restoredEggColor,
      p_seller_breed_profile_id: profile.id,
      p_seller_description: restoredDescription || null,
      p_seller_notes: profile.seller_notes,
      p_species_id: profile.species_id,
      p_store_id: storeId,
      p_visibility_status: profile.visibility_status,
    });

    if (error) {
      setSaveError(error.message);
      setIsRestoringCatalogDefaults(false);
      return;
    }

    const { error: metadataError } = await supabase
      .from("seller_breed_profiles")
      .update({
        annual_egg_production: restoredAnnualEggProduction,
        bird_type: restoredBirdType,
        egg_color: restoredEggColor,
      })
      .eq("store_id", storeId)
      .eq("id", profile.id);

    if (metadataError) {
      setSaveError(metadataError.message);
      setIsRestoringCatalogDefaults(false);
      return;
    }

    setDraft((current) =>
      current
        ? {
            ...current,
            annualEggProduction: restoredAnnualEggProduction ?? "",
            birdType: restoredBirdType ?? "",
            eggColor: restoredEggColor ?? "",
            sellerDescription: restoredDescription,
          }
        : current,
    );
    setSuccessMessage("Breed restored from the FlipFlocks breed library.");
    setIsRestoringCatalogDefaults(false);
    setReloadKey((current) => current + 1);
  }

  async function restoreDefaultPhoto() {
    if (
      !profile ||
      !catalogBreed ||
      !defaultPhotoUrl ||
      isRestoringDefaultPhoto ||
      hasActiveCatalogDefaultPhoto
    ) {
      return;
    }

    setPhotoActionError(null);
    setSaveError(null);
    setSuccessMessage(null);

    if (isBreedPhotoLimitReached) {
      setPhotoActionError(
        "You already have 4 breed photos. Remove a photo before restoring the default photo.",
      );
      return;
    }

    setIsRestoringDefaultPhoto(true);

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    if (sessionError || !accessToken) {
      setPhotoActionError("Please sign in again and try restoring the default photo.");
      setIsRestoringDefaultPhoto(false);
      return;
    }

    const { data, error } =
      await supabase.functions.invoke<RestoreDefaultPhotoResponse>(
        "seller-restore-catalog-breed-photo",
        {
          body: {
            seller_breed_profile_id: profile.id,
          },
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

    if (error || data?.error) {
      const functionError = await readRestoreDefaultPhotoError(error);
      setPhotoActionError(
        data?.error?.message ??
          functionError?.message ??
          "Default photo could not be restored. Please try again.",
      );
      setIsRestoringDefaultPhoto(false);
      return;
    }

    setSuccessMessage(
      data?.already_present
        ? "Default photo is already included."
        : data?.message ?? "Default photo restored.",
    );
    setIsRestoringDefaultPhoto(false);
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
            Edit the breed-level content buyers see on your storefront. Catalog
            breeds can be restored from the FlipFlocks breed library.
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

            {isChickenBreed ? (
              <>
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Bird type
                  <select
                    className="seller-form-field"
                    value={draft.birdType}
                    onChange={(event) =>
                      updateDraft({ birdType: event.target.value })
                    }
                  >
                    <option value="">Choose bird type</option>
                    {birdTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Egg color
                  <select
                    className="seller-form-field"
                    value={draft.eggColor}
                    onChange={(event) =>
                      updateDraft({ eggColor: event.target.value })
                    }
                  >
                    <option value="">Choose egg color</option>
                    {eggColorOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm font-semibold text-stone-700 md:col-span-2">
                  Annual egg production
                  <select
                    className="seller-form-field"
                    value={draft.annualEggProduction}
                    onChange={(event) =>
                      updateDraft({ annualEggProduction: event.target.value })
                    }
                  >
                    <option value="">Choose annual egg production</option>
                    {annualEggProductionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}

            <label className="grid gap-1 text-sm font-semibold text-stone-700 md:col-span-2">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>Buyer description</span>
                {catalogBreed ? (
                  <button
                    className="seller-small-button"
                    disabled={isRestoringCatalogDefaults}
                    onClick={() => void restoreCatalogDefaults()}
                    type="button"
                  >
                    {isRestoringCatalogDefaults
                      ? "Restoring"
                      : "Restore Catalog Defaults"}
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

        {canShowRestoreDefaultPhoto ? (
          <SellerCard className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-stone-950">
                  Default Breed Photo
                </h2>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  Restore the FlipFlocks breed library image as one of your
                  normal breed photos.
                </p>
                {isBreedPhotoLimitReached ? (
                  <p className="mt-2 text-sm font-semibold text-amber-800">
                    You already have 4 breed photos. Remove a photo before
                    restoring the default photo.
                  </p>
                ) : null}
                {photoActionError ? (
                  <p className="mt-2 text-sm font-semibold text-red-700">
                    {photoActionError}
                  </p>
                ) : null}
              </div>
              <button
                className="seller-secondary-button"
                disabled={
                  !canManagePhotos ||
                  isBreedPhotoLimitReached ||
                  isRestoringDefaultPhoto
                }
                onClick={() => void restoreDefaultPhoto()}
                type="button"
              >
                {isRestoringDefaultPhoto ? "Restoring" : "Restore Default Photo"}
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

async function readRestoreDefaultPhotoError(error: unknown) {
  const response = toFunctionErrorContext(error)?.context;

  if (!response) return null;

  try {
    const body = (await response.clone().json()) as RestoreDefaultPhotoResponse;

    return {
      code: body.error?.code,
      message: body.error?.message,
    };
  } catch (readError) {
    console.error("default photo restore error body could not be read", {
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
