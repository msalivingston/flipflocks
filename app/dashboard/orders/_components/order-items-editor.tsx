"use client";

import Image from "next/image";
import { SellerCard } from "../../_components/seller-ui";
import { formatCurrency } from "../order-formatters";
import {
  filterInventory,
  formatBrowseInventoryMetadata,
  formatInventoryMetadata,
  getBrowseInventoryRows,
} from "../_lib/order-form-inventory";
import { isPositiveWholeNumber } from "../_lib/order-form-calculations";
import type {
  BrowseInventoryFilter,
  InventorySearchRow,
  OrderLine,
} from "../_lib/order-form-types";

type InventoryAdjustmentControl = {
  checked: boolean;
  label: string;
  lineId: string;
  lineName: string;
  removed: boolean;
};

export function OrderItemsEditor({
  allowInventoryOversell = false,
  browseAddedInventoryItemId,
  browseFilter,
  browseQuery,
  inventory,
  inventoryAdjustmentControls = [],
  inventoryQuery,
  isBrowseOpen,
  lines,
  onAddCustomItem,
  onAddInventoryItem,
  onBrowseInventoryItem,
  onBrowseFilterChange,
  onBrowseOpenChange,
  onBrowseQueryChange,
  onInventoryQueryChange,
  onInventoryAdjustmentChange,
  onRemoveLine,
  onUpdateLine,
}: {
  allowInventoryOversell?: boolean;
  browseAddedInventoryItemId: string | null;
  browseFilter: BrowseInventoryFilter;
  browseQuery: string;
  inventory: InventorySearchRow[];
  inventoryAdjustmentControls?: InventoryAdjustmentControl[];
  inventoryQuery: string;
  isBrowseOpen: boolean;
  lines: OrderLine[];
  onAddCustomItem: () => void;
  onAddInventoryItem: (inventoryItemId: string) => void;
  onBrowseInventoryItem: (inventoryItemId: string) => void;
  onBrowseFilterChange: (filter: BrowseInventoryFilter) => void;
  onBrowseOpenChange: (isOpen: boolean | ((current: boolean) => boolean)) => void;
  onBrowseQueryChange: (query: string) => void;
  onInventoryQueryChange: (query: string) => void;
  onInventoryAdjustmentChange?: (lineId: string, checked: boolean) => void;
  onRemoveLine: (lineId: string) => void;
  onUpdateLine: (lineId: string, updates: Partial<OrderLine>) => void;
}) {
  return (
    <>
      <SellerCard className="min-w-0 overflow-hidden p-3">
        <h2 className="text-lg font-semibold text-stone-950">Order Items</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <label className="sr-only" htmlFor="manual-order-inventory-search">
            Search inventory by breed, type, or age
          </label>
          <input
            className="seller-form-field seller-compact-field seller-action-search-field"
            id="manual-order-inventory-search"
            placeholder="Quick add: type breed, age, or item name"
            type="text"
            value={inventoryQuery}
            onChange={(event) => {
              onInventoryQueryChange(event.target.value);
              onBrowseOpenChange(false);
            }}
          />
          <div className="flex items-center gap-1.5">
            <button
              className="inline-flex min-h-9 items-center rounded-md border border-emerald-100 bg-emerald-50 px-2.5 text-xs font-bold text-emerald-900 transition hover:border-emerald-200 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-700/25"
              type="button"
              onClick={() => {
                onBrowseOpenChange((current) => !current);
                onInventoryQueryChange("");
              }}
            >
              Browse inventory
            </button>
            <button
              className="inline-flex min-h-9 items-center rounded-md px-2.5 text-xs font-bold text-emerald-800 transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/25"
              type="button"
              onClick={onAddCustomItem}
            >
              + Custom item
            </button>
          </div>
        </div>

        <InventorySearchResults
          inventory={inventory}
          query={inventoryQuery}
          onSelect={onAddInventoryItem}
        />

        <div className="mt-3 max-w-full overflow-hidden">
          <div className="min-w-0">
            <div className="grid grid-cols-[minmax(0,1fr)_72px_96px_90px_28px] gap-2 border-b border-stone-200 px-1 pb-2 text-xs font-bold uppercase tracking-[0.04em] text-stone-500">
              <span>Item</span>
              <span className="text-center">Qty</span>
              <span>Unit price</span>
              <span className="text-right">Line total</span>
              <span className="text-right">
                <span className="sr-only">Remove</span>
              </span>
            </div>
            {lines.length > 0 ? (
              <div className="divide-y divide-stone-200">
                {lines.map((line) => (
                  <OrderItemRow
                    allowInventoryOversell={allowInventoryOversell}
                    inventory={inventory}
                    inventoryAdjustment={inventoryAdjustmentControls.find(
                      (control) => !control.removed && control.lineId === line.id,
                    )}
                    key={line.id}
                    line={line}
                    onInventoryAdjustmentChange={onInventoryAdjustmentChange}
                    onRemove={() => onRemoveLine(line.id)}
                    updateLine={(updates) => onUpdateLine(line.id, updates)}
                  />
                ))}
                {inventoryAdjustmentControls
                  .filter((control) => control.removed)
                  .map((control) => (
                    <RemovedInventoryAdjustmentRow
                      control={control}
                      key={control.lineId}
                      onChange={onInventoryAdjustmentChange}
                    />
                  ))}
              </div>
            ) : (
              <p className="px-1 py-5 text-sm text-stone-600">
                Search inventory above or add a custom item to start the order.
              </p>
            )}
          </div>
        </div>
      </SellerCard>

      {isBrowseOpen ? (
        <BrowseInventoryDialog
          addedInventoryItemId={browseAddedInventoryItemId}
          filter={browseFilter}
          inventory={inventory}
          query={browseQuery}
          onClose={() => onBrowseOpenChange(false)}
          onFilterChange={onBrowseFilterChange}
          onQueryChange={onBrowseQueryChange}
          onSelect={onBrowseInventoryItem}
        />
      ) : null}
    </>
  );
}

