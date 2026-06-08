"use client";

import Image from "next/image";
import { SellerCard } from "../../../_components/seller-ui";
import {
  ListingPhotosSection,
  type ListingPhotoItem,
} from "../../[listingBatchId]/listing-photos-section";
import type {
  PublishReadinessListing,
  PublishReadinessMediaSummary,
} from "../../[listingBatchId]/publish-readiness";
import type { SellerInventoryManagementRow } from "../../../_lib/seller-types";

export type CreationStep = "details" | "inventory" | "photos" | "review";

export type CreationStepDefinition = {
  label: string;
  value: CreationStep;
};

export type InventoryType =
  | "female"
  | "male"
  | "straight_run"
  | "pair"
  | "trio"
  | "other";

export const inventoryTypeOptions: { label: string; value: InventoryType }[] = [
  { label: "Female", value: "female" },
  { label: "Male", value: "male" },
  { label: "Straight Run", value: "straight_run" },
  { label: "Pair", value: "pair" },
  { label: "Trio", value: "trio" },
  { label: "Other", value: "other" },
];

export type BuyerPreviewRow = {
  id: string;
  breed: string;
  description?: string | null;
  type: string;
  quantity: string;
  price: string;
  photo?: ListingPhotoItem | null;
};

export type PriceAdjustmentDirection = "increase" | "decrease";

export type PriceAdjustmentState = {
  enabled: boolean;
  direction: PriceAdjustmentDirection;
  amount: string;
  intervalWeeks: string;
  maxPrice: string;
  minPrice: string;
};

export const emptyPriceAdjustmentState: PriceAdjustmentState = {
  enabled: false,
  direction: "increase",
  amount: "",
  intervalWeeks: "1",
  maxPrice: "",
  minPrice: "",
};

export const listingInventorySelect =
  "store_id, listing_batch_id, listing_batch_breed_id, inventory_item_id, species_id, species_name, species_slug, seller_breed_profile_id, breed_display_name, batch_type, origin_date, available_date, age_at_availability_days, base_price, auto_price_increase_enabled, auto_price_increase_amount, auto_price_increase_max_price, auto_price_adjustment_enabled, price_adjustment_direction, price_adjustment_amount, price_adjustment_interval_weeks, price_adjustment_max_price, price_adjustment_min_price, internal_batch_label, listing_batch_visibility_status, listing_batch_moderation_status, listing_batch_breed_sort_order, listing_batch_breed_visibility_status, listing_batch_breed_moderation_status, inventory_type, custom_inventory_label, quantity_available, price_override, effective_unit_price, inventory_item_sort_order, inventory_visibility_status, inventory_moderation_status, operational_availability_status, inventory_seller_notes, listing_batch_breed_seller_notes, listing_batch_seller_notes, inventory_updated_at, listing_batch_updated_at";

export const sellerMediaSelect =
  "media_asset_id, media_link_id, store_id, entity_type, entity_id, display_context, public_url, alt_text, caption, sort_order, is_featured, moderation_status, asset_status, visibility_status, original_filename, content_type, file_size_bytes, width_px, height_px";

export function CreationStepIndicator({
  step,
  steps,
}: {
  step: CreationStep;
  steps: CreationStepDefinition[];
}) {
  return (
    <ol className="grid gap-2 rounded-lg border border-stone-200 bg-white p-2 text-xs font-semibold text-stone-600 shadow-sm sm:grid-cols-4">
      {steps.map((item, index) => {
        const isActive = item.value === step;

        return (
          <li
            key={item.value}
            className={`rounded-md px-3 py-2 text-center ${
              isActive ? "bg-emerald-800 text-white" : "bg-stone-50"
            }`}
          >
            {index + 1}. {item.label}
          </li>
        );
      })}
    </ol>
  );
}

