"use client";

import {
  formatCurrency,
  formatInventoryLabel,
  formatPaymentMethod,
} from "../order-formatters";

export type PrintableOrder = {
  order_id: string;
  order_number: string;
  created_at: string;
  payment_method: string | null;
  payment_status: string | null;
  buyer_first_name_snapshot: string | null;
  buyer_last_name_snapshot: string | null;
  buyer_email_snapshot: string | null;
  buyer_phone_snapshot: string | null;
  buyer_address_line1_snapshot: string | null;
  buyer_address_line2_snapshot: string | null;
  buyer_city_snapshot: string | null;
  buyer_state_snapshot: string | null;
  buyer_postal_code_snapshot: string | null;
  buyer_country_snapshot: string | null;
  pickup_note: string | null;
  buyer_notes: string | null;
  subtotal_amount: number | null;
  tax_fee_label_snapshot: string | null;
  tax_fee_amount: number | null;
  total_amount: number | null;
  pickup_option_label_snapshot: string | null;
  fulfillment_method: "pickup" | "delivery" | string | null;
  delivery_option_name_snapshot: string | null;
  delivery_fee_amount: number | null;
};

export type PrintableOrderItem = {
  order_item_id: string;
  species_name_snapshot: string | null;
  breed_display_name_snapshot: string | null;
  inventory_type_snapshot: string | null;
  custom_inventory_label_snapshot: string | null;
  hatch_date_snapshot: string | null;
  age_at_sale_days_snapshot: number | null;
  order_item_source: string | null;
  custom_item_name_snapshot: string | null;
  product_type_snapshot: string | null;
  item_name_snapshot: string | null;
  item_category_snapshot: string | null;
  unit_price_snapshot: number | null;
  quantity: number;
  line_subtotal: number | null;
};

export type PrintableStoreLogo = {
  public_url: string;
  alt_text: string | null;
} | null;

const supabasePublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export function OrderPrintDocument({
  items,
  order,
  storeLogo,
}: {
  items: PrintableOrderItem[];
  order: PrintableOrder;
  storeLogo: PrintableStoreLogo;
}) {
  const address = formatBuyerAddress(order);
  const customerName = formatCustomerName(order);
  const isDeliveryOrder = order.fulfillment_method === "delivery";
  const deliveryOptionName = order.delivery_option_name_snapshot?.trim() ?? "";
  const deliveryFeeAmount = order.delivery_fee_amount ?? 0;
  const hasTaxFee = Boolean(order.tax_fee_amount);
  const hasDeliveryFee = isDeliveryOrder && deliveryFeeAmount > 0;
  const shouldShowBreakdown = hasTaxFee || hasDeliveryFee;
  const pickupOption = order.pickup_option_label_snapshot?.trim() ?? "";
  const pickupNote = order.pickup_note?.trim() ?? "";
  const customerNote = order.buyer_notes?.trim() ?? "";

  return (
    <div className="order-print-document">
      <section aria-label="Printable order sheet" className="order-print-sheet">
        <header className="order-print-header">
          <div className="order-print-title-group">
            {storeLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="order-print-logo"
                src={toPrintImageUrl(storeLogo.public_url)}
                alt={storeLogo.alt_text ?? "Seller logo"}
                loading="eager"
              />
            ) : null}
            <h1>Order {formatPrintOrderNumber(order.order_number)}</h1>
          </div>
          <time>{formatPrintDateTime(order.created_at)}</time>
        </header>

        <section className="order-print-customer-payment">
          <div className="order-print-customer">
            <p className="order-print-strong">{customerName}</p>
            {order.buyer_phone_snapshot ? <p>{order.buyer_phone_snapshot}</p> : null}
            {order.buyer_email_snapshot ? <p>{order.buyer_email_snapshot}</p> : null}
            {address ? <p className="order-print-address">{address}</p> : null}
          </div>
          <dl className="order-print-payment">
            <div>
              <dt>Payment method:</dt>
              <dd>{formatPaymentMethod(order.payment_method)}</dd>
            </div>
            <div>
              <dt>Payment status:</dt>
              <dd>{formatPrintPaymentStatus(order.payment_status)}</dd>
            </div>
          </dl>
        </section>

        <table className="order-print-items">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Qty</th>
              <th scope="col">Unit price</th>
              <th scope="col">Line total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.order_item_id}>
                <td>
                  <p className="order-print-item-name">
                    {getPrintableItemTitle(item)}
                  </p>
                  <p className="order-print-item-details">
                    {getPrintableItemDetails(item).join(" • ")}
                  </p>
                </td>
                <td>{item.quantity}</td>
                <td>{formatCurrency(item.unit_price_snapshot)}</td>
                <td>{formatCurrency(item.line_subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="order-print-lower">
          <dl className="order-print-totals">
            {shouldShowBreakdown ? (
              <>
                <div>
                  <dt>Subtotal</dt>
                  <dd>{formatCurrency(order.subtotal_amount)}</dd>
                </div>
                {hasTaxFee ? (
                  <div>
                    <dt>{order.tax_fee_label_snapshot ?? "Tax/fee"}</dt>
                    <dd>{formatCurrency(order.tax_fee_amount)}</dd>
                  </div>
                ) : null}
                {hasDeliveryFee ? (
                  <div>
                    <dt>Delivery fee</dt>
                    <dd>{formatCurrency(deliveryFeeAmount)}</dd>
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="order-print-total">
              <dt>Total</dt>
              <dd>{formatCurrency(order.total_amount)}</dd>
            </div>
          </dl>

          <section className="order-print-fulfillment">
            <h2>Pickup / Delivery</h2>
            <dl>
              <div>
                <dt>Method:</dt>
                <dd>{isDeliveryOrder ? "Delivery" : "Pickup"}</dd>
              </div>
              {isDeliveryOrder ? (
                <>
                  {deliveryOptionName ? (
                    <div>
                      <dt>Delivery option:</dt>
                      <dd>{deliveryOptionName}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Delivery fee:</dt>
                    <dd>{formatCurrency(deliveryFeeAmount)}</dd>
                  </div>
                  {address ? (
                    <div>
                      <dt>Delivery address:</dt>
                      <dd>{address}</dd>
                    </div>
                  ) : null}
                </>
              ) : pickupOption ? (
                <div>
                  <dt>Pickup option:</dt>
                  <dd>{pickupOption}</dd>
                </div>
              ) : pickupNote ? (
                <div>
                  <dt>Pickup note:</dt>
                  <dd>{pickupNote}</dd>
                </div>
              ) : null}
              {customerNote ? (
                <div>
                  <dt>Customer note:</dt>
                  <dd>{customerNote}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        </section>
      </section>
    </div>
  );
}

export function formatCustomerName(order: PrintableOrder) {
  return (
    [order.buyer_first_name_snapshot, order.buyer_last_name_snapshot]
      .filter(Boolean)
      .join(" ") || "Buyer"
  );
}

export function formatBuyerAddress(order: PrintableOrder) {
  const cityLine = [
    order.buyer_city_snapshot,
    order.buyer_state_snapshot,
    order.buyer_postal_code_snapshot,
  ]
    .filter(Boolean)
    .join(", ");
  const lines = [
    order.buyer_address_line1_snapshot,
    order.buyer_address_line2_snapshot,
    cityLine,
    order.buyer_country_snapshot,
  ].filter(Boolean);

  return lines.length > 0 ? lines.join("\n") : null;
}

function getPrintableItemTitle(item: PrintableOrderItem) {
  if (
    item.order_item_source === "equipment_inventory" ||
    item.order_item_source === "processed_poultry_inventory"
  ) {
    return item.item_name_snapshot || item.breed_display_name_snapshot;
  }

  return item.custom_item_name_snapshot || item.breed_display_name_snapshot;
}

function getPrintableItemDetails(item: PrintableOrderItem) {
  const isCustomItem = item.order_item_source === "custom";
  const isEquipmentItem = item.order_item_source === "equipment_inventory";
  const isProcessedPoultryItem =
    item.order_item_source === "processed_poultry_inventory";
  const label = formatInventoryLabel({
    custom_inventory_label: item.custom_inventory_label_snapshot,
    inventory_type: item.inventory_type_snapshot,
  });

  if (isCustomItem) return ["Custom item"];

  if (isEquipmentItem || isProcessedPoultryItem) {
    return [item.item_category_snapshot, item.custom_inventory_label_snapshot]
      .filter((detail): detail is string => Boolean(detail));
  }

  return [
    item.species_name_snapshot,
    formatSellerItemDetail(label),
    formatPrintAge(item.age_at_sale_days_snapshot),
    item.hatch_date_snapshot
      ? `Hatched ${formatShortDate(item.hatch_date_snapshot)}`
      : null,
  ].filter((detail): detail is string => Boolean(detail));
}

function formatSellerItemDetail(value: string | null) {
  const normalized = value?.trim();

  if (!normalized) return null;

  const lower = normalized.toLowerCase();

  if (lower === "female") return "Female";
  if (lower === "male") return "Male";
  if (lower === "straight run") return "Straight run";
  if (lower === "unknown") return "Unknown";

  return normalized;
}

function formatPrintAge(days: number | null | undefined) {
  if (days == null || days < 0) return null;
  if (days < 7) return `${days} day${days === 1 ? "" : "s"}`;

  const weeks = Math.floor(days / 7);

  return `${weeks} week${weeks === 1 ? "" : "s"}`;
}

function formatPrintOrderNumber(value: string) {
  return value.trim().startsWith("#") ? value : `#${value}`;
}

function formatPrintDateTime(value: string | null) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPrintPaymentStatus(value: string | null) {
  if (value === "pay_at_pickup") return "Unpaid";
  if (value === "paid") return "Paid";
  if (value === "refunded") return "Refunded";

  return value ? value.replaceAll("_", " ") : "Not set";
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function toPrintImageUrl(value: string | null | undefined) {
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("/storage/")) return `${supabasePublicUrl}${value}`;
  if (value.startsWith("/")) return value;

  return `${supabasePublicUrl}/storage/v1/object/public/${value}`;
}
