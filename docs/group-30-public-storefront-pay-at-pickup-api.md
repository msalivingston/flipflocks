# Group 30 Public Storefront + Pay-at-Pickup API

Group 30 adds the minimal public API boundary needed for buyer storefront browsing and pay-at-pickup order submission. It does not add Stripe, payment webhooks, UI, media upload, or marketplace discovery.

## Public Read API

The buyer storefront UI should reuse the existing Group 28 public-safe read layer:

- `public_storefront_home`
- `public_storefront_inventory`
- `public_storefront_item_detail`
- `get_public_storefront_by_slug(store_slug)`
- `get_public_checkout_summary(store_slug, items)`

These views/RPCs expose buyer-facing storefront profile fields, public inventory rows, public-safe image URLs, buyer availability labels, computed unit prices, and checkout summary totals. They exclude seller private notes, customer/order tables, admin fields, billing/provider identifiers, notifications, and audit records.

Storefront browsing remains scoped to one seller storefront by `store_slug`. V1 filtering should happen against `public_storefront_inventory` by `store_slug`, `species_id` or `species_slug`, `seller_breed_profile_id` or `breed_display_name`, and `available_date`. Group 30 does not add platform-wide marketplace discovery.

## Checkout Summary

`get_public_checkout_summary(store_slug, items)` remains the public-safe cart summary API. It validates item shape, confirms items belong to the public storefront, checks current availability and quantity, and recalculates subtotal from database prices.

Buyer-submitted totals, prices, payment status, order status, and store ownership values must not be trusted.

## Pay-at-Pickup Order Submission

Public order submission should go through:

```text
supabase/functions/pay-at-pickup-order
```

The Edge Function:

- accepts a store slug, buyer contact/pickup details, checkout items, and an idempotency key
- requires `POST` requests to use `Content-Type: application/json`
- rejects unknown request fields
- validates request shape before calling the database
- looks up the public storefront by slug
- checks `get_public_checkout_summary`
- calls `create_pay_at_pickup_order` with the service role
- returns a whitelisted buyer confirmation payload and server-calculated checkout summary

The public success response intentionally exposes only buyer confirmation fields:

- `order_number`
- `order_status`
- `payment_method`
- `payment_status`
- `subtotal_amount`
- `total_amount`
- `currency`
- `created_at`

It does not return `customer_id`, `store_id`, internal IDs, idempotency internals, private customer data, admin fields, or provider/billing fields.

Known checkout and order validation failures may be returned as buyer-safe messages. Unknown database, PostgREST, SQL, constraint, table, schema, or function errors are sanitized in the public response as: `Unable to place order. Please review your cart and try again.` Raw error details may be logged server-side only for debugging.

The deployed function requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Public callers should use the normal Supabase Edge Function invocation path for this project; do not expose the service role key to the browser.

Expected deploy command:

```text
supabase functions deploy pay-at-pickup-order
```

JWT verification mode must be deliberate:

- If the storefront UI invokes the function through the Supabase client with the project anon key, JWT verification can remain enabled.
- If the storefront UI invokes the function with plain unauthenticated `fetch`, deploy or configure the function with JWT verification disabled.

`FLIPFLOCKS_PUBLIC_API_ORIGIN` optionally controls the CORS origin. If unset, the function returns `Access-Control-Allow-Origin: *`, intentionally acceptable for this V1 public no-credentials checkout endpoint.

The database RPC remains the source of truth for:

- storefront publication/availability checks
- item ownership and visibility checks
- quantity validation
- server-side pricing and totals
- idempotency key enforcement
- row-level inventory locks
- official order/customer/order item creation
- atomic inventory decrement
- notification enqueueing

Group 30 revokes direct public execute on `create_pay_at_pickup_order` and grants execute to `service_role`, so buyers use the Edge Function rather than calling the mutation RPC directly.

## Notification Handoff

`create_pay_at_pickup_order` already enqueues `buyer_order_received` and `seller_new_order_received` notifications in the provider-agnostic `email_notifications` outbox.

Group 30 does not implement the email provider worker. Before launch, the existing notification worker foundation still needs an Edge Function or scheduled worker to claim pending notifications and mark them sent/failed.

## Deferred Hardening

Before public launch, add practical abuse controls around the Edge Function, such as rate limiting and/or CAPTCHA for public order submission. This is intentionally deferred from Group 30 to avoid introducing a broad anti-abuse subsystem before the first usable storefront flow.
