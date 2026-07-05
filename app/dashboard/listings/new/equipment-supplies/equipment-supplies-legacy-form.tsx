"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getPlanCapabilities } from "@/lib/plan-capabilities";
import { supabase } from "@/lib/supabase";
import { PlanUpgradePrompt } from "../../../_components/plan-upgrade-prompt";
import { useSellerContext } from "../../../_components/seller-context";
import {
  ErrorState,
  LoadingState,
  SellerCard,
  SellerPageHeader,
} from "../../../_components/seller-ui";
import {
  PendingEquipmentPhotosField,
  uploadEquipmentPhotos,
  validateEquipmentPhotoFiles,
} from "../../../_components/equipment-photos";
import {
  equipmentCategories,
  equipmentConditions,
  validateEquipmentForm,
} from "../../../_lib/equipment-inventory";

type EquipmentCreateResult = {
  id?: string;
  equipment_inventory_item_id?: string;
};

const emptyForm = {
  itemName: "",
  category: "",
  condition: "",
  quantityAvailable: "",
  price: "",
  description: "",
};

export function EquipmentSuppliesLegacyForm() {
  const router = useRouter();
  const { seller, isLoading } = useSellerContext();
  const plan = getPlanCapabilities(seller?.plan_key);
  const equipmentSuppliesEnabled =
    Boolean(seller?.equipment_supplies_enabled) && plan.equipmentSuppliesEnabled;
  const [form, setForm] = useState(emptyForm);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [activeAction, setActiveAction] = useState<"draft" | "publish" | null>(
    null,
  );
  const isSaving = activeAction !== null;

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setValidationErrors([]);
    setSaveError(null);
  }

  function updatePhotos(nextPhotos: File[]) {
    setPhotos(nextPhotos);
    setValidationErrors([]);
    setSaveError(null);
  }

  async function saveEquipment(action: "draft" | "publish") {
    if (!seller || isSaving) return;

    const errors = validateEquipmentForm(form);
    const photoError = validateEquipmentPhotoFiles(photos);

    if (photoError) errors.push(photoError);

    setValidationErrors(errors);
    setSaveError(null);

    if (errors.length > 0) return;

    setActiveAction(action);

    const result = await supabase.rpc("seller_create_equipment_inventory_item", {
      p_store_id: seller.store_id,
      p_item_name: form.itemName.trim(),
      p_category: form.category,
      p_quantity_available: Number(form.quantityAvailable),
      p_price: Number(form.price),
      p_condition: form.condition || null,
      p_description: form.description.trim() || null,
      p_seller_notes: null,
    });

    if (result.error) {
      setSaveError(result.error.message);
      setActiveAction(null);
      return;
    }

    const created = result.data as EquipmentCreateResult | null;

    if (!created?.id && !created?.equipment_inventory_item_id) {
      setSaveError("Equipment inventory was created, but the detail page could not open.");
      setActiveAction(null);
      return;
    }

    const createdId =
      created.equipment_inventory_item_id ?? (created.id as string);

    const uploadResult = await uploadEquipmentPhotos({
      equipmentItemId: createdId,
      photos,
      storeId: seller.store_id,
    });

    if (!uploadResult.ok) {
      setSaveError(
        `Equipment was saved as a draft, but photos were not uploaded. ${uploadResult.message}`,
      );
      setActiveAction(null);
      return;
    }

    if (action === "publish") {
      const publishResult = await supabase.rpc(
        "seller_set_equipment_inventory_visibility",
        {
          p_equipment_inventory_item_id: createdId,
          p_visibility_status: "active",
        },
      );

      if (publishResult.error) {
        setSaveError(publishResult.error.message);
        setActiveAction(null);
        return;
      }

      router.push("/dashboard");
      return;
    }

    router.push(`/dashboard/inventory/equipment/${createdId}`);
  }

  if (isLoading) {
    return <LoadingState label="Loading selling options..." />;
  }

  if (!equipmentSuppliesEnabled) {
    return (
      <>
        <SellerPageHeader
          title="Equipment & Supplies"
          description="This selling option is currently turned off for your store."
          action={
            <Link
              className="seller-secondary-button"
              href="/dashboard/listings/new"
            >
              Back
            </Link>
          }
        />

        <main className="mx-auto w-full max-w-3xl px-5 py-5 sm:px-7">
          <SellerCard className="p-5">
            {!plan.equipmentSuppliesEnabled ? (
              <PlanUpgradePrompt feature="equipment_supplies" />
            ) : (
              <>
                <h2 className="text-xl font-semibold text-stone-950">
                  Equipment & Supplies is turned off for this store.
                </h2>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  Turn it on from Store Admin when you want this creation option
                  to appear.
                </p>
              </>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                className="seller-primary-button"
                href="/dashboard/store-admin"
              >
                Store Admin
              </Link>
              <Link className="seller-secondary-button" href="/dashboard">
                Dashboard
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
        title="Equipment & Supplies"
        description="Create simple local-pickup inventory for equipment and supplies."
        action={
          <Link
            className="seller-secondary-button"
            href="/dashboard/listings/new"
          >
            Back
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-3xl px-5 py-5 sm:px-7">
        <SellerCard className="p-5">
          <div className="grid gap-5">
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Item Name
              <input
                className="seller-form-field"
                value={form.itemName}
                onChange={(event) => updateField("itemName", event.target.value)}
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Category
                <select
                  className="seller-form-field"
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
                className="seller-form-field min-h-32 resize-y py-3"
                value={form.description}
                onChange={(event) => updateField("description", event.target.value)}
              />
            </label>

            <PendingEquipmentPhotosField
              disabled={isSaving}
              photos={photos}
              onChange={updatePhotos}
            />

            {validationErrors.length > 0 ? (
              <ErrorState
                title="Check the equipment details"
                message={validationErrors.join(" ")}
              />
            ) : null}
            {saveError ? (
              <ErrorState title="Equipment was not saved" message={saveError} />
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                className="seller-secondary-button"
                disabled={isSaving}
                onClick={() => void saveEquipment("draft")}
                type="button"
              >
                {activeAction === "draft" ? "Saving..." : "Save Draft"}
              </button>
              <button
                className="seller-primary-button"
                disabled={isSaving}
                onClick={() => void saveEquipment("publish")}
                type="button"
              >
                {activeAction === "publish" ? "Publishing..." : "Publish"}
              </button>
              <Link className="seller-secondary-button" href="/dashboard/inventory">
                Cancel
              </Link>
            </div>
          </div>
        </SellerCard>
      </main>
    </>
  );
}
