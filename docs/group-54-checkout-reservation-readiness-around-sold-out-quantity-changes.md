# Group 54 — Checkout and Reservation Readiness Around Sold-Out / Quantity Changes

Group 54 adds the first buyer-facing quantity-aware pay-at-pickup request form to the public listing detail page. The change is intentionally narrow: it does not redesign checkout, add a cart, or introduce new lifecycle states.

## Existing Safety Architecture

- Public item reads use `public_storefront_item_detail`, including `quantity_available`, `buyer_availability_code`, and `can_checkout`.
- The `pay-at-pickup-order` Edge Function validates request shape, storefront availability, and a public checkout summary before creating an order.
- `get_public_checkout_summary(...)` rejects missing, unavailable, sold-out, or over-requested inventory before order creation.
- `create_pay_at_pickup_order(...)` is still the trusted write path. It locks inventory rows, verifies active storefront/listing/inventory relationships, rejects insufficient quantity, creates the order, and decrements `quantity_available`.

## Buyer UI Behavior

- Sold-out or non-checkoutable listings show a clear checkout pause message instead of an order form.
- Available listings show a single-item pay-at-pickup request form.
- Quantity is limited to the current public `quantity_available` value.
- Buyers cannot submit a quantity below 1 or above the currently displayed available quantity.
- If quantity changes between page load and submit, the Edge Function/RPC response is mapped to a plain buyer-facing message.

## Error Handling

Seller/internal terms are not shown to buyers. Stale quantity and unavailable-item responses become:

> That quantity is no longer available. Please refresh the listing and try again.

Developer details are logged to the browser console for debugging without exposing backend names or raw RPC errors in the public UI.

## Deferred

- Multi-item cart.
- Pickup option selection UI.
- Full checkout redesign.
- Payment collection.
- Buyer notifications.
- Manual sold-out lifecycle controls.
