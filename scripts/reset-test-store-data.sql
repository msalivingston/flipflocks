-- Development utility only. Do not add this file to Supabase migrations.
-- Replace target_store_id before running.
-- Run the PREVIEW section first and confirm the counts before running the CLEANUP section.
--
-- WARNING:
-- The cleanup section deletes seller-generated development data for the target
-- store across live bird/hatching egg listings, Equipment & Supplies,
-- Processed Poultry, related media database rows, related orders, and safe
-- orphaned development customers. Do not run this against production data.

-- ============================================================
-- PREVIEW COUNTS
-- ============================================================

WITH params AS (
  SELECT '61435c52-e628-4413-aa5f-1705d11a3afa'::uuid AS target_store_id
),
target_listing_batches AS (
  SELECT lb.id
  FROM public.listing_batches lb, params
  WHERE lb.store_id = params.target_store_id
),
target_listing_batch_breeds AS (
  SELECT lbb.id
  FROM public.listing_batch_breeds lbb, params
  WHERE lbb.store_id = params.target_store_id
    AND lbb.listing_batch_id IN (SELECT id FROM target_listing_batches)
),
target_inventory_items AS (
  SELECT ii.id
  FROM public.inventory_items ii, params
  WHERE ii.store_id = params.target_store_id
    AND ii.listing_batch_id IN (SELECT id FROM target_listing_batches)
),
target_equipment_inventory_items AS (
  SELECT ei.id
  FROM public.equipment_inventory_items ei, params
  WHERE ei.store_id = params.target_store_id
),
target_processed_poultry_inventory_items AS (
  SELECT ppi.id
  FROM public.processed_poultry_inventory_items ppi, params
  WHERE ppi.store_id = params.target_store_id
),
blocking_order_items AS (
  SELECT oi.id, oi.order_id
  FROM public.order_items oi, params
  WHERE oi.store_id = params.target_store_id
    AND (
      oi.inventory_item_id IN (SELECT id FROM target_inventory_items)
      OR oi.listing_batch_id IN (SELECT id FROM target_listing_batches)
      OR oi.listing_batch_breed_id IN (SELECT id FROM target_listing_batch_breeds)
      OR oi.equipment_inventory_item_id IN (SELECT id FROM target_equipment_inventory_items)
      OR oi.processed_poultry_inventory_item_id IN (SELECT id FROM target_processed_poultry_inventory_items)
    )
),
blocking_orders AS (
  SELECT DISTINCT o.id, o.customer_id
  FROM public.orders o
  JOIN blocking_order_items boi ON boi.order_id = o.id
),
detached_canceled_orders AS (
  SELECT o.id, o.customer_id
  FROM public.orders o, params
  WHERE o.store_id = params.target_store_id
    AND o.order_status = 'canceled'
    AND EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id = o.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id = o.id
        AND (
          oi.inventory_item_id IS NOT NULL
          OR oi.listing_batch_id IS NOT NULL
          OR oi.listing_batch_breed_id IS NOT NULL
          OR oi.equipment_inventory_item_id IS NOT NULL
          OR oi.processed_poultry_inventory_item_id IS NOT NULL
        )
    )
),
target_orders AS (
  SELECT id, customer_id FROM blocking_orders
  UNION
  SELECT id, customer_id FROM detached_canceled_orders
),
target_order_refunds AS (
  SELECT r.id
  FROM public.order_refunds r
  WHERE r.order_id IN (SELECT id FROM target_orders)
),
customers_safe_to_remove AS (
  SELECT DISTINCT target_orders.customer_id AS id
  FROM target_orders
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.customer_id = target_orders.customer_id
      AND o.id NOT IN (SELECT id FROM target_orders)
  )
),
customers_preserved_with_other_orders AS (
  SELECT DISTINCT target_orders.customer_id AS id
  FROM target_orders
  WHERE EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.customer_id = target_orders.customer_id
      AND o.id NOT IN (SELECT id FROM target_orders)
  )
),
target_media_links AS (
  SELECT ml.id, ml.media_asset_id
  FROM public.media_links ml, params
  WHERE ml.store_id = params.target_store_id
    AND (
      (ml.entity_type = 'listing_batch' AND ml.entity_id IN (SELECT id FROM target_listing_batches))
      OR (ml.entity_type = 'listing_batch_breed' AND ml.entity_id IN (SELECT id FROM target_listing_batch_breeds))
      OR (ml.entity_type = 'inventory_item' AND ml.entity_id IN (SELECT id FROM target_inventory_items))
      OR (ml.entity_type = 'equipment_inventory_item' AND ml.entity_id IN (SELECT id FROM target_equipment_inventory_items))
      OR (ml.entity_type = 'processed_poultry_inventory_item' AND ml.entity_id IN (SELECT id FROM target_processed_poultry_inventory_items))
    )
),
removable_media_assets AS (
  SELECT ma.id
  FROM public.media_assets ma, params
  WHERE ma.store_id = params.target_store_id
    AND EXISTS (
      SELECT 1
      FROM target_media_links tml
      WHERE tml.media_asset_id = ma.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.media_links ml
      WHERE ml.media_asset_id = ma.id
        AND ml.id NOT IN (SELECT id FROM target_media_links)
    )
),
target_inventory_activity_events AS (
  SELECT iae.id
  FROM public.inventory_activity_events iae, params
  WHERE iae.store_id = params.target_store_id
    AND (
      iae.listing_batch_id IN (SELECT id FROM target_listing_batches)
      OR iae.listing_batch_breed_id IN (SELECT id FROM target_listing_batch_breeds)
      OR iae.inventory_item_id IN (SELECT id FROM target_inventory_items)
    )
)
SELECT 'listing_batches' AS record_type, COUNT(*) AS would_remove_count FROM target_listing_batches
UNION ALL
SELECT 'listing_batch_breeds', COUNT(*) FROM target_listing_batch_breeds
UNION ALL
SELECT 'inventory_items', COUNT(*) FROM target_inventory_items
UNION ALL
SELECT 'equipment_inventory_items', COUNT(*) FROM target_equipment_inventory_items
UNION ALL
SELECT 'processed_poultry_inventory_items', COUNT(*) FROM target_processed_poultry_inventory_items
UNION ALL
SELECT 'inventory_activity_events', COUNT(*) FROM target_inventory_activity_events
UNION ALL
SELECT 'blocking_order_items', COUNT(*) FROM blocking_order_items
UNION ALL
SELECT 'blocking_orders', COUNT(*) FROM blocking_orders
UNION ALL
SELECT 'detached_canceled_orders', COUNT(*) FROM detached_canceled_orders
UNION ALL
SELECT 'target_orders_total', COUNT(*) FROM target_orders
UNION ALL
SELECT 'order_events', COUNT(*) FROM public.order_events WHERE order_id IN (SELECT id FROM target_orders)
UNION ALL
SELECT 'order_refunds', COUNT(*) FROM target_order_refunds
UNION ALL
SELECT 'email_notifications', COUNT(*) FROM public.email_notifications WHERE order_id IN (SELECT id FROM target_orders)
UNION ALL
SELECT 'order_idempotency_keys', COUNT(*) FROM public.order_idempotency_keys WHERE order_id IN (SELECT id FROM target_orders)
UNION ALL
SELECT 'stripe_checkout_sessions', COUNT(*) FROM public.stripe_checkout_sessions WHERE order_id IN (SELECT id FROM target_orders)
UNION ALL
SELECT 'payment_provider_events', COUNT(*) FROM public.payment_provider_events
WHERE related_order_id IN (SELECT id FROM target_orders)
   OR related_refund_id IN (SELECT id FROM target_order_refunds)
