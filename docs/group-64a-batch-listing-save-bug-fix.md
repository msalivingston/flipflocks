# Group 64A - Batch Listing Save Bug Fix

## Root Cause Summary

Some mixed batch saves failed because the batch form tried to re-upsert every selected breed before save, including seller breed profiles that already existed. Existing seller profiles are already valid inputs for `seller_create_listing_batch_with_inventory(...)`, and re-upserting them can fail when the profile source is no longer mutable or catalog validation rejects the linked breed.

The fix reuses existing seller breed profile IDs directly. The form now calls `seller_upsert_breed_profile(...)` only when the seller selected a raw catalog breed that does not already have a seller profile.

Inventory type preservation was tightened by building inventory item payloads from the selected inventory type slug and by adding development console diagnostics around the exact `p_breed_groups` payload. The existing RPC expects `inventory_type` as a text slug such as `female`, `male`, or `straight_run`; it does not expect a separate inventory type ID or sex class.

## Exact Payload Fields Corrected

Breed preparation:

- Existing profile selections now pass the existing `seller_breed_profile_id` directly.
- Catalog breed selections still create/reuse profiles with:
  - `p_breed_id`
  - `p_display_name`
  - `p_species_id`
  - `p_store_id`

Batch create payload:

- `p_breed_groups[].seller_breed_profile_id`
- `p_breed_groups[].inventory_items[].inventory_type`
- `p_breed_groups[].inventory_items[].custom_inventory_label`
- `p_breed_groups[].inventory_items[].quantity_available`
- `p_breed_groups[].inventory_items[].price_override`
- `p_breed_groups[].inventory_items[].seller_notes`

## Debugging Visibility

The batch form now logs development diagnostics when:

- breed profile resolution fails
- the batch create RPC fails
- a non-production create payload is built

Seller-facing messages remain plain and do not expose raw database details.

## Files Changed

- `app/dashboard/_lib/listing-formatters.ts`
- `app/dashboard/listings/[listingBatchId]/listing-detail.tsx`
- `app/dashboard/listings/new/birds/batch/batch-listing-form.tsx`
- `docs/group-64a-batch-listing-save-bug-fix.md`

## Backend Gaps

No backend gap was found. Existing RPCs support the required save behavior.
