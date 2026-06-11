-- Development utility only. Do not add this file to Supabase migrations.
--
-- Seeds repeatable, realistic FlipFlocks test data for five stable test sellers:
-- - Willow Creek Poultry
-- - High Mesa Waterfowl
-- - Cedar Ridge Homestead
-- - Gunnison Valley Hatchery
-- - Rocky Mountain Farm Supply
--
-- Before running:
-- 1. Create the Auth users listed in dev_seed_sellers.test_user_email.
-- 2. Run this in a trusted development database connection.
-- 3. Review the summary at the end.
--
-- This script intentionally does not seed orders. The trusted storefront order
-- RPC performs the correct snapshots, order numbers, inventory decrement, and
-- notifications, but it requires a live/enabled storefront and service-role
-- checkout context. This script does not launch stores or bypass lifecycle
-- rules to manufacture that context.
--
-- Repeatability model:
-- - Store/account setup is upserted by stable Auth email + slug.
-- - Seller-generated content for the five configured stores is deleted and
--   rebuilt in dependency order.
-- - Auth users are never created or deleted.

BEGIN;

CREATE TEMP TABLE dev_seed_sellers ON COMMIT DROP AS
SELECT *
FROM (
  VALUES
    (
      'willow@example.test'::text,
      'willow-creek-poultry'::text,
      'Willow Creek Poultry'::text,
      'Large seasonal poultry operation with chicks, pullets, and laying hens.'::text,
      'Montrose'::text,
      'CO'::text,
      'Willow Creek Poultry raises practical laying and dual-purpose chickens for western Colorado flocks. Pickup is organized by hatch group so buyers can plan around age, breed, and availability.'::text,
      'willow@example.test'::text,
      '(970) 555-0141'::text,
      true::boolean,
      false::boolean,
      false::boolean,
      true::boolean,
      'Farm pickup by appointment near Montrose.'::text,
      'Pickup windows are confirmed after the order is received. Bring a clean carrier for started birds and layers.'::text,
      'Orders may be canceled before pickup confirmation. No-shows may be declined for future holds.'::text,
      'Pull through the east gate and park by the brooder barn.'::text
    ),
    (
      'highmesa@example.test',
      'high-mesa-waterfowl',
      'High Mesa Waterfowl',
      'Ducks and geese raised for eggs, pasture, and homestead flocks.',
      'Delta',
      'CO',
      'High Mesa Waterfowl keeps small, hardy groups of ducks and geese with a focus on useful layers, calm pasture birds, and honest availability windows.',
      'highmesa@example.test',
      '(970) 555-0188',
      true,
      true,
      false,
      false,
      'Farm pickup west of Delta.',
      'Waterfowl pickup is by appointment. Please bring a ventilated crate with absorbent bedding.',
      'Pickup changes are fine with advance notice. Deposits are not handled in this dev data set.',
      'Text when you reach the lower gate; waterfowl are staged separately from chickens.'
    ),
    (
      'cedarridge@example.test',
      'cedar-ridge-homestead',
      'Cedar Ridge Homestead',
      'Small mixed-species homestead with useful birds and a few rough edges.',
      'Paonia',
      'CO',
      'Cedar Ridge Homestead is a small mixed-species seller. The records intentionally include uneven labels, private notes, hidden drafts, and a few sold-out items while remaining valid data.',
      'cedarridge@example.test',
      '(970) 555-0119',
      true,
      true,
      true,
      true,
      'Pickup near Paonia by text confirmation.',
      'Pickup is flexible but must be confirmed before arrival. Some items are staged in different sheds.',
      'Cancellations are handled case by case.',
      'Use the gravel driveway and avoid blocking the hay trailer.'
    ),
    (
      'gunnisonhatchery@example.test',
      'gunnison-valley-hatchery',
      'Gunnison Valley Hatchery',
      'Hatching eggs from selected small-flock breeding pens.',
      'Gunnison',
      'CO',
      'Gunnison Valley Hatchery focuses on hatching eggs from selected breeding pens. Availability is organized by collection week rather than live-bird age.',
      'gunnisonhatchery@example.test',
      '(970) 555-0174',
      true,
      true,
      false,
      false,
      'Egg pickup in Gunnison by appointment.',
      'Hatching eggs are collected to order when possible. Bring cartons or ask for recycled cartons at pickup.',
      'Please cancel before collection day if plans change.',
      'Meet at the packing room door on the north side of the barn.'
    ),
    (
      'rockymountainfarmsupply@example.test',
      'rocky-mountain-farm-supply',
      'Rocky Mountain Farm Supply',
      'Equipment and supplies for small poultry operations.',
      'Grand Junction',
      'CO',
      'Rocky Mountain Farm Supply sells poultry equipment, brooders, feeders, crates, and incubator supplies. This test store intentionally has no live-bird inventory.',
      'rockymountainfarmsupply@example.test',
      '(970) 555-0106',
      false,
      true,
      false,
      false,
      'Warehouse pickup in Grand Junction.',
      'Equipment pickup is available weekdays. Large items require a truck or trailer.',
      'Used equipment is sold as described in the listing.',
      'Use the loading door behind the feed mill.'
    )
) AS sellers (
  test_user_email,
  store_slug,
  store_name,
  store_tagline,
  public_city,
  public_state,
  about_text,
  public_email,
  public_phone,
  hatching_eggs_enabled,
  equipment_supplies_enabled,
  processed_poultry_enabled,
  show_public_phone,
  pickup_location_text,
  pickup_policy,
  cancellation_policy,
  pickup_instructions
);

DO $$
DECLARE
  v_problem text;
