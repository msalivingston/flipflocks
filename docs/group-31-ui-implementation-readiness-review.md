# Group 31 UI Implementation Readiness Review

This review checks whether the existing Group 1-30 backend/API foundation is ready for first-pass seller UI implementation based on the approved Group 31 Seller UI Foundation and follow-up review decisions.

This document is a planning artifact only. It does not create migrations, SQL, React code, components, routes, schema changes, commits, pushes, or deployments.

## Executive Summary

The seller UI is partially ready for first-pass implementation.

Most read-heavy seller screens can begin now using existing seller-safe projections and RPCs:

- Dashboard operational summary.
- Listings list and detail reads.
- Orders list and detail reads.
- Customer list reads.
- Saved storefront preview.
- CSV reports generated from seller projections.
- Billing visibility from seller context.

Group 32A resolves the small seller UI support group items identified before broad UI implementation:

- Pickup option support for Upcoming Pickups and order operations.
- A safe customer detail/update API for the intentionally limited editable fields.
- A duplicate listing RPC.
- Seller defaults fields for pickup location, communication email, default pickup option, and currency.

Remaining high-risk gaps:

- Media upload/linking support for listing photos, row photos, logo, and banner.
- Equipment & Supplies product support.

## Readiness Categories

### Ready Now

Backend support already exists. UI can safely begin against existing projections/RPCs, with normal implementation caution.

### Minor Gap

Small API, projection, helper RPC, or Edge Function addition is likely needed. UI could mock around it for prototypes, but production implementation should not rely on direct table writes or fragile client orchestration.

### Major Gap

UI implementation would be difficult, misleading, or unsafe without additional backend work.

## Existing Backend Support Inventory

Seller-safe context and settings:

- `get_seller_context()`
- `seller_update_store_settings(store_id, settings)`

Seller dashboard projections:

- `seller_dashboard_home`
- `seller_dashboard_storefront_status`
- `seller_dashboard_inventory_summary`
- `seller_dashboard_order_summary`
- `seller_dashboard_attention_orders`

Seller management projections:

- `seller_inventory_management`
- `seller_order_management`
- `seller_order_item_detail`
- `seller_customer_summary`
- `seller_refund_summary`
- `seller_notification_summary`

Seller listing/inventory RPCs:

- `seller_create_listing_batch_with_inventory(...)`
- `seller_upsert_breed_profile(...)`
- `seller_create_listing_batch(...)`
- `seller_update_listing_batch(...)`
- `seller_set_listing_batch_visibility(...)`
- `seller_add_listing_batch_breed(...)`
- `seller_update_listing_batch_breed(...)`
- `seller_set_listing_batch_breed_visibility(...)`
- `seller_create_inventory_item(...)`
- `seller_update_inventory_item(...)`
- `seller_adjust_inventory_quantity(...)`
- `seller_set_inventory_visibility(...)`

Seller order/fulfillment RPCs:

- `seller_create_manual_order(...)`
- `seller_mark_order_ready_for_pickup(...)`
- `seller_record_order_fulfillment(...)`
- `seller_record_refund(...)`

Public storefront preview/read APIs:

- `public_storefront_home`
- `public_storefront_inventory`
- `public_storefront_item_detail`
- `get_public_storefront_by_slug(store_slug)`
- `get_public_checkout_summary(store_slug, items)`

Media foundation:

- `media_assets`
- `media_links`

Important media limitation:

- Storage bucket creation, storage object policies, upload helpers, media-link validation RPCs, moderation workflow, and signed/public URL decisions are not complete.

## Screen Review

### Dashboard

Status: Ready Now after Group 32A

Ready now:

- Active Listings can read from `seller_dashboard_home` or `seller_dashboard_inventory_summary`.
- Pending Orders can read from `seller_dashboard_home` or `seller_dashboard_order_summary`.
- Customers can be counted from `seller_customer_summary`.
- Recent Orders can read from `seller_order_management`.
- Active Listings table can read from `seller_inventory_management`.
- Storefront quick link can use `get_seller_context()` and `seller_dashboard_home`.

Group 32A correction:

- Upcoming Pickups means open orders with selected seller-defined pickup options.
- It does not mean arbitrary scheduled pickup dates, reserved inventory, or future availability.
- Group 32A adds `store_pickup_options`, order pickup option snapshots, and dashboard/order projection support.

Readiness conclusion:

- Dashboard can be implemented with Upcoming Pickups backed by pickup-option order counts.

