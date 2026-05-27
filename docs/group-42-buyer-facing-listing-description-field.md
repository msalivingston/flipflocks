# Group 42 - Buyer-Facing Listing Description Field

## Design Summary

Group 42 adds a seller-editable `Public description` field to the hidden listing workflow without adding publish behavior.

The current schema does not have a listing-batch-specific public description column. The existing public buyer-facing description is stored on `seller_breed_profiles.seller_description`, and public storefront/order projections already expose it as `breed_description`.

Because the current Single Breed workflow creates one seller breed profile for the listing, this group uses the existing breed-profile description path instead of adding a new listing table field.

## Backend Decision

No migration was added.

Existing backend support used:

- `seller_breed_profiles.seller_description`
- `seller_upsert_breed_profile(...)`
- `seller_inventory_management`
- direct seller-owned `seller_breed_profiles` reads already used by the create flow

`seller_update_listing_batch(...)` was not changed because listing batches do not currently own buyer-facing descriptive copy.

## Create Behavior

The Single Breed create flow now includes:

- label: `Public description`
- help text: `This is what buyers will see on your listing. Optional for now.`

When the seller saves a private listing:

- catalog breed selections create/update a seller breed profile with the description
- existing seller breed profile selections update that profile with the description
- blank descriptions are saved as `null`
- description is optional for saving a hidden/private listing

## Edit Behavior

Hidden listing edit mode now includes `Public description`.

Saving hidden listing edits updates the single attached seller breed profile through `seller_upsert_breed_profile(...)`.

If a future mixed/multi-breed detail page has more than one breed profile, public description editing is blocked with a user-safe message rather than applying one description to multiple breeds.

Non-hidden listings remain read-only.

## Readiness Behavior

The Group 41 publish-readiness review now marks buyer-facing description as ready when the public description has text and missing only when empty.

Seller/internal notes remain separate and are still treated as private.

## Validation

Public description is optional for hidden drafts.

The UI trims whitespace on save and limits the field to 1,000 characters. This is a frontend V1 limit because the existing database field is unconstrained text.

## Files Changed

- `app/dashboard/_lib/seller-types.ts`
- `app/dashboard/listings/new/birds/single/single-breed-basics-form.tsx`
- `app/dashboard/listings/[listingBatchId]/listing-detail.tsx`
- `app/dashboard/listings/[listingBatchId]/publish-readiness.ts`
- `docs/group-42-buyer-facing-listing-description-field.md`

## Recommendation for Group 43

Add the first narrow hidden-listing media/photo attachment UI, because photos are now the most obvious publish-readiness gap still visible in the checklist.