BEGIN
  SELECT string_agg(test_user_email, ', ' ORDER BY test_user_email)
  INTO v_problem
  FROM dev_seed_sellers
  WHERE NOT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE lower(auth.users.email) = lower(dev_seed_sellers.test_user_email)
  );

  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'Missing required Supabase Auth users: %. Create them before running this seed.', v_problem;
  END IF;

  SELECT string_agg(test_user_email, ', ' ORDER BY test_user_email)
  INTO v_problem
  FROM dev_seed_sellers
  WHERE (
    SELECT count(*)
    FROM auth.users
    WHERE lower(auth.users.email) = lower(dev_seed_sellers.test_user_email)
  ) <> 1;

  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'Each seed email must match exactly one Auth user. Problem email(s): %.', v_problem;
  END IF;

  SELECT string_agg(dev_seed_sellers.store_slug, ', ' ORDER BY dev_seed_sellers.store_slug)
  INTO v_problem
  FROM dev_seed_sellers
  JOIN public.stores
    ON stores.store_slug = dev_seed_sellers.store_slug
  JOIN auth.users
    ON lower(auth.users.email) = lower(dev_seed_sellers.test_user_email)
  WHERE stores.owner_user_id <> auth.users.id;

  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing slug takeover. These slugs already belong to different Auth users: %.', v_problem;
  END IF;
END $$;

CREATE TEMP TABLE dev_seed_store_map ON COMMIT DROP AS
SELECT
  sellers.*,
  auth.users.id AS owner_user_id,
  stores.id AS existing_store_id
FROM dev_seed_sellers AS sellers
JOIN auth.users
  ON lower(auth.users.email) = lower(sellers.test_user_email)
LEFT JOIN public.stores
  ON stores.store_slug = sellers.store_slug;

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
  public_phone,
  show_public_email,
  show_public_phone,
  communication_email,
  order_notification_email,
  currency,
  storefront_enabled,
  hatching_eggs_enabled,
  equipment_supplies_enabled,
  processed_poultry_enabled
)
SELECT
  owner_user_id,
  store_name,
  store_tagline,
  store_slug,
  public_city,
  public_state,
  'US',
  about_text,
  pickup_policy,
  cancellation_policy,
  pickup_instructions,
  pickup_location_text,
  public_email,
  public_phone,
  true,
  show_public_phone,
  public_email,
  public_email,
  'usd',
  true,
  hatching_eggs_enabled,
  equipment_supplies_enabled,
  processed_poultry_enabled
FROM dev_seed_store_map
WHERE existing_store_id IS NULL;

UPDATE public.stores AS stores
SET
  store_name = store_map.store_name,
  store_tagline = store_map.store_tagline,
  public_city = store_map.public_city,
  public_state = store_map.public_state,
  public_country = 'US',
  about_text = store_map.about_text,
  pickup_policy = store_map.pickup_policy,
  cancellation_policy = store_map.cancellation_policy,
  pickup_instructions = store_map.pickup_instructions,
  pickup_location_text = store_map.pickup_location_text,
  public_email = store_map.public_email,
  public_phone = store_map.public_phone,
  show_public_email = true,
  show_public_phone = store_map.show_public_phone,
  communication_email = store_map.public_email,
  order_notification_email = store_map.public_email,
  currency = 'usd',
  storefront_enabled = true,
  hatching_eggs_enabled = store_map.hatching_eggs_enabled,
  equipment_supplies_enabled = store_map.equipment_supplies_enabled,
  processed_poultry_enabled = store_map.processed_poultry_enabled
FROM dev_seed_store_map AS store_map
WHERE stores.store_slug = store_map.store_slug
  AND stores.owner_user_id = store_map.owner_user_id;

DROP TABLE dev_seed_store_map;

CREATE TEMP TABLE dev_seed_store_map ON COMMIT DROP AS
SELECT
  sellers.*,
  auth.users.id AS owner_user_id,
  stores.id AS store_id
FROM dev_seed_sellers AS sellers
JOIN auth.users
  ON lower(auth.users.email) = lower(sellers.test_user_email)
JOIN public.stores
  ON stores.store_slug = sellers.store_slug
 AND stores.owner_user_id = auth.users.id;

INSERT INTO public.user_roles (user_id, role, store_id)
SELECT owner_user_id, 'seller', store_id
FROM dev_seed_store_map
ON CONFLICT DO NOTHING;

INSERT INTO public.seller_billing_status (
  store_id,
  billing_plan,
  subscription_status,
  storefront_access_until,
  trial_ends_at
)
SELECT
  store_id,
  'comped',
  'comped',
  now() + interval '10 years',
  now() + interval '10 years'
FROM dev_seed_store_map
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
  ready_to_launch
)
SELECT
  store_id,
  true,
  true,
  true,
  true,
  true
FROM dev_seed_store_map
ON CONFLICT (store_id) DO UPDATE
SET
  profile_complete = EXCLUDED.profile_complete,
  billing_complete = EXCLUDED.billing_complete,
  terms_accepted = EXCLUDED.terms_accepted,
  first_listing_created = EXCLUDED.first_listing_created,
  ready_to_launch = EXCLUDED.ready_to_launch;

INSERT INTO public.seller_terms_acceptances (
  store_id,
  terms_version,
  accepted_by_user_id,
  user_agent
)
SELECT
  store_id,
  'dev-realistic-test-data-v1',
  owner_user_id,
  'Development realistic seed script'
FROM dev_seed_store_map
WHERE NOT EXISTS (
  SELECT 1
  FROM public.seller_terms_acceptances AS terms
  WHERE terms.store_id = dev_seed_store_map.store_id
    AND terms.terms_version = 'dev-realistic-test-data-v1'
    AND terms.accepted_by_user_id = dev_seed_store_map.owner_user_id
);

CREATE TEMP TABLE dev_seed_pickup_options ON COMMIT DROP AS
SELECT *
FROM (
  VALUES
    ('willow-creek-poultry'::text, 'Friday brooder pickup'::text, 'Late afternoon pickup for chicks and started birds.'::text, 0::integer, true::boolean),
    ('willow-creek-poultry', 'Saturday layer pickup', 'Morning pickup for pullets and laying hens.', 1, true),
    ('high-mesa-waterfowl', 'Waterfowl yard pickup', 'By appointment near the lower gate.', 0, true),
    ('cedar-ridge-homestead', 'Text before arrival', 'Pickup time varies around chores; text first.', 0, true),
    ('cedar-ridge-homestead', 'Old market meet-up', 'Inactive option kept to exercise historical-looking settings.', 1, false),
    ('gunnison-valley-hatchery', 'Egg collection room', 'Hatching eggs are packed at the north barn door.', 0, true),
    ('rocky-mountain-farm-supply', 'Warehouse dock', 'Weekday loading dock pickup.', 0, true)
) AS pickup_options (store_slug, label, description, sort_order, is_active);

