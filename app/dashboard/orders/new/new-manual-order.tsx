"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../../_components/seller-context";
import {
  ErrorState,
  LoadingState,
  SellerCard,
} from "../../_components/seller-ui";
import { OrderFulfillmentSection } from "../_components/order-fulfillment-section";
import { OrderItemsEditor } from "../_components/order-items-editor";
import {
  calculateDeliveryFee,
  calculateDiscountAmount,
  calculateFinalTotal,
  calculateOrderSubtotal,
  customLine,
  distributeDiscount,
  emptyLine,
  formatCustomItemPayloadName,
  formatMoneyInput,
  validateSharedOrderForm,
} from "../_lib/order-form-calculations";
import {
  emptyDeliveryAddress,
  formatSavedDeliveryAddress,
  updateDeliveryAddress,
} from "../_lib/order-form-fulfillment";
import {
  formatInventorySearchLabel,
  getManualOrderPayloadItemType,
  normalizeSellableInventoryRows,
  quantityExceedsAvailable,
} from "../_lib/order-form-inventory";
import type {
  BrowseInventoryFilter,
  DeliveryAddress,
  DeliveryOption,
  DiscountType,
  EquipmentInventoryRow,
  FulfillmentMethod,
  InventorySearchRow,
  ListingInventoryRow,
  OrderLine,
  PickupMethod,
  PickupOption,
  ProcessedPoultryInventoryRow,
  StoreDefaults,
} from "../_lib/order-form-types";
import { formatCurrency } from "../order-formatters";

type CustomerRow = {
  customer_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  business_name: string | null;
};

type CustomerDetailRow = CustomerRow & {
  delivery_address_line1: string | null;
  delivery_address_line2: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_postal_code: string | null;
  delivery_country: string | null;
};

type CreatedOrder = {
  order_id: string;
  order_number: string;
  total_amount: number | null;
};

type CustomerMode = "existing" | "new";

