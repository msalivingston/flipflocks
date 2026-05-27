# Group 41 - Hidden Listing Publish Readiness Review

## Design Summary

Group 41 adds a seller-facing publish-readiness review for hidden listings without adding publish behavior.

The review is intentionally frontend-derived and read-only. It does not call a visibility RPC, does not make a listing public, and does not create new backend objects.

The existing hidden/private gate remains the source of access:

- `seller_inventory_management.listing_batch_visibility_status = 'hidden'`

Non-hidden listings remain read-only and do not show the publish-readiness review.

## Data Sources

- `seller_inventory_management`
  - listing basics
  - species and breed summary
  - inventory rows
  - quantities
  - pricing
  - row visibility/status
- `seller_media_management`
  - attached listing, listing-breed, and inventory-item photos
- `get_seller_context()`
  - store pickup notes/policy
  - public city/state
  - public email/phone visibility

These are existing projections and context fields. No schema change was needed.

## Review Behavior

Hidden listings now show a clearly separated `Review Before Publish` card.

The seller can open a preview/review checklist showing:

- listing title
- species and breed summary
- inventory rows and quantity readiness
- pricing readiness
- attached photo readiness
- pickup and buyer-contact readiness
- delivery/shipping status for V1
- missing buyer-facing description reminder

The review uses ready, warning, missing, and review statuses. It is conservative and does not decide whether a listing may be published; it only highlights likely issues before the future publish workflow.

## Known Limitations

- Public buyer-facing listing description is not yet part of the current single-breed listing form, so the checklist always marks it as missing.
- Delivery/shipping is shown as informational only because V1 publish readiness is pickup-focused.
- Media upload UI is still deferred, but existing attached media is counted when present.

## Files Changed

- `app/dashboard/_lib/seller-types.ts`
- `app/dashboard/listings/[listingBatchId]/listing-detail.tsx`
- `app/dashboard/listings/[listingBatchId]/publish-readiness.ts`
- `app/dashboard/listings/[listingBatchId]/publish-readiness-review.tsx`
- `docs/group-41-hidden-listing-publish-readiness-review.md`

## Recommendation for Group 42

Add the first narrow media attachment UI for hidden listings, or add the buyer-facing description field if Michelle wants text readiness solved before photos. Both are natural next steps before a real publish/go-live transition.