INSERT INTO public.store_pickup_options (
  store_id,
  label,
  description,
  sort_order,
  is_active
)
SELECT
  store_map.store_id,
  pickup_options.label,
  pickup_options.description,
  pickup_options.sort_order,
  pickup_options.is_active
FROM dev_seed_pickup_options AS pickup_options
JOIN dev_seed_store_map AS store_map
  ON store_map.store_slug = pickup_options.store_slug
WHERE NOT EXISTS (
  SELECT 1
  FROM public.store_pickup_options AS existing
  WHERE existing.store_id = store_map.store_id
    AND existing.label = pickup_options.label
);

UPDATE public.store_pickup_options AS options
SET
  description = pickup_options.description,
  sort_order = pickup_options.sort_order,
  is_active = pickup_options.is_active
FROM dev_seed_pickup_options AS pickup_options
JOIN dev_seed_store_map AS store_map
  ON store_map.store_slug = pickup_options.store_slug
WHERE options.store_id = store_map.store_id
  AND options.label = pickup_options.label;

UPDATE public.stores AS stores
SET default_pickup_option_id = default_options.id
FROM (
  SELECT DISTINCT ON (store_id)
    store_id,
    id
  FROM public.store_pickup_options
  WHERE is_active = true
    AND store_id IN (SELECT store_id FROM dev_seed_store_map)
  ORDER BY store_id, sort_order, label
) AS default_options
WHERE stores.id = default_options.store_id;

-- Delete previous generated content for these five stores before rebuilding.
CREATE TEMP TABLE dev_seed_target_orders ON COMMIT DROP AS
SELECT orders.id, orders.customer_id
FROM public.orders AS orders
WHERE orders.store_id IN (SELECT store_id FROM dev_seed_store_map);

CREATE TEMP TABLE dev_seed_target_order_refunds ON COMMIT DROP AS
SELECT order_refunds.id
FROM public.order_refunds
WHERE order_refunds.order_id IN (SELECT id FROM dev_seed_target_orders);

DELETE FROM public.payment_provider_events
WHERE related_store_id IN (SELECT store_id FROM dev_seed_store_map)
   OR related_order_id IN (SELECT id FROM dev_seed_target_orders)
   OR related_refund_id IN (SELECT id FROM dev_seed_target_order_refunds);

DELETE FROM public.stripe_checkout_sessions
WHERE order_id IN (SELECT id FROM dev_seed_target_orders);

DELETE FROM public.order_events
WHERE order_id IN (SELECT id FROM dev_seed_target_orders);

DELETE FROM public.email_notifications
WHERE order_id IN (SELECT id FROM dev_seed_target_orders);

DELETE FROM public.order_idempotency_keys
WHERE store_id IN (SELECT store_id FROM dev_seed_store_map);

DELETE FROM public.order_refunds
WHERE id IN (SELECT id FROM dev_seed_target_order_refunds);

DELETE FROM public.order_items
WHERE order_id IN (SELECT id FROM dev_seed_target_orders);

DELETE FROM public.orders
WHERE id IN (SELECT id FROM dev_seed_target_orders);

DELETE FROM public.customers
WHERE store_id IN (SELECT store_id FROM dev_seed_store_map);

DELETE FROM public.media_links
WHERE store_id IN (SELECT store_id FROM dev_seed_store_map);

DELETE FROM public.media_assets
WHERE store_id IN (SELECT store_id FROM dev_seed_store_map);

DELETE FROM public.inventory_activity_events
WHERE store_id IN (SELECT store_id FROM dev_seed_store_map);

DELETE FROM public.inventory_items
WHERE store_id IN (SELECT store_id FROM dev_seed_store_map);

DELETE FROM public.listing_batch_breeds
WHERE store_id IN (SELECT store_id FROM dev_seed_store_map);

DELETE FROM public.listing_batches
WHERE store_id IN (SELECT store_id FROM dev_seed_store_map);

DELETE FROM public.equipment_inventory_items
WHERE store_id IN (SELECT store_id FROM dev_seed_store_map);

DELETE FROM public.processed_poultry_inventory_items
WHERE store_id IN (SELECT store_id FROM dev_seed_store_map);

DELETE FROM public.seller_breed_profiles
WHERE store_id IN (SELECT store_id FROM dev_seed_store_map);

