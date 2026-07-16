"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../../../_components/seller-context";
import {
  ErrorState,
  LoadingState,
  SellerCard,
  SellerPageHeader,
} from "../../../_components/seller-ui";
import { OrderFulfillmentSection } from "../../_components/order-fulfillment-section";
import { OrderItemsEditor } from "../../_components/order-items-editor";
import {
  calculateDeliveryFee,
  calculateDiscountAmount,
  calculateFinalTotal,
  calculateOrderSubtotal,
  customLine,
  formatMoneyInput,
} from "../../_lib/order-form-calculations";
import {
  emptyDeliveryAddress,
  updateDeliveryAddress,
} from "../../_lib/order-form-fulfillment";
import {
  formatInventorySearchLabel,
  normalizeSellableInventoryRows,
} from "../../_lib/order-form-inventory";
import {
  mapEditableOrderItemsToLines,
  type EditableOrderItemRow,
  type OrderItemMappingGap,
} from "../../_lib/order-edit-mapping";
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
} from "../../_lib/order-form-types";
import {
  formatCurrency,
  formatPaymentMethod,
} from "../../order-formatters";

type CustomerRow = {
  customer_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  business_name: string | null;
};

type EditableOrderRow = {
  id: string;
  customer_id: string | null;
  order_number: string;
  order_status: string;
  payment_method: string | null;
  payment_status: string | null;
  fulfilled_at: string | null;
  canceled_at: string | null;
  buyer_email_snapshot: string | null;
  buyer_first_name_snapshot: string | null;
  buyer_last_name_snapshot: string | null;
  buyer_phone_snapshot: string | null;
  buyer_address_line1_snapshot: string | null;
  buyer_address_line2_snapshot: string | null;
  buyer_city_snapshot: string | null;
  buyer_state_snapshot: string | null;
  buyer_postal_code_snapshot: string | null;
  buyer_country_snapshot: string | null;
  buyer_notes: string | null;
  pickup_note: string | null;
  pickup_option_id: string | null;
  pickup_option_label_snapshot: string | null;
  fulfillment_method: "pickup" | "delivery" | string | null;
  delivery_option_name_snapshot: string | null;
  delivery_fee_amount: number | null;
  subtotal_amount: number | null;
  tax_fee_amount: number | null;
  total_amount: number | null;
};

type EditOrderState = {
  customers: CustomerRow[];
  deliveryOptions: DeliveryOption[];
  inventory: InventorySearchRow[];
  mappingGaps: OrderItemMappingGap[];
  order: EditableOrderRow | null;
  pickupMethod: PickupMethod;
  pickupOptions: PickupOption[];
};

const savedDeliveryOptionId = "__saved_delivery_option__";

