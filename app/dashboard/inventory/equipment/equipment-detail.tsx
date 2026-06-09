"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import {
  EquipmentPhotosSection,
  sellerMediaSelect,
  type ListingPhotoItem,
} from "../../_components/equipment-photos";
import {
  equipmentCategories,
  equipmentConditions,
  type EquipmentDraftDeleteStatus,
  type EquipmentInventoryRow,
  formatCurrency,
  formatDate,
  formatEquipmentStatus,
  validateEquipmentForm,
} from "../../_lib/equipment-inventory";

type EquipmentForm = {
  itemName: string;
  category: string;
  condition: string;
  quantityAvailable: string;
  price: string;
  description: string;
  sellerNotes: string;
};

const emptyForm: EquipmentForm = {
  itemName: "",
  category: "",
  condition: "",
  quantityAvailable: "",
  price: "",
  description: "",
  sellerNotes: "",
};

export function EquipmentInventoryDetail({
  equipmentItemId,
}: {
  equipmentItemId: string;
}) {
  const router = useRouter();
  const { seller } = useSellerContext();
  const [row, setRow] = useState<EquipmentInventoryRow | null>(null);
  const [form, setForm] = useState<EquipmentForm>(emptyForm);
  const [mediaItems, setMediaItems] = useState<ListingPhotoItem[]>([]);
  const [canDeleteDraft, setCanDeleteDraft] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function loadEquipment() {
      if (!seller) return;

      setIsLoading(true);
      setActionError(null);
      setSaveError(null);

      const equipmentResult = await supabase
        .from("seller_equipment_inventory_management")
        .select("*")
        .eq("store_id", seller.store_id)
        .eq("equipment_inventory_item_id", equipmentItemId)
        .maybeSingle<EquipmentInventoryRow>();

      if (!isMounted) return;

      if (equipmentResult.error) {
        setActionError(equipmentResult.error.message);
        setIsLoading(false);
        return;
      }

      const nextRow = equipmentResult.data;

      if (!nextRow) {
        setRow(null);
        setMediaItems([]);
        setIsLoading(false);
        return;
      }

      const [deleteStatusResult, mediaResult] = await Promise.all([
        supabase.rpc("seller_get_equipment_draft_delete_status", {
          p_equipment_inventory_item_id: equipmentItemId,
        }),
        supabase
          .from("seller_media_management")
          .select(sellerMediaSelect)
          .eq("store_id", seller.store_id)
          .eq("entity_type", "equipment_inventory_item")
          .eq("entity_id", equipmentItemId)
          .returns<ListingPhotoItem[]>(),
      ]);

      if (!isMounted) return;

      if (deleteStatusResult.error) {
        setActionError(deleteStatusResult.error.message);
      } else {
        const statusRows = Array.isArray(deleteStatusResult.data)
          ? (deleteStatusResult.data as EquipmentDraftDeleteStatus[])
          : [];
        setCanDeleteDraft(Boolean(statusRows[0]?.can_delete));
      }

      if (mediaResult.error) {
        setActionError(mediaResult.error.message);
      } else {
        setMediaItems(mediaResult.data ?? []);
      }

      setRow(nextRow);
      setForm(toForm(nextRow));
      setIsLoading(false);
    }

    void loadEquipment();

    return () => {
      isMounted = false;
    };
  }, [equipmentItemId, reloadKey, seller]);

  const isArchived = row?.visibility_status === "archived";
  const isDraft = row?.visibility_status === "hidden";
  const hasUnsavedChanges = useMemo(
    () => (row ? JSON.stringify(form) !== JSON.stringify(toForm(row)) : false),
    [form, row],
  );

  function updateField(field: keyof EquipmentForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
    setActionError(null);
    setSuccessMessage(null);
  }

  async function saveDetails() {
    if (!row || isSaving || isArchived) return;

    const validationErrors = validateEquipmentForm(form);

    if (validationErrors.length > 0) {
      setSaveError(validationErrors.join(" "));
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setActionError(null);
    setSuccessMessage(null);

    const result = await supabase.rpc("seller_update_equipment_inventory_item", {
      p_equipment_inventory_item_id: row.equipment_inventory_item_id,
      p_item_name: form.itemName.trim(),
      p_category: form.category,
      p_quantity_available: Number(form.quantityAvailable),
      p_price: Number(form.price),
      p_condition: form.condition || null,
      p_description: form.description.trim() || null,
      p_seller_notes: form.sellerNotes.trim() || null,
    });

    if (result.error) {
      setSaveError(result.error.message);
      setIsSaving(false);
      return;
    }

    setSuccessMessage("Equipment inventory saved.");
    setIsSaving(false);
    setReloadKey((current) => current + 1);
  }

  async function updateVisibility(nextStatus: "active" | "hidden" | "archived") {
    if (!row || isSaving || isDeleting) return;

    setIsSaving(true);
    setActionError(null);
    setSaveError(null);
    setSuccessMessage(null);

    const result = await supabase.rpc(
      "seller_set_equipment_inventory_visibility",
      {
        p_equipment_inventory_item_id: row.equipment_inventory_item_id,
        p_visibility_status: nextStatus,
      },
    );

    if (result.error) {
      setActionError(result.error.message);
      setIsSaving(false);
      return;
    }

    setSuccessMessage(
      nextStatus === "active"
        ? "Equipment inventory published."
        : nextStatus === "hidden"
          ? "Equipment inventory hidden."
          : "Equipment inventory archived.",
    );
    setIsSaving(false);
    setReloadKey((current) => current + 1);
  }

  async function deleteDraft() {
    if (!row || !canDeleteDraft || isDeleting) return;

    const shouldDelete = window.confirm("Delete this draft? This cannot be undone.");

    if (!shouldDelete) return;

    setIsDeleting(true);
    setActionError(null);
    setSaveError(null);

    const result = await supabase.rpc("seller_delete_equipment_draft", {
      p_equipment_inventory_item_id: row.equipment_inventory_item_id,
    });

    if (result.error) {
      setActionError(result.error.message);
      setIsDeleting(false);
      return;
    }

    router.push("/dashboard/inventory");
  }

  if (isLoading) return <LoadingState label="Loading equipment inventory" />;

  if (actionError && !row) {
    return (
      <div className="mx-auto w-full max-w-5xl px-5 py-5 sm:px-7">
        <ErrorState title="Equipment inventory could not load" message={actionError} />
      </div>
    );
  }

  if (!row) {
    return (
      <div className="mx-auto w-full max-w-5xl px-5 py-5 sm:px-7">
        <EmptyState
          title="Equipment inventory not found"
          description="This item may have been archived, deleted, or may not belong to this seller account."
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
        title={row.item_name}
        description="Manage this Equipment & Supplies inventory record."
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

        <SellerCard className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-stone-950">
                Inventory Summary
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                {row.category}
                {row.condition ? ` - ${row.condition}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={deriveStatusBadge(row)} />
              <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
                {formatEquipmentStatus(row)}
              </span>
            </div>
          </div>

          <dl className="mt-5 grid gap-3 sm:grid-cols-3">
            <Metric label="Quantity" value={String(row.quantity_available)} />
            <Metric label="Price" value={formatCurrency(row.price)} />
            <Metric label="Updated" value={formatDate(row.updated_at)} />
          </dl>
        </SellerCard>

        <SellerCard className="p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-stone-950">
                Equipment Details
              </h2>
              <p className="mt-1 text-sm leading-6 text-stone-600">
                Edit item details, quantity, and price.
              </p>
            </div>
            {isArchived ? (
              <span className="text-sm font-semibold text-stone-500">
                Archived items are read-only.
              </span>
            ) : null}
          </div>

          <div className="mt-5 grid gap-5">
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Item Name
              <input
                className="seller-form-field"
                disabled={isArchived}
                value={form.itemName}
                onChange={(event) => updateField("itemName", event.target.value)}
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Category
                <select
                  className="seller-form-field"
                  disabled={isArchived}
                  value={form.category}
                  onChange={(event) => updateField("category", event.target.value)}
                >
                  <option value="">Choose a category</option>
                  {equipmentCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Condition
                <select
                  className="seller-form-field"
                  disabled={isArchived}
                  value={form.condition}
                  onChange={(event) => updateField("condition", event.target.value)}
                >
                  <option value="">Not specified</option>
                  {equipmentConditions.map((condition) => (
                    <option key={condition} value={condition}>
                      {condition}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Quantity Available
                <input
                  className="seller-form-field"
                  disabled={isArchived}
                  min="0"
                  step="1"
                  type="number"
                  value={form.quantityAvailable}
                  onChange={(event) =>
                    updateField("quantityAvailable", event.target.value)
                  }
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Price
                <input
                  className="seller-form-field"
                  disabled={isArchived}
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.price}
                  onChange={(event) => updateField("price", event.target.value)}
                />
              </label>
            </div>

            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Description
              <textarea
                className="seller-form-field min-h-28 resize-y py-3"
                disabled={isArchived}
                value={form.description}
                onChange={(event) => updateField("description", event.target.value)}
              />
            </label>

            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Seller Notes
              <textarea
                className="seller-form-field min-h-24 resize-y py-3"
                disabled={isArchived}
                value={form.sellerNotes}
                onChange={(event) => updateField("sellerNotes", event.target.value)}
              />
            </label>

            {saveError ? (
              <ErrorState title="Equipment details were not saved" message={saveError} />
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                className="seller-primary-button"
                disabled={isArchived || isSaving || !hasUnsavedChanges}
                onClick={() => void saveDetails()}
                type="button"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </SellerCard>

        <EquipmentPhotosSection
          canManage={!isArchived}
          equipmentItemId={row.equipment_inventory_item_id}
          mediaItems={mediaItems}
          storeId={row.store_id}
          onReload={() => setReloadKey((current) => current + 1)}
        />

        <SellerCard className="p-5">
          <h2 className="text-lg font-semibold text-stone-950">Visibility</h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Control whether this equipment appears in seller listing workflows.
            Public storefront display is not included yet.
          </p>

          <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <StatusBadge status={deriveStatusBadge(row)} />
                <p className="mt-2 text-sm leading-6 text-stone-700">
                  {canDeleteDraft
                    ? "This draft has not been published, so it can be deleted."
                    : "Archiving preserves this equipment record for history."}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {isDraft ? (
                  <button
                    className="seller-primary-button"
                    disabled={isSaving}
                    onClick={() => void updateVisibility("active")}
                    type="button"
                  >
                    Publish
                  </button>
                ) : null}
                {row.visibility_status === "active" ? (
                  <button
                    className="seller-secondary-button bg-white"
                    disabled={isSaving}
                    onClick={() => void updateVisibility("hidden")}
                    type="button"
                  >
                    Hide
                  </button>
                ) : null}
                {canDeleteDraft ? (
                  <button
                    className="seller-secondary-button border-red-300 bg-white text-red-700 hover:bg-red-50"
                    disabled={isDeleting}
                    onClick={() => void deleteDraft()}
                    type="button"
                  >
                    {isDeleting ? "Deleting..." : "Delete Draft"}
                  </button>
                ) : null}
                {!canDeleteDraft && row.visibility_status !== "archived" ? (
                  <button
                    className="seller-secondary-button border-red-300 bg-white text-red-700 hover:bg-red-50"
                    disabled={isSaving}
                    onClick={() => void updateVisibility("archived")}
                    type="button"
                  >
                    Archive
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {actionError ? (
            <div className="mt-4">
              <ErrorState title="Inventory action was not completed" message={actionError} />
            </div>
          ) : null}
        </SellerCard>
      </main>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-stone-50 px-3 py-3">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </dt>
      <dd className="mt-1 text-lg font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

function toForm(row: EquipmentInventoryRow): EquipmentForm {
  return {
    itemName: row.item_name,
    category: row.category,
    condition: row.condition ?? "",
    quantityAvailable: String(row.quantity_available),
    price: String(row.price),
    description: row.description ?? "",
    sellerNotes: row.seller_notes ?? "",
  };
}

function deriveStatusBadge(row: EquipmentInventoryRow) {
  if (row.visibility_status === "hidden") return "draft";
  if (row.visibility_status === "active") return "live";

  return row.visibility_status;
}
