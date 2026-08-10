begin;

create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token
) values
  (
    'f1300000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'first-sale-owner@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Avery"}'::jsonb, now(), now(), '', '', '', ''
  ),
  (
    'f1300000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'offline-owner@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Morgan"}'::jsonb, now(), now(), '', '', '', ''
  ),
  (
    'f1300000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'invalid-owner@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Riley"}'::jsonb, now(), now(), '', '', '', ''
  );

insert into public.stores (
  id, owner_user_id, store_name, store_slug, store_status, storefront_mode
) values
  (
    'f1300000-0000-4000-9000-000000000001',
    'f1300000-0000-4000-8000-000000000001',
    'First Sale Store', 'first-sale-store', 'live', 'hosted'
  ),
  (
    'f1300000-0000-4000-9000-000000000002',
    'f1300000-0000-4000-8000-000000000002',
    'Offline Store', 'offline-store', 'live', 'hosted'
  ),
  (
    'f1300000-0000-4000-9000-000000000003',
    'f1300000-0000-4000-8000-000000000003',
    'Invalid Attempt Store', 'invalid-attempt-store', 'live', 'hosted'
  );

insert into public.seller_billing_status (
  store_id, requested_plan_key, requested_billing_cadence, plan_key,
  billing_plan, subscription_status, trial_started_at, trial_ends_at,
  current_period_start, current_period_end, storefront_access_until,
  billing_state_authority
)
select
  stores.id, 'small_flock', 'monthly', 'small_flock', 'monthly', 'trialing',
  statement_timestamp(), statement_timestamp() + interval '7 days',
  statement_timestamp(), statement_timestamp() + interval '7 days',
  statement_timestamp() + interval '7 days', 'trial'
from public.stores as stores
where stores.id in (
  'f1300000-0000-4000-9000-000000000001',
  'f1300000-0000-4000-9000-000000000002',
  'f1300000-0000-4000-9000-000000000003'
);

insert into public.customers (id, store_id, email, first_name, last_name)
values
  (
    'f1300000-0000-4000-a000-000000000001',
    'f1300000-0000-4000-9000-000000000001',
    'buyer-one@example.test', 'Jamie', 'Buyer'
  ),
  (
    'f1300000-0000-4000-a000-000000000002',
    'f1300000-0000-4000-9000-000000000002',
    'offline-buyer@example.test', 'Offline', 'Buyer'
  ),
  (
    'f1300000-0000-4000-a000-000000000003',
    'f1300000-0000-4000-9000-000000000003',
    'invalid-buyer@example.test', 'Invalid', 'Buyer'
  );

insert into public.orders (
  id, store_id, customer_id, order_number, order_source, order_status,
  payment_method, payment_status, buyer_email_snapshot,
  buyer_first_name_snapshot, buyer_last_name_snapshot,
  subtotal_amount, tax_fee_amount, total_amount
) values (
  'f1300000-0000-4000-b000-000000000001',
  'f1300000-0000-4000-9000-000000000001',
  'f1300000-0000-4000-a000-000000000001',
  '1042', 'storefront', 'open', 'pay_at_pickup', 'pay_at_pickup',
  'buyer-one@example.test', 'Jamie', 'Buyer', 125.00, 2.50, 127.50
);

select is(
  (select count(*) from public.seller_first_sale_milestones
   where store_id = 'f1300000-0000-4000-9000-000000000001'),
  1::bigint,
  'first accepted storefront order records one durable milestone'
);

select is(
  (select count(*) from public.email_notifications
   where store_id = 'f1300000-0000-4000-9000-000000000001'
     and notification_type = 'seller_first_sale'),
  1::bigint,
  'first accepted storefront order enqueues one first-sale notification'
);

select results_eq(
  $$
    select order_id, dedupe_key, recipient_type, recipient_email, subject_snapshot
    from public.email_notifications
    where notification_type = 'seller_first_sale'
      and store_id = 'f1300000-0000-4000-9000-000000000001'
  $$,
  $$ values (
    'f1300000-0000-4000-b000-000000000001'::uuid,
    'seller_first_sale:store:f1300000-0000-4000-9000-000000000001'::text,
    'seller_account'::text,
    'first-sale-owner@example.test'::text,
    'You made your first FlockFront sale!'::text
  ) $$,
  'notification keeps its order association and authenticated owner recipient'
);

