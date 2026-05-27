# Group 34 Listings Foundation UI

Group 34 replaces the `/dashboard/listings` placeholder with a real seller listings overview inside the Group 33 seller shell.

This group does not add backend objects, migrations, media upload UI, listing edit/detail workflows, Equipment & Supplies, Stripe, order management, customer management, reports, or marketplace discovery.

## Design Review

The listings page needs to support two seller mental models:

- By Listing / Batch: useful for hatch groups, availability dates, batch-level pricing, and operational planning.
- By Breed: useful when sellers answer buyer questions by breed availability.

The UI stays mobile-first:

- Cards are the primary mobile presentation.
- Desktop gets a denser table for By Listing / Batch.
- By Breed uses cards on all breakpoints because grouped breed summaries are easier to scan in compact blocks.

The page intentionally uses seller-facing language:

- "Ready"
- "Available"
- "Breed"
- "Create Listing"
- "Storefront status"

It avoids exposing backend terms such as inventory item IDs, breed row IDs, RPCs, or table names in the UI.

## Data Source

Exact data source:

- `seller_inventory_management`

Reason:

- Existing Group 27/31 support says listing lists can be built from this seller-private projection.
- It contains row-level listing, breed, inventory, price, quantity, status, and availability fields.
- It is already scoped by ownership/security barrier behavior and granted to authenticated users.

Security assumption:

- The frontend filters by the active `store_id` from `get_seller_context()`.
- The projection itself remains the security boundary for seller-private listing reads.
- No direct listing table mutations are used in this group.

Duplicate listing:

- `seller_duplicate_listing(...)` exists.
- This group does not invoke it because duplication requires a date/visibility confirmation flow that belongs with listing actions/editing.

Media:

- `seller_media_management` and media RPCs exist from Group 32B.
- This group does not query or display media because full media management is not in scope.

## Route and Component Plan

Changed route:

- `/dashboard/listings`

Files:

- `app/dashboard/listings/page.tsx`
- `app/dashboard/listings/listings-foundation.tsx`

Shared helpers:

- `SellerTabs`
- `FilterControl`

Types:

- `SellerInventoryManagementRow`

## Implemented UI

The Listings page now includes:

- Create Listing action linking to `/dashboard/listings/new`.
- View toggle:
  - By Listing / Batch.
  - By Breed.
- Search across breed, species, internal label, inventory type, and custom row label.
- Status filter:
  - All statuses.
  - Active.
  - Hidden.
  - Sold out.
  - Archived.
- Availability filter:
  - All availability.
  - Ready now.
  - Reserve now.
  - Sold out.
  - Hidden.
  - Unavailable.
  - Archived.
- Loading state.
- Error state.
- Empty state for no listings.
- Empty state for filters with no results.
- Mobile listing cards.
- Desktop listing table.
- Breed summary cards.
- Status badges using the existing shared pattern.

## Edge Cases

- No seller session: handled by the Group 33 shell redirect to `/login`.
- No seller context: handled by the Group 33 shell error state.
- No listing rows: page shows a seller-friendly empty state with Create Listing.
- Filters with no matches: page shows a filter-specific empty state.
- Mixed status rows in one listing: listing summary prefers the most operationally useful availability state, with `ready_now` taking precedence over `reserve_now`, then hidden/sold-out/unavailable/archive states.
- Missing prices: shown as "Not priced".
- Missing dates: shown as "Not set".

## Proven Blockers

No backend blocker was proven for the Listings foundation overview.

Known deferred work:

- Listing create workflow.
- Listing detail/edit pages.
- Duplicate listing confirmation/date flow.
- Media upload/gallery UI.
- Equipment & Supplies.

## Manual Smoke Test

1. Sign in as a seller.
2. Open `/dashboard/listings`.
3. Confirm the page renders inside the seller shell.
4. Confirm "Create Listing" opens `/dashboard/listings/new`.
5. Toggle between "By Listing / Batch" and "By Breed".
6. Search by an existing breed or species.
7. Change Status and Availability filters.
8. On a narrow/mobile viewport, confirm listing cards remain readable and touch-friendly.
9. On a desktop viewport, confirm the listing table is visible for By Listing / Batch.
10. Confirm no seller IDs, store IDs, or raw inventory IDs appear in visible UI.

## Follow-up Recommendations for Group 35

Recommended next slice:

- Listing create start and Birds branch selection.
- Keep Equipment & Supplies as a deferred option with clear copy.
- Do not implement media upload in the create flow until the Group 32B upload contract is intentionally wired.

Useful later polish:

- Add real listing detail/edit placeholder routes so disabled edit controls can become links.
- Add duplicate listing action with required new origin/available dates.
- Add persisted listing view/filter preferences per device.
- Consider seller media thumbnails after listing image display is deliberately in scope.