CREATE TEMP TABLE dev_seed_profiles ON COMMIT DROP AS
SELECT *
FROM (
  VALUES
    ('willow-creek-poultry'::text, 'chicken'::text, 'rhode-island-red'::text, null::text, 'Rhode Island Red'::text, 'Hardy brown-egg layers from Willow Creek laying pens.'::text, 'Primary layer line.'::text),
    ('willow-creek-poultry', 'chicken', 'orpington-buff', null, 'Buff Orpington', 'Calm dual-purpose birds suited to family flocks.', 'Popular pullet pen.'),
    ('willow-creek-poultry', 'chicken', 'plymouth-rock-barred', null, 'Barred Plymouth Rock', 'Classic dual-purpose birds with steady laying and good temperament.', 'Use for started birds.'),
    ('willow-creek-poultry', 'chicken', 'easter-egger', null, 'Easter Egger', 'Colorful egg layers with varied plumage and blue-green egg potential.', 'Mixed-color growouts.'),
    ('willow-creek-poultry', 'chicken', 'cornish-cross', null, 'Cornish Cross', 'Fast-growing meat chicks for careful brooder management.', 'Short seasonal run.'),
    ('high-mesa-waterfowl', 'duck', 'pekin-duck', null, 'Pekin Duck', 'Large white ducks for eggs, meat, and friendly homestead flocks.', 'Spring ducklings.'),
    ('high-mesa-waterfowl', 'duck', 'khaki-campbell', null, 'Khaki Campbell', 'Active, efficient duck layers for egg-focused flocks.', 'Layer group.'),
    ('high-mesa-waterfowl', 'duck', 'welsh-harlequin', null, 'Welsh Harlequin', 'Calm, attractive ducks with useful egg production.', 'Small pen.'),
    ('high-mesa-waterfowl', 'goose', 'embden', null, 'Embden Goose', 'Large white geese for pasture presence and table use.', 'Limited goslings.'),
    ('high-mesa-waterfowl', 'goose', 'american-buff-goose', null, 'American Buff Goose', 'Calm buff-colored geese with practical homestead appeal.', 'Pair availability.'),
    ('cedar-ridge-homestead', 'chicken', 'olive-egger', null, 'Olive Egger', 'Mixed-heritage layers selected for olive-toned eggs.', 'Messy pen label in barn notebook.'),
    ('cedar-ridge-homestead', 'chicken', null, 'Barnyard Layer Mix', 'Barnyard Layer Mix', 'Mixed homestead layers from practical laying pens.', 'Custom breed profile; valid but intentionally informal.'),
    ('cedar-ridge-homestead', 'turkey', 'bourbon-red', null, 'Bourbon Red Turkey', 'Heritage turkeys with good foraging and table qualities.', 'Small group.'),
    ('cedar-ridge-homestead', 'quail', 'coturnix-jumbo-brown', null, 'Jumbo Brown Coturnix', 'Utility quail for eggs and small-space production.', 'Back shed cages.'),
    ('gunnison-valley-hatchery', 'chicken', 'marans-black-copper', null, 'Black Copper Marans', 'Hatching eggs from dark-egg Marans pens.', 'Egg color varies by hen.'),
    ('gunnison-valley-hatchery', 'chicken', 'cream-legbar', null, 'Cream Legbar', 'Blue-egg hatching eggs from crested auto-sexing lines.', 'Rooster rotation A.'),
    ('gunnison-valley-hatchery', 'chicken', 'welsummer', null, 'Welsummer', 'Speckled brown hatching eggs from active foraging birds.', 'Fertility check weekly.'),
    ('gunnison-valley-hatchery', 'duck', 'silver-appleyard', null, 'Silver Appleyard Duck', 'Large dual-purpose duck hatching eggs from a calm breeding pen.', 'Limited collection days.')
) AS profiles (
  store_slug,
  species_slug,
  breed_slug,
  custom_breed_name,
  display_name,
  seller_description,
  seller_notes
);

