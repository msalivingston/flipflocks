"use client";

import Image from "next/image";
import {
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  DeliveryOptionsSection,
  type DeliveryOptionDraft,
} from "./delivery-options-section";
import { SortableOptionList } from "./sortable-option-list";

type StoreSetupAccordionId =
  | "status"
  | "information"
  | "appearance"
  | "about"
  | "business"
  | "logo"
  | "hero"
  | "about-photo"
  | "pickup"
  | "delivery"
  | "pickup-policy"
  | "custom-policies";

type StoreSetupAccordionSectionProps = {
  badge?: ReactNode;
  children: ReactNode;
  glyph: string;
  id: StoreSetupAccordionId;
  isOpen: boolean;
  onToggle: (id: StoreSetupAccordionId | "none") => void;
  showStatusDot?: boolean;
  statusDotTone?: "green" | "red";
  summary: ReactNode;
  thumbnailAlt?: string;
  thumbnailSrc?: string | null;
  title: string;
};

type StorefrontNoteProps = {
  children: ReactNode;
};

type TextFieldProps = {
  helper?: string;
  label: string;
  maxLength?: number;
  onChange: (value: string) => void;
  optional?: boolean;
  placeholder?: string;
  required?: boolean;
  showCounter?: boolean;
  type?: "text" | "number";
  value: string;
};

type PickupDeliveryForm = {
  default_pickup_option_id: string;
  delivery_enabled: boolean;
  pickup_address_line1: string;
  pickup_address_line2: string;
  pickup_city: string;
  pickup_country: string;
  pickup_location_text: string;
  pickup_method: "notes" | "manual_options";
  pickup_postal_code: string;
  pickup_state: string;
};

type PickupAddressField =
  | "pickup_address_line1"
  | "pickup_address_line2"
  | "pickup_city"
  | "pickup_state"
  | "pickup_postal_code"
  | "pickup_country";

type PickupOptionDraft = {
  id: string;
  label: string;
  description: string;
  sort_order: number;
  is_active: boolean;
  isNew?: boolean;
};

type PickupDeliveryAccordionId = "pickup" | "delivery";

export type PickupDeliveryTabProps = {
  AccordionSection: ComponentType<StoreSetupAccordionSectionProps>;
  StorefrontNote: ComponentType<StorefrontNoteProps>;
  TextField: ComponentType<TextFieldProps>;
  deliveryOptions: DeliveryOptionDraft[];
  deliveryValidationMessage: string | null;
  form: PickupDeliveryForm;
  getVisibleDeliveryOptions: (
    options: DeliveryOptionDraft[],
  ) => DeliveryOptionDraft[];
  getVisiblePickupOptions: (
    options: PickupOptionDraft[],
  ) => PickupOptionDraft[];
  handlePickupOptionInputRef: (
    optionId: string,
    element: HTMLInputElement | null,
  ) => void;
  onAddPickupOption: () => void;
  onDeliveryEnabledChange: (enabled: boolean) => void;
  onDeliveryOptionsChange: (options: DeliveryOptionDraft[]) => void;
  onPickupAddressFieldChange: (
    field: PickupAddressField,
    value: string,
  ) => void;
  onPickupLocationTextChange: (value: string) => void;
  onPickupMethodChange: (method: PickupDeliveryForm["pickup_method"]) => void;
  onPickupOptionLabelChange: (optionId: string, label: string) => void;
  onRemovePickupOption: (optionId: string) => void;
  onReorderPickupOptions: (orderedIds: string[]) => void;
  pickupOptions: PickupOptionDraft[];
};

