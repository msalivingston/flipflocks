"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../../_components/seller-context";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SellerCard,
} from "../../_components/seller-ui";
import {
  formatAgeAtAvailability,
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

const emptyLine = (): OrderLine => ({
  type: "inventory",
  id: crypto.randomUUID(),
  customItemName: "",
  inventoryItemId: "",
  quantity: "1",
  search: "",
  unitPrice: "",
});

const customLine = (): OrderLine => ({
  type: "custom",
  id: crypto.randomUUID(),
  customItemName: "",
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
  const [newCustomer, setNewCustomer] = useState({
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
    businessName: "",
  });
  const [lines, setLines] = useState<OrderLine[]>([emptyLine()]);
  const [discountType, setDiscountType] = useState<DiscountType>("fixed");
  const [discountValue, setDiscountValue] = useState("");
  const [buyerNotes, setBuyerNotes] = useState("");
  const [pickupNote, setPickupNote] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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

  const selectedCustomer = customers.find(
    (customer) => customer.customer_id === selectedCustomerId,
  );
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

  function selectInventory(lineId: string, inventoryItemId: string) {
    const item = inventory.find((row) => row.inventory_item_id === inventoryItemId);

    if (!item) return;

    updateLine(lineId, {
      inventoryItemId,
      search: formatInventorySearchLabel(item),
      unitPrice: formatMoneyInput(item.effective_unit_price ?? 0),
    });
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

    const result = await supabase.rpc("seller_create_manual_order", {
      p_store_id: seller.store_id,
      p_idempotency_key: crypto.randomUUID(),
      p_items: discountedLines.map((line) => ({
        item_type: line.type,
        inventory_item_id:
          line.type === "inventory" ? line.inventoryItemId : undefined,
        custom_item_name:
          line.type === "custom" ? line.customItemName.trim() : undefined,
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
          : newCustomer.firstName.trim(),
      p_customer_last_name:
        customerMode === "existing"
          ? selectedCustomer?.last_name ?? null
          : newCustomer.lastName.trim(),
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
      p_send_buyer_notification: false,
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
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="grid gap-5">
        <CustomerSection
          customerMode={customerMode}
          customers={customers}
          newCustomer={newCustomer}
          query={customerQuery}
          selectedCustomerId={selectedCustomerId}
          setCustomerMode={setCustomerMode}
          setNewCustomer={setNewCustomer}
          setQuery={setCustomerQuery}
          setSelectedCustomerId={setSelectedCustomerId}
        />

        <SellerCard className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-stone-950">
                Order Items
              </h2>
              <p className="mt-1 text-sm leading-6 text-stone-600">
                Search by breed or bird type, then adjust quantity and price.
              </p>
            </div>
            <button
              className="seller-secondary-button"
              type="button"
              onClick={() => setLines((current) => [...current, emptyLine()])}
            >
              Add Another Item
            </button>
            <button
              className="seller-secondary-button"
              type="button"
              onClick={() => setLines((current) => [...current, customLine()])}
            >
              Add Custom Item
            </button>
          </div>

          <div className="mt-5 grid gap-4">
            {lines.map((line, index) => (
              <OrderItemEditor
                inventory={inventory}
                key={line.id}
                line={line}
                lineNumber={index + 1}
                onRemove={() =>
                  setLines((current) =>
                    current.length === 1
                      ? [emptyLine()]
                      : current.filter((item) => item.id !== line.id),
                  )
                }
                onSelectInventory={(inventoryItemId) =>
                  selectInventory(line.id, inventoryItemId)
                }
                updateLine={(updates) => updateLine(line.id, updates)}
              />
            ))}
          </div>
        </SellerCard>
      </div>

      <SellerCard className="p-5 lg:sticky lg:top-4">
        <h2 className="text-lg font-semibold text-stone-950">Order Summary</h2>
        <div className="mt-4 grid gap-4">
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Discount
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <input
                className="seller-form-field"
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
                className="seller-form-field"
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

          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Delivery method
            <select className="seller-form-field" value="pickup" disabled>
              <option value="pickup">Pickup</option>
            </select>
          </label>

          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Pickup note
            <input
              className="seller-form-field"
              placeholder="Optional pickup details"
              value={pickupNote}
              onChange={(event) => setPickupNote(event.target.value)}
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Order note
            <textarea
              className="seller-form-field min-h-24 resize-y py-3"
              value={buyerNotes}
              onChange={(event) => setBuyerNotes(event.target.value)}
            />
          </label>

          <dl className="grid gap-2 border-t border-stone-200 pt-4 text-sm">
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

          <button
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-wait disabled:opacity-70"
            disabled={isSaving}
            type="button"
            onClick={createOrder}
          >
            {isSaving ? "Creating Order" : "Create Order"}
          </button>
        </div>
      </SellerCard>
    </div>
  );
}

function CustomerSection({
  customerMode,
  customers,
  newCustomer,
  query,
  selectedCustomerId,
  setCustomerMode,
  setNewCustomer,
  setQuery,
  setSelectedCustomerId,
}: {
  customerMode: CustomerMode;
  customers: CustomerRow[];
  newCustomer: {
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
    businessName: string;
  };
  query: string;
  selectedCustomerId: string;
  setCustomerMode: (mode: CustomerMode) => void;
  setNewCustomer: (customer: typeof newCustomer) => void;
  setQuery: (query: string) => void;
  setSelectedCustomerId: (customerId: string) => void;
}) {
  const visibleCustomers = filterCustomers(customers, query).slice(0, 6);

  return (
    <SellerCard className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-950">Customer</h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Pick an existing customer or add the person standing in front of you.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-stone-200 bg-stone-50 p-1">
          {(["existing", "new"] as CustomerMode[]).map((mode) => (
            <button
              className={`min-h-9 rounded-md px-3 text-sm font-semibold ${
                customerMode === mode
                  ? "bg-emerald-800 text-white"
                  : "text-stone-700"
              }`}
              key={mode}
              type="button"
              onClick={() => setCustomerMode(mode)}
            >
              {mode === "existing" ? "Existing" : "New"}
            </button>
          ))}
        </div>
      </div>

      {customerMode === "existing" ? (
        <div className="mt-4 grid gap-3">
          <input
            className="seller-form-field"
            placeholder="Search customers"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {visibleCustomers.length > 0 ? (
            <div className="grid gap-2">
              {visibleCustomers.map((customer) => {
                const selected = selectedCustomerId === customer.customer_id;

                return (
                  <button
                    className={`rounded-lg border px-3 py-3 text-left text-sm transition ${
                      selected
                        ? "border-emerald-700 bg-emerald-50"
                        : "border-stone-200 bg-white hover:border-emerald-400"
                    }`}
                    key={customer.customer_id}
                    type="button"
                    onClick={() => setSelectedCustomerId(customer.customer_id)}
                  >
                    <span className="font-semibold text-stone-950">
                      {formatCustomerName(customer)}
                    </span>
                    <span className="mt-1 block text-stone-600">
                      {customer.email}
                      {customer.phone ? ` - ${customer.phone}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No customer matches"
              description="Switch to New to add this customer inline."
            />
          )}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <TextField
            label="First name"
            value={newCustomer.firstName}
            onChange={(firstName) => setNewCustomer({ ...newCustomer, firstName })}
          />
          <TextField
            label="Last name"
            value={newCustomer.lastName}
            onChange={(lastName) => setNewCustomer({ ...newCustomer, lastName })}
          />
          <TextField
            label="Email"
            type="email"
            value={newCustomer.email}
            onChange={(email) => setNewCustomer({ ...newCustomer, email })}
          />
          <TextField
            label="Phone"
            type="tel"
            value={newCustomer.phone}
            onChange={(phone) => setNewCustomer({ ...newCustomer, phone })}
          />
          <div className="sm:col-span-2">
            <TextField
              label="Farm or business"
              value={newCustomer.businessName}
              onChange={(businessName) =>
                setNewCustomer({ ...newCustomer, businessName })
              }
            />
          </div>
        </div>
      )}
    </SellerCard>
  );
}

function OrderItemEditor({
  inventory,
  line,
  lineNumber,
  onRemove,
  onSelectInventory,
  updateLine,
}: {
  inventory: InventorySearchRow[];
  line: OrderLine;
  lineNumber: number;
  onRemove: () => void;
  onSelectInventory: (inventoryItemId: string) => void;
  updateLine: (updates: Partial<OrderLine>) => void;
}) {
  const selectedItem = inventory.find(
    (row) => row.inventory_item_id === line.inventoryItemId,
  );
  const results = filterInventory(inventory, line.search)
    .filter((item) => item.inventory_item_id !== line.inventoryItemId)
    .slice(0, 6);
  const quantity = Number(line.quantity || 0);
  const unitPrice = Number(line.unitPrice || 0);
  const exceedsAvailable =
    line.type === "inventory" && quantityExceedsAvailable(line, inventory);

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-stone-950">
          {line.type === "custom" ? "Custom Item" : "Item"} {lineNumber}
        </h3>
        <button className="seller-small-button" type="button" onClick={onRemove}>
          Remove
        </button>
      </div>

      <div className="mt-4 grid gap-3">
        {line.type === "custom" ? (
          <TextField
            label="Item name"
            value={line.customItemName}
            onChange={(customItemName) => updateLine({ customItemName })}
          />
        ) : (
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Smart search
            <input
              className="seller-form-field"
              placeholder="Breed, type, or age"
              type="search"
              value={line.search}
              onChange={(event) =>
                updateLine({
                  inventoryItemId: "",
                  search: event.target.value,
                  unitPrice: "",
                })
              }
            />
          </label>
        )}

        {line.type === "custom" ? null : selectedItem ? (
          <div className="rounded-md border border-emerald-100 bg-white px-3 py-2 text-sm">
            <p className="font-semibold text-stone-950">
              {formatInventorySearchLabel(selectedItem)}
            </p>
          </div>
        ) : results.length > 0 ? (
          <div className="grid gap-2">
            {results.map((item) => (
              <button
                className="rounded-md border border-stone-200 bg-white px-3 py-2 text-left text-sm hover:border-emerald-500"
                key={item.inventory_item_id}
                type="button"
                onClick={() => onSelectInventory(item.inventory_item_id)}
              >
                {formatInventorySearchLabel(item)}
              </button>
            ))}
          </div>
        ) : line.search.trim() ? (
          <p className="text-sm text-stone-600">No inventory matches.</p>
        ) : null}

        {exceedsAvailable ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
            Quantity exceeds available inventory. Inventory will be reduced to zero.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-[8rem_10rem_1fr]">
          <TextField
            label="Qty"
            min="1"
            step="1"
            type="number"
            value={line.quantity}
            onChange={(quantityValue) => updateLine({ quantity: quantityValue })}
          />
          <TextField
            label="Price"
            min="0"
            step="0.01"
            type="number"
            value={line.unitPrice}
            onChange={(price) => updateLine({ unitPrice: price })}
          />
          <div>
            <p className="text-sm font-semibold text-stone-700">Total</p>
            <p className="mt-2 text-base font-semibold text-stone-950">
              {formatCurrency(quantity * unitPrice)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TextField({
  label,
  min,
  onChange,
  step,
  type = "text",
  value,
}: {
  label: string;
  min?: string;
  onChange: (value: string) => void;
  step?: string;
  type?: string;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-stone-700">
      {label}
      <input
        className="seller-form-field"
        min={min}
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
    if (!newCustomer.firstName.trim()) errors.push("Add the customer first name.");
    if (!newCustomer.lastName.trim()) errors.push("Add the customer last name.");
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

function formatInventoryType(item: InventorySearchRow) {
  return (
    item.custom_inventory_label || formatInventoryTypeLabel(item.inventory_type)
  );
}

function formatAge(item: InventorySearchRow) {
  const days = calculateCurrentAgeDays(item.origin_date);

  return formatAgeAtAvailability(days);
}

function calculateCurrentAgeDays(originDate: string | null) {
  if (!originDate) return null;

  const originTime = Date.parse(`${originDate}T00:00:00Z`);
  const today = new Date();
  const todayTime = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );

  if (Number.isNaN(originTime)) return null;

  return Math.max(Math.floor((todayTime - originTime) / 86_400_000), 0);
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
