# Group 53 - Automatic Sold-Out Lifecycle Readability

## Design Summary

Group 53 keeps sold out as a derived availability state. It does not add a manual `Mark Sold Out` control, does not mutate listing batches into a persisted sold-out lifecycle state, and does not change archive, hidden, or publish behavior.

The practical rule is:

- if a live listing has no available quantity, sellers and buyers should see it as `Sold Out`
- increasing quantity above 0 makes the listing read as available/live again

## Sold-Out Logic Decision

Sold out remains derived from quantity.

The schema already supports an older `listing_batches.visibility_status = 'sold_out'`, and public projections still respect it, but this group does not use that as the preferred seller workflow. The preferred V1 behavior is quantity-driven because sellers already maintain availability through bird group quantities.

## Seller Behavior

Seller overview now derives listing-level sold out from active listings whose total available quantity is 0.

This affects:

- lifecycle badge display
- lifecycle chip counts
- sold-out filtering
- next-step helper text

Seller detail now shows:

- `Sold Out` when a live listing has 0 total available
- `No birds currently available`
- guidance to add quantity when more birds are available

Active listings that read as sold out still keep active maintenance controls:

- update quantity
- update group price
- update public content
- return to hidden
- archive

## Buyer Storefront Behavior

Public storefront projections already derive buyer availability from quantity:

- `quantity_available <= 0` becomes `sold_out`
- buyer label becomes `Sold out`
- checkout availability becomes false

The storefront UI now adds clearer sold-out explanatory copy on listing cards and listing detail pages.

Buyer-facing wording uses:

- `Sold Out`
- `This listing is currently sold out.`
- `Check back later or contact the seller if contact info is public.`

## Restore Availability

Sellers make a sold-out live listing available again by updating quantity above 0 through active listing operational edits.

No publish, unpublish, archive, or manual sold-out status change is required.

## Deferred

These remain intentionally deferred:

- manual sold-out lifecycle action
- automatic storefront hiding
- buyer notifications
- checkout redesign
- sold-out automation beyond derived quantity display
- bulk lifecycle tools

## Recommendation for Group 54

Review checkout/reservation readiness next. The likely slice is making buyer-side reservation/pay-at-pickup affordances safe around sold-out and quantity changes, without redesigning checkout.