export default function PickupDeliveryTab({
  AccordionSection,
  StorefrontNote,
  TextField,
  deliveryOptions,
  deliveryValidationMessage,
  form,
  getVisibleDeliveryOptions,
  getVisiblePickupOptions,
  handlePickupOptionInputRef,
  onAddPickupOption,
  onDeliveryEnabledChange,
  onDeliveryOptionsChange,
  onPickupAddressFieldChange,
  onPickupLocationTextChange,
  onPickupMethodChange,
  onPickupOptionLabelChange,
  onRemovePickupOption,
  onReorderPickupOptions,
  pickupOptions,
}: PickupDeliveryTabProps) {
  const [openSection, setOpenSection] =
    useState<PickupDeliveryAccordionId | "none">("none");
  const visiblePickupOptions = getVisiblePickupOptions(pickupOptions);
  const visibleDeliveryOptions = getVisibleDeliveryOptions(deliveryOptions);
  const activePickupMethod =
    form.pickup_method === "manual_options"
      ? "Manual pickup dropdown"
      : "Buyer pickup notes";
  const pickupSummary =
    visiblePickupOptions.length === 0
      ? `${activePickupMethod} · No pickup options added`
      : `${visiblePickupOptions.length} ${pluralize(
          visiblePickupOptions.length,
          "pickup option",
          "pickup options",
        )} · ${activePickupMethod}`;
  const deliverySummary = form.delivery_enabled
    ? `Enabled · ${visibleDeliveryOptions.length} ${pluralize(
        visibleDeliveryOptions.length,
        "delivery option",
        "delivery options",
      )}`
    : "Not offered";

  return (
    <div className="grid gap-3">
      <AccordionSection
        glyph="/glyphs/map-pin.png"
        id="pickup"
        isOpen={openSection === "pickup"}
        onToggle={(id) =>
          setOpenSection(id as PickupDeliveryAccordionId | "none")
        }
        summary={<span className="truncate">{pickupSummary}</span>}
        title="Pickup"
      >
        <div className="grid gap-3">
          <StorefrontNote>
            Choose how buyers will handle pickup for their orders.
          </StorefrontNote>
          <section className="grid gap-3 rounded-lg border border-stone-200 bg-white px-3 py-3">
            <div>
              <h3 className="text-sm font-semibold text-stone-950">
                Pickup address
              </h3>
              <p className="mt-0.5 text-xs leading-5 text-stone-600">
                This address is included in order confirmations after a buyer
                places an order. It is not automatically displayed on your
                public storefront.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <TextField
                label="Street address"
                onChange={(value) =>
                  onPickupAddressFieldChange("pickup_address_line1", value)
                }
                required
                value={form.pickup_address_line1}
              />
              <TextField
                label="Address line 2"
                onChange={(value) =>
                  onPickupAddressFieldChange("pickup_address_line2", value)
                }
                optional
                value={form.pickup_address_line2}
              />
              <TextField
                label="City"
                onChange={(value) =>
                  onPickupAddressFieldChange("pickup_city", value)
                }
                required
                value={form.pickup_city}
              />
              <TextField
                label="State"
                onChange={(value) =>
                  onPickupAddressFieldChange("pickup_state", value)
                }
                required
                value={form.pickup_state}
              />
              <TextField
                label="ZIP code"
                onChange={(value) =>
                  onPickupAddressFieldChange("pickup_postal_code", value)
                }
                required
                value={form.pickup_postal_code}
              />
              <TextField
                label="Country"
                onChange={(value) =>
                  onPickupAddressFieldChange("pickup_country", value)
                }
                value={form.pickup_country}
              />
            </div>
            <TextField
              helper="Add directions, landmarks, appointment details, or other pickup instructions."
              label="Pickup directions or general location"
              onChange={onPickupLocationTextChange}
              placeholder="Farm pickup by appointment near the north gate"
              value={form.pickup_location_text}
            />
          </section>
          <PickupMethodRow
            copy="Buyers enter their preferred pickup time or date in checkout notes. Best for most sellers."
            glyph="/glyphs/chat.png"
            onSelect={() => onPickupMethodChange("notes")}
            state={form.pickup_method === "notes" ? "current" : "neutral"}
            title="Buyer requests pickup in notes"
          />
          <PickupMethodRow
            copy="Let buyers choose from a short list of pickup choices, such as Farm pickup, Meet in town, or Text to schedule."
            glyph="/glyphs/clipboard.png"
            onSelect={() => onPickupMethodChange("manual_options")}
            state={
              form.pickup_method === "manual_options" ? "current" : "neutral"
            }
            title="Manual pickup dropdown"
          >
            {form.pickup_method === "manual_options" ? (
              <ManualPickupChoiceBuilder
                getVisiblePickupOptions={getVisiblePickupOptions}
                handlePickupOptionInputRef={handlePickupOptionInputRef}
                onAdd={onAddPickupOption}
                onLabelChange={onPickupOptionLabelChange}
                onRemove={onRemovePickupOption}
                onReorder={onReorderPickupOptions}
                pickupOptions={pickupOptions}
              />
            ) : null}
          </PickupMethodRow>
          <PickupMethodRow
            badge="Coming soon"
            copy="Useful if you usually offer the same pickup times each week."
            glyph="/glyphs/calendar.png"
            isDisabled
            state="planned"
            title="Regular pickup windows"
          />
        </div>
      </AccordionSection>

      <AccordionSection
        glyph="/glyphs/truck.png"
        id="delivery"
        isOpen={openSection === "delivery"}
        onToggle={(id) =>
          setOpenSection(id as PickupDeliveryAccordionId | "none")
        }
        summary={<span className="truncate">{deliverySummary}</span>}
        title="Local delivery"
      >
        <DeliveryOptionsSection
          deliveryEnabled={form.delivery_enabled}
          deliveryOptions={deliveryOptions}
          isEmbedded
          onChange={onDeliveryOptionsChange}
          onToggle={onDeliveryEnabledChange}
          validationMessage={deliveryValidationMessage}
        />
      </AccordionSection>

      <input readOnly type="hidden" value={form.default_pickup_option_id} />
    </div>
  );
}