UNION ALL
SELECT 'customers_safe_to_remove', COUNT(*) FROM customers_safe_to_remove
UNION ALL
SELECT 'customers_preserved_with_other_orders', COUNT(*) FROM customers_preserved_with_other_orders
UNION ALL
SELECT 'listing_media_links', COUNT(*) FROM target_media_links
UNION ALL
SELECT 'listing_media_assets_removable', COUNT(*) FROM removable_media_assets
ORDER BY record_type;

-- ============================================================
-- CLEANUP TRANSACTION
-- ============================================================

BEGIN;

CREATE TEMP TABLE cleanup_params ON COMMIT DROP AS
SELECT '61435c52-e628-4413-aa5f-1705d11a3afa'::uuid AS target_store_id;

CREATE TEMP TABLE cleanup_listing_batches ON COMMIT DROP AS
SELECT lb.id
FROM public.listing_batches lb
JOIN cleanup_params p ON p.target_store_id = lb.store_id;

CREATE TEMP TABLE cleanup_listing_batch_breeds ON COMMIT DROP AS
SELECT lbb.id
FROM public.listing_batch_breeds lbb
JOIN cleanup_params p ON p.target_store_id = lbb.store_id
WHERE lbb.listing_batch_id IN (SELECT id FROM cleanup_listing_batches);

