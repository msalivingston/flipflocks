# Group 29 Seller API Safety Foundation

Group 29 adds a minimal seller-facing RPC layer for UI development without changing the frozen core schema or adding checkout/payment behavior.

## Added RPC Boundary

- `get_seller_context()` returns the authenticated seller's safe store context for UI bootstrapping. It omits Stripe customer/subscription IDs, admin hold reasons, suspension metadata, audit fields, and provider details.
- `seller_update_store_settings(store_id, settings)` accepts a JSON object and applies only whitelisted seller-editable store fields. It does not accept ownership, `store_status`, admin/suspension fields, billing/provider fields, audit fields, or system timestamps.
- `seller_upsert_breed_profile(...)` creates or updates seller-owned breed profiles. It validates store ownership, active species, and platform breed/species consistency. Custom breed names remain seller-owned profile data and are not inserted into `breeds` or `breed_aliases`. Once a profile is used by listing batch breed rows, its breed source cannot be changed through this safe wrapper.
- `seller_create_listing_batch_with_inventory(...)` is create-time orchestration for seller UI forms. It reuses the existing Group 20 RPCs for listing batch, breed row, and inventory item creation instead of duplicating business rules.

## Existing RPCs Still Used Directly

The seller UI can continue using the focused Group 20 inventory RPCs for targeted updates:

- `seller_update_listing_batch`
- `seller_set_listing_batch_visibility`
- `seller_update_listing_batch_breed`
- `seller_set_listing_batch_breed_visibility`
- `seller_update_inventory_item`
- `seller_adjust_inventory_quantity`
- `seller_set_inventory_visibility`

## Media Upload Deferral

Group 29 does not implement media upload Edge Functions or storage policies.

Before seller/store/listing media upload is enabled, the next media group should decide:

- Supabase Storage bucket name and public/private posture.
- Store-owned object path convention, using randomized filenames under a store-scoped prefix.
- Allowed image MIME types and max file size.
- Whether resizing/compression happens before or after upload.
- How moderation status moves from `pending` to `approved`, `needs_review`, or `rejected`.
- How server code validates that `media_links.entity_type` and `entity_id` belong to the same store as the uploaded `media_assets` row.

Until those decisions are implemented, clients should not directly create arbitrary storage paths or media links.