export function NewManualOrder() {
  const { seller } = useSellerContext();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [inventory, setInventory] = useState<InventorySearchRow[]>([]);
  const [pickupMethod, setPickupMethod] = useState<PickupMethod>("notes");
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [pickupOptions, setPickupOptions] = useState<PickupOption[]>([]);
  const [deliveryOptions, setDeliveryOptions] = useState<DeliveryOption[]>([]);
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
  const [fulfillmentMethod, setFulfillmentMethod] =
    useState<FulfillmentMethod>("pickup");
  const [buyerNotes, setBuyerNotes] = useState("");
  const [pickupNote, setPickupNote] = useState("");
  const [pickupOptionId, setPickupOptionId] = useState("");
  const [deliveryOptionId, setDeliveryOptionId] = useState("");
  const [deliveryAddress, setDeliveryAddress] =
    useState<DeliveryAddress>(emptyDeliveryAddress);
  const [deliveryAddressCustomerId, setDeliveryAddressCustomerId] = useState<
    string | null
  >(null);
  const [hasEditedDeliveryAddress, setHasEditedDeliveryAddress] =
    useState(false);
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

      const [
        customerResult,
        inventoryResult,
        equipmentResult,
        processedPoultryResult,
        defaultsResult,
        pickupOptionsResult,
        deliveryOptionsResult,
      ] = await Promise.all([
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
            "inventory_item_id, listing_batch_id, breed_display_name, batch_type, inventory_type, custom_inventory_label, origin_date, available_date, quantity_available, effective_unit_price, inventory_visibility_status, inventory_moderation_status, listing_batch_visibility_status, listing_batch_moderation_status, operational_availability_status",
          )
          .eq("store_id", seller.store_id)
          .neq("inventory_visibility_status", "archived")
          .neq("listing_batch_visibility_status", "archived")
          .eq("inventory_moderation_status", "normal")
          .eq("listing_batch_moderation_status", "normal")
          .order("breed_display_name", { ascending: true })
          .returns<ListingInventoryRow[]>(),
        supabase
          .from("seller_equipment_inventory_management")
          .select(
            "equipment_inventory_item_id, item_name, category, condition, quantity_available, price, visibility_status, moderation_status, operational_availability_status",
          )
          .eq("store_id", seller.store_id)
          .neq("visibility_status", "archived")
          .eq("moderation_status", "normal")
          .order("item_name", { ascending: true })
          .returns<EquipmentInventoryRow[]>(),
        supabase
          .from("seller_processed_poultry_inventory_management")
          .select(
            "processed_poultry_inventory_item_id, product_name, poultry_type, product_type, package_size, quantity_available, price, visibility_status, moderation_status, operational_availability_status",
          )
          .eq("store_id", seller.store_id)
          .neq("visibility_status", "archived")
          .eq("moderation_status", "normal")
          .order("product_name", { ascending: true })
          .returns<ProcessedPoultryInventoryRow[]>(),
        supabase
          .from("seller_store_defaults")
          .select("pickup_method, delivery_enabled")
          .eq("store_id", seller.store_id)
          .maybeSingle()
          .returns<StoreDefaults>(),
        supabase
          .from("store_pickup_options")
          .select("id, label, description")
          .eq("store_id", seller.store_id)
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("label", { ascending: true })
          .returns<PickupOption[]>(),
        supabase
          .from("store_delivery_options")
          .select("id, name, price_amount")
          .eq("store_id", seller.store_id)
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true })
          .returns<DeliveryOption[]>(),
      ]);

      if (!isMounted) return;

      const firstError =
        customerResult.error ??
        inventoryResult.error ??
        equipmentResult.error ??
        processedPoultryResult.error ??
        defaultsResult.error ??
        pickupOptionsResult.error ??
        deliveryOptionsResult.error;

      if (firstError) {
        setLoadError(firstError.message);
        setIsLoading(false);
        return;
      }

      setCustomers(customerResult.data ?? []);
      setInventory(
        normalizeSellableInventoryRows({
          equipmentRows: equipmentResult.data ?? [],
          listingRows: inventoryResult.data ?? [],
          processedPoultryRows: processedPoultryResult.data ?? [],
        }),
      );
      setPickupMethod(
        defaultsResult.data?.pickup_method === "manual_options"
          ? "manual_options"
          : "notes",
      );
      setDeliveryEnabled(Boolean(defaultsResult.data?.delivery_enabled));
      setPickupOptions(pickupOptionsResult.data ?? []);
      setDeliveryOptions(deliveryOptionsResult.data ?? []);
      setIsLoading(false);
    }

    void loadData();

    return () => {
      isMounted = false;
    };
  }, [seller]);

  const usesConfiguredPickupOptions = pickupMethod === "manual_options";
  const canUseDelivery = deliveryEnabled && deliveryOptions.length > 0;
  const currentFulfillmentMethod =
    canUseDelivery || fulfillmentMethod === "pickup" ? fulfillmentMethod : "pickup";

  useEffect(() => {
    let isMounted = true;

    async function syncDeliveryAddressFromCustomer() {
      if (currentFulfillmentMethod !== "delivery") return;

      if (!seller || customerMode !== "existing" || !selectedCustomerId) {
        setDeliveryAddress(emptyDeliveryAddress());
        setDeliveryAddressCustomerId(null);
        setHasEditedDeliveryAddress(false);
        return;
      }

      if (
        hasEditedDeliveryAddress &&
        deliveryAddressCustomerId === selectedCustomerId
      ) {
        return;
      }

      const { data, error } = await supabase
        .from("seller_customer_detail")
        .select(
          "customer_id, email, first_name, last_name, phone, business_name, delivery_address_line1, delivery_address_line2, delivery_city, delivery_state, delivery_postal_code, delivery_country",
        )
        .eq("store_id", seller.store_id)
        .eq("customer_id", selectedCustomerId)
        .maybeSingle()
        .returns<CustomerDetailRow>();

      if (!isMounted || error) return;

      setDeliveryAddress(formatSavedDeliveryAddress(data));
      setDeliveryAddressCustomerId(selectedCustomerId);
      setHasEditedDeliveryAddress(false);
    }

    void syncDeliveryAddressFromCustomer();

    return () => {
      isMounted = false;
    };
  }, [
    currentFulfillmentMethod,
    customerMode,
    deliveryAddressCustomerId,
    hasEditedDeliveryAddress,
    selectedCustomerId,
    seller,
  ]);

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
  const subtotal = calculateOrderSubtotal(lines);
  const discountAmount = calculateDiscountAmount(
    subtotal,
    discountType,
    discountValue,
  );
  const discountedLines = distributeDiscount(lines, inventory, discountAmount);
  const taxAmount = 0;
  const selectedDeliveryOption = deliveryOptions.find(
    (option) => option.id === deliveryOptionId,
  );
  const deliveryFee = calculateDeliveryFee({
    deliveryFee: selectedDeliveryOption?.price_amount ?? 0,
    fulfillmentMethod: currentFulfillmentMethod,
  });
  const total = calculateFinalTotal({
    deliveryFee,
    discountAmount,
    subtotal,
    taxAmount,
  });

  function updateLine(lineId: string, updates: Partial<OrderLine>) {
    setLines((current) =>
      current.map((line) => (line.id === lineId ? { ...line, ...updates } : line)),
    );
    setValidationErrors([]);
    setSaveError(null);
  }

  function addInventoryItem(inventoryItemId: string) {
    const item = inventory.find((row) => row.id === inventoryItemId);

    if (!item) return;

    setLines((current) => {
      const existingLine = current.find(
        (line) =>
          line.type === "inventory" &&
          line.inventoryItemId === inventoryItemId &&
          line.inventoryItemType === item.itemType,
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
          inventoryItemType: item.itemType,
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

  function chooseFulfillmentMethod(method: FulfillmentMethod) {
    setFulfillmentMethod(method);
    setValidationErrors([]);
    setSaveError(null);

    if (method === "pickup") {
      setDeliveryOptionId("");
      return;
    }

    setPickupNote("");
    setPickupOptionId("");
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

    const errors = validateOrderForCreate({
      canUseDelivery,
      customerMode,
      deliveryAddress,
      deliveryOptionId,
      discountType,
      discountValue,
      fulfillmentMethod: currentFulfillmentMethod,
      lines,
      newCustomer,
      pickupOptionId,
      selectedCustomer,
      inventory,
      usesConfiguredPickupOptions,
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
        item_type:
          line.type === "custom" ? "custom" : getManualOrderPayloadItemType(line),
        inventory_item_id:
          line.type === "inventory" && line.inventoryItemType === "listing_inventory"
            ? line.inventoryItemId
            : undefined,
        item_id:
          line.type === "inventory" && line.inventoryItemType !== "listing_inventory"
            ? line.inventoryItemId
            : undefined,
        inventory_item_type:
          line.type === "inventory" ? line.inventoryItemType : undefined,
        custom_item_name:
          line.type === "custom" ? formatCustomItemPayloadName(line) : undefined,
        quantity: Number(line.quantity),
        unit_price: line.discountedUnitPrice,
        allow_inventory_override:
          line.type === "inventory" && line.inventoryItemType === "listing_inventory"
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
      p_pickup_note:
        currentFulfillmentMethod === "pickup" && !usesConfiguredPickupOptions
          ? pickupNote.trim() || null
          : null,
      p_pickup_option_id:
        currentFulfillmentMethod === "pickup" && usesConfiguredPickupOptions
          ? pickupOptionId
          : null,
      p_fulfillment_method: currentFulfillmentMethod,
      p_delivery_option_id:
        currentFulfillmentMethod === "delivery" ? deliveryOptionId : null,
      p_delivery_address_line1:
        currentFulfillmentMethod === "delivery"
          ? deliveryAddress.line1.trim()
          : null,
      p_delivery_address_line2:
        currentFulfillmentMethod === "delivery"
          ? deliveryAddress.line2.trim() || null
          : null,
      p_delivery_city:
        currentFulfillmentMethod === "delivery"
          ? deliveryAddress.city.trim()
          : null,
      p_delivery_state:
        currentFulfillmentMethod === "delivery"
          ? deliveryAddress.state.trim()
          : null,
      p_delivery_postal_code:
        currentFulfillmentMethod === "delivery"
          ? deliveryAddress.postalCode.trim()
          : null,
      p_delivery_country:
        currentFulfillmentMethod === "delivery"
          ? deliveryAddress.country.trim() || "US"
          : null,
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

        <OrderItemsEditor
          browseAddedInventoryItemId={browseAddedInventoryItemId}
          browseFilter={browseFilter}
          browseQuery={browseQuery}
          inventory={inventory}
          inventoryQuery={inventoryQuery}
          isBrowseOpen={isBrowseOpen}
          lines={lines}
          onAddCustomItem={addCustomItem}
          onAddInventoryItem={addInventoryItem}
          onBrowseInventoryItem={addBrowseInventoryItem}
          onBrowseFilterChange={setBrowseFilter}
          onBrowseOpenChange={setIsBrowseOpen}
          onBrowseQueryChange={setBrowseQuery}
          onInventoryQueryChange={setInventoryQuery}
          onRemoveLine={removeLine}
          onUpdateLine={updateLine}
        />

        <OrderFulfillmentSection
          buyerNotes={buyerNotes}
          canUseDelivery={canUseDelivery}
          currentFulfillmentMethod={currentFulfillmentMethod}
          deliveryAddress={deliveryAddress}
          deliveryOptions={deliveryOptions}
          deliveryOptionId={deliveryOptionId}
          pickupNote={pickupNote}
          pickupOptionId={pickupOptionId}
          pickupOptions={pickupOptions}
          usesConfiguredPickupOptions={usesConfiguredPickupOptions}
          onBuyerNotesChange={setBuyerNotes}
          onDeliveryAddressChange={(updates) =>
            updateDeliveryAddress(
              setDeliveryAddress,
              updates,
              () => setHasEditedDeliveryAddress(true),
            )
          }
          onDeliveryOptionChange={(optionId) => {
            setDeliveryOptionId(optionId);
            setValidationErrors([]);
            setSaveError(null);
          }}
          onFulfillmentMethodChange={chooseFulfillmentMethod}
          onPickupNoteChange={setPickupNote}
          onPickupOptionChange={(optionId) => {
            setPickupOptionId(optionId);
            setValidationErrors([]);
            setSaveError(null);
          }}
        />
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
            {currentFulfillmentMethod === "delivery" ? (
              <SummaryRow
                label="Delivery fee"
                value={formatCurrency(deliveryFee)}
              />
            ) : null}
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

function validateOrderForCreate({
  canUseDelivery,
  customerMode,
  deliveryAddress,
  deliveryOptionId,
  discountType,
  discountValue,
  fulfillmentMethod,
  inventory,
  lines,
  newCustomer,
  pickupOptionId,
  selectedCustomer,
  usesConfiguredPickupOptions,
}: {
  canUseDelivery: boolean;
  customerMode: CustomerMode;
  deliveryAddress: DeliveryAddress;
  deliveryOptionId: string;
  discountType: DiscountType;
  discountValue: string;
  fulfillmentMethod: FulfillmentMethod;
  inventory: InventorySearchRow[];
  lines: OrderLine[];
  newCustomer: {
    email: string;
    firstName: string;
    lastName: string;
  };
  pickupOptionId: string;
  selectedCustomer: CustomerRow | undefined;
  usesConfiguredPickupOptions: boolean;
}) {
  const errors: string[] = [];

  if (customerMode === "existing" && !selectedCustomer) {
    errors.push("Select a customer.");
  }

  if (customerMode === "new") {
    if (!newCustomer.firstName.trim()) errors.push("Add the customer name.");
    if (!isEmail(newCustomer.email)) errors.push("Add a valid customer email.");
  }

  return [
    ...errors,
    ...validateSharedOrderForm({
      canUseDelivery,
      deliveryAddress,
      deliveryOptionId,
      discountType,
      discountValue,
      fulfillmentMethod,
      inventory,
      lines,
      pickupOptionId,
      usesConfiguredPickupOptions,
    }),
  ];
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

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
