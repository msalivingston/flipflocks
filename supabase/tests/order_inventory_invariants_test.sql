begin;

create extension if not exists pgtap with schema extensions;

select plan(73);

-- The concurrency probe uses committed fixtures in two independent sessions.
-- An exclusive advisory lock acts as a deterministic start gate. Both checkout
-- sessions must be waiting for a shared transaction lock before the gate opens.
create temporary table concurrency_probe (
  available boolean not null,
  infrastructure_sqlstate text,
  infrastructure_message text,
  infrastructure_context text,
  first_outcome text,
  first_order_id uuid,
  first_sqlstate text,
  first_message text,
  second_outcome text,
  second_order_id uuid,
  second_sqlstate text,
  second_message text,
  success_count integer,
  unavailable_count integer,
  remaining_quantity integer,
  order_count integer,
  idempotency_count integer,
  authoritative_idempotency_count integer
) on commit drop;

do $probe$
declare
  v_connection_string text := format(
    'hostaddr=%s port=5432 dbname=%s user=postgres password=postgres',
    host(inet_server_addr()),
    current_database()
  );
  v_gate_key bigint := 741852963;
  v_first_pid integer;
  v_second_pid integer;
  v_waiter_count integer;
  v_wait_deadline timestamptz;
  v_first_outcome text;
  v_first_order_id uuid;
  v_first_sqlstate text;
  v_first_message text;
  v_second_outcome text;
  v_second_order_id uuid;
  v_second_sqlstate text;
  v_second_message text;
  v_remaining_quantity integer;
  v_order_count integer;
  v_idempotency_count integer;
  v_authoritative_idempotency_count integer;
  v_infrastructure_sqlstate text;
  v_infrastructure_message text;
  v_infrastructure_context text;
  v_gate_locked boolean := false;
