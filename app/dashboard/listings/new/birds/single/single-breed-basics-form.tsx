"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
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
import {
  buildMediaSummary,
  buildReadinessListing,
  CreationStepIndicator,
  emptyPriceAdjustmentState,
  formatCurrency,
  formatInventoryType,
  formatPriceAdjustmentSummary,
  hydratePriceAdjustment,
  inventoryTypeOptions,
  isPositiveWholeNumber,
  isValidMoney,
  ListingCreationBuyerPreview,
  ListingCreationPhotosStep,
  listingInventorySelect,
  type CreationStep,
  type InventoryType,
  type ListingPhotoItem,
  type PriceAdjustmentState,
  MoneyInput,
  PriceAdjustmentFields,
  sellerMediaSelect,
  validatePriceAdjustment,
  ValidationMessage,
} from "../../_components/creation-wizard-shared";
import { BreedCombobox } from "../../_components/breed-combobox";
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

type FormState = {
  speciesId: string;
  breedChoice: string;
  hatchDate: string;
  availableDate: string;
  publicDescription: string;
  sellerNotes: string;
};

type InventoryState = {
  inventoryType: InventoryType | "";
  customLabel: string;
  quantity: string;
  price: string;
};

type CreateListingBatchResult = {
  listing_batch_id: string;
};

type RecentBreedUsage = {
  seller_breed_profile_id: string;
  inventory_updated_at: string | null;
  listing_batch_updated_at: string | null;
};

const emptyFormState: FormState = {
  speciesId: "",
  breedChoice: "",
  hatchDate: "",
  availableDate: "",
  publicDescription: "",
  sellerNotes: "",
};

const emptyInventoryState: InventoryState = {
  inventoryType: "",
  customLabel: "",
  quantity: "",
  price: "",
};

const publicDescriptionMaxLength = 1000;
const steps = [
  { label: "Details", value: "details" as const },
  { label: "Available Birds", value: "inventory" as const },
  { label: "Photos", value: "photos" as const },
  { label: "Review", value: "review" as const },
];

