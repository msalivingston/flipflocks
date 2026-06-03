-- Development utility only. Do not add this file to Supabase migrations.
--
-- This script removes the store-side records for one configured test seller/store.
-- It is intentionally scoped by both Auth email and store slug.
--
-- This script does not delete the Supabase Auth user. Delete that user manually
-- in Supabase Auth if you want to remove the test login completely.
--
-- Warning:
-- Deleting the test store cascades through store-owned development records such
-- as listings, inventory, orders, customers, media database rows, onboarding,
-- billing, terms, pickup options, and seller breed profiles. Storage bucket
-- objects are not removed by this database script.

BEGIN;

CREATE TEMP TABLE dev_test_seller_store_remove_params ON COMMIT DROP AS
SELECT
  'seller2@example.test'::text AS test_user_email,
  'test-seller-two'::text AS test_store_slug;

DO $$
DECLARE
  v_params record;
  v_auth_user_id uuid;
  v_auth_user_count integer;
  v_store_id uuid;
  v_store_owner_user_id uuid;
BEGIN
  SELECT *
  INTO v_params
  FROM dev_test_seller_store_remove_params;

  IF v_params.test_user_email IS NULL
    OR v_params.test_user_email = ''
    OR v_params.test_store_slug IS NULL
    OR v_params.test_store_slug = '' THEN
    RAISE EXCEPTION 'Set test_user_email and test_store_slug before running this script.';
  END IF;

  SELECT
    COUNT(*),
    (ARRAY_AGG(id ORDER BY created_at ASC, id::text ASC))[1]
  INTO v_auth_user_count, v_auth_user_id
  FROM auth.users
  WHERE lower(email) = lower(v_params.test_user_email);

  IF v_auth_user_count = 0 THEN
    RAISE EXCEPTION 'No Supabase Auth user found for email %. The store-side cleanup was not run.', v_params.test_user_email;
  END IF;

  IF v_auth_user_count > 1 THEN
    RAISE EXCEPTION 'More than one Supabase Auth user matched email %. Cleanup requires a unique test email.', v_params.test_user_email;
  END IF;

  SELECT id, owner_user_id
  INTO v_store_id, v_store_owner_user_id
  FROM public.stores
  WHERE store_slug = v_params.test_store_slug;

  IF v_store_id IS NULL THEN
    RAISE NOTICE 'No store found for slug %. Nothing to remove.', v_params.test_store_slug;
    RETURN;
  END IF;

  IF v_store_owner_user_id <> v_auth_user_id THEN
    RAISE EXCEPTION 'Store slug % belongs to a different auth user. Cleanup refused to run.', v_params.test_store_slug;
  END IF;

  DELETE FROM public.payment_provider_events
  WHERE related_store_id = v_store_id;

  DELETE FROM public.admin_activity_events
  WHERE target_store_id = v_store_id;

  DELETE FROM public.user_roles
  WHERE user_id = v_auth_user_id
    AND store_id = v_store_id
    AND role IN ('seller', 'staff');

  UPDATE public.stores
  SET default_pickup_option_id = NULL
  WHERE id = v_store_id;

  DELETE FROM public.stores
  WHERE id = v_store_id
    AND owner_user_id = v_auth_user_id
    AND store_slug = v_params.test_store_slug;
END $$;

SELECT
  params.test_user_email,
  params.test_store_slug,
  EXISTS (
    SELECT 1
    FROM auth.users
    WHERE lower(auth.users.email) = lower(params.test_user_email)
  ) AS auth_user_still_exists,
  EXISTS (
    SELECT 1
    FROM public.stores
    WHERE stores.store_slug = params.test_store_slug
  ) AS store_still_exists,
  COUNT(user_roles.id) AS remaining_store_scoped_roles
FROM dev_test_seller_store_remove_params params
LEFT JOIN auth.users
  ON lower(auth.users.email) = lower(params.test_user_email)
LEFT JOIN public.stores
  ON stores.store_slug = params.test_store_slug
LEFT JOIN public.user_roles
  ON user_roles.user_id = auth.users.id
 AND user_roles.store_id = stores.id
GROUP BY
  params.test_user_email,
  params.test_store_slug;

COMMIT;