CREATE TEMP TABLE cleanup_inventory_items ON COMMIT DROP AS
SELECT ii.id
FROM public.inventory_items ii
JOIN cleanup_params p ON p.target_store_id = ii.store_id
WHERE ii.listing_batch_id IN (SELECT id FROM cleanup_listing_batches);

CREATE TEMP TABLE cleanup_equipment_inventory_items ON COMMIT DROP AS
SELECT ei.id
FROM public.equipment_inventory_items ei
JOIN cleanup_params p ON p.target_store_id = ei.store_id;

CREATE TEMP TABLE cleanup_processed_poultry_inventory_items ON COMMIT DROP AS
SELECT ppi.id
FROM public.processed_poultry_inventory_items ppi
JOIN cleanup_params p ON p.target_store_id = ppi.store_id;

CREATE TEMP TABLE cleanup_order_items ON COMMIT DROP AS
SELECT oi.id, oi.order_id
FROM public.order_items oi
JOIN cleanup_params p ON p.target_store_id = oi.store_id
WHERE oi.inventory_item_id IN (SELECT id FROM cleanup_inventory_items)
   OR oi.listing_batch_id IN (SELECT id FROM cleanup_listing_batches)
   OR oi.listing_batch_breed_id IN (SELECT id FROM cleanup_listing_batch_breeds)
   OR oi.equipment_inventory_item_id IN (SELECT id FROM cleanup_equipment_inventory_items)
   OR oi.processed_poultry_inventory_item_id IN (SELECT id FROM cleanup_processed_poultry_inventory_items);

CREATE TEMP TABLE cleanup_blocking_orders ON COMMIT DROP AS
SELECT DISTINCT o.id, o.customer_id
FROM public.orders o
JOIN cleanup_order_items coi ON coi.order_id = o.id
JOIN cleanup_params p ON p.target_store_id = o.store_id;

CREATE TEMP TABLE cleanup_detached_canceled_orders ON COMMIT DROP AS
SELECT o.id, o.customer_id
FROM public.orders o
JOIN cleanup_params p ON p.target_store_id = o.store_id
WHERE o.order_status = 'canceled'
  AND EXISTS (
    SELECT 1
    FROM public.order_items oi
    WHERE oi.order_id = o.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.order_items oi
    WHERE oi.order_id = o.id
      AND (
        oi.inventory_item_id IS NOT NULL
        OR oi.listing_batch_id IS NOT NULL
        OR oi.listing_batch_breed_id IS NOT NULL
        OR oi.equipment_inventory_item_id IS NOT NULL
        OR oi.processed_poultry_inventory_item_id IS NOT NULL
      )
  );

CREATE TEMP TABLE cleanup_orders ON COMMIT DROP AS
SELECT id, customer_id FROM cleanup_blocking_orders
UNION
SELECT id, customer_id FROM cleanup_detached_canceled_orders;

CREATE TEMP TABLE cleanup_order_refunds ON COMMIT DROP AS
SELECT r.id
FROM public.order_refunds r
WHERE r.order_id IN (SELECT id FROM cleanup_orders);

CREATE TEMP TABLE cleanup_customers ON COMMIT DROP AS
SELECT DISTINCT co.customer_id AS id
FROM cleanup_orders co
WHERE NOT EXISTS (
  SELECT 1
  FROM public.orders o
  WHERE o.customer_id = co.customer_id
    AND o.id NOT IN (SELECT id FROM cleanup_orders)
);

