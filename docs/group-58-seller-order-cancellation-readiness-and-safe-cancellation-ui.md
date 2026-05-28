# Group 58 — Seller Order Cancellation Readiness and Safe Cancellation UI

Group 58 reviewed the existing cancellation backend and added a narrow seller-facing cancellation flow for eligible pay-at-pickup orders.

## Backend Objects Reviewed

- `orders`
- `order_items`
- `order_events`
- `cancel_order(...)`
- `seller_order_management`
- `seller_order_item_detail`
- order notification enqueue behavior
- `/dashboard/orders/[orderId]`

## Cancellation Model

`cancel_order(order_id, canceled_reason)` is the existing trusted cancellation RPC. It:

- requires an authenticated caller
- checks store ownership through `owns_store(...)` or admin access
- locks the order row
- allows only `pending` or `open` orders
- requires a non-empty cancellation reason
- sets `order_status = 'canceled'`
- sets `payment_status = 'canceled'` for unpaid/pay-at-pickup orders
- records `canceled_at` and `canceled_reason`
- writes an `order_canceled` event
- enqueues `buyer_order_canceled`

## Inventory Restoration Safety

Cancellation restores only unfulfilled and unrestored quantity:

`quantity - fulfilled_quantity - restored_quantity`

That means:

- fully unfulfilled orders restore all ordered quantity
- partially fulfilled orders restore only the portion not picked up
- already restored quantities are not restored twice
- inventory activity events are written for restored quantities

## Implemented UI

Eligible pay-at-pickup `pending/open` orders now show a `Cancel order` section on the order detail page.

The UI:

- requires an intentional reveal step
- requires a cancellation reason
- explains that unpicked-up birds return to available inventory
- refreshes order detail after success
- hides fulfillment actions after cancellation through existing status gates
- maps backend errors to plain seller-facing messages

## Deferred

- refunds
- reinstate
- partial cancellation
- cancellation from the order list
- richer notification preview/editing