begin
  if not exists (
    select 1
    from pg_available_extensions
    where name = 'dblink'
  ) then
    insert into concurrency_probe (
      available,
      infrastructure_message
    )
    values (
      false,
      'dblink is not available in this PostgreSQL image'
    );
    return;
  end if;

  execute 'create extension if not exists dblink with schema extensions';

  execute format(
    'select extensions.dblink_connect(%L, %L)',
    'order_inventory_first',
    v_connection_string
  );
  execute format(
    'select extensions.dblink_connect(%L, %L)',
    'order_inventory_second',
    v_connection_string
  );

  execute format(
    'select extensions.dblink_exec(%L, %L)',
    'order_inventory_first',
    $remote$
      set "request.jwt.claim.role" = 'service_role';

      drop function if exists public.__order_inventory_test_checkout_attempt(text);
      drop function if exists public.__order_inventory_test_checkout_attempt(text, bigint);
      delete from public.stores
      where id = 'c1000000-0000-4000-8000-000000000010';
      delete from auth.users
      where id = 'c1000000-0000-4000-8000-000000000001';

      insert into auth.users (
        id,
        instance_id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        confirmation_token,
        email_change,
        email_change_token_new,
        recovery_token
      )
      values (
        'c1000000-0000-4000-8000-000000000001',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'concurrency-owner@example.test',
        '',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now(),
        '',
        '',
        '',
        ''
      );

      insert into public.stores (
        id,
        owner_user_id,
        store_name,
        store_slug,
        store_status,
        storefront_mode,
        storefront_enabled
      )
      values (
        'c1000000-0000-4000-8000-000000000010',
        'c1000000-0000-4000-8000-000000000001',
        'Concurrency Invariant Store',
        'concurrency-invariant-store',
        'live',
        'hosted',
        true
      );

      insert into public.seller_billing_status (store_id, plan_key)
      values (
        'c1000000-0000-4000-8000-000000000010',
        'full_flock'
      );

      insert into public.equipment_inventory_items (
        id,
        store_id,
        item_name,
        category,
        condition,
        quantity_available,
        price,
        visibility_status,
        moderation_status,
        available_date
      )
      values (
        'c1000000-0000-4000-8000-000000000050',
        'c1000000-0000-4000-8000-000000000010',
        'Final Unit Feeder',
        'Feeders & Waterers',
        'Good',
        1,
        25.00,
        'active',
        'normal',
        current_date
      );

      create function public.__order_inventory_test_checkout_attempt(
        p_key text,
        p_gate_key bigint
      )
      returns table (
        outcome text,
        order_id uuid,
        error_sqlstate text,
        error_message text
      )
      language plpgsql
      security definer
      set search_path = public
      as $function$
      declare
        v_error_sqlstate text;
        v_error_message text;
      begin
        perform pg_advisory_xact_lock_shared(p_gate_key);

        return query
        select
          'success'::text,
          checkout.order_id,
          null::text,
          null::text
        from public.create_pay_at_pickup_order_v2(
          p_store_id => 'c1000000-0000-4000-8000-000000000010',
          p_idempotency_key => p_key,
          p_buyer_email => p_key || '@example.test',
          p_buyer_first_name => 'Concurrent',
          p_buyer_last_name => 'Buyer',
          p_items => jsonb_build_array(
            jsonb_build_object(
              'item_type', 'equipment_inventory',
              'item_id', 'c1000000-0000-4000-8000-000000000050',
              'quantity', 1
            )
          ),
          p_buyer_phone => '555-0100',
          p_delivery_address_line1 => '1 Test Lane',
          p_delivery_city => 'Testville',
          p_delivery_state => 'CO',
          p_delivery_postal_code => '80000'
        ) as checkout;
      exception
        when others then
          get stacked diagnostics
            v_error_sqlstate = returned_sqlstate,
            v_error_message = message_text;

          if v_error_sqlstate = 'P0001'
            and v_error_message in (
              'Insufficient inventory quantity available.',
              'One or more inventory items are not available for checkout.'
            ) then
            return query
            select
              'inventory_unavailable'::text,
              null::uuid,
              v_error_sqlstate,
              v_error_message;
          else
            return query
            select
              'infrastructure_error'::text,
              null::uuid,
              v_error_sqlstate,
              v_error_message;
          end if;
      end;
      $function$;
    $remote$
  );

  execute format(
    $query$
      select pid
      from extensions.dblink(%L, %L) as result(pid integer)
    $query$,
    'order_inventory_first',
    'select pg_backend_pid()'
  )
  into v_first_pid;

  execute format(
    $query$
      select pid
      from extensions.dblink(%L, %L) as result(pid integer)
    $query$,
    'order_inventory_second',
    'select pg_backend_pid()'
  )
  into v_second_pid;

  perform pg_advisory_lock(v_gate_key);
  v_gate_locked := true;

  execute format(
    'select extensions.dblink_send_query(%L, %L)',
    'order_inventory_first',
    format(
      'select * from public.__order_inventory_test_checkout_attempt(%L, %s)',
      'concurrent-first',
      v_gate_key
    )
  );
  execute format(
    'select extensions.dblink_send_query(%L, %L)',
    'order_inventory_second',
    format(
      'select * from public.__order_inventory_test_checkout_attempt(%L, %s)',
      'concurrent-second',
      v_gate_key
    )
  );

  v_wait_deadline := clock_timestamp() + interval '10 seconds';
  loop
    select count(*)::integer
    into v_waiter_count
    from pg_locks
    where locktype = 'advisory'
      and pid in (v_first_pid, v_second_pid)
      and granted = false;

    exit when v_waiter_count = 2;

    if clock_timestamp() >= v_wait_deadline then
      raise exception using
        errcode = '57014',
        message = format(
          'Concurrency barrier timed out: expected 2 advisory-lock waiters, observed %s.',
          v_waiter_count
        );
    end if;
  end loop;

  perform pg_advisory_unlock(v_gate_key);
  v_gate_locked := false;

  execute $query$
    select outcome, order_id, error_sqlstate, error_message
    from extensions.dblink_get_result('order_inventory_first')
      as result(
        outcome text,
        order_id uuid,
        error_sqlstate text,
        error_message text
      )
  $query$
  into
    v_first_outcome,
    v_first_order_id,
    v_first_sqlstate,
    v_first_message;

  -- libpq keeps an async connection busy until the terminating empty result
  -- is consumed, even after the row-bearing result has been read.
  execute $query$
    select outcome, order_id, error_sqlstate, error_message
    from extensions.dblink_get_result('order_inventory_first')
      as result(
        outcome text,
        order_id uuid,
        error_sqlstate text,
        error_message text
      )
  $query$;

  execute $query$
    select outcome, order_id, error_sqlstate, error_message
    from extensions.dblink_get_result('order_inventory_second')
      as result(
        outcome text,
        order_id uuid,
        error_sqlstate text,
        error_message text
      )
  $query$
  into
    v_second_outcome,
    v_second_order_id,
    v_second_sqlstate,
    v_second_message;

  execute $query$
    select outcome, order_id, error_sqlstate, error_message
    from extensions.dblink_get_result('order_inventory_second')
      as result(
        outcome text,
        order_id uuid,
        error_sqlstate text,
        error_message text
      )
  $query$;

  execute format(
    $query$
      select
        remaining_quantity,
        order_count,
        idempotency_count,
        authoritative_idempotency_count
      from extensions.dblink(
        %L,
        %L
      ) as result(
        remaining_quantity integer,
        order_count integer,
        idempotency_count integer,
        authoritative_idempotency_count integer
      )
    $query$,
    'order_inventory_first',
    $remote$
      select
        (
          select quantity_available
          from public.equipment_inventory_items
          where id = 'c1000000-0000-4000-8000-000000000050'
        ),
        (
          select count(*)::integer
          from public.orders
          where store_id = 'c1000000-0000-4000-8000-000000000010'
        ),
        (
          select count(*)::integer
          from public.order_idempotency_keys
          where store_id = 'c1000000-0000-4000-8000-000000000010'
        ),
        (
          select count(*)::integer
          from public.order_idempotency_keys as idempotency
          join public.orders
            on orders.id = idempotency.order_id
           and orders.store_id = idempotency.store_id
          where idempotency.store_id = 'c1000000-0000-4000-8000-000000000010'
        )
    $remote$
  )
  into
    v_remaining_quantity,
    v_order_count,
    v_idempotency_count,
    v_authoritative_idempotency_count;

  insert into concurrency_probe (
    available,
    first_outcome,
    first_order_id,
    first_sqlstate,
    first_message,
    second_outcome,
    second_order_id,
    second_sqlstate,
    second_message,
    success_count,
    unavailable_count,
    remaining_quantity,
    order_count,
    idempotency_count,
    authoritative_idempotency_count
  )
  values (
    true,
    v_first_outcome,
    v_first_order_id,
    v_first_sqlstate,
    v_first_message,
    v_second_outcome,
    v_second_order_id,
    v_second_sqlstate,
    v_second_message,
    (v_first_outcome = 'success')::integer
      + (v_second_outcome = 'success')::integer,
    (v_first_outcome = 'inventory_unavailable')::integer
      + (v_second_outcome = 'inventory_unavailable')::integer,
    v_remaining_quantity,
    v_order_count,
    v_idempotency_count,
    v_authoritative_idempotency_count
  );

  execute format(
    'select extensions.dblink_exec(%L, %L)',
    'order_inventory_first',
    $remote$
      drop function if exists public.__order_inventory_test_checkout_attempt(text, bigint);
      delete from public.stores
      where id = 'c1000000-0000-4000-8000-000000000010';
      delete from auth.users
      where id = 'c1000000-0000-4000-8000-000000000001';
    $remote$
  );
  execute 'select extensions.dblink_disconnect(''order_inventory_first'')';
  execute 'select extensions.dblink_disconnect(''order_inventory_second'')';
