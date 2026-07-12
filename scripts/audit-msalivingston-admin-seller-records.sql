-- Read-only audit for separating msalivingston@gmail.com from seller data.
-- Run in the Supabase SQL editor before any cleanup. This script does not
-- delete, update, or insert records.

BEGIN;

CREATE TEMP TABLE target_platform_admin_user ON COMMIT DROP AS
SELECT
  id AS user_id,
  email,
  created_at,
  confirmed_at,
  last_sign_in_at
FROM auth.users
WHERE lower(email) = lower('msalivingston@gmail.com');

SELECT 'auth_user' AS audit_section, *
FROM target_platform_admin_user;

SELECT
  'user_roles' AS audit_section,
  user_roles.id,
  user_roles.user_id,
  target_platform_admin_user.email,
  user_roles.role,
  user_roles.store_id,
  stores.store_name,
  stores.store_slug,
  user_roles.created_at
FROM target_platform_admin_user
JOIN public.user_roles
  ON user_roles.user_id = target_platform_admin_user.user_id
LEFT JOIN public.stores
  ON stores.id = user_roles.store_id
ORDER BY user_roles.store_id NULLS FIRST, user_roles.role;

CREATE TEMP TABLE target_owned_stores ON COMMIT DROP AS
SELECT stores.*
FROM target_platform_admin_user
JOIN public.stores
  ON stores.owner_user_id = target_platform_admin_user.user_id;

CREATE TEMP TABLE target_member_stores ON COMMIT DROP AS
SELECT stores.*, user_roles.role AS member_role
FROM target_platform_admin_user
JOIN public.user_roles
  ON user_roles.user_id = target_platform_admin_user.user_id
 AND user_roles.store_id IS NOT NULL
 AND user_roles.role IN ('seller', 'staff')
JOIN public.stores
  ON stores.id = user_roles.store_id;

SELECT
  'owned_stores' AS audit_section,
  id AS store_id,
  store_name,
  store_slug,
  store_status,
  storefront_mode,
  storefront_enabled,
  created_at,
  updated_at
FROM target_owned_stores
ORDER BY created_at;

SELECT
  'store_memberships' AS audit_section,
  id AS store_id,
  store_name,
  store_slug,
  member_role,
  owner_user_id
FROM target_member_stores
ORDER BY store_slug;

WITH target_stores AS (
  SELECT id FROM target_owned_stores
  UNION
  SELECT id FROM target_member_stores
)
SELECT 'seller_billing_status' AS record_type, COUNT(*) AS record_count
FROM public.seller_billing_status
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'seller_onboarding_state', COUNT(*)
FROM public.seller_onboarding_state
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'seller_terms_acceptances', COUNT(*)
FROM public.seller_terms_acceptances
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'store_pickup_options', COUNT(*)
FROM public.store_pickup_options
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'storefront_discovery_settings', COUNT(*)
FROM public.storefront_discovery_settings
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'seller_breed_profiles', COUNT(*)
FROM public.seller_breed_profiles
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'listing_batches', COUNT(*)
FROM public.listing_batches
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'listing_batch_breeds', COUNT(*)
FROM public.listing_batch_breeds
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'inventory_items', COUNT(*)
FROM public.inventory_items
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'equipment_inventory_items', COUNT(*)
FROM public.equipment_inventory_items
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'processed_poultry_inventory_items', COUNT(*)
FROM public.processed_poultry_inventory_items
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'media_assets', COUNT(*)
FROM public.media_assets
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'media_links', COUNT(*)
FROM public.media_links
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'customers', COUNT(*)
FROM public.customers
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'customer_timeline_notes', COUNT(*)
FROM public.customer_timeline_notes
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'orders', COUNT(*)
FROM public.orders
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'order_items', COUNT(*)
FROM public.order_items
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'order_events', COUNT(*)
FROM public.order_events
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'order_refunds', COUNT(*)
FROM public.order_refunds
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'stripe_checkout_sessions', COUNT(*)
FROM public.stripe_checkout_sessions
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'payment_provider_events', COUNT(*)
FROM public.payment_provider_events
WHERE related_store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'email_notifications', COUNT(*)
FROM public.email_notifications
WHERE store_id IN (SELECT id FROM target_stores)
UNION ALL
SELECT 'inventory_activity_events', COUNT(*)
FROM public.inventory_activity_events
WHERE store_id IN (SELECT id FROM target_stores)
ORDER BY record_type;

WITH target_stores AS (
  SELECT id, store_name, store_slug FROM target_owned_stores
  UNION
  SELECT id, store_name, store_slug FROM target_member_stores
)
SELECT
  'blocking_meaningful_data' AS audit_section,
  target_stores.id AS store_id,
  target_stores.store_name,
  target_stores.store_slug,
  (SELECT COUNT(*) FROM public.orders WHERE orders.store_id = target_stores.id) AS orders,
  (SELECT COUNT(*) FROM public.customers WHERE customers.store_id = target_stores.id) AS customers,
  (SELECT COUNT(*) FROM public.inventory_items WHERE inventory_items.store_id = target_stores.id) AS inventory_items,
  (SELECT COUNT(*) FROM public.equipment_inventory_items WHERE equipment_inventory_items.store_id = target_stores.id) AS equipment_inventory_items,
  (SELECT COUNT(*) FROM public.processed_poultry_inventory_items WHERE processed_poultry_inventory_items.store_id = target_stores.id) AS processed_poultry_inventory_items
FROM target_stores
ORDER BY target_stores.store_slug;

ROLLBACK;
