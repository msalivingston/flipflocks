"use client";

import Link from "next/link";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { getPlanCapabilities } from "@/lib/plan-capabilities";
import { supabase } from "@/lib/supabase";
import { PlanUpgradePrompt } from "../../_components/plan-upgrade-prompt";
import { useSellerContext } from "../../_components/seller-context";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SellerCard,
  SellerPageHeader,
  StatusBadge,
} from "../../_components/seller-ui";
import type { SellerInventoryManagementRow } from "../../_lib/seller-types";
import {
  calculateAdjustedUnitPrice,
  formatAgeAtAvailability,
  formatInventoryTypeLabel,
  type PriceAdjustmentDirection,
} from "../../_lib/listing-formatters";
import {
  formatAgeAtAvailabilityFromDates,
  MoneyInput as SharedMoneyInput,
} from "../new/_components/creation-wizard-shared";
import {
  ListingPhotosSection,
  type ListingPhotoItem,
} from "./listing-photos-section";
import {
  buildPublishReadinessReport,
  type PublishReadinessListing,
  type PublishReadinessMediaSummary,
} from "./publish-readiness";
import { PublishReadinessReview } from "./publish-readiness-review";

type ListingDetailSummary = PublishReadinessListing;
type DetailExperience = "listing" | "inventory";

type EditBasicsState = {
  originDate: string;
  availableDate: string;
  basePrice: string;
  autoPriceAdjustmentEnabled: boolean;
  priceAdjustmentDirection: PriceAdjustmentDirection;
  priceAdjustmentAmount: string;
  priceAdjustmentIntervalWeeks: string;
  priceAdjustmentMaxPrice: string;
  priceAdjustmentMinPrice: string;
  internalLabel: string;
  publicDescription: string;
  sellerNotes: string;
};

type EditInventoryRow = {
  inventoryItemId: string;
  listingBatchBreedId: string;
  inventoryType: string;
  customLabel: string;
  quantityAvailable: string;
  priceOverride: string;
  sortOrder: number;
  sellerNotes: string;
  isNew: boolean;
  isRemoved: boolean;
};

type OperationalEditRow = {
  inventoryItemId: string;
  inventoryType: string;
  customLabel: string;
  quantityAvailable: string;
  priceOverride: string;
  sortOrder: number;
  sellerNotes: string;
  visibilityStatus: string;
};

type SellerBreedProfileRead = {
  id: string;
  species_id: string;
  breed_id: string | null;
  custom_breed_name: string | null;
  display_name: string;
  seller_description: string | null;
  seller_notes: string | null;
  visibility_status: string;
  bird_type: string | null;
  egg_color: string | null;
  annual_egg_production: string | null;
};

const listingDetailSelect =
  "store_id, listing_batch_id, listing_batch_breed_id, inventory_item_id, species_id, species_name, species_slug, seller_breed_profile_id, breed_display_name, batch_type, origin_date, available_date, age_at_availability_days, base_price, auto_price_increase_enabled, auto_price_increase_amount, auto_price_increase_max_price, auto_price_adjustment_enabled, price_adjustment_direction, price_adjustment_amount, price_adjustment_interval_weeks, price_adjustment_max_price, price_adjustment_min_price, internal_batch_label, listing_batch_visibility_status, listing_batch_moderation_status, listing_batch_breed_sort_order, listing_batch_breed_visibility_status, listing_batch_breed_moderation_status, inventory_type, custom_inventory_label, quantity_available, price_override, effective_unit_price, inventory_item_sort_order, inventory_visibility_status, inventory_moderation_status, operational_availability_status, inventory_seller_notes, listing_batch_breed_seller_notes, listing_batch_seller_notes, inventory_updated_at, listing_batch_updated_at";

const sellerMediaSelect =
  "media_asset_id, media_link_id, store_id, entity_type, entity_id, display_context, public_url, alt_text, caption, sort_order, is_featured, crop_metadata, moderation_status, asset_status, visibility_status, original_filename, content_type, file_size_bytes, width_px, height_px";

const sellerBreedProfileSelect =
  "id, species_id, breed_id, custom_breed_name, display_name, seller_description, seller_notes, visibility_status, bird_type, egg_color, annual_egg_production";

const publicDescriptionMaxLength = 1000;

const liveAnimalInventoryTypes = [
  { label: "Female (pullet or hen)", value: "female" },
  { label: "Male (cockerel or rooster)", value: "male" },
  { label: "Straight Run", value: "straight_run" },
  { label: "Pair", value: "pair" },
  { label: "Trio", value: "trio" },
  { label: "Other", value: "other" },
];

const hatchingEggInventoryTypes = [
  { label: "Hatching eggs", value: "hatching_eggs" },
];

/**
 * Seller-private saved listing detail page.
 *
 * The read path intentionally uses `seller_inventory_management`, filtered by
 * the active seller store and route listing ID, so the page stays within the
 * existing RLS and projection model without adding a detail backend layer.
 */