INSERT INTO public.seller_breed_profiles (
  store_id,
  species_id,
  breed_id,
  custom_breed_name,
  normalized_custom_breed_name,
  display_name,
  seller_description,
  seller_notes,
  visibility_status,
  moderation_status
)
SELECT
  store_map.store_id,
  species.id,
  breeds.id,
  profiles.custom_breed_name,
  CASE
    WHEN profiles.custom_breed_name IS NULL THEN NULL
    ELSE regexp_replace(regexp_replace(lower(trim(profiles.custom_breed_name)), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')
  END,
  profiles.display_name,
  profiles.seller_description,
  profiles.seller_notes,
  'active',
  'normal'
FROM dev_seed_profiles AS profiles
JOIN dev_seed_store_map AS store_map
  ON store_map.store_slug = profiles.store_slug
JOIN public.species
  ON species.slug = profiles.species_slug
LEFT JOIN public.breeds
  ON breeds.species_id = species.id
 AND breeds.breed_slug = profiles.breed_slug;

CREATE TEMP TABLE dev_seed_batches ON COMMIT DROP AS
SELECT
  gen_random_uuid() AS listing_batch_id,
  *
FROM (
  VALUES
    ('willow-spring-chicks'::text, 'willow-creek-poultry'::text, 'chicken'::text, 'live_animals'::text, current_date - 14, current_date, 8.00::numeric, 'Willow Spring Chick Hatch'::text, 'Large mixed hatch; keep brooder pickup separate from pullets.'::text, 'active'::text),
    ('willow-started-pullets'::text, 'willow-creek-poultry', 'chicken', 'live_animals', current_date - 84, current_date + 21, 24.00, 'Started pullets - July readiness', 'Future availability for point-of-lay planning.', 'active'),
    ('willow-layer-closeout'::text, 'willow-creek-poultry', 'chicken', 'live_animals', current_date - 210, current_date - 14, 38.00, 'Laying hens closeout', 'Sold-out active listing should read as sold out from quantity.', 'active'),
    ('highmesa-ducklings'::text, 'high-mesa-waterfowl', 'duck', 'live_animals', current_date - 10, current_date + 4, 12.00, 'June ducklings', 'Ducklings are feathering unevenly; sell by breed group.', 'active'),
    ('highmesa-goslings'::text, 'high-mesa-waterfowl', 'goose', 'live_animals', current_date - 28, current_date, 36.00, 'Pasture goslings', 'Geese require larger pickup crates.', 'active'),
    ('cedar-mixed-layers'::text, 'cedar-ridge-homestead', 'chicken', 'live_animals', current_date - 35, current_date, 14.00, 'mixed layer chicks / back brooder', 'Intentionally messy label, still valid structured data.', 'active'),
    ('cedar-turkey-growouts'::text, 'cedar-ridge-homestead', 'turkey', 'live_animals', current_date - 56, current_date + 14, 42.00, 'turkeys maybe pen 3', 'Future turkey availability with informal notes.', 'active'),
    ('cedar-quail-draft'::text, 'cedar-ridge-homestead', 'quail', 'live_animals', current_date - 21, current_date + 7, 6.00, 'quail - ask before posting', 'Hidden valid draft inventory for messy seller workflow.', 'hidden'),
    ('gunnison-marans-eggs'::text, 'gunnison-valley-hatchery', 'chicken', 'hatching_eggs', current_date + 3, current_date + 3, 48.00, 'Marans egg collection week', 'Dozen hatching egg lots; collection starts next week.', 'active'),
    ('gunnison-blue-eggs'::text, 'gunnison-valley-hatchery', 'chicken', 'hatching_eggs', current_date, current_date, 42.00, 'Blue egg collection', 'Ready-now hatching egg lots.', 'active'),
    ('gunnison-duck-eggs-sold'::text, 'gunnison-valley-hatchery', 'duck', 'hatching_eggs', current_date, current_date, 36.00, 'Duck egg waitlist', 'Sold-out hatching egg listing retained for storefront state.', 'active')
) AS batches (
  batch_key,
  store_slug,
  species_slug,
  batch_type,
  origin_date,
  available_date,
  base_price,
  internal_batch_label,
  seller_notes,
  visibility_status
);

INSERT INTO public.listing_batches (
  id,
  store_id,
  species_id,
  batch_type,
  origin_date,
  available_date,
  base_price,
  internal_batch_label,
  seller_notes,
  visibility_status,
  moderation_status
)
SELECT
  batches.listing_batch_id,
  store_map.store_id,
  species.id,
  batches.batch_type,
  batches.origin_date,
  batches.available_date,
  batches.base_price,
  batches.internal_batch_label,
  batches.seller_notes,
  batches.visibility_status,
  'normal'
FROM dev_seed_batches AS batches
JOIN dev_seed_store_map AS store_map
  ON store_map.store_slug = batches.store_slug
JOIN public.species
  ON species.slug = batches.species_slug;

CREATE TEMP TABLE dev_seed_batch_breeds ON COMMIT DROP AS
SELECT
  gen_random_uuid() AS listing_batch_breed_id,
  *
FROM (
  VALUES
    ('willow-spring-chicks'::text, 'Rhode Island Red'::text, 0::integer, 'active'::text),
    ('willow-spring-chicks', 'Buff Orpington', 1, 'active'),
    ('willow-spring-chicks', 'Easter Egger', 2, 'active'),
    ('willow-started-pullets', 'Barred Plymouth Rock', 0, 'active'),
    ('willow-started-pullets', 'Buff Orpington', 1, 'active'),
    ('willow-layer-closeout', 'Rhode Island Red', 0, 'active'),
    ('highmesa-ducklings', 'Pekin Duck', 0, 'active'),
    ('highmesa-ducklings', 'Khaki Campbell', 1, 'active'),
    ('highmesa-ducklings', 'Welsh Harlequin', 2, 'active'),
    ('highmesa-goslings', 'Embden Goose', 0, 'active'),
    ('highmesa-goslings', 'American Buff Goose', 1, 'active'),
    ('cedar-mixed-layers', 'Barnyard Layer Mix', 0, 'active'),
    ('cedar-mixed-layers', 'Olive Egger', 1, 'active'),
    ('cedar-turkey-growouts', 'Bourbon Red Turkey', 0, 'active'),
    ('cedar-quail-draft', 'Jumbo Brown Coturnix', 0, 'hidden'),
    ('gunnison-marans-eggs', 'Black Copper Marans', 0, 'active'),
    ('gunnison-blue-eggs', 'Cream Legbar', 0, 'active'),
    ('gunnison-blue-eggs', 'Welsummer', 1, 'active'),
    ('gunnison-duck-eggs-sold', 'Silver Appleyard Duck', 0, 'active')
) AS batch_breeds (
  batch_key,
  display_name,
  sort_order,
  visibility_status
);

INSERT INTO public.listing_batch_breeds (
  id,
  store_id,
  listing_batch_id,
  seller_breed_profile_id,
  sort_order,
  visibility_status,
  moderation_status,
  seller_notes
)
SELECT
  batch_breeds.listing_batch_breed_id,
  store_map.store_id,
  batches.listing_batch_id,
  profiles.id,
  batch_breeds.sort_order,
  batch_breeds.visibility_status,
  'normal',
  CASE
    WHEN batch_breeds.visibility_status = 'hidden' THEN 'Hidden setup row for draft workflow.'
    ELSE NULL
  END
FROM dev_seed_batch_breeds AS batch_breeds
JOIN dev_seed_batches AS batches
  ON batches.batch_key = batch_breeds.batch_key
JOIN dev_seed_store_map AS store_map
  ON store_map.store_slug = batches.store_slug
JOIN public.seller_breed_profiles AS profiles
  ON profiles.store_id = store_map.store_id
 AND profiles.display_name = batch_breeds.display_name;

CREATE TEMP TABLE dev_seed_inventory ON COMMIT DROP AS
SELECT
  gen_random_uuid() AS inventory_item_id,
  *
FROM (
  VALUES
    ('willow-spring-chicks'::text, 'Rhode Island Red'::text, 'straight_run'::text, null::text, 85::integer, 7.50::numeric, 0::integer, 'active'::text, 'High-volume chick group.'::text),
    ('willow-spring-chicks', 'Buff Orpington', 'female', null, 42, 10.00, 1, 'active', 'Sexed pullets from same hatch.'),
    ('willow-spring-chicks', 'Easter Egger', 'straight_run', null, 0, 8.00, 2, 'active', 'Sold-out but still active for derived sold-out state.'),
    ('willow-started-pullets', 'Barred Plymouth Rock', 'female', null, 24, 28.00, 0, 'active', 'Future availability pullets.'),
    ('willow-started-pullets', 'Buff Orpington', 'female', null, 18, 30.00, 1, 'active', 'Future availability pullets.'),
    ('willow-layer-closeout', 'Rhode Island Red', 'female', 'laying hens', 0, 38.00, 0, 'active', 'Closeout sold out.'),
    ('highmesa-ducklings', 'Pekin Duck', 'straight_run', null, 20, 12.00, 0, 'active', 'Fast-growing ducklings.'),
    ('highmesa-ducklings', 'Khaki Campbell', 'straight_run', null, 12, 14.00, 1, 'active', 'Layer ducklings.'),
    ('highmesa-ducklings', 'Welsh Harlequin', 'straight_run', null, 6, 16.00, 2, 'active', 'Limited small group.'),
    ('highmesa-goslings', 'Embden Goose', 'straight_run', null, 4, 36.00, 0, 'active', 'Bring larger crate.'),
    ('highmesa-goslings', 'American Buff Goose', 'pair', null, 1, 95.00, 1, 'active', 'One pair available.'),
    ('cedar-mixed-layers', 'Barnyard Layer Mix', 'straight_run', null, 11, 6.00, 0, 'active', 'Messy but valid mixed group.'),
    ('cedar-mixed-layers', 'Olive Egger', 'female', null, 0, 16.00, 1, 'active', 'Sold-out row in active listing.'),
    ('cedar-turkey-growouts', 'Bourbon Red Turkey', 'straight_run', null, 5, 42.00, 0, 'active', 'Future pickup.'),
    ('cedar-quail-draft', 'Jumbo Brown Coturnix', 'unsexed', null, 18, 6.00, 0, 'hidden', 'Hidden draft for seller cleanup flow.'),
    ('gunnison-marans-eggs', 'Black Copper Marans', 'hatching_eggs', 'dozen hatching eggs', 3, 48.00, 0, 'active', 'Future collection.'),
    ('gunnison-blue-eggs', 'Cream Legbar', 'hatching_eggs', 'dozen hatching eggs', 5, 42.00, 0, 'active', 'Ready now.'),
    ('gunnison-blue-eggs', 'Welsummer', 'hatching_eggs', 'dozen hatching eggs', 2, 38.00, 1, 'active', 'Speckled egg lots.'),
    ('gunnison-duck-eggs-sold', 'Silver Appleyard Duck', 'hatching_eggs', 'half-dozen hatching eggs', 0, 36.00, 0, 'active', 'Sold-out egg listing.')
) AS inventory (
  batch_key,
  display_name,
  inventory_type,
  custom_inventory_label,
  quantity_available,
  price_override,
  sort_order,
  visibility_status,
  seller_notes
);

INSERT INTO public.inventory_items (
  id,
  store_id,
  listing_batch_id,
  listing_batch_breed_id,
  inventory_type,
  custom_inventory_label,
  quantity_available,
  price_override,
  sort_order,
  visibility_status,
  moderation_status,
  seller_notes
)
SELECT
  inventory.inventory_item_id,
  store_map.store_id,
  batches.listing_batch_id,
  batch_breeds.listing_batch_breed_id,
  inventory.inventory_type,
  inventory.custom_inventory_label,
  inventory.quantity_available,
  inventory.price_override,
  inventory.sort_order,
  inventory.visibility_status,
  'normal',
  inventory.seller_notes
FROM dev_seed_inventory AS inventory
JOIN dev_seed_batches AS batches
  ON batches.batch_key = inventory.batch_key
JOIN dev_seed_store_map AS store_map
  ON store_map.store_slug = batches.store_slug
JOIN dev_seed_batch_breeds AS batch_breeds
  ON batch_breeds.batch_key = inventory.batch_key
 AND batch_breeds.display_name = inventory.display_name;

CREATE TEMP TABLE dev_seed_equipment ON COMMIT DROP AS
SELECT
  gen_random_uuid() AS equipment_inventory_item_id,
  *
FROM (
  VALUES
    ('rocky-mountain-farm-supply'::text, 'Four-hole galvanized nest box'::text, 'Coops & Housing'::text, 'Good'::text, 'Used galvanized nest box with wall-mount brackets.', 3::integer, 68.00::numeric, 'active'::text, 'Cleaned and ready for pickup.'::text),
    ('rocky-mountain-farm-supply', 'Premier-style chick brooder plate 12x12', 'Brooders & Heat', 'Like New', 'Adjustable brooder plate for small chick batches.', 8, 42.00, 'active', 'Tested warm.'),
    ('rocky-mountain-farm-supply', 'Five-gallon poultry waterer', 'Feeders & Waterers', 'New', 'Plastic five-gallon waterer for chickens or ducks.', 16, 24.00, 'active', 'Case quantity available.'),
    ('rocky-mountain-farm-supply', 'Hatching tray set for cabinet incubator', 'Incubators & Hatching', 'Good', 'Mixed tray set for cabinet incubator setups.', 0, 35.00, 'active', 'Sold out inventory row.'),
    ('rocky-mountain-farm-supply', 'Wire transport crate', 'Transport & Crates', 'Fair', 'Large wire crate suitable for started birds.', 4, 55.00, 'active', 'Some bent corners.'),
    ('cedar-ridge-homestead', 'Extra quail feeder', 'Feeders & Waterers', 'Fair', 'Small feeder that came with the quail setup.', 1, 8.00, 'active', 'Messy seller extra supply.')
) AS equipment (
  store_slug,
  item_name,
  category,
  condition,
  description,
  quantity_available,
  price,
  visibility_status,
  seller_notes
);

INSERT INTO public.equipment_inventory_items (
  id,
  store_id,
  item_name,
  category,
  condition,
  description,
  quantity_available,
  price,
  visibility_status,
  moderation_status,
  seller_notes,
  first_published_at
)
SELECT
  equipment.equipment_inventory_item_id,
  store_map.store_id,
  equipment.item_name,
  equipment.category,
  equipment.condition,
  equipment.description,
  equipment.quantity_available,
  equipment.price,
  equipment.visibility_status,
  'normal',
  equipment.seller_notes,
  CASE WHEN equipment.visibility_status IN ('active', 'sold_out') THEN now() ELSE NULL END
FROM dev_seed_equipment AS equipment
JOIN dev_seed_store_map AS store_map
  ON store_map.store_slug = equipment.store_slug;

CREATE TEMP TABLE dev_seed_processed ON COMMIT DROP AS
SELECT
  gen_random_uuid() AS processed_poultry_inventory_item_id,
  *
FROM (
  VALUES
    ('cedar-ridge-homestead'::text, 'Pasture chicken halves'::text, 'Chicken'::text, 'Halves'::text, '2 halves per pack'::text, 'Small batch freezer inventory from Cedar Ridge.', 6::integer, 18.00::numeric, 'active'::text, 'Freezer shelf B.'::text),
    ('cedar-ridge-homestead', 'Stewing hens', 'Chicken', 'Whole Bird', '3-4 lb birds', 'Older laying hens processed for stock and stews.', 0, 12.00, 'active', 'Sold-out processed poultry row.')
) AS processed (
  store_slug,
  product_name,
  poultry_type,
  product_type,
  package_size,
  description,
  quantity_available,
  price,
  visibility_status,
  seller_notes
);

INSERT INTO public.processed_poultry_inventory_items (
  id,
  store_id,
  product_name,
  poultry_type,
  product_type,
  package_size,
  description,
  quantity_available,
  price,
  visibility_status,
  moderation_status,
  seller_notes,
  first_published_at
)
SELECT
  processed.processed_poultry_inventory_item_id,
  store_map.store_id,
  processed.product_name,
  processed.poultry_type,
  processed.product_type,
  processed.package_size,
  processed.description,
  processed.quantity_available,
  processed.price,
  processed.visibility_status,
  'normal',
  processed.seller_notes,
  CASE WHEN processed.visibility_status IN ('active', 'sold_out') THEN now() ELSE NULL END
FROM dev_seed_processed AS processed
JOIN dev_seed_store_map AS store_map
  ON store_map.store_slug = processed.store_slug;

CREATE TEMP TABLE dev_seed_customers ON COMMIT DROP AS
SELECT *
FROM (
  VALUES
    ('willow-creek-poultry'::text, 'maria.rivera@example.test'::text, 'Maria'::text, 'Rivera'::text, '(970) 555-2101'::text, null::text, 'Olathe'::text, 'CO'::text, 'Needs pullets ready after vacation.'::text),
    ('willow-creek-poultry', 'ben.parker@example.test', 'Ben', 'Parker', '(970) 555-2102', 'Parker Family Farm', 'Delta', 'CO', 'Prefers Friday pickup.'),
    ('high-mesa-waterfowl', 'tessa.lang@example.test', 'Tessa', 'Lang', '(970) 555-2201', null, 'Hotchkiss', 'CO', 'Asked about duck housing.'),
    ('high-mesa-waterfowl', 'noah.ames@example.test', 'Noah', 'Ames', '(970) 555-2202', null, 'Cedaredge', 'CO', 'Interested in geese only.'),
    ('cedar-ridge-homestead', 'ruth.kline@example.test', 'Ruth', 'Kline', '(970) 555-2301', null, 'Paonia', 'CO', 'Texts, does not check email often.'),
    ('cedar-ridge-homestead', 'miguel.soto@example.test', 'Miguel', 'Soto', '(970) 555-2302', 'Soto Market Garden', 'Crawford', 'CO', 'Bought freezer birds previously outside system.'),
    ('gunnison-valley-hatchery', 'claire.owen@example.test', 'Claire', 'Owen', '(970) 555-2401', null, 'Gunnison', 'CO', 'Wants Marans eggs when fertility is confirmed.'),
    ('gunnison-valley-hatchery', 'jamal.brooks@example.test', 'Jamal', 'Brooks', '(970) 555-2402', null, 'Crested Butte', 'CO', 'Blue egg project.'),
    ('rocky-mountain-farm-supply', 'erika.chen@example.test', 'Erika', 'Chen', '(970) 555-2501', 'Mesa Microfarm', 'Grand Junction', 'CO', 'Usually buys equipment in batches.'),
    ('rocky-mountain-farm-supply', 'owen.miles@example.test', 'Owen', 'Miles', '(970) 555-2502', null, 'Fruita', 'CO', 'Looking for used crates.')
) AS customers (
  store_slug,
  email,
  first_name,
  last_name,
  phone,
  business_name,
  city,
  state,
  internal_notes
);

INSERT INTO public.customers (
  store_id,
  email,
  first_name,
  last_name,
  phone,
  business_name,
  city,
  state,
  country,
  delivery_city,
  delivery_state,
  delivery_country,
  internal_notes
)
SELECT
  store_map.store_id,
  customers.email,
  customers.first_name,
  customers.last_name,
  customers.phone,
  customers.business_name,
  customers.city,
  customers.state,
  'US',
  customers.city,
  customers.state,
  'US',
  customers.internal_notes
FROM dev_seed_customers AS customers
JOIN dev_seed_store_map AS store_map
  ON store_map.store_slug = customers.store_slug;

CREATE TEMP TABLE dev_seed_media_entities ON COMMIT DROP AS
SELECT
  gen_random_uuid() AS media_asset_id,
  store_map.store_id,
  media_entities.store_slug,
  media_entities.entity_type,
  media_entities.entity_key,
  media_entities.display_context,
  media_entities.sort_order,
  media_entities.is_featured,
  media_entities.alt_text,
  media_entities.caption,
  'seller-media'::text AS bucket_name,
  'dev-test-data/' || media_entities.store_slug || '/' || media_entities.entity_key || '-' || media_entities.display_context || '-' || media_entities.sort_order || '.webp' AS storage_path
FROM (
  VALUES
    ('willow-creek-poultry'::text, 'store'::text, 'willow-creek-poultry'::text, 'hero'::text, 0::integer, true::boolean, 'Willow Creek Poultry brooder barn'::text, 'Development media record for Willow Creek storefront.'::text),
    ('willow-creek-poultry', 'listing_batch', 'willow-spring-chicks', 'gallery', 0, true, 'Rhode Island Red chicks in brooder', 'Spring chick hatch.'),
    ('willow-creek-poultry', 'inventory_item', 'willow-started-pullets|Barred Plymouth Rock|female', 'gallery', 0, true, 'Started Barred Plymouth Rock pullets', 'Future pullet group.'),
    ('high-mesa-waterfowl', 'store', 'high-mesa-waterfowl', 'hero', 0, true, 'High Mesa duck yard', 'Development media record for waterfowl storefront.'),
    ('high-mesa-waterfowl', 'listing_batch', 'highmesa-ducklings', 'gallery', 0, true, 'Ducklings near waterer', 'Duckling listing photo.'),
    ('high-mesa-waterfowl', 'listing_batch', 'highmesa-goslings', 'gallery', 0, true, 'Goslings on pasture', 'Goose listing photo.'),
    ('cedar-ridge-homestead', 'store', 'cedar-ridge-homestead', 'hero', 0, true, 'Cedar Ridge mixed homestead yard', 'Intentionally informal storefront photo.'),
    ('cedar-ridge-homestead', 'listing_batch', 'cedar-mixed-layers', 'gallery', 0, true, 'Mixed layer chicks in back brooder', 'Messy seller listing photo.'),
    ('cedar-ridge-homestead', 'equipment_inventory_item', 'Extra quail feeder', 'gallery', 0, true, 'Small quail feeder', 'Extra supply photo.'),
    ('cedar-ridge-homestead', 'processed_poultry_inventory_item', 'Pasture chicken halves', 'gallery', 0, true, 'Wrapped pasture chicken halves', 'Processed poultry photo.'),
    ('gunnison-valley-hatchery', 'store', 'gunnison-valley-hatchery', 'hero', 0, true, 'Hatching egg packing room', 'Development media record for hatchery storefront.'),
    ('gunnison-valley-hatchery', 'listing_batch', 'gunnison-marans-eggs', 'gallery', 0, true, 'Dark brown Marans hatching eggs', 'Marans hatching egg photo.'),
    ('rocky-mountain-farm-supply', 'store', 'rocky-mountain-farm-supply', 'hero', 0, true, 'Farm supply warehouse shelving', 'Development media record for equipment storefront.'),
    ('rocky-mountain-farm-supply', 'equipment_inventory_item', 'Four-hole galvanized nest box', 'gallery', 0, true, 'Galvanized nest box', 'Equipment listing photo.'),
    ('rocky-mountain-farm-supply', 'equipment_inventory_item', 'Premier-style chick brooder plate 12x12', 'gallery', 0, true, 'Chick brooder plate', 'Brooder listing photo.')
) AS media_entities (
  store_slug,
  entity_type,
  entity_key,
  display_context,
  sort_order,
  is_featured,
  alt_text,
  caption
)
JOIN dev_seed_store_map AS store_map
  ON store_map.store_slug = media_entities.store_slug;

INSERT INTO public.media_assets (
  id,
  store_id,
  uploaded_by_user_id,
  bucket_name,
  storage_path,
  original_filename,
  content_type,
  file_size_bytes,
  width_px,
  height_px,
  alt_text,
  asset_status,
  moderation_status,
  moderation_checked_at
)
SELECT
  media_asset_id,
  media_entities.store_id,
  store_map.owner_user_id,
  media_entities.bucket_name,
  media_entities.storage_path,
  split_part(media_entities.storage_path, '/', 3),
  'image/webp',
  128000,
  1200,
  800,
  media_entities.alt_text,
  'active',
  'approved',
  now()
FROM dev_seed_media_entities AS media_entities
JOIN dev_seed_store_map AS store_map
  ON store_map.store_id = media_entities.store_id;

INSERT INTO public.media_links (
  store_id,
  media_asset_id,
  entity_type,
  entity_id,
  display_context,
  sort_order,
  is_featured,
  alt_text_override,
  caption,
  visibility_status
)
SELECT
  media_entities.store_id,
  media_entities.media_asset_id,
  media_entities.entity_type,
  CASE media_entities.entity_type
    WHEN 'store' THEN media_entities.store_id
    WHEN 'listing_batch' THEN batches.listing_batch_id
    WHEN 'inventory_item' THEN inventory.inventory_item_id
    WHEN 'equipment_inventory_item' THEN equipment.equipment_inventory_item_id
    WHEN 'processed_poultry_inventory_item' THEN processed.processed_poultry_inventory_item_id
  END,
  media_entities.display_context,
  media_entities.sort_order,
  media_entities.is_featured,
  media_entities.alt_text,
  media_entities.caption,
  'active'
FROM dev_seed_media_entities AS media_entities
LEFT JOIN dev_seed_batches AS batches
  ON media_entities.entity_type = 'listing_batch'
 AND batches.batch_key = media_entities.entity_key
LEFT JOIN dev_seed_inventory AS inventory
  ON media_entities.entity_type = 'inventory_item'
 AND (
    inventory.batch_key || '|' || inventory.display_name || '|' || inventory.inventory_type
  ) = media_entities.entity_key
LEFT JOIN dev_seed_equipment AS equipment
  ON media_entities.entity_type = 'equipment_inventory_item'
 AND equipment.item_name = media_entities.entity_key
LEFT JOIN dev_seed_processed AS processed
  ON media_entities.entity_type = 'processed_poultry_inventory_item'
 AND processed.product_name = media_entities.entity_key
WHERE CASE media_entities.entity_type
    WHEN 'store' THEN media_entities.store_id
    WHEN 'listing_batch' THEN batches.listing_batch_id
    WHEN 'inventory_item' THEN inventory.inventory_item_id
    WHEN 'equipment_inventory_item' THEN equipment.equipment_inventory_item_id
    WHEN 'processed_poultry_inventory_item' THEN processed.processed_poultry_inventory_item_id
  END IS NOT NULL;

SELECT
  store_map.store_slug,
  store_map.store_name,
  stores.store_status,
  stores.storefront_enabled,
  stores.hatching_eggs_enabled,
  stores.equipment_supplies_enabled,
  stores.processed_poultry_enabled,
  (
    SELECT COUNT(*)
    FROM public.seller_breed_profiles
    WHERE seller_breed_profiles.store_id = store_map.store_id
  ) AS seller_breed_profiles,
  (
    SELECT COUNT(*)
    FROM public.listing_batches
    WHERE listing_batches.store_id = store_map.store_id
  ) AS listing_batches,
  (
    SELECT COUNT(*)
    FROM public.inventory_items
    WHERE inventory_items.store_id = store_map.store_id
  ) AS bird_inventory_items,
  (
    SELECT COUNT(*)
    FROM public.equipment_inventory_items
    WHERE equipment_inventory_items.store_id = store_map.store_id
  ) AS equipment_items,
  (
    SELECT COUNT(*)
    FROM public.processed_poultry_inventory_items
    WHERE processed_poultry_inventory_items.store_id = store_map.store_id
  ) AS processed_poultry_items,
  (
    SELECT COUNT(*)
    FROM public.customers
    WHERE customers.store_id = store_map.store_id
  ) AS customers,
  (
    SELECT COUNT(*)
    FROM public.media_links
    WHERE media_links.store_id = store_map.store_id
  ) AS media_links,
  (
    SELECT COUNT(*)
    FROM public.inventory_items
    WHERE inventory_items.store_id = store_map.store_id
      AND inventory_items.quantity_available = 0
  ) AS sold_out_bird_inventory_rows,
  (
    SELECT COUNT(*)
    FROM public.listing_batches
    WHERE listing_batches.store_id = store_map.store_id
      AND listing_batches.available_date > current_date
  ) AS future_availability_batches
FROM dev_seed_store_map AS store_map
JOIN public.stores
  ON stores.id = store_map.store_id
ORDER BY store_map.store_slug;

COMMIT;