function PickupMethodRow({
  badge,
  children,
  copy,
  glyph,
  isDisabled = false,
  onSelect,
  state,
  title,
}: {
  badge?: string;
  children?: ReactNode;
  copy: string;
  glyph: string;
  isDisabled?: boolean;
  onSelect?: () => void;
  state: "current" | "planned" | "neutral";
  title: string;
}) {
  const isCurrent = state === "current";
  const isPlanned = state === "planned";

  return (
    <div
      className={`overflow-hidden rounded-lg border transition ${
        isCurrent
          ? "border-emerald-200 bg-emerald-50/35"
          : isPlanned
            ? "border-stone-200 bg-stone-50/80 opacity-85"
            : "border-stone-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/20"
      }`}
    >
      <button
        aria-checked={isCurrent}
        className={`grid w-full gap-2 px-3 py-3 text-left sm:items-center ${
          badge
            ? "sm:grid-cols-[minmax(0,1fr)_6.75rem]"
            : "sm:grid-cols-[minmax(0,1fr)_2rem]"
        }`}
        disabled={isDisabled}
        onClick={onSelect}
        role="radio"
        type="button"
      >
        <div className="flex min-w-0 gap-2.5">
          <span className="pt-2">
            <PickupMethodRadio
              isChecked={isCurrent}
              isDisabled={isDisabled}
            />
          </span>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-stone-100 ring-1 ring-stone-200">
            <Image
              alt=""
              className="object-contain"
              height={22}
              src={glyph}
              width={22}
            />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-stone-950">{title}</h3>
            <p className="mt-0.5 text-xs leading-5 text-stone-600">{copy}</p>
          </div>
        </div>
        {badge ? (
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <span
              className={`inline-flex min-h-6 items-center rounded-full px-2.5 text-xs font-semibold ${
                isCurrent
                  ? "bg-emerald-100 text-emerald-900"
                  : isPlanned
                    ? "bg-stone-100 text-stone-500"
                    : "bg-stone-100 text-stone-600"
              }`}
            >
              {badge}
            </span>
          </div>
        ) : null}
      </button>
      {children ? (
        <div className="border-t border-emerald-100 bg-white/75 px-3 py-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function PickupMethodRadio({
  isChecked,
  isDisabled,
}: {
  isChecked: boolean;
  isDisabled: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full border transition ${
        isChecked
          ? "border-emerald-700 bg-white"
          : isDisabled
            ? "border-stone-300 bg-stone-100"
            : "border-stone-300 bg-white"
      }`}
    >
      {isChecked ? (
        <span className="size-2.5 rounded-full bg-emerald-700" />
      ) : null}
    </span>
  );
}

function ManualPickupChoiceBuilder({
  getVisiblePickupOptions,
  handlePickupOptionInputRef,
  onAdd,
  onLabelChange,
  onRemove,
  onReorder,
  pickupOptions,
}: {
  getVisiblePickupOptions: (
    options: PickupOptionDraft[],
  ) => PickupOptionDraft[];
  handlePickupOptionInputRef: (
    optionId: string,
    element: HTMLInputElement | null,
  ) => void;
  onAdd: () => void;
  onLabelChange: (optionId: string, label: string) => void;
  onRemove: (optionId: string) => void;
  onReorder: (orderedIds: string[]) => void;
  pickupOptions: PickupOptionDraft[];
}) {
  const visibleOptions = getVisiblePickupOptions(pickupOptions);

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-stone-950">
            Dropdown choices
          </p>
          <p className="mt-0.5 text-xs leading-5 text-stone-600">
            Create the short choices buyers will see at checkout.
          </p>
        </div>
        <button
          className="seller-small-button w-full sm:w-auto"
          onClick={onAdd}
          type="button"
        >
          + Add new
        </button>
      </div>
      <p className="text-xs font-medium leading-5 text-stone-500">
        Examples: Tuesday, July 7 at 9am; Meet in town; Text to schedule.
      </p>
      {visibleOptions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-3 text-sm text-stone-600">
          No manual pickup choices yet.
        </p>
      ) : (
        <SortableOptionList
          dragHandleLabel="Drag to reorder pickup choice"
          emptyState={null}
          getPreviewLabel={(option) => option.label.trim() || "Pickup choice"}
          items={visibleOptions}
          onReorder={onReorder}
          renderRow={({ dragHandle, isDragging, item, rowRef }) => (
            <PickupChoiceRow
              dragHandle={dragHandle}
              inputRef={(element) =>
                handlePickupOptionInputRef(item.id, element)
              }
              isDragging={isDragging}
              key={item.id}
              onLabelChange={(label) => onLabelChange(item.id, label)}
              onRemove={() => onRemove(item.id)}
              option={item}
              rowRef={rowRef}
            />
          )}
        />
      )}
    </div>
  );
}

function PickupChoiceRow({
  dragHandle,
  inputRef,
  isDragging,
  onLabelChange,
  onRemove,
  option,
  rowRef,
}: {
  dragHandle: ReactNode;
  inputRef: (element: HTMLInputElement | null) => void;
  isDragging: boolean;
  onLabelChange: (label: string) => void;
  onRemove: () => void;
  option: PickupOptionDraft;
  rowRef: (element: HTMLDivElement | null) => void;
}) {
  return (
    <div className="grid gap-1">
      <div
        className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border bg-white px-2.5 py-2 transition ${
          isDragging
            ? "border-emerald-300 bg-emerald-50/40 shadow-sm"
            : "border-stone-200"
        }`}
        ref={rowRef}
      >
        {dragHandle}
        <input
          className="min-h-10 rounded-md border border-stone-200 bg-stone-50/70 px-3 text-sm font-medium text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-emerald-700 focus:bg-white focus:ring-2 focus:ring-emerald-700/15"
          onChange={(event) => onLabelChange(event.target.value)}
          placeholder="Tuesday, July 7 at 9am"
          ref={inputRef}
          value={option.label}
        />
        <button
          aria-label="Remove pickup choice"
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
          onClick={onRemove}
          type="button"
        >
          Remove
        </button>
      </div>
      {option.label !== option.label.trim() ? (
        <p className="px-2 text-xs font-medium text-stone-500">
          Extra spaces will be cleaned up when you save.
        </p>
      ) : null}
    </div>
  );
}

function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}
