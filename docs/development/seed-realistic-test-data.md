# Seed Realistic Test Data

This is a development-only process for loading realistic FlockFront test data across multiple seller storefronts. Do not add this script to Supabase migrations.

## Required Auth Users

Create these Supabase Auth users before running the script:

```text
willow@example.test
highmesa@example.test
cedarridge@example.test
gunnisonhatchery@example.test
rockymountainfarmsupply@example.test
```

The script does not create or delete Auth users. Each email must match exactly one Auth user.

## What It Creates

Run:

```text
scripts/seed-realistic-test-data.sql
```

The script seeds these stores:

- `willow-creek-poultry`: large chicken operation with chicks, pullets, layers, multiple breeds, sold-out rows, and future availability.
- `high-mesa-waterfowl`: ducks and geese.
- `cedar-ridge-homestead`: intentionally messy but valid mixed-species seller, including hidden draft-style data and processed poultry.
- `gunnison-valley-hatchery`: hatching-eggs focused.
- `rocky-mountain-farm-supply`: equipment and supplies only.

It creates or updates the real ownership/setup records:

- `stores`
- `user_roles`
- `seller_billing_status`
- `seller_onboarding_state`
- `seller_terms_acceptances`
- `store_pickup_options`

It then rebuilds seller-generated content for those five stores:

- `seller_breed_profiles`
- `listing_batches`
- `listing_batch_breeds`
- `inventory_items`
- `equipment_inventory_items`
- `processed_poultry_inventory_items`
- `media_assets`
- `media_links`
- `customers`

## Safety And Idempotency

The script is repeatable for the five configured slugs/emails. It refuses to run if a configured store slug already belongs to a different Auth user.

On each run, it deletes and rebuilds seller-generated content for the five configured stores. That includes existing orders, customers, inventory, media database rows, equipment, and processed poultry for those stores. Use only in development or disposable test environments.

The script does not directly launch stores. Stores remain in their current lifecycle state. New stores are created as `draft`; existing live stores stay live. `storefront_enabled` is set to `true`, but public availability still requires `store_status = live`, a hosted/embedded mode, and no admin hold.

## Orders

Orders are not seeded by this script.

The current trusted order path, `create_pay_at_pickup_order(...)`, safely handles order numbers, snapshots, inventory decrement, and notifications. It is a service-role checkout path and requires a live, enabled storefront. This seed script does not bypass lifecycle rules to create that runtime.

To create realistic orders after seeding:

1. Log in as each seller and launch the store through Store Admin, or use the existing trusted launch Edge Function.
2. Keep `storefront_enabled = true`.
3. Use the public storefront checkout flow or the existing pay-at-pickup Edge Function.

## Media Note

The script creates media database records and links using deterministic development storage paths such as:

```text
seller-media/dev-test-data/willow-creek-poultry/willow-spring-chicks-gallery-0.webp
```

SQL cannot upload the actual Supabase Storage objects. If image rendering matters for a test pass, upload matching files to the configured bucket/path or replace the seeded media with uploads through the existing media workflow.

## Verification Queries

Confirm the seed summary returned expected counts, then optionally run:

```sql
select
  stores.store_slug,
  stores.store_status,
  stores.storefront_enabled,
  count(distinct listing_batches.id) as listing_batches,
  count(distinct inventory_items.id) as bird_inventory_items,
  count(distinct equipment_inventory_items.id) as equipment_items,
  count(distinct processed_poultry_inventory_items.id) as processed_items,
  count(distinct customers.id) as customers
from public.stores
left join public.listing_batches on listing_batches.store_id = stores.id
left join public.inventory_items on inventory_items.store_id = stores.id
left join public.equipment_inventory_items on equipment_inventory_items.store_id = stores.id
left join public.processed_poultry_inventory_items on processed_poultry_inventory_items.store_id = stores.id
left join public.customers on customers.store_id = stores.id
where stores.store_slug in (
  'willow-creek-poultry',
  'high-mesa-waterfowl',
  'cedar-ridge-homestead',
  'gunnison-valley-hatchery',
  'rocky-mountain-farm-supply'
)
group by stores.store_slug, stores.store_status, stores.storefront_enabled
order by stores.store_slug;
```

Check sold-out and future availability:

```sql
select
  stores.store_slug,
  count(*) filter (where inventory_items.quantity_available = 0) as sold_out_rows,
  count(*) filter (where listing_batches.available_date > current_date) as future_batches
from public.stores
join public.listing_batches on listing_batches.store_id = stores.id
join public.inventory_items on inventory_items.listing_batch_id = listing_batches.id
where stores.store_slug in (
  'willow-creek-poultry',
  'high-mesa-waterfowl',
  'cedar-ridge-homestead',
  'gunnison-valley-hatchery'
)
group by stores.store_slug
order by stores.store_slug;
```

After cleanup work, run:

```text
scripts/orphan-check.sql
```

## Cleanup / Reset

To reset one store while preserving the store account/settings, use:

```text
scripts/reset-test-store-data.sql
```

Set `target_store_id`, run the preview section, review counts, then run the cleanup section.

To remove a test store entirely while preserving the Auth user, use:

```text
scripts/remove-test-seller-store.sql
```

Update the email and slug first. The script is scoped by both values and refuses ownership mismatches.