exception
  when others then
    get stacked diagnostics
      v_infrastructure_sqlstate = returned_sqlstate,
      v_infrastructure_message = message_text,
      v_infrastructure_context = pg_exception_context;

    if v_gate_locked then
      perform pg_advisory_unlock(v_gate_key);
    end if;

    begin
      execute format(
        'select extensions.dblink_exec(%L, %L)',
        'order_inventory_first',
        $remote$
          drop function if exists public.__order_inventory_test_checkout_attempt(text, bigint);
          delete from public.stores
          where id = 'c1000000-0000-4000-8000-000000000010';
          delete from auth.users
          where id = 'c1000000-0000-4000-8000-000000000001';
        $remote$
      );
    exception
      when others then null;
    end;
    begin
      execute 'select extensions.dblink_disconnect(''order_inventory_first'')';
    exception
      when others then null;
    end;
    begin
      execute 'select extensions.dblink_disconnect(''order_inventory_second'')';
    exception
      when others then null;
    end;

    insert into concurrency_probe (
      available,
      infrastructure_sqlstate,
      infrastructure_message,
      infrastructure_context
    )
    values (
      true,
      v_infrastructure_sqlstate,
      v_infrastructure_message,
      v_infrastructure_context
    );
end;
$probe$;

select diag(
  format(
    'Concurrency infrastructure error [%s]: %s; context: %s',
    coalesce(infrastructure_sqlstate, 'unknown'),
    coalesce(infrastructure_message, 'no message'),
    coalesce(infrastructure_context, 'no context')
  )
)
from concurrency_probe
where available
  and infrastructure_sqlstate is not null;

select diag(
  format(
    'Concurrency outcomes: first=%s order=%s SQLSTATE=%s message=%s; second=%s order=%s SQLSTATE=%s message=%s',
    coalesce(first_outcome, 'null'),
    coalesce(first_order_id::text, 'null'),
    coalesce(first_sqlstate, 'none'),
    coalesce(first_message, 'none'),
    coalesce(second_outcome, 'null'),
    coalesce(second_order_id::text, 'null'),
    coalesce(second_sqlstate, 'none'),
    coalesce(second_message, 'none')
  )
)
from concurrency_probe
where available;

select *
from skip(
  coalesce(
    (select infrastructure_message from concurrency_probe),
    'dblink unavailable; final-unit concurrency assertions are pending'
  ),
  6
)
where (select not available from concurrency_probe)
union all
select ok(
  infrastructure_sqlstate is null
    and coalesce(first_outcome, '') <> 'infrastructure_error'
    and coalesce(second_outcome, '') <> 'infrastructure_error',
  'the dblink concurrency infrastructure completes without errors'
)
from concurrency_probe
where available
union all
select is(
  success_count,
  1,
  'exactly one concurrent checkout succeeds'
)
from concurrency_probe
where available
union all
select is(
  unavailable_count,
  1,
  'exactly one concurrent checkout fails because inventory is unavailable'
)
from concurrency_probe
where available
union all
select is(
  remaining_quantity,
  0,
  'the successful concurrent checkout deducts the final unit exactly once'
)
from concurrency_probe
where available
union all
select is(
  order_count,
  1,
  'only the successful concurrent checkout creates an order'
)
from concurrency_probe
where available
union all
select ok(
  idempotency_count = 1
    and authoritative_idempotency_count = 1,
  'only the successful authoritative idempotency record remains'
)
from concurrency_probe
where available;

select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'invariant-owner@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'other-owner@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

insert into public.stores (
  id,
  owner_user_id,
  store_name,
  store_slug,
  store_status,
  storefront_mode,
  storefront_enabled
)
values
  (
    'a1000000-0000-4000-8000-000000000010',
    'a1000000-0000-4000-8000-000000000001',
    'Order Invariant Store',
    'order-invariant-store',
    'live',
    'hosted',
    true
  ),
  (
    'a1000000-0000-4000-8000-000000000011',
    'a1000000-0000-4000-8000-000000000002',
    'Other Order Invariant Store',
    'other-order-invariant-store',
    'live',
    'hosted',
    true
  );

insert into public.seller_billing_status (store_id, plan_key)
values
  ('a1000000-0000-4000-8000-000000000010', 'full_flock'),
  ('a1000000-0000-4000-8000-000000000011', 'full_flock');

select ok(
  exists (
    select 1
    from public.species
    where slug = 'chicken'
      and is_active = true
  ),
  'the migrated database provides the active chicken species fixture'
);

insert into public.seller_breed_profiles (
  id,
  store_id,
  species_id,
  custom_breed_name,
  normalized_custom_breed_name,
  display_name,
  visibility_status,
  moderation_status
)
select
  'a1000000-0000-4000-8000-000000000020',
  'a1000000-0000-4000-8000-000000000010',
  species.id,
  'Invariant Chicken',
  'invariant chicken',
  'Invariant Chicken',
  'active',
  'normal'
from public.species
where species.slug = 'chicken';

insert into public.listing_batches (
  id,
  store_id,
  species_id,
  origin_date,
  available_date,
  base_price,
  batch_type,
  visibility_status,
  moderation_status
)
select
  'a1000000-0000-4000-8000-000000000030',
  'a1000000-0000-4000-8000-000000000010',
  species.id,
  current_date - 30,
  current_date - 1,
  10.00,
  'live_animals',
  'active',
  'normal'
from public.species
where species.slug = 'chicken';

insert into public.listing_batch_breeds (
  id,
  store_id,
  listing_batch_id,
  seller_breed_profile_id,
  visibility_status,
  moderation_status
)
values (
  'a1000000-0000-4000-8000-000000000031',
  'a1000000-0000-4000-8000-000000000010',
  'a1000000-0000-4000-8000-000000000030',
  'a1000000-0000-4000-8000-000000000020',
  'active',
  'normal'
);

insert into public.inventory_items (
  id,
  store_id,
  listing_batch_id,
  listing_batch_breed_id,
  inventory_type,
  quantity_available,
  price_override,
  visibility_status,
  moderation_status
)
values (
  'a1000000-0000-4000-8000-000000000040',
  'a1000000-0000-4000-8000-000000000010',
  'a1000000-0000-4000-8000-000000000030',
  'a1000000-0000-4000-8000-000000000031',
  'female',
  50,
  12.00,
  'active',
  'normal'
);

