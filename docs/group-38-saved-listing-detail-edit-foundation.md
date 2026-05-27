# Group 38 - Saved Listing Detail & Edit Foundation

## Design Review

Group 38 adds a saved listing detail route at `/dashboard/listings/[listingBatchId]`.

The safest first slice is read-only detail. Existing edit RPCs are available, but a focused edit workflow should be designed separately so sellers do not accidentally make public-impacting changes before publish and review behavior is fully defined.

## Detail Read Path Findings

The route uses `listing_batch_id` as the listing identifier.

Detail reads use `seller_inventory_management`, filtered by:

- active seller `store_id`
- route `listing_batch_id`

The projection already includes listing basics, breed display names, seller notes, visibility status, operational availability, and inventory rows. No new backend projection was needed.

## Edit / Update Support Findings

Existing supported edit functions include:

- `seller_update_listing_batch(...)`
- `seller_set_listing_batch_visibility(...)`
- `seller_update_listing_batch_breed(...)`
- `seller_set_listing_batch_breed_visibility(...)`
- `seller_update_inventory_item(...)`
- `seller_adjust_inventory_quantity(...)`
- `seller_set_inventory_visibility(...)`

Group 38 intentionally defers edit controls. The backend support is verified, but the UI should add focused, seller-safe edit behavior in the next group rather than mixing inspection and mutation in this foundation slice.

## Implemented UI

The new detail page shows:

- species
- breed names
- hatch/origin date
- available date
- age at availability
- base price
- internal label
- seller notes
- listing visibility/status
- inventory rows
- quantities
- effective prices
- price overrides
- row status

The Listings overview now links listing cards and desktop table rows to the detail route.

## Backend Work

No backend blocker was found.

No migrations, seed changes, SQL, or new backend architecture were added.

## Recommendation for Group 39

Add focused limited editing for hidden listings:

1. Listing basics edits through `seller_update_listing_batch(...)`.
2. Inventory quantity edits through `seller_adjust_inventory_quantity(...)`.
3. Inventory row price/type/label edits through `seller_update_inventory_item(...)`.

Keep publish/go-live separate.
