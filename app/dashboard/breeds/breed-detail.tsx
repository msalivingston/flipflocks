"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
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

type RestoreOptionKey = "description" | "details" | "photos";

type RestoreCatalogSelection = Record<RestoreOptionKey, boolean>;

type RestoreCatalogOption = {
  key: RestoreOptionKey;
  label: string;
};

const buyerDescriptionMaxLength = 1000;
const birdTypeOptions = [
  { label: "Egg Layer", value: "layer" },
  { label: "Meat Bird", value: "meat" },
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
  const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);
  const [restoreDialogError, setRestoreDialogError] = useState<string | null>(
    null,
  );
  const [restoreSelection, setRestoreSelection] =
    useState<RestoreCatalogSelection>({
      description: false,
      details: false,
      photos: false,
    });
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
  const canManagePhotos = profile?.visibility_status !== "archived";
  const hasCatalogDescription = Boolean(catalogBreed?.description?.trim());
  const hasCatalogDetails = Boolean(
    isChickenBreed &&
      catalogBreed &&
      (catalogBreed.bird_type ||
        catalogBreed.egg_color ||
        catalogBreed.annual_egg_production),
  );
  const hasCatalogPhoto = Boolean(defaultPhotoUrl && canManagePhotos && !mediaError);
  const restoreOptions = useMemo<RestoreCatalogOption[]>(() => {
    const options: RestoreCatalogOption[] = [];

    if (hasCatalogDescription) {
      options.push({ key: "description", label: "Description" });
    }

    if (hasCatalogDetails) {
      options.push({ key: "details", label: "Breed details" });
    }

    if (hasCatalogPhoto) {
      options.push({ key: "photos", label: "Photos" });
    }

    return options;
  }, [hasCatalogDescription, hasCatalogDetails, hasCatalogPhoto]);
  const hasRestoreOptions = restoreOptions.length > 0;
  const hasSelectedRestoreOption = restoreOptions.some(
    (option) => restoreSelection[option.key],
  );

  function updateDraft(updates: Partial<BreedDraft>) {
    setDraft((current) => (current ? { ...current, ...updates } : current));
    setSaveError(null);
    setSuccessMessage(null);
  }

  function openRestoreDialog() {
    const nextSelection: RestoreCatalogSelection = {
      description: false,
      details: false,
      photos: false,
    };
    const firstOption = restoreOptions[0]?.key;

    if (hasCatalogDescription) {
      nextSelection.description = true;
    } else if (firstOption) {
      nextSelection[firstOption] = true;
    }

    setRestoreSelection(nextSelection);
    setRestoreDialogError(null);
    setSaveError(null);
    setSuccessMessage(null);
    setIsRestoreDialogOpen(true);
  }

  async function saveChanges() {
    if (!profile || !draft || isSaving) return;

    if (!draft.displayName.trim()) {
      setSaveError("Add a breed name.");
      return;
    }

    if (draft.sellerDescription.length > buyerDescriptionMaxLength) {
      setSaveError(
        `Breed description must be ${buyerDescriptionMaxLength} characters or less.`,
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

  async function restoreCatalogDefaults(selection: RestoreCatalogSelection) {
    if (!profile || !draft || !catalogBreed || isRestoringCatalogDefaults) {
      return;
    }

    const shouldRestoreDescription = selection.description && hasCatalogDescription;
    const shouldRestoreDetails = selection.details && hasCatalogDetails;
    const shouldRestorePhotos = selection.photos && hasCatalogPhoto;

    if (
      !shouldRestoreDescription &&
      !shouldRestoreDetails &&
      !shouldRestorePhotos
    ) {
      return;
    }

    setIsRestoringCatalogDefaults(true);
    setRestoreDialogError(null);
    setSaveError(null);
    setSuccessMessage(null);

    const restoredDescription = shouldRestoreDescription
      ? catalogBreed.description?.trim() ?? ""
      : profile.seller_description ?? "";
    const restoredBirdType = shouldRestoreDetails
      ? catalogBreed.bird_type ?? null
      : profile.bird_type ?? null;
    const restoredEggColor = shouldRestoreDetails
      ? catalogBreed.egg_color ?? null
      : profile.egg_color ?? null;
    const restoredAnnualEggProduction = shouldRestoreDetails
      ? catalogBreed.annual_egg_production ?? null
      : profile.annual_egg_production ?? null;

    if (shouldRestoreDescription || shouldRestoreDetails) {
      const { error } = await supabase.rpc("seller_upsert_breed_profile", {
        p_breed_id: profile.breed_id,
        p_custom_breed_name: profile.custom_breed_name,
        p_display_name: profile.display_name,
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
        setRestoreDialogError(error.message);
        setIsRestoringCatalogDefaults(false);
        return;
      }
    }

    if (shouldRestoreDetails) {
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
        setRestoreDialogError(metadataError.message);
        setReloadKey((current) => current + 1);
        setIsRestoringCatalogDefaults(false);
        return;
      }
    }

    if (shouldRestorePhotos) {
      const photoResult = await restoreCatalogPhoto();

      if (!photoResult.ok) {
        setSaveError(photoResult.message);
        setRestoreDialogError(photoResult.message);
        setReloadKey((current) => current + 1);
        setIsRestoringCatalogDefaults(false);
        return;
      }
    }

    setDraft((current) => {
      if (!current) return current;

      return {
        ...current,
        annualEggProduction: shouldRestoreDetails
          ? restoredAnnualEggProduction ?? ""
          : current.annualEggProduction,
        birdType: shouldRestoreDetails ? restoredBirdType ?? "" : current.birdType,
        eggColor: shouldRestoreDetails ? restoredEggColor ?? "" : current.eggColor,
        sellerDescription: shouldRestoreDescription
          ? restoredDescription
          : current.sellerDescription,
      };
    });
    setSuccessMessage("Selected catalog defaults restored.");
    setIsRestoreDialogOpen(false);
    setIsRestoringCatalogDefaults(false);
    setReloadKey((current) => current + 1);
  }

  async function restoreCatalogPhoto() {
    if (!profile || !catalogBreed || !defaultPhotoUrl) {
      return {
        ok: false,
        message: "This breed does not have a default catalog photo.",
      };
    }

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    if (sessionError || !accessToken) {
      return {
        ok: false,
        message: "Please sign in again and try restoring the catalog photo.",
      };
    }

    const { data, error } =
      await supabase.functions.invoke<RestoreDefaultPhotoResponse>(
        "seller-restore-catalog-breed-photo",
        {
          body: {
            replace_existing: true,
            seller_breed_profile_id: profile.id,
          },
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

    if (error || data?.error) {
      const functionError = await readRestoreDefaultPhotoError(error);

      return {
        ok: false,
        message:
          data?.error?.message ??
          functionError?.message ??
          "Default photo could not be restored. Please try again.",
      };
    }

    return {
      ok: true,
      message: data?.message ?? "Default photo restored.",
    };
  }

  function updateRestoreSelection(key: RestoreOptionKey, value: boolean) {
    setRestoreSelection((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function closeRestoreDialog() {
    if (isRestoringCatalogDefaults) return;

    setRestoreDialogError(null);
    setIsRestoreDialogOpen(false);
  }

  async function submitRestoreDialog() {
    if (!hasSelectedRestoreOption) return;

    await restoreCatalogDefaults(restoreSelection);
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
        description="Manage this breed's storefront presentation."
        action={
          <Link className="seller-secondary-button" href="/dashboard/breeds">
            Back to Breeds
          </Link>
        }
      />

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-5 sm:px-7">
        {successMessage ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
            {successMessage}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)] xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,0.9fr)]">
          <div className="order-1 grid content-start gap-4 lg:col-start-1 lg:row-start-1">
            {mediaError ? (
              <SellerCard className="p-5">
                <SectionHeading
                  glyph="/glyphs/camera.png"
                  title="Breed Photos"
                />
                <p className="mt-2 text-sm leading-5 text-stone-500">
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
          </div>

          <SellerCard className="order-2 p-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <SectionHeading glyph="/glyphs/egg.png" title="Breed Details" />
                <StatusBadge status={speciesName} />
              </div>
              {catalogBreed ? (
                <button
                  className="seller-small-button"
                  disabled={isRestoringCatalogDefaults || !hasRestoreOptions}
                  onClick={openRestoreDialog}
                  type="button"
                >
                  {isRestoringCatalogDefaults
                    ? "Restoring"
                    : "Restore Catalog Defaults"}
                </button>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3">
              <div className="grid gap-1 text-sm font-semibold text-stone-700">
                Species
                <div className="inline-flex min-h-9 w-fit items-center rounded-full border border-emerald-100 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900">
                  {speciesName}
                </div>
              </div>

              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Breed name
                <input
                  className="seller-form-field min-h-10 py-1.5"
                  value={draft.displayName}
                  onChange={(event) =>
                    updateDraft({ displayName: event.target.value })
                  }
                />
              </label>

              {isChickenBreed ? (
                <>
                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Purpose
                    <select
                      className="seller-form-field min-h-10 py-1.5"
                      value={draft.birdType}
                      onChange={(event) =>
                        updateDraft({ birdType: event.target.value })
                      }
                    >
                      <option value="">Choose purpose</option>
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
                      className="seller-form-field min-h-10 py-1.5"
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

                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Annual egg production
                    <select
                      className="seller-form-field min-h-10 py-1.5"
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

              <div className="pt-1">
                <button
                  className="seller-primary-button w-full"
                  disabled={isSaving}
                  onClick={() => void saveChanges()}
                  type="button"
                >
                  {isSaving ? "Saving" : "Save Changes"}
                </button>
              </div>

              {saveError ? (
                <ErrorState title="Breed was not saved" message={saveError} />
              ) : null}
            </div>
          </SellerCard>

          <SellerCard className="order-3 p-5 lg:col-start-1 lg:row-start-2">
            <SectionHeading
              glyph="/glyphs/pencil.png"
              title="Breed Description"
            />
            <p className="mt-2 text-sm leading-5 text-stone-500">
              Write the storefront copy buyers see for this breed.
            </p>

            <label className="mt-4 grid gap-1 text-sm font-semibold text-stone-700">
              <span className="sr-only">Breed Description</span>
              <textarea
                className="seller-form-field min-h-44 resize-y py-3"
                maxLength={buyerDescriptionMaxLength}
                value={draft.sellerDescription}
                onChange={(event) =>
                  updateDraft({ sellerDescription: event.target.value })
                }
              />
            </label>
          </SellerCard>
        </div>

        <SellerCard className="border-red-200 bg-red-50/40 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <SectionHeading
                glyph="/glyphs/trashcan.png"
                title="Remove Breed"
                tone="danger"
              />
              <p className="mt-2 text-sm leading-5 text-stone-600">
                Remove this breed from your active breed library. You can add it
                again later from the breed library.
              </p>
            </div>
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

      {isRestoreDialogOpen ? (
        <RestoreCatalogDefaultsDialog
          canSubmit={hasSelectedRestoreOption}
          errorMessage={restoreDialogError}
          isSubmitting={isRestoringCatalogDefaults}
          options={restoreOptions}
          selection={restoreSelection}
          onCancel={closeRestoreDialog}
          onChange={updateRestoreSelection}
          onSubmit={() => void submitRestoreDialog()}
        />
      ) : null}
    </>
  );
}

function RestoreCatalogDefaultsDialog({
  canSubmit,
  errorMessage,
  isSubmitting,
  onCancel,
  onChange,
  onSubmit,
  options,
  selection,
}: {
  canSubmit: boolean;
  errorMessage: string | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onChange: (key: RestoreOptionKey, value: boolean) => void;
  onSubmit: () => void;
  options: RestoreCatalogOption[];
  selection: RestoreCatalogSelection;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);
  const titleId = "restore-catalog-defaults-title";
  const descriptionId = "restore-catalog-defaults-description";

  useEffect(() => {
    previousFocusedElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const cancelButton =
      dialogRef.current?.querySelector<HTMLButtonElement>(
        "[data-dialog-cancel]",
      );
    cancelButton?.focus();

    return () => {
      previousFocusedElementRef.current?.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key !== "Tab") return;

    const focusableElements = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/60 px-3 py-4 sm:items-center"
      onKeyDown={handleKeyDown}
    >
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-lg rounded-lg bg-white shadow-xl"
        ref={dialogRef}
        role="dialog"
      >
        <div className="border-b border-stone-200 px-5 py-4">
          <h2 className="text-lg font-bold text-stone-950" id={titleId}>
            Restore Catalog Defaults
          </h2>
          <p className="mt-1 text-sm text-stone-600" id={descriptionId}>
            What would you like to restore?
          </p>
        </div>

        <div className="grid gap-4 px-5 py-4">
          <div className="grid gap-2">
            {options.map((option) => (
              <label
                className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm font-semibold text-stone-800"
                key={option.key}
              >
                <input
                  checked={selection[option.key]}
                  className="size-4 accent-emerald-800"
                  disabled={isSubmitting}
                  type="checkbox"
                  onChange={(event) =>
                    onChange(option.key, event.target.checked)
                  }
                />
                {option.label}
              </label>
            ))}
          </div>

          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-900">
            Selected catalog information will replace the customized information
            for this breed and related listings that use it. Inventory
            quantities, pricing, and orders will not be changed.
          </p>

          {errorMessage ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold leading-5 text-red-700">
              {errorMessage}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-stone-200 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            className="seller-secondary-button"
            data-dialog-cancel
            disabled={isSubmitting}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="seller-primary-button"
            disabled={!canSubmit || isSubmitting}
            onClick={onSubmit}
            type="button"
          >
            {isSubmitting ? "Restoring" : "Restore Selected"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({
  compact = false,
  glyph,
  title,
  tone = "default",
}: {
  compact?: boolean;
  glyph: string;
  title: string;
  tone?: "default" | "danger";
}) {
  const chipClass =
    tone === "danger"
      ? "bg-red-100 ring-red-200"
      : "bg-emerald-900/10 ring-emerald-900/10";
  const titleClass =
    tone === "danger" ? "text-red-700" : "text-emerald-950";
  const sizeClass = compact ? "size-7" : "size-8";
  const imageSize = compact ? 15 : 17;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-full ring-1 ${chipClass}`}
      >
        <Image src={glyph} alt="" width={imageSize} height={imageSize} />
      </span>
      <h2 className={`text-base font-bold tracking-normal ${titleClass}`}>
        {title}
      </h2>
    </div>
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
