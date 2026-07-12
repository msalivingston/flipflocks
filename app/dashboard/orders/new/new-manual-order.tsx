"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../../_components/seller-context";
import {
  ErrorState,
  LoadingState,
  SellerCard,
} from "../../_components/seller-ui";
import {
  formatAgeAtAvailabilityFromDates,
  formatInventoryTypeLabel,
} from "../../_lib/listing-formatters";
import { formatCurrency } from "../order-formatters";

type CustomerRow = {
  customer_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  business_name: string | null;
};

type InventorySearchRow = {
  inventory_item_id: string;
  listing_batch_id: string;
  breed_display_name: string;
  inventory_type: string;
  custom_inventory_label: string | null;
  origin_date: string | null;
  available_date: string;
  quantity_available: number | null;
  effective_unit_price: number | null;
  inventory_visibility_status: string;
  inventory_moderation_status: string;
  listing_batch_visibility_status: string;
  listing_batch_moderation_status: string;
  operational_availability_status: string;
};

type OrderLine = {
  type: "inventory" | "custom";
  id: string;
  inventoryItemId: string;
  customItemName: string;
  customItemDescription: string;
  search: string;
  quantity: string;
  unitPrice: string;
};

type CreatedOrder = {
  order_id: string;
  order_number: string;
  total_amount: number | null;
};

type DiscountType = "fixed" | "percent";

type CustomerMode = "existing" | "new";

type BrowseInventoryFilter = "all" | "poultry";

const emptyLine = (): OrderLine => ({
  type: "inventory",
  id: crypto.randomUUID(),
  customItemName: "",
  customItemDescription: "",
  inventoryItemId: "",
  quantity: "1",
  search: "",
  unitPrice: "",
});

const customLine = (): OrderLine => ({
  type: "custom",
  id: crypto.randomUUID(),
  customItemName: "",
  customItemDescription: "",
  inventoryItemId: "",
  quantity: "1",
  search: "",
  unitPrice: "",
});

