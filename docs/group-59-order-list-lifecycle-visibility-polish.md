# Group 59 - Order List Lifecycle Visibility Polish

## Scope

Group 59 improves `/dashboard/orders` as a seller work queue. It does not add order actions, migrations, RPCs, notifications, or lifecycle changes.

## Data Source

The order list continues to read from `seller_order_management` scoped by the current seller store. The projection already exposes the fields needed for lifecycle readability:

- `order_status`
- `ready_for_pickup_at`
- `fulfilled_at`
- `canceled_at`
- `payment_method`
- `payment_status`
- `order_source`
- `created_at`

No backend changes were needed.

## Lifecycle Interpretation

Order lifecycle is derived in the frontend for display and filtering:

- Canceled: `order_status = 'canceled'`
- Completed: `order_status = 'fulfilled'`
- Ready for pickup: pending/open order with `ready_for_pickup_at`
- Needs attention: pending/open order without `ready_for_pickup_at`

These labels are seller-facing and avoid raw database terms in the order list.

## UX Changes

The order list now defaults to `Needs attention` so completed and canceled records do not clutter the active work queue. Filter chips show counts for:

- Needs attention
- Ready for pickup
- Completed
- Canceled
- All

Each order card shows a clear lifecycle badge and keeps `View order` as the place for fulfillment and cancellation actions.

## Deferred

- No bulk actions
- No list-level fulfillment/cancellation buttons
- No backend lifecycle changes
- No archive/delete behavior for orders
