"use client";

import Link from "next/link";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
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
  buildPublishReadinessReport,
  type PublishReadinessListing,
  type PublishReadinessMediaSummary,
} from "./publish-readiness";
import { PublishReadinessReview } from "./publish-readiness-review";

type ListingDetailSummary = PublishReadinessListing;

type EditBasicsState = {
  originDate: string;
  availableDate: string;
  basePrice: string;
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

type SellerMediaManagementRow = {
  media_link_id: string;
  entity_type: string;
  entity_id: string;
  asset_status: string;
  moderation_status: string;
  visibility_status: string;
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
};

const listingDetailSelect =
  "store_id, listing_batch_id, listing_batch_breed_id, inventory_item_id, species_id, species_name, species_slug, seller_breed_profile_id, breed_display_name, batch_type, origin_date, available_date, age_at_availability_days, base_price, auto_price_increase_enabled, auto_price_increase_amount, auto_price_increase_max_price, internal_batch_label, listing_batch_visibility_status, listing_batch_moderation_status, listing_batch_breed_sort_order, listing_batch_breed_visibility_status, listing_batch_breed_moderation_status, inventory_type, custom_inventory_label, quantity_available, price_override, effective_unit_price, inventory_item_sort_order, inventory_visibility_status, inventory_moderation_status, operational_availability_status, inventory_seller_notes, listing_batch_breed_seller_notes, listing_batch_seller_notes, inventory_updated_at, listing_batch_updated_at";

const sellerMediaSelect =
  "media_link_id, entity_type, entity_id, asset_status, moderation_status, visibility_status";

const sellerBreedProfileSelect =
  "id, species_id, breed_id, custom_breed_name, display_name, seller_description, seller_notes, visibility_status";

const publicDescriptionMaxLength = 1000;

const liveAnimalInventoryTypes = [
  { label: "Female", value: "female" },
  { label: "Male", value: "male" },
  { label: "Straight run", value: "straight_run" },
  { label: "Unsexed", value: "unsexed" },
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
  listingBatchId,
}: {
  listingBatchId: string;
}) {
  const { seller } = useSellerContext();
  const storeId = seller?.store_id ?? "";
  const [rows, setRows] = useState<SellerInventoryManagementRow[]>([]);
  const [breedProfiles, setBreedProfiles] = useState<SellerBreedProfileRead[]>(
    [],
  );
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
          .returns<SellerMediaManagementRow[]>();

        if (!isMounted) return;

        if (mediaError) {
          setError(mediaError.message);
          setIsLoading(false);
          return;
        }

        const relevantMedia = (mediaData ?? []).filter((item) =>
          isListingMedia(item, mediaEntityIds),
        );

        setMediaSummary({
          activeCount: relevantMedia.filter(
            (item) =>
              item.visibility_status === "active" &&
              item.asset_status === "active" &&
              item.moderation_status === "approved",
          ).length,
          totalCount: relevantMedia.length,
        });
      } else {
        setBreedProfiles([]);
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
  const canEdit = listing?.visibilityStatus === "hidden";
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
    setShowPublishReview(false);
    setEditBasics({
      originDate: currentListing.originDate ?? "",
      availableDate: currentListing.availableDate,
      basePrice: currentListing.basePrice?.toString() ?? "",
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

  async function saveEdits(currentListing: ListingDetailSummary) {
    if (!editBasics || !canEdit) return;

    const errors = validateEditForm(editBasics, editRows, currentListing);
    setValidationErrors(errors);
    setSaveError(null);
    setSuccessMessage(null);

    if (errors.length > 0) return;

    setIsSaving(true);

    const batchResult = await supabase.rpc("seller_update_listing_batch", {
      p_listing_batch_id: listingBatchId,
      p_origin_date:
        currentListing.batchType === "hatching_eggs"
          ? editBasics.availableDate
          : editBasics.originDate,
      p_available_date: editBasics.availableDate,
      p_base_price: Number(editBasics.basePrice),
      p_auto_price_increase_enabled: false,
      p_auto_price_increase_amount: null,
      p_auto_price_increase_max_price: null,
      p_internal_batch_label: editBasics.internalLabel.trim() || null,
      p_seller_notes: editBasics.sellerNotes.trim() || null,
    });

    if (batchResult.error) {
      setSaveError(batchResult.error.message);
      setIsSaving(false);
      return;
    }

    const breedProfileResult = await updateListingBreedDescriptions(
      currentListing,
      editBasics.publicDescription,
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
    setSuccessMessage("Listing changes saved.");
    setReloadKey((current) => current + 1);
  }

  return (
    <>
      <SellerPageHeader
        eyebrow={seller?.store_name}
        title={listing?.title ?? "Listing Detail"}
        description="Review the saved listing basics and inventory rows before future edit or publish steps."
        action={
          <Link className="seller-secondary-button" href="/dashboard/listings">
            Back to Listings
          </Link>
        }
      />

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5 sm:px-7">
        {isLoading ? <LoadingState label="Loading listing" /> : null}

        {error ? (
          <ErrorState
            title="Listing could not load"
            message="Refresh the page and try again. If this keeps happening, the listing may need attention."
          />
        ) : null}

        {!isLoading && !error && !listing ? (
          <EmptyState
            title="Listing not found"
            description="This listing may have been archived, removed, or may not belong to this seller account."
            action={
              <Link className="seller-secondary-button" href="/dashboard/listings">
                Back to Listings
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
                    Saved Listing
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-stone-950">
                    {listing.title}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    {listing.speciesName} - {listing.breedNames.join(", ")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={listing.availabilityStatus} />
                  <StatusBadge status={listing.visibilityStatus} />
                </div>
              </div>
            </SellerCard>

            {isEditing && editBasics ? (
              <EditListingForm
                editBasics={editBasics}
                editRows={editRows}
                isSaving={isSaving}
                listing={listing}
                saveError={saveError}
                validationErrors={validationErrors}
                onCancel={cancelEditing}
                onSave={() => saveEdits(listing)}
                setEditBasics={setEditBasics}
                setEditRows={setEditRows}
              />
            ) : (
              <>
                <ListingReadOnlyView listing={listing} />
                {canEdit && publishReadinessReport ? (
                  <SellerCard className="p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-stone-950">
                          Review Before Publish
                        </h2>
                        <p className="mt-1 text-sm leading-6 text-stone-600">
                          Preview what looks ready and what still needs
                          attention. This does not make the listing live.
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
                {canEdit && showPublishReview && publishReadinessReport ? (
                  <PublishReadinessReview report={publishReadinessReport} />
                ) : null}
                <SellerCard className="p-5">
                  <h2 className="text-lg font-semibold text-stone-950">
                    Editing
                  </h2>
                  {canEdit ? (
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm leading-6 text-stone-600">
                        This listing is hidden, so you can safely fix basics
                        and inventory before any publish step exists.
                      </p>
                      <button
                        className="seller-secondary-button"
                        onClick={() => startEditing(listing)}
                        type="button"
                      >
                        Edit Hidden Listing
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-stone-600">
                      This listing is not hidden. Visible or published listings
                      cannot be edited here yet.
                    </p>
                  )}
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

  if (activeRows.length === 0) {
    errors.push("Keep at least one inventory row on this listing.");
  }

  if (!basics.availableDate) errors.push("Add an available date.");

  if (listing.batchType !== "hatching_eggs" && !basics.originDate) {
    errors.push("Add a hatch or origin date.");
  }

  if (
    listing.batchType !== "hatching_eggs" &&
    basics.originDate &&
    basics.availableDate &&
    basics.availableDate < basics.originDate
  ) {
    errors.push("Available date cannot be before the hatch or origin date.");
  }

  if (!isValidMoney(basics.basePrice)) {
    errors.push("Base price must be a valid price.");
  }

  if (basics.publicDescription.trim().length > publicDescriptionMaxLength) {
    errors.push(
      `Public description must be ${publicDescriptionMaxLength} characters or less.`,
    );
  }

  if (inventoryTypes.length !== uniqueInventoryTypes.size) {
    errors.push("Use each inventory type only once for this listing.");
  }

  activeRows.forEach((row, index) => {
    const rowLabel = `Row ${index + 1}`;

    if (!row.inventoryType) errors.push(`${rowLabel}: choose an inventory type.`);

    if (listing.batchType === "hatching_eggs") {
      if (row.inventoryType !== "hatching_eggs") {
        errors.push(`${rowLabel}: hatching egg listings can only use hatching eggs.`);
      }
    } else if (row.inventoryType === "hatching_eggs") {
      errors.push(`${rowLabel}: hatching eggs need their own listing.`);
    }

    if (row.inventoryType === "other" && !row.customLabel.trim()) {
      errors.push(`${rowLabel}: add a custom label for Other.`);
    }

    if (!isWholeNumber(row.quantityAvailable)) {
      errors.push(`${rowLabel}: quantity must be a whole number of 0 or more.`);
    }

    if (row.priceOverride.trim() && !isValidMoney(row.priceOverride)) {
      errors.push(`${rowLabel}: price override must be a valid price.`);
    }
  });

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

function ListingReadOnlyView({ listing }: { listing: ListingDetailSummary }) {
  return (
    <section className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
      <SellerCard className="p-5">
        <h2 className="text-lg font-semibold text-stone-950">
          Listing Basics
        </h2>
        <dl className="mt-4 grid gap-4 text-sm">
          <DetailItem label="Species" value={listing.speciesName} />
          <DetailItem label="Breed" value={listing.breedNames.join(", ")} />
          <DetailItem
            label="Hatch/origin date"
            value={formatDate(listing.originDate)}
          />
          <DetailItem
            label="Available date"
            value={formatDate(listing.availableDate)}
          />
          <DetailItem
            label="Age at availability"
            value={formatAge(listing.ageAtAvailabilityDays)}
          />
          <DetailItem
            label="Base price"
            value={formatCurrency(listing.basePrice)}
          />
          <DetailItem
            label="Internal label"
            value={listing.internalLabel ?? "No internal label"}
          />
          <DetailItem
            label="Public description"
            value={listing.publicDescription ?? "No public description"}
          />
          <DetailItem
            label="Seller notes"
            value={listing.sellerNotes ?? "No seller notes"}
          />
        </dl>
      </SellerCard>

      <InventoryReadOnlyCard listing={listing} />
    </section>
  );
}

function InventoryReadOnlyCard({
  listing,
}: {
  listing: ListingDetailSummary;
}) {
  return (
    <SellerCard className="p-5">
      <h2 className="text-lg font-semibold text-stone-950">Inventory</h2>
      <p className="mt-1 text-sm text-stone-600">
        {listing.totalAvailable} available across {listing.rows.length} row
        {listing.rows.length === 1 ? "" : "s"}.
      </p>

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
              <StatusBadge status={row.operational_availability_status} />
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Metric
                label="Available"
                value={(row.quantity_available ?? 0).toString()}
              />
              <Metric
                label="Price"
                value={formatCurrency(row.effective_unit_price)}
              />
              <Metric
                label="Override"
                value={
                  row.price_override == null
                    ? "Base"
                    : formatCurrency(row.price_override)
                }
              />
              <Metric
                label="Row status"
                value={formatStatus(row.inventory_visibility_status)}
              />
            </dl>
          </div>
        ))}
      </div>
    </SellerCard>
  );
}

function EditListingForm({
  editBasics,
  editRows,
  isSaving,
  listing,
  onCancel,
  onSave,
  saveError,
  setEditBasics,
  setEditRows,
  validationErrors,
}: {
  editBasics: EditBasicsState;
  editRows: EditInventoryRow[];
  isSaving: boolean;
  listing: ListingDetailSummary;
  onCancel: () => void;
  onSave: () => void;
  saveError: string | null;
  setEditBasics: Dispatch<SetStateAction<EditBasicsState | null>>;
  setEditRows: Dispatch<SetStateAction<EditInventoryRow[]>>;
  validationErrors: string[];
}) {
  const inventoryOptions =
    listing.batchType === "hatching_eggs"
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
      "Remove this inventory row from the hidden listing? It will be removed when you save changes.",
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
            Edit Hidden Listing
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            These changes apply only while the listing is hidden.
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
          <h3 className="font-semibold text-stone-950">Listing Basics</h3>
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Hatch/origin date
            <input
              className="seller-form-field"
              type="date"
              value={editBasics.originDate}
              onChange={(event) => updateBasics({ originDate: event.target.value })}
              disabled={listing.batchType === "hatching_eggs"}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Available date
            <input
              className="seller-form-field"
              type="date"
              value={editBasics.availableDate}
              onChange={(event) =>
                updateBasics({ availableDate: event.target.value })
              }
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Base price
            <input
              className="seller-form-field"
              inputMode="decimal"
              min="0"
              step="0.01"
              type="number"
              value={editBasics.basePrice}
              onChange={(event) => updateBasics({ basePrice: event.target.value })}
            />
          </label>
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
            <h3 className="font-semibold text-stone-950">Inventory Rows</h3>
            <button
              className="seller-secondary-button"
              onClick={addInventoryRow}
              type="button"
            >
              Add Inventory Row
            </button>
          </div>

          {visibleRows.map((row, index) => (
            <div
              key={row.inventoryItemId}
              className="rounded-lg border border-stone-200 bg-stone-50 p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="font-semibold text-stone-950">
                  Row {index + 1}
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
                  Inventory type
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
                  Quantity available
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
                  Custom label
                  <input
                    className="seller-form-field"
                    value={row.customLabel}
                    onChange={(event) =>
                      updateRow(row.inventoryItemId, {
                        customLabel: event.target.value,
                      })
                    }
                  />
                </label>
              ) : null}
              <label className="mt-3 grid gap-1 text-sm font-semibold text-stone-700">
                Price override
                <input
                  className="seller-form-field"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  type="number"
                  value={row.priceOverride}
                  onChange={(event) =>
                    updateRow(row.inventoryItemId, {
                      priceOverride: event.target.value,
                    })
                  }
                />
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

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-stone-100 pb-3 last:border-0 last:pb-0">
      <dt className="font-semibold text-stone-600">{label}</dt>
      <dd className="mt-1 font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

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
  return row.custom_inventory_label || formatStatus(row.inventory_type);
}

function formatStatus(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : "Not set";
}

function isValidMoney(value: string) {
  return /^\d+(\.\d{1,2})?$/.test(value.trim());
}

function isWholeNumber(value: string) {
  return /^(0|[1-9]\d*)$/.test(value.trim());
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatAge(days: number | null | undefined) {
  if (days == null) return "Not set";
  if (days < 7) return `${days} day${days === 1 ? "" : "s"}`;

  const weeks = Math.floor(days / 7);
  const remainder = days % 7;

  if (remainder === 0) return `${weeks} week${weeks === 1 ? "" : "s"}`;

  return `${weeks} week${weeks === 1 ? "" : "s"}, ${remainder} day${
    remainder === 1 ? "" : "s"
  }`;
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
  item: SellerMediaManagementRow,
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