export function NewManualOrder() {
  const { seller } = useSellerContext();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [inventory, setInventory] = useState<InventorySearchRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [customerMode, setCustomerMode] = useState<CustomerMode>("existing");
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [isBrowseOpen, setIsBrowseOpen] = useState(false);
  const [browseFilter, setBrowseFilter] = useState<BrowseInventoryFilter>("all");
  const [browseQuery, setBrowseQuery] = useState("");
  const [browseAddedInventoryItemId, setBrowseAddedInventoryItemId] = useState<
    string | null
  >(null);
  const [newCustomer, setNewCustomer] = useState({
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
    businessName: "",
  });
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [discountType, setDiscountType] = useState<DiscountType>("fixed");
  const [discountValue, setDiscountValue] = useState("");
  const [buyerNotes, setBuyerNotes] = useState("");
  const [pickupNote, setPickupNote] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [sendBuyerConfirmation, setSendBuyerConfirmation] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      if (!seller) return;

      setIsLoading(true);
      setLoadError(null);

      const [customerResult, inventoryResult] = await Promise.all([
        supabase
          .from("seller_customer_summary")
          .select("customer_id, email, first_name, last_name, phone, business_name")
          .eq("store_id", seller.store_id)
          .order("latest_order_created_at", {
            ascending: false,
            nullsFirst: false,
          })
          .order("created_at", { ascending: false })
          .limit(200)
          .returns<CustomerRow[]>(),
        supabase
          .from("seller_inventory_management")
          .select(
            "inventory_item_id, listing_batch_id, breed_display_name, inventory_type, custom_inventory_label, origin_date, available_date, quantity_available, effective_unit_price, inventory_visibility_status, inventory_moderation_status, listing_batch_visibility_status, listing_batch_moderation_status, operational_availability_status",
          )
          .eq("store_id", seller.store_id)
          .neq("inventory_visibility_status", "archived")
          .neq("listing_batch_visibility_status", "archived")
          .eq("inventory_moderation_status", "normal")
          .eq("listing_batch_moderation_status", "normal")
          .order("breed_display_name", { ascending: true })
          .returns<InventorySearchRow[]>(),
      ]);

      if (!isMounted) return;

      const firstError = customerResult.error ?? inventoryResult.error;

      if (firstError) {
        setLoadError(firstError.message);
        setIsLoading(false);
        return;
      }

      setCustomers(customerResult.data ?? []);
      setInventory(inventoryResult.data ?? []);
      setIsLoading(false);
    }

    void loadData();

    return () => {
      isMounted = false;
    };
  }, [seller]);

  useEffect(() => {
    if (!isBrowseOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsBrowseOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isBrowseOpen]);

  const selectedCustomer = customers.find(
    (customer) => customer.customer_id === selectedCustomerId,
  );
  const buyerConfirmationEmail = getCreatedCustomerEmail(
    customerMode,
    selectedCustomer,
    newCustomer,
  );
  const canEmailBuyerConfirmation = isEmail(buyerConfirmationEmail);
  const activeLines = lines.filter(isActiveLine);
  const subtotal = activeLines.reduce((total, line) => {
    const quantity = Number(line.quantity || 0);
    const unitPrice = Number(line.unitPrice || 0);

    return total + quantity * unitPrice;
  }, 0);
  const discountAmount = calculateDiscountAmount(
    subtotal,
    discountType,
    discountValue,
  );
  const discountedLines = distributeDiscount(lines, inventory, discountAmount);
  const taxAmount = 0;
  const total = Math.max(subtotal - discountAmount + taxAmount, 0);

  function updateLine(lineId: string, updates: Partial<OrderLine>) {
    setLines((current) =>
      current.map((line) => (line.id === lineId ? { ...line, ...updates } : line)),
    );
    setValidationErrors([]);
    setSaveError(null);
  }

  function addInventoryItem(inventoryItemId: string) {
    const item = inventory.find((row) => row.inventory_item_id === inventoryItemId);

    if (!item) return;

    setLines((current) => {
      const existingLine = current.find(
        (line) =>
          line.type === "inventory" && line.inventoryItemId === inventoryItemId,
      );

      if (existingLine) {
        return current.map((line) =>
          line.id === existingLine.id
            ? { ...line, quantity: String(Number(line.quantity || 0) + 1) }
            : line,
        );
      }

      return [
        ...current,
        {
          ...emptyLine(),
          inventoryItemId,
          search: formatInventorySearchLabel(item),
          unitPrice: formatMoneyInput(item.effective_unit_price ?? 0),
        },
      ];
    });
    setInventoryQuery("");
    setValidationErrors([]);
    setSaveError(null);
  }

  function addBrowseInventoryItem(inventoryItemId: string) {
    addInventoryItem(inventoryItemId);
    setBrowseAddedInventoryItemId(inventoryItemId);
    window.setTimeout(() => {
      setBrowseAddedInventoryItemId((current) =>
        current === inventoryItemId ? null : current,
      );
    }, 1200);
  }

  function addCustomItem() {
    setLines((current) => [...current, customLine()]);
    setValidationErrors([]);
    setSaveError(null);
  }

  function removeLine(lineId: string) {
    setLines((current) => current.filter((line) => line.id !== lineId));
    setValidationErrors([]);
    setSaveError(null);
  }

  function selectCustomer(customerId: string) {
    setSelectedCustomerId(customerId);
    setCustomerMode("existing");
    setCustomerQuery("");
    setIsAddingCustomer(false);
    setValidationErrors([]);
    setSaveError(null);
  }

  function addNewCustomerInline() {
    const parsedName = parseFullName(newCustomer.firstName);

    setNewCustomer((current) => ({
      ...current,
      firstName: parsedName.firstName,
      lastName: parsedName.lastName,
    }));
    setSelectedCustomerId("");
    setCustomerMode("new");
    setIsAddingCustomer(false);
    setCustomerQuery("");
    setValidationErrors([]);
    setSaveError(null);
  }

  async function createOrder() {
    if (!seller || isSaving) return;

    const errors = validateOrder({
      customerMode,
      discountType,
      discountValue,
      lines,
      newCustomer,
      selectedCustomer,
      inventory,
    });
    setValidationErrors(errors);
    setSaveError(null);

    if (errors.length > 0) return;

    setIsSaving(true);

    const parsedNewCustomerName = parseFullName(newCustomer.firstName);

    const shouldSendBuyerConfirmation =
      sendBuyerConfirmation && canEmailBuyerConfirmation;
    const result = await supabase.rpc("seller_create_manual_order", {
      p_store_id: seller.store_id,
      p_idempotency_key: crypto.randomUUID(),
      p_items: discountedLines.map((line) => ({
        item_type: line.type,
        inventory_item_id:
          line.type === "inventory" ? line.inventoryItemId : undefined,
        custom_item_name:
          line.type === "custom" ? formatCustomItemPayloadName(line) : undefined,
        quantity: Number(line.quantity),
        unit_price: line.discountedUnitPrice,
        allow_inventory_override:
          line.type === "inventory"
            ? quantityExceedsAvailable(line, inventory)
            : undefined,
      })),
      p_customer_id:
        customerMode === "existing" ? selectedCustomer?.customer_id ?? null : null,
      p_customer_email:
        customerMode === "existing"
          ? selectedCustomer?.email ?? null
          : newCustomer.email.trim(),
      p_customer_first_name:
        customerMode === "existing"
          ? selectedCustomer?.first_name ?? null
          : parsedNewCustomerName.firstName,
      p_customer_last_name:
        customerMode === "existing"
          ? selectedCustomer?.last_name ?? null
          : parsedNewCustomerName.lastName,
      p_customer_phone:
        customerMode === "existing"
          ? selectedCustomer?.phone ?? null
          : newCustomer.phone.trim() || null,
      p_business_name:
        customerMode === "existing"
          ? selectedCustomer?.business_name ?? null
          : newCustomer.businessName.trim() || null,
      p_order_source: "manual",
      p_payment_status: "pay_at_pickup",
      p_buyer_notes: buyerNotes.trim() || null,
      p_pickup_note: pickupNote.trim() || "Pickup",
      p_tax_fee_amount: taxAmount,
      p_send_buyer_notification: shouldSendBuyerConfirmation,
      p_send_seller_notification: false,
    });

    if (result.error) {
      setSaveError(result.error.message);
      setIsSaving(false);
      return;
    }

    const rows = Array.isArray(result.data)
      ? (result.data as CreatedOrder[])
      : [];
    const order = rows[0] ?? null;

    setCreatedOrder(order);
    setIsSaving(false);

    if (shouldSendBuyerConfirmation) {
      void supabase.functions
        .invoke("manual-order-email-kick")
        .then(({ error }) => {
          if (error) {
            console.warn("Manual order email kick failed", error.message);
          }
        })
        .catch((error) => {
          console.warn(
            "Manual order email kick failed",
            error instanceof Error ? error.message : String(error),
          );
        });
    }
  }

  if (isLoading) return <LoadingState label="Loading order tools" />;

  if (loadError) {
    return (
      <ErrorState
        title="New order could not load"
        message="Refresh the page and try again. Inventory or customer lookup may need attention."
      />
    );
  }

  if (createdOrder) {
    return (
      <SellerCard className="p-5">
        <h2 className="text-xl font-semibold text-stone-950">
          Order {createdOrder.order_number} created
        </h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          The order is open, inventory was deducted, and no customer email was
          sent automatically.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800"
            href={`/dashboard/orders/${createdOrder.order_id}`}
          >
            View Order
          </Link>
          <a
            className="seller-secondary-button"
            href={`mailto:${getCreatedCustomerEmail(
              customerMode,
              selectedCustomer,
              newCustomer,
            )}?subject=${encodeURIComponent(
              `Order ${createdOrder.order_number}`,
            )}`}
          >
            Send Order Email
          </a>
          <button
            className="seller-secondary-button"
            type="button"
            onClick={() =>
              void navigator.clipboard.writeText(
                `${window.location.origin}/dashboard/orders/${createdOrder.order_id}`,
              )
            }
          >
            Copy Order Link
          </button>
        </div>
      </SellerCard>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
      <div className="grid min-w-0 gap-3">
        <CustomerSection
          customerMode={customerMode}
          customers={customers}
          isAddingCustomer={isAddingCustomer}
          newCustomer={newCustomer}
          query={customerQuery}
          selectedCustomer={selectedCustomer}
          selectedCustomerId={selectedCustomerId}
          addNewCustomerInline={addNewCustomerInline}
          setCustomerMode={setCustomerMode}
          setIsAddingCustomer={setIsAddingCustomer}
          setNewCustomer={setNewCustomer}
          setQuery={setCustomerQuery}
          selectCustomer={selectCustomer}
          setSelectedCustomerId={setSelectedCustomerId}
        />

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
                setInventoryQuery(event.target.value);
                setIsBrowseOpen(false);
              }}
            />
            <div className="flex items-center gap-1.5">
              <button
                className="inline-flex min-h-9 items-center rounded-md border border-emerald-100 bg-emerald-50 px-2.5 text-xs font-bold text-emerald-900 transition hover:border-emerald-200 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-700/25"
                type="button"
                onClick={() => {
                  setIsBrowseOpen((current) => !current);
                  setInventoryQuery("");
                }}
              >
                Browse inventory
              </button>
              <button
                className="inline-flex min-h-9 items-center rounded-md px-2.5 text-xs font-bold text-emerald-800 transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/25"
                type="button"
                onClick={addCustomItem}
              >
                + Custom item
              </button>
            </div>
          </div>

          <InventorySearchResults
            inventory={inventory}
            query={inventoryQuery}
            onSelect={addInventoryItem}
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
                      inventory={inventory}
                      key={line.id}
                      line={line}
                      onRemove={() => removeLine(line.id)}
                      updateLine={(updates) => updateLine(line.id, updates)}
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

        <SellerCard className="min-w-0 p-3">
          <h2 className="text-lg font-semibold text-stone-950">Order Details</h2>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Delivery method
              <select className="seller-form-field seller-compact-field" value="pickup" disabled>
                <option value="pickup">Pickup</option>
              </select>
            </label>

            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Pickup note
              <input
                className="seller-form-field seller-compact-field"
                placeholder="Optional pickup details"
                value={pickupNote}
                onChange={(event) => setPickupNote(event.target.value)}
              />
            </label>

            <label className="grid gap-1 text-sm font-semibold text-stone-700 md:col-span-2">
              Order note
              <textarea
                className="seller-form-field seller-compact-field min-h-16 resize-y py-2"
                placeholder="Add a note for this order"
                value={buyerNotes}
                onChange={(event) => setBuyerNotes(event.target.value)}
              />
            </label>
          </div>
        </SellerCard>
      </div>

      <SellerCard className="p-3 lg:sticky lg:top-3">
        <h2 className="text-lg font-semibold text-stone-950">Order Summary</h2>
        <div className="mt-3 grid gap-3">
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Discount
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <input
                className="seller-form-field seller-compact-field"
                inputMode="decimal"
                min="0"
                step="0.01"
                type="number"
                value={discountValue}
                onChange={(event) => {
                  setDiscountValue(event.target.value);
                  setValidationErrors([]);
                }}
              />
              <select
                className="seller-form-field seller-compact-field"
                value={discountType}
                onChange={(event) =>
                  setDiscountType(event.target.value as DiscountType)
                }
              >
                <option value="fixed">$ off</option>
                <option value="percent">% off</option>
              </select>
            </div>
          </label>

          <dl className="grid gap-2 border-t border-stone-200 pt-3 text-sm">
            <SummaryRow label="Subtotal" value={formatCurrency(subtotal)} />
            <SummaryRow
              label="Discount"
              value={`-${formatCurrency(discountAmount)}`}
            />
            <SummaryRow label="Tax" value={formatCurrency(taxAmount)} />
            <div className="flex items-center justify-between border-t border-stone-200 pt-3 text-base font-semibold text-stone-950">
              <dt>Total</dt>
              <dd>{formatCurrency(total)}</dd>
            </div>
          </dl>

          {validationErrors.length > 0 ? (
            <ValidationMessage errors={validationErrors} />
          ) : null}

          {saveError ? (
            <ErrorState title="Order was not created" message={saveError} />
          ) : null}

          <label className="flex items-start gap-3 rounded-lg border border-stone-200 bg-white px-3 py-3 text-sm text-stone-700">
            <input
              checked={sendBuyerConfirmation && canEmailBuyerConfirmation}
              className="mt-1 size-4 rounded border-stone-300 text-emerald-800 focus:ring-emerald-700"
              disabled={!canEmailBuyerConfirmation || isSaving}
              type="checkbox"
              onChange={(event) => setSendBuyerConfirmation(event.target.checked)}
            />
            <span>
              <span className="block font-semibold text-stone-950">
                Email order confirmation to customer
              </span>
              <span className="block text-xs leading-5 text-stone-600">
                {canEmailBuyerConfirmation
                  ? buyerConfirmationEmail
                  : "Add a customer email address to send a confirmation."}
              </span>
            </span>
          </label>

          <button
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-800 px-5 text-sm font-semibold text-white transition hover:bg-emerald-900 disabled:cursor-wait disabled:opacity-70"
            disabled={isSaving}
            type="button"
            onClick={createOrder}
          >
            {isSaving ? "Creating Order" : "Create Order"}
          </button>
        </div>
      </SellerCard>

      {isBrowseOpen ? (
        <BrowseInventoryDialog
          addedInventoryItemId={browseAddedInventoryItemId}
          filter={browseFilter}
          inventory={inventory}
          query={browseQuery}
          onClose={() => setIsBrowseOpen(false)}
          onFilterChange={setBrowseFilter}
          onQueryChange={setBrowseQuery}
          onSelect={addBrowseInventoryItem}
        />
      ) : null}
    </div>
  );
}

