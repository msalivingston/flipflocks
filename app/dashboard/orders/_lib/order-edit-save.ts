import {
  distributeDiscount,
  formatCustomItemPayloadName,
  validateSharedOrderForm,
} from "./order-form-calculations";
import { getManualOrderPayloadItemType } from "./order-form-inventory";
import type {
  DeliveryAddress,
  DeliveryOption,
  DiscountType,
  FulfillmentMethod,
  InventorySearchRow,
  OrderLine,
} from "./order-form-types";

export type InventoryAdjustmentControl = {
  checked: boolean;
  label: string;
  lineId: string;
  lineName: string;
  removed: boolean;
};

export type EditOrderCustomerSnapshot = {
  customerId: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  businessName?: string | null;
};

export type EditOrderPayloadOptions = {
  buyerNotes: string;
  customer: EditOrderCustomerSnapshot;
  deliveryAddress: DeliveryAddress;
  deliveryFee: number;
  deliveryOption: DeliveryOption | undefined;
  deliveryOptionId: string;
  discountAmount: number;
  fulfillmentMethod: FulfillmentMethod;
  inventory: InventorySearchRow[];
  inventoryAdjustmentChoices: Record<string, boolean>;
  lines: OrderLine[];
  orderId: string;
  originalLines: OrderLine[];
  pickupNote: string;
  pickupOptionId: string;
  savedDeliveryOptionId: string;
  taxAmount: number;
};

export type EditOrderRpcPayload = {
  p_order_id: string;
  p_items: Array<Record<string, unknown>>;
  p_removed_items: Array<Record<string, unknown>>;
  p_customer_id: string | null;
  p_customer_email: string | null;
  p_customer_first_name: string | null;
  p_customer_last_name: string | null;
  p_customer_phone: string | null;
  p_business_name: string | null;
  p_buyer_notes: string | null;
  p_fulfillment_method: FulfillmentMethod;
  p_pickup_option_id: string | null;
  p_pickup_note: string | null;
  p_delivery_option_id: string | null;
  p_delivery_option_name_snapshot: string | null;
  p_delivery_fee_amount: number;
  p_delivery_address_line1: string | null;
  p_delivery_address_line2: string | null;
  p_delivery_city: string | null;
  p_delivery_state: string | null;
  p_delivery_postal_code: string | null;
  p_delivery_country: string | null;
  p_tax_fee_amount: number;
};

export function buildEditOrderPayload(
  options: EditOrderPayloadOptions,
): EditOrderRpcPayload {
  const discountedLines = distributeDiscount(
    options.lines,
    options.inventory,
    options.discountAmount,
  );

  return {
    p_order_id: options.orderId,
    p_items: discountedLines.map((line) => ({
      order_item_id: line.orderItemId ?? null,
      change_inventory: getLineInventoryChoice({
        choices: options.inventoryAdjustmentChoices,
        line,
        originalLines: options.originalLines,
      }),
      item_type:
        line.type === "custom" ? "custom" : getManualOrderPayloadItemType(line),
      inventory_item_id:
        line.type === "inventory" &&
        line.inventoryItemType === "listing_inventory"
          ? line.inventoryItemId
          : null,
      item_id:
        line.type === "inventory" &&
        line.inventoryItemType !== "listing_inventory"
          ? line.inventoryItemId
          : null,
      inventory_item_type:
        line.type === "inventory" ? line.inventoryItemType : null,
      custom_item_name:
        line.type === "custom" ? formatCustomItemPayloadName(line) : null,
      quantity: Number(line.quantity),
      unit_price: line.discountedUnitPrice,
    })),
    p_removed_items: getRemovedInventoryLines(
      options.originalLines,
      options.lines,
    ).map((line) => ({
      order_item_id: line.orderItemId,
      change_inventory:
        options.inventoryAdjustmentChoices[getInventoryChoiceKey(line)] ?? true,
    })),
    p_customer_id: options.customer.customerId,
    p_customer_email: trimOrNull(options.customer.email),
    p_customer_first_name: trimOrNull(options.customer.firstName),
    p_customer_last_name: trimOrNull(options.customer.lastName),
    p_customer_phone: trimOrNull(options.customer.phone),
    p_business_name: trimOrNull(options.customer.businessName ?? null),
    p_buyer_notes: trimOrNull(options.buyerNotes),
    p_fulfillment_method: options.fulfillmentMethod,
    p_pickup_option_id:
      options.fulfillmentMethod === "pickup" ? trimOrNull(options.pickupOptionId) : null,
    p_pickup_note:
      options.fulfillmentMethod === "pickup" && !options.pickupOptionId
        ? trimOrNull(options.pickupNote)
        : null,
    p_delivery_option_id:
      options.fulfillmentMethod === "delivery" &&
      options.deliveryOptionId !== options.savedDeliveryOptionId
        ? trimOrNull(options.deliveryOptionId)
        : null,
    p_delivery_option_name_snapshot:
      options.fulfillmentMethod === "delivery"
        ? trimOrNull(options.deliveryOption?.name ?? null)
        : null,
    p_delivery_fee_amount:
      options.fulfillmentMethod === "delivery" ? options.deliveryFee : 0,
    p_delivery_address_line1:
      options.fulfillmentMethod === "delivery"
        ? trimOrNull(options.deliveryAddress.line1)
        : null,
    p_delivery_address_line2:
      options.fulfillmentMethod === "delivery"
        ? trimOrNull(options.deliveryAddress.line2)
        : null,
    p_delivery_city:
      options.fulfillmentMethod === "delivery"
        ? trimOrNull(options.deliveryAddress.city)
        : null,
    p_delivery_state:
      options.fulfillmentMethod === "delivery"
        ? trimOrNull(options.deliveryAddress.state)
        : null,
    p_delivery_postal_code:
      options.fulfillmentMethod === "delivery"
        ? trimOrNull(options.deliveryAddress.postalCode)
        : null,
    p_delivery_country:
      options.fulfillmentMethod === "delivery"
        ? trimOrNull(options.deliveryAddress.country) ?? "US"
        : null,
    p_tax_fee_amount: options.taxAmount,
  };
}

