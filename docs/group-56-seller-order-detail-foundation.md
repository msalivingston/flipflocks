# Group 56 — Seller Order Detail Foundation

Group 56 adds a read-only seller order detail route so sellers can inspect a public pickup request after it appears in `/dashboard/orders`.

## Existing Read Path

- Order header/contact/payment/pickup details come from `seller_order_management`.
- Requested line items come from `seller_order_item_detail`.
- Both projections are seller-private and filter through existing ownership checks. The UI also filters by the current seller `store_id`.
- No new backend objects, RPCs, or migrations were needed.

## Route

- `/dashboard/orders/[orderId]`

## Detail Page Behavior

The detail page shows:

- order number and status
- storefront pickup request label
- buyer name, email, and phone
- order received date/time
- payment method/status
- pickup coordination status
- buyer notes and pickup notes
- requested bird line items
- quantities, unit prices, line totals, subtotal, fees, and total

The page is read-only. Fulfillment, pickup assignment, cancellation, communication actions, and messaging are intentionally deferred.

## Safety

If an order is missing, inaccessible, or belongs to another store, the page shows a safe not-found message instead of exposing internal details.

## Deferred

- Order fulfillment actions.
- Cancellation and inventory restoration actions.
- Pickup option assignment.
- Order detail communication history.
- Buyer-facing order status page.