insert into public.equipment_inventory_items (
  id,
  store_id,
  item_name,
  category,
  condition,
  quantity_available,
  price,
  visibility_status,
  moderation_status,
  available_date
)
values
  (
    'a1000000-0000-4000-8000-000000000050',
    'a1000000-0000-4000-8000-000000000010',
    'Invariant Feeder',
    'Feeders & Waterers',
    'Good',
    50,
    20.00,
    'active',
    'normal',
    current_date
  ),
  (
    'a1000000-0000-4000-8000-000000000051',
    'a1000000-0000-4000-8000-000000000011',
    'Other Store Feeder',
    'Feeders & Waterers',
    'Good',
    10,
    20.00,
    'active',
    'normal',
    current_date
  );

insert into public.processed_poultry_inventory_items (
  id,
  store_id,
  product_name,
  poultry_type,
  product_type,
  quantity_available,
  price,
  visibility_status,
  moderation_status,
  available_date
)
values (
  'a1000000-0000-4000-8000-000000000060',
  'a1000000-0000-4000-8000-000000000010',
  'Invariant Whole Bird',
  'Chicken',
  'Meat & Broth',
  50,
  30.00,
  'active',
  'normal',
  current_date
);

insert into public.hatching_egg_inventory_items (
  id,
  store_id,
  item_name,
  species_id,
  quantity_available,
  price,
  available_date,
  minimum_order_quantity,
  visibility_status,
  moderation_status
)
select
  'a1000000-0000-4000-8000-000000000070',
  'a1000000-0000-4000-8000-000000000010',
  'Invariant Hatching Eggs',
  species.id,
  50,
  5.00,
  current_date,
  3,
  'active',
  'normal'
from public.species
where species.slug = 'chicken';

create function pg_temp.test_checkout(
  p_key text,
  p_items jsonb,
  p_email text default 'buyer@example.test'
)
returns uuid
language plpgsql
as $function$
declare
  v_order_id uuid;
begin
  select checkout.order_id
  into v_order_id
  from public.create_pay_at_pickup_order_v2(
    p_store_id => 'a1000000-0000-4000-8000-000000000010',
    p_idempotency_key => p_key,
    p_buyer_email => p_email,
    p_buyer_first_name => 'Invariant',
    p_buyer_last_name => 'Buyer',
    p_items => p_items,
    p_buyer_phone => '555-0110',
    p_delivery_address_line1 => '10 Test Lane',
    p_delivery_city => 'Testville',
    p_delivery_state => 'CO',
    p_delivery_postal_code => '80000'
  ) as checkout;

  drop table if exists pg_temp.requested_order_items;
  drop table if exists pg_temp.locked_order_items;
  return v_order_id;
exception
  when others then
    drop table if exists pg_temp.requested_order_items;
    drop table if exists pg_temp.locked_order_items;
    raise;
end;
$function$;

create function pg_temp.test_edit_order(
  p_order_id uuid,
  p_items jsonb
)
returns void
language plpgsql
as $function$
declare
  v_order public.orders%rowtype;
  v_customer public.customers%rowtype;
begin
  select orders.*
  into v_order
  from public.orders as orders
  where orders.id = p_order_id;

  select customers.*
  into v_customer
  from public.customers as customers
  where customers.id = v_order.customer_id;

  perform 1
  from public.seller_edit_order(
    p_order_id => p_order_id,
    p_items => p_items,
    p_customer_id => v_order.customer_id,
    p_customer_email => v_order.buyer_email_snapshot,
    p_customer_first_name => v_order.buyer_first_name_snapshot,
    p_customer_last_name => v_order.buyer_last_name_snapshot,
    p_customer_phone => v_order.buyer_phone_snapshot,
    p_business_name => v_customer.business_name,
    p_buyer_notes => v_order.buyer_notes,
    p_fulfillment_method => v_order.fulfillment_method,
    p_pickup_option_id => v_order.pickup_option_id,
    p_pickup_note => v_order.pickup_note,
    p_delivery_option_name_snapshot => v_order.delivery_option_name_snapshot,
    p_delivery_fee_amount => v_order.delivery_fee_amount,
    p_delivery_address_line1 => v_order.buyer_address_line1_snapshot,
    p_delivery_address_line2 => v_order.buyer_address_line2_snapshot,
    p_delivery_city => v_order.buyer_city_snapshot,
    p_delivery_state => v_order.buyer_state_snapshot,
    p_delivery_postal_code => v_order.buyer_postal_code_snapshot,
    p_delivery_country => v_order.buyer_country_snapshot,
    p_tax_fee_amount => v_order.tax_fee_amount
  );

  drop table if exists pg_temp.edit_existing_items;
  drop table if exists pg_temp.edit_requested_items;
  drop table if exists pg_temp.edit_removed_items;
  drop table if exists pg_temp.edit_inventory_deltas;
exception
  when others then
    drop table if exists pg_temp.edit_existing_items;
    drop table if exists pg_temp.edit_requested_items;
    drop table if exists pg_temp.edit_removed_items;
    drop table if exists pg_temp.edit_inventory_deltas;
    raise;
end;
$function$;

select set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $test$
    select pg_temp.test_checkout(
      'normal-checkout',
      '[{"inventory_item_id":"a1000000-0000-4000-8000-000000000040","quantity":2}]'::jsonb
    )
  $test$,
  'a normal checkout succeeds through the current public order RPC'
);

select is(
  (
    select count(*)::integer
    from public.order_items
    where order_id = (
      select order_id
      from public.order_idempotency_keys
      where store_id = 'a1000000-0000-4000-8000-000000000010'
        and idempotency_key = 'normal-checkout'
    )
      and order_item_source = 'listing_inventory'
  ),
  1,
  'normal checkout creates the expected Live Birds order line'
);

