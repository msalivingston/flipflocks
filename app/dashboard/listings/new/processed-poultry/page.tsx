"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../../../_components/seller-context";
import {
  ErrorState,
  LoadingState,
  SellerCard,
  SellerPageHeader,
} from "../../../_components/seller-ui";
import {
  PendingProcessedPoultryPhotosField,
  uploadProcessedPoultryPhotos,
  validateProcessedPoultryPhotoFiles,
} from "../../../_components/processed-poultry-photos";
import {
  poultryTypes,
  processedPoultryProductTypes,
  validateProcessedPoultryForm,
} from "../../../_lib/processed-poultry-inventory";

type ProcessedPoultryCreateResult = {
  id?: string;
  processed_poultry_inventory_item_id?: string;
};

const emptyForm = {
  productName: "",
  poultryType: "",
  productType: "",
  packageSize: "",
  quantityAvailable: "",
  price: "",
  description: "",
};

export default function ProcessedPoultryCreatePage() {
  const router = useRouter();
  const { seller, isLoading } = useSellerContext();
  const processedPoultryEnabled = Boolean(seller?.processed_poultry_enabled);
  const [form, setForm] = useState(emptyForm);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveErrorTitle, setSaveErrorTitle] = useState("Processed poultry was not saved");
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

  async function saveProcessedPoultry(action: "draft" | "publish") {
    if (!seller || isSaving) return;

    const errors = validateProcessedPoultryForm(form);
    const photoError = validateProcessedPoultryPhotoFiles(photos);

    if (photoError) errors.push(photoError);

    setValidationErrors(errors);
    setSaveError(null);
    setSaveErrorTitle("Processed poultry was not saved");

    if (errors.length > 0) return;

    setActiveAction(action);

    const result = await supabase.rpc(
      "seller_create_processed_poultry_inventory_item",
      {
        p_store_id: seller.store_id,
        p_product_name: form.productName.trim(),
        p_poultry_type: form.poultryType,
        p_product_type: form.productType,
        p_quantity_available: Number(form.quantityAvailable),
        p_price: Number(form.price),
        p_package_size: form.packageSize.trim() || null,
        p_description: form.description.trim() || null,
        p_seller_notes: null,
      },
    );

    if (result.error) {
      setSaveError(result.error.message);
      setActiveAction(null);
      return;
    }

    const created = result.data as ProcessedPoultryCreateResult | null;

    if (!created?.id && !created?.processed_poultry_inventory_item_id) {
      setSaveError("Processed poultry inventory was created, but the detail page could not open.");
      setActiveAction(null);
      return;
    }

    const createdId =
      created.processed_poultry_inventory_item_id ?? (created.id as string);

    const uploadResult = await uploadProcessedPoultryPhotos({
      photos,
      processedPoultryItemId: createdId,
      storeId: seller.store_id,
    });

    if (!uploadResult.ok) {
      setSaveErrorTitle("Processed poultry was saved");
      setSaveError(
        `Processed poultry was saved as a draft, but photos were not uploaded. ${uploadResult.message}`,
      );
      setActiveAction(null);
      return;
    }

    if (action === "publish") {
      const publishResult = await supabase.rpc(
        "seller_set_processed_poultry_inventory_visibility",
        {
          p_processed_poultry_inventory_item_id: createdId,
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

    router.push(`/dashboard/inventory/processed-poultry/${createdId}`);
  }

  if (isLoading) {
    return <LoadingState label="Loading selling options..." />;
  }

  if (!processedPoultryEnabled) {
    return (
      <>
        <SellerPageHeader
          title="Processed Poultry"
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
            <h2 className="text-xl font-semibold text-stone-950">
              Processed Poultry is turned off for this store.
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Turn it on from Store Admin when you want this creation option to
              appear.
            </p>
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
        title="Processed Poultry"
        description="Create simple local-pickup inventory for processed poultry products."
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
              Product Name
              <input
                className="seller-form-field"
                value={form.productName}
                onChange={(event) =>
                  updateField("productName", event.target.value)
                }
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Poultry Type
                <select
                  className="seller-form-field"
                  value={form.poultryType}
                  onChange={(event) =>
                    updateField("poultryType", event.target.value)
                  }
                >
                  <option value="">Choose poultry type</option>
                  {poultryTypes.map((poultryType) => (
                    <option key={poultryType} value={poultryType}>
                      {poultryType}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Product Type
                <select
                  className="seller-form-field"
                  value={form.productType}
                  onChange={(event) =>
                    updateField("productType", event.target.value)
                  }
                >
                  <option value="">Choose product type</option>
                  {processedPoultryProductTypes.map((productType) => (
                    <option key={productType} value={productType}>
                      {productType}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Package Weight / Size
              <input
                className="seller-form-field"
                value={form.packageSize}
                onChange={(event) =>
                  updateField("packageSize", event.target.value)
                }
              />
            </label>

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
                onChange={(event) =>
                  updateField("description", event.target.value)
                }
              />
            </label>

            <PendingProcessedPoultryPhotosField
              disabled={isSaving}
              photos={photos}
              onChange={updatePhotos}
            />

            {validationErrors.length > 0 ? (
              <ErrorState
                title="Check the processed poultry details"
                message={validationErrors.join(" ")}
              />
            ) : null}
            {saveError ? (
              <ErrorState title={saveErrorTitle} message={saveError} />
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                className="seller-secondary-button"
                disabled={isSaving}
                onClick={() => void saveProcessedPoultry("draft")}
                type="button"
              >
                {activeAction === "draft" ? "Saving..." : "Save Draft"}
              </button>
              <button
                className="seller-primary-button"
                disabled={isSaving}
                onClick={() => void saveProcessedPoultry("publish")}
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