export function ListingDetail({
  experience = "listing",
  listingBatchId,
}: {
  experience?: DetailExperience;
  listingBatchId: string;
}) {
  const isInventoryExperience = experience === "inventory";
  const { seller } = useSellerContext();
  const plan = getPlanCapabilities(seller?.plan_key);
  const storeId = seller?.store_id ?? "";
  const [rows, setRows] = useState<SellerInventoryManagementRow[]>([]);
  const [breedProfiles, setBreedProfiles] = useState<SellerBreedProfileRead[]>(
    [],
  );
  const [mediaItems, setMediaItems] = useState<ListingPhotoItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editBasics, setEditBasics] = useState<EditBasicsState | null>(null);
  const [editRows, setEditRows] = useState<EditInventoryRow[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isOperationalEditing, setIsOperationalEditing] = useState(false);
  const [operationalRows, setOperationalRows] = useState<OperationalEditRow[]>(
    [],
  );
  const [operationalValidationErrors, setOperationalValidationErrors] =
    useState<string[]>([]);
  const [operationalSaveError, setOperationalSaveError] = useState<string | null>(
    null,
  );
  const [isOperationalSaving, setIsOperationalSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isReturningToHidden, setIsReturningToHidden] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isRestoringArchived, setIsRestoringArchived] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [isPublicContentEditing, setIsPublicContentEditing] = useState(false);
  const [publicDescriptionDraft, setPublicDescriptionDraft] = useState("");
  const [publicContentError, setPublicContentError] = useState<string | null>(
    null,
  );
  const [isPublicContentSaving, setIsPublicContentSaving] = useState(false);
  const [showPublishReview, setShowPublishReview] = useState(false);
  const [mediaSummary, setMediaSummary] = useState<PublishReadinessMediaSummary>({
    activeCount: 0,
    totalCount: 0,
  });

  useEffect(() => {
    if (!storeId) return;

    let isMounted = true;

    async function loadListing() {
      setIsLoading(true);
      setError(null);

      const { data, error: listingError } = await supabase
        .from("seller_inventory_management")
        .select(listingDetailSelect)
        .eq("store_id", storeId)
        .eq("listing_batch_id", listingBatchId)
        .order("listing_batch_breed_sort_order", { ascending: true })
        .order("inventory_item_sort_order", { ascending: true })
        .returns<SellerInventoryManagementRow[]>();

      if (!isMounted) return;

      if (listingError) {
        setError(listingError.message);
        setIsLoading(false);
        return;
      }

      const listingRows = data ?? [];
      setRows(listingRows);

      if (listingRows.length > 0) {
        const profileIds = uniqueSorted(
          listingRows.map((row) => row.seller_breed_profile_id),
        );
        const { data: profileData, error: profileError } = await supabase
          .from("seller_breed_profiles")
          .select(sellerBreedProfileSelect)
          .eq("store_id", storeId)
          .in("id", profileIds)
          .returns<SellerBreedProfileRead[]>();

        if (!isMounted) return;

        if (profileError) {
          setError(profileError.message);
          setIsLoading(false);
          return;
        }

        setBreedProfiles(profileData ?? []);

        const mediaEntityIds = uniqueSorted([
          listingBatchId,
          ...listingRows.map((row) => row.listing_batch_breed_id),
          ...listingRows.map((row) => row.inventory_item_id),
        ]);
        const { data: mediaData, error: mediaError } = await supabase
          .from("seller_media_management")
          .select(sellerMediaSelect)
          .eq("store_id", storeId)
          .in("entity_id", mediaEntityIds)
          .returns<ListingPhotoItem[]>();

        if (!isMounted) return;

        if (mediaError) {
          setError(mediaError.message);
          setIsLoading(false);
          return;
        }

        const relevantMedia = (mediaData ?? []).filter((item) =>
          isListingMedia(item, mediaEntityIds),
        );
        const activeListingMedia = relevantMedia.filter(
          (item) =>
            item.visibility_status === "active" &&
            item.asset_status === "active" &&
            item.moderation_status === "approved",
        );

        setMediaItems(sortListingMedia(relevantMedia));

        setMediaSummary({
          activeCount: activeListingMedia.length,
          totalCount: relevantMedia.length,
        });
      } else {
        setBreedProfiles([]);
        setMediaItems([]);
        setMediaSummary({ activeCount: 0, totalCount: 0 });
      }

      setIsLoading(false);
    }

    void loadListing();

    return () => {
      isMounted = false;
    };
  }, [listingBatchId, reloadKey, storeId]);

  const listing = useMemo(
    () => summarizeListing(rows, breedProfiles),
    [breedProfiles, rows],
  );
  const canUseSetupTools = listing?.visibilityStatus === "hidden";
  const canUseOperationalTools = listing?.visibilityStatus === "active";
  const canUsePublicContentTools = listing?.visibilityStatus === "active";
  const canArchiveListing =
    listing?.visibilityStatus === "active" ||
    listing?.visibilityStatus === "hidden";
  const canRestoreArchivedListing = listing?.visibilityStatus === "archived";
  const publishReadinessReport = useMemo(
    () =>
      listing
        ? buildPublishReadinessReport({
            listing,
            media: mediaSummary,
            seller,
          })
        : null,
    [listing, mediaSummary, seller],
  );

  function startEditing(currentListing: ListingDetailSummary) {
    setIsOperationalEditing(false);
    setIsPublicContentEditing(false);
    setPublicContentError(null);
    setOperationalRows([]);
    setOperationalValidationErrors([]);
    setOperationalSaveError(null);
    setShowPublishReview(false);
    setPublishError(null);
    setLifecycleError(null);
    setEditBasics({
      originDate: currentListing.originDate ?? "",
      availableDate: currentListing.availableDate,
      basePrice: currentListing.basePrice?.toString() ?? "",
      autoPriceAdjustmentEnabled: currentListing.autoPriceAdjustmentEnabled,
      priceAdjustmentDirection:
        currentListing.priceAdjustmentDirection === "decrease"
          ? "decrease"
          : "increase",
      priceAdjustmentAmount:
        currentListing.priceAdjustmentAmount?.toString() ?? "",
      priceAdjustmentIntervalWeeks:
        currentListing.priceAdjustmentIntervalWeeks?.toString() ?? "1",
      priceAdjustmentMaxPrice:
        currentListing.priceAdjustmentMaxPrice?.toString() ?? "",
      priceAdjustmentMinPrice:
        currentListing.priceAdjustmentMinPrice?.toString() ?? "",
      internalLabel: currentListing.internalLabel ?? "",
      publicDescription: currentListing.publicDescription ?? "",
      sellerNotes: currentListing.sellerNotes ?? "",
    });
    setEditRows(
      currentListing.rows.map((row) => ({
        inventoryItemId: row.inventory_item_id,
        listingBatchBreedId: row.listing_batch_breed_id,
        inventoryType: row.inventory_type,
        customLabel: row.custom_inventory_label ?? "",
        quantityAvailable: (row.quantity_available ?? 0).toString(),
        priceOverride: row.price_override?.toString() ?? "",
        sortOrder: row.inventory_item_sort_order ?? 0,
        sellerNotes: row.inventory_seller_notes ?? "",
        isNew: false,
        isRemoved: false,
      })),
    );
    setValidationErrors([]);
    setSaveError(null);
    setSuccessMessage(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    setEditBasics(null);
    setEditRows([]);
    setValidationErrors([]);
    setSaveError(null);
  }

  function startOperationalEditing(currentListing: ListingDetailSummary) {
    setIsEditing(false);
    setIsPublicContentEditing(false);
    setPublicContentError(null);
    setEditBasics(null);
    setEditRows([]);
    setValidationErrors([]);
    setSaveError(null);
    setShowPublishReview(false);
    setPublishError(null);
    setLifecycleError(null);
    setSuccessMessage(null);
    setOperationalRows(
      currentListing.rows
        .filter((row) => row.inventory_visibility_status === "active")
        .map((row) => ({
          inventoryItemId: row.inventory_item_id,
          inventoryType: row.inventory_type,
          customLabel: row.custom_inventory_label ?? "",
          quantityAvailable: (row.quantity_available ?? 0).toString(),
          priceOverride: row.price_override?.toString() ?? "",
          sortOrder: row.inventory_item_sort_order ?? 0,
          sellerNotes: row.inventory_seller_notes ?? "",
          visibilityStatus: row.inventory_visibility_status,
        })),
    );
    setOperationalValidationErrors([]);
    setOperationalSaveError(null);
    setIsOperationalEditing(true);
  }

  function cancelOperationalEditing() {
    setIsOperationalEditing(false);
    setOperationalRows([]);
    setOperationalValidationErrors([]);
    setOperationalSaveError(null);
  }

  function startPublicContentEditing(currentListing: ListingDetailSummary) {
    setIsEditing(false);
    setEditBasics(null);
    setEditRows([]);
    setValidationErrors([]);
    setSaveError(null);
    setIsOperationalEditing(false);
    setOperationalRows([]);
    setOperationalValidationErrors([]);
    setOperationalSaveError(null);
    setShowPublishReview(false);
    setPublishError(null);
    setLifecycleError(null);
    setSuccessMessage(null);
    setPublicDescriptionDraft(currentListing.publicDescription ?? "");
    setPublicContentError(null);
    setIsPublicContentEditing(true);
  }

  function cancelPublicContentEditing() {
    setIsPublicContentEditing(false);
    setPublicDescriptionDraft("");
    setPublicContentError(null);
  }

  function closeActiveEditModes() {
    setIsEditing(false);
    setEditBasics(null);
    setEditRows([]);
    setValidationErrors([]);
    setSaveError(null);
    setIsOperationalEditing(false);
    setOperationalRows([]);
    setOperationalValidationErrors([]);
    setOperationalSaveError(null);
    setIsPublicContentEditing(false);
    setPublicDescriptionDraft("");
    setPublicContentError(null);
    setShowPublishReview(false);
    setPublishError(null);
  }

  async function updateListingBreedDescriptions(
    currentListing: ListingDetailSummary,
    publicDescription: string,
  ) {
    const nextDescription = publicDescription.trim() || null;

    if ((currentListing.publicDescription ?? null) === nextDescription) {
      return null;
    }

    if (breedProfiles.length !== 1) {
      return "Public description editing is only available for single-breed listings right now.";
    }

    const profile = breedProfiles[0];
    const result = await supabase.rpc("seller_upsert_breed_profile", {
      p_store_id: storeId,
      p_species_id: profile.species_id,
      p_breed_id: profile.breed_id,
      p_custom_breed_name: profile.custom_breed_name,
      p_display_name: profile.display_name,
      p_seller_description: nextDescription,
      p_seller_notes: profile.seller_notes,
      p_visibility_status: profile.visibility_status,
      p_seller_breed_profile_id: profile.id,
    });

    return result.error?.message ?? null;
  }

  async function savePriceAdjustment(
    listingBatchId: string,
    basics: EditBasicsState,
  ) {
    const effectiveBasics = plan.ageBasedPricingEnabled
      ? basics
      : { ...basics, autoPriceAdjustmentEnabled: false };
    const result = await supabase.rpc("seller_set_listing_batch_price_adjustment", {
      p_listing_batch_id: listingBatchId,
      p_auto_price_adjustment_enabled: effectiveBasics.autoPriceAdjustmentEnabled,
      p_price_adjustment_direction: effectiveBasics.autoPriceAdjustmentEnabled
        ? effectiveBasics.priceAdjustmentDirection
        : null,
      p_price_adjustment_amount: effectiveBasics.autoPriceAdjustmentEnabled
        ? Number(effectiveBasics.priceAdjustmentAmount)
        : null,
      p_price_adjustment_interval_weeks: effectiveBasics.autoPriceAdjustmentEnabled
        ? Number(effectiveBasics.priceAdjustmentIntervalWeeks)
        : null,
      p_price_adjustment_max_price:
        effectiveBasics.autoPriceAdjustmentEnabled &&
        effectiveBasics.priceAdjustmentDirection === "increase" &&
        effectiveBasics.priceAdjustmentMaxPrice.trim()
          ? Number(effectiveBasics.priceAdjustmentMaxPrice)
          : null,
      p_price_adjustment_min_price:
        effectiveBasics.autoPriceAdjustmentEnabled &&
        effectiveBasics.priceAdjustmentDirection === "decrease" &&
        effectiveBasics.priceAdjustmentMinPrice.trim()
          ? Number(effectiveBasics.priceAdjustmentMinPrice)
          : null,
    });

    return result.error?.message ?? null;
  }

  async function saveEdits(currentListing: ListingDetailSummary) {
    if (!editBasics || !canUseSetupTools) return;

    const effectiveBasics = plan.ageBasedPricingEnabled
      ? editBasics
      : { ...editBasics, autoPriceAdjustmentEnabled: false };
    const errors = validateEditForm(effectiveBasics, editRows, currentListing);
    setValidationErrors(errors);
    setSaveError(null);
    setSuccessMessage(null);

    if (errors.length > 0) return;

    setIsSaving(true);

    const batchResult = await supabase.rpc("seller_update_listing_batch", {
      p_listing_batch_id: listingBatchId,
      p_origin_date:
        currentListing.batchType === "hatching_eggs"
          ? effectiveBasics.availableDate
          : effectiveBasics.originDate,
      p_available_date: effectiveBasics.availableDate,
      p_base_price: Number(effectiveBasics.basePrice),
      p_auto_price_increase_enabled: false,
      p_auto_price_increase_amount: null,
      p_auto_price_increase_max_price: null,
      p_internal_batch_label: effectiveBasics.internalLabel.trim() || null,
      p_seller_notes: effectiveBasics.sellerNotes.trim() || null,
    });

    if (batchResult.error) {
      setSaveError(batchResult.error.message);
      setIsSaving(false);
      return;
    }

    const priceAdjustmentResult = await savePriceAdjustment(
      listingBatchId,
      effectiveBasics,
    );

    if (priceAdjustmentResult) {
      setSaveError(priceAdjustmentResult);
      setIsSaving(false);
      return;
    }

    const breedProfileResult = await updateListingBreedDescriptions(
      currentListing,
      effectiveBasics.publicDescription,
    );

    if (breedProfileResult) {
      setSaveError(breedProfileResult);
      setIsSaving(false);
      return;
    }

    for (const row of editRows) {
      if (row.isRemoved) {
        if (!row.isNew) {
          const archiveResult = await supabase.rpc(
            "seller_set_inventory_visibility",
            {
              p_inventory_item_id: row.inventoryItemId,
              p_visibility_status: "archived",
              p_note: "Removed from hidden listing edit.",
            },
          );

          if (archiveResult.error) {
            setSaveError(archiveResult.error.message);
            setIsSaving(false);
            return;
          }
        }

        continue;
      }

      if (row.isNew) {
        const createResult = await supabase.rpc("seller_create_inventory_item", {
          p_listing_batch_breed_id: row.listingBatchBreedId,
          p_inventory_type: row.inventoryType,
          p_custom_inventory_label:
            row.inventoryType === "other" ? row.customLabel.trim() : null,
          p_quantity_available: Number(row.quantityAvailable),
          p_price_override: row.priceOverride.trim()
            ? Number(row.priceOverride)
            : null,
          p_sort_order: row.sortOrder,
          p_visibility_status: "active",
          p_seller_notes: row.sellerNotes.trim() || null,
        });

        if (createResult.error) {
          setSaveError(createResult.error.message);
          setIsSaving(false);
          return;
        }

        continue;
      }

      const originalRow = currentListing.rows.find(
        (item) => item.inventory_item_id === row.inventoryItemId,
      );

      const updateResult = await supabase.rpc("seller_update_inventory_item", {
        p_inventory_item_id: row.inventoryItemId,
        p_inventory_type: row.inventoryType,
        p_custom_inventory_label:
          row.inventoryType === "other" ? row.customLabel.trim() : null,
        p_price_override: row.priceOverride.trim()
          ? Number(row.priceOverride)
          : null,
        p_sort_order: row.sortOrder,
        p_seller_notes: row.sellerNotes.trim() || null,
      });

      if (updateResult.error) {
        setSaveError(updateResult.error.message);
        setIsSaving(false);
        return;
      }

      const nextQuantity = Number(row.quantityAvailable);

      if (nextQuantity !== (originalRow?.quantity_available ?? 0)) {
        const quantityResult = await supabase.rpc(
          "seller_adjust_inventory_quantity",
          {
            p_inventory_item_id: row.inventoryItemId,
            p_quantity_available: nextQuantity,
            p_quantity_delta: null,
            p_note: "Updated from seller listing detail.",
          },
        );

        if (quantityResult.error) {
          setSaveError(quantityResult.error.message);
          setIsSaving(false);
          return;
        }
      }
    }

    setIsSaving(false);
    setIsEditing(false);
    setEditBasics(null);
    setEditRows([]);
    setSuccessMessage(
      isInventoryExperience ? "Inventory changes saved." : "Listing changes saved.",
    );
    setReloadKey((current) => current + 1);
  }

  async function saveOperationalEdits(currentListing: ListingDetailSummary) {
    if (!canUseOperationalTools) return;

    const errors = validateOperationalEditRows(
      operationalRows,
      currentListing,
    );
    setOperationalValidationErrors(errors);
    setOperationalSaveError(null);
    setSuccessMessage(null);

    if (errors.length > 0) return;

    setIsOperationalSaving(true);

    for (const row of operationalRows) {
      const originalRow = currentListing.rows.find(
        (item) => item.inventory_item_id === row.inventoryItemId,
      );

      if (!originalRow || originalRow.inventory_visibility_status !== "active") {
        setOperationalSaveError(
          currentListing.batchType === "hatching_eggs"
            ? "One hatching egg row could not be updated. Refresh the listing and try again."
            : "One bird group could not be updated. Refresh the listing and try again.",
        );
        setIsOperationalSaving(false);
        return;
      }

      const nextPriceOverride = row.priceOverride.trim()
        ? Number(row.priceOverride)
        : null;
      const originalPriceOverride = originalRow.price_override ?? null;

      if (nextPriceOverride !== originalPriceOverride) {
        const updateResult = await supabase.rpc("seller_update_inventory_item", {
          p_inventory_item_id: row.inventoryItemId,
          p_inventory_type: originalRow.inventory_type,
          p_custom_inventory_label: originalRow.custom_inventory_label,
          p_price_override: nextPriceOverride,
          p_sort_order: originalRow.inventory_item_sort_order ?? 0,
          p_seller_notes: originalRow.inventory_seller_notes ?? null,
        });

        if (updateResult.error) {
          setOperationalSaveError(updateResult.error.message);
          setIsOperationalSaving(false);
          return;
        }
      }

      const nextQuantity = Number(row.quantityAvailable);

      if (nextQuantity !== (originalRow.quantity_available ?? 0)) {
        const quantityResult = await supabase.rpc(
          "seller_adjust_inventory_quantity",
          {
            p_inventory_item_id: row.inventoryItemId,
            p_quantity_available: nextQuantity,
            p_quantity_delta: null,
            p_note: "Updated from active listing operational edit.",
          },
        );

        if (quantityResult.error) {
          setOperationalSaveError(quantityResult.error.message);
          setIsOperationalSaving(false);
          return;
        }
      }
    }

    setIsOperationalSaving(false);
    setIsOperationalEditing(false);
    setOperationalRows([]);
    setOperationalValidationErrors([]);
    setSuccessMessage("Availability and pricing updated.");
    setReloadKey((current) => current + 1);
  }

  async function savePublicContent(currentListing: ListingDetailSummary) {
    if (!canUsePublicContentTools) return;

    setPublicContentError(null);
    setSuccessMessage(null);

    if (publicDescriptionDraft.trim().length > publicDescriptionMaxLength) {
      setPublicContentError(
        `Public description must be ${publicDescriptionMaxLength} characters or less.`,
      );
      return;
    }

    setIsPublicContentSaving(true);

    const descriptionResult = await updateListingBreedDescriptions(
      currentListing,
      publicDescriptionDraft,
    );

    if (descriptionResult) {
      setPublicContentError(descriptionResult);
      setIsPublicContentSaving(false);
      return;
    }

    setIsPublicContentSaving(false);
    setIsPublicContentEditing(false);
    setPublicDescriptionDraft("");
    setSuccessMessage("Public listing content updated.");
    setReloadKey((current) => current + 1);
  }

  async function publishListing() {
    if (!canUseSetupTools || !publishReadinessReport) return;

    setPublishError(null);
    setLifecycleError(null);
    setSuccessMessage(null);

    if (!publishReadinessReport.publishGate.canPublish) {
      setPublishError("Fix the required items before publishing this listing.");
      return;
    }

    setIsPublishing(true);

    const { error: visibilityError } = await supabase.rpc(
      "seller_set_listing_batch_visibility",
      {
        p_listing_batch_id: listingBatchId,
        p_visibility_status: "active",
        p_note: "Published from seller listing detail.",
      },
    );

    if (visibilityError) {
      setPublishError(
        "The listing was not published. Please review the listing and try again.",
      );
      setIsPublishing(false);
      return;
    }

    setIsPublishing(false);
    setShowPublishReview(false);
    setSuccessMessage(
      isInventoryExperience
        ? "Inventory published. Buyers can now see it on your storefront."
        : "Listing published. Buyers can now see it on your storefront.",
    );
    setReloadKey((current) => current + 1);
  }

  async function returnListingToHidden() {
    if (!canUseOperationalTools) return;

    const shouldReturnToHidden = window.confirm(
      "Return this listing to hidden? Buyers will not see it on your storefront until you publish it again.",
    );

    if (!shouldReturnToHidden) return;

    setLifecycleError(null);
    setSuccessMessage(null);
    setIsReturningToHidden(true);

    const { error: visibilityError } = await supabase.rpc(
      "seller_set_listing_batch_visibility",
      {
        p_listing_batch_id: listingBatchId,
        p_visibility_status: "hidden",
        p_note: "Returned to hidden from seller listing detail.",
      },
    );

    if (visibilityError) {
      setLifecycleError(
        "This listing was not hidden. Please refresh and try again.",
      );
      setIsReturningToHidden(false);
      return;
    }

    setIsReturningToHidden(false);
    setIsOperationalEditing(false);
    setOperationalRows([]);
    setSuccessMessage(
      isInventoryExperience
        ? "Inventory hidden from the storefront. Buyers cannot see it until you publish it again."
        : "Listing returned to hidden. Buyers cannot see it until you publish it again.",
    );
    setReloadKey((current) => current + 1);
  }

  async function archiveListing() {
    if (!canArchiveListing) return;

    const shouldArchive = window.confirm(
      listing?.batchType === "hatching_eggs"
        ? "Archive this listing? It will be hidden from buyers and kept for your records. No photos, hatching egg inventory, pricing, notes, or descriptions will be deleted."
        : "Archive this listing? It will be hidden from buyers and kept for your records. No photos, bird groups, pricing, notes, or descriptions will be deleted.",
    );

    if (!shouldArchive) return;

    setLifecycleError(null);
    setSuccessMessage(null);
    setIsArchiving(true);

    const { error: visibilityError } = await supabase.rpc(
      "seller_set_listing_batch_visibility",
      {
        p_listing_batch_id: listingBatchId,
        p_visibility_status: "archived",
        p_note: "Archived from seller listing detail.",
      },
    );

    if (visibilityError) {
      setLifecycleError(
        "This listing was not archived. Please refresh and try again.",
      );
      setIsArchiving(false);
      return;
    }

    setIsArchiving(false);
    closeActiveEditModes();
    setSuccessMessage(
      isInventoryExperience
        ? "Inventory archived. Buyers cannot see it, and historical records are preserved."
        : "Listing archived. Buyers cannot see it, and the listing is preserved for your records.",
    );
    setReloadKey((current) => current + 1);
  }

  async function restoreArchivedListing() {
    if (!canRestoreArchivedListing) return;

    const shouldRestore = window.confirm(
      "Restore this archived listing to hidden? It will stay off your storefront until you review and publish it again.",
    );

    if (!shouldRestore) return;

    setLifecycleError(null);
    setSuccessMessage(null);
    setIsRestoringArchived(true);

    const { error: visibilityError } = await supabase.rpc(
      "seller_set_listing_batch_visibility",
      {
        p_listing_batch_id: listingBatchId,
        p_visibility_status: "hidden",
        p_note: "Restored to hidden from seller listing detail.",
      },
    );

    if (visibilityError) {
      setLifecycleError(
        "This listing was not restored. Please refresh and try again.",
      );
      setIsRestoringArchived(false);
      return;
    }

    setIsRestoringArchived(false);
    closeActiveEditModes();
    setSuccessMessage(
      isInventoryExperience
        ? "Inventory restored as a draft. Review it before publishing again."
        : "Listing restored to hidden. Review it before publishing again.",
    );
    setReloadKey((current) => current + 1);
  }

  return (
    <>
      <SellerPageHeader
        eyebrow={seller?.store_name}
        title={listing?.title ?? (isInventoryExperience ? "Inventory" : "Listing Detail")}
        description={
          isInventoryExperience
            ? "Manage availability, pricing, buyer content, photos, and storefront visibility."
            : listing?.batchType === "hatching_eggs"
              ? "Review hatching egg details before publishing or future availability updates."
              : "Review listing details and bird groups before publishing or future operational updates."
        }
        action={
          <Link
            className="seller-secondary-button"
            href={isInventoryExperience ? "/dashboard/inventory" : "/dashboard/listings"}
          >
            {isInventoryExperience ? "Back to Inventory" : "Back to Listings"}
          </Link>
        }
      />

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5 sm:px-7">
        {isLoading ? (
          <LoadingState
            label={isInventoryExperience ? "Loading inventory" : "Loading listing"}
          />
        ) : null}

        {error ? (
          <ErrorState
            title={
              isInventoryExperience
                ? "Inventory could not load"
                : "Listing could not load"
            }
            message={`Refresh the page and try again. If this keeps happening, the ${
              isInventoryExperience ? "inventory" : "listing"
            } may need attention.`}
          />
        ) : null}

        {!isLoading && !error && !listing ? (
          <EmptyState
            title={isInventoryExperience ? "Inventory not found" : "Listing not found"}
            description={`This ${
              isInventoryExperience ? "inventory" : "listing"
            } may have been archived, removed, or may not belong to this seller account.`}
            action={
              <Link
                className="seller-secondary-button"
                href={isInventoryExperience ? "/dashboard/inventory" : "/dashboard/listings"}
              >
                {isInventoryExperience ? "Back to Inventory" : "Back to Listings"}
              </Link>
            }
          />
        ) : null}

        {!isLoading && !error && listing ? (
          <>
            {successMessage ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
                {successMessage}
              </div>
            ) : null}

            <SellerCard className="p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.08em] text-emerald-700">
                    {isInventoryExperience ? "Inventory" : "Saved Listing"}
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-stone-950">
                    {listing.title}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    {listing.speciesName} - {listing.breedNames.join(", ")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {isInventoryExperience ? (
                    <InventoryDetailBadges listing={listing} />
                  ) : (
                    <>
                      <StatusBadge status={getDisplayedListingStatus(listing)} />
                      {shouldShowDetailAvailabilityBadge(listing) ? (
                        <StatusBadge status={listing.availabilityStatus} />
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </SellerCard>

            {isEditing && editBasics ? (
              <EditListingForm
                editBasics={editBasics}
                editRows={editRows}
                experience={experience}
                ageBasedPricingEnabled={plan.ageBasedPricingEnabled}
                isSaving={isSaving}
                listing={listing}
                saveError={saveError}
                validationErrors={validationErrors}
                onCancel={cancelEditing}
                onSave={() => saveEdits(listing)}
                setEditBasics={setEditBasics}
                setEditRows={setEditRows}
              />
            ) : isOperationalEditing ? (
              <OperationalEditForm
                experience={experience}
                isSaving={isOperationalSaving}
                listing={listing}
                rows={operationalRows}
                saveError={operationalSaveError}
                validationErrors={operationalValidationErrors}
                onCancel={cancelOperationalEditing}
                onSave={() => saveOperationalEdits(listing)}
                setRows={setOperationalRows}
              />
            ) : (
              <>
                <ListingReadOnlyView
                  experience={experience}
                  listing={listing}
                />
                <ListingPhotosSection
                  canManage={Boolean(
                    canUseSetupTools || canUsePublicContentTools,
                  )}
                  description={
                    isInventoryExperience
                      ? "Add photos buyers can use to recognize this inventory. Add up to 4 photos."
                      : undefined
                  }
                  emptyDescription={
                    isInventoryExperience
                      ? "Add up to 4 clear photos for this inventory."
                      : undefined
                  }
                  listingBatchId={listingBatchId}
                  mediaItems={mediaItems}
                  mode={
                    canUseSetupTools
                      ? "setup"
                      : canUsePublicContentTools
                        ? "public-content"
                        : "readonly"
                  }
                  storeId={storeId}
                  title={isInventoryExperience ? "Buyer Photos" : "Photos"}
                  onReload={() => setReloadKey((current) => current + 1)}
                />
                {canUsePublicContentTools ? (
                  <PublicContentMaintenanceCard
                    descriptionDraft={publicDescriptionDraft}
                    error={publicContentError}
                    isEditing={isPublicContentEditing}
                    isSaving={isPublicContentSaving}
                    experience={experience}
                    listing={listing}
                    onCancel={cancelPublicContentEditing}
                    onEdit={() => startPublicContentEditing(listing)}
                    onSave={() => savePublicContent(listing)}
                    setDescriptionDraft={setPublicDescriptionDraft}
                  />
                ) : null}
                {canUseSetupTools && publishReadinessReport ? (
                  <SellerCard className="p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-stone-950">
                          Review Before Publish
                        </h2>
                        <p className="mt-1 text-sm leading-6 text-stone-600">
                          Preview what looks ready and what still needs
                          attention. This does not make the{" "}
                          {isInventoryExperience ? "inventory" : "listing"} live.
                        </p>
                      </div>
                      <button
                        className="seller-secondary-button"
                        onClick={() =>
                          setShowPublishReview((current) => !current)
                        }
                        type="button"
                      >
                        {showPublishReview
                          ? "Hide Publish Review"
                          : "Review Before Publish"}
                      </button>
                    </div>
                  </SellerCard>
                ) : null}
                {canUseSetupTools && showPublishReview && publishReadinessReport ? (
                  <PublishReadinessReview
                    isPublishing={isPublishing}
                    publishError={publishError}
                    report={publishReadinessReport}
                    onPublish={() => void publishListing()}
                  />
                ) : null}
                <SellerCard className="p-5">
                  <h2 className="text-lg font-semibold text-stone-950">
                    Setup editing
                  </h2>
                  {canUseSetupTools ? (
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm leading-6 text-stone-600">
                      This {isInventoryExperience ? "inventory" : "listing"} is
                      hidden, so setup edits are available before it goes live.
                      </p>
                      <button
                        className="seller-secondary-button"
                        onClick={() => startEditing(listing)}
                        type="button"
                      >
                        Edit Setup Details
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-stone-600">
                      Setup editing is closed here. Use operational tools for
                      safe availability and pricing changes.
                    </p>
                  )}
                </SellerCard>
                <SellerCard className="p-5">
                  <h2 className="text-lg font-semibold text-stone-950">
                    Availability & Pricing
                  </h2>
                  {canUseOperationalTools ? (
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm leading-6 text-stone-600">
                        Keep this inventory current after sales or price changes.
                        Setup details stay read-only here.
                      </p>
                      <button
                        className="seller-secondary-button"
                        onClick={() => startOperationalEditing(listing)}
                        type="button"
                      >
                        Update Availability & Pricing
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-stone-600">
                      Availability and pricing updates are available after a
                      {isInventoryExperience ? " inventory" : " listing"} is live.
                    </p>
                  )}
                </SellerCard>
                <SellerCard className="p-5">
                  <h2 className="text-lg font-semibold text-stone-950">
                    {isInventoryExperience ? "Visibility" : "Listing lifecycle"}
                  </h2>
                  {canUseOperationalTools ? (
                    <div className="mt-3 grid gap-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm leading-6 text-stone-600">
                          Need to pause this inventory? Hide it from the
                          storefront without deleting photos, inventory records,
                          pricing, or notes.
                        </p>
                        <button
                          className="seller-secondary-button"
                          disabled={isReturningToHidden}
                          onClick={() => void returnListingToHidden()}
                          type="button"
                        >
                          {isReturningToHidden
                            ? isInventoryExperience
                              ? "Hiding Inventory"
                              : "Hiding Listing"
                            : isInventoryExperience
                              ? "Hide from Storefront"
                              : "Return to Hidden"}
                        </button>
                      </div>
                      <ArchiveListingAction
                        experience={experience}
                        isArchiving={isArchiving}
                        onArchive={() => void archiveListing()}
                      />
                    </div>
                  ) : canUseSetupTools ? (
                    <div className="mt-3 grid gap-4">
                      <p className="text-sm leading-6 text-stone-600">
                        Hidden inventory stays off your storefront until you
                        publish it. Archive this inventory when you want to
                        retire it and keep the details for your records.
                      </p>
                      <ArchiveListingAction
                        experience={experience}
                        isArchiving={isArchiving}
                        onArchive={() => void archiveListing()}
                      />
                    </div>
                  ) : canRestoreArchivedListing ? (
                    <div className="mt-3 grid gap-4">
                      <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
                        <p className="font-semibold text-stone-950">
                          Archived {isInventoryExperience ? "inventory is" : "listings are"} read-only.
                        </p>
                        <p className="mt-1 text-sm leading-6 text-stone-600">
                          This {isInventoryExperience ? "inventory" : "listing"} is hidden from buyers but preserved for
                          your records. Restore it as a draft if you need to
                          review, edit, or publish it again.
                        </p>
                      </div>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm leading-6 text-stone-600">
                          Restore keeps the {isInventoryExperience ? "inventory" : "listing"} private. It does not make
                          it live.
                        </p>
                        <button
                          className="seller-secondary-button"
                          disabled={isRestoringArchived}
                          onClick={() => void restoreArchivedListing()}
                          type="button"
                        >
                          {isRestoringArchived
                            ? isInventoryExperience
                              ? "Restoring Inventory"
                              : "Restoring Listing"
                            : isInventoryExperience
                              ? "Restore as Draft"
                              : "Restore to Hidden"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-stone-600">
                      This {isInventoryExperience ? "inventory" : "listing"} is
                      read-only in its current state.
                    </p>
                  )}
                  {lifecycleError ? (
                    <div className="mt-4">
                      <ErrorState
                        title={
                          isInventoryExperience
                            ? "Inventory was not changed"
                            : "Listing was not changed"
                        }
                        message={lifecycleError}
                      />
                    </div>
                  ) : null}
                </SellerCard>
              </>
            )}
          </>
        ) : null}
      </main>
    </>
  );
}

function summarizeListing(
  rows: SellerInventoryManagementRow[],
  breedProfiles: SellerBreedProfileRead[],
): ListingDetailSummary | null {
  const first = rows[0];

  if (!first) return null;

  const publicDescriptions = uniqueSorted(
    breedProfiles
      .map((profile) => profile.seller_description?.trim())
      .filter((value): value is string => Boolean(value)),
  );

  return {
    title:
      first.internal_batch_label ||
      `${first.breed_display_name} ${first.species_name}`,
    speciesName: first.species_name,
    breedNames: uniqueSorted(rows.map((row) => row.breed_display_name)),
    batchType: first.batch_type,
    originDate: first.origin_date,
    availableDate: first.available_date,
    ageAtAvailabilityDays: first.age_at_availability_days,
    basePrice: first.base_price,
    autoPriceAdjustmentEnabled: Boolean(first.auto_price_adjustment_enabled),
    priceAdjustmentDirection: first.price_adjustment_direction,
    priceAdjustmentAmount: first.price_adjustment_amount,
    priceAdjustmentIntervalWeeks: first.price_adjustment_interval_weeks,
    priceAdjustmentMaxPrice: first.price_adjustment_max_price,
    priceAdjustmentMinPrice: first.price_adjustment_min_price,
    internalLabel: first.internal_batch_label,
    publicDescription:
      publicDescriptions.length > 0 ? publicDescriptions.join("\n\n") : null,
    sellerNotes: first.listing_batch_seller_notes,
    visibilityStatus: first.listing_batch_visibility_status,
    moderationStatus: first.listing_batch_moderation_status,
    availabilityStatus: rows.reduce(
      (current, row) =>
        pickListingAvailabilityStatus(
          current,
          row.operational_availability_status,
        ),
      first.operational_availability_status,
    ),
    totalAvailable: rows.reduce(
      (total, row) => total + (row.quantity_available ?? 0),
      0,
    ),
    rows,
  };
}

function validateEditForm(
  basics: EditBasicsState,
  inventoryRows: EditInventoryRow[],
  listing: ListingDetailSummary,
) {
  const errors: string[] = [];
  const activeRows = inventoryRows.filter((row) => !row.isRemoved);
  const inventoryTypes = activeRows.map((row) => row.inventoryType);
  const uniqueInventoryTypes = new Set(inventoryTypes);
  const isHatchingEggListing = listing.batchType === "hatching_eggs";
  const rowLabelPrefix = isHatchingEggListing ? "Hatching egg row" : "Group";

  if (activeRows.length === 0) {
    errors.push(
      isHatchingEggListing
        ? "Keep hatching egg inventory on this listing."
        : "Keep at least one bird group on this listing.",
    );
  }

  if (!basics.availableDate) errors.push("Add an available date.");

  if (!isHatchingEggListing && !basics.originDate) {
    errors.push("Add a hatch or origin date.");
  }

  if (
    !isHatchingEggListing &&
    basics.originDate &&
    basics.availableDate &&
    basics.availableDate < basics.originDate
  ) {
    errors.push("Available date cannot be before the hatch or origin date.");
  }

  if (!isValidMoney(basics.basePrice)) {
    errors.push("Base price must be a valid price.");
  }

  errors.push(...validatePriceAdjustmentFields(basics));

  if (basics.publicDescription.trim().length > publicDescriptionMaxLength) {
    errors.push(
      `Public description must be ${publicDescriptionMaxLength} characters or less.`,
    );
  }

  if (inventoryTypes.length !== uniqueInventoryTypes.size) {
    errors.push(
      isHatchingEggListing
        ? "Use one hatching egg inventory row for this listing."
        : "Use each bird type only once for this listing.",
    );
  }

  activeRows.forEach((row, index) => {
    const rowLabel = `${rowLabelPrefix} ${index + 1}`;

    if (!row.inventoryType) {
      errors.push(
        `${rowLabel}: choose ${
          isHatchingEggListing ? "an inventory type" : "a bird type"
        }.`,
      );
    }

    if (listing.batchType === "hatching_eggs") {
      if (row.inventoryType !== "hatching_eggs") {
        errors.push(`${rowLabel}: hatching egg listings can only use hatching eggs.`);
      }
    } else if (row.inventoryType === "hatching_eggs") {
      errors.push(`${rowLabel}: hatching eggs need their own listing.`);
    }

    if (row.inventoryType === "other" && !row.customLabel.trim()) {
      errors.push(`${rowLabel}: name this group when using Other.`);
    }

    if (!isWholeNumber(row.quantityAvailable)) {
      errors.push(`${rowLabel}: quantity must be a whole number of 0 or more.`);
    }

    if (row.priceOverride.trim() && !isValidMoney(row.priceOverride)) {
      errors.push(`${rowLabel}: optional custom price must be a valid price.`);
    }
  });

  return errors;
}

function validateOperationalEditRows(
  rows: OperationalEditRow[],
  listing: ListingDetailSummary,
) {
  const errors: string[] = [];
  const isHatchingEggListing = listing.batchType === "hatching_eggs";
  const rowLabelPrefix = isHatchingEggListing ? "Hatching egg row" : "Group";

  if (rows.length === 0) {
    errors.push(
      isHatchingEggListing
        ? "There are no active hatching egg rows to update."
        : "There are no active bird groups to update.",
    );
  }

  rows.forEach((row, index) => {
    const rowLabel = `${rowLabelPrefix} ${index + 1}`;

    if (listing.batchType === "hatching_eggs") {
      if (row.inventoryType !== "hatching_eggs") {
        errors.push(`${rowLabel}: hatching egg listings can only use hatching eggs.`);
      }
    } else if (row.inventoryType === "hatching_eggs") {
      errors.push(`${rowLabel}: hatching eggs need their own listing.`);
    }

    if (!isWholeNumber(row.quantityAvailable)) {
      errors.push(`${rowLabel}: quantity must be a whole number of 0 or more.`);
    }

    if (row.priceOverride.trim() && !isValidMoney(row.priceOverride)) {
      errors.push(`${rowLabel}: optional custom price must be a valid price.`);
    }
  });

  return errors;
}

function validatePriceAdjustmentFields(basics: EditBasicsState) {
  const errors: string[] = [];

  if (!basics.autoPriceAdjustmentEnabled) return errors;

  if (!basics.priceAdjustmentDirection) {
    errors.push("Choose whether prices should increase or decrease.");
  }

  if (!isValidPositiveMoney(basics.priceAdjustmentAmount)) {
    errors.push("Price adjustment amount must be greater than zero.");
  }

  if (!isPositiveWholeNumber(basics.priceAdjustmentIntervalWeeks)) {
    errors.push("Price adjustment interval must be one week or more.");
  }

  if (
    basics.priceAdjustmentDirection === "increase" &&
    basics.priceAdjustmentMaxPrice.trim() &&
    !isValidMoney(basics.priceAdjustmentMaxPrice)
  ) {
    errors.push("Maximum price must be a valid price.");
  }

  if (
    basics.priceAdjustmentDirection === "decrease" &&
    basics.priceAdjustmentMinPrice.trim() &&
    !isValidMoney(basics.priceAdjustmentMinPrice)
  ) {
    errors.push("Minimum price must be a valid price.");
  }

  return errors;
}

function ValidationMessage({ errors }: { errors: string[] }) {
  return (
    <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <h2 className="text-sm font-semibold text-amber-950">
        A few details need attention
      </h2>
      <ul className="mt-2 grid gap-1 text-sm leading-6 text-amber-800">
        {errors.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </div>
  );
}

function ListingReadOnlyView({
  experience,
  listing,
}: {
  experience: DetailExperience;
  listing: ListingDetailSummary;
}) {
  const isInventoryExperience = experience === "inventory";
  const isHatchingEggListing = listing.batchType === "hatching_eggs";

  return (
    <section className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
      <SellerCard className="p-5">
        <h2 className="text-lg font-semibold text-stone-950">
          {isInventoryExperience ? "Inventory Summary" : "Listing Basics"}
        </h2>
        <dl className="mt-4 grid gap-4 text-sm">
          <DetailItem label="Species" value={listing.speciesName} />
          <DetailItem label="Breed" value={listing.breedNames.join(", ")} />
          <DetailItem
            label="Inventory type"
            value={formatBatchType(listing.batchType)}
          />
          {!isHatchingEggListing ? (
            <DetailItem
              label="Hatch/origin date"
              value={formatDate(listing.originDate)}
            />
          ) : null}
          <DetailItem
            label={isHatchingEggListing ? "Available Date" : "Available date"}
            value={formatDate(listing.availableDate)}
          />
          {!isHatchingEggListing ? (
            <DetailItem
              label="Age at availability"
              value={formatAgeAtAvailability(listing.ageAtAvailabilityDays)}
            />
          ) : null}
          <DetailItem
            label={isHatchingEggListing ? "Price per Egg" : "Base price"}
            value={formatCurrency(listing.basePrice)}
          />
          {!isHatchingEggListing ? (
            <DetailItem
              label="Price adjustment"
              value={formatPriceAdjustmentSummary(listing)}
            />
          ) : null}
          <DetailItem
            label="Internal label"
            value={listing.internalLabel ?? "No internal label"}
          />
          <DetailItem
            label={isInventoryExperience ? "Buyer description" : "Public description"}
            value={listing.publicDescription ?? "No public description"}
          />
          <DetailItem
            label="Seller notes"
            value={listing.sellerNotes ?? "No seller notes"}
          />
        </dl>
      </SellerCard>

      <InventoryReadOnlyCard experience={experience} listing={listing} />
    </section>
  );
}

function InventoryReadOnlyCard({
  experience,
  listing,
}: {
  experience: DetailExperience;
  listing: ListingDetailSummary;
}) {
  const isInventoryExperience = experience === "inventory";
  const isHatchingEggListing = listing.batchType === "hatching_eggs";
  const isSoldOut = getDisplayedListingStatus(listing) === "sold_out";

  return (
    <SellerCard className="p-5">
      <h2 className="text-lg font-semibold text-stone-950">
        {isHatchingEggListing
          ? "Hatching Eggs"
          : isInventoryExperience
            ? "Inventory Records"
            : "Bird groups"}
      </h2>
      {isSoldOut ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          <p className="font-semibold">
            {isHatchingEggListing
              ? "No hatching eggs currently available."
              : "No birds currently available."}
          </p>
          <p className="mt-1">
            Buyers will see this inventory as Sold Out. Add quantity when more{" "}
            {isHatchingEggListing ? "eggs" : "birds"} are available.
          </p>
        </div>
      ) : (
        <p className="mt-1 text-sm text-stone-600">
          {listing.totalAvailable} available across {listing.rows.length}{" "}
          {isHatchingEggListing
            ? "hatching egg row"
            : isInventoryExperience
              ? "record"
              : "group"}
          {listing.rows.length === 1 ? "" : "s"}.
        </p>
      )}

      <div className="mt-4 grid gap-3">
        {listing.rows.map((row) => (
          <div
            key={row.inventory_item_id}
            className="rounded-lg border border-stone-200 bg-stone-50 p-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-semibold text-stone-950">
                  {formatInventoryType(row)}
                </h3>
                <p className="mt-1 text-sm text-stone-600">
                  {row.breed_display_name}
                </p>
              </div>
              {isInventoryExperience ? (
                <InventoryRowBadges row={row} />
              ) : (
                <StatusBadge status={row.operational_availability_status} />
              )}
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <Metric
                label="Available"
                value={(row.quantity_available ?? 0).toString()}
              />
              <Metric
                label="Price"
                value={formatCurrency(row.effective_unit_price)}
              />
              <Metric
                label="Custom price"
                value={
                  row.price_override == null
                    ? "Base"
                    : formatCurrency(row.price_override)
                }
              />
              <Metric
                label={isInventoryExperience ? "Visibility" : "Group status"}
                value={formatInventoryVisibility(row)}
              />
              <Metric
                label="Availability"
                value={formatInventoryAvailability(row)}
              />
            </dl>
          </div>
        ))}
      </div>
    </SellerCard>
  );
}

function PublicContentMaintenanceCard({
  descriptionDraft,
  error,
  experience,
  isEditing,
  isSaving,
  listing,
  onCancel,
  onEdit,
  onSave,
  setDescriptionDraft,
}: {
  descriptionDraft: string;
  error: string | null;
  experience: DetailExperience;
  isEditing: boolean;
  isSaving: boolean;
  listing: ListingDetailSummary;
  onCancel: () => void;
  onEdit: () => void;
  onSave: () => void;
  setDescriptionDraft: Dispatch<SetStateAction<string>>;
}) {
  const isInventoryExperience = experience === "inventory";

  return (
    <SellerCard className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-950">
            {isInventoryExperience ? "Buyer Content" : "Update Public Listing Content"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Keep the buyer-facing description current while this{" "}
            {isInventoryExperience ? "inventory" : "listing"} is live. Setup
            details stay read-only here.
          </p>
        </div>
        {!isEditing ? (
          <button className="seller-secondary-button" onClick={onEdit} type="button">
            Update buyer description
          </button>
        ) : null}
      </div>

      {isEditing ? (
        <div className="mt-5 grid gap-4">
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Public description
            <textarea
              className="seller-form-field min-h-32 resize-y py-3"
              maxLength={publicDescriptionMaxLength}
              value={descriptionDraft}
              onChange={(event) => setDescriptionDraft(event.target.value)}
            />
            <span className="text-xs font-normal leading-5 text-stone-500">
              This is what buyers will see on your storefront.
            </span>
          </label>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button className="seller-secondary-button" onClick={onCancel} type="button">
              Cancel
            </button>
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-wait disabled:opacity-70"
              disabled={isSaving}
              onClick={onSave}
              type="button"
            >
              {isSaving ? "Saving" : "Save Buyer Description"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700">
          {listing.publicDescription ? (
            <p className="whitespace-pre-line">{listing.publicDescription}</p>
          ) : (
            <p>No public description yet.</p>
          )}
        </div>
      )}

      {error ? (
        <div className="mt-4">
          <ErrorState
            title="Public description was not saved"
            message={error}
          />
        </div>
      ) : null}
    </SellerCard>
  );
}

function ArchiveListingAction({
  experience,
  isArchiving,
  onArchive,
}: {
  experience: DetailExperience;
  isArchiving: boolean;
  onArchive: () => void;
}) {
  const isInventoryExperience = experience === "inventory";

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-stone-950">
            {isInventoryExperience ? "Archive inventory" : "Archive listing"}
          </p>
          <p className="mt-1 text-sm leading-6 text-stone-700">
            {isInventoryExperience
              ? "Archiving removes this inventory from the storefront while keeping historical records."
              : "This removes the listing from your storefront while keeping all listing information for your records."}
          </p>
        </div>
        <button
          className="seller-secondary-button border-amber-300 bg-white hover:bg-amber-100"
          disabled={isArchiving}
          onClick={onArchive}
          type="button"
        >
          {isArchiving
            ? isInventoryExperience
              ? "Archiving Inventory"
              : "Archiving Listing"
            : isInventoryExperience
              ? "Archive Inventory"
              : "Archive Listing"}
        </button>
      </div>
    </div>
  );
}

function EditListingForm({
  ageBasedPricingEnabled,
  editBasics,
  editRows,
  experience,
  isSaving,
  listing,
  onCancel,
  onSave,
  saveError,
  setEditBasics,
  setEditRows,
  validationErrors,
}: {
  ageBasedPricingEnabled: boolean;
  editBasics: EditBasicsState;
  editRows: EditInventoryRow[];
  experience: DetailExperience;
  isSaving: boolean;
  listing: ListingDetailSummary;
  onCancel: () => void;
  onSave: () => void;
  saveError: string | null;
  setEditBasics: Dispatch<SetStateAction<EditBasicsState | null>>;
  setEditRows: Dispatch<SetStateAction<EditInventoryRow[]>>;
  validationErrors: string[];
}) {
  const isInventoryExperience = experience === "inventory";
  const isHatchingEggListing = listing.batchType === "hatching_eggs";
  const inventoryOptions =
    isHatchingEggListing
      ? hatchingEggInventoryTypes
      : liveAnimalInventoryTypes;
  const visibleRows = editRows.filter((row) => !row.isRemoved);

  function updateBasics(updates: Partial<EditBasicsState>) {
    setEditBasics((current) => (current ? { ...current, ...updates } : current));
  }

  function updateRow(rowId: string, updates: Partial<EditInventoryRow>) {
    setEditRows((current) =>
      current.map((row) =>
        row.inventoryItemId === rowId ? { ...row, ...updates } : row,
      ),
    );
  }

  function addInventoryRow() {
    const parentBreedId = listing.rows[0]?.listing_batch_breed_id;
    const nextSortOrder =
      editRows.reduce((largest, row) => Math.max(largest, row.sortOrder), -1) +
      1;

    if (!parentBreedId) return;

    setEditRows((current) => [
      ...current,
      {
        inventoryItemId: `new-${crypto.randomUUID()}`,
        listingBatchBreedId: parentBreedId,
        inventoryType: "",
        customLabel: "",
        quantityAvailable: "0",
        priceOverride: "",
        sortOrder: nextSortOrder,
        sellerNotes: "",
        isNew: true,
        isRemoved: false,
      },
    ]);
  }

  function removeInventoryRow(rowId: string) {
    if (visibleRows.length <= 1) return;

    const shouldRemove = window.confirm(
      isHatchingEggListing
        ? "Remove this hatching egg row from the hidden listing? It will be removed when you save changes."
        : "Remove this bird group from the hidden listing? It will be removed when you save changes.",
    );

    if (!shouldRemove) return;

    setEditRows((current) =>
      current
        .map((row) =>
          row.inventoryItemId === rowId ? { ...row, isRemoved: true } : row,
        )
        .filter((row) => !(row.inventoryItemId === rowId && row.isNew)),
    );
  }

  return (
    <SellerCard className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-950">
            Edit Setup Details
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            These setup changes apply only while the listing is hidden.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="seller-secondary-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-wait disabled:opacity-70"
            disabled={isSaving}
            onClick={onSave}
            type="button"
          >
            {isSaving ? "Saving" : "Save Changes"}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <section className="grid gap-4">
          <h3 className="font-semibold text-stone-950">
            {isInventoryExperience ? "Inventory Details" : "Listing Basics"}
          </h3>
          {!isHatchingEggListing ? (
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Hatch/origin date
              <input
                className="seller-form-field"
                type="date"
                value={editBasics.originDate}
                onChange={(event) => updateBasics({ originDate: event.target.value })}
              />
            </label>
          ) : null}
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            {isHatchingEggListing ? "Available Date" : "Available date"}
            <input
              className="seller-form-field"
              type="date"
              value={editBasics.availableDate}
              onChange={(event) =>
                updateBasics({ availableDate: event.target.value })
              }
            />
          </label>
          {!isHatchingEggListing ? (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-950">
              <span className="font-semibold">Age at availability:</span>{" "}
              {formatAgeAtAvailabilityFromDates(
                editBasics.originDate,
                editBasics.availableDate,
              ) ?? "Set hatch and available dates"}
            </div>
          ) : null}
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            {isHatchingEggListing ? "Price per Egg" : "Base price"}
            <MoneyInput
              value={editBasics.basePrice}
              onChange={(value) => updateBasics({ basePrice: value })}
            />
          </label>
          {!isHatchingEggListing ? (
          <fieldset className="grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4">
            <label className="flex items-start gap-3 text-sm font-semibold text-stone-800">
              <input
                checked={editBasics.autoPriceAdjustmentEnabled}
                className="mt-1 h-4 w-4 rounded border-stone-300 text-emerald-800 focus:ring-emerald-700"
                disabled={!ageBasedPricingEnabled}
                type="checkbox"
                onChange={(event) =>
                  updateBasics({
                    autoPriceAdjustmentEnabled: event.target.checked,
                  })
                }
              />
              <span>
                Automatically adjust this batch price after the available date{" "}
                {!ageBasedPricingEnabled ? "(Market)" : ""}
              </span>
            </label>

            {!ageBasedPricingEnabled ? (
              <PlanUpgradePrompt compact feature="age_based_pricing" />
            ) : null}

            {editBasics.autoPriceAdjustmentEnabled && ageBasedPricingEnabled ? (
              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Direction
                    <select
                      className="seller-form-field"
                      value={editBasics.priceAdjustmentDirection}
                      onChange={(event) =>
                        updateBasics({
                          priceAdjustmentDirection: event.target
                            .value as PriceAdjustmentDirection,
                          priceAdjustmentMaxPrice: "",
                          priceAdjustmentMinPrice: "",
                        })
                      }
                    >
                      <option value="increase">Increase</option>
                      <option value="decrease">Decrease</option>
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Every
                    <div className="flex items-center gap-2">
                      <input
                        className="seller-form-field"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        type="number"
                        value={editBasics.priceAdjustmentIntervalWeeks}
                        onChange={(event) =>
                          updateBasics({
                            priceAdjustmentIntervalWeeks: event.target.value,
                          })
                        }
                      />
                      <span className="text-sm font-normal text-stone-600">
                        week(s)
                      </span>
                    </div>
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Amount
                    <MoneyInput
                      value={editBasics.priceAdjustmentAmount}
                      onChange={(value) =>
                        updateBasics({ priceAdjustmentAmount: value })
                      }
                    />
                  </label>

                  {editBasics.priceAdjustmentDirection === "increase" ? (
                    <label className="grid gap-1 text-sm font-semibold text-stone-700">
                      Maximum price
                      <MoneyInput
                        value={editBasics.priceAdjustmentMaxPrice}
                        onChange={(value) =>
                          updateBasics({ priceAdjustmentMaxPrice: value })
                        }
                      />
                    </label>
                  ) : (
                    <label className="grid gap-1 text-sm font-semibold text-stone-700">
                      Minimum price
                      <MoneyInput
                        value={editBasics.priceAdjustmentMinPrice}
                        onChange={(value) =>
                          updateBasics({ priceAdjustmentMinPrice: value })
                        }
                      />
                    </label>
                  )}
                </div>

                <div className="rounded-md border border-emerald-100 bg-white px-3 py-2 text-sm leading-6 text-stone-700">
                  Current default price preview:{" "}
                  <span className="font-semibold text-stone-950">
                    {formatCurrency(
                      calculateAdjustedUnitPrice(Number(editBasics.basePrice), {
                        enabled: editBasics.autoPriceAdjustmentEnabled,
                        direction: editBasics.priceAdjustmentDirection,
                        amount: Number(editBasics.priceAdjustmentAmount),
                        intervalWeeks: Number(
                          editBasics.priceAdjustmentIntervalWeeks,
                        ),
                        maxPrice: editBasics.priceAdjustmentMaxPrice.trim()
                          ? Number(editBasics.priceAdjustmentMaxPrice)
                          : null,
                        minPrice: editBasics.priceAdjustmentMinPrice.trim()
                          ? Number(editBasics.priceAdjustmentMinPrice)
                          : null,
                        availableDate: editBasics.availableDate,
                      }),
                    )}
                  </span>
                </div>
              </div>
            ) : null}
          </fieldset>
          ) : null}
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Internal label
            <input
              className="seller-form-field"
              value={editBasics.internalLabel}
              onChange={(event) =>
                updateBasics({ internalLabel: event.target.value })
              }
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Public description
            <textarea
              className="seller-form-field min-h-32 resize-y py-3"
              maxLength={publicDescriptionMaxLength}
              value={editBasics.publicDescription}
              onChange={(event) =>
                updateBasics({ publicDescription: event.target.value })
              }
            />
            <span className="text-xs font-normal leading-5 text-stone-500">
              This is what buyers will see on your listing.
            </span>
          </label>
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Seller notes
            <textarea
              className="seller-form-field min-h-28 resize-y py-3"
              value={editBasics.sellerNotes}
              onChange={(event) => updateBasics({ sellerNotes: event.target.value })}
            />
          </label>
        </section>

        <section className="grid gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold text-stone-950">
                {isHatchingEggListing ? "Hatching Eggs" : "Bird groups"}
              </h3>
              <p className="mt-1 text-sm leading-6 text-stone-600">
                {isHatchingEggListing
                  ? "Update the hatching egg quantity and price per egg."
                  : "Use groups when pullets, cockerels, straight run chicks, or hatching eggs need different counts or prices."}
              </p>
            </div>
            {!isHatchingEggListing ? (
              <button
                className="seller-secondary-button"
                onClick={addInventoryRow}
                type="button"
              >
                Add Bird Group
              </button>
            ) : null}
          </div>

          {visibleRows.map((row, index) => (
            <div
              key={row.inventoryItemId}
              className="rounded-lg border border-stone-200 bg-stone-50 p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="font-semibold text-stone-950">
                  {isHatchingEggListing ? "Hatching egg row" : "Group"}{" "}
                  {index + 1}
                  {row.isNew ? (
                    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                      New
                    </span>
                  ) : null}
                </p>
                <button
                  className="seller-small-button"
                  disabled={visibleRows.length <= 1}
                  onClick={() => removeInventoryRow(row.inventoryItemId)}
                  type="button"
                >
                  Remove
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  {isHatchingEggListing ? "Inventory type" : "Bird type"}
                  <select
                    className="seller-form-field"
                    value={row.inventoryType}
                    onChange={(event) =>
                      updateRow(row.inventoryItemId, {
                        inventoryType: event.target.value,
                        customLabel:
                          event.target.value === "other" ? row.customLabel : "",
                      })
                    }
                  >
                    {inventoryOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  {isHatchingEggListing
                    ? "Quantity Available"
                    : "How many are available?"}
                  <input
                    className="seller-form-field"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    type="number"
                    value={row.quantityAvailable}
                    onChange={(event) =>
                      updateRow(row.inventoryItemId, {
                        quantityAvailable: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
              {row.inventoryType === "other" ? (
                <label className="mt-3 grid gap-1 text-sm font-semibold text-stone-700">
                  Name this group
                  <input
                    className="seller-form-field"
                    value={row.customLabel}
                    onChange={(event) =>
                      updateRow(row.inventoryItemId, {
                        customLabel: event.target.value,
                      })
                    }
                  />
                  <span className="text-xs font-normal leading-5 text-stone-500">
                    Use the words buyers will recognize for this group.
                  </span>
                </label>
              ) : null}
              <label className="mt-3 grid gap-1 text-sm font-semibold text-stone-700">
                {isHatchingEggListing
                  ? "Optional custom price per egg"
                  : "Optional custom price"}
                <MoneyInput
                  value={row.priceOverride}
                  onChange={(value) =>
                    updateRow(row.inventoryItemId, {
                      priceOverride: value,
                    })
                  }
                />
                <span className="text-xs font-normal leading-5 text-stone-500">
                  Leave blank if this{" "}
                  {isHatchingEggListing ? "row" : "group"} uses the listing{" "}
                  {isHatchingEggListing ? "price per egg" : "base price"}.
                </span>
              </label>
            </div>
          ))}
        </section>
      </div>

      {validationErrors.length > 0 ? (
        <ValidationMessage errors={validationErrors} />
      ) : null}

      {saveError ? (
        <ErrorState
          title="Changes were not saved"
          message="Please review the listing details and try again."
        />
      ) : null}
    </SellerCard>
  );
}

function OperationalEditForm({
  experience,
  isSaving,
  listing,
  onCancel,
  onSave,
  rows,
  saveError,
  setRows,
  validationErrors,
}: {
  experience: DetailExperience;
  isSaving: boolean;
  listing: ListingDetailSummary;
  onCancel: () => void;
  onSave: () => void;
  rows: OperationalEditRow[];
  saveError: string | null;
  setRows: Dispatch<SetStateAction<OperationalEditRow[]>>;
  validationErrors: string[];
}) {
  const isInventoryExperience = experience === "inventory";
  const isHatchingEggListing = listing.batchType === "hatching_eggs";

  function updateRow(rowId: string, updates: Partial<OperationalEditRow>) {
    setRows((current) =>
      current.map((row) =>
        row.inventoryItemId === rowId ? { ...row, ...updates } : row,
      ),
    );
  }

  return (
    <SellerCard className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-950">
            {isInventoryExperience
              ? "Availability & Pricing"
              : "Update Availability & Pricing"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Update available quantity and custom prices after sales or price
            changes. Breed, dates, photos, and setup structure stay unchanged in
            this step.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="seller-secondary-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-wait disabled:opacity-70"
            disabled={isSaving}
            onClick={onSave}
            type="button"
          >
            {isSaving ? "Saving" : "Save Updates"}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4">
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
          This {isInventoryExperience ? "inventory" : "listing"} is live. If
          all records are set to 0, buyers will see it as Sold Out. Add quantity
          when more {isHatchingEggListing ? "eggs" : "birds"} are available.
        </div>

        {rows.map((row) => {
          const originalRow = listing.rows.find(
            (item) => item.inventory_item_id === row.inventoryItemId,
          );

          return (
            <div
              key={row.inventoryItemId}
              className="rounded-lg border border-stone-200 bg-stone-50 p-4"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-semibold text-stone-950">
                    {originalRow
                      ? formatInventoryType(originalRow)
                      : isInventoryExperience
                        ? "Inventory record"
                        : isHatchingEggListing
                          ? "Hatching eggs"
                          : "Bird group"}
                  </h3>
                  <p className="mt-1 text-sm text-stone-600">
                    {originalRow?.breed_display_name ?? listing.breedNames.join(", ")}
                  </p>
                </div>
                <StatusBadge
                  status={getOperationalRowDisplayStatus(row, originalRow)}
                />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  {isHatchingEggListing
                    ? "Quantity Available"
                    : "How many are available?"}
                  <input
                    className="seller-form-field"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    type="number"
                    value={row.quantityAvailable}
                    onChange={(event) =>
                      updateRow(row.inventoryItemId, {
                        quantityAvailable: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  {isHatchingEggListing
                    ? "Optional custom price per egg"
                    : "Optional custom price"}
                  <MoneyInput
                    value={row.priceOverride}
                    onChange={(value) =>
                      updateRow(row.inventoryItemId, {
                        priceOverride: value,
                      })
                    }
                  />
                  <span className="text-xs font-normal leading-5 text-stone-500">
                    Leave blank if this{" "}
                    {isHatchingEggListing ? "row" : "group"} should use the
                    listing {isHatchingEggListing ? "price per egg" : "base price"}.
                  </span>
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {validationErrors.length > 0 ? (
        <ValidationMessage errors={validationErrors} />
      ) : null}

      {saveError ? (
        <ErrorState
          title="Updates were not saved"
          message="Please review the availability and pricing, then try again."
        />
      ) : null}
    </SellerCard>
  );
}

function getOperationalRowDisplayStatus(
  row: OperationalEditRow,
  originalRow: SellerInventoryManagementRow | undefined,
) {
  if (Number(row.quantityAvailable) <= 0) return "sold_out";

  return originalRow?.operational_availability_status ?? row.visibilityStatus;
}

function InventoryDetailBadges({
  listing,
}: {
  listing: ListingDetailSummary;
}) {
  const visibility = getInventoryDetailVisibility(listing);
  const availability = formatListingAvailability(listing);

  return (
    <div className="flex flex-wrap gap-2">
      <StatusBadge status={visibility} />
      {availability ? (
        <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
          {availability}
        </span>
      ) : null}
    </div>
  );
}

function InventoryRowBadges({ row }: { row: SellerInventoryManagementRow }) {
  const visibility = formatInventoryVisibility(row);
  const availability = formatInventoryAvailability(row);

  return (
    <div className="flex flex-wrap gap-2">
      <StatusBadge status={visibility.toLowerCase().replaceAll(" ", "_")} />
      {visibility === "Live" && availability ? (
        <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
          {availability}
        </span>
      ) : null}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-stone-100 pb-3 last:border-0 last:pb-0">
      <dt className="font-semibold text-stone-600">{label}</dt>
      <dd className="mt-1 font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

const MoneyInput = SharedMoneyInput;

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </dt>
      <dd className="mt-1 font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

function formatInventoryType(row: SellerInventoryManagementRow) {
  return row.custom_inventory_label || formatInventoryTypeLabel(row.inventory_type);
}

function formatBatchType(value: string | null | undefined) {
  if (value === "live_animals") return "Birds";
  if (value === "hatching_eggs") return "Hatching eggs";

  return formatStatus(value);
}

function formatStatus(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : "Not set";
}

function getInventoryDetailVisibility(listing: ListingDetailSummary) {
  if (listing.visibilityStatus === "active" && listing.totalAvailable <= 0) {
    return "sold_out";
  }

  if (listing.visibilityStatus === "active") return "live";
  if (listing.visibilityStatus === "hidden") return "draft";

  return listing.visibilityStatus;
}

function formatListingAvailability(listing: ListingDetailSummary) {
  const visibility = getInventoryDetailVisibility(listing);

  if (visibility === "sold_out") return "Sold Out";
  if (visibility !== "live") return "";

  if (listing.availableDate && isFutureDate(listing.availableDate)) {
    return `Available ${formatShortDate(listing.availableDate)}`;
  }

  return "Available Now";
}

function formatInventoryVisibility(row: SellerInventoryManagementRow) {
  if (
    row.listing_batch_visibility_status === "archived" ||
    row.inventory_visibility_status === "archived"
  ) {
    return "Archived";
  }

  if (row.operational_availability_status === "sold_out") return "Sold Out";
  if (row.listing_batch_visibility_status === "active") return "Live";
  if (row.listing_batch_visibility_status === "hidden") return "Draft";
  if (row.inventory_visibility_status === "hidden") return "Hidden";

  return formatStatus(row.listing_batch_visibility_status);
}

function formatInventoryAvailability(row: SellerInventoryManagementRow) {
  if (row.operational_availability_status === "sold_out") return "Sold Out";
  if (formatInventoryVisibility(row) !== "Live") return "Not visible";

  if (row.available_date && isFutureDate(row.available_date)) {
    return `Available ${formatShortDate(row.available_date)}`;
  }

  return "Available Now";
}

function formatPriceAdjustmentSummary(listing: ListingDetailSummary) {
  if (
    !listing.autoPriceAdjustmentEnabled ||
    !listing.priceAdjustmentDirection ||
    listing.priceAdjustmentAmount == null ||
    listing.priceAdjustmentIntervalWeeks == null
  ) {
    return "No automatic adjustment";
  }

  const direction =
    listing.priceAdjustmentDirection === "increase" ? "Increase" : "Decrease";
  const cap =
    listing.priceAdjustmentDirection === "increase"
      ? listing.priceAdjustmentMaxPrice == null
        ? ""
        : `, max ${formatCurrency(listing.priceAdjustmentMaxPrice)}`
      : listing.priceAdjustmentMinPrice == null
        ? ""
        : `, min ${formatCurrency(listing.priceAdjustmentMinPrice)}`;

  return `${direction} ${formatCurrency(
    listing.priceAdjustmentAmount,
  )} every ${listing.priceAdjustmentIntervalWeeks} week${
    listing.priceAdjustmentIntervalWeeks === 1 ? "" : "s"
  } after available date${cap}`;
}

function getDisplayedListingStatus(listing: ListingDetailSummary) {
  if (listing.visibilityStatus === "active" && listing.totalAvailable <= 0) {
    return "sold_out";
  }

  return listing.visibilityStatus;
}

function shouldShowDetailAvailabilityBadge(listing: ListingDetailSummary) {
  const displayedStatus = getDisplayedListingStatus(listing);

  if (["archived", "hidden", "sold_out"].includes(displayedStatus)) {
    return false;
  }

  return listing.availabilityStatus !== displayedStatus;
}

function isValidMoney(value: string) {
  return /^\d+(\.\d{1,2})?$/.test(value.trim());
}

function isValidPositiveMoney(value: string) {
  return isValidMoney(value) && Number(value) > 0;
}

function isWholeNumber(value: string) {
  return /^(0|[1-9]\d*)$/.test(value.trim());
}

function isPositiveWholeNumber(value: string) {
  return /^[1-9]\d*$/.test(value.trim());
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function isFutureDate(value: string) {
  const today = new Date();
  const todayIso = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");

  return value > todayIso;
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value ?? 0);
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function isListingMedia(
  item: ListingPhotoItem,
  mediaEntityIds: string[],
) {
  if (
    !["listing_batch", "listing_batch_breed", "inventory_item"].includes(
      item.entity_type,
    )
  ) {
    return false;
  }

  return mediaEntityIds.includes(item.entity_id);
}

function sortListingMedia(items: ListingPhotoItem[]) {
  return [...items].sort((first, second) => {
    if (first.entity_type !== second.entity_type) {
      return first.entity_type.localeCompare(second.entity_type);
    }

    return (first.sort_order ?? 0) - (second.sort_order ?? 0);
  });
}

function pickListingAvailabilityStatus(current: string, next: string) {
  const priority = [
    "ready_now",
    "reserve_now",
    "hidden",
    "sold_out",
    "unavailable",
    "archived",
  ];

  const currentIndex = priority.indexOf(current);
  const nextIndex = priority.indexOf(next);

  if (currentIndex === -1) return next;
  if (nextIndex === -1) return current;

  return nextIndex < currentIndex ? next : current;
}
