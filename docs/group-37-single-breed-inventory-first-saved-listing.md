# Group 37 - Single Breed Inventory Step & First Saved Listing

## Design Review

Group 37 completes the Single Breed listing workflow by adding inventory rows, a review step, and a real save action at `/dashboard/listings/new/birds/single`.

The implementation uses the existing seller UI shell, Supabase client pattern, seller context, reference species/breed data, and the existing seller-safe creation RPCs. No backend objects, migrations, seed data, or new architecture were added.

## Existing Create Architecture Findings

The supported create path is:

1. `seller_upsert_breed_profile(...)`
2. `seller_create_listing_batch_with_inventory(...)`

`seller_create_listing_batch_with_inventory(...)` internally reuses:

- `seller_create_listing_batch(...)`
- `seller_add_listing_batch_breed(...)`
- `seller_create_inventory_item(...)`

The expected `p_breed_groups` payload is a non-empty array. Each breed group must include:

- `seller_breed_profile_id`
- `inventory_items`

Each inventory item must include:

- `inventory_type`
- `quantity_available`

Optional inventory fields used by the UI:

- `custom_inventory_label`
- `price_override`
- `sort_order`
- `visibility_status`

## Inventory Workflow Design

The route now has three in-page steps:

1. Basics
2. Inventory
3. Review

Inventory rows support:

- Female
- Male
- Straight run
- Unsexed
- Pair
- Trio
- Hatching eggs
- Other

Validation protects the backend constraints and seller workflow:

- At least one row is required.
- Quantity must be a whole number of 1 or more.
- Price override must be valid money when supplied.
- Duplicate inventory types are blocked because the backend requires one row per inventory type within a listing breed.
- `Other` requires a custom label.
- `Hatching eggs` cannot be mixed with live-bird inventory rows because the backend enforces different batch compatibility.

## Save Implementation

For existing seller breed profiles, the UI reuses the selected profile ID.

For platform catalog breeds without a seller profile, the UI first calls `seller_upsert_breed_profile(...)` to create or reuse the seller-owned breed profile.

The UI then calls `seller_create_listing_batch_with_inventory(...)` with:

- `p_visibility_status = 'hidden'`
- breed row `visibility_status = 'active'`
- inventory row `visibility_status = 'active'`

The hidden listing batch keeps the listing private/unpublished while still allowing it to appear in the seller Listings overview.

## Hidden / Private Listing Support

Hidden creation is already supported.

Verified values:

- `listing_batches.visibility_status`: `active`, `hidden`, `sold_out`, `archived`
- `listing_batch_breeds.visibility_status`: `active`, `hidden`, `archived`
- `inventory_items.visibility_status`: `active`, `hidden`, `archived`

The seller management projection reports hidden listings with `operational_availability_status = 'hidden'`, so the saved listing can be reviewed in `/dashboard/listings`.

## Files Changed

- `app/dashboard/listings/new/birds/single/single-breed-basics-form.tsx`
- `app/dashboard/listings/listings-foundation.tsx`
- `docs/group-37-single-breed-inventory-first-saved-listing.md`

## Proven Blockers

No backend blocker was found.

## Recommendation for Group 38

Build a focused saved-listing detail or edit path for hidden listings. The next useful slice should let a seller open the newly saved listing from `/dashboard/listings`, inspect its basics and inventory rows, and make safe edits before any publish workflow exists.
