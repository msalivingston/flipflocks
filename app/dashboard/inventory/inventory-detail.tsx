"use client";

import Link from "next/link";
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
import type { SellerInventoryManagementRow } from "../_lib/seller-types";
import { formatInventoryTypeLabel } from "../_lib/listing-formatters";

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

type DetailsDraft = {
  availableDate: string;
  customLabel: string;
  inventoryType: string;
  originDate: string;
};

type InventorySummary = {
  availableDate: string | null;
  batchType: string;
  breedNames: string[];
  inventoryTypes: string[];
  speciesName: string;
  title: string;
  totalAvailable: number;
  visibilityStatus: string;
};

const inventoryDetailSelect =
  "store_id, listing_batch_id, listing_batch_breed_id, inventory_item_id, species_id, species_name, species_slug, seller_breed_profile_id, breed_display_name, batch_type, origin_date, available_date, age_at_availability_days, base_price, internal_batch_label, listing_batch_visibility_status, listing_batch_moderation_status, listing_batch_breed_sort_order, listing_batch_breed_visibility_status, listing_batch_breed_moderation_status, inventory_type, custom_inventory_label, quantity_available, price_override, effective_unit_price, inventory_item_sort_order, inventory_visibility_status, inventory_moderation_status, operational_availability_status, inventory_seller_notes, listing_batch_breed_seller_notes, listing_batch_seller_notes, inventory_updated_at, listing_batch_updated_at";

const sellerBreedProfileSelect =
  "id, species_id, breed_id, custom_breed_name, display_name, seller_description, seller_notes, visibility_status";

const buyerDescriptionMaxLength = 1000;

const liveAnimalInventoryTypes = [
  { label: "Female", value: "female" },
  { label: "Male", value: "male" },
  { label: "Straight Run", value: "straight_run" },
  { label: "Pair", value: "pair" },
  { label: "Trio", value: "trio" },
  { label: "Other", value: "other" },
];

const hatchingEggInventoryTypes = [
  { label: "Hatching eggs", value: "hatching_eggs" },
];