select is(
  (
    select quantity_available
    from public.inventory_items
    where id = 'a1000000-0000-4000-8000-000000000040'
  ),
  48,
  'normal checkout deducts the requested Live Birds quantity'
);

select is(
  pg_temp.test_checkout(
    'normal-checkout',
    '[{"inventory_item_id":"a1000000-0000-4000-8000-000000000040","quantity":2}]'::jsonb
  ),
  (
    select order_id
    from public.order_idempotency_keys
    where store_id = 'a1000000-0000-4000-8000-000000000010'
      and idempotency_key = 'normal-checkout'
  ),
  'same-key same-payload retry returns the authoritative order ID'
);

select is(
  (
    select count(*)::integer
    from public.orders
    where id = (
      select order_id
      from public.order_idempotency_keys
      where store_id = 'a1000000-0000-4000-8000-000000000010'
        and idempotency_key = 'normal-checkout'
    )
  ),
  1,
  'same-key same-payload retry returns the authoritative order'
);

select is(
  (
    select quantity_available
    from public.inventory_items
    where id = 'a1000000-0000-4000-8000-000000000040'
  ),
  48,
  'same-key retry does not deduct inventory twice'
);

select throws_ok(
  $test$
    select pg_temp.test_checkout(
      'normal-checkout',
      '[{"inventory_item_id":"a1000000-0000-4000-8000-000000000040","quantity":3}]'::jsonb
    )
  $test$,
  'P0001',
  'Idempotency key was already used with a different request.',
  'same idempotency key with a different payload is rejected'
);

select is(
  (
    select count(*)::integer
    from public.orders
    where store_id = 'a1000000-0000-4000-8000-000000000010'
      and id = (
        select order_id
        from public.order_idempotency_keys
        where store_id = 'a1000000-0000-4000-8000-000000000010'
          and idempotency_key = 'normal-checkout'
      )
  ),
  1,
  'different-payload retry leaves the authoritative order unchanged'
);

select throws_ok(
  $test$
    select pg_temp.test_checkout(
      'failed-multi-line',
      '[
        {"item_type":"equipment_inventory","item_id":"a1000000-0000-4000-8000-000000000050","quantity":2},
        {"item_type":"processed_poultry_inventory","item_id":"a1000000-0000-4000-8000-000000000060","quantity":999}
      ]'::jsonb
    )
  $test$,
  'P0001',
  'Insufficient inventory quantity available.',
  'a multi-line order fails when any line cannot be fulfilled'
);

select is(
  (
    select quantity_available
    from public.equipment_inventory_items
    where id = 'a1000000-0000-4000-8000-000000000050'
  ),
  50,
  'failed multi-line order rolls back Equipment & Supplies inventory'
);

select is(
  (
    select quantity_available
    from public.processed_poultry_inventory_items
    where id = 'a1000000-0000-4000-8000-000000000060'
  ),
  50,
  'failed multi-line order rolls back Poultry Products inventory'
);

select is(
  (
    select count(*)::integer
    from public.order_idempotency_keys
    where store_id = 'a1000000-0000-4000-8000-000000000010'
      and idempotency_key = 'failed-multi-line'
  ),
  0,
  'failed multi-line order rolls back its idempotency reservation'
);

select throws_ok(
  $test$
    select pg_temp.test_checkout(
      'cross-store-item',
      '[{"item_type":"equipment_inventory","item_id":"a1000000-0000-4000-8000-000000000051","quantity":1}]'::jsonb
    )
  $test$,
  'P0001',
  'One or more inventory items do not belong to this store.',
  'a cross-store inventory ID is rejected'
);

select is(
  (
    select count(*)::integer
    from public.order_idempotency_keys
    where store_id = 'a1000000-0000-4000-8000-000000000010'
      and idempotency_key = 'cross-store-item'
  ),
  0,
  'cross-store rejection creates no idempotency reservation or order'
);

select throws_ok(
  $test$
    select pg_temp.test_checkout(
      'hatching-minimum',
      '[{"item_type":"hatching_egg_inventory","item_id":"a1000000-0000-4000-8000-000000000070","quantity":2}]'::jsonb
    )
  $test$,
  'P0001',
  'One or more inventory items are not available for checkout.',
  'the database checkout RPC enforces Hatching Eggs minimum quantities'
);

select is(
  (
    select quantity_available
    from public.hatching_egg_inventory_items
    where id = 'a1000000-0000-4000-8000-000000000070'
  ),
  50,
  'a below-minimum Hatching Eggs request leaves inventory unchanged'
);

select is(
  (
    select count(*)::integer
    from public.order_idempotency_keys
    where store_id = 'a1000000-0000-4000-8000-000000000010'
      and idempotency_key = 'hatching-minimum'
  ),
  0,
  'a below-minimum Hatching Eggs request creates no order reservation'
);

select lives_ok(
  $test$
    select *
    from public.seller_create_manual_order(
      p_store_id => 'a1000000-0000-4000-8000-000000000010',
      p_idempotency_key => 'manual-custom-line',
      p_items => '[{"item_type":"custom","custom_item_name":"Delivery crate deposit","quantity":2,"unit_price":7.50}]'::jsonb,
      p_customer_email => 'manual@example.test',
      p_customer_first_name => 'Manual',
      p_customer_last_name => 'Buyer'
    )
  $test$,
  'a seller can create a manual custom order line'
);

select is(
  (
    select count(*)::integer
    from public.order_items
    where order_id = (
      select order_id
      from public.order_idempotency_keys
      where store_id = 'a1000000-0000-4000-8000-000000000010'
        and idempotency_key = 'manual-custom-line'
    )
      and order_item_source = 'custom'
      and inventory_item_id is null
      and equipment_inventory_item_id is null
      and processed_poultry_inventory_item_id is null
      and hatching_egg_inventory_item_id is null
  ),
  1,
  'manual custom order lines have no inventory source'
);

