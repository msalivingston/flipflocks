"use client";

import Link from "next/link";
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
import { ListingPhotosSection } from "../../../[listingBatchId]/listing-photos-section";
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

type GroupFormState = {
  speciesId: string;
  hatchDate: string;
  availableDate: string;
  publicDescription: string;
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

const emptyGroupForm: GroupFormState = {
  speciesId: "",
  hatchDate: "",
  availableDate: "",
  publicDescription: "",
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

const publicDescriptionMaxLength = 1000;
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
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isPreparingDraft, setIsPreparingDraft] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [listingBatchId, setListingBatchId] = useState(
    draftListingBatchId ?? "",
  );
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

  const breedChoices = useMemo(
    () => buildBreedChoices(form.speciesId, breeds, sellerProfiles, breedAliases),
    [breedAliases, breeds, form.speciesId, sellerProfiles],
  );
  const recentBreedChoices = useMemo(
    () => buildRecentBreedChoices(breedChoices, recentBreedProfileIds),
    [breedChoices, recentBreedProfileIds],
  );
  const selectedSpecies = species.find((item) => item.id === form.speciesId);
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

  function updateField<TKey extends keyof GroupFormState>(
    key: TKey,
    value: GroupFormState[TKey],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
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
      ...validateRows(rows, breedChoices),
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
        p_breed_groups: buildBreedGroupsPayload(rows, profileIdsByChoice, basePrice),
        p_auto_price_increase_enabled: false,
        p_auto_price_increase_amount: null,
        p_auto_price_increase_max_price: null,
        p_internal_batch_label: form.internalLabel.trim() || null,
        p_seller_notes: form.sellerNotes.trim() || null,
        p_visibility_status: "hidden",
      },
    );

    if (createResult.error) {
      setDraftError(createResult.error.message);
      return null;
    }

    const createdRows = Array.isArray(createResult.data)
      ? (createResult.data as CreateListingBatchResult[])
      : [];
    const createdListingBatchId = createdRows[0]?.listing_batch_id;

    if (!createdListingBatchId) {
      setDraftError("The listing draft was not prepared. Please try again.");
      return null;
    }

    setListingBatchId(createdListingBatchId);
    const priceAdjustmentSaved = await savePriceAdjustment(createdListingBatchId);

    if (!priceAdjustmentSaved) return null;

    const loadedRows = await loadDraft(createdListingBatchId);

    if (loadedRows) {
      const createdInventoryRows = buildRowsFromDraftRows(loadedRows);
      setRows(createdInventoryRows);
    }

    return createdListingBatchId;
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
    const mediaEntityIds = [
      currentListingBatchId,
      ...loadedRows.map((row) => row.inventory_item_id),
    ];
    const mediaResult = await supabase
      .from("seller_media_management")
      .select(sellerMediaSelect)
      .eq("store_id", storeId)
      .in("entity_type", ["listing_batch", "inventory_item"])
      .in("entity_id", mediaEntityIds)
      .returns<ListingPhotoItem[]>();

    if (mediaResult.error) {
      setDraftError(mediaResult.error.message);
      return null;
    }

    setDraftRows(loadedRows);
    setMediaItems(mediaResult.data ?? []);

    if (hydrate && loadedRows.length > 0) {
      const firstRow = loadedRows[0];
      const hydratedRows = buildRowsFromDraftRows(loadedRows);

      setPriceAdjustment(hydratePriceAdjustment(firstRow));
      setForm({
        speciesId: firstRow.species_id,
        hatchDate: firstRow.origin_date ?? "",
        availableDate: firstRow.available_date,
        publicDescription: "",
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

              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Description
                <textarea
                  className="seller-form-field min-h-32 resize-y py-3"
                  maxLength={publicDescriptionMaxLength}
                  placeholder="Tell buyers what they should know about this hatch."
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
              setPublishError(null);
            }}
            onBack={() => setStep("details")}
            onSubmit={handleInventorySubmit}
          />
        ) : null}

        {step === "photos" && listingBatchId ? (
          <GroupListingPhotosStep
            canManage
            draftRows={draftRows}
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
                rows={draftRows.map((row) => ({
                  id: row.inventory_item_id,
                  breed: row.breed_display_name,
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
                        item.entity_type === "inventory_item" &&
                        item.entity_id === row.inventory_item_id,
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
      title="Group Listing"
      description="Multiple types or breeds from the same hatch date."
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

function GroupListingPhotosStep({
  canManage,
  draftRows,
  listingBatchId,
  mediaItems,
  onBack,
  onContinue,
  onReload,
  storeId,
}: {
  canManage: boolean;
  draftRows: SellerInventoryManagementRow[];
  listingBatchId: string;
  mediaItems: ListingPhotoItem[];
  onBack: () => void;
  onContinue: () => void;
  onReload: () => void;
  storeId: string;
}) {
  const listingMediaItems = mediaItems.filter(
    (item) =>
      item.entity_type === "listing_batch" && item.entity_id === listingBatchId,
  );

  return (
    <div className="grid gap-5">
      <ListingPhotosSection
        canManage={canManage}
        description="Add general photos for this hatch. Option photos can be added below."
        emptyDescription="Add photos that represent the full hatch or group."
        listingBatchId={listingBatchId}
        mediaItems={listingMediaItems}
        mode="setup"
        storeId={storeId}
        title="Listing photos"
        onReload={onReload}
      />

      <div className="grid gap-4">
        {draftRows.map((row) => {
          const rowTitle = `${row.breed_display_name} ${formatInventoryType(
            row.inventory_type,
            row.custom_inventory_label,
          )}`;
          const rowMediaItems = mediaItems.filter(
            (item) =>
              item.entity_type === "inventory_item" &&
              item.entity_id === row.inventory_item_id,
          );

          return (
            <ListingPhotosSection
              key={row.inventory_item_id}
              canManage={canManage}
              description="Add photos for this specific available option."
              emptyDescription="Add photos that help buyers recognize this breed and type."
              entityId={row.inventory_item_id}
              entityType="inventory_item"
              listingBatchId={listingBatchId}
              mediaItems={rowMediaItems}
              mode="setup"
              storeId={storeId}
              title={rowTitle}
              onReload={onReload}
            />
          );
        })}
      </div>

      <div className="flex flex-col gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <button className="seller-secondary-button" onClick={onBack} type="button">
          Back to Available Birds
        </button>
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
          onClick={onContinue}
          type="button"
        >
          Continue to Review
        </button>
      </div>
    </div>
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

  if (form.publicDescription.length > publicDescriptionMaxLength) {
    errors.push(
      `Description must be ${publicDescriptionMaxLength} characters or less.`,
    );
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
    return { ok: true, profileId: existingCatalogProfile.id };
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
        price_override: Number(row.price) === basePrice ? null : row.price,
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

function normalizeCustomLabel(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export { GroupListingForm as BatchListingForm };
