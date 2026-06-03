-- Development utility only. Do not add this file to Supabase migrations.
-- This script is idempotent for the configured test email and store slug.
--
-- Before running:
-- 1. Create the test seller in Supabase Auth.
-- 2. Confirm the Auth user can sign in with email/password.
-- 3. Edit the params CTE below so test_user_email and test_store_slug are unique.
--
-- This script does not:
-- - create auth.users records
-- - change RLS
-- - change triggers
-- - directly set protected store lifecycle/admin fields
--
-- The store is created in the safest allowed default state:
-- - store_status defaults to draft
-- - storefront_enabled defaults to false
-- - storefront_mode defaults to hosted
-- - admin_hold_reason defaults to null

BEGIN;

CREATE TEMP TABLE dev_test_seller_store_params ON COMMIT DROP AS
SELECT
  'seller2@example.test'::text AS test_user_email,
  'test-seller-two'::text AS test_store_slug,
  'Test Seller Two'::text AS test_store_name,
  'Development-only second seller for multi-seller testing.'::text AS test_store_tagline,
  'Testville'::text AS public_city,
  'CO'::text AS public_state,
  'US'::text AS public_country,
  'Development-only test store for multi-seller behavior.'::text AS about_text,
  'seller2@example.test'::text AS public_email,
  'seller2@example.test'::text AS communication_email,
  'seller2@example.test'::text AS order_notification_email,
  'Farm pickup by appointment.'::text AS pickup_location_text,
  'Pickup details are confirmed after the order is placed.'::text AS pickup_policy,
  'Please contact the seller if pickup plans need to change.'::text AS cancellation_policy,
  'Bring a clean carrier and confirm your pickup window before arriving.'::text AS pickup_instructions,
  'dev-test-seller-terms-v1'::text AS terms_version,
  'Farm pickup'::text AS pickup_option_label,
  'Coordinate a pickup time directly with the seller.'::text AS pickup_option_description;

DO $$
DECLARE
  v_params record;
  v_auth_user_id uuid;
  v_auth_user_count integer;
  v_existing_store_id uuid;
  v_existing_store_owner_user_id uuid;
  v_store_id uuid;
  v_pickup_option_id uuid;