select is((select quantity_available from public.inventory_items where id = 'a1000000-0000-4000-8000-000000000040'), 48, 'manual custom lines do not alter Live Birds inventory');
select is((select quantity_available from public.equipment_inventory_items where id = 'a1000000-0000-4000-8000-000000000050'), 50, 'manual custom lines do not alter Equipment & Supplies inventory');
select is((select quantity_available from public.processed_poultry_inventory_items where id = 'a1000000-0000-4000-8000-000000000060'), 50, 'manual custom lines do not alter Poultry Products inventory');
select is((select quantity_available from public.hatching_egg_inventory_items where id = 'a1000000-0000-4000-8000-000000000070'), 50, 'manual custom lines do not alter Hatching Eggs inventory');

select lives_ok(
  $test$
    select pg_temp.test_checkout(
      'editable-equipment-order',
      '[{"item_type":"equipment_inventory","item_id":"a1000000-0000-4000-8000-000000000050","quantity":3}]'::jsonb
    )
  $test$,
  'an editable Equipment & Supplies order is created'
);

select lives_ok(
  $test$
    select pg_temp.test_edit_order(
      (
        select order_id
        from public.order_idempotency_keys
        where store_id = 'a1000000-0000-4000-8000-000000000010'
          and idempotency_key = 'editable-equipment-order'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'order_item_id',
          (
            select id
            from public.order_items
            where order_id = (
              select order_id
              from public.order_idempotency_keys
              where store_id = 'a1000000-0000-4000-8000-000000000010'
                and idempotency_key = 'editable-equipment-order'
            )
          ),
          'item_type', 'equipment_inventory',
          'item_id', 'a1000000-0000-4000-8000-000000000050',
          'quantity', 5,
          'unit_price', 20.00,
          'change_inventory', true
        )
      )
    )
  $test$,
  'editing an order quantity upward succeeds'
);

select is(
  (select quantity_available from public.equipment_inventory_items where id = 'a1000000-0000-4000-8000-000000000050'),
  45,
  'editing quantity from three to five deducts only the two-unit delta'
);

select lives_ok(
  $test$
    select pg_temp.test_edit_order(
      (
        select order_id
        from public.order_idempotency_keys
        where store_id = 'a1000000-0000-4000-8000-000000000010'
          and idempotency_key = 'editable-equipment-order'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'order_item_id',
          (
            select id
            from public.order_items
            where order_id = (
              select order_id
              from public.order_idempotency_keys
              where store_id = 'a1000000-0000-4000-8000-000000000010'
                and idempotency_key = 'editable-equipment-order'
            )
          ),
          'item_type', 'equipment_inventory',
          'item_id', 'a1000000-0000-4000-8000-000000000050',
          'quantity', 2,
          'unit_price', 20.00,
          'change_inventory', true
        )
      )
    )
  $test$,
  'editing an order quantity downward succeeds'
);

select is(
  (select quantity_available from public.equipment_inventory_items where id = 'a1000000-0000-4000-8000-000000000050'),
  48,
  'editing quantity from five to two restores only the three-unit delta'
);

select set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000002',
  true
);

select throws_ok(
  $test$
    select pg_temp.test_edit_order(
      (
        select order_id
        from public.order_idempotency_keys
        where store_id = 'a1000000-0000-4000-8000-000000000010'
          and idempotency_key = 'editable-equipment-order'
      ),
      '[]'::jsonb
    )
  $test$,
  'P0001',
  'Order is not available.',
  'a different store owner cannot edit the order'
);

select set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000001',
  true
);

select lives_ok(
  $test$
    select pg_temp.test_checkout(
      'cancel-all-sources',
      '[
        {"inventory_item_id":"a1000000-0000-4000-8000-000000000040","quantity":4},
        {"item_type":"equipment_inventory","item_id":"a1000000-0000-4000-8000-000000000050","quantity":4},
        {"item_type":"processed_poultry_inventory","item_id":"a1000000-0000-4000-8000-000000000060","quantity":4},
        {"item_type":"hatching_egg_inventory","item_id":"a1000000-0000-4000-8000-000000000070","quantity":4}
      ]'::jsonb
    )
  $test$,
  'an order spanning all four inventory sources is created'
);

select lives_ok(
  $test$
    select *
    from public.cancel_order(
      (
        select order_id
        from public.order_idempotency_keys
        where store_id = 'a1000000-0000-4000-8000-000000000010'
          and idempotency_key = 'cancel-all-sources'
      ),
      'Invariant cancellation',
      true,
      false
    )
  $test$,
  'canceling with inventory restoration enabled succeeds'
);

select is((select quantity_available from public.inventory_items where id = 'a1000000-0000-4000-8000-000000000040'), 48, 'cancellation restores Live Birds inventory');
select is((select quantity_available from public.equipment_inventory_items where id = 'a1000000-0000-4000-8000-000000000050'), 48, 'cancellation preserves existing Equipment & Supplies restoration behavior');
select is((select quantity_available from public.processed_poultry_inventory_items where id = 'a1000000-0000-4000-8000-000000000060'), 50, 'cancellation preserves existing Poultry Products restoration behavior');
select is((select quantity_available from public.hatching_egg_inventory_items where id = 'a1000000-0000-4000-8000-000000000070'), 50, 'cancellation restores standalone Hatching Eggs inventory');

select is(
  (
    select count(*)::integer
    from public.order_items
    where order_id = (
      select order_id
      from public.order_idempotency_keys
      where store_id = 'a1000000-0000-4000-8000-000000000010'
        and idempotency_key = 'cancel-all-sources'
    )
      and restored_quantity = quantity
  ),
  4,
  'cancellation records restored_quantity consistently for all four sources'
);

select results_eq(
  $test$
    select order_status, payment_status
    from public.orders
    where id = (
      select order_id
      from public.order_idempotency_keys
      where store_id = 'a1000000-0000-4000-8000-000000000010'
        and idempotency_key = 'cancel-all-sources'
    )
  $test$,
  $expected$
    values ('canceled'::text, 'canceled'::text)
  $expected$,
  'an eligible pay-at-pickup order is canceled with its unpaid payment state canceled'
);