function CustomerSection({
  customerMode,
  customers,
  isAddingCustomer,
  newCustomer,
  query,
  selectedCustomer,
  selectedCustomerId,
  addNewCustomerInline,
  setCustomerMode,
  setIsAddingCustomer,
  setNewCustomer,
  setQuery,
  selectCustomer,
  setSelectedCustomerId,
}: {
  customerMode: CustomerMode;
  customers: CustomerRow[];
  isAddingCustomer: boolean;
  newCustomer: {
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
    businessName: string;
  };
  query: string;
  selectedCustomer: CustomerRow | undefined;
  selectedCustomerId: string;
  addNewCustomerInline: () => void;
  setCustomerMode: (mode: CustomerMode) => void;
  setIsAddingCustomer: (isAdding: boolean) => void;
  setNewCustomer: (customer: typeof newCustomer) => void;
  setQuery: (query: string) => void;
  selectCustomer: (customerId: string) => void;
  setSelectedCustomerId: (customerId: string) => void;
}) {
  const canShowResults = query.trim().length >= 2;
  const visibleCustomers = canShowResults
    ? filterCustomers(customers, query).slice(0, 6)
    : [];
  const selectedCustomerLabel =
    !isAddingCustomer && customerMode === "existing" && selectedCustomer
      ? formatCustomerSummary(selectedCustomer)
      : !isAddingCustomer && customerMode === "new" && newCustomer.email
        ? formatInlineCustomerSummary(newCustomer)
        : null;
  const canAddCustomer =
    newCustomer.firstName.trim().length > 0 && isEmail(newCustomer.email);

  return (
    <SellerCard className="min-w-0 overflow-hidden p-3">
      <h2 className="text-lg font-semibold text-stone-950">Customer</h2>
      <div className="relative mt-2">
        <label className="sr-only" htmlFor="manual-order-customer-search">
          Search or select customer
        </label>
        <input
          className="seller-form-field seller-compact-field seller-action-search-field pr-36"
          id="manual-order-customer-search"
          placeholder="Search or select customer"
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsAddingCustomer(false);
          }}
        />
        <button
          className="absolute right-2 top-1/2 inline-flex min-h-8 -translate-y-1/2 items-center rounded-md px-2.5 text-sm font-bold text-emerald-800 transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/25"
          type="button"
          onClick={() => {
            setIsAddingCustomer(true);
            setCustomerMode("new");
            setSelectedCustomerId("");
          }}
        >
          + Add Customer
        </button>
      </div>

      {canShowResults && customerMode !== "new" ? (
        <div
          className="mt-2 overflow-hidden rounded-md border border-stone-200 bg-white shadow-sm"
          id="manual-order-customer-results"
        >
          {visibleCustomers.length > 0 ? (
            visibleCustomers.map((customer) => (
              <button
                className="flex min-h-10 w-full items-center justify-between gap-3 border-b border-stone-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-emerald-50 focus:bg-emerald-50 focus:outline-none"
                key={customer.customer_id}
                type="button"
                onClick={() => selectCustomer(customer.customer_id)}
              >
                <span className="truncate font-semibold text-stone-950">
                  {formatCustomerSummary(customer)}
                </span>
                {selectedCustomerId === customer.customer_id ? (
                  <span className="text-xs font-bold text-emerald-800">
                    Selected
                  </span>
                ) : null}
              </button>
            ))
          ) : (
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-stone-600">
              <span>No results</span>
              <button
                className="font-bold text-emerald-800 hover:text-emerald-900"
                type="button"
                onClick={() => {
                  setIsAddingCustomer(true);
                  setCustomerMode("new");
                  setSelectedCustomerId("");
                }}
              >
                Add Customer
              </button>
            </div>
          )}
        </div>
      ) : null}

      {selectedCustomerLabel ? (
        <div className="mt-2 flex min-h-10 items-center justify-between gap-3 rounded-md border border-stone-200 bg-[#fffdf7] px-3 text-sm">
          <span className="truncate font-medium text-stone-800">
            {selectedCustomerLabel}
          </span>
          <button
            className="shrink-0 text-sm font-bold text-emerald-800 hover:text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/25"
            type="button"
            onClick={() => {
              setCustomerMode("existing");
              setSelectedCustomerId("");
              setIsAddingCustomer(false);
            }}
          >
            Remove
          </button>
        </div>
      ) : null}

      {isAddingCustomer ? (
        <div className="mt-2 rounded-md border border-stone-200 bg-[#fffdf7] px-3 py-2">
          <h3 className="text-sm font-bold text-stone-950">Add New Customer</h3>
          <div className="mt-2 grid gap-2 md:grid-cols-[1.2fr_1fr_1fr_auto] md:items-end">
            <TextField
              label="Name*"
              placeholder="Full name"
              value={newCustomer.firstName}
              onChange={(firstName) =>
                setNewCustomer({ ...newCustomer, firstName })
              }
            />
            <TextField
              label="Email*"
              placeholder="Email address"
              type="email"
              value={newCustomer.email}
              onChange={(email) => setNewCustomer({ ...newCustomer, email })}
            />
            <TextField
              label="Phone"
              placeholder="Phone number"
              type="tel"
              value={newCustomer.phone}
              onChange={(phone) => setNewCustomer({ ...newCustomer, phone })}
            />
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-800 px-4 text-sm font-bold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
              disabled={!canAddCustomer}
              type="button"
              onClick={addNewCustomerInline}
            >
              Add Customer
            </button>
          </div>
        </div>
      ) : null}
    </SellerCard>
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
            key={item.inventory_item_id}
            type="button"
            onClick={() => onSelect(item.inventory_item_id)}
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold text-stone-950">
                {item.breed_display_name}
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
    { label: "Poultry", value: "poultry" },
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
              const wasAdded = addedInventoryItemId === item.inventory_item_id;

              return (
                <div
                  className="grid grid-cols-[minmax(0,1fr)_5rem_5.25rem_4rem] items-center gap-2 border-b border-stone-100 px-4 py-2 text-sm last:border-b-0"
                  key={item.inventory_item_id}
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold text-stone-950">
                      {item.breed_display_name}
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
                    onClick={() => onSelect(item.inventory_item_id)}
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
  inventory,
  line,
  onRemove,
  updateLine,
}: {
  inventory: InventorySearchRow[];
  line: OrderLine;
  onRemove: () => void;
  updateLine: (updates: Partial<OrderLine>) => void;
}) {
  const selectedItem = inventory.find(
    (row) => row.inventory_item_id === line.inventoryItemId,
  );
  const quantity = Number(line.quantity || 0);
  const unitPrice = Number(line.unitPrice || 0);
  const exceedsAvailable =
    line.type === "inventory" && quantityExceedsAvailable(line, inventory);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_72px_96px_90px_28px] items-start gap-2 px-1 py-2">
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
              {selectedItem?.breed_display_name ?? "Inventory item"}
            </p>
            <p className="mt-1 truncate text-xs text-stone-600">
              {selectedItem ? formatInventoryMetadata(selectedItem) : line.search}
            </p>
            {exceedsAvailable ? (
              <p className="mt-1 text-xs font-semibold text-amber-800">
                Quantity exceeds available inventory.
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
function TextField({
  label,
  min,
  onChange,
  placeholder,
  step,
  type = "text",
  value,
}: {
  label: string;
  min?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  step?: string;
  type?: string;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-stone-700">
      {label}
      <input
        className="seller-form-field seller-compact-field"
        min={min}
        placeholder={placeholder}
        step={step}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-stone-600">{label}</dt>
      <dd className="font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

function ValidationMessage({ errors }: { errors: string[] }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <h2 className="text-sm font-semibold text-amber-950">
        A few details need attention
      </h2>
      <ul className="mt-2 grid gap-1 text-sm leading-6 text-amber-800">
        {errors.map((error) => (
          <li key={error}>- {error}</li>
        ))}
      </ul>
    </div>
  );
}

function validateOrder({
  customerMode,
  discountType,
  discountValue,
  inventory,
  lines,
  newCustomer,
  selectedCustomer,
}: {
  customerMode: CustomerMode;
  discountType: DiscountType;
  discountValue: string;
  inventory: InventorySearchRow[];
  lines: OrderLine[];
  newCustomer: {
    email: string;
    firstName: string;
    lastName: string;
  };
  selectedCustomer: CustomerRow | undefined;
}) {
  const errors: string[] = [];
  const selectedLines = lines.filter(isActiveLine);

  if (customerMode === "existing" && !selectedCustomer) {
    errors.push("Select a customer.");
  }

  if (customerMode === "new") {
    if (!newCustomer.firstName.trim()) errors.push("Add the customer name.");
    if (!isEmail(newCustomer.email)) errors.push("Add a valid customer email.");
  }

  if (selectedLines.length === 0) errors.push("Add at least one inventory item.");

  selectedLines.forEach((line, index) => {
    const item = inventory.find(
      (row) => row.inventory_item_id === line.inventoryItemId,
    );
    const label = `Item ${index + 1}`;

    if (line.type === "inventory" && !item) {
      errors.push(`${label}: inventory was not found.`);
    }
    if (line.type === "custom" && !line.customItemName.trim()) {
      errors.push(`${label}: add a custom item name.`);
    }
    if (!isPositiveWholeNumber(line.quantity)) {
      errors.push(`${label}: quantity must be 1 or more.`);
    }
    if (!isValidMoney(line.unitPrice)) {
      errors.push(`${label}: price must be a valid amount.`);
    }
  });

  if (discountValue.trim()) {
    if (!isValidMoney(discountValue)) {
      errors.push("Discount must be a valid amount.");
    } else if (discountType === "percent" && Number(discountValue) > 100) {
      errors.push("Percent discount cannot be more than 100%.");
    }
  }

  return errors;
}

function distributeDiscount(
  lines: OrderLine[],
  inventory: InventorySearchRow[],
  discountAmount: number,
) {
  const selectedLines = lines.filter(isActiveLine);
  const subtotal = selectedLines.reduce(
    (total, line) => total + Number(line.quantity || 0) * Number(line.unitPrice || 0),
    0,
  );

  if (subtotal <= 0 || discountAmount <= 0) {
    return selectedLines.map((line) => ({
      ...line,
      discountedUnitPrice: Number(line.unitPrice || 0),
    }));
  }

  let remainingDiscount = Math.min(discountAmount, subtotal);

  return selectedLines.map((line, index) => {
    const quantity = Number(line.quantity);
    const lineTotal = quantity * Number(line.unitPrice);
    const lineDiscount =
      index === selectedLines.length - 1
        ? remainingDiscount
        : roundCurrency((lineTotal / subtotal) * discountAmount);
    remainingDiscount = roundCurrency(remainingDiscount - lineDiscount);

    const item = inventory.find(
      (row) => row.inventory_item_id === line.inventoryItemId,
    );

    return {
      ...line,
      search:
        line.type === "inventory" && item
          ? formatInventorySearchLabel(item)
          : line.search,
      discountedUnitPrice: roundCurrency(
        Math.max((lineTotal - lineDiscount) / quantity, 0),
      ),
    };
  });
}

function calculateDiscountAmount(
  subtotal: number,
  discountType: DiscountType,
  discountValue: string,
) {
  if (!isValidMoney(discountValue)) return 0;

  const value = Number(discountValue);
  const discount =
    discountType === "percent" ? subtotal * (Math.min(value, 100) / 100) : value;

  return roundCurrency(Math.min(discount, subtotal));
}

function filterCustomers(customers: CustomerRow[], query: string) {
  const normalized = query.trim().toLowerCase();

  if (!normalized) return customers;

  return customers.filter((customer) =>
    [
      formatCustomerName(customer),
      customer.email,
      customer.phone,
      customer.business_name,
    ]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(normalized)),
  );
}

function filterInventory(inventory: InventorySearchRow[], query: string) {
  const normalized = query.trim().toLowerCase();

  return inventory.filter((item) => {
    if ((item.quantity_available ?? 0) <= 0) return false;
    if (!normalized) return false;

    return [
      item.breed_display_name,
      formatInventoryType(item),
      formatAge(item),
      item.operational_availability_status,
    ].some((value) => value.toLowerCase().includes(normalized));
  });
}

function getBrowseInventoryRows(
  inventory: InventorySearchRow[],
  filter: BrowseInventoryFilter,
  query: string,
) {
  const normalized = query.trim().toLowerCase();

  return inventory
    .filter((item) => {
      if ((item.quantity_available ?? 0) <= 0) return false;
      if (filter !== "all" && getBrowseInventoryCategory(item) !== filter) {
        return false;
      }
      if (!normalized) return true;

      return [
        item.breed_display_name,
        formatInventoryType(item),
        formatAge(item),
        item.operational_availability_status,
      ].some((value) => value.toLowerCase().includes(normalized));
    })
    .sort((firstItem, secondItem) =>
      firstItem.breed_display_name.localeCompare(secondItem.breed_display_name),
    );
}

function getBrowseInventoryCategory(
  item: InventorySearchRow,
): Exclude<BrowseInventoryFilter, "all"> {
  return item.inventory_type ? "poultry" : "poultry";
}

function isActiveLine(line: OrderLine) {
  if (line.type === "custom") {
    return Boolean(line.customItemName.trim() || line.unitPrice.trim());
  }

  return Boolean(line.inventoryItemId);
}

function quantityExceedsAvailable(
  line: OrderLine,
  inventory: InventorySearchRow[],
) {
  if (line.type !== "inventory") return false;
  if (!isPositiveWholeNumber(line.quantity)) return false;

  const item = inventory.find(
    (row) => row.inventory_item_id === line.inventoryItemId,
  );

  if (!item) return false;

  return Number(line.quantity) > (item.quantity_available ?? 0);
}

function formatInventorySearchLabel(item: InventorySearchRow) {
  return `${item.breed_display_name} ${formatInventoryType(item)} - ${formatAge(
    item,
  )} - ${item.quantity_available ?? 0} available - ${formatCurrency(
    item.effective_unit_price,
  )}`;
}

function formatCustomItemPayloadName(line: OrderLine) {
  const name = line.customItemName.trim();
  const description = line.customItemDescription.trim();

  return description ? `${name} - ${description}` : name;
}

function formatInventoryMetadata(item: InventorySearchRow) {
  return `${formatInventoryType(item)} · ${formatAge(item)} · Inventory`;
}

function formatBrowseInventoryMetadata(item: InventorySearchRow) {
  return `${formatInventoryType(item)} · ${formatAge(item)} · Poultry`;
}

function formatInventoryType(item: InventorySearchRow) {
  return (
    item.custom_inventory_label || formatInventoryTypeLabel(item.inventory_type)
  );
}

function formatAge(item: InventorySearchRow) {
  return formatAgeAtAvailabilityFromDates(item.origin_date, item.available_date);
}

function formatCustomerName(customer: {
  first_name: string | null;
  last_name: string | null;
}) {
  return (
    [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
    "Customer"
  );
}

function formatCustomerSummary(customer: CustomerRow) {
  return [
    formatCustomerName(customer),
    customer.email,
    customer.phone,
  ]
    .filter(Boolean)
    .join(" - ");
}

function formatInlineCustomerSummary(customer: {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
}) {
  return [
    formatNewCustomerName(customer),
    customer.email.trim(),
    customer.phone.trim(),
  ]
    .filter(Boolean)
    .join(" - ");
}

function formatNewCustomerName(customer: {
  firstName: string;
  lastName: string;
}) {
  const fullName = [customer.firstName, customer.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return fullName || "Customer";
}

function parseFullName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { firstName: "", lastName: "" };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "Customer" };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function getCreatedCustomerEmail(
  customerMode: CustomerMode,
  selectedCustomer: CustomerRow | undefined,
  newCustomer: { email: string },
) {
  return customerMode === "existing"
    ? selectedCustomer?.email ?? ""
    : newCustomer.email.trim();
}

function formatMoneyInput(value: number) {
  return value.toFixed(2);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function isValidMoney(value: string) {
  return /^\d+(\.\d{1,2})?$/.test(value.trim());
}

function isPositiveWholeNumber(value: string) {
  return /^[1-9]\d*$/.test(value.trim());
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
