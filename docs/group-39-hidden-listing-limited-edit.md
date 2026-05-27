# Group 39 - Hidden Listing Limited Edit

## Design Summary

Group 39 adds limited edit mode to saved listing detail pages. Editing is only available when the listing batch is hidden/private.

The edit gate uses `seller_inventory_management.listing_batch_visibility_status`. The UI only shows the edit button when that value is `hidden`. Visible, sold out, archived, or otherwise non-hidden listings remain read-only in this group.

## RPCs Used

- `seller_update_listing_batch(...)`
  - Updates hatch/origin date, available date, base price, internal label, and seller notes.
- `seller_update_inventory_item(...)`
  - Updates inventory type, custom label, price override, sort order, and row notes.
- `seller_adjust_inventory_quantity(...)`
  - Updates quantity available using the absolute quantity argument.

These existing functions already enforce seller ownership and inventory compatibility. No new backend function, table, policy, or migration was added.

## Validation Rules

The UI validates before calling RPCs:

- available date is required
- hatch/origin date is required for live-animal listings
- available date cannot be before hatch/origin date
- base price must be valid money
- quantity must be a whole number of 0 or more
- price override must be valid money when supplied
- duplicate inventory types are blocked
- `Other` inventory rows require a custom label
- hatching egg listings can only use hatching egg rows
- live-animal listings cannot use hatching egg rows

## Hidden / Private Edit Blocking

Only listings with `listing_batch_visibility_status = 'hidden'` can enter edit mode.

This intentionally avoids publish/go-live behavior. The backend supports other status changes, but Group 39 keeps publication decisions out of the edit workflow.

## Files Changed

- `app/dashboard/listings/[listingBatchId]/listing-detail.tsx`
- `docs/group-39-hidden-listing-limited-edit.md`

## Incomplete Items

- No publish/go-live behavior.
- No media/photo editing.
- No adding or removing inventory rows.
- No breed/profile editing.
- No duplicate listing.

## Recommendation for Group 40

Add add/remove inventory row support for hidden listings, or build a focused publish-readiness review. If publish comes next, keep it separate from editing so sellers can clearly distinguish private setup from public storefront visibility.