select throws_ok(
  $test$
    select *
    from public.cancel_order(
      (
        select order_id
        from public.order_idempotency_keys
        where store_id = 'a1000000-0000-4000-8000-000000000010'
          and idempotency_key = 'cancel-all-sources'
      ),
      'Repeated cancellation',
      true,
      false
    )
  $test$,
  'P0001',
  'Only pending or open orders can be canceled.',
  'repeated cancellation is rejected before inventory can be restored again'
);

select ok(
  (select quantity_available from public.inventory_items where id = 'a1000000-0000-4000-8000-000000000040') = 48
  and (select quantity_available from public.equipment_inventory_items where id = 'a1000000-0000-4000-8000-000000000050') = 48
  and (select quantity_available from public.processed_poultry_inventory_items where id = 'a1000000-0000-4000-8000-000000000060') = 50
  and (select quantity_available from public.hatching_egg_inventory_items where id = 'a1000000-0000-4000-8000-000000000070') = 50,
  'repeated cancellation does not restore any inventory source twice'
);

select is(
  (
    select count(*)::integer
    from public.order_items
    where order_id = (
      select order_id
      from public.order_idempotency_keys
      where store_id = 'a1000000-0000-4000-8000-000000000010'
        and idempotency_key = 'cancel-all-sources'
    )
      and restored_quantity = quantity
  ),
  4,
  'repeated cancellation does not increment restored_quantity twice'
);

select lives_ok(
  $test$
    select pg_temp.test_checkout(
      'cancel-without-restoration',
      '[{"item_type":"hatching_egg_inventory","item_id":"a1000000-0000-4000-8000-000000000070","quantity":3}]'::jsonb
    )
  $test$,
  'a Hatching Eggs order for no-restoration cancellation is created'
);

select lives_ok(
  $test$
    select *
    from public.cancel_order(
      (
        select order_id
        from public.order_idempotency_keys
        where store_id = 'a1000000-0000-4000-8000-000000000010'
          and idempotency_key = 'cancel-without-restoration'
      ),
      'Do not restore inventory',
      false,
      false
    )
  $test$,
  'canceling with inventory restoration disabled succeeds'
);

select is(
  (select quantity_available from public.hatching_egg_inventory_items where id = 'a1000000-0000-4000-8000-000000000070'),
  47,
  'cancellation with restoration disabled leaves Hatching Eggs inventory deducted'
);

select is(
  (
    select restored_quantity
    from public.order_items
    where order_id = (
      select order_id
      from public.order_idempotency_keys
      where store_id = 'a1000000-0000-4000-8000-000000000010'
        and idempotency_key = 'cancel-without-restoration'
    )
  ),
  0,
  'cancellation with restoration disabled leaves restored_quantity unchanged'
);

select throws_ok(
  $test$
    select pg_temp.test_edit_order(
      (
        select order_id
        from public.order_idempotency_keys
        where store_id = 'a1000000-0000-4000-8000-000000000010'
          and idempotency_key = 'cancel-without-restoration'
      ),
      '[]'::jsonb
    )
  $test$,
  'P0001',
  'Canceled orders cannot be edited.',
  'canceled orders cannot be edited'
);

select lives_ok(
  $test$
    select pg_temp.test_checkout(
      'pending-pay-at-pickup-cancellation',
      '[{"item_type":"equipment_inventory","item_id":"a1000000-0000-4000-8000-000000000050","quantity":1}]'::jsonb
    )
  $test$,
  'a pay-at-pickup order for pending-state cancellation is created'
);

update public.orders
set order_status = 'pending'
where id = (
  select order_id
  from public.order_idempotency_keys
  where store_id = 'a1000000-0000-4000-8000-000000000010'
    and idempotency_key = 'pending-pay-at-pickup-cancellation'
);

select lives_ok(
  $test$
    select *
    from public.cancel_order(
      (
        select order_id
        from public.order_idempotency_keys
        where store_id = 'a1000000-0000-4000-8000-000000000010'
          and idempotency_key = 'pending-pay-at-pickup-cancellation'
      ),
      'Pending pay-at-pickup cancellation',
      true,
      false
    )
  $test$,
  'a pending pay-at-pickup order can be canceled'
);

select results_eq(
  $test$
    select order_status, payment_status
    from public.orders
    where id = (
      select order_id
      from public.order_idempotency_keys
      where store_id = 'a1000000-0000-4000-8000-000000000010'
        and idempotency_key = 'pending-pay-at-pickup-cancellation'
    )
  $test$,
  $expected$
    values ('canceled'::text, 'canceled'::text)
  $expected$,
  'pending pay-at-pickup cancellation records canceled states'
);

select is(
  (select quantity_available from public.equipment_inventory_items where id = 'a1000000-0000-4000-8000-000000000050'),
  48,
  'pending pay-at-pickup cancellation restores inventory'
);

select lives_ok(
  $test$
    select pg_temp.test_checkout(
      'unpaid-online-cancellation',
      '[{"item_type":"processed_poultry_inventory","item_id":"a1000000-0000-4000-8000-000000000060","quantity":2}]'::jsonb
    )
  $test$,
  'an order for unpaid online cancellation is created'
);

update public.orders
set
  payment_method = 'stripe_checkout',
  payment_status = 'unpaid',
  payment_provider = 'stripe',
  provider_payment_status = 'unpaid'
where id = (
  select order_id
  from public.order_idempotency_keys
  where store_id = 'a1000000-0000-4000-8000-000000000010'
    and idempotency_key = 'unpaid-online-cancellation'
);

select lives_ok(
  $test$
    select *
    from public.cancel_order(
      (
        select order_id
        from public.order_idempotency_keys
        where store_id = 'a1000000-0000-4000-8000-000000000010'
          and idempotency_key = 'unpaid-online-cancellation'
      ),
      'Unpaid online cancellation',
      true,
      false
    )
  $test$,
  'an unpaid online order can be canceled'
);

