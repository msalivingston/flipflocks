"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
import {
  buildMediaSummary,
  buildReadinessListing,
  AgeAtAvailabilityHint,
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
import {
  CustomBreedDialog,
  type CustomBreedDraft,
} from "../../_components/custom-breed-dialog";
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

type RecentBreedUsage = {
  seller_breed_profile_id: string;
  inventory_updated_at: string | null;
  listing_batch_updated_at: string | null;
};

type SimpleSessionDraft = {
  form: FormState;
  inventory: InventoryState;
  priceAdjustment: PriceAdjustmentState;
  step: CreationStep;
  listingBatchId: string;
  sellerBreedProfileId: string;
  draftBreedChoice: string;
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
const simpleDraftStorageKey = "flipflocks:create-listing:simple:v1";
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
  const [saveDraftError, setSaveDraftError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isPreparingDraft, setIsPreparingDraft] = useState(false);
  const [isRestoringWorkflow, setIsRestoringWorkflow] = useState(false);
  const [isDiscardingDraft, setIsDiscardingDraft] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCustomBreedDialogOpen, setIsCustomBreedDialogOpen] = useState(false);
  const [customBreedInitialName, setCustomBreedInitialName] = useState("");
  const [customBreedError, setCustomBreedError] = useState<string | null>(null);
  const [isSavingCustomBreed, setIsSavingCustomBreed] = useState(false);
  const [listingBatchId, setListingBatchId] = useState(
    draftListingBatchId ?? "",
  );
  const [sellerBreedProfileId, setSellerBreedProfileId] = useState("");
  const [draftBreedChoice, setDraftBreedChoice] = useState("");
  const [draftRows, setDraftRows] = useState<SellerInventoryManagementRow[]>([]);
  const [mediaItems, setMediaItems] = useState<ListingPhotoItem[]>([]);
  const [hasRestoredSessionDraft, setHasRestoredSessionDraft] = useState(
    Boolean(draftListingBatchId),
  );

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
            "id, species_id, breed_id, custom_breed_name, display_name, seller_description, seller_notes, visibility_status, bird_type, egg_color, annual_egg_production",
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

  useEffect(() => {
    if (draftListingBatchId) return;

    const restoreTimer = window.setTimeout(() => {
      const restoredDraft = readSimpleSessionDraft();

      if (restoredDraft) {
        setForm(restoredDraft.form);
        setInventory(restoredDraft.inventory);
        setPriceAdjustment(restoredDraft.priceAdjustment);
        setStep(restoredDraft.step);
        setListingBatchId(restoredDraft.listingBatchId);
        setSellerBreedProfileId(restoredDraft.sellerBreedProfileId);
        setDraftBreedChoice(restoredDraft.draftBreedChoice);
      }

      setHasRestoredSessionDraft(true);
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, [draftListingBatchId]);

  useEffect(() => {
    if (!hasRestoredSessionDraft || draftListingBatchId) return;

    writeSimpleSessionDraft({
      draftBreedChoice,
      form,
      inventory,
      listingBatchId,
      priceAdjustment,
      sellerBreedProfileId,
      step,
    });
  }, [
    draftBreedChoice,
    draftListingBatchId,
    form,
    hasRestoredSessionDraft,
    inventory,
    listingBatchId,
    priceAdjustment,
    sellerBreedProfileId,
    step,
  ]);

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
  const activeBreedProfileId =
    draftRows[0]?.seller_breed_profile_id ?? sellerBreedProfileId;
  const workflowRows =
    draftRows.length > 0
      ? draftRows
      : buildSimpleWorkflowRows({
          form,
          inventory,
          priceAdjustment,
          selectedBreedChoice,
          selectedSpecies,
          sellerBreedProfileId,
          storeId,
        });
  const readinessListing = buildReadinessListing({
    publicDescription: form.publicDescription,
    rows: workflowRows,
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
    setSaveDraftError(null);
    setPublishError(null);
  }

  function updateInventory<TKey extends keyof InventoryState>(
    key: TKey,
    value: InventoryState[TKey],
  ) {
    setInventory((current) => ({ ...current, [key]: value }));
    setValidationErrors([]);
    setDraftError(null);
    setSaveDraftError(null);
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
    setSellerBreedProfileId(selectedProfile?.id ?? "");
    setDraftRows([]);
    setMediaItems([]);
    setValidationErrors([]);
    setDraftError(null);
    setSaveDraftError(null);
    setPublishError(null);
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
      publicDescription: nextProfile.seller_description ?? "",
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
      void prepareWorkflowAndContinue();
    }
  }

  async function prepareWorkflowAndContinue() {
    if (!seller) return;

    setIsPreparingDraft(true);
    setDraftError(null);
    setSaveDraftError(null);
    setPublishError(null);

    const preparedBreedProfileId = await ensureWorkflowBreedProfile();

    setIsPreparingDraft(false);

    if (!preparedBreedProfileId) return;

    setStep("photos");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function ensureWorkflowBreedProfile() {
    if (!seller || !selectedBreedChoice) return null;

    const shouldReplaceDraft =
      listingBatchId && draftBreedChoice && draftBreedChoice !== form.breedChoice;

    if (shouldReplaceDraft) {
      const shouldContinue = window.confirm(
        "Changing the breed after this draft has started requires starting a new draft. Breed photos stay with their breed.",
      );

      if (!shouldContinue) return null;
    }

    if (listingBatchId && !shouldReplaceDraft) {
      const updated = await updateExistingDraft(listingBatchId);

      if (!updated) return null;
      await loadDraft(listingBatchId);
      return activeBreedProfileId;
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

    setSellerBreedProfileId(sellerBreedProfileId);
    setDraftBreedChoice(form.breedChoice);
    await loadBreedProfileMedia(sellerBreedProfileId);

    return sellerBreedProfileId;
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
      p_price_override: null,
      p_sort_order: 0,
      p_seller_notes: null,
    });

    if (inventoryResult.error) {
      setDraftError(inventoryResult.error.message);
      return false;
    }

    const quantityResult = await supabase.rpc("seller_adjust_inventory_quantity", {
      p_inventory_item_id: row.inventory_item_id,
      p_quantity_available: Number(inventory.quantity),
      p_quantity_delta: null,
      p_note: "Updated from listing creation wizard.",
    });

    if (quantityResult.error) {
      setDraftError(quantityResult.error.message);
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

  async function savePriceAdjustment(
    currentListingBatchId: string,
    onError: (message: string) => void = setDraftError,
  ) {
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
      onError(adjustmentError.message);
      return false;
    }

    return true;
  }

  async function createListingFromWorkflow({
    publish,
    onError,
  }: {
    publish: boolean;
    onError: (message: string) => void;
  }) {
    if (!seller || !selectedBreedChoice) return null;

    const preparedBreedProfileId =
      activeBreedProfileId || (await ensureWorkflowBreedProfile());

    if (!preparedBreedProfileId) {
      onError("The breed could not be prepared. Please try again.");
      return null;
    }

    if (listingBatchId) {
      const updated = await updateExistingDraft(listingBatchId);

      if (!updated) {
        onError("The saved draft could not be updated. Please try again.");
        return null;
      }

      if (!publish) return listingBatchId;

      const published = await publishListingBatch(listingBatchId, onError);
      return published ? listingBatchId : null;
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
            seller_breed_profile_id: preparedBreedProfileId,
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
      onError(createResult.error.message);
      return null;
    }

    const rows = Array.isArray(createResult.data)
      ? (createResult.data as CreateListingBatchResult[])
      : [];
    const createdListingBatchId = rows[0]?.listing_batch_id;

    if (!createdListingBatchId) {
      onError("The listing could not be saved. Please try again.");
      return null;
    }

    setListingBatchId(createdListingBatchId);
    const priceAdjustmentSaved = await savePriceAdjustment(
      createdListingBatchId,
      onError,
    );

    if (!priceAdjustmentSaved) return null;

    if (!publish) return createdListingBatchId;

    const published = await publishListingBatch(createdListingBatchId, onError);
    return published ? createdListingBatchId : null;
  }

  async function publishListingBatch(
    currentListingBatchId: string,
    onError: (message: string) => void,
  ) {
    const { error: visibilityError } = await supabase.rpc(
      "seller_set_listing_batch_visibility",
      {
        p_listing_batch_id: currentListingBatchId,
        p_visibility_status: "active",
        p_note: "Published from listing creation wizard.",
      },
    );

    if (visibilityError) {
      onError("The listing was not published. Please try again.");
      return false;
    }

    return true;
  }

  const loadBreedProfileMedia = useCallback(async (currentSellerBreedProfileId: string) => {
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
  }, [storeId]);

  const loadDraft = useCallback(async (currentListingBatchId: string, hydrate = false) => {
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

    const loadedRows = listingResult.data ?? [];
    const sellerBreedProfileId = loadedRows[0]?.seller_breed_profile_id;
    const mediaResult = sellerBreedProfileId
      ? await supabase
          .from("seller_media_management")
          .select(sellerMediaSelect)
          .eq("store_id", storeId)
          .eq("entity_type", "seller_breed_profile")
          .eq("entity_id", sellerBreedProfileId)
          .returns<ListingPhotoItem[]>()
      : null;

    if (mediaResult?.error) {
      setDraftError(mediaResult.error.message);
      return;
    }

    setDraftRows(loadedRows);
    setMediaItems(mediaResult?.data ?? []);

    if (hydrate && loadedRows[0]) {
      const row = loadedRows[0];
      const profileChoice = `profile:${row.seller_breed_profile_id}`;

      setForm({
        speciesId: row.species_id,
        breedChoice: profileChoice,
        hatchDate: row.origin_date ?? "",
        availableDate: row.available_date,
        publicDescription:
          sellerProfiles.find(
            (profile) => profile.id === row.seller_breed_profile_id,
          )?.seller_description ?? "",
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
  }, [sellerProfiles, storeId]);

  useEffect(() => {
    if (!listingBatchId || !storeId || isLoading || draftRows.length > 0) {
      return;
    }

    void loadDraft(listingBatchId, true);
  }, [draftRows.length, isLoading, listingBatchId, loadDraft, storeId]);

  useEffect(() => {
    if (
      listingBatchId ||
      !activeBreedProfileId ||
      !storeId ||
      isLoading ||
      mediaItems.length > 0
    ) {
      return;
    }

    void loadBreedProfileMedia(activeBreedProfileId);
  }, [
    activeBreedProfileId,
    isLoading,
    listingBatchId,
    loadBreedProfileMedia,
    mediaItems.length,
    storeId,
  ]);

  useEffect(() => {
    if (
      draftListingBatchId ||
      isLoading ||
      !hasRestoredSessionDraft ||
      !seller ||
      (step !== "photos" && step !== "review")
    ) {
      return;
    }

    if (validateDetails(form).length > 0) {
      window.setTimeout(() => setStep("details"), 0);
      return;
    }

    if (
      [
        ...validateInventory(inventory),
        ...validatePriceAdjustment(priceAdjustment),
      ].length > 0
    ) {
      window.setTimeout(() => setStep("inventory"), 0);
      return;
    }

    if (
      !activeBreedProfileId &&
      selectedBreedChoice &&
      !isPreparingDraft &&
      !isRestoringWorkflow
    ) {
      window.setTimeout(() => {
        setIsRestoringWorkflow(true);
        void ensureWorkflowBreedProfile().finally(() => {
          setIsRestoringWorkflow(false);
        });
      }, 0);
    }
  // This one-shot recovery guard intentionally calls the current workflow
  // preparation function without subscribing to every function identity change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeBreedProfileId,
    draftListingBatchId,
    form,
    hasRestoredSessionDraft,
    inventory,
    isLoading,
    isPreparingDraft,
    isRestoringWorkflow,
    priceAdjustment,
    selectedBreedChoice,
    seller,
    step,
  ]);

  async function saveDraftListing() {
    if (!readinessReport || isSavingDraft || isPublishing) return;

    setSaveDraftError(null);
    setPublishError(null);
    setIsSavingDraft(true);

    const savedListingBatchId = await createListingFromWorkflow({
      publish: false,
      onError: setSaveDraftError,
    });

    setIsSavingDraft(false);

    if (!savedListingBatchId) return;

    window.sessionStorage.setItem(
      "flipflocksListingCreatedMessage",
      "Draft saved. You can finish it from Listings when you're ready.",
    );
    clearSimpleSessionDraft();
    router.push("/dashboard/listings");
  }

  async function publishListing() {
    if (!readinessReport || isSavingDraft || isPublishing) return;

    setPublishError(null);
    setSaveDraftError(null);

    if (!readinessReport.publishGate.canPublish) {
      setPublishError("Fix the required items before publishing this listing.");
      return;
    }

    setIsPublishing(true);

    const publishedListingBatchId = await createListingFromWorkflow({
      publish: true,
      onError: setPublishError,
    });

    setIsPublishing(false);

    if (!publishedListingBatchId) return;

    window.sessionStorage.setItem(
      "flipflocksListingCreatedMessage",
      "Listing published. Buyers can now see it on your storefront.",
    );
    clearSimpleSessionDraft();
    router.push(`/dashboard/listings/${publishedListingBatchId}`);
  }

  function returnToListingTypes() {
    router.push("/dashboard/listings/new/birds");
  }

  async function discardDraftAndReturnToListingTypes() {
    if (!listingBatchId) {
      clearSimpleSessionDraft();
      router.push("/dashboard/listings/new/birds");
      return;
    }

    const shouldDiscardSavedDraft = window.confirm(
      "Discard this saved draft? This will remove it from your listings.",
    );

    if (!shouldDiscardSavedDraft) return;

    setDraftError(null);
    setSaveDraftError(null);
    setPublishError(null);
    setIsDiscardingDraft(true);

    const discarded = await discardSavedListingDraft({
      listingBatchId,
      onError: setDraftError,
      storeId,
    });

    setIsDiscardingDraft(false);

    if (!discarded) return;

    clearSimpleSessionDraft();
    router.push("/dashboard/listings");
  }

  function restoreSimpleWorkflowDraft() {
    const restoredDraft = readSimpleSessionDraft();

    if (!restoredDraft) {
      setStep(getSimpleRecoveryStep());
      return;
    }

    setForm(restoredDraft.form);
    setInventory(restoredDraft.inventory);
    setPriceAdjustment(restoredDraft.priceAdjustment);
    setListingBatchId(restoredDraft.listingBatchId);
    setSellerBreedProfileId(restoredDraft.sellerBreedProfileId);
    setDraftBreedChoice(restoredDraft.draftBreedChoice);
    setStep(restoredDraft.step);
    setValidationErrors([]);
    setDraftError(null);
    setSaveDraftError(null);
    setPublishError(null);
  }

  function discardSimpleWorkflowDraft() {
    const defaultSpecies =
      species.find((item) => item.slug === "chicken") ?? species[0] ?? null;

    clearSimpleSessionDraft();
    setForm({
      ...emptyFormState,
      speciesId: defaultSpecies?.id ?? "",
    });
    setInventory(emptyInventoryState);
    setPriceAdjustment(emptyPriceAdjustmentState);
    setListingBatchId("");
    setSellerBreedProfileId("");
    setDraftBreedChoice("");
    setDraftRows([]);
    setMediaItems([]);
    setValidationErrors([]);
    setDraftError(null);
    setSaveDraftError(null);
    setPublishError(null);
    setStep("details");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function getSimpleRecoveryStep(): CreationStep {
    if (validateDetails(form).length > 0) return "details";

    if (
      [
        ...validateInventory(inventory),
        ...validatePriceAdjustment(priceAdjustment),
      ].length > 0
    ) {
      return "inventory";
    }

    return "photos";
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
                    onAddCustomBreed={openCustomBreedDialog}
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

              <AgeAtAvailabilityHint
                availableDate={form.availableDate}
                hatchDate={form.hatchDate}
              />

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
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    className="seller-secondary-button"
                    onClick={returnToListingTypes}
                    type="button"
                  >
                    Back to Listing Types
                  </button>
                  <button
                    className="seller-secondary-button border-red-200 text-red-800 hover:bg-red-50"
                    disabled={isDiscardingDraft}
                    onClick={() => void discardDraftAndReturnToListingTypes()}
                    type="button"
                  >
                    {isDiscardingDraft ? "Discarding Draft" : "Discard Draft"}
                  </button>
                </div>
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
                  setSaveDraftError(null);
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

        {step === "photos" && activeBreedProfileId ? (
          <ListingCreationPhotosStep
            canManage
            description="Add photos for this breed. These photos are reused for future listings of this breed."
            emptyDescription="Add clear breed photos once, then reuse them whenever this breed is available again."
            entityId={activeBreedProfileId}
            entityType="seller_breed_profile"
            listingBatchId={listingBatchId || activeBreedProfileId}
            mediaItems={mediaItems}
            storeId={storeId}
            title="Breed Photos"
            onBack={() => setStep("inventory")}
            onContinue={() => {
              setStep("review");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            onReload={() => void loadBreedProfileMedia(activeBreedProfileId)}
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
                isSavingDraft={isSavingDraft}
                publishError={publishError}
                saveDraftError={saveDraftError}
                report={readinessReport}
                onPublish={() => void publishListing()}
                onSaveDraft={() => void saveDraftListing()}
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
            <ReviewRecoveryActions
              canRestore={!draftListingBatchId}
              isRestoring={isRestoringWorkflow}
              message="The saved workflow is missing something needed for review. You can step back, restore the session draft, or discard it and start fresh."
              onBack={() => setStep(getSimpleRecoveryStep())}
              onDiscard={() => {
                if (listingBatchId) {
                  void discardDraftAndReturnToListingTypes();
                  return;
                }

                discardSimpleWorkflowDraft();
              }}
              onRestore={restoreSimpleWorkflowDraft}
            />
          )
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

function Header() {
  return (
    <SellerPageHeader
      eyebrow="Create Listing"
      title="Simple Listing"
      description="One breed, one type, and one hatch date."
    />
  );
}

function ReviewRecoveryActions({
  canRestore,
  isRestoring,
  message,
  onBack,
  onDiscard,
  onRestore,
}: {
  canRestore: boolean;
  isRestoring: boolean;
  message: string;
  onBack: () => void;
  onDiscard: () => void;
  onRestore: () => void;
}) {
  return (
    <SellerCard className="border-red-200 bg-red-50 p-5">
      <h2 className="text-lg font-semibold text-red-950">
        Review is not ready
      </h2>
      <p className="mt-2 text-sm leading-6 text-red-800">{message}</p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <button className="seller-secondary-button" onClick={onBack} type="button">
          Back to Previous Step
        </button>
        {canRestore ? (
          <button
            className="seller-secondary-button"
            disabled={isRestoring}
            onClick={onRestore}
            type="button"
          >
            {isRestoring ? "Restoring Draft" : "Restore Draft"}
          </button>
        ) : null}
        <button
          className="seller-secondary-button border-red-200 text-red-800 hover:bg-red-100"
          onClick={onDiscard}
          type="button"
        >
          Discard Draft and Start Over
        </button>
      </div>
    </SellerCard>
  );
}

function readSimpleSessionDraft() {
  try {
    const rawValue = window.sessionStorage.getItem(simpleDraftStorageKey);

    if (!rawValue) return null;

    const parsed = JSON.parse(rawValue) as Partial<SimpleSessionDraft>;

    if (!parsed.form || !parsed.inventory || !parsed.priceAdjustment) {
      return null;
    }

    return {
      form: { ...emptyFormState, ...parsed.form },
      inventory: { ...emptyInventoryState, ...parsed.inventory },
      priceAdjustment: {
        ...emptyPriceAdjustmentState,
        ...parsed.priceAdjustment,
      },
      step: isCreationStep(parsed.step) ? parsed.step : "details",
      listingBatchId: parsed.listingBatchId ?? "",
      sellerBreedProfileId: parsed.sellerBreedProfileId ?? "",
      draftBreedChoice: parsed.draftBreedChoice ?? "",
    } satisfies SimpleSessionDraft;
  } catch {
    return null;
  }
}

function writeSimpleSessionDraft(draft: SimpleSessionDraft) {
  window.sessionStorage.setItem(simpleDraftStorageKey, JSON.stringify(draft));
}

function clearSimpleSessionDraft() {
  window.sessionStorage.removeItem(simpleDraftStorageKey);
}

function isCreationStep(value: unknown): value is CreationStep {
  return (
    value === "details" ||
    value === "inventory" ||
    value === "photos" ||
    value === "review"
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

  const profileId = rows[0]?.seller_breed_profile_id ?? null;

  if (
    profileId &&
    (breedChoice.kind === "breed" || Boolean(existingProfile?.breed_id))
  ) {
    const photoResult = await restoreCatalogDefaultPhotoBestEffort(profileId);

    if (!photoResult.ok) {
      console.warn("default breed photo was not added automatically", {
        breedChoice: breedChoice.value,
        message: photoResult.message,
        sellerBreedProfileId: profileId,
      });
    }
  }

  return profileId;
}

function buildSimpleWorkflowRows({
  form,
  inventory,
  priceAdjustment,
  selectedBreedChoice,
  selectedSpecies,
  sellerBreedProfileId,
  storeId,
}: {
  form: FormState;
  inventory: InventoryState;
  priceAdjustment: PriceAdjustmentState;
  selectedBreedChoice?: BreedChoice;
  selectedSpecies?: ReferenceSpecies;
  sellerBreedProfileId: string;
  storeId: string;
}): SellerInventoryManagementRow[] {
  if (
    !selectedBreedChoice ||
    !selectedSpecies ||
    !sellerBreedProfileId ||
    !inventory.inventoryType ||
    !isPositiveWholeNumber(inventory.quantity) ||
    !isValidMoney(inventory.price)
  ) {
    return [];
  }

  return [
    {
      age_at_availability_days: calculateAgeAtAvailabilityDays(
        form.hatchDate,
        form.availableDate,
      ),
      auto_price_adjustment_enabled: priceAdjustment.enabled,
      auto_price_increase_amount: null,
      auto_price_increase_enabled: false,
      auto_price_increase_max_price: null,
      available_date: form.availableDate,
      base_price: Number(inventory.price),
      batch_type: "live_animals",
      breed_display_name: selectedBreedChoice.label,
      custom_inventory_label:
        inventory.inventoryType === "other" ? inventory.customLabel.trim() : null,
      effective_unit_price: Number(inventory.price),
      internal_batch_label: null,
      inventory_item_id: "workflow-simple-inventory",
      inventory_item_sort_order: 0,
      inventory_moderation_status: "normal",
      inventory_seller_notes: null,
      inventory_type: inventory.inventoryType,
      inventory_updated_at: null,
      inventory_visibility_status: "active",
      listing_batch_breed_id: "workflow-simple-breed",
      listing_batch_breed_moderation_status: "normal",
      listing_batch_breed_seller_notes: null,
      listing_batch_breed_sort_order: 0,
      listing_batch_breed_visibility_status: "active",
      listing_batch_id: "workflow-simple",
      listing_batch_moderation_status: "normal",
      listing_batch_seller_notes: form.sellerNotes.trim() || null,
      listing_batch_updated_at: null,
      listing_batch_visibility_status: "hidden",
      operational_availability_status: "available",
      origin_date: form.hatchDate,
      price_adjustment_amount: priceAdjustment.enabled
        ? Number(priceAdjustment.amount)
        : null,
      price_adjustment_direction: priceAdjustment.enabled
        ? priceAdjustment.direction
        : null,
      price_adjustment_interval_weeks: priceAdjustment.enabled
        ? Number(priceAdjustment.intervalWeeks)
        : null,
      price_adjustment_max_price:
        priceAdjustment.enabled &&
        priceAdjustment.direction === "increase" &&
        priceAdjustment.maxPrice.trim()
          ? Number(priceAdjustment.maxPrice)
          : null,
      price_adjustment_min_price:
        priceAdjustment.enabled &&
        priceAdjustment.direction === "decrease" &&
        priceAdjustment.minPrice.trim()
          ? Number(priceAdjustment.minPrice)
          : null,
      price_override: null,
      quantity_available: Number(inventory.quantity),
      seller_breed_profile_id: sellerBreedProfileId,
      species_id: selectedSpecies.id,
      species_name: selectedSpecies.common_name,
      species_slug: selectedSpecies.slug,
      store_id: storeId,
    },
  ];
}

function calculateAgeAtAvailabilityDays(
  hatchDate: string,
  availableDate: string,
) {
  if (!hatchDate || !availableDate) return null;

  const hatchTime = Date.parse(`${hatchDate}T00:00:00`);
  const availableTime = Date.parse(`${availableDate}T00:00:00`);

  if (Number.isNaN(hatchTime) || Number.isNaN(availableTime)) return null;

  return Math.max(
    Math.round((availableTime - hatchTime) / (24 * 60 * 60 * 1000)),
    0,
  );
}

async function discardSavedListingDraft({
  listingBatchId,
  onError,
  storeId,
}: {
  listingBatchId: string;
  onError: (message: string) => void;
  storeId: string;
}) {
  if (!storeId) {
    onError("Seller store context is missing. Refresh and try again.");
    return false;
  }

  const statusResult = await supabase
    .from("seller_inventory_management")
    .select("listing_batch_visibility_status")
    .eq("store_id", storeId)
    .eq("listing_batch_id", listingBatchId)
    .limit(1)
    .maybeSingle<{ listing_batch_visibility_status: string }>();

  if (statusResult.error) {
    onError(statusResult.error.message);
    return false;
  }

  if (statusResult.data?.listing_batch_visibility_status !== "hidden") {
    onError("Only saved drafts can be discarded here. Live listings are not deleted.");
    return false;
  }

  const { error: archiveError } = await supabase.rpc(
    "seller_set_listing_batch_visibility",
    {
      p_listing_batch_id: listingBatchId,
      p_visibility_status: "archived",
      p_note: "Discarded saved draft from listing creation wizard.",
    },
  );

  if (archiveError) {
    onError("The saved draft was not discarded. Please refresh and try again.");
    return false;
  }

  return true;
}

export { SimpleListingForm as SingleBreedBasicsForm };
