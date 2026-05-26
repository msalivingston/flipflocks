# Group 32A Seller UI Support Gaps

Group 32A adds the smallest backend support needed before production-shaped seller UI implementation.

It does not add UI, Stripe behavior, media upload/storage, Equipment & Supplies backend, arbitrary scheduled pickup dates, broad settings infrastructure, commits, pushes, deploys, or remote migration application.

## Implemented Support

### Pickup Options

V1 pickup coordination uses seller-defined pickup option labels. These are dropdown choices, not calendar appointments, scheduled pickup dates, capacity-managed slots, or automated booking windows.

Examples:

- Thursday afternoon pickup.
- Friday morning pickup.
- Saturday by appointment.
- Farm pickup.
- Delivery route / transport stop if later supported.

Added backend support:

- `store_pickup_options`
- `orders.pickup_option_id`
- `orders.pickup_option_label_snapshot`
- `seller_create_pickup_option(...)`
- `seller_update_pickup_option(...)`
- `seller_set_pickup_option_active(...)`
- `seller_set_order_pickup_option(...)`
- `pay-at-pickup-order` accepts optional `pickup_option_id` and passes it through the service-role RPC path.

Order snapshots store both the option ID and the selected label snapshot. If a seller later edits, deactivates, or deletes a pickup option, existing orders still preserve the selected label.

Dashboard interpretation:

- Upcoming Pickups means open orders with a selected pickup option.
- It does not mean reserved inventory.
- It does not mean future availability.
- It does not mean arbitrary scheduled pickup dates.

Updated seller-facing projections:

- `seller_dashboard_order_summary`
- `seller_dashboard_attention_orders`
- `seller_dashboard_home`
- `seller_order_management`

### Customer Detail and Update

Customer editing remains intentionally limited.

Editable through `seller_update_customer(...)`:

- first name
- last name
- email
- phone
- contact/address fields
- internal seller notes

Read support:

- `seller_customer_detail`

Not included:

- customer type
- preferred payment
- default pickup location
- notification settings
- CRM-style fields

### Duplicate Listing

Added:

- `seller_duplicate_listing(...)`

The duplicate listing RPC clones:

- listing basics
- listing-level pricing/settings
- associated breed rows
- inventory rows

It does not clone:

- media
- order history
- sold/reserved state beyond current available quantities
- moderation fields
- audit/system fields
- provider/payment fields

To avoid stale published inventory, the duplicate requires explicit new dates and defaults to hidden visibility.

### Seller Defaults

Added small seller default support:

- `stores.pickup_location_text`
- `stores.communication_email`
- `stores.default_pickup_option_id`
- `stores.currency`
- `seller_store_defaults`
- `seller_update_store_defaults(...)`

Existing defaults retained:

- `stores.pickup_instructions`
- `stores.order_notification_email`

Defaults are intended to prefill seller workflows and store/account settings. This group does not add low-stock thresholds or broad settings infrastructure.

## Deferred

Still deferred after Group 32A:

- Media upload/storage and media management APIs.
- Storefront logo/banner upload.
- Listing photos and inventory-row photos upload.
- Equipment & Supplies traditional ecommerce backend.
- Stripe changes.
- Unsaved storefront preview mode.
- Contact logging.
- CRM-style customer management.

## Security Notes

- Seller mutation RPCs use `security definer` with `set search_path = public`.
- Sensitive RPCs revoke broad public execute and grant only to intended roles.
- Pickup option and customer mutations validate store ownership.
- Customer updates use a strict field whitelist.
- Duplicate listing runs server-side to avoid fragile client-side multi-step cloning.
- Public pay-at-pickup order creation remains callable only through the service-role-backed Edge Function path.
