# Group 46 - Seller Listing Form UX / Terminology Pass

## Design Summary

Group 46 improves seller-facing language in the listing creation and hidden-listing setup flows without changing the underlying listing architecture.

The backend still uses listing batches, listing-batch breeds, and inventory items. The seller UI now describes those sellable inventory entries as bird groups because that better matches how poultry sellers think about the work: pullets, cockerels, straight run chicks, hatching eggs, and similar sale groups.

No backend migration, RPC change, projection change, checkout change, or storefront behavior change was added.

## Terminology Changes

- "Inventory rows" -> "Bird groups"
- "Inventory type" -> "Bird type"
- "Row" -> "Group"
- "Quantity available" -> "How many are available?"
- "Price override" -> "Optional custom price"
- "Custom label" -> "Name this group"
- "Edit Hidden Listing" -> "Edit Setup Details"

The implementation keeps internal TypeScript names and RPC payload fields aligned with the existing backend contract. Only seller-facing copy changed.

## UX Decisions

- Bird group helper text now gives practical examples: pullets, cockerels, straight run chicks, and hatching eggs.
- Optional custom price helper text explains when to use group-level pricing instead of the base price.
- Review and publish-readiness language now uses bird groups consistently.
- Hidden setup editing is described as setup editing, leaving room for future active-listing operational edits.
- Listings overview copy no longer exposes projection language to sellers.

## Areas Updated

- Single Breed create flow:
  - basics-to-groups transition copy
  - step label
  - bird group section labels and validation
  - review section labels
- Saved listing detail:
  - page header copy
  - hidden setup edit button and panel copy
  - bird group read-only card
  - edit form labels, helper text, remove confirmation, and validation
- Publish-readiness review:
  - bird group checklist labels
  - group-count summary
  - custom price blocker wording
- Listings overview and Batch placeholder:
  - removed seller-facing "inventory row" terminology

## Deferred UX Items

- Active listing operational editing is still deferred.
- Batch / Mixed Group remains a placeholder and will need the same seller-first terminology when implemented.
- Storefront buyer terminology was not changed in this group because Group 46 focuses on seller workflow language.
- Controlled hidden-listing creation for remote testing requires an authenticated seller session or approved remote test mutation path.

## Recommendation for Group 47

Build the first active-listing operational edit slice, starting with quantity and price updates for live listings. Keep it clearly separate from hidden setup editing, and preserve the distinction between broad setup edits and safe live operational changes.
