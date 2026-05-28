# Group 49 - Listing Lifecycle Controls: Return to Hidden

## Design Summary

Group 49 adds the first reverse listing lifecycle action. Sellers can return an active listing to hidden without deleting or archiving it.

This keeps the current lifecycle model focused:

- hidden listings support broad setup editing
- active listings support safe operational edits
- active listings can be returned to hidden for later setup changes or pause-from-storefront behavior
- archive, delete, restore, and sold-out automation remain deferred

No backend migration, new visibility architecture, public storefront redesign, checkout change, notification workflow, or destructive lifecycle behavior was added.

## Visibility Behavior

The existing `seller_set_listing_batch_visibility(...)` RPC is used.

Group 49 sets:

- from `active`
- to `hidden`

The existing public storefront projections only expose listing batches with storefront-visible statuses. Returning a listing to hidden removes it from buyer storefront visibility while preserving all private seller data.

Preserved data includes:

- listing basics
- public description
- seller notes
- bird groups
- quantities
- pricing
- photos

The seller can publish the listing again later through the existing publish-readiness flow.

## Seller-Facing Terminology

The UI uses:

- `Storefront visibility`
- `Return to Hidden`
- “remove it from your storefront”
- “without deleting photos, bird groups, pricing, or notes”

The UI does not expose raw visibility enum names, projection language, or RPC language.

## Confirmation Behavior

Returning a listing to hidden requires an intentional browser confirmation:

“Return this listing to hidden? Buyers will not see it on your storefront until you publish it again.”

After success, the detail page reloads and the hidden/setup workflow becomes available again.

## Intentionally Deferred

- archive
- delete
- restore
- sold-out automation
- checkout changes
- buyer notifications
- bulk lifecycle actions
- marketplace or moderation tooling

## Recommendation for Group 50

Add the next lifecycle control only after product review. The likely next slice is either archive-with-warning for retired listings or active public-content maintenance for live photo/description updates.
