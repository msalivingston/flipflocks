# Group 64 - Batch / Mixed Group Listing Form

## Design Summary

Group 64 replaces the placeholder at `/dashboard/listings/new/birds/batch` with a real seller workflow for one shared hatch group containing multiple breed inventory rows.

The UI keeps the existing seller flow shape:

- Batch information
- Inventory rows
- Review

The batch carries the shared species, hatch date, available date, default price, seller batch name, and private seller notes. Each inventory row carries breed, inventory type, quantity, optional row price, and optional private row notes.

## Existing Backend Functions / RPCs Used

- `seller_upsert_breed_profile(...)`
- `seller_create_listing_batch_with_inventory(...)`

The create RPC already supports a `p_breed_groups` JSON array, so the batch form groups rows by selected breed before saving. No migration, new RPC, direct table write, or parallel save process was added.

## Existing Age Calculation Approach Used

The database source of truth remains `listing_batches.age_at_availability_days`, generated from:

```sql
available_date - origin_date
```

The form preview uses the same date-difference assumption so sellers can see the derived age before saving. The display formatter is shared with listing detail through `app/dashboard/_lib/listing-formatters.ts`.

## Validation

The form blocks save when:

- species is missing
- hatch date is missing
- available date is missing
- available date is before hatch date
- default price is missing or invalid
- no inventory rows exist
- breed is missing
- inventory type is missing
- `Other` inventory type has no label
- quantity is missing or not a whole number of 1 or more
- optional row price is invalid
- the same breed/inventory-type pair appears more than once

## Backend Gaps Discovered

No backend blocker was found for creating a hidden batch/mixed group listing.

Known architecture boundaries:

- `listing_batches.base_price` is required by the current create RPC, so the form includes a required default price even though row-level prices are optional.
- The current listing detail hidden edit flow can add inventory rows only under an existing breed group. Editing a hidden mixed batch to add an entirely new breed remains a future workflow.

## Files Changed

- `app/dashboard/_lib/listing-formatters.ts`
- `app/dashboard/listings/[listingBatchId]/listing-detail.tsx`
- `app/dashboard/listings/new/birds/batch/batch-listing-form.tsx`
- `app/dashboard/listings/new/birds/batch/page.tsx`
- `docs/group-64-batch-mixed-group-listing-form.md`
