begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  'f1000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'barn-history@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode,
  storefront_enabled
)
values (
  'f1000000-0000-4000-8000-000000000010',
  'f1000000-0000-4000-8000-000000000001',
  'Barn History Farm', 'barn-history-farm', 'live', 'hosted', true
);

insert into public.seller_billing_status (
  store_id, plan_key, billing_plan, subscription_status,
  storefront_access_until, billing_state_authority,
  comp_granted_by_user_id, comp_grant_reason, comp_granted_at,
  comp_access_until
)
values (
  'f1000000-0000-4000-8000-000000000010',
  'full_flock', 'comped', 'comped', statement_timestamp() + interval '30 days',
  'admin_comp', 'f1000000-0000-4000-8000-000000000001',
  'Barn location order-history fixture', statement_timestamp(),
  statement_timestamp() + interval '30 days'
);

insert into public.seller_breed_profiles (
  id, store_id, species_id, custom_breed_name, normalized_custom_breed_name,
  display_name, visibility_status, moderation_status
)
select
  'f1000000-0000-4000-8000-000000000020',
  'f1000000-0000-4000-8000-000000000010',
  species.id, 'History Rock', 'history rock', 'History Rock', 'active', 'normal'
from public.species as species
where species.slug = 'chicken';

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'f1000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

create temporary table barn_history_listing on commit drop as
select *
from public.seller_create_listing_batch_with_inventory(
  'f1000000-0000-4000-8000-000000000010',
  (select id from public.species where slug = 'chicken'),
  'live_animals', current_date - 30, current_date, 25,
  jsonb_build_array(jsonb_build_object(
    'seller_breed_profile_id', 'f1000000-0000-4000-8000-000000000020',
    'inventory_items', jsonb_build_array(jsonb_build_object(
      'client_row_token', 'history-hens',
      'inventory_type', 'female',
      'quantity_available', 50,
      'price_override', 25,
      'barn_location', 'Barn A',
      'breeding_history', 'never_bred',
      'feather_condition', 'good'
    ))
  )),
  false, null, null, null, null, 'active'
);

reset role;

create temporary table barn_history_inventory on commit drop as
select
  inventory_items.id as inventory_item_id,
  inventory_items.listing_batch_id,
  inventory_items.listing_batch_breed_id,
  listing_batches.species_id,
  inventory_items.barn_location,
  inventory_items.feather_condition
from public.inventory_items as inventory_items
join public.listing_batches as listing_batches
  on listing_batches.id = inventory_items.listing_batch_id
where inventory_items.listing_batch_id = (
  select listing_batch_id from barn_history_listing
)
limit 1;

grant select on barn_history_inventory to authenticated;

insert into public.customers (
  id, store_id, email, first_name, last_name
)
values (
  'f1000000-0000-4000-8000-000000000030',
  'f1000000-0000-4000-8000-000000000010',
  'buyer@example.test', 'Barn', 'Buyer'
);

insert into public.orders (
  id, store_id, customer_id, order_number, order_status,
  buyer_email_snapshot, buyer_first_name_snapshot, buyer_last_name_snapshot,
  subtotal_amount, tax_fee_amount, total_amount, fulfilled_at, canceled_at
)
values
  ('f1000000-0000-4000-8000-000000000101', 'f1000000-0000-4000-8000-000000000010', 'f1000000-0000-4000-8000-000000000030', 'ACTIVE-1', 'pending', 'buyer@example.test', 'Barn', 'Buyer', 125, 0, 125, null, null),
  ('f1000000-0000-4000-8000-000000000102', 'f1000000-0000-4000-8000-000000000010', 'f1000000-0000-4000-8000-000000000030', 'PARTIAL-1', 'open', 'buyer@example.test', 'Barn', 'Buyer', 125, 0, 125, null, null),
  ('f1000000-0000-4000-8000-000000000103', 'f1000000-0000-4000-8000-000000000010', 'f1000000-0000-4000-8000-000000000030', 'COMPLETE-1', 'fulfilled', 'buyer@example.test', 'Barn', 'Buyer', 125, 0, 125, now(), null),
  ('f1000000-0000-4000-8000-000000000104', 'f1000000-0000-4000-8000-000000000010', 'f1000000-0000-4000-8000-000000000030', 'CANCELED-1', 'canceled', 'buyer@example.test', 'Barn', 'Buyer', 125, 0, 125, null, now());