insert into public.orders (
  id, store_id, customer_id, order_number, order_source, order_status,
  payment_method, payment_status, buyer_email_snapshot,
  buyer_first_name_snapshot, buyer_last_name_snapshot, total_amount
) values (
  'f1300000-0000-4000-b000-000000000002',
  'f1300000-0000-4000-9000-000000000001',
  'f1300000-0000-4000-a000-000000000001',
  '1043', 'storefront', 'open', 'pay_at_pickup', 'pay_at_pickup',
  'buyer-one@example.test', 'Jamie', 'Buyer', 20.00
);

select is(
  (select count(*) from public.email_notifications
   where store_id = 'f1300000-0000-4000-9000-000000000001'
     and notification_type = 'seller_first_sale'),
  1::bigint,
  'later storefront orders do not enqueue another milestone email'
);

insert into public.orders (
  id, store_id, customer_id, order_number, order_source, order_status,
  payment_method, payment_status, buyer_email_snapshot,
  buyer_first_name_snapshot, buyer_last_name_snapshot, total_amount
)
select
  gen_random_uuid(),
  'f1300000-0000-4000-9000-000000000002'::uuid,
  'f1300000-0000-4000-a000-000000000002'::uuid,
  'offline-' || source,
  source,
  'open', 'pay_at_pickup', 'pay_at_pickup',
  'offline-buyer@example.test', 'Offline', 'Buyer', 10.00
from unnest(array[
  'seller_created', 'manual', 'phone', 'text', 'market', 'event', 'imported'
]) as source;

select is(
  (select count(*) from public.seller_first_sale_milestones
   where store_id = 'f1300000-0000-4000-9000-000000000002'),
  0::bigint,
  'seller-created and all other non-storefront order sources do not qualify'
);

insert into public.orders (
  id, store_id, customer_id, order_number, order_source, order_status,
  payment_method, payment_status, buyer_email_snapshot,
  buyer_first_name_snapshot, buyer_last_name_snapshot, total_amount,
  canceled_at
) values
  (
    'f1300000-0000-4000-b000-000000000003',
    'f1300000-0000-4000-9000-000000000003',
    'f1300000-0000-4000-a000-000000000003',
    'invalid-canceled', 'storefront', 'canceled', 'pay_at_pickup', 'canceled',
    'invalid-buyer@example.test', 'Invalid', 'Buyer', 10.00,
    statement_timestamp()
  ),
  (
    'f1300000-0000-4000-b000-000000000004',
    'f1300000-0000-4000-9000-000000000003',
    'f1300000-0000-4000-a000-000000000003',
    'invalid-pending', 'storefront', 'pending', 'pay_at_pickup', 'pay_at_pickup',
    'invalid-buyer@example.test', 'Invalid', 'Buyer', 10.00,
    null
  );

select is(
  (select count(*) from public.seller_first_sale_milestones
   where store_id = 'f1300000-0000-4000-9000-000000000003'),
  0::bigint,
  'canceled and incomplete initial states do not qualify'
);

select results_eq(
  $$
    select recipient_email, first_name, order_id, order_number,
           order_total_cents, buyer_first_name
    from public.get_seller_first_sale_context(
      'f1300000-0000-4000-b000-000000000001'
    )
  $$,
  $$ values (
    'first-sale-owner@example.test'::text,
    'Avery'::text,
    'f1300000-0000-4000-b000-000000000001'::uuid,
    '1042'::text,
    12750::bigint,
    'Jamie'::text
  ) $$,
  'service context resolves exact owner, order number, total, and buyer first name'
);

select is(
  (
    select count(*)
    from public.claim_phase_1_postmark_email_notifications_for_order(
      'f1300000-0000-4000-b000-000000000001', 10, 5, interval '15 minutes'
    ) as claimed
    where claimed.notification_type = 'seller_first_sale'
      and claimed.order_id = 'f1300000-0000-4000-b000-000000000001'
  ),
  1::bigint,
  'existing order-scoped worker claim includes only the associated first-sale row'
);

select is(
  (
    select count(*)
    from public.claim_phase_1_postmark_email_notifications_for_order(
      'f1300000-0000-4000-b000-000000000001', 10, 5, interval '15 minutes'
    ) as claimed
    where claimed.notification_type = 'seller_first_sale'
  ),
  0::bigint,
  'an active worker claim cannot be duplicated by an immediate retry'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_seller_first_sale_context(uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot resolve first-sale owner context'
);

select * from finish();
rollback;