export function ValidationMessage({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
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

export function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-stone-600">{label}</dt>
      <dd className="mt-1 font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

export function ListingCreationBuyerPreview({
  availableDate,
  description,
  dynamicPricingSummary,
  hatchDate,
  mediaItems,
  price,
  quantity,
  rows,
  speciesBreed,
  title,
  type,
  variant,
}: {
  availableDate: string;
  description?: string | null;
  dynamicPricingSummary: string;
  hatchDate: string;
  mediaItems: ListingPhotoItem[];
  price?: string;
  quantity?: string;
  rows?: BuyerPreviewRow[];
  speciesBreed: string;
  title: string;
  type?: string;
  variant: "simple" | "group";
}) {
  const listingPhoto = pickFeaturedPhoto(mediaItems);
  const hasDynamicPricing = dynamicPricingSummary !== "Off";

  return (
    <SellerCard className="overflow-hidden p-0">
      <section aria-labelledby="buyer-preview-heading">
        <div className="grid gap-0 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.1fr)]">
          <div className="relative min-h-64 bg-stone-100">
            {listingPhoto ? (
              <Image
                alt={listingPhoto.alt_text || "Listing photo"}
                className="h-full w-full object-cover"
                height={listingPhoto.height_px ?? 700}
                src={toPublicImageUrl(listingPhoto.public_url)}
                unoptimized
                width={listingPhoto.width_px ?? 900}
              />
            ) : (
              <div className="flex h-full min-h-64 items-center justify-center px-6 text-center text-sm font-semibold text-stone-500">
                Photos will appear here for buyers
              </div>
            )}
          </div>

          <div className="grid gap-5 p-5">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.08em] text-emerald-800">
                Buyer Preview
              </p>
              <h2
                className="mt-2 text-2xl font-semibold text-stone-950"
                id="buyer-preview-heading"
              >
                {title}
              </h2>
              <p className="mt-2 text-sm font-semibold text-stone-600">
                {speciesBreed}
              </p>
            </div>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {variant === "simple" ? (
                <>
                  <PreviewItem label="Type" value={type ?? "Selected type"} />
                  <PreviewItem
                    label="Quantity available"
                    value={quantity ?? "Selected quantity"}
                  />
                  <PreviewItem label="Price" value={price ?? "Selected price"} />
                </>
              ) : null}
              <PreviewItem label="Hatch date" value={formatDate(hatchDate)} />
              <PreviewItem
                label="Available date"
                value={formatDate(availableDate)}
              />
              {hasDynamicPricing ? (
                <PreviewItem
                  label="Dynamic pricing"
                  value={dynamicPricingSummary}
                />
              ) : null}
            </dl>

            {description?.trim() ? (
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                <h3 className="text-sm font-semibold text-stone-950">
                  Description
                </h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-700">
                  {description.trim()}
                </p>
              </div>
            ) : null}

            {variant === "group" && rows ? (
              <div>
                <h3 className="text-sm font-semibold text-stone-950">
                  Available Birds
                </h3>
                <div className="mt-3 grid gap-2">
                  {rows.map((row) => (
                    <div
                      key={row.id}
                      className="grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm sm:grid-cols-[56px_minmax(0,1fr)] sm:items-center"
                    >
                      <RowPhoto photo={row.photo} />
                      <div className="grid gap-2 sm:grid-cols-4 sm:items-center">
                        <div>
                          <p className="font-semibold text-stone-950">
                            {row.breed}
                          </p>
                          {row.description?.trim() ? (
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-stone-600">
                              {row.description.trim()}
                            </p>
                          ) : null}
                        </div>
                        <p className="text-stone-700">{row.type}</p>
                        <p className="text-stone-700">{row.quantity}</p>
                        <p className="font-semibold text-stone-950">
                          {row.price}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </SellerCard>
  );
}

function PreviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-stone-600">{label}</dt>
      <dd className="mt-1 font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

function RowPhoto({ photo }: { photo?: ListingPhotoItem | null }) {
  if (!photo) {
    return (
      <div className="hidden h-14 w-14 rounded-md bg-stone-200 sm:block" />
    );
  }

  return (
    <Image
      alt={photo.alt_text || "Available bird photo"}
      className="h-14 w-14 rounded-md object-cover"
      height={photo.height_px ?? 120}
      src={toPublicImageUrl(photo.public_url)}
      unoptimized
      width={photo.width_px ?? 120}
    />
  );
}

export function MoneyInput({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-0 top-0 flex h-full w-10 items-center justify-center rounded-l-md border-r border-stone-200 bg-stone-50 text-sm font-semibold text-stone-500">
        $
      </span>
      <input
        className="seller-form-field seller-money-field"
        inputMode="decimal"
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function AgeAtAvailabilityHint({
  availableDate,
  hatchDate,
}: {
  availableDate: string;
  hatchDate: string;
}) {
  const label = formatAgeAtAvailabilityFromDates(hatchDate, availableDate);

  if (!label) return null;

  return (
    <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-950">
      <span className="font-semibold">Age at availability:</span> {label}
    </div>
  );
}

export function ListingCreationPhotosStep({
  canManage,
  description,
  emptyDescription,
  entityId,
  entityType,
  listingBatchId,
  mediaItems,
  onBack,
  onContinue,
  onReload,
  storeId,
  title,
}: {
  canManage: boolean;
  description?: string;
  emptyDescription?: string;
  entityId?: string;
  entityType?: "listing_batch" | "inventory_item" | "listing_batch_breed" | "seller_breed_profile";
  listingBatchId: string;
  mediaItems: ListingPhotoItem[];
  onBack: () => void;
  onContinue: () => void;
  onReload: () => void;
  storeId: string;
  title?: string;
}) {
  return (
    <div className="grid gap-5">
      <ListingPhotosSection
        canManage={canManage}
        description={description}
        emptyDescription={emptyDescription}
        entityId={entityId}
        entityType={entityType}
        listingBatchId={listingBatchId}
        mediaItems={mediaItems}
        mode="setup"
        storeId={storeId}
        title={title}
        onReload={onReload}
      />
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

export function PriceAdjustmentFields({
  onChange,
  value,
}: {
  onChange: (value: PriceAdjustmentState) => void;
  value: PriceAdjustmentState;
}) {
  function updateField<TKey extends keyof PriceAdjustmentState>(
    key: TKey,
    nextValue: PriceAdjustmentState[TKey],
  ) {
    onChange({ ...value, [key]: nextValue });
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
      <label className="flex items-start gap-3 text-sm font-semibold text-stone-800">
        <input
          checked={value.enabled}
          className="mt-1 h-4 w-4 rounded border-stone-300 text-emerald-800 focus:ring-emerald-700"
          type="checkbox"
          onChange={(event) => updateField("enabled", event.target.checked)}
        />
        <span>
          Adjust price as birds age
          <span className="mt-1 block text-sm font-normal leading-6 text-stone-600">
            Set one automatic price change for this hatch date. It applies to
            each available bird price in this listing.
          </span>
        </span>
      </label>

      {value.enabled ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Price change
            <select
              className="seller-form-field"
              value={value.direction}
              onChange={(event) =>
                updateField(
                  "direction",
                  event.target.value as PriceAdjustmentDirection,
                )
              }
            >
              <option value="increase">Increase price</option>
              <option value="decrease">Decrease price</option>
            </select>
          </label>

          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Amount
            <MoneyInput
              value={value.amount}
              onChange={(nextValue) => updateField("amount", nextValue)}
            />
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
                value={value.intervalWeeks}
                onChange={(event) =>
                  updateField("intervalWeeks", event.target.value)
                }
              />
              <span className="shrink-0 text-sm font-semibold text-stone-600">
                week(s)
              </span>
            </div>
          </label>

          {value.direction === "increase" ? (
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Stop increasing at
              <MoneyInput
                value={value.maxPrice}
                onChange={(nextValue) => updateField("maxPrice", nextValue)}
              />
            </label>
          ) : (
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Stop decreasing at
              <MoneyInput
                value={value.minPrice}
                onChange={(nextValue) => updateField("minPrice", nextValue)}
              />
            </label>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function isValidMoney(value: string) {
  return /^\d+(\.\d{1,2})?$/.test(value.trim());
}

export function isPositiveWholeNumber(value: string) {
  return /^[1-9]\d*$/.test(value.trim());
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

export function calculateAgeAtAvailabilityDays(
  hatchDate: string,
  availableDate: string,
) {
  if (!hatchDate || !availableDate) return null;

  const hatchTime = Date.parse(`${hatchDate}T00:00:00`);
  const availableTime = Date.parse(`${availableDate}T00:00:00`);

  if (Number.isNaN(hatchTime) || Number.isNaN(availableTime)) return null;

  return Math.round((availableTime - hatchTime) / 86_400_000);
}

export function formatAgeAtAvailabilityFromDays(days: number | null) {
  if (days === null || days < 0) return null;
  if (days === 0) return "At hatch";

  const weeks = Math.floor(days / 7);
  const remainingDays = days % 7;
  const parts: string[] = [];

  if (weeks > 0) {
    parts.push(`${weeks} week${weeks === 1 ? "" : "s"}`);
  }

  if (remainingDays > 0) {
    parts.push(`${remainingDays} day${remainingDays === 1 ? "" : "s"}`);
  }

  return parts.join(" + ");
}

export function formatAgeAtAvailabilityFromDates(
  hatchDate: string,
  availableDate: string,
) {
  return formatAgeAtAvailabilityFromDays(
    calculateAgeAtAvailabilityDays(hatchDate, availableDate),
  );
}

export function formatCurrency(value: string | number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value ?? 0));
}

export function formatInventoryType(value: string, customLabel?: string | null) {
  if (value === "other" && customLabel) return customLabel;

  return (
    inventoryTypeOptions.find((option) => option.value === value)?.label ??
    value.replaceAll("_", " ")
  );
}

export function validatePriceAdjustment(value: PriceAdjustmentState) {
  const errors: string[] = [];

  if (!value.enabled) return errors;

  if (!value.amount.trim()) {
    errors.push("Add a dynamic pricing amount.");
  } else if (!isValidMoney(value.amount) || Number(value.amount) <= 0) {
    errors.push("Use a dynamic pricing amount greater than $0.");
  }

  if (!isPositiveWholeNumber(value.intervalWeeks)) {
    errors.push("Dynamic pricing must happen every 1 week or more.");
  }

  if (value.direction === "increase" && value.maxPrice.trim()) {
    if (!isValidMoney(value.maxPrice) || Number(value.maxPrice) <= 0) {
      errors.push("Use a valid maximum price.");
    }
  }

  if (value.direction === "decrease" && value.minPrice.trim()) {
    if (!isValidMoney(value.minPrice) || Number(value.minPrice) < 0) {
      errors.push("Use a valid minimum price.");
    }
  }

  return errors;
}

export function hydratePriceAdjustment(
  row: SellerInventoryManagementRow,
): PriceAdjustmentState {
  return {
    enabled: Boolean(row.auto_price_adjustment_enabled),
    direction:
      row.price_adjustment_direction === "decrease" ? "decrease" : "increase",
    amount:
      row.price_adjustment_amount === null ||
      row.price_adjustment_amount === undefined
        ? ""
        : String(row.price_adjustment_amount),
    intervalWeeks:
      row.price_adjustment_interval_weeks === null ||
      row.price_adjustment_interval_weeks === undefined
        ? "1"
        : String(row.price_adjustment_interval_weeks),
    maxPrice:
      row.price_adjustment_max_price === null ||
      row.price_adjustment_max_price === undefined
        ? ""
        : String(row.price_adjustment_max_price),
    minPrice:
      row.price_adjustment_min_price === null ||
      row.price_adjustment_min_price === undefined
        ? ""
        : String(row.price_adjustment_min_price),
  };
}

export function formatPriceAdjustmentSummary(value: PriceAdjustmentState) {
  if (!value.enabled) return "Off";

  const verb = value.direction === "increase" ? "Increase" : "Decrease";
  const interval = Number(value.intervalWeeks);
  const cadence =
    interval === 1 ? "every week" : `every ${value.intervalWeeks} weeks`;
  const cap =
    value.direction === "increase" && value.maxPrice.trim()
      ? ` until ${formatCurrency(value.maxPrice)}`
      : value.direction === "decrease" && value.minPrice.trim()
        ? ` until ${formatCurrency(value.minPrice)}`
        : "";

  return `${verb} by ${formatCurrency(value.amount)} ${cadence}${cap}`;
}

export function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export function buildMediaSummary(
  mediaItems: ListingPhotoItem[],
): PublishReadinessMediaSummary {
  const activeItems = mediaItems.filter(
    (item) =>
      item.visibility_status === "active" &&
      item.asset_status === "active" &&
      item.moderation_status === "approved",
  );

  return {
    activeCount: activeItems.length,
    totalCount: mediaItems.length,
  };
}

export function pickFeaturedPhoto(mediaItems: ListingPhotoItem[]) {
  const activeItems = mediaItems.filter(
    (item) =>
      item.visibility_status === "active" &&
      item.asset_status === "active" &&
      item.moderation_status === "approved",
  );

  return (
    activeItems.find((item) => item.is_featured) ??
    activeItems.sort((first, second) => {
      const firstSort = first.sort_order ?? 0;
      const secondSort = second.sort_order ?? 0;

      if (firstSort !== secondSort) return firstSort - secondSort;

      return first.media_link_id.localeCompare(second.media_link_id);
    })[0] ??
    null
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

export function buildReadinessListing({
  publicDescription,
  rows,
}: {
  publicDescription: string;
  rows: SellerInventoryManagementRow[];
}): PublishReadinessListing | null {
  const firstRow = rows[0];

  if (!firstRow) return null;

  return {
    title:
      firstRow.internal_batch_label ||
      `${firstRow.breed_display_name} ${firstRow.species_name}`,
    speciesName: firstRow.species_name,
    breedNames: uniqueSorted(rows.map((row) => row.breed_display_name)),
    batchType: firstRow.batch_type,
    originDate: firstRow.origin_date,
    availableDate: firstRow.available_date,
    ageAtAvailabilityDays: firstRow.age_at_availability_days,
    basePrice: firstRow.base_price,
    autoPriceAdjustmentEnabled: Boolean(firstRow.auto_price_adjustment_enabled),
    priceAdjustmentDirection: firstRow.price_adjustment_direction,
    priceAdjustmentAmount: firstRow.price_adjustment_amount,
    priceAdjustmentIntervalWeeks: firstRow.price_adjustment_interval_weeks,
    priceAdjustmentMaxPrice: firstRow.price_adjustment_max_price,
    priceAdjustmentMinPrice: firstRow.price_adjustment_min_price,
    internalLabel: firstRow.internal_batch_label,
    publicDescription,
    sellerNotes: firstRow.listing_batch_seller_notes,
    visibilityStatus: firstRow.listing_batch_visibility_status,
    moderationStatus: firstRow.listing_batch_moderation_status,
    availabilityStatus: pickListingAvailabilityStatus(
      rows.map((row) => row.operational_availability_status),
    ),
    totalAvailable: rows.reduce(
      (total, row) => total + (row.quantity_available ?? 0),
      0,
    ),
    rows,
  };
}

function pickListingAvailabilityStatus(statuses: string[]) {
  const priority = [
    "ready_now",
    "reserve_now",
    "hidden",
    "sold_out",
    "unavailable",
    "archived",
  ];

  return statuses.reduce((current, next) => {
    const currentIndex = priority.indexOf(current);
    const nextIndex = priority.indexOf(next);

    if (currentIndex === -1) return next;
    if (nextIndex === -1) return current;

    return nextIndex < currentIndex ? next : current;
  }, statuses[0] ?? "hidden");
}

export type { ListingPhotoItem };
