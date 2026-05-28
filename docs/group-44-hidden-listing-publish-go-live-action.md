# Group 44 - Hidden Listing Publish / Go-Live Action

## Design Summary

Group 44 adds the first narrow publish action for hidden saved listings.

Publishing is only offered inside the existing `Review Before Publish` flow. The action is intentionally limited to making a hidden listing visible to buyers; it does not add unpublish, archive, duplicate, order handling, notifications, or storefront redesign work.

## RPC and Status Used

Existing RPC:

- `seller_set_listing_batch_visibility(p_listing_batch_id, p_visibility_status, p_note)`

Published status:

- `active`

The current public storefront projections include listing batches where `listing_batches.visibility_status in ('active', 'sold_out')`, so setting the listing batch to `active` is the existing go-live path.

## Publish Gate

The publish button uses the centralized Group 41 readiness report.

Blocking checks include:

- seller/store context is missing
- listing is not hidden
- no active inventory rows
- no active available quantity
- missing available date
- missing hatch/origin date for live-animal listings
- invalid base price
- invalid row price override
- hatching egg/live-animal row mismatch

Warnings include:

- no listing photos
- missing public description
- missing pickup details
- missing public buyer contact method
- inventory rows with quantity 0

Blocking issues disable publish. Warnings do not block publish, but the seller must confirm before continuing.

## After Publish

After the RPC succeeds:

- the listing detail reloads from `seller_inventory_management`
- hidden setup edit/photo/publish controls are no longer writable
- future live operational edits should be handled by a separate active-listing workflow
- a success message confirms buyers can see the listing

The UI does not optimistically switch state before the server confirms the visibility change.

## Security Notes

The frontend readiness gate is UX only. Ownership and valid status enforcement stay inside the existing seller RPC.

No RLS policy was loosened.

## Limitations

- No unpublish flow yet.
- No archive flow yet.
- No active-listing operational edit workflow yet.
- Publish readiness is still a frontend checklist, not a backend policy.
- Storefront availability still depends on existing public storefront/store status rules.

## Files Changed

- `app/dashboard/listings/[listingBatchId]/listing-detail.tsx`
- `app/dashboard/listings/[listingBatchId]/publish-readiness.ts`
- `app/dashboard/listings/[listingBatchId]/publish-readiness-review.tsx`
- `docs/group-44-hidden-listing-publish-go-live-action.md`

## Recommendation for Group 45

Add a focused storefront verification/polish pass for newly published listings: confirm the published listing appears correctly on the existing public storefront route, with photo, description, price, age/availability, and pickup context displayed clearly enough for beta.