select results_eq(
  $test$
    select order_status, payment_status
    from public.orders
    where id = (
      select order_id
      from public.order_idempotency_keys
      where store_id = 'a1000000-0000-4000-8000-000000000010'
        and idempotency_key = 'unpaid-online-cancellation'
    )
  $test$,
  $expected$
    values ('canceled'::text, 'canceled'::text)
  $expected$,
  'unpaid online cancellation records the canceled order and payment states'
);

select is(
  (select quantity_available from public.processed_poultry_inventory_items where id = 'a1000000-0000-4000-8000-000000000060'),
  50,
  'eligible unpaid online cancellation restores inventory'
);

select lives_ok(
  $test$
    select pg_temp.test_checkout(
      'paid-online-cancellation',
      '[{"inventory_item_id":"a1000000-0000-4000-8000-000000000040","quantity":2}]'::jsonb
    )
  $test$,
  'an order for paid online cancellation rejection is created'
);

update public.orders
set
  payment_method = 'stripe_checkout',
  payment_status = 'paid',
  payment_provider = 'stripe',
  provider_payment_status = 'paid',
  paid_at = now()
where id = (
  select order_id
  from public.order_idempotency_keys
  where store_id = 'a1000000-0000-4000-8000-000000000010'
    and idempotency_key = 'paid-online-cancellation'
);

select throws_ok(
  $test$
    select *
    from public.cancel_order(
      (
        select order_id
        from public.order_idempotency_keys
        where store_id = 'a1000000-0000-4000-8000-000000000010'
          and idempotency_key = 'paid-online-cancellation'
      ),
      'Blocked paid online cancellation',
      true,
      true
    )
  $test$,
  'P0001',
  'Paid online orders cannot be canceled until Stripe refunds are supported.',
  'a paid online order is rejected before cancellation side effects'
);

select results_eq(
  $test$
    select order_status, canceled_at is null
    from public.orders
    where id = (
      select order_id
      from public.order_idempotency_keys
      where store_id = 'a1000000-0000-4000-8000-000000000010'
        and idempotency_key = 'paid-online-cancellation'
    )
  $test$,
  $expected$
    values ('open'::text, true)
  $expected$,
  'rejected paid online cancellation leaves order status and canceled timestamp unchanged'
);

select is(
  (
    select payment_status
    from public.orders
    where id = (
      select order_id
      from public.order_idempotency_keys
      where store_id = 'a1000000-0000-4000-8000-000000000010'
        and idempotency_key = 'paid-online-cancellation'
    )
  ),
  'paid',
  'rejected paid online cancellation leaves payment status unchanged'
);

select is(
  (select quantity_available from public.inventory_items where id = 'a1000000-0000-4000-8000-000000000040'),
  46,
  'rejected paid online cancellation leaves inventory deducted'
);

select is(
  (
    select restored_quantity
    from public.order_items
    where order_id = (
      select order_id
      from public.order_idempotency_keys
      where store_id = 'a1000000-0000-4000-8000-000000000010'
        and idempotency_key = 'paid-online-cancellation'
    )
  ),
  0,
  'rejected paid online cancellation records no inventory restoration'
);

select is(
  (
    select count(*)::integer
    from public.order_events
    where order_id = (
      select order_id
      from public.order_idempotency_keys
      where store_id = 'a1000000-0000-4000-8000-000000000010'
        and idempotency_key = 'paid-online-cancellation'
    )
      and event_type = 'order_canceled'
  ),
  0,
  'rejected paid online cancellation creates no cancellation event'
);

select is(
  (
    select count(*)::integer
    from public.inventory_activity_events
    where metadata ->> 'order_id' = (
      select order_id::text
      from public.order_idempotency_keys
      where store_id = 'a1000000-0000-4000-8000-000000000010'
        and idempotency_key = 'paid-online-cancellation'
    )
      and note = 'Canceled order inventory restoration'
  ),
  0,
  'rejected paid online cancellation creates no inventory audit event'
);

select is(
  (
    select count(*)::integer
    from public.email_notifications
    where order_id = (
      select order_id
      from public.order_idempotency_keys
      where store_id = 'a1000000-0000-4000-8000-000000000010'
        and idempotency_key = 'paid-online-cancellation'
    )
      and notification_type in (
        'buyer_order_canceled',
        'seller_order_canceled_copy'
      )
  ),
  0,
  'rejected paid online cancellation queues no cancellation notifications'
);

select lives_ok(
  $test$
    select pg_temp.test_checkout(
      'fulfilled-order',
      '[{"inventory_item_id":"a1000000-0000-4000-8000-000000000040","quantity":1}]'::jsonb
    )
  $test$,
  'an order for the fulfilled-state edit guard is created'
);

select lives_ok(
  $test$
    select *
    from public.mark_order_fulfilled(
      (
        select order_id
        from public.order_idempotency_keys
        where store_id = 'a1000000-0000-4000-8000-000000000010'
          and idempotency_key = 'fulfilled-order'
      ),
      'Fulfilled for invariant test'
    )
  $test$,
  'the current fulfillment RPC marks the order fulfilled'
);

select throws_ok(
  $test$
    select *
    from public.cancel_order(
      (
        select order_id
        from public.order_idempotency_keys
        where store_id = 'a1000000-0000-4000-8000-000000000010'
          and idempotency_key = 'fulfilled-order'
      ),
      'Fulfilled cancellation attempt',
      true,
      false
    )
  $test$,
  'P0001',
  'Only pending or open orders can be canceled.',
  'fulfilled orders remain ineligible for cancellation'
);

select throws_ok(
  $test$
    select pg_temp.test_edit_order(
      (
        select order_id
        from public.order_idempotency_keys
        where store_id = 'a1000000-0000-4000-8000-000000000010'
          and idempotency_key = 'fulfilled-order'
      ),
      '[]'::jsonb
    )
  $test$,
  'P0001',
  'Fulfilled orders cannot be edited.',
  'fulfilled orders cannot be edited'
);

select * from finish();

rollback;