### Listings

Status: Ready Now after Group 32A

Ready now:

- By Listing view can be built from `seller_inventory_management` grouped by seller-facing listing identity.
- By Breed view can be built from `seller_inventory_management` grouped by breed display name/profile and species.
- Listing details can be assembled from `seller_inventory_management`.
- Create bird listing can use `seller_create_listing_batch_with_inventory(...)`.
- Breed profile creation/update can use `seller_upsert_breed_profile(...)`.
- Quick edits can use existing focused listing and inventory RPCs.
- Visibility/status operations can use existing visibility RPCs.

Missing or weak support:

- There is no dedicated seller-facing grouped listing projection. The UI can group `seller_inventory_management`, but every client would need to repeat grouping logic.
- Group 32A adds `seller_duplicate_listing(...)`.
- Photos are not ready for seller upload/linking.
- Drafts are approved conceptually and are not a blocker for UI planning, but production auto-save behavior still needs an implementation decision later.

By Listing view:

- Current projection is sufficient for a first pass.
- UI can group rows by listing and calculate row count, total quantity, remaining quantity, and status.

By Breed view:

- Current projection includes breed display name, species, listing/date fields, row-level inventory fields, and operational availability.
- It can support a first pass grouped by breed.
- Efficiency is acceptable for initial UI if data volume is modest.

By Breed recommendation:

- Minor projection improvement is recommended, not required for first pass: add a seller-facing breed-grouped projection with precomputed totals, listing/date summaries, and featured image fields after media support lands.
- This avoids duplicating grouping rules across desktop, mobile, exports, and future APIs.

Duplicate listing support:

- Group 32A adds `seller_duplicate_listing(...)`.
- It clones listing basics, associated breed rows, inventory rows, and listing-level settings.
- It defaults duplicates to hidden and requires explicit new dates.
- It does not clone media, order history, moderation fields, provider fields, or system fields.

Readiness conclusion:

- Listings can begin for list/detail/quick-edit, bird creation, and duplicate listing.
- Media-dependent workflows still need backend support first.

### Create Listing

Status: Major Gap for Equipment & Supplies; Ready Now / Minor Gap for Birds

Ready now for Birds:

- Bird listing creation can use `seller_create_listing_batch_with_inventory(...)`.
- Single Breed / Offering and Batch / Mixed Group can share the same backend create path.
- Seller breed profile support exists through `seller_upsert_breed_profile(...)`.
- Species/breed reference data exists in the schema.

Minor gaps for Birds:

- Media upload and linking are not ready.
- Draft persistence is not reviewed here by instruction; assume draft support exists conceptually.
- Seller defaults are represented after Group 32A for pickup instructions, pickup location text, default pickup option, communication email, order notification email, and currency.

Major gap for Equipment & Supplies:

- Current `listing_batches` architecture is explicitly live-animal focused.
- Existing docs state standard products should use a separate future flow and should not be represented in live-animal listing batches.
- There are no clear product tables, product inventory APIs, product photo APIs, shipping/pickup product settings, or product order item integration for traditional ecommerce equipment/supplies.

Recommendation:

- Implement Birds first.
- Treat Equipment & Supplies as blocked for production UI until a small product/equipment backend foundation exists.
- Do not force Equipment & Supplies into the live-animal listing architecture.

Readiness conclusion:

- Birds creation can start if media is deferred.
- Equipment & Supplies should not be implemented beyond entry routing/placeholder until backend support exists.

### Edit Listing

Status: Minor Gap for media; Ready Now for core fields after Group 32A

Ready now:

- Batch/listing-level edits can use `seller_update_listing_batch(...)`.
- Status/visibility edits can use `seller_set_listing_batch_visibility(...)`.
- Breed row edits can use `seller_update_listing_batch_breed(...)`.
- Breed row visibility can use `seller_set_listing_batch_breed_visibility(...)`.
- Inventory row edits can use `seller_update_inventory_item(...)`.
- Quantity edits can use `seller_adjust_inventory_quantity(...)`.
- Inventory visibility can use `seller_set_inventory_visibility(...)`.

Missing or weak support:

- No media upload/link RPC for listing-level photos or inventory-row photos.
- Full edit may need a richer seller detail projection if the UI needs all photos, notes, and grouped children in one fetch.
- Duplicate Listing is supported by Group 32A.

Recommendation:

- First-pass edit without photos is ready.
- Before implementing photo editing, add safe media upload/link management.
- Consider a seller listing detail RPC/projection that returns one listing with rows, photos, and seller-facing labels to reduce client assembly.

Readiness conclusion:

- Quick edits are ready now except photos.
- Full edit is ready for core fields, with media as a blocking gap for photo sections.

### Orders

Status: Ready Now after Group 32A

Ready now:

- Order list can use `seller_order_management`.
- Order item detail can use `seller_order_item_detail`.
- Customer contact actions can use order snapshot fields from `seller_order_management`.
- Fulfillment actions can use `seller_mark_order_ready_for_pickup(...)` and `seller_record_order_fulfillment(...)`.
- Refund visibility and actions can use `seller_refund_summary` and `seller_record_refund(...)` if included.
- Operational order status/payment status fields are available.

Group 32A correction:

- V1 does not use freeform scheduled pickup dates.
- Orders use selected seller-defined pickup option labels.
- `seller_order_management` exposes `pickup_option_id` and `pickup_option_label_snapshot`.
- Call/Text/Email do not require backend support, and optional contact logging remains deferred.

Readiness conclusion:

- Orders can be implemented for list/detail/contact/fulfillment with pickup option labels instead of scheduled pickup dates.

### Customers

Status: Ready Now after Group 32A

Ready now:

- Customer list can use `seller_customer_summary`.
- Derived fields available: created date/customer since, order count, open order count, lifetime total, latest order date.
- Recent orders can be fetched from `seller_order_management` filtered by customer.
- Group 32A adds `seller_customer_detail` and `seller_update_customer(...)`.

Group 32A support:

- `seller_customer_detail` includes address lines and internal seller notes.
- `seller_update_customer(...)` accepts only approved customer fields.
- Direct table RLS still exists, but seller UI should use the narrow RPC.

Approved editable fields:

- Name.
- Phone.
- Email.
- Address.
- Notes.

Implemented safe backend addition:

- Group 32A adds `seller_customer_detail` with approved detail fields and derived order stats.
- Group 32A adds `seller_update_customer(customer_id, fields)` with a strict whitelist:
  - first name.
  - last name.
  - email.
  - phone.
  - contact/address fields.
  - internal notes.
- Do not expose customer type, preferred payment, default pickup location, or notification settings.

Readiness conclusion:

- Customer list and customer detail/edit are ready now using seller-safe projections/RPCs.

### Storefront

Status: Major Gap for logo/banner/media; Ready Now for saved-data preview and text settings

Ready now:

- Store context reads are available through `get_seller_context()`.
- Text/store settings update is available through `seller_update_store_settings(store_id, settings)`.
- Saved storefront preview can read from `get_public_storefront_by_slug(store_slug)` and public storefront projections.
- Follow-up review decision confirms no unsaved preview mode is required in V1.

Settings supported by `seller_update_store_settings(...)` include:

- Store name.
- Store tagline.
- Store slug.
- Storefront mode.
- Storefront enabled.
- Public city/state/country.
- About text.
- Pickup policy.
- Cancellation policy.
- Pickup instructions.
- Public email/phone and visibility flags.
- Website/social URL.
- NPIP number and visibility.
- Order notification email.

Missing or weak support:

- Storefront logo and banner require media upload/link management.
- There is no seller-facing media helper to safely upload, create `media_assets`, and create validated `media_links` for `store` logo/hero contexts.
- Store URL updates are supported through slug, but UI should guard slug changes because public links may break.

Recommendation:

- Storefront text settings and saved preview can start now.
- Logo/banner editing should wait for the media support group.

Readiness conclusion:

- Storefront is ready for non-media settings and saved preview.
- Media sections are blocked.

### Reports

Status: Ready Now, with optional Minor Gap

Ready now:

- Sales Report can be generated from `seller_order_management` and `seller_order_item_detail`.
- Customer Report can be generated from `seller_customer_summary`.
- Inventory Report can be generated from `seller_inventory_management`.
- V1 requires CSV export only, with no dashboards or charts.

Optional minor gap:

- Server-side CSV export endpoints or Edge Functions would improve consistency for large datasets.
- They are not required for first-pass V1 if client-side CSV generation uses authenticated seller-safe projections.

Recommendation:

- Begin with client-side CSV export from seller projections.
- Add server-side export only if row volume, browser memory, or audit requirements make it necessary.

Readiness conclusion:

- Reports are ready now.

### Account