CREATE TEMP TABLE cleanup_media_links ON COMMIT DROP AS
SELECT ml.id, ml.media_asset_id
FROM public.media_links ml
JOIN cleanup_params p ON p.target_store_id = ml.store_id
WHERE (ml.entity_type = 'listing_batch' AND ml.entity_id IN (SELECT id FROM cleanup_listing_batches))
   OR (ml.entity_type = 'listing_batch_breed' AND ml.entity_id IN (SELECT id FROM cleanup_listing_batch_breeds))
   OR (ml.entity_type = 'inventory_item' AND ml.entity_id IN (SELECT id FROM cleanup_inventory_items))
   OR (ml.entity_type = 'equipment_inventory_item' AND ml.entity_id IN (SELECT id FROM cleanup_equipment_inventory_items))
   OR (ml.entity_type = 'processed_poultry_inventory_item' AND ml.entity_id IN (SELECT id FROM cleanup_processed_poultry_inventory_items));

CREATE TEMP TABLE cleanup_media_assets ON COMMIT DROP AS
SELECT ma.id
FROM public.media_assets ma
JOIN cleanup_params p ON p.target_store_id = ma.store_id
WHERE EXISTS (
    SELECT 1
    FROM cleanup_media_links cml
    WHERE cml.media_asset_id = ma.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.media_links ml
    WHERE ml.media_asset_id = ma.id
      AND ml.id NOT IN (SELECT id FROM cleanup_media_links)
  );

CREATE TEMP TABLE cleanup_inventory_activity_events ON COMMIT DROP AS
SELECT iae.id
FROM public.inventory_activity_events iae
JOIN cleanup_params p ON p.target_store_id = iae.store_id
WHERE iae.listing_batch_id IN (SELECT id FROM cleanup_listing_batches)
   OR iae.listing_batch_breed_id IN (SELECT id FROM cleanup_listing_batch_breeds)
   OR iae.inventory_item_id IN (SELECT id FROM cleanup_inventory_items);

DELETE FROM public.payment_provider_events
WHERE related_order_id IN (SELECT id FROM cleanup_orders)
   OR related_refund_id IN (SELECT id FROM cleanup_order_refunds);

DELETE FROM public.stripe_checkout_sessions
WHERE order_id IN (SELECT id FROM cleanup_orders);

DELETE FROM public.order_events
WHERE order_id IN (SELECT id FROM cleanup_orders);

DELETE FROM public.email_notifications
WHERE order_id IN (SELECT id FROM cleanup_orders);

DELETE FROM public.order_idempotency_keys
WHERE order_id IN (SELECT id FROM cleanup_orders);

DELETE FROM public.order_refunds
WHERE id IN (SELECT id FROM cleanup_order_refunds);

DELETE FROM public.order_items
WHERE order_id IN (SELECT id FROM cleanup_orders);

DELETE FROM public.orders
WHERE id IN (SELECT id FROM cleanup_orders);

DELETE FROM public.customers
WHERE id IN (SELECT id FROM cleanup_customers);

DELETE FROM public.media_links
WHERE id IN (SELECT id FROM cleanup_media_links);

DELETE FROM public.media_assets
WHERE id IN (SELECT id FROM cleanup_media_assets);

DELETE FROM public.inventory_activity_events
WHERE id IN (SELECT id FROM cleanup_inventory_activity_events);

DELETE FROM public.inventory_items
WHERE id IN (SELECT id FROM cleanup_inventory_items);

DELETE FROM public.equipment_inventory_items
WHERE id IN (SELECT id FROM cleanup_equipment_inventory_items);

DELETE FROM public.processed_poultry_inventory_items
WHERE id IN (SELECT id FROM cleanup_processed_poultry_inventory_items);

DELETE FROM public.listing_batch_breeds
WHERE id IN (SELECT id FROM cleanup_listing_batch_breeds);

DELETE FROM public.listing_batches
WHERE id IN (SELECT id FROM cleanup_listing_batches);

COMMIT;
