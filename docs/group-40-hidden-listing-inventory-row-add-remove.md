# Group 40 - Hidden Listing Inventory Row Add/Remove

## Design Summary

Group 40 extends the hidden-listing edit flow so sellers can add and remove inventory rows before publish behavior exists.

The hidden/private gate remains unchanged: add/remove controls are only available when `seller_inventory_management.listing_batch_visibility_status = 'hidden'`.

## RPCs Used

- `seller_create_inventory_item(...)`
  - Adds a new inventory row under the listing's existing batch-breed row.
- `seller_set_inventory_visibility(...)`
  - Removes an existing row by archiving it with `visibility_status = 'archived'`.
- Existing Group 39 RPCs remain in use:
  - `seller_update_listing_batch(...)`
  - `seller_update_inventory_item(...)`
  - `seller_adjust_inventory_quantity(...)`

The backend does not expose seller hard-delete for inventory rows. Archiving is the safe V1 remove behavior and preserves operational history.

## Add / Remove Behavior

New rows are held in edit state until Save Changes.

Removing a row:

- requires browser confirmation
- marks existing rows for archive on save
- drops unsaved new rows from edit state
- is blocked when it would remove the last visible inventory row

Cancel discards all pending add/remove changes.

## Validation

Validation remains consistent with Group 39:

- at least one inventory row must remain
- no duplicate inventory types
- `Other` requires a custom label
- hatching egg listings can only use hatching egg rows
- live-animal listings cannot use hatching egg rows
- quantity must be a whole number of 0 or more
- price override must be valid money when supplied

## Backend Limitations

No backend blocker was found.

This group only supports adding rows under the existing listing-breed row. Adding new breeds or changing breed profiles remains out of scope and should stay with a future mixed/batch or breed-profile edit workflow.

## Files Changed

- `app/dashboard/listings/[listingBatchId]/listing-detail.tsx`
- `docs/group-40-hidden-listing-inventory-row-add-remove.md`

## Recommendation for Group 41

Add a publish-readiness review for hidden listings. Keep it separate from editing and do not make listings public until the seller sees a clear checklist of storefront-visible fields, inventory rows, pickup expectations, and buyer-facing status.
