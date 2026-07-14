"use client";

import type { ReactNode } from "react";
import { SortableOptionList } from "./sortable-option-list";

export type DeliveryOptionDraft = {
  id: string;
  name: string;
  price: string;
  sort_order: number;
  is_active: boolean;
  isNew?: boolean;
};

type DeliveryOptionsSectionProps = {
  deliveryEnabled: boolean;
  deliveryOptions: DeliveryOptionDraft[];
  onChange: (options: DeliveryOptionDraft[]) => void;
  onToggle: (enabled: boolean) => void;
  validationMessage: string | null;
};

type DeliveryOptionRowProps = {
  dragHandle: ReactNode;
  isDragging: boolean;
  onNameChange: (name: string) => void;
  onPriceChange: (price: string) => void;
  onRemove: () => void;
  option: DeliveryOptionDraft;
  rowRef: (element: HTMLDivElement | null) => void;
};

const inputClass =
  "min-h-10 rounded-md border border-stone-200 bg-stone-50/70 px-3 text-sm font-medium text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-emerald-700 focus:bg-white focus:ring-2 focus:ring-emerald-700/15";

export function DeliveryOptionsSection({
  deliveryEnabled,
  deliveryOptions,
  onChange,
  onToggle,
  validationMessage,
}: DeliveryOptionsSectionProps) {
  const visibleOptions = getVisibleDeliveryOptions(deliveryOptions);

  function updateOption(optionId: string, updates: Partial<DeliveryOptionDraft>) {
    onChange(
      deliveryOptions.map((option) =>
        option.id === optionId ? { ...option, ...updates } : option,
      ),
    );
  }

  function addOption() {
    onChange([
      ...deliveryOptions,
      {
        id: `new-${crypto.randomUUID()}`,
        name: "",
        price: "",
        sort_order: visibleOptions.length,
        is_active: true,
        isNew: true,
      },
    ]);
  }

  function removeOption(optionId: string) {
    onChange(
      deliveryOptions
        .filter((option) => !(option.id === optionId && option.isNew))
        .map((option) =>
          option.id === optionId ? { ...option, is_active: false } : option,
        ),
    );
  }

  function reorderOptions(orderedIds: string[]) {
    const sortOrderById = new Map(
      orderedIds.map((optionId, index) => [optionId, index]),
    );

    onChange(
      sortDeliveryOptions(
        deliveryOptions.map((option) => ({
          ...option,
          sort_order: option.is_active
            ? (sortOrderById.get(option.id) ?? option.sort_order)
            : option.sort_order,
        })),
      ),
    );
  }

  return (
    <section className="grid gap-3 rounded-lg border border-stone-200 bg-white p-4">
      <div>
        <h2 className="text-lg font-semibold text-stone-950">Delivery</h2>
        <p className="mt-1 text-sm leading-6 text-stone-600">
          Choose whether buyers can have their orders delivered.
        </p>
      </div>

      <label className="inline-flex min-h-11 items-start gap-3 rounded-md border border-stone-200 bg-stone-50/70 px-3 py-3 text-sm font-semibold text-stone-800">
        <input
          checked={deliveryEnabled}
          className="mt-1 h-4 w-4 accent-emerald-800"
          onChange={(event) => onToggle(event.target.checked)}
          type="checkbox"
        />
        <span className="grid gap-1">
          <span>I would like to add delivery options as well.</span>
          <span className="text-xs font-medium leading-5 text-stone-600">
            Add the locations or delivery areas you serve and the price for each.
            Buyers will choose one option during checkout.
          </span>
        </span>
      </label>

      {validationMessage ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
          {validationMessage}
        </p>
      ) : null}

      {deliveryEnabled ? (
        <div className="grid gap-3 border-t border-stone-100 pt-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-stone-950">
                Delivery options
              </h3>
              <p className="mt-0.5 text-xs leading-5 text-stone-600">
                Examples: Paonia - $10.00, Delta - $15.00, Grand Junction -
                $35.00.
              </p>
            </div>
            <button
              className="seller-small-button w-full sm:w-auto"
              onClick={addOption}
              type="button"
            >
              + Add new
            </button>
          </div>

          {visibleOptions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-3 text-sm text-stone-600">
              No delivery options yet.
            </p>
          ) : (
            <SortableOptionList
              dragHandleLabel="Drag to reorder delivery option"
              emptyState={null}
              getPreviewLabel={(option) =>
                option.name.trim() || "Delivery option"
              }
              items={visibleOptions.map((option) => ({
                ...option,
                label: option.name,
              }))}
              onReorder={reorderOptions}
              renderRow={({ dragHandle, isDragging, item, rowRef }) => (
                <DeliveryOptionRow
                  dragHandle={dragHandle}
                  isDragging={isDragging}
                  key={item.id}
                  onNameChange={(name) => updateOption(item.id, { name })}
                  onPriceChange={(price) => updateOption(item.id, { price })}
                  onRemove={() => removeOption(item.id)}
                  option={item}
                  rowRef={rowRef}
                />
              )}
            />
          )}
        </div>
      ) : null}
    </section>
  );
}

function DeliveryOptionRow({
  dragHandle,
  isDragging,
  onNameChange,
  onPriceChange,
  onRemove,
  option,
  rowRef,
}: DeliveryOptionRowProps) {
  return (
    <div
      className={`grid gap-2 rounded-md border bg-white px-2.5 py-2 transition sm:grid-cols-[auto_minmax(0,1.35fr)_minmax(7rem,0.65fr)_auto] sm:items-end ${
        isDragging ? "border-emerald-300 bg-emerald-50/40 shadow-sm" : "border-stone-200"
      }`}
      ref={rowRef}
    >
      {dragHandle}
      <label className="grid gap-1 text-xs font-semibold text-stone-600">
        Delivery option name
        <input
          className={inputClass}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Paonia"
          value={option.name}
        />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-stone-600">
        Delivery price
        <input
          className={inputClass}
          inputMode="decimal"
          onChange={(event) => onPriceChange(event.target.value)}
          placeholder="10.00"
          value={option.price}
        />
      </label>
      <button
        className="inline-flex min-h-10 items-center justify-center rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
        onClick={onRemove}
        type="button"
      >
        Remove
      </button>
    </div>
  );
}

function getVisibleDeliveryOptions(options: DeliveryOptionDraft[]) {
  return sortDeliveryOptions(options).filter((option) => option.is_active);
}

function sortDeliveryOptions(options: DeliveryOptionDraft[]) {
  return [...options].sort(
    (first, second) =>
      first.sort_order - second.sort_order ||
      first.name.localeCompare(second.name),
  );
}