export function EditOrder({ orderId }: { orderId: string }) {
  const { seller } = useSellerContext();
  const [data, setData] = useState<EditOrderState>({
    customers: [],
    deliveryOptions: [],
    inventory: [],
    mappingGaps: [],
    order: null,
    pickupMethod: "notes",
    pickupOptions: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [isChangingCustomer, setIsChangingCustomer] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [isBrowseOpen, setIsBrowseOpen] = useState(false);
  const [browseFilter, setBrowseFilter] = useState<BrowseInventoryFilter>("all");
  const [browseQuery, setBrowseQuery] = useState("");
  const [browseAddedInventoryItemId, setBrowseAddedInventoryItemId] = useState<
    string | null
  >(null);
  const [discountType, setDiscountType] = useState<DiscountType>("fixed");
  const [discountValue, setDiscountValue] = useState("");
  const [fulfillmentMethod, setFulfillmentMethod] =
    useState<FulfillmentMethod>("pickup");
  const [pickupMode, setPickupMode] = useState<PickupMethod>("notes");
  const [pickupNote, setPickupNote] = useState("");
  const [pickupOptionId, setPickupOptionId] = useState("");
  const [deliveryOptionId, setDeliveryOptionId] = useState("");
  const [deliveryAddress, setDeliveryAddress] =
    useState<DeliveryAddress>(emptyDeliveryAddress);
  const [buyerNotes, setBuyerNotes] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadOrder() {
      if (!seller) return;

      setIsLoading(true);
      setLoadError(null);

      const [
        orderResult,
        itemResult,
        customerResult,
        listingResult,
        equipmentResult,
        processedPoultryResult,
        defaultsResult,
        pickupOptionsResult,
        deliveryOptionsResult,
      ] = await Promise.all([
        supabase
          .from("orders")
          .select(
            "id, customer_id, order_number, order_status, payment_method, payment_status, fulfilled_at, canceled_at, buyer_email_snapshot, buyer_first_name_snapshot, buyer_last_name_snapshot, buyer_phone_snapshot, buyer_address_line1_snapshot, buyer_address_line2_snapshot, buyer_city_snapshot, buyer_state_snapshot, buyer_postal_code_snapshot, buyer_country_snapshot, buyer_notes, pickup_note, pickup_option_id, pickup_option_label_snapshot, fulfillment_method, delivery_option_name_snapshot, delivery_fee_amount, subtotal_amount, tax_fee_amount, total_amount",
          )
          .eq("store_id", seller.store_id)
          .eq("id", orderId)
          .maybeSingle<EditableOrderRow>(),
        supabase
          .from("seller_order_item_detail")
          .select(
            "order_item_id, inventory_item_id, equipment_inventory_item_id, processed_poultry_inventory_item_id, breed_display_name_snapshot, inventory_type_snapshot, custom_inventory_label_snapshot, order_item_source, custom_item_name_snapshot, product_type_snapshot, item_name_snapshot, item_category_snapshot, unit_price_snapshot, quantity",
          )
          .eq("store_id", seller.store_id)
          .eq("order_id", orderId)
          .order("created_at", { ascending: true })
          .returns<EditableOrderItemRow[]>(),
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
        orderResult.error ??
        itemResult.error ??
        customerResult.error ??
        listingResult.error ??
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

      const order = orderResult.data ?? null;
      const mappedItems = mapEditableOrderItemsToLines(itemResult.data ?? []);
      const pickupMethod =
        order?.pickup_option_id ||
        defaultsResult.data?.pickup_method === "manual_options"
          ? "manual_options"
          : "notes";
      const currentFulfillmentMethod =
        order?.fulfillment_method === "delivery" ? "delivery" : "pickup";
      const nextPickupOptions = includeSavedPickupOption(
        pickupOptionsResult.data ?? [],
        order,
      );
      const nextDeliveryOptions = includeSavedDeliveryOption(
        deliveryOptionsResult.data ?? [],
        order,
      );

      setData({
        customers: customerResult.data ?? [],
        deliveryOptions: nextDeliveryOptions,
        inventory: normalizeSellableInventoryRows({
          equipmentRows: equipmentResult.data ?? [],
          listingRows: listingResult.data ?? [],
          processedPoultryRows: processedPoultryResult.data ?? [],
        }),
        mappingGaps: mappedItems.gaps,
        order,
        pickupMethod,
        pickupOptions: nextPickupOptions,
      });
      setSelectedCustomerId(order?.customer_id ?? "");
      setLines(mappedItems.lines);
      setFulfillmentMethod(currentFulfillmentMethod);
      setPickupMode(pickupMethod);
      setPickupNote(order?.pickup_note ?? "");
      setPickupOptionId(order?.pickup_option_id ?? "");
      setDeliveryOptionId(
        currentFulfillmentMethod === "delivery" &&
          order?.delivery_option_name_snapshot
          ? savedDeliveryOptionId
          : "",
      );
      setDeliveryAddress(formatOrderDeliveryAddress(order));
      setBuyerNotes(order?.buyer_notes ?? "");
      setIsLoading(false);
    }

    void loadOrder();

    return () => {
      isMounted = false;
    };
  }, [orderId, seller]);

  useEffect(() => {
    if (!isBrowseOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsBrowseOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isBrowseOpen]);

  const order = data.order;
  const isEditable = order ? canEditOrder(order) : false;
  const selectedCustomer = data.customers.find(
    (customer) => customer.customer_id === selectedCustomerId,
  );
  const displayedCustomer = selectedCustomer
    ? {
        email: selectedCustomer.email,
        name: formatCustomerName(selectedCustomer),
        phone: selectedCustomer.phone,
      }
    : {
        email: order?.buyer_email_snapshot ?? "",
        name: order ? formatOrderCustomerName(order) : "Customer",
        phone: order?.buyer_phone_snapshot ?? null,
      };
  const visibleCustomers = isChangingCustomer
    ? filterCustomers(data.customers, customerQuery).slice(0, 6)
    : [];
  const usesConfiguredPickupOptions =
    fulfillmentMethod === "pickup" && pickupMode === "manual_options";
  const selectedDeliveryOption = data.deliveryOptions.find(
    (option) => option.id === deliveryOptionId,
  );
  const subtotal = calculateOrderSubtotal(lines);
  const discountAmount = calculateDiscountAmount(
    subtotal,
    discountType,
    discountValue,
  );
  const taxAmount = order?.tax_fee_amount ?? 0;
  const deliveryFee = calculateDeliveryFee({
    deliveryFee:
      selectedDeliveryOption?.price_amount ?? order?.delivery_fee_amount ?? 0,
    fulfillmentMethod,
  });
  const total = calculateFinalTotal({
    deliveryFee,
    discountAmount,
    subtotal,
    taxAmount,
  });
  const pageTitle = order
    ? `Edit Order #${formatOrderNumber(order.order_number)}`
    : "Edit Order";

  function updateLine(lineId: string, updates: Partial<OrderLine>) {
    setLines((current) =>
      current.map((line) => (line.id === lineId ? { ...line, ...updates } : line)),
    );
  }

  function addInventoryItem(inventoryItemId: string) {
    const item = data.inventory.find((row) => row.id === inventoryItemId);

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
          type: "inventory",
          id: crypto.randomUUID(),
          customItemName: "",
          customItemDescription: "",
          inventoryItemId,
          inventoryItemType: item.itemType,
          quantity: "1",
          search: formatInventorySearchLabel(item),
          unitPrice: formatMoneyInput(item.effective_unit_price ?? 0),
        },
      ];
    });
    setInventoryQuery("");
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
  }

  function removeLine(lineId: string) {
    setLines((current) => current.filter((line) => line.id !== lineId));
  }

  function chooseFulfillmentMethod(method: FulfillmentMethod) {
    setFulfillmentMethod(method);

    if (method === "pickup") {
      setDeliveryOptionId("");
      setPickupMode(data.pickupMethod);
      return;
    }

    setPickupNote("");
    setPickupOptionId("");
  }

  function openCustomerSearch() {
    setCustomerQuery("");
    setIsChangingCustomer(true);
  }

  function cancelCustomerSearch() {
    setCustomerQuery("");
    setIsChangingCustomer(false);
  }

  function selectCustomer(customerId: string) {
    setSelectedCustomerId(customerId);
    setCustomerQuery("");
    setIsChangingCustomer(false);
  }

  if (isLoading) {
    return (
      <>
        <SellerPageHeader title="Edit Order" description="Loading order." />
        <div className="mx-auto w-full max-w-7xl px-5 py-4 sm:px-7">
          <LoadingState label="Loading order" />
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <SellerPageHeader title="Edit Order" description="Review order details." />
        <div className="mx-auto w-full max-w-7xl px-5 py-4 sm:px-7">
          <ErrorState
            title="Order could not load"
            message="Please refresh the page or return to the order."
            action={<BackToOrderLink orderId={orderId} />}
          />
        </div>
      </>
    );
  }

  if (!order) {
    return (
      <>
        <SellerPageHeader title="Order not found" description="Review order details." />
        <div className="mx-auto w-full max-w-7xl px-5 py-4 sm:px-7">
          <SellerCard className="p-5">
            <h2 className="text-lg font-bold text-stone-950">Order not found</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              This order may not exist or may not belong to this store.
            </p>
            <div className="mt-4">
              <Link className="seller-secondary-button" href="/dashboard/orders">
                Back to orders
              </Link>
            </div>
          </SellerCard>
        </div>
      </>
    );
  }

  if (!isEditable) {
    return (
      <>
        <SellerPageHeader
          title={pageTitle}
          description="This order cannot be edited in the current workflow."
        />
        <div className="mx-auto w-full max-w-7xl px-5 py-4 sm:px-7">
          <SellerCard className="p-5">
            <h2 className="text-lg font-bold text-stone-950">
              This order cannot be edited
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Fulfilled orders are not editable in V1, and canceled orders must be
              restored before editing.
            </p>
            <div className="mt-4">
              <BackToOrderLink orderId={orderId} />
            </div>
          </SellerCard>
        </div>
      </>
    );
  }

  return (
    <>
      <SellerPageHeader
        eyebrow="Orders"
        title={pageTitle}
        description="Update this order's customer, items, and fulfillment details."
      />
      <div className="mx-auto w-full max-w-7xl px-5 py-4 sm:px-7">
        <div className="mb-3">
          <BackToOrderLink orderId={orderId} />
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
          <div className="grid min-w-0 gap-3">
            <SellerCard className="min-w-0 p-3">
              <h2 className="text-lg font-semibold text-stone-950">Customer</h2>
              <div className="mt-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-bold text-stone-950">
                      {displayedCustomer.name}
                    </p>
                    <p className="truncate">{displayedCustomer.email}</p>
                    {displayedCustomer.phone ? (
                      <p>{displayedCustomer.phone}</p>
                    ) : (
                      <p>No phone</p>
                    )}
                  </div>
                  <button
                    className="text-left text-xs font-bold text-emerald-800 transition hover:text-emerald-950"
                    type="button"
                    onClick={openCustomerSearch}
                  >
                    Change customer
                  </button>
                </div>
                {isChangingCustomer ? (
                  <div className="mt-3 grid gap-2">
                    <label
                      className="sr-only"
                      htmlFor="edit-order-customer-search"
                    >
                      Search customers
                    </label>
                    <input
                      className="seller-form-field seller-compact-field"
                      id="edit-order-customer-search"
                      placeholder="Search by name, email, or phone"
                      type="text"
                      value={customerQuery}
                      onChange={(event) => setCustomerQuery(event.target.value)}
                    />
                    {customerQuery.trim().length >= 2 ? (
                      <div className="overflow-hidden rounded-md border border-stone-200 bg-white">
                        {visibleCustomers.length > 0 ? (
                          visibleCustomers.map((customer) => (
                            <button
                              className="flex min-h-10 w-full items-center justify-between gap-3 border-b border-stone-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-emerald-50 focus:bg-emerald-50 focus:outline-none"
                              key={customer.customer_id}
                              type="button"
                              onClick={() => selectCustomer(customer.customer_id)}
                            >
                              <span className="min-w-0 truncate">
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
                          <p className="px-3 py-2 text-sm text-stone-600">
                            No customers match.
                          </p>
                        )}
                      </div>
                    ) : null}
                    <button
                      className="justify-self-start text-xs font-bold text-stone-600 transition hover:text-stone-950"
                      type="button"
                      onClick={cancelCustomerSearch}
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
              </div>
            </SellerCard>

            <OrderItemsEditor
              allowInventoryOversell
              browseAddedInventoryItemId={browseAddedInventoryItemId}
              browseFilter={browseFilter}
              browseQuery={browseQuery}
              inventory={data.inventory}
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
              canUseDelivery={data.deliveryOptions.length > 0}
              currentFulfillmentMethod={fulfillmentMethod}
              deliveryAddress={deliveryAddress}
              deliveryOptions={data.deliveryOptions}
              deliveryOptionId={deliveryOptionId}
              pickupNote={pickupNote}
              pickupOptionId={pickupOptionId}
              pickupOptions={data.pickupOptions}
              usesConfiguredPickupOptions={usesConfiguredPickupOptions}
              onBuyerNotesChange={setBuyerNotes}
              onDeliveryAddressChange={(updates) =>
                updateDeliveryAddress(setDeliveryAddress, updates, () => undefined)
              }
              onDeliveryOptionChange={setDeliveryOptionId}
              onFulfillmentMethodChange={chooseFulfillmentMethod}
              onPickupNoteChange={setPickupNote}
              onPickupOptionChange={setPickupOptionId}
            />

            {data.mappingGaps.length > 0 ? (
              <SellerCard className="border-amber-200 bg-amber-50 p-3">
                <h2 className="text-sm font-bold text-amber-950">
                  Some lines need review
                </h2>
                <ul className="mt-2 grid gap-1 text-sm text-amber-800">
                  {data.mappingGaps.map((gap) => (
                    <li key={gap.orderItemId}>
                      {gap.orderItemId}: {gap.reason}
                    </li>
                  ))}
                </ul>
              </SellerCard>
            ) : null}
          </div>

          <SellerCard className="p-3 lg:sticky lg:top-3">
            <h2 className="text-lg font-semibold text-stone-950">Order Summary</h2>
            <div className="mt-3 grid gap-3">
              <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm">
                <p className="text-xs font-bold uppercase text-stone-500">
                  Payment
                </p>
                <p className="mt-1 font-semibold text-stone-950">
                  {formatPaymentMethod(order.payment_method)} -{" "}
                  {formatPaymentStatus(order.payment_status)}
                </p>
              </div>

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
                    onChange={(event) => setDiscountValue(event.target.value)}
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
                {fulfillmentMethod === "delivery" ? (
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

              <div className="rounded-lg border border-stone-200 bg-[#fbfaf6] px-3 py-2 text-xs text-stone-600">
                Saved total: {formatCurrency(order.total_amount ?? 0)}
              </div>

              <button
                className="inline-flex min-h-10 cursor-not-allowed items-center justify-center rounded-md bg-stone-300 px-5 text-sm font-semibold text-stone-600"
                disabled
                type="button"
              >
                Save changes
              </button>
              <p className="text-xs leading-5 text-stone-500">
                Saving will be enabled in the next phase.
              </p>
              <Link className="seller-secondary-button" href={`/dashboard/orders/${orderId}`}>
                Cancel
              </Link>
            </div>
          </SellerCard>
        </div>
      </div>
    </>
  );
}

function canEditOrder(order: EditableOrderRow) {
  return (
    !order.canceled_at &&
    !order.fulfilled_at &&
    order.order_status !== "canceled" &&
    order.order_status !== "fulfilled"
  );
}

function includeSavedPickupOption(
  options: PickupOption[],
  order: EditableOrderRow | null,
) {
  if (!order?.pickup_option_id || !order.pickup_option_label_snapshot) {
    return options;
  }

  if (options.some((option) => option.id === order.pickup_option_id)) {
    return options;
  }

  return [
    {
      id: order.pickup_option_id,
      label: order.pickup_option_label_snapshot,
      description: null,
    },
    ...options,
  ];
}

function includeSavedDeliveryOption(
  options: DeliveryOption[],
  order: EditableOrderRow | null,
) {
  if (order?.fulfillment_method !== "delivery") return options;
  if (!order.delivery_option_name_snapshot) return options;

  return [
    {
      id: savedDeliveryOptionId,
      name: order.delivery_option_name_snapshot,
      price_amount: order.delivery_fee_amount ?? 0,
    },
    ...options.filter((option) => option.id !== savedDeliveryOptionId),
  ];
}

function formatOrderDeliveryAddress(order: EditableOrderRow | null): DeliveryAddress {
  if (!order) return emptyDeliveryAddress();

  return {
    line1: order.buyer_address_line1_snapshot ?? "",
    line2: order.buyer_address_line2_snapshot ?? "",
    city: order.buyer_city_snapshot ?? "",
    state: order.buyer_state_snapshot ?? "",
    postalCode: order.buyer_postal_code_snapshot ?? "",
    country: order.buyer_country_snapshot ?? "US",
  };
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

function filterCustomers(customers: CustomerRow[], query: string) {
  const normalized = query.trim().toLowerCase();

  if (!normalized) return [];

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

function formatCustomerName(customer: CustomerRow) {
  return (
    [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
    "Customer"
  );
}

function formatOrderCustomerName(order: EditableOrderRow) {
  return (
    [order.buyer_first_name_snapshot, order.buyer_last_name_snapshot]
      .filter(Boolean)
      .join(" ") || "Customer"
  );
}

function formatOrderNumber(value: string) {
  return value.trim().startsWith("#") ? value.trim().slice(1) : value.trim();
}

function formatPaymentStatus(value: string | null) {
  if (value === "pay_at_pickup") return "Unpaid";
  if (value === "paid") return "Paid";
  if (value === "refunded") return "Refunded";
  if (value === "canceled") return "Canceled";

  return value ? value.replaceAll("_", " ") : "Not set";
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-stone-600">{label}</dt>
      <dd className="font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

function BackToOrderLink({ orderId }: { orderId: string }) {
  return (
    <Link className="seller-secondary-button" href={`/dashboard/orders/${orderId}`}>
      Back to order
    </Link>
  );
}
