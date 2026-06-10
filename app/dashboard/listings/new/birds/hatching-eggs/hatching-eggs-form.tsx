"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { restoreCatalogDefaultPhotoBestEffort } from "../../../../breeds/breed-data";
import { useSellerContext } from "../../../../_components/seller-context";
import {
  ErrorState,
  LoadingState,
  SellerCard,
  SellerPageHeader,
} from "../../../../_components/seller-ui";
import type {
  ReferenceBreed,
  ReferenceBreedAlias,
  ReferenceSpecies,
  SellerBreedProfileOption,
  SellerInventoryManagementRow,
} from "../../../../_lib/seller-types";
import { BreedCombobox } from "../../_components/breed-combobox";
import {
  CustomBreedDialog,
  type CustomBreedDraft,
} from "../../_components/custom-breed-dialog";
import {
  buildMediaSummary,
  buildReadinessListing,
  CreationStepIndicator,
  formatCurrency,
  formatDate,
  isPositiveWholeNumber,
  isValidMoney,
  listingInventorySelect,
  ListingCreationPhotosStep,
  type ListingPhotoItem,
  MoneyInput,
  sellerMediaSelect,
  ValidationMessage,
} from "../../_components/creation-wizard-shared";
import { buildPublishReadinessReport } from "../../../[listingBatchId]/publish-readiness";
import { PublishReadinessReview } from "../../../[listingBatchId]/publish-readiness-review";

type BreedChoice = {
  value: string;
  label: string;
  aliases?: string[];
  kind: "profile" | "breed";
  profileId?: string;
  breedId?: string;
};

type HatchingEggFormState = {
  speciesId: string;
  breedChoice: string;
  availableDate: string;
  quantity: string;
  pricePerEgg: string;
  minimumOrderQuantity: string;
  description: string;
};

type CreateListingBatchResult = {
  listing_batch_id: string;
};

type CustomBreedProfileResult = {
  annual_egg_production: string | null;
  bird_type: string | null;
  breed_id: string | null;
  custom_breed_name: string | null;
  display_name: string;
  egg_color: string | null;
  seller_breed_profile_id: string;
  seller_description: string | null;
  seller_notes: string | null;
  species_id: string;
  visibility_status: string;
};

const emptyForm: HatchingEggFormState = {
  speciesId: "",
  breedChoice: "",
  availableDate: "",
  quantity: "",
  pricePerEgg: "",
  minimumOrderQuantity: "",
  description: "",
};

const publicDescriptionMaxLength = 1000;
const steps = [
  { label: "Details", value: "details" as const },
  { label: "Photos", value: "photos" as const },
  { label: "Review", value: "review" as const },
];

