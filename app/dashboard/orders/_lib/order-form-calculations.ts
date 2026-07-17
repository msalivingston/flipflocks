import { formatInventorySearchLabel } from "./order-form-inventory";
import type {
  DeliveryAddress,
  DiscountType,
  FulfillmentMethod,
  InventorySearchRow,
  OrderLine,
} from "./order-form-types";

export const emptyLine = (): OrderLine => ({
  type: "inventory",
  id: crypto.randomUUID(),
  customItemName: "",
  customItemDescription: "",
  inventoryItemId: "",
  inventoryItemType: "",
  quantity: "1",
  search: "",
  unitPrice: "",
});

export const customLine = (): OrderLine => ({
  type: "custom",
  id: crypto.randomUUID(),
  customItemName: "",
  customItemDescription: "",
  inventoryItemId: "",
  inventoryItemType: "",
  quantity: "1",
  search: "",
  unitPrice: "",
});

export function calculateLineSubtotal(line: OrderLine) {
  return Number(line.quantity || 0) * Number(line.unitPrice || 0);
}

export function calculateOrderSubtotal(lines: OrderLine[]) {
  return lines
    .filter(isActiveLine)
    .reduce((total, line) => total + calculateLineSubtotal(line), 0);
}

export function calculateDeliveryFee({
  deliveryFee,
  fulfillmentMethod,
}: {
  deliveryFee: number;
  fulfillmentMethod: FulfillmentMethod;
}) {
  return fulfillmentMethod === "delivery" ? deliveryFee : 0;
}

export function calculateFinalTotal({
  deliveryFee,
  discountAmount,
  subtotal,
  taxAmount,
}: {
  deliveryFee: number;
  discountAmount: number;
  subtotal: number;
  taxAmount: number;
}) {
  return Math.max(subtotal - discountAmount + taxAmount + deliveryFee, 0);
}

export function isActiveLine(line: OrderLine) {
  if (line.type === "custom") {
    return Boolean(line.customItemName.trim() || line.unitPrice.trim());
  }

  return Boolean(line.inventoryItemId);
}

export function validateSharedOrderForm({
  allowInventoryOversell = false,
  allowMissingSavedInventory = false,
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
  allowInventoryOversell?: boolean;
  allowMissingSavedInventory?: boolean;
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
  const errors: string[] = [];
  const selectedLines = lines.filter(isActiveLine);

  if (selectedLines.length === 0) errors.push("Add at least one inventory item.");

  if (fulfillmentMethod === "pickup" && usesConfiguredPickupOptions) {
    if (!pickupOptionId) errors.push("Choose a pickup option.");
  }

  if (fulfillmentMethod === "delivery") {
    if (!canUseDelivery) {
      errors.push("Delivery is not enabled for this store.");
    }
    if (!deliveryOptionId) errors.push("Choose a delivery option.");
    if (!deliveryAddress.line1.trim()) {
      errors.push("Add the delivery street address.");
    }
    if (!deliveryAddress.city.trim()) errors.push("Add the delivery city.");
    if (!deliveryAddress.state.trim()) errors.push("Add the delivery state.");
    if (!deliveryAddress.postalCode.trim()) {
      errors.push("Add the delivery ZIP code.");
    }
  }

  selectedLines.forEach((line, index) => {
    const item = inventory.find((row) => row.id === line.inventoryItemId);
    const label = `Item ${index + 1}`;

    if (
      line.type === "inventory" &&
      !item &&
      !(allowMissingSavedInventory && line.orderItemId && line.inventoryItemId)
    ) {
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
    if (
      !allowInventoryOversell &&
      line.type === "inventory" &&
      item &&
      !item.allowInventoryOverride &&
      isPositiveWholeNumber(line.quantity) &&
      Number(line.quantity) > item.quantity_available
    ) {
      errors.push(`${label}: quantity exceeds available inventory.`);
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

export function distributeDiscount(
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

    const item = inventory.find((row) => row.id === line.inventoryItemId);

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

export function calculateDiscountAmount(
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

export function formatCustomItemPayloadName(line: OrderLine) {
  const name = line.customItemName.trim();
  const description = line.customItemDescription.trim();

  return description ? `${name} - ${description}` : name;
}

export function formatMoneyInput(value: number) {
  return value.toFixed(2);
}

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function isValidMoney(value: string) {
  return /^\d+(\.\d{1,2})?$/.test(value.trim());
}

export function isPositiveWholeNumber(value: string) {
  return /^[1-9]\d*$/.test(value.trim());
}
