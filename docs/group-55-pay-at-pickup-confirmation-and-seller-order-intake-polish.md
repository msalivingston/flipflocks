# Group 55 — Pay-at-Pickup Confirmation and Seller Order Intake Polish

Group 55 makes the first public pay-at-pickup path feel complete after submission without adding payment collection, carts, fulfillment actions, or a checkout redesign.

## Existing Order Path Findings

- The public listing detail page submits to the existing `pay-at-pickup-order` Edge Function.
- The Edge Function returns a public-safe confirmation payload with order number, totals, payment method/status, and creation time.
- `create_pay_at_pickup_order(...)` already enqueues:
  - `buyer_order_received`
  - `seller_new_order_received`
- New orders are visible to sellers through `seller_order_management`.
- Storefront pay-at-pickup requests can be identified from `order_source = 'storefront'` and `payment_method = 'pay_at_pickup'`.

## Buyer Confirmation Behavior

After a successful submission, buyers now see a confirmation panel that says the pickup request was sent and that the seller will follow up with pickup details. The wording avoids promising automatic fulfillment.

The form submit button changes to `Request sent` and remains disabled after success so a buyer does not accidentally submit the same form again.

## Seller Order Intake Behavior

`/dashboard/orders` now reads from `seller_order_management` and shows a mobile-friendly list of orders with:

- order number
- order status
- storefront pickup request label
- buyer name and contact buttons
- item and quantity summary
- order total
- pickup status
- buyer notes

The first list is intentionally read-only. Fulfillment, cancellation, pickup assignment, and detail pages remain future groups.

## Deferred

- Order detail pages.
- Fulfillment actions.
- Pickup option assignment.
- Buyer-facing confirmation route.
- Multi-item cart.
- Payment collection.
- Email template rendering polish.