function InventorySearchResults({
  inventory,
  onSelect,
  query,
}: {
  inventory: InventorySearchRow[];
  onSelect: (inventoryItemId: string) => void;
  query: string;
}) {
  const results = filterInventory(inventory, query).slice(0, 7);

  if (query.trim().length < 2) return null;

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-stone-200 bg-white shadow-sm">
      {results.length > 0 ? (
        results.map((item) => (
          <button
            className="grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-stone-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-emerald-50 focus:bg-emerald-50 focus:outline-none"
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold text-stone-950">
                {item.title}
              </span>
              <span className="block truncate text-xs text-stone-600">
                {formatInventoryMetadata(item)} &middot; {item.quantity_available ?? 0} available
              </span>
            </span>
            <span className="text-sm font-bold text-stone-950">
              {formatCurrency(item.effective_unit_price)}
            </span>
          </button>
        ))
      ) : (
        <p className="px-3 py-2 text-sm text-stone-600">No inventory matches.</p>
      )}
    </div>
  );
}

function BrowseInventoryDialog({
  addedInventoryItemId,
  filter,
  inventory,
  onClose,
  onFilterChange,
  onQueryChange,
  onSelect,
  query,
}: {
  addedInventoryItemId: string | null;
  filter: BrowseInventoryFilter;
  inventory: InventorySearchRow[];
  onClose: () => void;
  onFilterChange: (filter: BrowseInventoryFilter) => void;
  onQueryChange: (query: string) => void;
  onSelect: (inventoryItemId: string) => void;
  query: string;
}) {
  const rows = getBrowseInventoryRows(inventory, filter, query).slice(0, 60);
  const filters: { label: string; value: BrowseInventoryFilter }[] = [
    { label: "All", value: "all" },
    { label: "Live poultry", value: "poultry" },
    { label: "Hatching eggs", value: "hatching_eggs" },
    { label: "Poultry products", value: "processed_poultry" },
    { label: "Equipment", value: "equipment" },
  ];

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/25 px-3 py-4"
      role="dialog"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-stone-200 bg-[#fffdf7] shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <h3 className="text-base font-bold text-stone-950">Browse Inventory</h3>
          <button
            aria-label="Close Browse Inventory"
            className="flex size-8 items-center justify-center rounded-md text-sm font-bold text-stone-500 hover:bg-stone-100 hover:text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/25"
            type="button"
            onClick={onClose}
          >
            x
          </button>
        </div>

        <div className="grid gap-2 border-b border-stone-200 px-4 py-3">
          <input
            className="seller-form-field seller-compact-field"
            placeholder="Search inventory"
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          <div className="flex flex-wrap gap-1">
            {filters.map((filterOption) => {
              const selected = filter === filterOption.value;

              return (
                <button
                  className={`min-h-7 rounded-md px-2.5 text-xs font-bold transition focus:outline-none focus:ring-2 focus:ring-emerald-700/25 ${
                    selected
                      ? "bg-emerald-800 text-white"
                      : "bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-emerald-50 hover:text-emerald-800"
                  }`}
                  key={filterOption.value}
                  type="button"
                  onClick={() => onFilterChange(filterOption.value)}
                >
                  {filterOption.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto bg-white">
          {rows.length > 0 ? (
            rows.map((item) => {
              const wasAdded = addedInventoryItemId === item.id;

              return (
                <div
                  className="grid grid-cols-[minmax(0,1fr)_5rem_5.25rem_4rem] items-center gap-2 border-b border-stone-100 px-4 py-2 text-sm last:border-b-0"
                  key={item.id}
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold text-stone-950">
                      {item.title}
                    </p>
                    <p className="truncate text-xs text-stone-600">
                      {formatBrowseInventoryMetadata(item)}
                    </p>
                  </div>
                  <p className="text-right text-xs font-semibold text-stone-600">
                    {item.quantity_available ?? 0} available
                  </p>
                  <p className="text-right text-sm font-bold text-stone-950">
                    {formatCurrency(item.effective_unit_price)}
                  </p>
                  <button
                    className={`justify-self-end rounded-md px-2 py-1 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-700/25 ${
                      wasAdded
                        ? "bg-emerald-100 text-emerald-800"
                        : "text-emerald-800 hover:bg-emerald-50"
                    }`}
                    type="button"
                    onClick={() => onSelect(item.id)}
                  >
                    {wasAdded ? "Added" : "Add"}
                  </button>
                </div>
              );
            })
          ) : (
            <p className="px-4 py-4 text-sm text-stone-600">
              No available inventory to browse.
            </p>
          )}
        </div>

        <div className="flex justify-end border-t border-stone-200 bg-[#fffdf7] px-4 py-3">
          <button className="seller-small-button" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderItemRow({
  allowInventoryOversell,
  inventory,
  inventoryAdjustment,
  line,
  onInventoryAdjustmentChange,
  onRemove,
  updateLine,
}: {
  allowInventoryOversell: boolean;
  inventory: InventorySearchRow[];
  inventoryAdjustment: InventoryAdjustmentControl | undefined;
  line: OrderLine;
  onInventoryAdjustmentChange?: (lineId: string, checked: boolean) => void;
  onRemove: () => void;
  updateLine: (updates: Partial<OrderLine>) => void;
}) {
  const selectedItem = inventory.find(
    (row) =>
      row.id === line.inventoryItemId && row.itemType === line.inventoryItemType,
  );
  const itemName = selectedItem?.title ?? line.savedItemName ?? "Inventory item";
  const itemDetail = selectedItem
    ? formatInventoryMetadata(selectedItem)
    : line.savedItemDetail || line.search;
  const quantity = Number(line.quantity || 0);
  const unitPrice = Number(line.unitPrice || 0);
  const exceedsAvailable =
    !allowInventoryOversell &&
    line.type === "inventory" &&
    selectedItem != null &&
    isPositiveWholeNumber(line.quantity) &&
    quantity > selectedItem.quantity_available;

  return (
    <div className="px-1 py-2">
      <div className="grid grid-cols-[minmax(0,1fr)_72px_96px_90px_28px] items-start gap-2">
        <div className="min-w-0">
          {line.type === "custom" ? (
            <div className="grid min-w-0 gap-1.5">
              <div className="flex min-w-0 items-center">
                <input
                  className="min-h-10 min-w-0 flex-1 rounded-md border border-stone-300 px-2 text-sm font-semibold text-stone-950 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                  placeholder="Item name"
                  value={line.customItemName}
                  onChange={(event) =>
                    updateLine({ customItemName: event.target.value })
                  }
                />
              </div>
              <input
                className="min-h-9 w-full min-w-0 rounded-md border border-stone-300 px-2 text-sm text-stone-700 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                placeholder="Short description"
                value={line.customItemDescription}
                onChange={(event) =>
                  updateLine({ customItemDescription: event.target.value })
                }
              />
            </div>
          ) : (
            <>
              <p className="truncate text-sm font-bold text-stone-950">
                {itemName}
              </p>
              <p className="mt-1 truncate text-xs text-stone-600">
                {itemDetail}
              </p>
              {exceedsAvailable ? (
                <p className="mt-1 text-xs font-semibold text-amber-800">
                  {selectedItem?.allowInventoryOverride
                    ? "Quantity exceeds available inventory."
                    : "Quantity exceeds available inventory and cannot be saved."}
                </p>
              ) : null}
            </>
          )}
        </div>

        <QuantityInput
          value={line.quantity}
          onChange={(quantityValue) => updateLine({ quantity: quantityValue })}
        />
        <input
          aria-label="Unit price"
          className="seller-form-field seller-compact-field"
          min="0"
          step="0.01"
          type="number"
          value={line.unitPrice}
          onChange={(event) => updateLine({ unitPrice: event.target.value })}
        />
        <p className="pt-2 text-right text-sm font-bold text-stone-950">
          {formatCurrency(quantity * unitPrice)}
        </p>
        <button
          aria-label="Remove item"
          className="ml-auto flex size-7 items-center justify-center rounded-md opacity-70 transition hover:bg-red-50 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-500/25"
          type="button"
          onClick={onRemove}
        >
          <Image alt="" height={16} src="/glyphs/trashcan.png" width={16} />
        </button>
      </div>

      {inventoryAdjustment ? (
        <InventoryAdjustmentCheckbox
          checked={inventoryAdjustment.checked}
          label={inventoryAdjustment.label}
          lineId={inventoryAdjustment.lineId}
          onChange={onInventoryAdjustmentChange}
        />
      ) : null}
    </div>
  );
}

function RemovedInventoryAdjustmentRow({
  control,
  onChange,
}: {
  control: InventoryAdjustmentControl;
  onChange?: (lineId: string, checked: boolean) => void;
}) {
  return (
    <div className="px-1 py-2">
      <p className="text-sm font-bold text-stone-950">Removed: {control.lineName}</p>
      <InventoryAdjustmentCheckbox
        checked={control.checked}
        label={control.label}
        lineId={control.lineId}
        onChange={onChange}
      />
    </div>
  );
}

function InventoryAdjustmentCheckbox({
  checked,
  label,
  lineId,
  onChange,
}: {
  checked: boolean;
  label: string;
  lineId: string;
  onChange?: (lineId: string, checked: boolean) => void;
}) {
  return (
    <label className="mt-2 flex items-center gap-2 rounded-md border border-stone-200 bg-white px-2 py-1.5 text-xs font-semibold text-stone-700">
      <input
        checked={checked}
        type="checkbox"
        onChange={(event) => onChange?.(lineId, event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function QuantityInput({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <input
      aria-label="Quantity"
      className="seller-form-field seller-compact-field text-center"
      min="1"
      step="1"
      type="number"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