export function validateEditOrderForm({
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
}: {
  canUseDelivery: boolean;
  deliveryAddress: DeliveryAddress;
  deliveryOptionId: string;
  discountType: DiscountType;
  discountValue: string;
  fulfillmentMethod: FulfillmentMethod;
  inventory: InventorySearchRow[];
  lines: OrderLine[];
  pickupOptionId: string;
  usesConfiguredPickupOptions: boolean;
}) {
  return validateSharedOrderForm({
    allowInventoryOversell: true,
    allowMissingSavedInventory: true,
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
  });
}

export function buildInventoryAdjustmentControls({
  choices,
  originalLines,
  revisedLines,
}: {
  choices: Record<string, boolean>;
  originalLines: OrderLine[];
  revisedLines: OrderLine[];
}): InventoryAdjustmentControl[] {
  const controls: InventoryAdjustmentControl[] = [];
  const originalByOrderItemId = new Map(
    originalLines
      .filter((line) => line.orderItemId)
      .map((line) => [line.orderItemId, line]),
  );
  const revisedOrderItemIds = new Set(
    revisedLines.map((line) => line.orderItemId).filter(Boolean),
  );

  revisedLines.forEach((line) => {
    if (line.type !== "inventory" || !line.inventoryItemId) return;

    const key = getInventoryChoiceKey(line);
    const originalLine = line.orderItemId
      ? originalByOrderItemId.get(line.orderItemId)
      : undefined;

    if (!originalLine) {
      controls.push({
        checked: choices[key] ?? true,
        label: "Change inventory",
        lineId: line.id,
        lineName: formatLineName(line),
        removed: false,
      });
      return;
    }

    const delta = Number(line.quantity || 0) - Number(originalLine.quantity || 0);

    if (delta === 0) return;

    controls.push({
      checked: choices[key] ?? true,
      label: delta > 0 ? "Change inventory" : "Return difference to inventory",
      lineId: line.id,
      lineName: formatLineName(line),
      removed: false,
    });
  });

  originalLines.forEach((line) => {
    if (
      line.type !== "inventory" ||
      !line.inventoryItemId ||
      !line.orderItemId ||
      revisedOrderItemIds.has(line.orderItemId)
    ) {
      return;
    }

    const key = getInventoryChoiceKey(line);

    controls.push({
      checked: choices[key] ?? true,
      label: "Return quantity to inventory",
      lineId: line.id,
      lineName: formatLineName(line),
      removed: true,
    });
  });

  return controls;
}

export function getInventoryChoiceKey(line: OrderLine) {
  return line.orderItemId ?? line.id;
}

function getRemovedInventoryLines(
  originalLines: OrderLine[],
  revisedLines: OrderLine[],
) {
  const revisedByOrderItemId = new Set(
    revisedLines.map((line) => line.orderItemId).filter(Boolean),
  );

  return originalLines.filter(
    (line) =>
      line.type === "inventory" &&
      line.inventoryItemId &&
      line.orderItemId &&
      !revisedByOrderItemId.has(line.orderItemId),
  );
}

function getLineInventoryChoice({
  choices,
  line,
  originalLines,
}: {
  choices: Record<string, boolean>;
  line: OrderLine;
  originalLines: OrderLine[];
}) {
  if (line.type !== "inventory" || !line.inventoryItemId) return false;

  if (!line.orderItemId) {
    return choices[getInventoryChoiceKey(line)] ?? true;
  }

  const originalLine = originalLines.find(
    (candidate) => candidate.orderItemId === line.orderItemId,
  );

  if (!originalLine) return choices[getInventoryChoiceKey(line)] ?? true;
  if (Number(originalLine.quantity || 0) === Number(line.quantity || 0)) {
    return false;
  }

  return choices[getInventoryChoiceKey(line)] ?? true;
}

function formatLineName(line: OrderLine) {
  if (line.type === "custom") {
    return line.customItemName.trim() || line.savedItemName || "Custom item";
  }

  return line.savedItemName || line.search.split(" - ")[0] || "Inventory item";
}

function trimOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}
