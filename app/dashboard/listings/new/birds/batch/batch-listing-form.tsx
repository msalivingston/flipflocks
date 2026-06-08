"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Dispatch, SetStateAction } from "react";
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
  listingInventorySelect,
  type CreationStep,
  type InventoryType,
  type ListingPhotoItem,
  type PriceAdjustmentState,
  MoneyInput,
  pickFeaturedPhoto,
  PriceAdjustmentFields,
  sellerMediaSelect,
  uniqueSorted,
  validatePriceAdjustment,
  ValidationMessage,
} from "../../_components/creation-wizard-shared";
import { BreedCombobox } from "../../_components/breed-combobox";
import {
  buildPublishReadinessReport,
  type PublishReadinessReport,
} from "../../../[listingBatchId]/publish-readiness";
import { ListingPhotosSection } from "../../../[listingBatchId]/listing-photos-section";
import { PublishReadinessReview } from "../../../[listingBatchId]/publish-readiness-review";

type BreedChoice = {
  value: string;
  label: string;
  aliases?: string[];
  kind: "profile" | "breed";
  profileId?: string;
  breedId?: string;
};

type GroupFormState = {
  speciesId: string;
  hatchDate: string;
  availableDate: string;
  internalLabel: string;
  sellerNotes: string;
};

type InventoryRow = {
  id: string;
  breedChoice: string;
  inventoryType: InventoryType | "";
  customLabel: string;
  quantity: string;
  price: string;
};

type BatchSellerBreedProfileOption = SellerBreedProfileOption & {
  moderation_status?: string;
};

type RecentBreedUsage = {
  seller_breed_profile_id: string;
  species_id: string;
  inventory_updated_at: string | null;
  listing_batch_updated_at: string | null;
};

type BreedProfileResolution =
  | {
      ok: true;
      profileId: string;
    }
  | {
      ok: false;
      message: string;
    };

type CreateListingBatchResult = {
  listing_batch_id: string;
};

type ListingBatchBreedResult = {
  id: string;
};

type InventoryItemResult = {
  id: string;
};

type GroupSessionDraft = {
  form: GroupFormState;
  rows: InventoryRow[];
  priceAdjustment: PriceAdjustmentState;
  step: CreationStep;
  listingBatchId: string;
  profileIdsByChoice: Record<string, string>;
};

const emptyGroupForm: GroupFormState = {
  speciesId: "",
  hatchDate: "",
  availableDate: "",
  internalLabel: "",
  sellerNotes: "",
};

const firstInventoryRow: InventoryRow = {
  id: "group-row-1",
  breedChoice: "",
  inventoryType: "",
  customLabel: "",
  quantity: "",
  price: "",
};

const breedDescriptionMaxLength = 1000;
const groupDraftStorageKey = "flipflocks:create-listing:group:v1";
const steps = [
  { label: "Details", value: "details" as const },
  { label: "Available Birds", value: "inventory" as const },
  { label: "Photos", value: "photos" as const },
  { label: "Review", value: "review" as const },
];

