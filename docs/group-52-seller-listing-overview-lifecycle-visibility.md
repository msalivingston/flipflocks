# Group 52 - Seller Listing Overview Lifecycle Visibility

## Design Summary

Group 52 improves `/dashboard/listings` as an operational seller overview. The goal is clearer lifecycle scanning, not a dashboard redesign.

The implementation keeps the existing `seller_inventory_management` read path and does not add backend objects, migrations, bulk actions, delete behavior, or a separate archive-management system.

## Lifecycle Filter UX

The listings page now uses lifecycle filter chips with counts:

- Current
- Live
- Hidden
- Sold Out
- Archived
- All

`Current` is the default view. It includes live, hidden, and sold-out listings while keeping archived records out of the main working list. Archived listings remain easy to find through the `Archived` chip.

## Status Visibility

Listing cards and desktop rows now show a dedicated lifecycle badge:

- `Live`
- `Hidden`
- `Sold Out`
- `Archived`

Availability badges are still shown when they add useful context, such as `ready now` or `reserve now`, but hidden, sold-out, and archived listings avoid duplicate/confusing badges.

## Seller-Facing Workflow Cues

Each listing now includes a short lifecycle cue:

- live listings tell sellers to keep quantities, prices, and photos current
- hidden listings point sellers toward setup and publish review
- sold-out listings prompt an availability review
- archived listings explain that they are preserved and hidden from buyers

These cues are intentionally practical and seller-facing. They avoid enum names, projection language, and backend terms.

## Scanability Changes

Mobile cards now make lifecycle state more prominent near the title, with the next-step cue directly beneath it.

Desktop rows now use a `Lifecycle` column instead of a generic `Status` column and use `Open` as the primary row action.

The copy uses `Groups` instead of `Rows` where sellers are scanning bird groups.

## Deferred

These remain intentionally deferred:

- bulk archive or bulk lifecycle actions
- delete or permanent removal
- archive cleanup jobs
- a separate archive-management page
- advanced lifecycle analytics
- full visual redesign of the dashboard

## Recommendation for Group 53

Add a focused sold-out lifecycle review next. The likely slice is seller-facing sold-out handling: making quantity-zero/live listings easier to understand and deciding whether sellers need an explicit `Mark Sold Out` action separate from archive and return-to-hidden.