export function InventoryDetail({ listingBatchId }: { listingBatchId: string }) {
  const { seller } = useSellerContext();
  const storeId = seller?.store_id ?? "";
  const [rows, setRows] = useState<SellerInventoryManagementRow[]>([]);
  const [breedProfiles, setBreedProfiles] = useState<SellerBreedProfileRead[]>([]);
  const [detailsDraft, setDetailsDraft] = useState<DetailsDraft | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [isDescriptionEditing, setIsDescriptionEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [isDescriptionSaving, setIsDescriptionSaving] = useState(false);
  const [isHiding, setIsHiding] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function loadInventory() {
      if (!seller) return;

      setIsLoading(true);
      setLoadError(null);

      const inventoryResult = await supabase
        .from("seller_inventory_management")
        .select(inventoryDetailSelect)
        .eq("store_id", seller.store_id)
        .eq("listing_batch_id", listingBatchId)
        .order("listing_batch_breed_sort_order", { ascending: true })
        .order("inventory_item_sort_order", { ascending: true })
        .returns<SellerInventoryManagementRow[]>();

      if (!isMounted) return;

      if (inventoryResult.error) {
        setLoadError(inventoryResult.error.message);
        setIsLoading(false);
        return;
      }

      const nextRows = inventoryResult.data ?? [];
      const profileIds = Array.from(
        new Set(nextRows.map((row) => row.seller_breed_profile_id)),
      );
      const profileResult =
        profileIds.length > 0
          ? await supabase
              .from("seller_breed_profiles")
              .select(sellerBreedProfileSelect)
              .eq("store_id", seller.store_id)
              .in("id", profileIds)
              .returns<SellerBreedProfileRead[]>()
          : { data: [], error: null };

      if (!isMounted) return;

      if (profileResult.error) {
        setLoadError(profileResult.error.message);
        setIsLoading(false);
        return;
      }

      const first = nextRows[0];
      const nextProfiles = profileResult.data ?? [];
      const buyerDescription = formatBuyerDescription(nextProfiles);

      setRows(nextRows);
      setBreedProfiles(nextProfiles);
      setDescriptionDraft(buyerDescription);
      setIsDescriptionEditing(false);
      setDetailsDraft(
        first
          ? {
              availableDate: first.available_date,
              customLabel: first.custom_inventory_label ?? "",
              inventoryType: first.inventory_type,
              originDate: first.origin_date ?? "",
            }
          : null,
      );
      setIsLoading(false);
    }

    void loadInventory();

    return () => {
      isMounted = false;
    };
  }, [listingBatchId, reloadKey, seller]);

  const summary = useMemo(() => summarizeRows(rows), [rows]);
  const buyerDescription = formatBuyerDescription(breedProfiles);
  const firstRow = rows[0] ?? null;
  const canSaveDetails = Boolean(firstRow && detailsDraft);
  const canHide = summary?.visibilityStatus === "active";
  const canArchive =
    summary?.visibilityStatus === "active" || summary?.visibilityStatus === "hidden";

  function updateDetailsDraft(updates: Partial<DetailsDraft>) {
    setDetailsDraft((current) => (current ? { ...current, ...updates } : current));
    setDetailsError(null);
    setSuccessMessage(null);
  }

  async function saveDetails() {
    if (!firstRow || !detailsDraft || isSavingDetails) return;

    const validationMessage = validateDetails(detailsDraft, firstRow.batch_type);

    if (validationMessage) {
      setDetailsError(validationMessage);
      return;
    }

    setIsSavingDetails(true);
    setDetailsError(null);
    setSuccessMessage(null);

    const nextOriginDate =
      firstRow.batch_type === "hatching_eggs"
        ? detailsDraft.availableDate
        : detailsDraft.originDate;
    const datesChanged =
      nextOriginDate !== (firstRow.origin_date ?? "") ||
      detailsDraft.availableDate !== firstRow.available_date;

    if (datesChanged) {
      if (firstRow.base_price == null) {
        setDetailsError("A base price is required before dates can be changed.");
        setIsSavingDetails(false);
        return;
      }

      const batchResult = await supabase.rpc("seller_update_listing_batch", {
        p_available_date: detailsDraft.availableDate,
        p_auto_price_increase_amount: null,
        p_auto_price_increase_enabled: false,
        p_auto_price_increase_max_price: null,
        p_base_price: firstRow.base_price,
        p_internal_batch_label: firstRow.internal_batch_label,
        p_listing_batch_id: listingBatchId,
        p_origin_date: nextOriginDate,
        p_seller_notes: firstRow.listing_batch_seller_notes,
      });

      if (batchResult.error) {
        setDetailsError(batchResult.error.message);
        setIsSavingDetails(false);
        return;
      }
    }

    const typeChanged =
      detailsDraft.inventoryType !== firstRow.inventory_type ||
      detailsDraft.customLabel !== (firstRow.custom_inventory_label ?? "");

    if (typeChanged) {
      const itemResult = await supabase.rpc("seller_update_inventory_item", {
        p_custom_inventory_label:
          detailsDraft.inventoryType === "other"
            ? detailsDraft.customLabel.trim()
            : null,
        p_inventory_item_id: firstRow.inventory_item_id,
        p_inventory_type: detailsDraft.inventoryType,
        p_price_override: firstRow.price_override,
        p_seller_notes: firstRow.inventory_seller_notes,
        p_sort_order: firstRow.inventory_item_sort_order ?? 0,
      });

      if (itemResult.error) {
        setDetailsError(itemResult.error.message);
        setIsSavingDetails(false);
        return;
      }
    }

    setIsSavingDetails(false);
    setSuccessMessage("Inventory details saved.");
    setReloadKey((current) => current + 1);
  }

  async function saveBuyerDescription() {
    if (isDescriptionSaving) return;

    const nextDescription = descriptionDraft.trim();

    if (nextDescription.length > buyerDescriptionMaxLength) {
      setDescriptionError(
        `Buyer description must be ${buyerDescriptionMaxLength} characters or less.`,
      );
      return;
    }

    if (breedProfiles.length !== 1) {
      setDescriptionError(
        "Buyer description editing is only available for single-breed inventory right now.",
      );
      return;
    }

    const profile = breedProfiles[0];

    setIsDescriptionSaving(true);
    setDescriptionError(null);
    setSuccessMessage(null);

    const result = await supabase.rpc("seller_upsert_breed_profile", {
      p_breed_id: profile.breed_id,
      p_custom_breed_name: profile.custom_breed_name,
      p_display_name: profile.display_name,
      p_seller_breed_profile_id: profile.id,
      p_seller_description: nextDescription || null,
      p_seller_notes: profile.seller_notes,
      p_species_id: profile.species_id,
      p_store_id: storeId,
      p_visibility_status: profile.visibility_status,
    });

    if (result.error) {
      setDescriptionError(result.error.message);
      setIsDescriptionSaving(false);
      return;
    }

    setIsDescriptionSaving(false);
    setIsDescriptionEditing(false);
    setSuccessMessage("Storefront content saved.");
    setReloadKey((current) => current + 1);
  }

  async function updateVisibility(nextStatus: "archived" | "hidden") {
    if (!summary || isHiding || isArchiving) return;

    if (nextStatus === "hidden") setIsHiding(true);
    if (nextStatus === "archived") setIsArchiving(true);
    setVisibilityError(null);
    setSuccessMessage(null);

    const result = await supabase.rpc("seller_set_listing_batch_visibility", {
      p_listing_batch_id: listingBatchId,
      p_visibility_status: nextStatus,
    });

    if (result.error) {
      setVisibilityError(result.error.message);
      setIsHiding(false);
      setIsArchiving(false);
      return;
    }

    setIsHiding(false);
    setIsArchiving(false);
    setSuccessMessage(
      nextStatus === "archived"
        ? "Inventory archived. Historical records are preserved."
        : "Inventory hidden from the storefront.",
    );
    setReloadKey((current) => current + 1);
  }

  if (isLoading) return <LoadingState label="Loading inventory" />;

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-5xl px-5 py-5 sm:px-7">
        <ErrorState title="Inventory could not load" message={loadError} />
      </div>
    );
  }

  if (!summary || !firstRow || !detailsDraft) {
    return (
      <div className="mx-auto w-full max-w-5xl px-5 py-5 sm:px-7">
        <EmptyState
          title="Inventory not found"
          description="This inventory may have been archived, removed, or may not belong to this seller account."
          action={
            <Link className="seller-secondary-button" href="/dashboard/inventory">
              Back to Inventory
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <>
      <SellerPageHeader
        eyebrow={seller?.store_name}
        title={summary.title}
        description={summary.inventoryTypes.join(", ")}
        action={
          <Link className="seller-secondary-button" href="/dashboard/inventory">
            Back to Inventory
          </Link>
        }
      />

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5 sm:px-7">
        {successMessage ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
            {successMessage}
          </div>
        ) : null}

        <HeaderSummary summary={summary} />

        <InventoryDetailsSection
          draft={detailsDraft}
          firstRow={firstRow}
          isSaving={isSavingDetails}
          summary={summary}
          saveError={detailsError}
          canSave={canSaveDetails}
          onSave={() => void saveDetails()}
          onUpdate={updateDetailsDraft}
        />

        <StorefrontContentSection
          buyerDescription={buyerDescription}
          descriptionDraft={descriptionDraft}
          error={descriptionError}
          isEditing={isDescriptionEditing}
          isSaving={isDescriptionSaving}
          onCancel={() => {
            setDescriptionDraft(buyerDescription);
            setIsDescriptionEditing(false);
            setDescriptionError(null);
          }}
          onEdit={() => setIsDescriptionEditing(true)}
          onSave={() => void saveBuyerDescription()}
          setDescriptionDraft={setDescriptionDraft}
        />

        <VisibilitySection
          canArchive={canArchive}
          canHide={canHide}
          error={visibilityError}
          isArchiving={isArchiving}
          isHiding={isHiding}
          summary={summary}
          onArchive={() => void updateVisibility("archived")}
          onHide={() => void updateVisibility("hidden")}
        />
      </main>
    </>
  );
}

