# Group 45 - Public Storefront Published Listing Verification / Polish

## Design Summary

Group 45 improves the buyer-facing storefront presentation for published listings without changing storefront architecture.

The existing public projections remain the data source:

- `public_storefront_home`
- `public_storefront_inventory`
- `public_storefront_item_detail`

No backend migration, public projection change, checkout redesign, search feature, messaging feature, or marketplace behavior was added.

## Storefront Areas Reviewed

- `/store/[slug]`
  - storefront header
  - listing cards
  - pickup and seller info panels
  - empty state
- `/store/[slug]/items/[inventoryItemId]`
  - newly added minimal item detail route using the existing item detail projection

## Buyer-Facing Polish Changes

The storefront list page now shows:

- seller/store identity
- public location fallback
- ready/reserve/sold-out counts
- listing photo with safe fallback
- species and breed
- readable inventory type label
- public description preview
- buyer availability label
- quantity
- unit price
- available date
- pickup details
- seller contact details when public

The item detail page now shows:

- clear listing title built from breed and inventory type
- featured image or fallback
- availability badge
- price, quantity, available date, and inventory type
- readable public description with line breaks preserved
- pickup details
- link back to the seller storefront

## Projection / Query Changes

The old storefront page queried only `public_storefront_inventory` and rendered raw inline markup.

The polished storefront now uses:

- one `public_storefront_home` query for seller/store context and counts
- one `public_storefront_inventory` query for listing cards

The detail route uses:

- one `public_storefront_item_detail` query filtered by store slug and inventory item ID

No N+1 query pattern was introduced.

## Known Limitations

- There is still no full checkout/reservation UI polish in this group.
- Listing titles are derived from breed plus inventory type because the public projection does not currently expose a separate listing title.
- Storefront card grouping is inventory-row based, which matches the current public projection and checkout foundation.
- Photo fallback is intentionally simple until richer storefront media presentation is prioritized.

## Files Changed

- `app/store/[slug]/page.tsx`
- `app/store/[slug]/items/[inventoryItemId]/page.tsx`
- `app/store/[slug]/storefront-ui.tsx`
- `docs/group-45-public-storefront-published-listing-verification-polish.md`

## Recommendation for Group 46

Add the first focused active-listing operational edit workflow for sellers, starting with quantity and price updates on live listings. Keep it separate from hidden setup editing and avoid broad structural changes on live listings.
