-- Fully qualify public.create_pay_at_pickup_order(...) query references.
--
-- RETURNS TABLE output names are PL/pgSQL variables, so unqualified table
-- columns such as created_at, store_id, quantity, and status fields can collide
-- at runtime. This replaces only the checkout order RPC and does not change
-- order workflow logic or buyer-facing behavior.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.create_pay_at_pickup_order(
  p_store_id uuid,
  p_idempotency_key text,
  p_buyer_email text,
  p_buyer_first_name text,
  p_buyer_last_name text,
  p_items jsonb,
  p_buyer_phone text default null,
  p_business_name text default null,
  p_city text default null,
  p_state text default null,
  p_country text default null,
  p_delivery_address_line1 text default null,
  p_delivery_address_line2 text default null,
  p_delivery_city text default null,
  p_delivery_state text default null,
  p_delivery_postal_code text default null,
  p_delivery_country text default null,
  p_buyer_notes text default null,
  p_pickup_note text default null,
  p_buyer_ip_address inet default null,
  p_buyer_user_agent text default null,
  p_pickup_option_id uuid default null
)
returns table (
  order_id uuid,
  order_number text,
  store_id uuid,
  customer_id uuid,
  order_status text,
  payment_method text,
  payment_status text,
  subtotal_amount numeric(10, 2),
  tax_fee_amount numeric(10, 2),
  total_amount numeric(10, 2),
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_idempotency_key text;
  v_buyer_email text;
  v_buyer_first_name text;
  v_buyer_last_name text;
  v_buyer_phone text;
  v_business_name text;
  v_city text;
  v_state text;
  v_country text;
  v_delivery_address_line1 text;
  v_delivery_address_line2 text;
  v_delivery_city text;
  v_delivery_state text;
  v_delivery_postal_code text;
  v_delivery_country text;
  v_buyer_notes text;
  v_pickup_note text;
  v_buyer_user_agent text;
  v_pickup_option public.store_pickup_options%rowtype;
  v_pickup_option_label_snapshot text;

  v_request_hash text;
  v_existing_idempotency public.order_idempotency_keys%rowtype;
  v_store public.stores%rowtype;

  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_order_created_at timestamptz;
  v_next_order_number integer;
  v_subtotal_amount numeric(10, 2);
  v_tax_fee_amount numeric(10, 2) := 0;
  v_total_amount numeric(10, 2);

  v_requested_item_count integer;
  v_locked_item_count integer;
begin
  v_idempotency_key := nullif(trim(p_idempotency_key), '');
  v_buyer_email := lower(nullif(trim(p_buyer_email), ''));
  v_buyer_first_name := nullif(trim(p_buyer_first_name), '');
  v_buyer_last_name := nullif(trim(p_buyer_last_name), '');
  v_buyer_phone := nullif(trim(p_buyer_phone), '');
  v_business_name := nullif(trim(p_business_name), '');
  v_delivery_address_line1 := nullif(trim(p_delivery_address_line1), '');
  v_delivery_address_line2 := nullif(trim(p_delivery_address_line2), '');
  v_delivery_city := nullif(trim(p_delivery_city), '');
  v_delivery_state := nullif(trim(p_delivery_state), '');
  v_delivery_postal_code := nullif(trim(p_delivery_postal_code), '');
  v_delivery_country := coalesce(nullif(trim(p_delivery_country), ''), 'US');
  v_city := nullif(trim(p_city), '');
  v_state := nullif(trim(p_state), '');
  v_country := coalesce(nullif(trim(p_country), ''), v_delivery_country);
  v_buyer_notes := nullif(trim(p_buyer_notes), '');
  v_pickup_note := nullif(trim(p_pickup_note), '');
  v_buyer_user_agent := nullif(trim(p_buyer_user_agent), '');

  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if v_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;

  if length(v_idempotency_key) > 200 then
    raise exception 'Idempotency key must be 200 characters or fewer.';
  end if;

  if v_buyer_email is null then
    raise exception 'Buyer email is required.';
  end if;

  if v_buyer_first_name is null then
    raise exception 'Buyer first name is required.';
  end if;

  if v_buyer_last_name is null then
    raise exception 'Buyer last name is required.';
  end if;

  if v_buyer_phone is null then
    raise exception 'Buyer phone is required.';
  end if;

  if v_delivery_address_line1 is null then
    raise exception 'Buyer address line 1 is required.';
  end if;

  if v_delivery_city is null then
    raise exception 'Buyer city is required.';
  end if;

  if v_delivery_state is null then
    raise exception 'Buyer state is required.';
  end if;

  if v_delivery_postal_code is null then
    raise exception 'Buyer postal code is required.';
  end if;

  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one order item is required.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where jsonb_typeof(item) <> 'object'
       or not (item ? 'inventory_item_id')
       or not (item ? 'quantity')
       or item ->> 'inventory_item_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or item ->> 'quantity' !~ '^[0-9]+$'
       or (item ->> 'quantity')::integer <= 0
  ) then
    raise exception 'Each order item must include a valid inventory item ID and positive quantity.';
  end if;

  select stores.*
  into v_store
  from public.stores as stores
  where stores.id = p_store_id
    and stores.storefront_enabled = true
    and stores.store_status = 'live'
    and stores.storefront_mode in ('hosted', 'embedded')
    and stores.admin_hold_reason is null;

  if v_store.id is null then
    raise exception 'Store is not available for checkout.';
  end if;

  if p_pickup_option_id is not null then
    select pickup_options.*
    into v_pickup_option
    from public.store_pickup_options as pickup_options
    where pickup_options.id = p_pickup_option_id
      and pickup_options.store_id = p_store_id
      and pickup_options.is_active = true;

    if v_pickup_option.id is null then
      raise exception 'Pickup option is not available for this store.';
    end if;

    v_pickup_option_label_snapshot := v_pickup_option.label;
  end if;

  create temporary table pg_temp.requested_order_items (
    inventory_item_id uuid primary key,
    quantity integer not null check (quantity > 0)
  ) on commit drop;

  insert into pg_temp.requested_order_items (
    inventory_item_id,
    quantity
  )
  select
    (item ->> 'inventory_item_id')::uuid as inventory_item_id,
    sum((item ->> 'quantity')::integer) as quantity
  from jsonb_array_elements(p_items) as item
  group by (item ->> 'inventory_item_id')::uuid;

  if exists (
    select 1
    from pg_temp.requested_order_items as requested_order_items
    where requested_order_items.inventory_item_id is null
       or requested_order_items.quantity <= 0
  ) then
    raise exception 'Each order item must include a valid inventory item ID and positive quantity.';
  end if;

  select count(*)
  into v_requested_item_count
  from pg_temp.requested_order_items as requested_order_items;

  if v_requested_item_count = 0 then
    raise exception 'At least one valid order item is required.';
  end if;

  v_request_hash := encode(
    digest(
      (
        jsonb_build_object(
          'store_id', p_store_id,
          'buyer_email', v_buyer_email,
          'buyer_first_name', v_buyer_first_name,
          'buyer_last_name', v_buyer_last_name,
          'buyer_phone', v_buyer_phone,
          'business_name', v_business_name,
          'city', v_city,
          'state', v_state,
          'country', v_country,
          'delivery_address_line1', v_delivery_address_line1,
          'delivery_address_line2', v_delivery_address_line2,
          'delivery_city', v_delivery_city,
          'delivery_state', v_delivery_state,
          'delivery_postal_code', v_delivery_postal_code,
          'delivery_country', v_delivery_country,
          'buyer_notes', v_buyer_notes,
          'pickup_note', v_pickup_note,
          'items', (
            select jsonb_agg(
              jsonb_build_object(
                'inventory_item_id', requested_order_items.inventory_item_id,
                'quantity', requested_order_items.quantity
              )
              order by requested_order_items.inventory_item_id
            )
            from pg_temp.requested_order_items as requested_order_items
          )
        )
        || case
          when p_pickup_option_id is not null then jsonb_build_object(
            'pickup_option_id', p_pickup_option_id,
            'pickup_option_label_snapshot', v_pickup_option_label_snapshot
          )
          else '{}'::jsonb
        end
      )::text,
      'sha256'
    ),
    'hex'
  );

  insert into public.order_idempotency_keys (
    store_id,
    idempotency_key,
    request_hash
  )
  values (
    p_store_id,
    v_idempotency_key,
    v_request_hash
  )
  on conflict on constraint order_idempotency_keys_pkey do nothing;

  select idempotency_keys.*
  into v_existing_idempotency
  from public.order_idempotency_keys as idempotency_keys
  where idempotency_keys.store_id = p_store_id
    and idempotency_keys.idempotency_key = v_idempotency_key
  for update;

  if v_existing_idempotency.request_hash <> v_request_hash then
    raise exception 'Idempotency key was already used with a different request.';
  end if;

  if v_existing_idempotency.order_id is not null then
    return query
    select
      orders.id,
      orders.order_number,
      orders.store_id,
      orders.customer_id,
      orders.order_status,
      orders.payment_method,
      orders.payment_status,
      orders.subtotal_amount,
      orders.tax_fee_amount,
      orders.total_amount,
      orders.created_at
    from public.orders as orders
    where orders.id = v_existing_idempotency.order_id;

    return;
  end if;

  create temporary table pg_temp.locked_order_items (
    inventory_item_id uuid primary key,
    requested_quantity integer not null,
    store_id uuid not null,
    listing_batch_id uuid not null,
    listing_batch_breed_id uuid not null,
    seller_breed_profile_id uuid not null,
    species_id uuid not null,
    species_name text not null,
    species_slug text not null,
    breed_display_name text not null,
    breed_description text,
    inventory_type text not null,
    custom_inventory_label text,
    batch_type text not null,
    available_date date not null,
    age_at_availability_days integer,
    quantity_available integer not null,
    unit_price numeric(10, 2) not null,
    line_subtotal numeric(10, 2) not null
  ) on commit drop;

  insert into pg_temp.locked_order_items (
    inventory_item_id,
    requested_quantity,
    store_id,
    listing_batch_id,
    listing_batch_breed_id,
    seller_breed_profile_id,
    species_id,
    species_name,
    species_slug,
    breed_display_name,
    breed_description,
    inventory_type,
    custom_inventory_label,
    batch_type,
    available_date,
    age_at_availability_days,
    quantity_available,
    unit_price,
    line_subtotal
  )
  select
    inventory_items.id,
    requested_order_items.quantity,
    inventory_items.store_id,
    listing_batches.id,
    listing_batch_breeds.id,
    seller_breed_profiles.id,
    species.id,
    species.common_name,
    species.slug,
    seller_breed_profiles.display_name,
    seller_breed_profiles.seller_description,
    inventory_items.inventory_type,
    inventory_items.custom_inventory_label,
    listing_batches.batch_type,
    listing_batches.available_date,
    case
      when listing_batches.batch_type = 'live_animals'
        then listing_batches.age_at_availability_days
      else null
    end,
    inventory_items.quantity_available,
    public.calculate_inventory_unit_price(
      listing_batches.base_price,
      inventory_items.price_override,
      listing_batches.auto_price_increase_enabled,
      listing_batches.auto_price_increase_amount,
      listing_batches.auto_price_increase_max_price,
      listing_batches.available_date
    ),
    (
      public.calculate_inventory_unit_price(
        listing_batches.base_price,
        inventory_items.price_override,
        listing_batches.auto_price_increase_enabled,
        listing_batches.auto_price_increase_amount,
        listing_batches.auto_price_increase_max_price,
        listing_batches.available_date
      ) * requested_order_items.quantity
    )::numeric(10, 2)
  from (
    select requested_items.*
    from pg_temp.requested_order_items as requested_items
    order by requested_items.inventory_item_id
  ) as requested_order_items
  join public.inventory_items as inventory_items
    on inventory_items.id = requested_order_items.inventory_item_id
  join public.listing_batches as listing_batches
    on listing_batches.id = inventory_items.listing_batch_id
  join public.listing_batch_breeds as listing_batch_breeds
    on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
  join public.seller_breed_profiles as seller_breed_profiles
    on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
  join public.species as species
    on species.id = listing_batches.species_id
  where inventory_items.id in (
    select requested_order_items.inventory_item_id
    from pg_temp.requested_order_items as requested_order_items
    order by requested_order_items.inventory_item_id
  )
  for update of inventory_items;

  select count(*)
  into v_locked_item_count
  from pg_temp.locked_order_items as locked_order_items;

  if v_locked_item_count <> v_requested_item_count then
    raise exception 'One or more inventory items were not found.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items as locked_order_items
    where locked_order_items.store_id <> p_store_id
  ) then
    raise exception 'One or more inventory items do not belong to this store.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items as locked_order_items
    join public.inventory_items as inventory_items
      on inventory_items.id = locked_order_items.inventory_item_id
    join public.listing_batches as listing_batches
      on listing_batches.id = locked_order_items.listing_batch_id
    join public.listing_batch_breeds as listing_batch_breeds
      on listing_batch_breeds.id = locked_order_items.listing_batch_breed_id
    join public.seller_breed_profiles as seller_breed_profiles
      on seller_breed_profiles.id = locked_order_items.seller_breed_profile_id
    join public.species as species
      on species.id = locked_order_items.species_id
    where inventory_items.store_id <> p_store_id
       or listing_batches.store_id <> p_store_id
       or listing_batch_breeds.store_id <> p_store_id
       or seller_breed_profiles.store_id <> p_store_id
       or listing_batch_breeds.listing_batch_id <> listing_batches.id
       or inventory_items.listing_batch_id <> listing_batches.id
       or inventory_items.listing_batch_breed_id <> listing_batch_breeds.id
       or seller_breed_profiles.species_id <> listing_batches.species_id
       or species.id <> listing_batches.species_id
  ) then
    raise exception 'Invalid inventory relationship for checkout.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items as locked_order_items
    join public.inventory_items as inventory_items
      on inventory_items.id = locked_order_items.inventory_item_id
    join public.listing_batches as listing_batches
      on listing_batches.id = locked_order_items.listing_batch_id
    join public.listing_batch_breeds as listing_batch_breeds
      on listing_batch_breeds.id = locked_order_items.listing_batch_breed_id
    join public.seller_breed_profiles as seller_breed_profiles
      on seller_breed_profiles.id = locked_order_items.seller_breed_profile_id
    join public.species as species
      on species.id = locked_order_items.species_id
    where inventory_items.visibility_status <> 'active'
       or inventory_items.moderation_status <> 'normal'
       or listing_batches.visibility_status <> 'active'
       or listing_batches.moderation_status <> 'normal'
       or listing_batch_breeds.visibility_status <> 'active'
       or listing_batch_breeds.moderation_status <> 'normal'
       or seller_breed_profiles.visibility_status <> 'active'
       or seller_breed_profiles.moderation_status <> 'normal'
       or species.is_active <> true
  ) then
    raise exception 'One or more inventory items are not available for checkout.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items as locked_order_items
    where locked_order_items.quantity_available < locked_order_items.requested_quantity
  ) then
    raise exception 'Insufficient inventory quantity available.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items as locked_order_items
    where (
      locked_order_items.batch_type = 'hatching_eggs'
      and locked_order_items.inventory_type <> 'hatching_eggs'
    )
    or (
      locked_order_items.batch_type = 'live_animals'
      and locked_order_items.inventory_type = 'hatching_eggs'
    )
  ) then
    raise exception 'Invalid inventory type for listing batch type.';
  end if;

  select coalesce(sum(locked_order_items.line_subtotal), 0)::numeric(10, 2)
  into v_subtotal_amount
  from pg_temp.locked_order_items as locked_order_items;

  v_total_amount := v_subtotal_amount + v_tax_fee_amount;

  perform pg_advisory_xact_lock(
    hashtextextended(p_store_id::text || ':' || v_buyer_email, 0)
  );

  select customers.id
  into v_customer_id
  from public.customers as customers
  where customers.store_id = p_store_id
    and lower(trim(customers.email)) = v_buyer_email
  order by customers.created_at, customers.id
  limit 1;

  if v_customer_id is null then
    insert into public.customers as inserted_customer (
      store_id,
      email,
      first_name,
      last_name,
      phone,
      business_name,
      city,
      state,
      country,
      delivery_address_line1,
      delivery_address_line2,
      delivery_city,
      delivery_state,
      delivery_postal_code,
      delivery_country
    )
    values (
      p_store_id,
      v_buyer_email,
      v_buyer_first_name,
      v_buyer_last_name,
      v_buyer_phone,
      v_business_name,
      v_city,
      v_state,
      v_country,
      v_delivery_address_line1,
      v_delivery_address_line2,
      v_delivery_city,
      v_delivery_state,
      v_delivery_postal_code,
      v_delivery_country
    )
    returning inserted_customer.id into v_customer_id;
  else
    update public.customers as customers
    set
      first_name = v_buyer_first_name,
      last_name = v_buyer_last_name,
      phone = v_buyer_phone,
      business_name = v_business_name,
      city = v_city,
      state = v_state,
      country = v_country,
      delivery_address_line1 = v_delivery_address_line1,
      delivery_address_line2 = v_delivery_address_line2,
      delivery_city = v_delivery_city,
      delivery_state = v_delivery_state,
      delivery_postal_code = v_delivery_postal_code,
      delivery_country = v_delivery_country
    where customers.id = v_customer_id;
  end if;

  insert into public.order_number_counters as inserted_counter (
    store_id
  )
  values (
    p_store_id
  )
  on conflict on constraint order_number_counters_pkey do nothing;

  update public.order_number_counters as counters
  set last_order_number = counters.last_order_number + 1
  where counters.store_id = p_store_id
  returning counters.last_order_number into v_next_order_number;

  v_order_number := v_next_order_number::text;

  insert into public.orders as inserted_order (
    store_id,
    customer_id,
    order_number,
    order_source,
    order_status,
    payment_method,
    payment_status,
    buyer_email_snapshot,
    buyer_first_name_snapshot,
    buyer_last_name_snapshot,
    buyer_phone_snapshot,
    buyer_address_line1_snapshot,
    buyer_address_line2_snapshot,
    buyer_city_snapshot,
    buyer_state_snapshot,
    buyer_postal_code_snapshot,
    buyer_country_snapshot,
    buyer_notes,
    pickup_note,
    pickup_option_id,
    pickup_option_label_snapshot,
    subtotal_amount,
    tax_fee_label_snapshot,
    tax_fee_rate_snapshot,
    tax_fee_amount,
    total_amount,
    buyer_ip_address,
    buyer_user_agent
  )
  values (
    p_store_id,
    v_customer_id,
    v_order_number,
    'storefront',
    'open',
    'pay_at_pickup',
    'pay_at_pickup',
    v_buyer_email,
    v_buyer_first_name,
    v_buyer_last_name,
    v_buyer_phone,
    v_delivery_address_line1,
    v_delivery_address_line2,
    v_delivery_city,
    v_delivery_state,
    v_delivery_postal_code,
    v_delivery_country,
    v_buyer_notes,
    v_pickup_note,
    v_pickup_option.id,
    v_pickup_option_label_snapshot,
    v_subtotal_amount,
    null,
    null,
    v_tax_fee_amount,
    v_total_amount,
    p_buyer_ip_address,
    v_buyer_user_agent
  )
  returning inserted_order.id, inserted_order.created_at into v_order_id, v_order_created_at;

  insert into public.order_items (
    order_id,
    store_id,
    inventory_item_id,
    listing_batch_id,
    listing_batch_breed_id,
    seller_breed_profile_id,
    species_id,
    species_name_snapshot,
    species_slug_snapshot,
    breed_display_name_snapshot,
    breed_description_snapshot,
    inventory_type_snapshot,
    custom_inventory_label_snapshot,
    batch_type_snapshot,
    available_date_snapshot,
    age_at_availability_days_snapshot,
    unit_price_snapshot,
    quantity,
    line_subtotal
  )
  select
    v_order_id,
    p_store_id,
    locked_order_items.inventory_item_id,
    locked_order_items.listing_batch_id,
    locked_order_items.listing_batch_breed_id,
    locked_order_items.seller_breed_profile_id,
    locked_order_items.species_id,
    locked_order_items.species_name,
    locked_order_items.species_slug,
    locked_order_items.breed_display_name,
    locked_order_items.breed_description,
    locked_order_items.inventory_type,
    locked_order_items.custom_inventory_label,
    locked_order_items.batch_type,
    locked_order_items.available_date,
    locked_order_items.age_at_availability_days,
    locked_order_items.unit_price,
    locked_order_items.requested_quantity,
    locked_order_items.line_subtotal
  from pg_temp.locked_order_items as locked_order_items
  order by locked_order_items.inventory_item_id;

  update public.inventory_items as inventory_items
  set quantity_available = inventory_items.quantity_available - locked_order_items.requested_quantity
  from pg_temp.locked_order_items as locked_order_items
  where inventory_items.id = locked_order_items.inventory_item_id;

  update public.order_idempotency_keys as idempotency_keys
  set order_id = v_order_id
  where idempotency_keys.store_id = p_store_id
    and idempotency_keys.idempotency_key = v_idempotency_key;

  perform public.enqueue_email_notification(
    p_store_id,
    v_order_id,
    'buyer_order_received',
    'buyer',
    v_buyer_email,
    'Order received: ' || v_order_number,
    jsonb_build_object(
      'order_id', v_order_id,
      'order_number', v_order_number,
      'store_id', p_store_id,
      'store_name', v_store.store_name,
      'store_slug', v_store.store_slug,
      'buyer_first_name', v_buyer_first_name,
      'buyer_last_name', v_buyer_last_name,
      'buyer_email', v_buyer_email,
      'order_status', 'open',
      'payment_status', 'pay_at_pickup',
      'total_amount', v_total_amount,
      'created_at', v_order_created_at,
      'pickup_note', v_pickup_note,
      'pickup_option_label', v_pickup_option_label_snapshot,
      'buyer_notes', v_buyer_notes
    )
  );

  perform public.enqueue_email_notification(
    p_store_id,
    v_order_id,
    'seller_new_order_received',
    'seller',
    v_store.order_notification_email,
    'New FlipFlocks order: ' || v_order_number,
    jsonb_build_object(
      'order_id', v_order_id,
      'order_number', v_order_number,
      'store_id', p_store_id,
      'store_name', v_store.store_name,
      'store_slug', v_store.store_slug,
      'buyer_first_name', v_buyer_first_name,
      'buyer_last_name', v_buyer_last_name,
      'buyer_email', v_buyer_email,
      'buyer_phone', v_buyer_phone,
      'order_status', 'open',
      'payment_status', 'pay_at_pickup',
      'total_amount', v_total_amount,
      'created_at', v_order_created_at,
      'pickup_option_label', v_pickup_option_label_snapshot,
      'item_count', v_requested_item_count
    )
  );

  return query
  select
    orders.id,
    orders.order_number,
    orders.store_id,
    orders.customer_id,
    orders.order_status,
    orders.payment_method,
    orders.payment_status,
    orders.subtotal_amount,
    orders.tax_fee_amount,
    orders.total_amount,
    orders.created_at
  from public.orders as orders
  where orders.id = v_order_id;
end;
$$;