Status: Ready Now for seller defaults after Group 32A; Minor Gap for notification preference toggles

Ready now:

- Billing visibility is available through `get_seller_context()` with safe billing fields such as billing plan, subscription status, storefront access, trial end, and billing completion.
- Store/public settings that overlap with seller defaults can update through `seller_update_store_settings(...)`.
- Security can rely on auth/session provider capabilities outside the seller schema.

Group 32A support:

- Seller Defaults in Group 31 include pickup instructions, pickup location, communication email, order notification email, and currency.
- Group 32A adds `seller_store_defaults` and `seller_update_store_defaults(...)`.
- Group 32A adds pickup location text, communication email, default pickup option, and currency fields.
- Notification preference settings are not modeled. Existing `email_notifications` and `seller_notification_summary` track notification delivery, not seller preference toggles.

Recommendation:

- Use `seller_store_defaults` and `seller_update_store_defaults(...)` for seller defaults.
- Keep billing visibility read-only unless a billing portal integration is explicitly added.
- Add notification preference toggles only if editable notification preferences remain in V1.

Readiness conclusion:

- Account can show billing, security entry points, and seller defaults.
- Notification preference toggles remain a minor gap only if editable toggles stay in V1.

## Focus Area Reviews

### Media Support

Status: Major Gap

Current architecture supports:

- Store-owned image metadata through `media_assets`.
- Links from images to store, breed profile, listing, breed row, and inventory row through `media_links`.
- Public storefront image projection for approved active media in existing public views.
- Display contexts such as logo, hero/banner, gallery, and primary through `display_context`.

Current architecture is not sufficient yet for UI implementation of uploads because it lacks:

- Supabase Storage bucket creation.
- Storage object policies.
- Upload Edge Function or server helper.
- Trusted store-owned path generation.
- File size limits enforced at the upload boundary.
- Image resizing/compression decision.
- Moderation workflow from pending to approved/needs review/rejected.
- Seller-safe RPCs for creating/updating/archiving media assets and links.
- Server validation that a linked entity belongs to the same store as the media asset.
- Seller-private media management projections for edit screens.

Requirement coverage:

| Requirement | Current Status | Readiness |
| --- | --- | --- |
| Listing photos | Tables can represent them through listing links; upload/link API missing. | Major Gap |
| Inventory-row photos | Tables can represent them through inventory links; upload/link API missing. | Major Gap |
| Storefront logo | Public projection supports logo context; upload/link API missing. | Major Gap |
| Storefront banner | Public projection supports hero/banner context; upload/link API missing. | Major Gap |

Smallest safe backend/media work before UI:

- Create a media upload Edge Function or trusted server endpoint.
- Define bucket name, public/private posture, and path convention.
- Add seller-safe media management RPCs:
  - create media asset record after trusted upload.
  - link media to approved entity types.
  - update alt text/caption/sort/featured/display context.
  - hide/archive media links.
- Add validation that linked entity belongs to the same store.
- Add a seller media projection for edit screens.
- Decide whether initial uploads auto-approve or require moderation before public display.

### Customer Editing

Status: Minor Gap

Existing support:

- `customers` table has fields for name, email, phone, address-like delivery/contact fields, and internal notes.
- RLS allows store owners to update their own customers.
- `seller_customer_summary` supports read-mostly list behavior and derived stats.

Missing:

- Safe, narrow update RPC for only approved editable fields.
- Detail read projection including address line 1, address line 2, and internal notes.

Smallest safe backend addition:

- Add `get_seller_customer_detail(customer_id)` or `seller_customer_detail` view.
- Add `seller_update_customer(customer_id, updates)` with a strict whitelist.

Reason:

- Direct table update is technically possible but too broad for the approved UI contract.
- A narrow RPC prevents accidental mutation of fields outside name, phone, email, address, and notes.

### Duplicate Listing

Status: Minor Gap

Existing support:

- Existing create RPC can create a new listing with inventory rows.
- Existing read projection can provide much of the source listing data.

Missing:

- No RPC or helper clones a seller listing safely.
- Client-side duplication would need to read, transform, and recreate multiple related records.
- Media cloning is not safe until media APIs exist.

Smallest safe implementation path:

- Add `seller_duplicate_listing(source_listing_id, overrides)` RPC.
- It should validate ownership, read the source listing and rows server-side, and create a new listing through existing trusted create logic.
- Required overrides should include dates and initial visibility/status to avoid accidentally publishing stale inventory.
- It should clone listing-level settings and inventory rows.
- It should not clone order history, sold/reserved state, audit fields, moderation state, or provider/system fields.
- Media links can be omitted initially or added later after media management is safe.

