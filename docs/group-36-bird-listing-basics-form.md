# Group 36 - Bird Listing Basics Form

## Design Review

Group 36 replaces the Single Breed placeholder with a real seller-facing basics form at `/dashboard/listings/new/birds/single`.

The form is intentionally local-only in this group. The verified create path, `seller_create_listing_batch_with_inventory(...)`, creates a complete hidden listing batch by coordinating:

- `seller_create_listing_batch(...)`
- `seller_add_listing_batch_breed(...)`
- `seller_create_inventory_item(...)`

That orchestration requires at least one breed group and at least one inventory item. Group 36 explicitly avoids inventory-row management, so creating a saved partial draft would either create incomplete production data or require new draft architecture. No verified draft status or draft table exists for listing basics.

## Existing Create Architecture Findings

- `listing_batches` stores live-animal batch/date/pricing basics.
- `listing_batches.visibility_status` supports `active`, `hidden`, `sold_out`, and `archived`; it does not include `draft`.
- `seller_breed_profiles` is the seller-owned bridge to platform-managed breeds or custom seller breed names.
- `seller_upsert_breed_profile(...)` safely creates or updates seller-owned breed profiles.
- `listing_batch_breeds` links a listing batch to seller breed profiles.
- `inventory_items` stores actual sellable rows and requires an inventory type and nonnegative quantity.
- `seller_create_listing_batch_with_inventory(...)` is the approved seller UI create orchestration RPC for complete bird listings.

## Save Decision

Decision: **local form only**.

Reason: the current backend safely supports complete hidden listing creation, not partial basics-only drafts. This avoids creating half-listings that would not appear correctly in seller inventory projections and would need cleanup rules before the inventory step exists.

## Implemented UI

The Single Breed form collects:

- Species
- Breed
- Hatch or origin date
- Available date
- Base price
- Internal label
- Seller notes

The form fetches active `species`, active `breeds`, and active seller breed profiles for the current store. Existing seller breed profile names appear first in the Breed selector; catalog breeds fill in after that. Chicken is selected by default when present in reference species data.

The form validates required basics and shows a local review state, clearly stating that nothing is saved until the inventory step is added.

## Proven Blockers

No backend blocker was found for rendering the basics form.

Save behavior is intentionally deferred because there is no verified listing draft object/status and the existing create RPC requires inventory rows. This can wait for the next implementation slice.

## Recommendation for Group 37

Build the inventory step for Single Breed listings. The smallest safe save path is to collect one or more inventory rows, then call:

1. `seller_upsert_breed_profile(...)` if the selected breed does not already have a seller breed profile.
2. `seller_create_listing_batch_with_inventory(...)` with `p_visibility_status = 'hidden'`.

That would create a complete, non-public listing that can appear in the seller Listings overview without exposing incomplete data to buyers.