BEGIN
  SELECT *
  INTO v_params
  FROM dev_test_seller_store_params;

  IF v_params.test_user_email IS NULL
    OR trim(v_params.test_user_email) = ''
    OR v_params.test_store_slug IS NULL
    OR trim(v_params.test_store_slug) = '' THEN
    RAISE EXCEPTION 'Set a unique test_user_email and test_store_slug before running this script.';
  END IF;

  IF v_params.test_store_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'test_store_slug % is invalid. Use lowercase letters, numbers, and single hyphens.', v_params.test_store_slug;
  END IF;

  SELECT
    COUNT(*),
    (ARRAY_AGG(id ORDER BY created_at ASC, id::text ASC))[1]
  INTO v_auth_user_count, v_auth_user_id
  FROM auth.users
  WHERE lower(email) = lower(v_params.test_user_email);

  IF v_auth_user_count = 0 THEN
    RAISE EXCEPTION 'No Supabase Auth user found for email %. Create the Auth user first, then rerun this script.', v_params.test_user_email;
  END IF;

  IF v_auth_user_count > 1 THEN
    RAISE EXCEPTION 'More than one Supabase Auth user matched email %. Use a unique test email.', v_params.test_user_email;
  END IF;

  SELECT id, owner_user_id
  INTO v_existing_store_id, v_existing_store_owner_user_id
  FROM public.stores
  WHERE store_slug = v_params.test_store_slug;

  IF v_existing_store_id IS NOT NULL
    AND v_existing_store_owner_user_id <> v_auth_user_id THEN
    RAISE EXCEPTION 'Store slug % already belongs to a different auth user. Choose a unique test_store_slug.', v_params.test_store_slug;
  END IF;

  IF v_existing_store_id IS NULL THEN
    INSERT INTO public.stores (
      owner_user_id,
      store_name,
      store_tagline,
      store_slug,
      public_city,
      public_state,
      public_country,
      about_text,
      pickup_policy,
      cancellation_policy,
      pickup_instructions,
      pickup_location_text,
      public_email,
      show_public_email,
      communication_email,
      order_notification_email,
      currency
    )
    VALUES (
      v_auth_user_id,
      v_params.test_store_name,
      v_params.test_store_tagline,
      v_params.test_store_slug,
      v_params.public_city,
      v_params.public_state,
      v_params.public_country,
      v_params.about_text,
      v_params.pickup_policy,
      v_params.cancellation_policy,
      v_params.pickup_instructions,
      v_params.pickup_location_text,
      v_params.public_email,
      false,
      v_params.communication_email,
      v_params.order_notification_email,
      'usd'
    )
    RETURNING id
    INTO v_store_id;
  ELSE
    UPDATE public.stores
    SET
      store_name = v_params.test_store_name,
      store_tagline = v_params.test_store_tagline,
      store_slug = v_params.test_store_slug,
      public_city = v_params.public_city,
      public_state = v_params.public_state,
      public_country = v_params.public_country,
      about_text = v_params.about_text,
      pickup_policy = v_params.pickup_policy,
      cancellation_policy = v_params.cancellation_policy,
      pickup_instructions = v_params.pickup_instructions,
      pickup_location_text = v_params.pickup_location_text,
      public_email = v_params.public_email,
      show_public_email = false,
      communication_email = v_params.communication_email,
      order_notification_email = v_params.order_notification_email,
      currency = 'usd'
    WHERE id = v_existing_store_id
      AND owner_user_id = v_auth_user_id
    RETURNING id
    INTO v_store_id;
  END IF;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Could not create or update test store for slug %.', v_params.test_store_slug;
  END IF;

  INSERT INTO public.user_roles (user_id, role, store_id)
  SELECT v_auth_user_id, 'seller', v_store_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = v_auth_user_id
      AND role = 'seller'
      AND store_id = v_store_id
  );

  INSERT INTO public.seller_billing_status (
    store_id,
    billing_plan,
    subscription_status,
    storefront_access_until,
    trial_ends_at
  )
  VALUES (
    v_store_id,
    'comped',
    'comped',
    now() + interval '10 years',
    now() + interval '10 years'
  )
  ON CONFLICT (store_id) DO UPDATE
  SET
    billing_plan = EXCLUDED.billing_plan,
    subscription_status = EXCLUDED.subscription_status,
    storefront_access_until = EXCLUDED.storefront_access_until,
    trial_ends_at = EXCLUDED.trial_ends_at;

  INSERT INTO public.seller_onboarding_state (
    store_id,
    profile_complete,
    billing_complete,
    terms_accepted,
    first_listing_created,
    ready_to_launch,
    launched_at
  )
  VALUES (
    v_store_id,
    true,
    true,
    true,
    false,
    true,
    NULL
  )
  ON CONFLICT (store_id) DO UPDATE
  SET
    profile_complete = EXCLUDED.profile_complete,
    billing_complete = EXCLUDED.billing_complete,
    terms_accepted = EXCLUDED.terms_accepted,
    ready_to_launch = EXCLUDED.ready_to_launch;

  INSERT INTO public.seller_terms_acceptances (
    store_id,
    terms_version,
    accepted_by_user_id,
    user_agent
  )
  SELECT
    v_store_id,
    v_params.terms_version,
    v_auth_user_id,
    'Development seed script'
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.seller_terms_acceptances
    WHERE store_id = v_store_id
      AND terms_version = v_params.terms_version
      AND accepted_by_user_id = v_auth_user_id
  );

  SELECT id
  INTO v_pickup_option_id
  FROM public.store_pickup_options
  WHERE store_id = v_store_id
    AND label = v_params.pickup_option_label
  ORDER BY created_at ASC, id::text ASC
  LIMIT 1;

  IF v_pickup_option_id IS NULL THEN
    INSERT INTO public.store_pickup_options (
      store_id,
      label,
      description,
      sort_order,
      is_active
    )
    VALUES (
      v_store_id,
      v_params.pickup_option_label,
      v_params.pickup_option_description,
      0,
      true
    )
    RETURNING id
    INTO v_pickup_option_id;
  ELSE
    UPDATE public.store_pickup_options
    SET
      description = v_params.pickup_option_description,
      sort_order = 0,
      is_active = true
    WHERE id = v_pickup_option_id;
  END IF;

  UPDATE public.stores
  SET default_pickup_option_id = v_pickup_option_id
  WHERE id = v_store_id;
END $$;

SELECT
  stores.id AS store_id,
  stores.owner_user_id,
  auth.users.email AS auth_email,
  stores.store_slug,
  stores.store_name,
  stores.store_status,
  stores.storefront_enabled,
  stores.storefront_mode,
  stores.admin_hold_reason IS NULL AS has_no_admin_hold,
  CASE
    WHEN stores.store_status = 'live'
      AND stores.storefront_enabled = true
      AND stores.storefront_mode IN ('hosted', 'embedded')
      AND stores.admin_hold_reason IS NULL
      THEN true
    ELSE false
  END AS is_publicly_available,
  EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_roles.user_id = stores.owner_user_id
      AND user_roles.store_id = stores.id
      AND user_roles.role = 'seller'
  ) AS has_seller_role,
  seller_billing_status.billing_plan,
  seller_billing_status.subscription_status,
  seller_onboarding_state.profile_complete,
  seller_onboarding_state.billing_complete,
  seller_onboarding_state.terms_accepted,
  seller_onboarding_state.ready_to_launch,
  stores.default_pickup_option_id IS NOT NULL AS has_default_pickup_option
FROM dev_test_seller_store_params params
JOIN auth.users
  ON lower(auth.users.email) = lower(params.test_user_email)
JOIN public.stores
  ON stores.owner_user_id = auth.users.id
 AND stores.store_slug = params.test_store_slug
LEFT JOIN public.seller_billing_status
  ON seller_billing_status.store_id = stores.id
LEFT JOIN public.seller_onboarding_state
  ON seller_onboarding_state.store_id = stores.id;

COMMIT;
