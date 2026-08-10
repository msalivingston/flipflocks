begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table first_sale_concurrency_probe (
  available boolean not null,
  infrastructure_message text,
  milestone_count bigint,
  notification_count bigint,
  distinct_order_count bigint
) on commit drop;

do $probe$
declare
  v_connection_string text := format(
    'hostaddr=%s port=5432 dbname=%s user=postgres password=postgres',
    host(inet_server_addr()), current_database()
  );
  v_milestone_count bigint;
  v_notification_count bigint;
  v_distinct_order_count bigint;
begin
  if not exists (select 1 from pg_available_extensions where name = 'dblink') then
    insert into first_sale_concurrency_probe(available, infrastructure_message)
    values (false, 'dblink is not available in this PostgreSQL image');
    return;
  end if;

  execute 'create extension if not exists dblink with schema extensions';
  perform extensions.dblink_connect('first_sale_setup', v_connection_string);
  perform extensions.dblink_connect('first_sale_one', v_connection_string);
  perform extensions.dblink_connect('first_sale_two', v_connection_string);

  perform extensions.dblink_exec('first_sale_setup', $remote$
    set "request.jwt.claim.role" = 'service_role';
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      'f1310000-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'race-owner@example.test', '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"first_name":"Taylor"}'::jsonb, now(), now(), '', '', '', ''
    );
    insert into public.stores (
      id, owner_user_id, store_name, store_slug, store_status, storefront_mode
    ) values (
      'f1310000-0000-4000-9000-000000000001',
      'f1310000-0000-4000-8000-000000000001',
      'First Sale Race Store', 'first-sale-race-store', 'live', 'hosted'
    );
    insert into public.seller_billing_status (
      store_id, requested_plan_key, requested_billing_cadence, plan_key,
      billing_plan, subscription_status, trial_started_at, trial_ends_at,
      current_period_start, current_period_end, storefront_access_until,
      billing_state_authority
    ) values (
      'f1310000-0000-4000-9000-000000000001',
      'small_flock', 'monthly', 'small_flock', 'monthly', 'trialing',
      statement_timestamp(), statement_timestamp() + interval '7 days',
      statement_timestamp(), statement_timestamp() + interval '7 days',
      statement_timestamp() + interval '7 days', 'trial'
    );
    insert into public.customers (id, store_id, email, first_name, last_name)
    values (
      'f1310000-0000-4000-a000-000000000001',
      'f1310000-0000-4000-9000-000000000001',
      'race-buyer@example.test', 'Race', 'Buyer'
    );
  $remote$);

  perform extensions.dblink_send_query('first_sale_one', $remote$
    insert into public.orders (
      id, store_id, customer_id, order_number, order_source, order_status,
      payment_method, payment_status, buyer_email_snapshot,
      buyer_first_name_snapshot, buyer_last_name_snapshot, total_amount
    ) values (
      'f1310000-0000-4000-b000-000000000001',
      'f1310000-0000-4000-9000-000000000001',
      'f1310000-0000-4000-a000-000000000001',
      'race-1', 'storefront', 'open', 'pay_at_pickup', 'pay_at_pickup',
      'race-buyer@example.test', 'Race', 'Buyer', 10.00
    )
  $remote$);
  perform extensions.dblink_send_query('first_sale_two', $remote$
    insert into public.orders (
      id, store_id, customer_id, order_number, order_source, order_status,
      payment_method, payment_status, buyer_email_snapshot,
      buyer_first_name_snapshot, buyer_last_name_snapshot, total_amount
    ) values (
      'f1310000-0000-4000-b000-000000000002',
      'f1310000-0000-4000-9000-000000000001',
      'f1310000-0000-4000-a000-000000000001',
      'race-2', 'storefront', 'open', 'pay_at_pickup', 'pay_at_pickup',
      'race-buyer@example.test', 'Race', 'Buyer', 12.00
    )
  $remote$);

  perform * from extensions.dblink_get_result('first_sale_one') as result(status text);
  perform * from extensions.dblink_get_result('first_sale_two') as result(status text);

  select count(*) into v_milestone_count
  from public.seller_first_sale_milestones
  where store_id = 'f1310000-0000-4000-9000-000000000001';
  select count(*), count(distinct order_id)
  into v_notification_count, v_distinct_order_count
  from public.email_notifications
  where store_id = 'f1310000-0000-4000-9000-000000000001'
    and notification_type = 'seller_first_sale';

  insert into first_sale_concurrency_probe(
    available, milestone_count, notification_count, distinct_order_count
  ) values (
    true, v_milestone_count, v_notification_count, v_distinct_order_count
  );

  perform extensions.dblink_exec('first_sale_setup', $remote$
    delete from public.email_notification_delivery_attempts
    where store_id = 'f1310000-0000-4000-9000-000000000001';
    delete from public.email_notifications
    where store_id = 'f1310000-0000-4000-9000-000000000001';
    delete from public.seller_first_sale_milestones
    where store_id = 'f1310000-0000-4000-9000-000000000001';
    delete from public.orders
    where store_id = 'f1310000-0000-4000-9000-000000000001';
    delete from public.customers
    where store_id = 'f1310000-0000-4000-9000-000000000001';
    delete from public.seller_billing_status
    where store_id = 'f1310000-0000-4000-9000-000000000001';
    delete from public.stores
    where id = 'f1310000-0000-4000-9000-000000000001';
    delete from auth.users
    where id = 'f1310000-0000-4000-8000-000000000001';
  $remote$);

  perform extensions.dblink_disconnect('first_sale_one');
  perform extensions.dblink_disconnect('first_sale_two');
  perform extensions.dblink_disconnect('first_sale_setup');
exception when others then
  begin
    perform extensions.dblink_exec('first_sale_setup', $cleanup$
      delete from public.email_notification_delivery_attempts
      where store_id = 'f1310000-0000-4000-9000-000000000001';
      delete from public.email_notifications
      where store_id = 'f1310000-0000-4000-9000-000000000001';
      delete from public.seller_first_sale_milestones
      where store_id = 'f1310000-0000-4000-9000-000000000001';
      delete from public.orders
      where store_id = 'f1310000-0000-4000-9000-000000000001';
      delete from public.customers
      where store_id = 'f1310000-0000-4000-9000-000000000001';
      delete from public.seller_billing_status
      where store_id = 'f1310000-0000-4000-9000-000000000001';
      delete from public.stores
      where id = 'f1310000-0000-4000-9000-000000000001';
      delete from auth.users
      where id = 'f1310000-0000-4000-8000-000000000001';
    $cleanup$);
  exception when others then null;
  end;
  raise;
end;
$probe$;

select case
  when available then pass('dblink concurrency infrastructure is available')
  else skip(infrastructure_message, 1)
end
from first_sale_concurrency_probe;
select is(milestone_count, 1::bigint,
  'concurrent qualifying orders create exactly one store milestone')
from first_sale_concurrency_probe where available;
select is(notification_count, 1::bigint,
  'concurrent qualifying orders enqueue exactly one first-sale notification')
from first_sale_concurrency_probe where available;
select is(distinct_order_count, 1::bigint,
  'the one notification retains exactly one winning qualifying order')
from first_sale_concurrency_probe where available;

select * from finish();
rollback;
