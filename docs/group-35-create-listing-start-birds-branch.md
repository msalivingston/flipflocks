# Group 35 Create Listing Start & Birds Branch Selection

Group 35 turns `/dashboard/listings/new` into the first real step of the create-listing flow.

This group does not build the full create listing form, media upload, listing edit/detail pages, duplicate listing, Equipment & Supplies backend, Stripe, or new backend objects.

## Design Review

The first create step should be a decision screen, not a data-entry form. Sellers need to quickly choose what they are trying to list without seeing backend concepts or future workflow complexity.

The screen uses two top-level choices:

- Birds
- Equipment & Supplies

Birds is active because live animal listings are the V1 priority. Equipment & Supplies remains visible but disabled so sellers understand it is planned without mistaking it for an available workflow.

The Birds branch then asks how the seller thinks about the listing:

- Single Breed / Offering
- Batch / Mixed Group

Both options intentionally lead to placeholder continuation routes. The next group can build the actual form on top of these routes.

## Route and Component Plan

Implemented routes:

- `/dashboard/listings/new`
- `/dashboard/listings/new/birds`
- `/dashboard/listings/new/birds/single`
- `/dashboard/listings/new/birds/batch`

Implemented component:

- `CreateListingStart`
- `BirdsBranchSelection`
- `BirdWorkflowPlaceholder`

No data is fetched. The existing Group 33 `SellerAppShell` handles authentication and seller context.

## Files Changed

- `app/dashboard/listings/new/page.tsx`
- `app/dashboard/listings/new/create-listing-start.tsx`
- `app/dashboard/listings/new/birds/page.tsx`
- `app/dashboard/listings/new/birds/single/page.tsx`
- `app/dashboard/listings/new/birds/batch/page.tsx`
- `docs/group-35-create-listing-start-birds-branch.md`

## Backend Review

No backend blocker was found.

This group is static protected UI only:

- no Supabase reads
- no Supabase writes
- no RPC calls
- no storage/media work
- no schema changes

## Manual Smoke Test

1. Sign in as a seller.
2. Open `/dashboard/listings`.
3. Click `Create Listing`.
4. Confirm `/dashboard/listings/new` shows Birds and Equipment & Supplies.
5. Confirm Equipment & Supplies is visibly coming later and cannot be selected.
6. Click Birds.
7. Confirm `/dashboard/listings/new/birds` shows Single Breed / Offering and Batch / Mixed Group.
8. Open each branch route.
9. Confirm each route shows a clear placeholder and a way back.
10. Check the flow on a narrow/mobile viewport for readable touch targets.

## UX Compromises

- Equipment & Supplies is disabled rather than hidden because sellers should see that it is planned.
- The final branch routes are placeholders because the full bird listing form is intentionally outside this group.
- No draft behavior appears yet because no data-entry form exists in this slice.

## Recommendation for Group 36

Build the first real Bird Listing Basics step:

- shared bird listing draft state shape
- species/breed selection from existing reference and seller breed profile support
- hatch/origin date
- available date
- listing-level base price and auto-pricing intent
- internal label and seller notes

Keep media upload and publish/save behavior as separate later slices unless Group 36 explicitly expands scope.

