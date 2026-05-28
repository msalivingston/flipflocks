# Group 57 — Seller Order Fulfillment Readiness Review

Group 57 reviewed the existing order lifecycle backend and added the smallest safe seller-facing order actions on the read-only order detail page.

## Files And Backend Objects Reviewed

- `orders`
- `order_items`
- `order_events`
- `seller_order_management`
- `seller_order_item_detail`
- `seller_mark_order_ready_for_pickup(...)`
- `seller_record_order_fulfillment(...)`
- `mark_order_fulfilled(...)`
- `cancel_order(...)`
- `reinstate_order(...)`
- `/dashboard/orders`
- `/dashboard/orders/[orderId]`

## Existing Lifecycle Model

Order status values:

- `pending`
- `open`
- `fulfilled`
- `canceled`

Payment status is independent:

- `unpaid`
- `pay_at_pickup`
- `paid`
- `canceled`
- `partially_refunded`
- `refunded`

Pickup readiness is not a separate order status. It is stored as `orders.ready_for_pickup_at`.

Line-level fulfillment is tracked with:

- `order_items.fulfilled_quantity`
- `order_items.restored_quantity`
- derived remaining quantity in `seller_order_item_detail`

## Safety Assessment

Existing trusted seller/admin RPCs already enforce ownership checks through `owns_store(...)` / admin checks. They lock orders and/or order items before writes and reject invalid transitions.

Safe for a narrow V1 UI:

- `seller_mark_order_ready_for_pickup(order_id, note)`
- `seller_record_order_fulfillment(order_id, items, note)`

Deferred from this group:

- cancellation, even though `cancel_order(...)` exists, because it restores inventory and requires a more deliberate confirmation/reason flow.
- reinstate, refunds, pickup option assignment, and partial fulfillment UI.

## Implemented V1 Workflow

On `/dashboard/orders/[orderId]`, eligible open orders now show:

- `Mark ready for pickup`
- `Mark picked up`

`Mark picked up` records fulfillment for all remaining line quantities. This keeps the first workflow practical for pay-at-pickup farm pickups while leaving partial fulfillment for later.

The page remains read-focused. No broad order management, cancellation, refunds, or messaging were added.