export function HatchingEggsForm() {
  const { seller } = useSellerContext();
  const router = useRouter();
  const storeId = seller?.store_id ?? "";
  const [species, setSpecies] = useState<ReferenceSpecies[]>([]);
  const [breeds, setBreeds] = useState<ReferenceBreed[]>([]);
  const [breedAliases, setBreedAliases] = useState<ReferenceBreedAlias[]>([]);
  const [sellerProfiles, setSellerProfiles] = useState<
    SellerBreedProfileOption[]
  >([]);
  const [breedAliasError, setBreedAliasError] = useState<string | null>(null);
  const [form, setForm] = useState<HatchingEggFormState>(emptyForm);
  const [step, setStep] = useState<"details" | "photos" | "review">("details");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saveDraftError, setSaveDraftError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isPreparingDraft, setIsPreparingDraft] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCustomBreedDialogOpen, setIsCustomBreedDialogOpen] = useState(false);
  const [customBreedInitialName, setCustomBreedInitialName] = useState("");
  const [customBreedError, setCustomBreedError] = useState<string | null>(null);
  const [isSavingCustomBreed, setIsSavingCustomBreed] = useState(false);
  const [listingBatchId, setListingBatchId] = useState("");
  const [sellerBreedProfileId, setSellerBreedProfileId] = useState("");
  const [draftRows, setDraftRows] = useState<SellerInventoryManagementRow[]>([]);
  const [mediaItems, setMediaItems] = useState<ListingPhotoItem[]>([]);

  useEffect(() => {
    if (!storeId || !seller?.hatching_eggs_enabled) return;

    let isMounted = true;

    async function loadReferenceData() {
      setIsLoading(true);
      setError(null);

      const [speciesResult, breedResult, aliasResult, profileResult] =
        await Promise.all([
          supabase
            .from("species")
            .select("id, common_name, slug, sort_order")
            .eq("is_active", true)
            .order("sort_order", { ascending: true })
            .order("common_name", { ascending: true }),
          supabase
            .from("breeds")
            .select("id, species_id, breed_name, breed_slug, sort_order")
            .eq("is_active", true)
            .order("sort_order", { ascending: true })
            .order("breed_name", { ascending: true }),
          supabase.from("breed_aliases").select("breed_id, alias"),
          supabase
            .from("seller_breed_profiles")
            .select(
              "id, species_id, breed_id, custom_breed_name, display_name, seller_description, seller_notes, visibility_status, bird_type, egg_color, annual_egg_production",
            )
            .eq("store_id", storeId)
            .eq("visibility_status", "active")
            .eq("moderation_status", "normal")
            .order("display_name", { ascending: true }),
        ]);

      if (!isMounted) return;

      const loadError =
        speciesResult.error ?? breedResult.error ?? profileResult.error;

      if (loadError) {
        setError(loadError.message);
        setIsLoading(false);
        return;
      }

      const loadedSpecies = (speciesResult.data ?? []) as ReferenceSpecies[];
      const defaultSpecies =
        loadedSpecies.find((item) => item.slug === "chicken") ??
        loadedSpecies[0] ??
        null;

      setSpecies(loadedSpecies);
      setBreeds((breedResult.data ?? []) as ReferenceBreed[]);
      setSellerProfiles((profileResult.data ?? []) as SellerBreedProfileOption[]);

      if (aliasResult.error) {
        setBreedAliasError(aliasResult.error.message);
        setBreedAliases([]);
      } else {
        setBreedAliasError(null);
        setBreedAliases((aliasResult.data ?? []) as ReferenceBreedAlias[]);
      }

      setForm((current) => ({
        ...current,
        speciesId: current.speciesId || defaultSpecies?.id || "",
      }));
      setIsLoading(false);
    }

    loadReferenceData();

    return () => {
      isMounted = false;
    };
  }, [seller?.hatching_eggs_enabled, storeId]);

  const breedChoices = useMemo(
    () => buildBreedChoices(form.speciesId, breeds, sellerProfiles, breedAliases),
    [breedAliases, breeds, form.speciesId, sellerProfiles],
  );
  const selectedBreedChoice = breedChoices.find(
    (choice) => choice.value === form.breedChoice,
  );
  const selectedSpecies = species.find((item) => item.id === form.speciesId);
  const combinedDescription = buildPublicDescription(form);
  const readinessListing = buildReadinessListing({
    publicDescription: combinedDescription,
    rows: draftRows.length
      ? draftRows
      : buildWorkflowRows({
          form,
          selectedBreedChoice,
          selectedSpecies,
          sellerBreedProfileId,
          storeId,
        }),
  });
  const readinessReport =
    readinessListing && seller
      ? buildPublishReadinessReport({
          listing: readinessListing,
          media: buildMediaSummary(mediaItems),
          seller,
        })
      : null;

  function updateForm(updates: Partial<HatchingEggFormState>) {
    setForm((current) => ({ ...current, ...updates }));
    setValidationErrors([]);
    setDraftError(null);
  }

  function openCustomBreedDialog(query: string) {
    setCustomBreedInitialName(query);
    setCustomBreedError(null);
    setIsCustomBreedDialogOpen(true);
  }

  async function saveCustomBreed(draft: CustomBreedDraft) {
    if (!seller || !selectedSpecies) {
      setCustomBreedError("Seller or species information is missing. Refresh and try again.");
      return;
    }

    const isChicken = selectedSpecies.slug === "chicken";

    setIsSavingCustomBreed(true);
    setCustomBreedError(null);

    const { data, error: saveError } = await supabase.rpc(
      "seller_upsert_breed_profile",
      {
        p_annual_egg_production: isChicken
          ? draft.annualEggProduction
          : null,
        p_bird_type: isChicken ? draft.birdType : null,
        p_breed_id: null,
        p_custom_breed_name: draft.name,
        p_display_name: draft.name,
        p_egg_color: isChicken ? draft.eggColor : null,
        p_seller_breed_profile_id: null,
        p_seller_description: draft.description,
        p_seller_notes: null,
        p_species_id: selectedSpecies.id,
        p_store_id: seller.store_id,
        p_visibility_status: "active",
      },
    );

    if (saveError) {
      setCustomBreedError(saveError.message);
      setIsSavingCustomBreed(false);
      return;
    }

    const rows = Array.isArray(data)
      ? (data as CustomBreedProfileResult[])
      : [];
    const profile = rows[0];

    if (!profile?.seller_breed_profile_id) {
      setCustomBreedError("The breed was saved, but it could not be selected.");
      setIsSavingCustomBreed(false);
      return;
    }

    const nextProfile = buildSellerBreedProfileOption(profile);
    const nextValue = `profile:${nextProfile.id}`;

    setSellerProfiles((current) => upsertSellerProfileOption(current, nextProfile));
    setForm((current) => ({
      ...current,
      breedChoice: nextValue,
      description: current.description || nextProfile.seller_description || "",
    }));
    setSellerBreedProfileId(nextProfile.id);
    setDraftRows([]);
    setMediaItems([]);
    setValidationErrors([]);
    setDraftError(null);
    setSaveDraftError(null);
    setPublishError(null);
    setIsSavingCustomBreed(false);
    setIsCustomBreedDialogOpen(false);
  }

  async function handleContinueToPhotos() {
    const errors = validateHatchingEggForm(form, combinedDescription);
    setValidationErrors(errors);
    setDraftError(null);

    if (errors.length > 0) return;

    setIsPreparingDraft(true);
    const preparedListingBatchId = await prepareDraft((message) => {
      setDraftError(message);
    });
    setIsPreparingDraft(false);

    if (!preparedListingBatchId) return;

    setStep("photos");
  }

  async function handleSaveDraft() {
    setSaveDraftError(null);
    setIsSavingDraft(true);
    const preparedListingBatchId = await prepareDraft((message) => {
      setSaveDraftError(message);
    });
    setIsSavingDraft(false);

    if (!preparedListingBatchId) return;

    window.sessionStorage.setItem(
      "flipflocks:listings:flash",
      "Hatching egg listing saved as a draft.",
    );
    router.push(`/dashboard/listings/${preparedListingBatchId}`);
  }

  async function handlePublish() {
    setPublishError(null);
    setIsPublishing(true);
    const preparedListingBatchId = await prepareDraft((message) => {
      setPublishError(message);
    });

    if (!preparedListingBatchId) {
      setIsPublishing(false);
      return;
    }

    const { error: visibilityError } = await supabase.rpc(
      "seller_set_listing_batch_visibility",
      {
        p_listing_batch_id: preparedListingBatchId,
        p_visibility_status: "active",
        p_note: "Published hatching egg listing from creation wizard.",
      },
    );

    setIsPublishing(false);

    if (visibilityError) {
      setPublishError("The hatching egg listing was not published. Please try again.");
      return;
    }

    window.sessionStorage.setItem(
      "flipflocks:listings:flash",
      "Hatching egg listing published.",
    );
    router.push("/dashboard");
  }

  async function prepareDraft(onError: (message: string) => void) {
    if (!seller || !selectedBreedChoice) {
      onError("Choose the hatching egg details before continuing.");
      return null;
    }

    const errors = validateHatchingEggForm(form, combinedDescription);
    setValidationErrors(errors);

    if (errors.length > 0) return null;

    const preparedBreedProfileId = await upsertSellerBreedProfileForEggs({
      breedChoice: selectedBreedChoice,
      description: combinedDescription,
      sellerProfiles,
      speciesId: form.speciesId,
      storeId: seller.store_id,
    });

    if (!preparedBreedProfileId) {
      onError("The breed could not be prepared. Please try again.");
      return null;
    }

    setSellerBreedProfileId(preparedBreedProfileId);

    if (listingBatchId) {
      const updated = await updateExistingDraft({
        listingBatchId,
        onError,
        sellerBreedProfileId: preparedBreedProfileId,
      });

      if (!updated) return null;

      await loadBreedProfileMedia(preparedBreedProfileId);
      return listingBatchId;
    }

    const createResult = await supabase.rpc(
      "seller_create_listing_batch_with_inventory",
      {
        p_store_id: seller.store_id,
        p_species_id: form.speciesId,
        p_batch_type: "hatching_eggs",
        p_origin_date: form.availableDate,
        p_available_date: form.availableDate,
        p_base_price: Number(form.pricePerEgg),
        p_breed_groups: [
          {
            seller_breed_profile_id: preparedBreedProfileId,
            sort_order: 0,
            visibility_status: "active",
            inventory_items: [
              {
                inventory_type: "hatching_eggs",
                custom_inventory_label: null,
                quantity_available: Number(form.quantity),
                price_override: null,
                sort_order: 0,
                visibility_status: "active",
              },
            ],
          },
        ],
        p_auto_price_increase_enabled: false,
        p_auto_price_increase_amount: null,
        p_auto_price_increase_max_price: null,
        p_internal_batch_label: null,
        p_seller_notes: null,
        p_visibility_status: "hidden",
      },
    );

    if (createResult.error) {
      onError(createResult.error.message);
      return null;
    }

    const rows = Array.isArray(createResult.data)
      ? (createResult.data as CreateListingBatchResult[])
      : [];
    const createdListingBatchId = rows[0]?.listing_batch_id;

    if (!createdListingBatchId) {
      onError("The hatching egg listing could not be saved. Please try again.");
      return null;
    }

    setListingBatchId(createdListingBatchId);
    await loadDraftRows(createdListingBatchId);
    await loadBreedProfileMedia(preparedBreedProfileId);
    return createdListingBatchId;
  }

  async function updateExistingDraft({
    listingBatchId,
    onError,
    sellerBreedProfileId,
  }: {
    listingBatchId: string;
    onError: (message: string) => void;
    sellerBreedProfileId: string;
  }) {
    const batchResult = await supabase.rpc("seller_update_listing_batch", {
      p_listing_batch_id: listingBatchId,
      p_origin_date: form.availableDate,
      p_available_date: form.availableDate,
      p_base_price: Number(form.pricePerEgg),
      p_auto_price_increase_enabled: false,
      p_auto_price_increase_amount: null,
      p_auto_price_increase_max_price: null,
      p_internal_batch_label: null,
      p_seller_notes: null,
    });

    if (batchResult.error) {
      onError(batchResult.error.message);
      return false;
    }

    const row = draftRows[0];

    if (row) {
      const inventoryResult = await supabase.rpc("seller_update_inventory_item", {
        p_inventory_item_id: row.inventory_item_id,
        p_inventory_type: "hatching_eggs",
        p_custom_inventory_label: null,
        p_price_override: null,
        p_sort_order: 0,
        p_seller_notes: null,
      });

      if (inventoryResult.error) {
        onError(inventoryResult.error.message);
        return false;
      }

      const quantityResult = await supabase.rpc("seller_adjust_inventory_quantity", {
        p_inventory_item_id: row.inventory_item_id,
        p_quantity_available: Number(form.quantity),
        p_quantity_delta: null,
        p_note: "Updated from hatching egg listing creation wizard.",
      });

      if (quantityResult.error) {
        onError(quantityResult.error.message);
        return false;
      }
    }

    setSellerBreedProfileId(sellerBreedProfileId);
    await loadDraftRows(listingBatchId);
    return true;
  }

  const loadDraftRows = useCallback(
    async (currentListingBatchId: string) => {
      if (!storeId) return;

      const listingResult = await supabase
        .from("seller_inventory_management")
        .select(listingInventorySelect)
        .eq("store_id", storeId)
        .eq("listing_batch_id", currentListingBatchId)
        .order("listing_batch_breed_sort_order", { ascending: true })
        .order("inventory_item_sort_order", { ascending: true })
        .returns<SellerInventoryManagementRow[]>();

      if (listingResult.error) {
        setDraftError(listingResult.error.message);
        return;
      }

      setDraftRows(listingResult.data ?? []);
    },
    [storeId],
  );

  const loadBreedProfileMedia = useCallback(
    async (currentSellerBreedProfileId: string) => {
      if (!storeId) return;

      const mediaResult = await supabase
        .from("seller_media_management")
        .select(sellerMediaSelect)
        .eq("store_id", storeId)
        .eq("entity_type", "seller_breed_profile")
        .eq("entity_id", currentSellerBreedProfileId)
        .returns<ListingPhotoItem[]>();

      if (mediaResult.error) {
        setDraftError(mediaResult.error.message);
        return;
      }

      setMediaItems(mediaResult.data ?? []);
    },
    [storeId],
  );

  if (!storeId) {
    return (
      <>
        <SellerPageHeader
          title="Hatching Eggs"
          description="Create hatching egg inventory for local pickup."
        />
        <main className="mx-auto w-full max-w-3xl px-5 py-5 sm:px-7">
          <EmptyCard
            title="Store setup is still loading"
            description="Refresh the page if this does not clear in a moment."
          />
        </main>
      </>
    );
  }

  if (!seller?.hatching_eggs_enabled) {
    return (
      <>
        <SellerPageHeader
          title="Hatching Eggs"
          description="Create hatching egg inventory for local pickup."
        />
        <main className="mx-auto w-full max-w-3xl px-5 py-5 sm:px-7">
          <SellerCard className="p-5">
            <h2 className="text-lg font-semibold text-stone-950">
              Hatching Eggs is turned off for this store.
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Turn it on in Store Admin when you want to create new hatching
              egg listings.
            </p>
            <div className="mt-5">
              <Link
                className="seller-secondary-button"
                href="/dashboard/store-admin"
              >
                Go to Store Admin
              </Link>
            </div>
          </SellerCard>
        </main>
      </>
    );
  }

  return (
    <>
      <SellerPageHeader
        title="Hatching Eggs"
        description="Create hatching egg inventory by breed, available date, quantity, and price per egg."
        action={
          <Link
            className="seller-secondary-button"
            href="/dashboard/listings/new/birds"
          >
            Back to Bird Options
          </Link>
        }
      />

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5 sm:px-7">
        <CreationStepIndicator step={step} steps={steps} />

        {isLoading ? <LoadingState label="Loading hatching egg form" /> : null}

        {error ? (
          <ErrorState
            title="Hatching egg form could not load"
            message="Refresh the page and try again."
          />
        ) : null}

        {!isLoading && !error ? (
          <>
            {step === "details" ? (
              <SellerCard className="p-5">
                <div>
                  <h2 className="text-lg font-semibold text-stone-950">
                    Hatching Egg Details
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-stone-600">
                    Hatching eggs are local pickup only in this version.
                  </p>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Species
                    <select
                      className="seller-form-field"
                      value={form.speciesId}
                      onChange={(event) =>
                        updateForm({
                          breedChoice: "",
                          speciesId: event.target.value,
                        })
                      }
                    >
                      {species.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.common_name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Breed
                    <BreedCombobox
                      aliasSearchError={breedAliasError}
                      choices={breedChoices}
                      recentChoices={[]}
                      value={form.breedChoice}
                      onAddCustomBreed={openCustomBreedDialog}
                      onChange={(value) => updateForm({ breedChoice: value })}
                    />
                  </label>

                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Available Date
                    <input
                      className="seller-form-field"
                      type="date"
                      value={form.availableDate}
                      onChange={(event) =>
                        updateForm({ availableDate: event.target.value })
                      }
                    />
                  </label>

                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Quantity Available
                    <input
                      className="seller-form-field"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      type="number"
                      value={form.quantity}
                      onChange={(event) =>
                        updateForm({ quantity: event.target.value })
                      }
                    />
                  </label>

                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Price per Egg
                    <MoneyInput
                      value={form.pricePerEgg}
                      onChange={(value) => updateForm({ pricePerEgg: value })}
                    />
                  </label>

                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Minimum Order Quantity
                    <input
                      className="seller-form-field"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      type="number"
                      value={form.minimumOrderQuantity}
                      onChange={(event) =>
                        updateForm({ minimumOrderQuantity: event.target.value })
                      }
                    />
                    <span className="text-xs font-normal leading-5 text-stone-500">
                      Optional. Buyers will see this in the description.
                    </span>
                  </label>

                  <label className="grid gap-1 text-sm font-semibold text-stone-700 md:col-span-2">
                    Description
                    <textarea
                      className="seller-form-field min-h-32 resize-y py-3"
                      maxLength={publicDescriptionMaxLength}
                      value={form.description}
                      onChange={(event) =>
                        updateForm({ description: event.target.value })
                      }
                    />
                    <span className="text-xs font-normal leading-5 text-stone-500">
                      Optional. Add collection timing, fertility notes, or pickup details buyers should know.
                    </span>
                  </label>
                </div>

                {validationErrors.length > 0 ? (
                  <ValidationMessage errors={validationErrors} />
                ) : null}

                {draftError ? (
                  <div className="mt-5">
                    <ErrorState
                      title="Hatching egg listing was not saved"
                      message={draftError}
                    />
                  </div>
                ) : null}

                <HatchingEggPreview
                  breedName={selectedBreedChoice?.label ?? "Selected breed"}
                  description={combinedDescription}
                  form={form}
                  speciesName={selectedSpecies?.common_name ?? "Selected species"}
                />

                <div className="mt-5 flex flex-col gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <Link
                    className="seller-secondary-button"
                    href="/dashboard/listings/new/birds"
                  >
                    Back
                  </Link>
                  <button
                    className="inline-flex min-h-11 items-center justify-center rounded-md bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-wait disabled:opacity-70"
                    disabled={isPreparingDraft}
                    onClick={handleContinueToPhotos}
                    type="button"
                  >
                    {isPreparingDraft ? "Saving" : "Continue to Photos"}
                  </button>
                </div>
              </SellerCard>
            ) : null}

            {step === "photos" ? (
              <SellerCard className="p-5">
                <ListingCreationPhotosStep
                  canManage={Boolean(sellerBreedProfileId && listingBatchId)}
                  description="Add photos buyers should see with this hatching egg listing."
                  emptyDescription="No hatching egg photos have been added yet."
                  entityId={sellerBreedProfileId}
                  entityType="seller_breed_profile"
                  listingBatchId={listingBatchId}
                  mediaItems={mediaItems}
                  storeId={storeId}
                  title="Hatching Egg Photos"
                  onBack={() => setStep("details")}
                  onContinue={() => setStep("review")}
                  onReload={() => {
                    if (sellerBreedProfileId) {
                      loadBreedProfileMedia(sellerBreedProfileId);
                    }
                  }}
                />
              </SellerCard>
            ) : null}

            {step === "review" ? (
              <div className="grid gap-5">
                <HatchingEggPreview
                  breedName={selectedBreedChoice?.label ?? "Selected breed"}
                  description={combinedDescription}
                  form={form}
                  speciesName={selectedSpecies?.common_name ?? "Selected species"}
                />
                {readinessReport ? (
                  <PublishReadinessReview
                    isPublishing={isPublishing}
                    isSavingDraft={isSavingDraft}
                    publishError={publishError}
                    report={readinessReport}
                    saveDraftError={saveDraftError}
                    onPublish={handlePublish}
                    onSaveDraft={handleSaveDraft}
                  />
                ) : (
                  <EmptyCard
                    title="Review is not ready yet"
                    description="Go back and complete the hatching egg details before publishing."
                  />
                )}
                <div>
                  <button
                    className="seller-secondary-button"
                    type="button"
                    onClick={() => setStep("photos")}
                  >
                    Back to Photos
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </main>

      {isCustomBreedDialogOpen && selectedSpecies ? (
        <CustomBreedDialog
          duplicateNames={breedChoices.map((choice) => choice.label)}
          error={customBreedError}
          initialName={customBreedInitialName}
          isChicken={selectedSpecies.slug === "chicken"}
          isSaving={isSavingCustomBreed}
          speciesName={selectedSpecies.common_name}
          onClose={() => {
            if (isSavingCustomBreed) return;
            setIsCustomBreedDialogOpen(false);
            setCustomBreedError(null);
          }}
          onSave={saveCustomBreed}
        />
      ) : null}
    </>
  );
}

function HatchingEggPreview({
  breedName,
  description,
  form,
  speciesName,
}: {
  breedName: string;
  description: string;
  form: HatchingEggFormState;
  speciesName: string;
}) {
  return (
    <section className="mt-5 rounded-lg border border-stone-200 bg-stone-50 p-5">
      <p className="text-sm font-semibold uppercase tracking-[0.08em] text-emerald-800">
        Buyer Preview
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-stone-950">
        {breedName} Hatching Eggs
      </h2>
      <p className="mt-2 text-sm font-semibold text-stone-600">
        {speciesName}
      </p>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <PreviewItem label="Available Date" value={formatDate(form.availableDate)} />
        <PreviewItem
          label="Quantity Available"
          value={form.quantity || "Quantity not set"}
        />
        <PreviewItem
          label="Price per Egg"
          value={
            isValidMoney(form.pricePerEgg)
              ? formatCurrency(form.pricePerEgg)
              : "Price not set"
          }
        />
        <PreviewItem label="Pickup" value="Local pickup only" />
      </dl>
      {description.trim() ? (
        <div className="mt-4 rounded-lg border border-stone-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-stone-950">Description</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-700">
            {description.trim()}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function PreviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-stone-600">{label}</dt>
      <dd className="mt-1 font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

function EmptyCard({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <SellerCard className="p-5">
      <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
    </SellerCard>
  );
}

function validateHatchingEggForm(
  form: HatchingEggFormState,
  combinedDescription: string,
) {
  const errors: string[] = [];

  if (!form.speciesId) errors.push("Choose a species.");
  if (!form.breedChoice) errors.push("Choose a breed.");
  if (!form.availableDate) errors.push("Add an available date.");
  if (!isPositiveWholeNumber(form.quantity)) {
    errors.push("Quantity available must be a whole number of 1 or more.");
  }
  if (!form.pricePerEgg.trim()) {
    errors.push("Add a price per egg.");
  } else if (!isValidMoney(form.pricePerEgg)) {
    errors.push("Use a valid price with no more than two decimal places.");
  }
  if (
    form.minimumOrderQuantity.trim() &&
    !isPositiveWholeNumber(form.minimumOrderQuantity)
  ) {
    errors.push("Minimum order quantity must be a whole number of 1 or more.");
  }
  if (combinedDescription.length > publicDescriptionMaxLength) {
    errors.push(
      `Description must be ${publicDescriptionMaxLength} characters or less, including the minimum order note.`,
    );
  }

  return errors;
}

function buildPublicDescription(form: HatchingEggFormState) {
  const parts: string[] = [];

  if (form.minimumOrderQuantity.trim()) {
    parts.push(`Minimum order: ${form.minimumOrderQuantity.trim()} eggs.`);
  }

  if (form.description.trim()) {
    parts.push(form.description.trim());
  }

  return parts.join("\n\n");
}

function buildBreedChoices(
  speciesId: string,
  breeds: ReferenceBreed[],
  sellerProfiles: SellerBreedProfileOption[],
  breedAliases: ReferenceBreedAlias[],
) {
  if (!speciesId) return [];

  const aliasesByBreedId = buildAliasesByBreedId(breedAliases);
  const profilesForSpecies = sellerProfiles.filter(
    (profile) => profile.species_id === speciesId,
  );
  const profiledBreedIds = new Set(
    profilesForSpecies
      .map((profile) => profile.breed_id)
      .filter((breedId): breedId is string => Boolean(breedId)),
  );
  const catalogBreeds = breeds.filter(
    (breed) =>
      breed.species_id === speciesId && !profiledBreedIds.has(breed.id),
  );

  return [
    ...profilesForSpecies.map((profile) => ({
      value: `profile:${profile.id}`,
      label: profile.display_name,
      aliases: profile.breed_id ? aliasesByBreedId.get(profile.breed_id) : [],
      kind: "profile" as const,
      profileId: profile.id,
    })),
    ...catalogBreeds.map((breed) => ({
      value: `breed:${breed.id}`,
      label: breed.breed_name,
      aliases: aliasesByBreedId.get(breed.id),
      kind: "breed" as const,
      breedId: breed.id,
    })),
  ];
}

function buildSellerBreedProfileOption(
  profile: CustomBreedProfileResult,
): SellerBreedProfileOption {
  return {
    annual_egg_production: profile.annual_egg_production,
    bird_type: profile.bird_type,
    breed_id: profile.breed_id,
    custom_breed_name: profile.custom_breed_name,
    display_name: profile.display_name,
    egg_color: profile.egg_color,
    id: profile.seller_breed_profile_id,
    seller_description: profile.seller_description,
    seller_notes: profile.seller_notes,
    species_id: profile.species_id,
    visibility_status: profile.visibility_status,
  };
}

function upsertSellerProfileOption(
  profiles: SellerBreedProfileOption[],
  nextProfile: SellerBreedProfileOption,
) {
  const existingIndex = profiles.findIndex(
    (profile) => profile.id === nextProfile.id,
  );

  if (existingIndex === -1) {
    return [...profiles, nextProfile].sort((first, second) =>
      first.display_name.localeCompare(second.display_name),
    );
  }

  return profiles.map((profile) =>
    profile.id === nextProfile.id ? nextProfile : profile,
  );
}

function buildAliasesByBreedId(breedAliases: ReferenceBreedAlias[]) {
  const aliasesByBreedId = new Map<string, string[]>();

  breedAliases.forEach((breedAlias) => {
    aliasesByBreedId.set(breedAlias.breed_id, [
      ...(aliasesByBreedId.get(breedAlias.breed_id) ?? []),
      breedAlias.alias,
    ]);
  });

  return aliasesByBreedId;
}

async function upsertSellerBreedProfileForEggs({
  breedChoice,
  description,
  sellerProfiles,
  speciesId,
  storeId,
}: {
  breedChoice: BreedChoice;
  description: string;
  sellerProfiles: SellerBreedProfileOption[];
  speciesId: string;
  storeId: string;
}) {
  const existingProfile =
    breedChoice.kind === "profile"
      ? sellerProfiles.find((profile) => profile.id === breedChoice.profileId)
      : null;

  if (breedChoice.kind === "profile" && !existingProfile) return null;
  if (breedChoice.kind === "breed" && !breedChoice.breedId) return null;

  const { data, error } = await supabase.rpc("seller_upsert_breed_profile", {
    p_store_id: storeId,
    p_species_id: speciesId,
    p_breed_id:
      breedChoice.kind === "profile"
        ? existingProfile?.breed_id ?? null
        : breedChoice.breedId,
    p_custom_breed_name:
      breedChoice.kind === "profile"
        ? existingProfile?.custom_breed_name ?? null
        : null,
    p_display_name: breedChoice.label,
    p_seller_description: description.trim() || null,
    p_seller_notes: existingProfile?.seller_notes ?? null,
    p_visibility_status: "active",
    p_seller_breed_profile_id:
      breedChoice.kind === "profile" ? breedChoice.profileId : null,
  });

  if (error) return null;

  const rows = Array.isArray(data)
    ? (data as { seller_breed_profile_id: string }[])
    : [];

  const profileId = rows[0]?.seller_breed_profile_id ?? null;

  if (
    profileId &&
    (breedChoice.kind === "breed" || Boolean(existingProfile?.breed_id))
  ) {
    const photoResult = await restoreCatalogDefaultPhotoBestEffort(profileId);

    if (!photoResult.ok) {
      console.warn("default breed photo was not added automatically", {
        breedId:
          breedChoice.kind === "breed"
            ? breedChoice.breedId
            : existingProfile?.breed_id,
        message: photoResult.message,
        sellerBreedProfileId: profileId,
      });
    }
  }

  return profileId;
}

function buildWorkflowRows({
  form,
  selectedBreedChoice,
  selectedSpecies,
  sellerBreedProfileId,
  storeId,
}: {
  form: HatchingEggFormState;
  selectedBreedChoice?: BreedChoice;
  selectedSpecies?: ReferenceSpecies;
  sellerBreedProfileId: string;
  storeId: string;
}): SellerInventoryManagementRow[] {
  if (
    !selectedBreedChoice ||
    !selectedSpecies ||
    !sellerBreedProfileId ||
    !form.availableDate ||
    !isPositiveWholeNumber(form.quantity) ||
    !isValidMoney(form.pricePerEgg)
  ) {
    return [];
  }

  return [
    {
      age_at_availability_days: null,
      auto_price_adjustment_enabled: false,
      auto_price_increase_amount: null,
      auto_price_increase_enabled: false,
      auto_price_increase_max_price: null,
      available_date: form.availableDate,
      base_price: Number(form.pricePerEgg),
      batch_type: "hatching_eggs",
      breed_display_name: selectedBreedChoice.label,
      custom_inventory_label: null,
      effective_unit_price: Number(form.pricePerEgg),
      internal_batch_label: null,
      inventory_item_id: "workflow-hatching-eggs-inventory",
      inventory_item_sort_order: 0,
      inventory_moderation_status: "normal",
      inventory_seller_notes: null,
      inventory_type: "hatching_eggs",
      inventory_updated_at: null,
      inventory_visibility_status: "active",
      listing_batch_breed_id: "workflow-hatching-eggs-breed",
      listing_batch_breed_moderation_status: "normal",
      listing_batch_breed_seller_notes: null,
      listing_batch_breed_sort_order: 0,
      listing_batch_breed_visibility_status: "active",
      listing_batch_id: "workflow-hatching-eggs",
      listing_batch_moderation_status: "normal",
      listing_batch_seller_notes: null,
      listing_batch_updated_at: null,
      listing_batch_visibility_status: "hidden",
      operational_availability_status: "available",
      origin_date: form.availableDate,
      price_adjustment_amount: null,
      price_adjustment_direction: null,
      price_adjustment_interval_weeks: null,
      price_adjustment_max_price: null,
      price_adjustment_min_price: null,
      price_override: null,
      quantity_available: Number(form.quantity),
      seller_breed_profile_id: sellerBreedProfileId,
      species_id: selectedSpecies.id,
      species_name: selectedSpecies.common_name,
      species_slug: selectedSpecies.slug,
      store_id: storeId,
    },
  ];
}