export function GroupListingForm({
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
  const [allSellerProfiles, setAllSellerProfiles] = useState<
    BatchSellerBreedProfileOption[]
  >([]);
  const [form, setForm] = useState<GroupFormState>(emptyGroupForm);
  const [rows, setRows] = useState<InventoryRow[]>([firstInventoryRow]);
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
  const [listingBatchId, setListingBatchId] = useState(
    draftListingBatchId ?? "",
  );
  const [profileIdsByChoice, setProfileIdsByChoice] = useState<
    Record<string, string>
  >({});
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
            "id, species_id, breed_id, custom_breed_name, display_name, seller_description, seller_notes, visibility_status, moderation_status",
          )
          .eq("store_id", storeId)
          .eq("moderation_status", "normal")
          .order("display_name", { ascending: true }),
        supabase
          .from("seller_inventory_management")
          .select(
            "seller_breed_profile_id, species_id, inventory_updated_at, listing_batch_updated_at",
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
      const loadedProfiles = (profileResult.data ??
        []) as BatchSellerBreedProfileOption[];
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
      setAllSellerProfiles(loadedProfiles);
      setSellerProfiles(
        loadedProfiles.filter(
          (profile) => profile.visibility_status === "active",
        ),
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
      const restoredDraft = readGroupSessionDraft();

      if (restoredDraft) {
        setForm(restoredDraft.form);
        setRows(restoredDraft.rows);
        setPriceAdjustment(restoredDraft.priceAdjustment);
        setStep(restoredDraft.step);
        setListingBatchId(restoredDraft.listingBatchId);
        setProfileIdsByChoice(restoredDraft.profileIdsByChoice);
      }

      setHasRestoredSessionDraft(true);
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, [draftListingBatchId]);

  useEffect(() => {
    if (!hasRestoredSessionDraft || draftListingBatchId) return;

    writeGroupSessionDraft({
      form,
      listingBatchId,
      priceAdjustment,
      profileIdsByChoice,
      rows,
      step,
    });
  }, [
    draftListingBatchId,
    form,
    hasRestoredSessionDraft,
    listingBatchId,
    priceAdjustment,
    profileIdsByChoice,
    rows,
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
  const workflowRows =
    draftRows.length > 0
      ? draftRows
      : buildGroupWorkflowRows({
          allSellerProfiles,
          breedChoices,
          form,
          priceAdjustment,
          profileIdsByChoice,
          rows,
          selectedSpecies,
          storeId,
        });
  const breedProfileDescription = buildPublicDescriptionFromRows(
    workflowRows,
    allSellerProfiles,
  );
  const readinessListing = buildReadinessListing({
    publicDescription: breedProfileDescription,
    rows: workflowRows,
  });
  const baseReadinessReport =
    readinessListing && seller
      ? buildPublishReadinessReport({
          listing: readinessListing,
          media: buildMediaSummary(mediaItems),
          seller,
        })
      : null;
  const readinessReport = baseReadinessReport
    ? addBreedContentWarnings({
        mediaItems,
        profiles: allSellerProfiles,
        report: baseReadinessReport,
        rows: workflowRows,
      })
    : null;

  function updateField<TKey extends keyof GroupFormState>(
    key: TKey,
    value: GroupFormState[TKey],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setValidationErrors([]);
    setDraftError(null);
    setSaveDraftError(null);
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
      ...validateRows(rows, breedChoices),
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

    const prepared = await prepareWorkflowBreedProfiles();

    setIsPreparingDraft(false);

    if (!prepared) return;

    setStep("photos");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function prepareWorkflowBreedProfiles() {
    if (!seller) return null;

    if (listingBatchId) {
      const synced = await syncExistingDraft(listingBatchId);

      if (!synced) return null;

      const loadedRows = await loadDraft(listingBatchId);

      if (loadedRows) {
        const syncedRows = buildRowsFromDraftRows(loadedRows);
        setRows(syncedRows);
      }

      return listingBatchId;
    }

    const resolvedProfileIds = await resolveProfileIdsForRows();

    if (!resolvedProfileIds) return null;

    setProfileIdsByChoice(Object.fromEntries(resolvedProfileIds));
    await loadSellerProfiles();
    await loadBreedProfileMedia(Array.from(resolvedProfileIds.values()));

    return "workflow";
  }

  async function syncExistingDraft(currentListingBatchId: string) {
    if (!seller) return false;

    const profileIdsByChoice = await resolveProfileIdsForRows();

    if (!profileIdsByChoice) return false;

    const basePrice = Number(rows[0]?.price ?? 0);
    const batchResult = await supabase.rpc("seller_update_listing_batch", {
      p_listing_batch_id: currentListingBatchId,
      p_origin_date: form.hatchDate,
      p_available_date: form.availableDate,
      p_base_price: basePrice,
      p_auto_price_increase_enabled: false,
      p_auto_price_increase_amount: null,
      p_auto_price_increase_max_price: null,
      p_internal_batch_label: form.internalLabel.trim() || null,
      p_seller_notes: form.sellerNotes.trim() || null,
    });

    if (batchResult.error) {
      setDraftError(batchResult.error.message);
      return false;
    }

    const priceAdjustmentSaved = await savePriceAdjustment(currentListingBatchId);

    if (!priceAdjustmentSaved) return false;

    const allDraftRows = draftRows;
    const activeDraftRows = allDraftRows.filter(
      (row) =>
        row.inventory_visibility_status === "active" &&
        row.listing_batch_breed_visibility_status === "active",
    );
    const retainedInventoryIds = new Set<string>();
    const breedIdByProfileId = new Map<string, string>();
    const breedStatusById = new Map<string, string>();

    allDraftRows.forEach((row) => {
      breedIdByProfileId.set(
        row.seller_breed_profile_id,
        row.listing_batch_breed_id,
      );
      breedStatusById.set(
        row.listing_batch_breed_id,
        row.listing_batch_breed_visibility_status,
      );
    });

    for (const [index, row] of rows.entries()) {
      const profileId = profileIdsByChoice.get(row.breedChoice);

      if (!profileId) {
        setDraftError("One of the selected breeds could not be prepared.");
        return false;
      }

      let listingBatchBreedId = breedIdByProfileId.get(profileId);

      if (!listingBatchBreedId) {
        const breedResult = await supabase.rpc("seller_add_listing_batch_breed", {
          p_listing_batch_id: currentListingBatchId,
          p_seller_breed_profile_id: profileId,
          p_seller_notes: null,
          p_sort_order: index,
          p_visibility_status: "active",
        });

        if (breedResult.error) {
          setDraftError(breedResult.error.message);
          return false;
        }

        const createdBreed = breedResult.data as ListingBatchBreedResult | null;
        listingBatchBreedId = createdBreed?.id;

        if (!listingBatchBreedId) {
          setDraftError("The breed option could not be prepared.");
          return false;
        }

        breedIdByProfileId.set(profileId, listingBatchBreedId);
      } else {
        if (breedStatusById.get(listingBatchBreedId) !== "active") {
          const breedVisibilityResult = await supabase.rpc(
            "seller_set_listing_batch_breed_visibility",
            {
              p_listing_batch_breed_id: listingBatchBreedId,
              p_visibility_status: "active",
              p_note: "Restored from listing creation wizard.",
            },
          );

          if (breedVisibilityResult.error) {
            setDraftError(breedVisibilityResult.error.message);
            return false;
          }
        }

        const breedUpdateResult = await supabase.rpc(
          "seller_update_listing_batch_breed",
          {
            p_listing_batch_breed_id: listingBatchBreedId,
            p_seller_notes: null,
            p_sort_order: index,
          },
        );

        if (breedUpdateResult.error) {
          setDraftError(breedUpdateResult.error.message);
          return false;
        }
      }

      const targetMatchingRow = allDraftRows.find(
        (draftRow) =>
          !retainedInventoryIds.has(draftRow.inventory_item_id) &&
          draftRow.seller_breed_profile_id === profileId &&
          draftRow.inventory_type === row.inventoryType &&
          normalizeCustomLabel(draftRow.custom_inventory_label) ===
            normalizeCustomLabel(row.customLabel),
      );
      const existingRow = activeDraftRows.find(
        (draftRow) =>
          draftRow.inventory_item_id === row.id &&
          draftRow.seller_breed_profile_id === profileId &&
          !targetMatchingRow,
      );
      const rowToUpdate = targetMatchingRow ?? existingRow ?? null;

      if (rowToUpdate) {
        retainedInventoryIds.add(rowToUpdate.inventory_item_id);

        if (rowToUpdate.inventory_visibility_status !== "active") {
          const visibilityResult = await supabase.rpc(
            "seller_set_inventory_visibility",
            {
              p_inventory_item_id: rowToUpdate.inventory_item_id,
              p_visibility_status: "active",
              p_note: "Restored from listing creation wizard.",
            },
          );

          if (visibilityResult.error) {
            setDraftError(visibilityResult.error.message);
            return false;
          }
        }

        const inventoryResult = await supabase.rpc("seller_update_inventory_item", {
          p_inventory_item_id: rowToUpdate.inventory_item_id,
          p_inventory_type: row.inventoryType,
          p_custom_inventory_label:
            row.inventoryType === "other" ? row.customLabel.trim() : null,
          p_price_override: Number(row.price) === basePrice ? null : Number(row.price),
          p_sort_order: index,
          p_seller_notes: null,
        });

        if (inventoryResult.error) {
          setDraftError(inventoryResult.error.message);
          return false;
        }

        const quantityResult = await supabase.rpc("seller_adjust_inventory_quantity", {
          p_inventory_item_id: rowToUpdate.inventory_item_id,
          p_quantity_available: Number(row.quantity),
          p_quantity_delta: null,
          p_note: "Updated from listing creation wizard.",
        });

        if (quantityResult.error) {
          setDraftError(quantityResult.error.message);
          return false;
        }
      } else {
        const createItemResult = await supabase.rpc("seller_create_inventory_item", {
          p_listing_batch_breed_id: listingBatchBreedId,
          p_inventory_type: row.inventoryType,
          p_custom_inventory_label:
            row.inventoryType === "other" ? row.customLabel.trim() : null,
          p_quantity_available: Number(row.quantity),
          p_price_override: Number(row.price) === basePrice ? null : Number(row.price),
          p_sort_order: index,
          p_visibility_status: "active",
          p_seller_notes: null,
        });

        if (createItemResult.error) {
          setDraftError(createItemResult.error.message);
          return false;
        }

        const createdItem = createItemResult.data as InventoryItemResult | null;

        if (createdItem?.id) retainedInventoryIds.add(createdItem.id);
      }
    }

    for (const draftRow of activeDraftRows) {
      if (retainedInventoryIds.has(draftRow.inventory_item_id)) continue;

      const archiveResult = await supabase.rpc("seller_set_inventory_visibility", {
        p_inventory_item_id: draftRow.inventory_item_id,
        p_visibility_status: "archived",
        p_note: "Removed from listing creation wizard.",
      });

      if (archiveResult.error) {
        setDraftError(archiveResult.error.message);
        return false;
      }
    }

    return true;
  }

  async function resolveProfileIdsForRows() {
    if (!seller) return null;

    const profileIdsByChoice = new Map<string, string>();

    for (const breedChoiceValue of uniqueSorted(
      rows.map((row) => row.breedChoice),
    )) {
      const breedChoice = breedChoices.find(
        (choice) => choice.value === breedChoiceValue,
      );

      if (!breedChoice) {
        setDraftError("One of the selected breeds could not be found.");
        return null;
      }

      const profileResolution = await resolveSellerBreedProfileForListing(
        seller.store_id,
        form.speciesId,
        breedChoice,
        sellerProfiles,
        allSellerProfiles,
      );

      if (!profileResolution.ok) {
        setDraftError(
          `${breedChoice.label} could not be prepared. Please try again.`,
        );
        return null;
      }

      profileIdsByChoice.set(breedChoice.value, profileResolution.profileId);
    }

    return profileIdsByChoice;
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
    if (!seller) return null;

    let resolvedProfileIds = new Map(Object.entries(profileIdsByChoice));

    if (resolvedProfileIds.size === 0) {
      const preparedProfileIds = await resolveProfileIdsForRows();

      if (!preparedProfileIds) {
        onError("The selected breeds could not be prepared. Please try again.");
        return null;
      }

      resolvedProfileIds = preparedProfileIds;
      setProfileIdsByChoice(Object.fromEntries(preparedProfileIds));
    }

    if (listingBatchId) {
      const synced = await syncExistingDraft(listingBatchId);

      if (!synced) {
        onError("The saved draft could not be updated. Please try again.");
        return null;
      }

      if (!publish) return listingBatchId;

      const published = await publishListingBatch(listingBatchId, onError);
      return published ? listingBatchId : null;
    }

    const basePrice = Number(rows[0]?.price ?? 0);
    const createResult = await supabase.rpc(
      "seller_create_listing_batch_with_inventory",
      {
        p_store_id: seller.store_id,
        p_species_id: form.speciesId,
        p_batch_type: "live_animals",
        p_origin_date: form.hatchDate,
        p_available_date: form.availableDate,
        p_base_price: basePrice,
        p_breed_groups: buildBreedGroupsPayload(
          rows,
          resolvedProfileIds,
          basePrice,
        ),
        p_auto_price_increase_enabled: false,
        p_auto_price_increase_amount: null,
        p_auto_price_increase_max_price: null,
        p_internal_batch_label: form.internalLabel.trim() || null,
        p_seller_notes: form.sellerNotes.trim() || null,
        p_visibility_status: "hidden",
      },
    );

    if (createResult.error) {
      onError(createResult.error.message);
      return null;
    }

    const createdRows = Array.isArray(createResult.data)
      ? (createResult.data as CreateListingBatchResult[])
      : [];
    const createdListingBatchId = createdRows[0]?.listing_batch_id;

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

  const loadBreedProfileMedia = useCallback(async (sellerBreedProfileIds: string[]) => {
    if (!storeId || sellerBreedProfileIds.length === 0) {
      setMediaItems([]);
      return;
    }

    const mediaResult = await supabase
      .from("seller_media_management")
      .select(sellerMediaSelect)
      .eq("store_id", storeId)
      .eq("entity_type", "seller_breed_profile")
      .in("entity_id", uniqueSorted(sellerBreedProfileIds))
      .returns<ListingPhotoItem[]>();

    if (mediaResult.error) {
      setDraftError(mediaResult.error.message);
      return;
    }

    setMediaItems(mediaResult.data ?? []);
  }, [storeId]);

  const loadSellerProfiles = useCallback(async () => {
    if (!storeId) return;

    const profileResult = await supabase
      .from("seller_breed_profiles")
      .select(
        "id, species_id, breed_id, custom_breed_name, display_name, seller_description, seller_notes, visibility_status, moderation_status",
      )
      .eq("store_id", storeId)
      .eq("moderation_status", "normal")
      .order("display_name", { ascending: true });

    if (profileResult.error) {
      setDraftError(profileResult.error.message);
      return;
    }

    const loadedProfiles = (profileResult.data ??
      []) as BatchSellerBreedProfileOption[];

    setAllSellerProfiles(loadedProfiles);
    setSellerProfiles(
      loadedProfiles.filter((profile) => profile.visibility_status === "active"),
    );
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
      return null;
    }

    const loadedRows = listingResult.data ?? [];
    const mediaEntityIds = uniqueSorted(
      loadedRows.map((row) => row.seller_breed_profile_id),
    );
    const mediaResult =
      mediaEntityIds.length > 0
        ? await supabase
            .from("seller_media_management")
            .select(sellerMediaSelect)
            .eq("store_id", storeId)
            .eq("entity_type", "seller_breed_profile")
            .in("entity_id", mediaEntityIds)
            .returns<ListingPhotoItem[]>()
        : null;

    if (mediaResult?.error) {
      setDraftError(mediaResult.error.message);
      return null;
    }

    setDraftRows(loadedRows);
    setMediaItems(mediaResult?.data ?? []);

    if (hydrate && loadedRows.length > 0) {
      const firstRow = loadedRows[0];
      const hydratedRows = buildRowsFromDraftRows(loadedRows);

      setPriceAdjustment(hydratePriceAdjustment(firstRow));
      setForm({
        speciesId: firstRow.species_id,
        hatchDate: firstRow.origin_date ?? "",
        availableDate: firstRow.available_date,
        internalLabel: firstRow.internal_batch_label ?? "",
        sellerNotes: firstRow.listing_batch_seller_notes ?? "",
      });
      setRows(hydratedRows.length > 0 ? hydratedRows : [firstInventoryRow]);
    }

    return loadedRows;
  }, [storeId]);

  useEffect(() => {
    if (!listingBatchId || !storeId || isLoading || draftRows.length > 0) {
      return;
    }

    void loadDraft(listingBatchId, true);
  }, [draftRows.length, isLoading, listingBatchId, loadDraft, storeId]);

  useEffect(() => {
    const workflowProfileIds = uniqueSorted(Object.values(profileIdsByChoice));

    if (
      listingBatchId ||
      workflowProfileIds.length === 0 ||
      !storeId ||
      isLoading ||
      mediaItems.length > 0
    ) {
      return;
    }

    void loadBreedProfileMedia(workflowProfileIds);
  }, [
    isLoading,
    listingBatchId,
    loadBreedProfileMedia,
    mediaItems.length,
    profileIdsByChoice,
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
      [...validateRows(rows, breedChoices), ...validatePriceAdjustment(priceAdjustment)]
        .length > 0
    ) {
      window.setTimeout(() => setStep("inventory"), 0);
      return;
    }

    if (
      workflowRows.length === 0 &&
      !isPreparingDraft &&
      !isRestoringWorkflow
    ) {
      window.setTimeout(() => {
        setIsRestoringWorkflow(true);
        void prepareWorkflowBreedProfiles().finally(() => {
          setIsRestoringWorkflow(false);
        });
      }, 0);
    }
  // This one-shot recovery guard intentionally calls the current workflow
  // preparation function without subscribing to every function identity change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    breedChoices,
    draftListingBatchId,
    form,
    hasRestoredSessionDraft,
    isLoading,
    isPreparingDraft,
    isRestoringWorkflow,
    priceAdjustment,
    rows,
    seller,
    step,
    workflowRows.length,
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
    clearGroupSessionDraft();
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
    clearGroupSessionDraft();
    router.push(`/dashboard/listings/${publishedListingBatchId}`);
  }

  function returnToListingTypes() {
    router.push("/dashboard/listings/new/birds");
  }

  async function discardDraftAndReturnToListingTypes() {
    if (!listingBatchId) {
      clearGroupSessionDraft();
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

    clearGroupSessionDraft();
    router.push("/dashboard/listings");
  }

  function restoreGroupWorkflowDraft() {
    const restoredDraft = readGroupSessionDraft();

    if (!restoredDraft) {
      setStep(getGroupRecoveryStep());
      return;
    }

    setForm(restoredDraft.form);
    setRows(restoredDraft.rows);
    setPriceAdjustment(restoredDraft.priceAdjustment);
    setListingBatchId(restoredDraft.listingBatchId);
    setProfileIdsByChoice(restoredDraft.profileIdsByChoice);
    setStep(restoredDraft.step);
    setValidationErrors([]);
    setDraftError(null);
    setSaveDraftError(null);
    setPublishError(null);
  }

  function discardGroupWorkflowDraft() {
    const defaultSpecies =
      species.find((item) => item.slug === "chicken") ?? species[0] ?? null;

    clearGroupSessionDraft();
    setForm({
      ...emptyGroupForm,
      speciesId: defaultSpecies?.id ?? "",
    });
    setRows([firstInventoryRow]);
    setPriceAdjustment(emptyPriceAdjustmentState);
    setListingBatchId("");
    setProfileIdsByChoice({});
    setDraftRows([]);
    setMediaItems([]);
    setValidationErrors([]);
    setDraftError(null);
    setSaveDraftError(null);
    setPublishError(null);
    setStep("details");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function getGroupRecoveryStep(): CreationStep {
    if (validateDetails(form).length > 0) return "details";

    if (
      [...validateRows(rows, breedChoices), ...validatePriceAdjustment(priceAdjustment)]
        .length > 0
    ) {
      return "inventory";
    }

    return "photos";
  }

  function updateSavedBreedDescription(
    sellerBreedProfileId: string,
    sellerDescription: string | null,
  ) {
    const updateProfile = <TProfile extends SellerBreedProfileOption>(
      profile: TProfile,
    ): TProfile =>
      profile.id === sellerBreedProfileId
        ? { ...profile, seller_description: sellerDescription }
        : profile;

    setAllSellerProfiles((current) => current.map(updateProfile));
    setSellerProfiles((current) => current.map(updateProfile));
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
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5 sm:px-7">
        <CreationStepIndicator step={step} steps={steps} />

        {draftError ? (
          <ErrorState title="Listing could not be prepared" message={draftError} />
        ) : null}

        {step === "details" ? (
          <SellerCard className="p-5">
            <form className="grid gap-5" onSubmit={handleDetailsSubmit}>
              <div>
                <h2 className="text-xl font-semibold text-stone-950">
                  Shared hatch details
                </h2>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  A Group Listing can include multiple available options from one hatch
                  date. Use separate listings for different hatch dates.
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
                      }));
                      setRows((current) =>
                        current.map((row) => ({ ...row, breedChoice: "" })),
                      );
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
                  Listing name
                  <input
                    className="seller-form-field"
                    maxLength={120}
                    placeholder="Example: April 1 mixed pullets"
                    value={form.internalLabel}
                    onChange={(event) =>
                      updateField("internalLabel", event.target.value)
                    }
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
          <InventoryStep
            aliasSearchError={breedAliasError}
            breedChoices={breedChoices}
            isPreparingDraft={isPreparingDraft}
            priceAdjustment={priceAdjustment}
            recentBreedChoices={recentBreedChoices}
            rows={rows}
            setRows={setRows}
            validationErrors={validationErrors}
            onPriceAdjustmentChange={(nextValue) => {
              setPriceAdjustment(nextValue);
              setValidationErrors([]);
              setDraftError(null);
              setSaveDraftError(null);
              setPublishError(null);
            }}
            onBack={() => setStep("details")}
            onSubmit={handleInventorySubmit}
          />
        ) : null}

        {step === "photos" && workflowRows.length > 0 ? (
          <GroupBreedContentStep
            draftRows={workflowRows}
            listingBatchId={listingBatchId || "workflow-group"}
            mediaItems={mediaItems}
            profiles={allSellerProfiles}
            storeId={storeId}
            onBack={() => setStep("inventory")}
            onDescriptionSaved={updateSavedBreedDescription}
            onProfilesReload={() => void loadSellerProfiles()}
            onReload={() =>
              listingBatchId
                ? void loadDraft(listingBatchId)
                : void loadBreedProfileMedia(
                    uniqueSorted(
                      workflowRows.map((row) => row.seller_breed_profile_id),
                    ),
                  )
            }
            onContinue={() => {
              setStep("review");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        ) : null}

        {step === "review" ? (
          readinessReport ? (
            <div className="grid gap-5">
              <ListingCreationBuyerPreview
                availableDate={form.availableDate}
                description={null}
                dynamicPricingSummary={formatPriceAdjustmentSummary(
                  priceAdjustment,
                )}
                hatchDate={form.hatchDate}
                mediaItems={mediaItems}
                rows={workflowRows.map((row) => ({
                  id: row.inventory_item_id,
                  breed: row.breed_display_name,
                  description: getBreedProfileDescription(
                    row.seller_breed_profile_id,
                    allSellerProfiles,
                  ),
                  type: formatInventoryType(
                    row.inventory_type,
                    row.custom_inventory_label,
                  ),
                  quantity: `${row.quantity_available ?? 0} available`,
                  price: formatCurrency(
                    row.effective_unit_price ?? row.base_price ?? 0,
                  ),
                  photo: pickFeaturedPhoto(
                    mediaItems.filter(
                      (item) =>
                        item.entity_type === "seller_breed_profile" &&
                        item.entity_id === row.seller_breed_profile_id,
                    ),
                  ),
                }))}
                speciesBreed={selectedSpecies?.common_name ?? "Selected species"}
                title={
                  form.internalLabel.trim() ||
                  `${selectedSpecies?.common_name ?? "Group"} hatch`
                }
                variant="group"
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
              onBack={() => setStep(getGroupRecoveryStep())}
              onDiscard={() => {
                if (listingBatchId) {
                  void discardDraftAndReturnToListingTypes();
                  return;
                }

                discardGroupWorkflowDraft();
              }}
              onRestore={restoreGroupWorkflowDraft}
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
      title="Group Listing"
      description="Multiple types or breeds from the same hatch date."
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

function readGroupSessionDraft() {
  try {
    const rawValue = window.sessionStorage.getItem(groupDraftStorageKey);

    if (!rawValue) return null;

    const parsed = JSON.parse(rawValue) as Partial<GroupSessionDraft>;

    if (!parsed.form || !parsed.rows || !parsed.priceAdjustment) return null;

    return {
      form: { ...emptyGroupForm, ...parsed.form },
      rows: parsed.rows.length > 0 ? parsed.rows : [firstInventoryRow],
      priceAdjustment: {
        ...emptyPriceAdjustmentState,
        ...parsed.priceAdjustment,
      },
      step: isCreationStep(parsed.step) ? parsed.step : "details",
      listingBatchId: parsed.listingBatchId ?? "",
      profileIdsByChoice: parsed.profileIdsByChoice ?? {},
    } satisfies GroupSessionDraft;
  } catch {
    return null;
  }
}

function writeGroupSessionDraft(draft: GroupSessionDraft) {
  window.sessionStorage.setItem(groupDraftStorageKey, JSON.stringify(draft));
}

function clearGroupSessionDraft() {
  window.sessionStorage.removeItem(groupDraftStorageKey);
}

function isCreationStep(value: unknown): value is CreationStep {
  return (
    value === "details" ||
    value === "inventory" ||
    value === "photos" ||
    value === "review"
  );
}

function GroupBreedContentStep({
  draftRows,
  listingBatchId,
  mediaItems,
  onBack,
  onContinue,
  onDescriptionSaved,
  onProfilesReload,
  onReload,
  profiles,
  storeId,
}: {
  draftRows: SellerInventoryManagementRow[];
  listingBatchId: string;
  mediaItems: ListingPhotoItem[];
  onBack: () => void;
  onContinue: () => void;
  onDescriptionSaved: (
    sellerBreedProfileId: string,
    sellerDescription: string | null,
  ) => void;
  onProfilesReload: () => void;
  onReload: () => void;
  profiles: BatchSellerBreedProfileOption[];
  storeId: string;
}) {
  const breedRows = useMemo(
    () => sortBreedContentRows(uniqueBreedRows(draftRows), profiles, mediaItems),
    [draftRows, mediaItems, profiles],
  );
  const [descriptionDrafts, setDescriptionDrafts] = useState<Record<string, string>>(
    {},
  );
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [saveMessages, setSaveMessages] = useState<Record<string, string>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [unsavedNotice, setUnsavedNotice] = useState<string | null>(null);

  function updateDescription(profileId: string, value: string) {
    setDescriptionDrafts((current) => ({ ...current, [profileId]: value }));
    setSaveMessages((current) => ({ ...current, [profileId]: "" }));
    setSaveErrors((current) => ({ ...current, [profileId]: "" }));
    setUnsavedNotice(null);
  }

  async function saveDescription(row: SellerInventoryManagementRow) {
    const profile = profiles.find(
      (item) => item.id === row.seller_breed_profile_id,
    );
    const profileId = row.seller_breed_profile_id;
    const savedDescription = getBreedProfileDescription(profileId, profiles) ?? "";
    const draft = descriptionDrafts[profileId] ?? savedDescription;

    if (!profile) {
      setSaveErrors((current) => ({
        ...current,
        [profileId]: "This breed profile could not be loaded.",
      }));
      return;
    }

    setSavingProfileId(profileId);
    setSaveMessages((current) => ({ ...current, [profileId]: "" }));
    setSaveErrors((current) => ({ ...current, [profileId]: "" }));

    const nextDescription = draft.trim();
    const { error } = await supabase.rpc("seller_upsert_breed_profile", {
      p_store_id: storeId,
      p_species_id: profile.species_id,
      p_breed_id: profile.breed_id,
      p_custom_breed_name: profile.custom_breed_name,
      p_display_name: profile.display_name,
      p_seller_description: nextDescription || null,
      p_seller_notes: profile.seller_notes,
      p_visibility_status: profile.visibility_status,
      p_seller_breed_profile_id: profile.id,
    });

    setSavingProfileId(null);

    if (error) {
      setSaveErrors((current) => ({
        ...current,
        [profileId]: "Description was not saved. Please try again.",
      }));
      return;
    }

    setDescriptionDrafts((current) => {
      const remainingDrafts = { ...current };
      delete remainingDrafts[profileId];
      return remainingDrafts;
    });
    onDescriptionSaved(profileId, nextDescription || null);
    setSaveMessages((current) => ({
      ...current,
      [profileId]: "Description saved.",
    }));
    onProfilesReload();
  }

  function continueToReview() {
    const unsavedRows = breedRows.filter((row) => {
      const profileId = row.seller_breed_profile_id;
      const draft = descriptionDrafts[profileId];
      const savedDescription = getBreedProfileDescription(profileId, profiles) ?? "";

      return draft !== undefined && draft !== savedDescription;
    });

    if (unsavedRows.length > 0) {
      setUnsavedNotice(
        `Save or discard description edits for ${unsavedRows
          .map((row) => row.breed_display_name)
          .join(", ")} before continuing to Review.`,
      );
      return;
    }

    onContinue();
  }

  return (
    <div className="grid gap-5">
      <SellerCard className="p-5">
        <div>
          <h2 className="text-xl font-semibold text-stone-950">
            Breed Content
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Group listings use each breed&apos;s saved description and photos.
            This step only reviews existing breed content for this fast-entry
            hatch.
          </p>
        </div>

        {unsavedNotice ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            {unsavedNotice}
          </div>
        ) : null}

        <div className="mt-5 grid gap-3">
          {breedRows.map((row) => {
            const profileId = row.seller_breed_profile_id;
            const profileMediaItems = mediaItems.filter(
              (item) =>
                item.entity_type === "seller_breed_profile" &&
                item.entity_id === profileId,
            );
            const photo = pickFeaturedPhoto(profileMediaItems);
            const savedDescription =
              getBreedProfileDescription(profileId, profiles) ?? "";
            const descriptionDraft = descriptionDrafts[profileId] ?? savedDescription;
            const isDirty =
              descriptionDrafts[profileId] !== undefined &&
              descriptionDraft !== savedDescription;
            const isMissingDescription = !savedDescription.trim();
            const isMissingPhoto = !photo;
            const helperText = `These photos and description are saved to your ${row.breed_display_name} profile and reused on future ${row.breed_display_name} listings.`;

            return (
              <details
                key={row.seller_breed_profile_id}
                className="rounded-lg border border-stone-200 bg-stone-50 p-3 open:bg-white"
                open={isMissingDescription || isMissingPhoto || isDirty}
              >
                <summary className="grid cursor-pointer gap-3 sm:grid-cols-[72px_minmax(0,1fr)]">
                  <RowPhoto photo={photo} />
                  <div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="font-semibold text-stone-950">
                          {row.breed_display_name}
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-stone-600">
                          {helperText}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs font-semibold">
                        {isDirty ? (
                          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">
                            Unsaved edits
                          </span>
                        ) : null}
                        {isMissingDescription ? (
                          <span className="rounded-full bg-stone-200 px-3 py-1 text-stone-700">
                            Missing description
                          </span>
                        ) : null}
                        {isMissingPhoto ? (
                          <span className="rounded-full bg-stone-200 px-3 py-1 text-stone-700">
                            Missing photos
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </summary>

                <div className="mt-4 grid gap-4 border-t border-stone-200 pt-4">
                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Public breed description
                    <textarea
                      className="seller-form-field min-h-24 resize-y py-3"
                      maxLength={breedDescriptionMaxLength}
                      value={descriptionDraft}
                      onChange={(event) =>
                        updateDescription(profileId, event.target.value)
                      }
                    />
                    <span className="text-xs font-normal leading-5 text-stone-500">
                      {helperText}
                    </span>
                  </label>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-h-5 text-sm font-semibold">
                      {saveMessages[profileId] ? (
                        <span className="text-emerald-800">
                          {saveMessages[profileId]}
                        </span>
                      ) : saveErrors[profileId] ? (
                        <span className="text-red-800">
                          {saveErrors[profileId]}
                        </span>
                      ) : isDirty ? (
                        <span className="text-amber-800">
                          Description changes are not saved yet.
                        </span>
                      ) : null}
                    </div>
                    <button
                      className="inline-flex min-h-10 items-center justify-center rounded-md bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!isDirty || savingProfileId === profileId}
                      onClick={() => void saveDescription(row)}
                      type="button"
                    >
                      {savingProfileId === profileId
                        ? "Saving"
                        : "Save description"}
                    </button>
                  </div>

                  <ListingPhotosSection
                    canManage
                    description={`Add photos for ${row.breed_display_name}. They are reused on future ${row.breed_display_name} listings.`}
                    emptyDescription={`Add clear ${row.breed_display_name} photos once, then reuse them whenever this breed is available again.`}
                    entityId={profileId}
                    entityType="seller_breed_profile"
                    listingBatchId={listingBatchId}
                    mediaItems={profileMediaItems}
                    mode="setup"
                    storeId={storeId}
                    title={`${row.breed_display_name} Photos`}
                    onReload={onReload}
                  />
                </div>
              </details>
            );
          })}
        </div>
      </SellerCard>

      <div className="flex flex-col gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <button className="seller-secondary-button" onClick={onBack} type="button">
          Back to Available Birds
        </button>
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
          onClick={continueToReview}
          type="button"
        >
          Continue to Review
        </button>
      </div>
    </div>
  );
}

function RowPhoto({ photo }: { photo?: ListingPhotoItem | null }) {
  if (!photo) {
    return (
      <div className="hidden h-[72px] w-[72px] rounded-md bg-stone-200 sm:block" />
    );
  }

  return (
    <Image
      alt={photo.alt_text || "Breed photo"}
      className="h-[72px] w-[72px] rounded-md object-cover"
      height={photo.height_px ?? 160}
      src={toPublicImageUrl(photo.public_url)}
      unoptimized
      width={photo.width_px ?? 160}
    />
  );
}

function InventoryStep({
  aliasSearchError,
  breedChoices,
  isPreparingDraft,
  onBack,
  onPriceAdjustmentChange,
  onSubmit,
  priceAdjustment,
  recentBreedChoices,
  rows,
  setRows,
  validationErrors,
}: {
  aliasSearchError: string | null;
  breedChoices: BreedChoice[];
  isPreparingDraft: boolean;
  onBack: () => void;
  onPriceAdjustmentChange: (value: PriceAdjustmentState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  priceAdjustment: PriceAdjustmentState;
  recentBreedChoices: BreedChoice[];
  rows: InventoryRow[];
  setRows: Dispatch<SetStateAction<InventoryRow[]>>;
  validationErrors: string[];
}) {
  function updateRow(rowId: string, updates: Partial<InventoryRow>) {
    setRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, ...updates } : row)),
    );
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        breedChoice: "",
        inventoryType: "",
        customLabel: "",
        quantity: "",
        price: "",
      },
    ]);
  }

  function removeRow(rowId: string) {
    setRows((current) =>
      current.length === 1
        ? current
        : current.filter((row) => row.id !== rowId),
    );
  }

  return (
    <SellerCard className="p-5">
      <form className="grid gap-5" onSubmit={onSubmit}>
        <div>
          <h2 className="text-xl font-semibold text-stone-950">
            Available Birds
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Add what you have available from this hatch date.
          </p>
        </div>

        {breedChoices.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
            Breed options are not available for the selected species yet.
          </div>
        ) : null}

        <div className="grid gap-4">
          {rows.map((row, index) => (
            <div
              key={row.id}
              className="rounded-lg border border-stone-200 bg-stone-50 p-4"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="font-semibold text-stone-950">
                  Available Option {index + 1}
                </h3>
                <button
                  className="seller-small-button"
                  disabled={rows.length === 1}
                  onClick={() => removeRow(row.id)}
                  type="button"
                >
                  Remove
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Breed
                  <BreedCombobox
                    aliasSearchError={aliasSearchError}
                    choices={breedChoices}
                    recentChoices={recentBreedChoices}
                    value={row.breedChoice}
                    onChange={(value) => updateRow(row.id, { breedChoice: value })}
                  />
                </label>

                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Type
                  <select
                    className="seller-form-field"
                    value={row.inventoryType}
                    onChange={(event) =>
                      updateRow(row.id, {
                        inventoryType: event.target.value as InventoryType | "",
                        customLabel:
                          event.target.value === "other" ? row.customLabel : "",
                      })
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
                    value={row.quantity}
                    onChange={(event) =>
                      updateRow(row.id, { quantity: event.target.value })
                    }
                  />
                </label>

                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Price
                  <MoneyInput
                    value={row.price}
                    onChange={(value) => updateRow(row.id, { price: value })}
                  />
                </label>
              </div>

              {row.inventoryType === "other" ? (
                <label className="mt-4 grid gap-1 text-sm font-semibold text-stone-700">
                  Type label
                  <input
                    className="seller-form-field"
                    placeholder="Example: Started pullets"
                    value={row.customLabel}
                    onChange={(event) =>
                      updateRow(row.id, { customLabel: event.target.value })
                    }
                  />
                </label>
              ) : null}
            </div>
          ))}
        </div>

        <PriceAdjustmentFields
          value={priceAdjustment}
          onChange={onPriceAdjustmentChange}
        />

        <button className="seller-secondary-button w-full" onClick={addRow} type="button">
          Add Another Breed or Type
        </button>

        <ValidationMessage errors={validationErrors} />

        <div className="flex flex-col gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <button className="seller-secondary-button" onClick={onBack} type="button">
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

function validateDetails(form: GroupFormState) {
  const errors: string[] = [];

  if (!form.speciesId) errors.push("Choose a species.");
  if (!form.hatchDate) errors.push("Add a hatch date.");
  if (!form.availableDate) errors.push("Add an available date.");

  if (
    form.hatchDate &&
    form.availableDate &&
    form.availableDate < form.hatchDate
  ) {
    errors.push("Available date cannot be before the hatch date.");
  }

  return errors;
}

function validateRows(rows: InventoryRow[], breedChoices: BreedChoice[]) {
  const errors: string[] = [];
  const rowKeys = new Set<string>();

  if (rows.length === 0) {
    return ["Add at least one available bird."];
  }

  rows.forEach((row, index) => {
    const rowLabel = `Available Option ${index + 1}`;
    const breedChoice = breedChoices.find(
      (choice) => choice.value === row.breedChoice,
    );

    if (!row.breedChoice || !breedChoice) errors.push(`${rowLabel}: choose a breed.`);
    if (!row.inventoryType) errors.push(`${rowLabel}: choose a type.`);

    if (row.inventoryType === "other" && !row.customLabel.trim()) {
      errors.push(`${rowLabel}: add a type label.`);
    }

    if (!isPositiveWholeNumber(row.quantity)) {
      errors.push(`${rowLabel}: quantity must be a whole number of 1 or more.`);
    }

    if (!row.price.trim()) {
      errors.push(`${rowLabel}: add a price.`);
    } else if (!isValidMoney(row.price)) {
      errors.push(`${rowLabel}: use a valid price.`);
    }

    if (row.breedChoice && row.inventoryType) {
      const rowKey = `${row.breedChoice}:${row.inventoryType}:${row.customLabel}`;

      if (rowKeys.has(rowKey)) {
        errors.push(`${rowLabel}: this breed and type is already listed.`);
      }

      rowKeys.add(rowKey);
    }
  });

  return errors;
}

async function resolveSellerBreedProfileForListing(
  storeId: string,
  speciesId: string,
  breedChoice: BreedChoice,
  sellerProfiles: SellerBreedProfileOption[],
  allSellerProfiles: BatchSellerBreedProfileOption[],
): Promise<BreedProfileResolution> {
  const existingProfile =
    breedChoice.kind === "profile"
      ? sellerProfiles.find((profile) => profile.id === breedChoice.profileId)
      : null;

  if (breedChoice.kind === "profile") {
    if (!existingProfile) {
      return {
        ok: false,
        message: "Selected seller breed profile was not loaded.",
      };
    }

    if (existingProfile.species_id !== speciesId) {
      return {
        ok: false,
        message: "Selected seller breed profile does not match species.",
      };
    }

    return { ok: true, profileId: existingProfile.id };
  }

  if (!breedChoice.breedId) {
    return {
      ok: false,
      message: "Selected catalog breed did not include a breed id.",
    };
  }

  const existingCatalogProfile = allSellerProfiles.find(
    (profile) =>
      profile.species_id === speciesId &&
      profile.breed_id === breedChoice.breedId,
  );

  if (existingCatalogProfile) {
    return ensureSellerBreedProfileActive(storeId, existingCatalogProfile);
  }

  const { data, error } = await supabase.rpc("seller_upsert_breed_profile", {
    p_store_id: storeId,
    p_species_id: speciesId,
    p_breed_id: breedChoice.breedId,
    p_custom_breed_name: null,
    p_display_name: breedChoice.label,
    p_seller_description: null,
    p_seller_notes: null,
    p_visibility_status: "active",
    p_seller_breed_profile_id: null,
  });

  if (error) return { ok: false, message: error.message };

  const profileRows = Array.isArray(data)
    ? (data as { seller_breed_profile_id: string }[])
    : [];
  const profileId = profileRows[0]?.seller_breed_profile_id;

  if (!profileId) {
    return { ok: false, message: "Breed profile RPC returned no profile id." };
  }

  return { ok: true, profileId };
}

async function ensureSellerBreedProfileActive(
  storeId: string,
  profile: SellerBreedProfileOption,
): Promise<BreedProfileResolution> {
  if (profile.visibility_status === "active") {
    return { ok: true, profileId: profile.id };
  }

  const { error } = await supabase.rpc("seller_upsert_breed_profile", {
    p_store_id: storeId,
    p_species_id: profile.species_id,
    p_breed_id: profile.breed_id,
    p_custom_breed_name: profile.custom_breed_name,
    p_display_name: profile.display_name,
    p_seller_description: profile.seller_description,
    p_seller_notes: profile.seller_notes,
    p_visibility_status: "active",
    p_seller_breed_profile_id: profile.id,
  });

  if (error) return { ok: false, message: error.message };

  return { ok: true, profileId: profile.id };
}

function buildBreedGroupsPayload(
  rows: InventoryRow[],
  profileIdsByChoice: Map<string, string>,
  basePrice: number,
) {
  const rowsByBreedChoice = new Map<string, InventoryRow[]>();

  rows.forEach((row) => {
    rowsByBreedChoice.set(row.breedChoice, [
      ...(rowsByBreedChoice.get(row.breedChoice) ?? []),
      row,
    ]);
  });

  return Array.from(rowsByBreedChoice.entries()).map(
    ([breedChoice, breedRows], breedIndex) => ({
      seller_breed_profile_id: profileIdsByChoice.get(breedChoice),
      sort_order: breedIndex,
      visibility_status: "active",
      inventory_items: breedRows.map((row, rowIndex) => ({
        inventory_type: row.inventoryType,
        custom_inventory_label:
          row.inventoryType === "other" ? row.customLabel.trim() : null,
        quantity_available: Number(row.quantity),
        price_override: Number(row.price) === basePrice ? null : Number(row.price),
        sort_order: rowIndex,
        visibility_status: "active",
      })),
    }),
  );
}

function buildRowsFromDraftRows(rows: SellerInventoryManagementRow[]) {
  return rows
    .filter(
      (row) =>
        row.inventory_visibility_status === "active" &&
        row.listing_batch_breed_visibility_status === "active",
    )
    .map((row) => ({
      id: row.inventory_item_id,
      breedChoice: `profile:${row.seller_breed_profile_id}`,
      inventoryType: row.inventory_type as InventoryType,
      customLabel: row.custom_inventory_label ?? "",
      quantity: String(row.quantity_available ?? ""),
      price: String(row.effective_unit_price ?? row.base_price ?? ""),
    }));
}

function buildGroupWorkflowRows({
  allSellerProfiles,
  breedChoices,
  form,
  priceAdjustment,
  profileIdsByChoice,
  rows,
  selectedSpecies,
  storeId,
}: {
  allSellerProfiles: BatchSellerBreedProfileOption[];
  breedChoices: BreedChoice[];
  form: GroupFormState;
  priceAdjustment: PriceAdjustmentState;
  profileIdsByChoice: Record<string, string>;
  rows: InventoryRow[];
  selectedSpecies?: ReferenceSpecies;
  storeId: string;
}): SellerInventoryManagementRow[] {
  if (!selectedSpecies) return [];

  const basePrice = rows[0]?.price && isValidMoney(rows[0].price)
    ? Number(rows[0].price)
    : null;

  if (basePrice == null) return [];

  return rows.flatMap((row, index) => {
    const profileId = profileIdsByChoice[row.breedChoice];
    const breedChoice = breedChoices.find(
      (choice) => choice.value === row.breedChoice,
    );
    const profile = profileId
      ? allSellerProfiles.find((item) => item.id === profileId)
      : null;

    if (
      !profileId ||
      !breedChoice ||
      !row.inventoryType ||
      !isPositiveWholeNumber(row.quantity) ||
      !isValidMoney(row.price)
    ) {
      return [];
    }

    const rowPrice = Number(row.price);

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
        base_price: basePrice,
        batch_type: "live_animals",
        breed_display_name: profile?.display_name ?? breedChoice.label,
        custom_inventory_label:
          row.inventoryType === "other" ? row.customLabel.trim() : null,
        effective_unit_price: rowPrice,
        internal_batch_label: form.internalLabel.trim() || null,
        inventory_item_id: `workflow-group-inventory-${row.id}`,
        inventory_item_sort_order: index,
        inventory_moderation_status: "normal",
        inventory_seller_notes: null,
        inventory_type: row.inventoryType,
        inventory_updated_at: null,
        inventory_visibility_status: "active",
        listing_batch_breed_id: `workflow-group-breed-${profileId}`,
        listing_batch_breed_moderation_status: "normal",
        listing_batch_breed_seller_notes: null,
        listing_batch_breed_sort_order: index,
        listing_batch_breed_visibility_status: "active",
        listing_batch_id: "workflow-group",
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
        price_override: rowPrice === basePrice ? null : rowPrice,
        quantity_available: Number(row.quantity),
        seller_breed_profile_id: profileId,
        species_id: selectedSpecies.id,
        species_name: selectedSpecies.common_name,
        species_slug: selectedSpecies.slug,
        store_id: storeId,
      },
    ];
  });
}

function buildPublicDescriptionFromRows(
  rows: SellerInventoryManagementRow[],
  profiles: BatchSellerBreedProfileOption[],
) {
  const profileDescriptions = uniqueSorted(
    rows
      .map((row) =>
        profiles
          .find((profile) => profile.id === row.seller_breed_profile_id)
          ?.seller_description?.trim(),
      )
      .filter((value): value is string => Boolean(value)),
  );

  return profileDescriptions.join("\n\n");
}

function addBreedContentWarnings({
  mediaItems,
  profiles,
  report,
  rows,
}: {
  mediaItems: ListingPhotoItem[];
  profiles: BatchSellerBreedProfileOption[];
  report: PublishReadinessReport;
  rows: SellerInventoryManagementRow[];
}) {
  const breedWarnings = sortBreedContentRows(
    uniqueBreedRows(rows),
    profiles,
    mediaItems,
  ).flatMap((row) => {
    const warnings: string[] = [];
    const description = getBreedProfileDescription(
      row.seller_breed_profile_id,
      profiles,
    );

    if (!hasBreedProfilePhoto(row.seller_breed_profile_id, mediaItems)) {
      warnings.push(`${row.breed_display_name} is missing photos.`);
    }

    if (!description) {
      warnings.push(`${row.breed_display_name} is missing a description.`);
    }

    return warnings;
  });

  return {
    ...report,
    publishGate: {
      ...report.publishGate,
      warnings: [
        ...report.publishGate.warnings.filter(
          (warning) =>
            warning !== "No photos are attached." &&
            warning !== "No public description is filled in.",
        ),
        ...breedWarnings,
      ],
    },
  } satisfies PublishReadinessReport;
}

function getBreedProfileDescription(
  sellerBreedProfileId: string,
  profiles: BatchSellerBreedProfileOption[],
) {
  return (
    profiles
      .find((profile) => profile.id === sellerBreedProfileId)
      ?.seller_description?.trim() ?? null
  );
}

function uniqueBreedRows(rows: SellerInventoryManagementRow[]) {
  const seenProfileIds = new Set<string>();
  const breedRows: SellerInventoryManagementRow[] = [];

  rows.forEach((row) => {
    if (seenProfileIds.has(row.seller_breed_profile_id)) return;

    seenProfileIds.add(row.seller_breed_profile_id);
    breedRows.push(row);
  });

  return breedRows;
}

function sortBreedContentRows(
  rows: SellerInventoryManagementRow[],
  profiles: BatchSellerBreedProfileOption[],
  mediaItems: ListingPhotoItem[],
) {
  return [...rows].sort((first, second) => {
    const firstScore = getBreedContentMissingScore(first, profiles, mediaItems);
    const secondScore = getBreedContentMissingScore(second, profiles, mediaItems);

    if (firstScore !== secondScore) return secondScore - firstScore;

    return first.breed_display_name.localeCompare(second.breed_display_name);
  });
}

function getBreedContentMissingScore(
  row: SellerInventoryManagementRow,
  profiles: BatchSellerBreedProfileOption[],
  mediaItems: ListingPhotoItem[],
) {
  let score = 0;

  if (!getBreedProfileDescription(row.seller_breed_profile_id, profiles)) {
    score += 1;
  }

  if (!hasBreedProfilePhoto(row.seller_breed_profile_id, mediaItems)) {
    score += 1;
  }

  return score;
}

function hasBreedProfilePhoto(
  sellerBreedProfileId: string,
  mediaItems: ListingPhotoItem[],
) {
  return Boolean(
    pickFeaturedPhoto(
      mediaItems.filter(
        (item) =>
          item.entity_type === "seller_breed_profile" &&
          item.entity_id === sellerBreedProfileId,
      ),
    ),
  );
}

function toPublicImageUrl(publicUrl: string) {
  if (publicUrl.startsWith("http")) return publicUrl;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (publicUrl.startsWith("/") && supabaseUrl) {
    return `${supabaseUrl}${publicUrl}`;
  }

  return publicUrl;
}

function normalizeCustomLabel(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
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

export { GroupListingForm as BatchListingForm };