function HeaderSummary({ summary }: { summary: InventorySummary }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-3xl font-semibold text-stone-950">
          {summary.title}
        </h2>
        <p className="mt-1 text-2xl text-stone-950">
          {summary.inventoryTypes.join(", ")}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusBadge status={formatVisibilityBadgeStatus(summary)} />
        <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
          {formatSummaryAvailability(summary)}
        </span>
      </div>
    </div>
  );
}

function InventoryDetailsSection({
  canSave,
  draft,
  firstRow,
  isSaving,
  onSave,
  onUpdate,
  saveError,
  summary,
}: {
  canSave: boolean;
  draft: DetailsDraft;
  firstRow: SellerInventoryManagementRow;
  isSaving: boolean;
  onSave: () => void;
  onUpdate: (updates: Partial<DetailsDraft>) => void;
  saveError: string | null;
  summary: InventorySummary;
}) {
  const inventoryOptions =
    firstRow.batch_type === "hatching_eggs"
      ? hatchingEggInventoryTypes
      : liveAnimalInventoryTypes;
  const canEditType = summary.inventoryTypes.length === 1;
  const customTypeSelected = draft.inventoryType === "other";

  return (
    <SellerCard className="p-5">
      <h2 className="text-lg font-semibold text-stone-950">
        Inventory Details
      </h2>
      <p className="mt-1 text-sm leading-6 text-stone-600">
        Edit the core details for this inventory.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <ReadOnlyField label="Species" value={summary.speciesName} />
        <ReadOnlyField label="Breed" value={summary.breedNames.join(", ")} />
        <label className="grid gap-1 text-sm font-semibold text-stone-700">
          Type / Sex
          <select
            className="seller-form-field"
            disabled={!canEditType}
            value={draft.inventoryType}
            onChange={(event) => onUpdate({ inventoryType: event.target.value })}
          >
            {inventoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {!canEditType ? (
            <span className="text-xs font-normal text-stone-500">
              Multiple types are managed from the Inventory table.
            </span>
          ) : null}
        </label>
        <ReadOnlyField label="Inventory Type" value={formatBatchType(firstRow.batch_type)} />
        {customTypeSelected ? (
          <label className="grid gap-1 text-sm font-semibold text-stone-700 md:col-span-2">
            Custom type label
            <input
              className="seller-form-field"
              value={draft.customLabel}
              onChange={(event) => onUpdate({ customLabel: event.target.value })}
            />
          </label>
        ) : null}
        <label className="grid gap-1 text-sm font-semibold text-stone-700">
          Hatch Date
          <input
            className="seller-form-field"
            disabled={firstRow.batch_type === "hatching_eggs"}
            type="date"
            value={draft.originDate}
            onChange={(event) => onUpdate({ originDate: event.target.value })}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-stone-700">
          Available Date
          <input
            className="seller-form-field"
            type="date"
            value={draft.availableDate}
            onChange={(event) => onUpdate({ availableDate: event.target.value })}
          />
        </label>
      </div>

      <div className="mt-5">
        <button
          className="seller-primary-button"
          disabled={!canSave || isSaving}
          onClick={onSave}
          type="button"
        >
          {isSaving ? "Saving" : "Save Changes"}
        </button>
      </div>

      {saveError ? (
        <div className="mt-4">
          <ErrorState title="Inventory details were not saved" message={saveError} />
        </div>
      ) : null}
    </SellerCard>
  );
}

function StorefrontContentSection({
  buyerDescription,
  descriptionDraft,
  error,
  isEditing,
  isSaving,
  onCancel,
  onEdit,
  onSave,
  setDescriptionDraft,
}: {
  buyerDescription: string;
  descriptionDraft: string;
  error: string | null;
  isEditing: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onEdit: () => void;
  onSave: () => void;
  setDescriptionDraft: (value: string) => void;
}) {
  return (
    <SellerCard className="p-5">
      <h2 className="text-lg font-semibold text-stone-950">
        Storefront Content
      </h2>
      <p className="mt-1 text-sm leading-6 text-stone-600">
        Manage what buyers see on your storefront.
      </p>

      <div className="mt-5 grid gap-5">
        <div className="grid gap-3 border-b border-stone-200 pb-5 sm:grid-cols-[1fr_auto] sm:items-start">
          <div>
            <h3 className="font-semibold text-stone-950">
              Description buyers see
            </h3>
            {isEditing ? (
              <textarea
                className="seller-form-field mt-3 min-h-32 resize-y py-3"
                maxLength={buyerDescriptionMaxLength}
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
              />
            ) : (
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-stone-700">
                {buyerDescription || "No buyer description yet."}
              </p>
            )}
          </div>
          {isEditing ? (
            <div className="flex gap-2">
              <button className="seller-secondary-button" onClick={onCancel} type="button">
                Cancel
              </button>
              <button
                className="seller-primary-button"
                disabled={isSaving}
                onClick={onSave}
                type="button"
              >
                {isSaving ? "Saving" : "Save"}
              </button>
            </div>
          ) : (
            <button className="seller-secondary-button" onClick={onEdit} type="button">
              Edit Description
            </button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <h3 className="font-semibold text-stone-950">Photos buyers see</h3>
            <p className="mt-2 text-sm leading-6 text-stone-700">
              Photos are managed through the existing listing photo tools for
              now.
            </p>
          </div>
          <button className="seller-secondary-button" disabled type="button">
            Manage Photos
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4">
          <ErrorState title="Storefront content was not saved" message={error} />
        </div>
      ) : null}
    </SellerCard>
  );
}

function VisibilitySection({
  canArchive,
  canHide,
  error,
  isArchiving,
  isHiding,
  onArchive,
  onHide,
  summary,
}: {
  canArchive: boolean;
  canHide: boolean;
  error: string | null;
  isArchiving: boolean;
  isHiding: boolean;
  onArchive: () => void;
  onHide: () => void;
  summary: InventorySummary;
}) {
  return (
    <SellerCard className="p-5">
      <h2 className="text-lg font-semibold text-stone-950">Visibility</h2>
      <p className="mt-1 text-sm leading-6 text-stone-600">
        Control where this inventory appears.
      </p>
      <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <StatusBadge status={formatVisibilityBadgeStatus(summary)} />
            <p className="mt-2 text-sm leading-6 text-stone-700">
              Archiving removes inventory from the storefront while preserving
              historical records.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {canHide ? (
              <button
                className="seller-secondary-button bg-white"
                disabled={isHiding}
                onClick={onHide}
                type="button"
              >
                {isHiding ? "Hiding" : "Hide from Storefront"}
              </button>
            ) : null}
            {canArchive ? (
              <button
                className="seller-secondary-button border-red-300 bg-white text-red-700 hover:bg-red-50"
                disabled={isArchiving}
                onClick={onArchive}
                type="button"
              >
                {isArchiving ? "Archiving" : "Archive Inventory"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {error ? (
        <div className="mt-4">
          <ErrorState title="Visibility was not changed" message={error} />
        </div>
      ) : null}
    </SellerCard>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-stone-700">
      {label}
      <input className="seller-form-field" disabled value={value} />
    </label>
  );
}

function summarizeRows(rows: SellerInventoryManagementRow[]): InventorySummary | null {
  const first = rows[0];

  if (!first) return null;

  const breedNames = uniqueSorted(rows.map((row) => row.breed_display_name));
  const inventoryTypes = uniqueSorted(rows.map(formatInventoryType));

  return {
    availableDate: first.available_date,
    batchType: first.batch_type,
    breedNames,
    inventoryTypes,
    speciesName: first.species_name,
    title: breedNames.join(", "),
    totalAvailable: rows.reduce(
      (total, row) => total + (row.quantity_available ?? 0),
      0,
    ),
    visibilityStatus: first.listing_batch_visibility_status,
  };
}

function validateDetails(draft: DetailsDraft, batchType: string) {
  if (!draft.availableDate) return "Add an available date.";
  if (batchType !== "hatching_eggs" && !draft.originDate) {
    return "Add a hatch date.";
  }
  if (
    batchType !== "hatching_eggs" &&
    draft.originDate &&
    draft.availableDate < draft.originDate
  ) {
    return "Available date cannot be before hatch date.";
  }
  if (draft.inventoryType === "other" && !draft.customLabel.trim()) {
    return "Add a custom type label.";
  }

  return null;
}

function formatBuyerDescription(profiles: SellerBreedProfileRead[]) {
  return uniqueSorted(
    profiles
      .map((profile) => profile.seller_description?.trim())
      .filter((value): value is string => Boolean(value)),
  ).join("\n\n");
}

function formatInventoryType(row: SellerInventoryManagementRow) {
  return row.custom_inventory_label || formatInventoryTypeLabel(row.inventory_type);
}

function formatBatchType(value: string | null | undefined) {
  if (value === "hatching_eggs") return "Hatching eggs";
  if (value === "live_animals") return "Birds";

  return value ? value.replaceAll("_", " ") : "Not set";
}

function formatVisibilityBadgeStatus(summary: InventorySummary) {
  if (summary.visibilityStatus === "active" && summary.totalAvailable <= 0) {
    return "sold_out";
  }
  if (summary.visibilityStatus === "active") return "live";
  if (summary.visibilityStatus === "hidden") return "draft";

  return summary.visibilityStatus;
}

function formatSummaryAvailability(summary: InventorySummary) {
  const visibility = formatVisibilityBadgeStatus(summary);

  if (visibility === "sold_out") return "Sold Out";
  if (visibility !== "live") return "Not visible";
  if (summary.availableDate && isFutureDate(summary.availableDate)) {
    return `Available ${formatShortDate(summary.availableDate)}`;
  }

  return "Available Now";
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
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

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}