### By Breed View

Status: Ready Now, with optional Minor Gap

Existing support:

- `seller_inventory_management` includes species, breed display name/profile ID, listing/date information, inventory type, quantity, price, status, and availability.
- The UI can group by breed and show associated listings/batches underneath.

Efficiency concern:

- Current approach requires client-side grouping.
- For first-pass UI this is acceptable.
- For larger stores, a dedicated projection would reduce repeated grouping logic and improve pagination/filtering.

Smallest optional projection addition:

- Add a seller-facing breed inventory summary projection with:
  - breed display name.
  - species.
  - total available quantity.
  - active/hidden/sold out counts.
  - associated listing summaries.
  - next available date.
  - min/max price.
  - featured image after media support lands.

Conclusion:

- By Breed is first-class and implementable now.
- A projection enhancement is helpful but not blocking.

## Missing Backend/API Items by Priority

### Major Gaps

1. Media upload and safe media linking.
   - Needed for listing photos, inventory-row photos, storefront logo, and storefront banner.
   - Tables exist, but upload/link API and storage policy work remains.

2. Equipment & Supplies traditional ecommerce foundation.
   - Current live-animal listing architecture should not be reused for standard products.
   - Product/equipment tables and APIs are not present.

### Minor Gaps

1. Optional seller listing detail projection.
   - Helpful for full edit screens.

2. Optional By Breed summary projection.
   - Helpful for first-class By Breed view at scale.

3. Optional server-side CSV export endpoints.
   - Not required for first pass if client-side CSV is acceptable.

4. Notification preference settings.
   - Needed only if editable notification toggles remain in V1.

## Group 32A Resolution

Group 32A covers the small support group before broad UI implementation:

1. Order pickup option support.
2. Seller customer detail/update RPC.
3. Duplicate listing RPC.
4. Seller defaults fields/settings wrapper for pickup location, default pickup option, communication email, currency, and order notification email.

Still deferred:

- Seller media upload/link management.
- Equipment & Supplies full ecommerce backend.
- Report dashboards or analytics.
- Unsaved storefront preview.
- Customer CRM fields.
- Contact logging.
- Advanced media moderation automation.

## Final Readiness Matrix

| Screen / Workflow | Category | Notes |
| --- | --- | --- |
| Dashboard | Ready Now | Group 32A supports Upcoming Pickups through selected pickup options. |
| Listings: By Listing | Ready Now | Existing projection supports first pass. |
| Listings: By Breed | Ready Now | Existing projection supports grouping; optional summary projection later. |
| Create Listing: Birds | Minor Gap | Core create ready; media deferred; draft assumed. |
| Create Listing: Equipment & Supplies | Major Gap | Traditional product backend not present. |
| Edit Listing: core fields | Ready Now | Existing focused RPCs support quick/full edits. |
| Edit Listing: photos | Major Gap | Media upload/link support missing. |
| Duplicate Listing | Ready Now | Group 32A adds safe server-side duplication, hidden by default with explicit new dates. |
| Orders: core operations | Ready Now | Existing order projections and fulfillment RPCs support most operations. |
| Orders: pickup workflow | Ready Now | Group 32A supports selected pickup option labels; no freeform scheduled pickup dates. |
| Customer list | Ready Now | Existing summary projection supports read-mostly list. |
| Customer detail/edit | Ready Now | Group 32A adds detail projection and narrow update RPC. |
| Storefront text settings | Ready Now | Existing context/settings RPC supports saved settings. |
| Storefront saved preview | Ready Now | Public storefront read APIs support saved-data preview. |
| Storefront logo/banner | Major Gap | Media upload/link support missing. |
| Reports CSV | Ready Now | Client-side CSV can use existing seller projections. |
| Account billing visibility | Ready Now | Safe billing status is available in seller context. |
| Account seller defaults | Ready Now | Group 32A adds defaults view/RPC and missing fields. |
| Account notification settings | Minor Gap | Delivery tracking exists; preference settings are not modeled. |

## Conclusion

After Group 32A, the backend is ready for a broader first-pass seller UI if implementation still defers media upload/storage and Equipment & Supplies.

Remaining notable deferrals are media upload/link management and Equipment & Supplies backend support.
