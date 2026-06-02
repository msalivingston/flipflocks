# Reset Test Store Data

This document describes the development-only process for resetting seller-generated test data for a store while preserving application configuration and reference data.

This is not a database migration. It is a repeatable maintenance utility for development and testing environments.

## Purpose

Use this cleanup when a development store has accumulated test listings, test inventory, listing photos, test checkout/order data, or temporary records created while exercising the seller and storefront flows.

The goal is to return the store to a clean content state without removing the store itself, users, reference data, settings, or production-like configuration.

## When To Use

Use this process when:

- The application is in development or a non-production test environment.
- You want to remove seller-generated listing and order test data for a known test store.
- You want to preserve the store account and configuration.
- You have already confirmed the target store ID.
- You have reviewed the preview counts from `scripts/reset-test-store-data.sql`.

## When Not To Use

Do not use this process when:

- The store may contain real customer or production order history.
- You are unsure whether the target store ID is correct.
- You intend to reset authentication users, stores, species, breeds, lookup tables, or configuration.
- You need a schema change. This process is data cleanup only.
- You need to remove storage bucket files as well as database media records. This script removes database records only.

## Records Removed

The reset removes seller-generated development data tied to the target store:

- `listing_batches`
- `listing_batch_breeds`
- `inventory_items`
- `inventory_activity_events`
- listing media links
- removable listing media assets
- `order_items` associated with removed listings
- orders associated with removed listings
- order events
- order refunds
- email notifications
- order idempotency keys
- Stripe checkout session records tied to removed orders, when present
- payment provider event records tied to removed orders or refunds, when present
- development customers when they have no remaining orders
- detached canceled orders whose order items have no remaining inventory/listing references

## Records Preserved

The reset preserves:

- auth users
- stores
- species
- breeds
- lookup tables
- configuration tables
- onboarding tables
- billing tables
- pickup settings
- seller profile information
- seller breed profiles unless explicitly requested otherwise
- reference data
- production-like configuration
- customers who still have orders outside the cleanup set
- store media and seller breed profile media

## Dependency Order

Cleanup must be dependency-aware. The safe order is:

1. Identify target listing batches for the store.
2. Identify listing breed rows and inventory items tied to those listings.
3. Identify order items that reference those listing or inventory records.
4. Identify blocking orders from those order items.
5. Identify detached canceled orders by relationship state.
6. Identify customers that will be safe to remove after those orders are deleted.
7. Identify listing media links and media assets that will become unreferenced.
8. Identify inventory activity events while listing and inventory references still exist.
9. Delete order child records before deleting orders.
10. Delete orders before deleting customers.
11. Delete media links before deleting removable media assets.
12. Delete inventory activity events before deleting listing and inventory records.
13. Delete inventory items, listing breed rows, and listing batches.

## Verification Before Cleanup

Before running the delete section of `scripts/reset-test-store-data.sql`:

1. Confirm the `target_store_id` in the script.
2. Run the preview-count section.
3. Confirm the counts match the intended cleanup scope.
4. Confirm no protected configuration tables are included in the delete list.
5. Confirm customer counts distinguish customers safe to remove from customers with remaining orders.

Expected preview checks include:

- listing batches to remove
- listing breed rows to remove
- inventory items to remove
- inventory activity events to remove
- blocking orders
- blocking order items
- detached canceled orders
- customers safe to remove
- customers preserved because they still have other orders
- listing media links
- removable listing media assets

## Verification After Cleanup

After cleanup:

1. Run `scripts/orphan-check.sql`.
2. Confirm orphan counts are zero for listing, inventory, media link, inventory activity, and order item references.
3. Review `media_assets_with_no_remaining_media_links` separately.

`media_assets_with_no_remaining_media_links` should normally be zero after this cleanup. If it is not zero, it means there are uploaded media asset records with no database links. That can happen outside listing cleanup, so treat it as a review item rather than automatic proof that the reset failed.

## Orphan Check Process

The orphan check returns counts only. It verifies:

- `listing_batch_breeds` without a parent `listing_batch`
- `inventory_items` without a parent `listing_batch`
- `inventory_items` without a parent `listing_batch_breed`
- `media_links` pointing to missing `listing_batch` records
- `media_links` pointing to missing `listing_batch_breed` records
- `media_links` pointing to missing `inventory_item` records
- `media_assets` with no remaining `media_links`
- `inventory_activity_events` pointing to missing listing records
- `inventory_activity_events` pointing to missing listing breed records
- `inventory_activity_events` pointing to missing inventory records
- `order_items` pointing to missing inventory records
- `order_items` pointing to missing listing records
- `order_items` pointing to missing listing breed records

After a successful cleanup, all counts should be zero except possible unlinked media assets, which should be reviewed separately.

## Detached Canceled Order Correction

During the cleanup exercise, an early attempt assumed canceled manual orders could be identified with:

```sql
where order_source = 'seller_created'
```

That assumption was wrong for the actual development data. The relevant order used:

```sql
order_source = 'manual'
```

The final cleanup logic does not depend on `order_source`. It identifies detached canceled orders by relationship state:

- `order_status = 'canceled'`
- order items exist
- every order item has `inventory_item_id is null`
- every order item has `listing_batch_id is null`
- every order item has `listing_batch_breed_id is null`
- the order has no remaining inventory or listing references

Relationship-based cleanup is more reliable than filtering by `order_source` because labels can change during implementation, but the database relationships still describe whether an order is attached to listing inventory.

## Lessons Learned

1. Foreign key failures are expected and useful.
2. Order dependencies can block inventory and listing deletion.
3. Media cleanup must consider both `media_links` and `media_assets`.
4. Cleanup should be performed through dependency-aware transactions.
5. Orphan checks should always be run afterward.
6. Development data should generally be created through the application rather than manual inserts.
7. Investigation should focus on actual relationships rather than assumptions.

## Scripts

Use:

- `scripts/reset-test-store-data.sql` for preview counts and cleanup.
- `scripts/orphan-check.sql` after cleanup.

Both scripts are development utilities. They do not belong in `supabase/migrations`.