export function SimpleListingForm({
  draftListingBatchId,
}: {
  draftListingBatchId?: string;
}) {
  const { seller } = useSellerContext();
  const router = useRouter();
  const storeId = seller?.store_id ?? "";
  const [species, setSpecies] = useState<ReferenceSpecies[]>([]);
  const [breeds, setBreeds] = useState<ReferenceBreed[]>([]);
  const [breedAliases, setBreedAliases] = useState<ReferenceBreedAlias[]>([]);
  const [breedAliasError, setBreedAliasError] = useState<string | null>(null);
  const [recentBreedProfileIds, setRecentBreedProfileIds] = useState<string[]>([]);
  const [sellerProfiles, setSellerProfiles] = useState<
    SellerBreedProfileOption[]
  >([]);
  const [form, setForm] = useState<FormState>(emptyFormState);
  const [inventory, setInventory] =
    useState<InventoryState>(emptyInventoryState);
  const [priceAdjustment, setPriceAdjustment] =
    useState<PriceAdjustmentState>(emptyPriceAdjustmentState);
  const [step, setStep] = useState<CreationStep>("details");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isPreparingDraft, setIsPreparingDraft] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [listingBatchId, setListingBatchId] = useState(
    draftListingBatchId ?? "",
  );
  const [draftBreedChoice, setDraftBreedChoice] = useState("");
  const [draftRows, setDraftRows] = useState<SellerInventoryManagementRow[]>([]);
  const [mediaItems, setMediaItems] = useState<ListingPhotoItem[]>([]);

  useEffect(() => {
    if (!storeId) return;

    let isMounted = true;

    async function loadReferenceData() {
      setIsLoading(true);
      setError(null);

      const [
        speciesResult,
        breedResult,
        aliasResult,
        profileResult,
        recentBreedResult,
      ] = await Promise.all([
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
            "id, species_id, breed_id, custom_breed_name, display_name, seller_description, seller_notes, visibility_status",
          )
          .eq("store_id", storeId)
          .eq("visibility_status", "active")
          .eq("moderation_status", "normal")
          .order("display_name", { ascending: true }),
        supabase
          .from("seller_inventory_management")
          .select(
            "seller_breed_profile_id, inventory_updated_at, listing_batch_updated_at",
          )
          .eq("store_id", storeId)
          .order("listing_batch_updated_at", { ascending: false })
          .limit(50),
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
      setBreedAliases((aliasResult.data ?? []) as ReferenceBreedAlias[]);
      setBreedAliasError(aliasResult.error?.message ?? null);
      setRecentBreedProfileIds(
        buildRecentBreedProfileIds(
          (recentBreedResult.data ?? []) as RecentBreedUsage[],
        ),
      );
      setSellerProfiles(
        (profileResult.data ?? []) as SellerBreedProfileOption[],
      );
      setForm((current) => ({
        ...current,
        speciesId: current.speciesId || defaultSpecies?.id || "",
      }));
      setIsLoading(false);
    }

    void loadReferenceData();

    return () => {
      isMounted = false;
    };
  }, [storeId]);

  const breedChoices = useMemo(
    () => buildBreedChoices(form.speciesId, breeds, sellerProfiles, breedAliases),
    [breedAliases, breeds, form.speciesId, sellerProfiles],
  );
  const recentBreedChoices = useMemo(
    () => buildRecentBreedChoices(breedChoices, recentBreedProfileIds),
    [breedChoices, recentBreedProfileIds],
  );
  const selectedSpecies = species.find((item) => item.id === form.speciesId);
  const selectedBreedChoice = breedChoices.find(
    (choice) => choice.value === form.breedChoice,
  );
  const readinessListing = buildReadinessListing({
    publicDescription: form.publicDescription,
    rows: draftRows,
  });
  const readinessReport =
    readinessListing && seller
      ? buildPublishReadinessReport({
          listing: readinessListing,
          media: buildMediaSummary(mediaItems),
          seller,
        })
      : null;

  function updateField<TKey extends keyof FormState>(
    key: TKey,
    value: FormState[TKey],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setValidationErrors([]);
    setDraftError(null);
    setPublishError(null);
  }

  function updateInventory<TKey extends keyof InventoryState>(
    key: TKey,
    value: InventoryState[TKey],
  ) {
    setInventory((current) => ({ ...current, [key]: value }));
    setValidationErrors([]);
    setDraftError(null);
    setPublishError(null);
  }

  function handleBreedChoiceChange(value: string) {
    const selectedProfile = sellerProfiles.find(
      (profile) => `profile:${profile.id}` === value,
    );

    setForm((current) => ({
      ...current,
      breedChoice: value,
      publicDescription: selectedProfile?.seller_description ?? "",
    }));
    setValidationErrors([]);
    setDraftError(null);
    setPublishError(null);
  }

  function handleDetailsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateDetails(form);
    setValidationErrors(nextErrors);

    if (nextErrors.length === 0) {
      setStep("inventory");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function handleInventorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = [
      ...validateInventory(inventory),
      ...validatePriceAdjustment(priceAdjustment),
    ];
    setValidationErrors(nextErrors);

    if (nextErrors.length === 0) {
      void prepareDraftAndContinue();
    }
  }

  async function prepareDraftAndContinue() {
    if (!seller) return;

    setIsPreparingDraft(true);
    setDraftError(null);
    setPublishError(null);

    const preparedListingId = await ensureDraftListing();

    setIsPreparingDraft(false);

    if (!preparedListingId) return;

    setStep("photos");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function ensureDraftListing() {
    if (!seller || !selectedBreedChoice) return null;

    const shouldReplaceDraft =
      listingBatchId && draftBreedChoice && draftBreedChoice !== form.breedChoice;

    if (shouldReplaceDraft) {
      const shouldContinue = window.confirm(
        "Changing the breed after photos have started requires starting a new draft. Existing photos stay with the old draft.",
      );

      if (!shouldContinue) return null;
    }

    if (listingBatchId && !shouldReplaceDraft) {
      const updated = await updateExistingDraft(listingBatchId);

      if (!updated) return null;
      await loadDraft(listingBatchId);
      return listingBatchId;
    }

    const sellerBreedProfileId = await upsertSellerBreedProfileForListing(
      seller.store_id,
      form.speciesId,
      selectedBreedChoice,
      sellerProfiles,
      form.publicDescription,
    );

    if (!sellerBreedProfileId) {
      setDraftError("The breed could not be prepared. Please try again.");
      return null;
    }

    const createResult = await supabase.rpc(
      "seller_create_listing_batch_with_inventory",
      {
        p_store_id: seller.store_id,
        p_species_id: form.speciesId,
        p_batch_type: "live_animals",
        p_origin_date: form.hatchDate,
        p_available_date: form.availableDate,
        p_base_price: Number(inventory.price),
        p_breed_groups: [
          {
            seller_breed_profile_id: sellerBreedProfileId,
            sort_order: 0,
            visibility_status: "active",
            inventory_items: [
              {
                inventory_type: inventory.inventoryType,
                custom_inventory_label:
                  inventory.inventoryType === "other"
                    ? inventory.customLabel.trim()
                    : null,
                quantity_available: Number(inventory.quantity),
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
        p_seller_notes: form.sellerNotes.trim() || null,
        p_visibility_status: "hidden",
      },
    );

    if (createResult.error) {
      setDraftError(createResult.error.message);
      return null;
    }

    const rows = Array.isArray(createResult.data)
      ? (createResult.data as CreateListingBatchResult[])
      : [];
    const createdListingBatchId = rows[0]?.listing_batch_id;

    if (!createdListingBatchId) {
      setDraftError("The listing draft was not prepared. Please try again.");
      return null;
    }

    setListingBatchId(createdListingBatchId);
    setDraftBreedChoice(form.breedChoice);
    const priceAdjustmentSaved = await savePriceAdjustment(createdListingBatchId);

    if (!priceAdjustmentSaved) return null;

    await loadDraft(createdListingBatchId);

    return createdListingBatchId;
  }

  async function updateExistingDraft(currentListingBatchId: string) {
    if (draftRows.length === 0) return true;

    const row = draftRows[0];

    const batchResult = await supabase.rpc("seller_update_listing_batch", {
      p_listing_batch_id: currentListingBatchId,
      p_origin_date: form.hatchDate,
      p_available_date: form.availableDate,
      p_base_price: Number(inventory.price),
      p_auto_price_increase_enabled: false,
      p_auto_price_increase_amount: null,
      p_auto_price_increase_max_price: null,
      p_internal_batch_label: null,
      p_seller_notes: form.sellerNotes.trim() || null,
    });

    if (batchResult.error) {
      setDraftError(batchResult.error.message);
      return false;
    }

    const inventoryResult = await supabase.rpc("seller_update_inventory_item", {
      p_inventory_item_id: row.inventory_item_id,
      p_inventory_type: inventory.inventoryType,
      p_custom_inventory_label:
        inventory.inventoryType === "other"
          ? inventory.customLabel.trim()
          : null,
      p_quantity_available: Number(inventory.quantity),
      p_price_override: null,
      p_sort_order: 0,
      p_seller_notes: null,
    });

    if (inventoryResult.error) {
      setDraftError(inventoryResult.error.message);
      return false;
    }

    const priceAdjustmentSaved = await savePriceAdjustment(currentListingBatchId);

    if (!priceAdjustmentSaved) return false;

    if (selectedBreedChoice) {
      await upsertSellerBreedProfileForListing(
        storeId,
        form.speciesId,
        selectedBreedChoice,
        sellerProfiles,
        form.publicDescription,
      );
    }

    return true;
  }

  async function savePriceAdjustment(currentListingBatchId: string) {
    const { error: adjustmentError } = await supabase.rpc(
      "seller_set_listing_batch_price_adjustment",
      {
        p_listing_batch_id: currentListingBatchId,
        p_auto_price_adjustment_enabled: priceAdjustment.enabled,
        p_price_adjustment_direction: priceAdjustment.enabled
          ? priceAdjustment.direction
          : null,
        p_price_adjustment_amount: priceAdjustment.enabled
          ? Number(priceAdjustment.amount)
          : null,
        p_price_adjustment_interval_weeks: priceAdjustment.enabled
          ? Number(priceAdjustment.intervalWeeks)
          : null,
        p_price_adjustment_max_price:
          priceAdjustment.enabled &&
          priceAdjustment.direction === "increase" &&
          priceAdjustment.maxPrice.trim()
            ? Number(priceAdjustment.maxPrice)
            : null,
        p_price_adjustment_min_price:
          priceAdjustment.enabled &&
          priceAdjustment.direction === "decrease" &&
          priceAdjustment.minPrice.trim()
            ? Number(priceAdjustment.minPrice)
            : null,
      },
    );

    if (adjustmentError) {
      setDraftError(adjustmentError.message);
      return false;
    }

    return true;
  }

  const loadDraft = useCallback(async (currentListingBatchId: string, hydrate = false) => {
    if (!storeId) return;

    const [listingResult, mediaResult] = await Promise.all([
      supabase
        .from("seller_inventory_management")
        .select(listingInventorySelect)
        .eq("store_id", storeId)
        .eq("listing_batch_id", currentListingBatchId)
        .order("listing_batch_breed_sort_order", { ascending: true })
        .order("inventory_item_sort_order", { ascending: true })
        .returns<SellerInventoryManagementRow[]>(),
      supabase
        .from("seller_media_management")
        .select(sellerMediaSelect)
        .eq("store_id", storeId)
        .eq("entity_type", "listing_batch")
        .eq("entity_id", currentListingBatchId)
        .returns<ListingPhotoItem[]>(),
    ]);

    if (listingResult.error) {
      setDraftError(listingResult.error.message);
      return;
    }

    if (mediaResult.error) {
      setDraftError(mediaResult.error.message);
      return;
    }

    const loadedRows = listingResult.data ?? [];
    setDraftRows(loadedRows);
    setMediaItems(mediaResult.data ?? []);

    if (hydrate && loadedRows[0]) {
      const row = loadedRows[0];
      const profileChoice = `profile:${row.seller_breed_profile_id}`;

      setForm({
        speciesId: row.species_id,
        breedChoice: profileChoice,
        hatchDate: row.origin_date ?? "",
        availableDate: row.available_date,
        publicDescription: "",
        sellerNotes: row.listing_batch_seller_notes ?? "",
      });
      setInventory({
        inventoryType: row.inventory_type as InventoryType,
        customLabel: row.custom_inventory_label ?? "",
        quantity: String(row.quantity_available ?? ""),
        price: String(row.base_price ?? row.effective_unit_price ?? ""),
      });
      setPriceAdjustment(hydratePriceAdjustment(row));
      setDraftBreedChoice(profileChoice);
    }
  }, [storeId]);

  useEffect(() => {
    if (!listingBatchId || !storeId || isLoading || draftRows.length > 0) {
      return;
    }

    void loadDraft(listingBatchId, true);
  }, [draftRows.length, isLoading, listingBatchId, loadDraft, storeId]);

  async function publishListing() {
    if (!listingBatchId || !readinessReport) return;

    setPublishError(null);

    if (!readinessReport.publishGate.canPublish) {
      setPublishError("Fix the required items before publishing this listing.");
      return;
    }

    const warningCount = readinessReport.publishGate.warnings.length;
    const shouldPublish =
      warningCount === 0 ||
      window.confirm(
        `Publish this listing with ${warningCount} warning${
          warningCount === 1 ? "" : "s"
        } still showing? Buyers will be able to see it.`,
      );

    if (!shouldPublish) return;

    setIsPublishing(true);

    const { error: visibilityError } = await supabase.rpc(
      "seller_set_listing_batch_visibility",
      {
        p_listing_batch_id: listingBatchId,
        p_visibility_status: "active",
        p_note: "Published from listing creation wizard.",
      },
    );

    if (visibilityError) {
      setPublishError("The listing was not published. Please try again.");
      setIsPublishing(false);
      return;
    }

    window.sessionStorage.setItem(
      "flipflocksListingCreatedMessage",
      "Listing published. Buyers can now see it on your storefront.",
    );
    router.push(`/dashboard/listings/${listingBatchId}`);
  }

  if (isLoading) {
    return (
      <>
        <Header />
        <main className="mx-auto w-full max-w-4xl px-5 py-5 sm:px-7">
          <LoadingState label="Loading listing setup" />
        </main>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Header />
        <main className="mx-auto w-full max-w-4xl px-5 py-5 sm:px-7">
          <ErrorState
            title="Listing setup could not load"
            message="Refresh the page and try again."
          />
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-5 py-5 sm:px-7">
        <CreationStepIndicator step={step} steps={steps} />

        {draftError ? (
          <ErrorState title="Listing could not be prepared" message={draftError} />
        ) : null}

        {step === "details" ? (
          <SellerCard className="p-5">
            <form className="grid gap-5" onSubmit={handleDetailsSubmit}>
              <div>
                <h2 className="text-xl font-semibold text-stone-950">
                  Listing details
                </h2>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  A Simple Listing is one breed and one type from one hatch date.
                  Use a separate listing for a different hatch date.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Species
                  <select
                    className="seller-form-field"
                    value={form.speciesId}
                    onChange={(event) => {
                      setForm((current) => ({
                        ...current,
                        speciesId: event.target.value,
                        breedChoice: "",
                      }));
                      setValidationErrors([]);
                    }}
                  >
                    <option value="">Choose species</option>
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
                    disabled={!form.speciesId}
                    recentChoices={recentBreedChoices}
                    value={form.breedChoice}
                    onChange={handleBreedChoiceChange}
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Hatch date
                  <input
                    className="seller-form-field"
                    type="date"
                    value={form.hatchDate}
                    onChange={(event) =>
                      updateField("hatchDate", event.target.value)
                    }
                  />
                </label>

                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Available date
                  <input
                    className="seller-form-field"
                    type="date"
                    value={form.availableDate}
                    onChange={(event) =>
                      updateField("availableDate", event.target.value)
                    }
                  />
                </label>
              </div>

              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Description
                <textarea
                  className="seller-form-field min-h-32 resize-y py-3"
                  maxLength={publicDescriptionMaxLength}
                  placeholder="Tell buyers what they should know about this listing."
                  value={form.publicDescription}
                  onChange={(event) =>
                    updateField("publicDescription", event.target.value)
                  }
                />
              </label>

              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Private notes
                <textarea
                  className="seller-form-field min-h-24 resize-y py-3"
                  placeholder="Optional notes for yourself."
                  value={form.sellerNotes}
                  onChange={(event) =>
                    updateField("sellerNotes", event.target.value)
                  }
                />
              </label>

              <ValidationMessage errors={validationErrors} />

              <div className="flex flex-col gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <Link
                  className="seller-secondary-button"
                  href="/dashboard/listings/new/birds"
                >
                  Back
                </Link>
                <button
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
                  type="submit"
                >
                  Continue to Available Birds
                </button>
              </div>
            </form>
          </SellerCard>
        ) : null}

        {step === "inventory" ? (
          <SellerCard className="p-5">
            <form className="grid gap-5" onSubmit={handleInventorySubmit}>
              <div>
                <h2 className="text-xl font-semibold text-stone-950">
                  Available Birds
                </h2>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  Add what you have available from this hatch date.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Type
                  <select
                    className="seller-form-field"
                    value={inventory.inventoryType}
                    onChange={(event) =>
                      setInventory((current) => ({
                        ...current,
                        inventoryType: event.target.value as InventoryType | "",
                        customLabel:
                          event.target.value === "other"
                            ? current.customLabel
                            : "",
                      }))
                    }
                  >
                    <option value="">Choose type</option>
                    {inventoryTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Quantity
                  <input
                    className="seller-form-field"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    type="number"
                    value={inventory.quantity}
                    onChange={(event) =>
                      updateInventory("quantity", event.target.value)
                    }
                  />
                </label>

                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Price
                  <MoneyInput
                    value={inventory.price}
                    onChange={(value) => updateInventory("price", value)}
                  />
                </label>
              </div>

              {inventory.inventoryType === "other" ? (
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Type label
                  <input
                    className="seller-form-field"
                    placeholder="Example: Started pullets"
                    value={inventory.customLabel}
                    onChange={(event) =>
                      updateInventory("customLabel", event.target.value)
                    }
                  />
                </label>
              ) : null}

              <PriceAdjustmentFields
                value={priceAdjustment}
                onChange={(nextValue) => {
                  setPriceAdjustment(nextValue);
                  setValidationErrors([]);
                  setDraftError(null);
                  setPublishError(null);
                }}
              />

              <ValidationMessage errors={validationErrors} />

              <div className="flex flex-col gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <button
                  className="seller-secondary-button"
                  onClick={() => setStep("details")}
                  type="button"
                >
                  Back to Details
                </button>
                <button
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
                  disabled={isPreparingDraft}
                  type="submit"
                >
                  {isPreparingDraft ? "Preparing Photos" : "Continue to Photos"}
                </button>
              </div>
            </form>
          </SellerCard>
        ) : null}

        {step === "photos" && listingBatchId ? (
          <ListingCreationPhotosStep
            canManage
            listingBatchId={listingBatchId}
            mediaItems={mediaItems}
            storeId={storeId}
            onBack={() => setStep("inventory")}
            onContinue={() => {
              setStep("review");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            onReload={() => void loadDraft(listingBatchId)}
          />
        ) : null}

        {step === "review" ? (
          readinessReport ? (
            <div className="grid gap-5">
              <ListingCreationBuyerPreview
                availableDate={form.availableDate}
                description={form.publicDescription}
                dynamicPricingSummary={formatPriceAdjustmentSummary(
                  priceAdjustment,
                )}
                hatchDate={form.hatchDate}
                mediaItems={mediaItems}
                price={formatCurrency(inventory.price)}
                quantity={inventory.quantity}
                speciesBreed={`${selectedSpecies?.common_name ?? "Species"} / ${
                  selectedBreedChoice?.label ?? "Breed"
                }`}
                title={
                  selectedBreedChoice
                    ? `${selectedBreedChoice.label} ${formatInventoryType(
                        inventory.inventoryType,
                        inventory.customLabel,
                      )}`
                    : "Simple Listing"
                }
                type={formatInventoryType(
                  inventory.inventoryType,
                  inventory.customLabel,
                )}
                variant="simple"
              />
              <PublishReadinessReview
                isPublishing={isPublishing}
                publishError={publishError}
                report={readinessReport}
                onPublish={() => void publishListing()}
              />
              <button
                className="seller-secondary-button w-full"
                onClick={() => setStep("photos")}
                type="button"
              >
                Back to Photos
              </button>
            </div>
          ) : (
            <ErrorState
              title="Review is not ready"
              message="Return to the previous step and try again."
            />
          )
        ) : null}
      </main>
    </>
  );
}

function Header() {
  return (
    <SellerPageHeader
      eyebrow="Create Listing"
      title="Simple Listing"
      description="One breed, one type, and one hatch date."
      action={
        <Link
          className="seller-secondary-button"
          href="/dashboard/listings/new/birds"
        >
          Back to Listing Types
        </Link>
      }
    />
  );
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

function buildRecentBreedProfileIds(recentBreedUsages: RecentBreedUsage[]) {
  const profileIds: string[] = [];
  const seenProfileIds = new Set<string>();

  recentBreedUsages
    .slice()
    .sort((first, second) => {
      const firstTime = Date.parse(
        first.inventory_updated_at ?? first.listing_batch_updated_at ?? "",
      );
      const secondTime = Date.parse(
        second.inventory_updated_at ?? second.listing_batch_updated_at ?? "",
      );

      return (
        (Number.isNaN(secondTime) ? 0 : secondTime) -
        (Number.isNaN(firstTime) ? 0 : firstTime)
      );
    })
    .forEach((usage) => {
      if (seenProfileIds.has(usage.seller_breed_profile_id)) return;

      seenProfileIds.add(usage.seller_breed_profile_id);
      profileIds.push(usage.seller_breed_profile_id);
    });

  return profileIds.slice(0, 10);
}

function buildRecentBreedChoices(
  breedChoices: BreedChoice[],
  recentBreedProfileIds: string[],
) {
  const choicesByProfileId = new Map(
    breedChoices
      .filter((choice) => choice.profileId)
      .map((choice) => [choice.profileId, choice]),
  );

  return recentBreedProfileIds
    .map((profileId) => choicesByProfileId.get(profileId))
    .filter((choice): choice is BreedChoice => Boolean(choice))
    .slice(0, 5);
}

function validateDetails(form: FormState) {
  const errors: string[] = [];

  if (!form.speciesId) errors.push("Choose a species.");
  if (!form.breedChoice) errors.push("Choose a breed.");
  if (!form.hatchDate) errors.push("Add a hatch date.");
  if (!form.availableDate) errors.push("Add an available date.");

  if (
    form.hatchDate &&
    form.availableDate &&
    form.availableDate < form.hatchDate
  ) {
    errors.push("Available date cannot be before the hatch date.");
  }

  if (form.publicDescription.length > publicDescriptionMaxLength) {
    errors.push(
      `Description must be ${publicDescriptionMaxLength} characters or less.`,
    );
  }

  return errors;
}

function validateInventory(inventory: InventoryState) {
  const errors: string[] = [];

  if (!inventory.inventoryType) errors.push("Choose a type.");
  if (inventory.inventoryType === "other" && !inventory.customLabel.trim()) {
    errors.push("Add a type label.");
  }
  if (!isPositiveWholeNumber(inventory.quantity)) {
    errors.push("Quantity must be a whole number of 1 or more.");
  }
  if (!inventory.price.trim()) {
    errors.push("Add a price.");
  } else if (!isValidMoney(inventory.price)) {
    errors.push("Use a valid price with no more than two decimal places.");
  }

  return errors;
}

async function upsertSellerBreedProfileForListing(
  storeId: string,
  speciesId: string,
  breedChoice: BreedChoice,
  sellerProfiles: SellerBreedProfileOption[],
  publicDescription: string,
) {
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
    p_seller_description: publicDescription.trim() || null,
    p_seller_notes: existingProfile?.seller_notes ?? null,
    p_visibility_status: "active",
    p_seller_breed_profile_id:
      breedChoice.kind === "profile" ? breedChoice.profileId : null,
  });

  if (error) return null;

  const rows = Array.isArray(data)
    ? (data as { seller_breed_profile_id: string }[])
    : [];

  return rows[0]?.seller_breed_profile_id ?? null;
}

export { SimpleListingForm as SingleBreedBasicsForm };