insert into public.order_items (
  order_id, store_id, inventory_item_id, listing_batch_id,
  listing_batch_breed_id, seller_breed_profile_id, species_id,
  species_name_snapshot, species_slug_snapshot, breed_display_name_snapshot,
  inventory_type_snapshot, batch_type_snapshot, available_date_snapshot,
  unit_price_snapshot, quantity, line_subtotal, fulfilled_quantity,
  canceled_quantity, order_item_source
)
select
  order_ids.order_id,
  'f1000000-0000-4000-8000-000000000010',
  inventory.inventory_item_id, inventory.listing_batch_id,
  inventory.listing_batch_breed_id, 'f1000000-0000-4000-8000-000000000020',
  inventory.species_id, 'Chicken', 'chicken', 'History Rock',
  'female', 'live_animals', current_date, 25, 5, 125,
  order_ids.fulfilled_quantity, order_ids.canceled_quantity, 'listing_inventory'
from (
  values
    ('f1000000-0000-4000-8000-000000000101'::uuid, 0, 0),
    ('f1000000-0000-4000-8000-000000000102'::uuid, 2, 0),
    ('f1000000-0000-4000-8000-000000000103'::uuid, 5, 0),
    ('f1000000-0000-4000-8000-000000000104'::uuid, 0, 5)
) as order_ids(order_id, fulfilled_quantity, canceled_quantity)
cross join barn_history_inventory as inventory;

select results_eq(
  $$select barn_location, feather_condition_snapshot
    from public.order_items
    order by order_id$$,
  $$values
    ('Barn A'::text, 'good'::text),
    ('Barn A'::text, 'good'::text),
    ('Barn A'::text, 'good'::text),
    ('Barn A'::text, 'good'::text)$$,
  'new order lines capture the initial barn and feather condition'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'f1000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select public.seller_update_inventory_item(
  (select inventory_item_id from barn_history_inventory),
  'female', null, 25, 0, null, 'Barn B', 'never_bred', 'rough', true
);

reset role;

select results_eq(
  $$select orders.order_number, order_items.barn_location
    from public.order_items
    join public.orders on orders.id = order_items.order_id
    order by orders.order_number$$,
  $$values
    ('ACTIVE-1'::text, 'Barn B'::text),
    ('CANCELED-1'::text, 'Barn A'::text),
    ('COMPLETE-1'::text, 'Barn A'::text),
    ('PARTIAL-1'::text, 'Barn B'::text)$$,
  'first barn move updates active and partially fulfilled reservations only'
);

select results_eq(
  $$select feather_condition_snapshot from public.order_items order by order_id$$,
  $$values ('good'::text), ('good'::text), ('good'::text), ('good'::text)$$,
  'feather condition remains immutable on existing order lines'
);

select results_eq(
  $$select unit_price_snapshot, quantity, line_subtotal from public.order_items order by order_id$$,
  $$values
    (25::numeric, 5, 125::numeric),
    (25::numeric, 5, 125::numeric),
    (25::numeric, 5, 125::numeric),
    (25::numeric, 5, 125::numeric)$$,
  'barn and feather updates do not change order-item prices or quantities'
);

select results_eq(
  $$select subtotal_amount, tax_fee_amount, total_amount from public.orders order by id$$,
  $$values
    (125::numeric, 0::numeric, 125::numeric),
    (125::numeric, 0::numeric, 125::numeric),
    (125::numeric, 0::numeric, 125::numeric),
    (125::numeric, 0::numeric, 125::numeric)$$,
  'barn and feather updates do not change order totals'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'f1000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select public.seller_update_inventory_item(
  (select inventory_item_id from barn_history_inventory),
  'female', null, 25, 0, null, 'Barn C', 'never_bred', 'excellent', true
);

reset role;

select results_eq(
  $$select orders.order_number, order_items.barn_location
    from public.order_items
    join public.orders on orders.id = order_items.order_id
    order by orders.order_number$$,
  $$values
    ('ACTIVE-1'::text, 'Barn C'::text),
    ('CANCELED-1'::text, 'Barn A'::text),
    ('COMPLETE-1'::text, 'Barn A'::text),
    ('PARTIAL-1'::text, 'Barn C'::text)$$,
  'repeated barn moves keep completed and canceled locations fixed'
);

select results_eq(
  $$select barn_location, feather_condition
    from public.inventory_items
    where id = (select inventory_item_id from barn_history_inventory)$$,
  $$values ('Barn C'::text, 'excellent'::text)$$,
  'the edited listing persists the latest barn and feather condition'
);

select * from finish();
rollback;
