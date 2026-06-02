SELECT
  'listing_batch_breeds_without_parent_listing_batch' AS orphan_check,
  COUNT(*) AS orphan_count
FROM public.listing_batch_breeds lbb
LEFT JOIN public.listing_batches lb ON lb.id = lbb.listing_batch_id
WHERE lb.id IS NULL

UNION ALL

SELECT
  'inventory_items_without_parent_listing_batch',
  COUNT(*)
FROM public.inventory_items ii
LEFT JOIN public.listing_batches lb ON lb.id = ii.listing_batch_id
WHERE lb.id IS NULL

UNION ALL

SELECT
  'inventory_items_without_parent_listing_batch_breed',
  COUNT(*)
FROM public.inventory_items ii
LEFT JOIN public.listing_batch_breeds lbb ON lbb.id = ii.listing_batch_breed_id
WHERE lbb.id IS NULL

UNION ALL

SELECT
  'media_links_missing_listing_batch',
  COUNT(*)
FROM public.media_links ml
LEFT JOIN public.listing_batches lb ON lb.id = ml.entity_id
WHERE ml.entity_type = 'listing_batch'
  AND lb.id IS NULL

UNION ALL

SELECT
  'media_links_missing_listing_batch_breed',
  COUNT(*)
FROM public.media_links ml
LEFT JOIN public.listing_batch_breeds lbb ON lbb.id = ml.entity_id
WHERE ml.entity_type = 'listing_batch_breed'
  AND lbb.id IS NULL

UNION ALL

SELECT
  'media_links_missing_inventory_item',
  COUNT(*)
FROM public.media_links ml
LEFT JOIN public.inventory_items ii ON ii.id = ml.entity_id
WHERE ml.entity_type = 'inventory_item'
  AND ii.id IS NULL

UNION ALL

SELECT
  'media_assets_with_no_remaining_media_links',
  COUNT(*)
FROM public.media_assets ma
LEFT JOIN public.media_links ml ON ml.media_asset_id = ma.id
WHERE ml.id IS NULL

UNION ALL

SELECT
  'inventory_activity_events_missing_listing_batch',
  COUNT(*)
FROM public.inventory_activity_events iae
LEFT JOIN public.listing_batches lb ON lb.id = iae.listing_batch_id
WHERE iae.listing_batch_id IS NOT NULL
  AND lb.id IS NULL

UNION ALL

SELECT
  'inventory_activity_events_missing_listing_batch_breed',
  COUNT(*)
FROM public.inventory_activity_events iae
LEFT JOIN public.listing_batch_breeds lbb ON lbb.id = iae.listing_batch_breed_id
WHERE iae.listing_batch_breed_id IS NOT NULL
  AND lbb.id IS NULL

UNION ALL

SELECT
  'inventory_activity_events_missing_inventory_item',
  COUNT(*)
FROM public.inventory_activity_events iae
LEFT JOIN public.inventory_items ii ON ii.id = iae.inventory_item_id
WHERE iae.inventory_item_id IS NOT NULL
  AND ii.id IS NULL

UNION ALL

SELECT
  'order_items_missing_inventory_item',
  COUNT(*)
FROM public.order_items oi
LEFT JOIN public.inventory_items ii ON ii.id = oi.inventory_item_id
WHERE oi.inventory_item_id IS NOT NULL
  AND ii.id IS NULL

UNION ALL

SELECT
  'order_items_missing_listing_batch',
  COUNT(*)
FROM public.order_items oi
LEFT JOIN public.listing_batches lb ON lb.id = oi.listing_batch_id
WHERE oi.listing_batch_id IS NOT NULL
  AND lb.id IS NULL

UNION ALL

SELECT
  'order_items_missing_listing_batch_breed',
  COUNT(*)
FROM public.order_items oi
LEFT JOIN public.listing_batch_breeds lbb ON lbb.id = oi.listing_batch_breed_id
WHERE oi.listing_batch_breed_id IS NOT NULL
  AND lbb.id IS NULL

ORDER BY orphan_check;
