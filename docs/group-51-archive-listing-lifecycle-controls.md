# Group 51 - Archive Listing Lifecycle Controls

## Design Summary

Group 51 adds a safe archive lifecycle action for seller listings. Archive is a retirement state, not delete behavior.

The implementation reuses the existing listing batch visibility architecture and does not add migrations, new backend functions, storefront changes, cleanup jobs, or destructive delete behavior.

## Lifecycle States Supported

The seller UI now supports these listing lifecycle paths:

- hidden listings: setup editing, publish readiness, publish, archive
- active listings: operational edits, public content maintenance, return to hidden, archive
- archived listings: read-only record view, restore to hidden

Archived listings are not editable. Restore returns an archived listing to hidden/private, not directly to live.

## Backend Function Used

Archive and restore use:

- `seller_set_listing_batch_visibility(...)`

The verified listing batch visibility values include:

- `active`
- `hidden`
- `sold_out`
- `archived`

Public storefront projections already expose only `active` and `sold_out` listing batches, so `archived` listings are hidden from buyers without a storefront query change.

## Archive Behavior

Sellers can archive hidden or active listings.

Archiving:

- removes the listing from buyer-facing storefront visibility
- preserves photos
- preserves bird groups
- preserves prices and quantities
- preserves public description, internal label, and seller notes
- leaves the seller detail page available as a read-only record

The seller must confirm before archiving. The confirmation explains that the listing is hidden from buyers and no listing data is deleted.

## Restore Behavior

Restore is included because the existing lifecycle RPC can safely move a listing batch from archived to hidden.

Restoring:

- moves the listing back to hidden/private
- keeps it off the storefront
- restores setup editing and publish readiness controls
- does not publish the listing

This provides a recovery path without adding delete, restore-to-live, or archive-management systems.

## Seller-Facing Terminology

The UI uses practical wording:

- `Archive listing`
- `Archived listings are read-only.`
- `Restore to Hidden`
- `This removes the listing from your storefront while keeping all listing information for your records.`

The UI does not expose raw enum names, RPC names, projection names, or database terminology to sellers.

## Deferred

These remain intentionally deferred:

- hard delete
- permanent delete
- bulk archive
- archive cleanup jobs
- sold-out automation
- buyer notifications
- restore directly to active/live
- archive management views beyond the existing listings filters

## Recommendation for Group 52

Review seller listing overview lifecycle visibility next. The likely next slice is making archived listings easier to find and distinguish in `/dashboard/listings`, without adding bulk actions or a full archive-management system.
