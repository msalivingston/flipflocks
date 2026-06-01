-- Group 66C follow-up: full manual order RPC ambiguity audit
--
-- Replace seller_create_manual_order with qualified RETURNING, aggregate,
-- filter, loop, and conflict expressions so PL/pgSQL output columns such
-- as created_at, store_id, and order_id cannot conflict with table columns.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.seller_create_manual_order(
  p_store_id uuid,
  p_idempotency_key text,
  p_items jsonb,
  p_customer_id uuid default null,
  p_customer_email text default null,
  p_customer_first_name text default null,
  p_customer_last_name text default null,
  p_customer_phone text default null,
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
  p_order_source text default 'manual',
  p_payment_status text default 'pay_at_pickup',
  p_buyer_notes text default null,
  p_pickup_note text default null,
  p_tax_fee_label text default null,
  p_tax_fee_rate numeric default null,
  p_tax_fee_amount numeric default 0,
  p_send_buyer_notification boolean default false,
  p_send_seller_notification boolean default false
)
returns table (
  order_id uuid,
  order_number text,
  store_id uuid,
  customer_id uuid,
  order_status text,
  payment_method text,
  payment_status text,
  order_source text,
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
  v_order_source text;
  v_payment_status text;
  v_customer_email text;
  v_customer_first_name text;
  v_customer_last_name text;
  v_customer_phone text;
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
  v_tax_fee_label text;
  v_tax_fee_rate numeric(7, 4);
  v_tax_fee_amount numeric(10, 2);

  v_request_hash text;
  v_existing_idempotency public.order_idempotency_keys%rowtype;
  v_store public.stores%rowtype;
  v_customer public.customers%rowtype;

  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_order_created_at timestamptz;
  v_next_order_number integer;
  v_inventory_subtotal_amount numeric(10, 2);
  v_custom_subtotal_amount numeric(10, 2);
  v_subtotal_amount numeric(10, 2);
  v_total_amount numeric(10, 2);

  v_requested_item_count integer;
  v_requested_inventory_item_count integer;
  v_locked_item_count integer;
  item_record record;
begin
  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Store is not available.';
  end if;

  select stores.*
  into v_store
  from public.stores as stores
  where stores.id = p_store_id;

  if v_store.id is null then
    raise exception 'Store is not available.';
  end if;

  v_idempotency_key := nullif(trim(p_idempotency_key), '');
  v_order_source := coalesce(nullif(trim(p_order_source), ''), 'manual');
  v_payment_status := coalesce(nullif(trim(p_payment_status), ''), 'pay_at_pickup');
  v_customer_email := lower(nullif(trim(p_customer_email), ''));
  v_customer_first_name := nullif(trim(p_customer_first_name), '');
  v_customer_last_name := nullif(trim(p_customer_last_name), '');
  v_customer_phone := nullif(trim(p_customer_phone), '');
  v_business_name := nullif(trim(p_business_name), '');
  v_city := nullif(trim(p_city), '');
  v_state := nullif(trim(p_state), '');
  v_country := nullif(trim(p_country), '');
  v_delivery_address_line1 := nullif(trim(p_delivery_address_line1), '');
  v_delivery_address_line2 := nullif(trim(p_delivery_address_line2), '');
  v_delivery_city := nullif(trim(p_delivery_city), '');
  v_delivery_state := nullif(trim(p_delivery_state), '');
  v_delivery_postal_code := nullif(trim(p_delivery_postal_code), '');
  v_delivery_country := nullif(trim(p_delivery_country), '');
  v_buyer_notes := nullif(trim(p_buyer_notes), '');
  v_pickup_note := nullif(trim(p_pickup_note), '');
  v_tax_fee_label := nullif(trim(p_tax_fee_label), '');
  v_tax_fee_rate := p_tax_fee_rate::numeric(7, 4);
  v_tax_fee_amount := coalesce(p_tax_fee_amount, 0)::numeric(10, 2);

  if v_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;

  if length(v_idempotency_key) > 200 then
    raise exception 'Idempotency key must be 200 characters or fewer.';
  end if;

  if v_order_source not in (
    'seller_created',
    'manual',
    'phone',
    'text',
    'market',
    'event'
  ) then
    raise exception 'Manual order source is not supported.';
  end if;

  if v_payment_status not in ('unpaid', 'pay_at_pickup', 'paid') then
    raise exception 'Manual order payment status is not supported.';
  end if;

  if v_tax_fee_amount < 0 then
    raise exception 'Tax or fee amount cannot be negative.';
  end if;

  if v_tax_fee_rate is not null and v_tax_fee_rate < 0 then
    raise exception 'Tax or fee rate cannot be negative.';
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
       or coalesce(nullif(item ->> 'item_type', ''), 'inventory') not in ('inventory', 'custom')
       or not (item ? 'quantity')
       or item ->> 'quantity' !~ '^[0-9]+$'
       or (item ->> 'quantity')::integer <= 0
       or (
         item ? 'unit_price'
         and item ->> 'unit_price' !~ '^[0-9]+(\.[0-9]{1,2})?$'
       )
       or (
         coalesce(nullif(item ->> 'item_type', ''), 'inventory') = 'inventory'
         and (
           not (item ? 'inventory_item_id')
           or item ->> 'inventory_item_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           or (
             item ? 'allow_inventory_override'
             and jsonb_typeof(item -> 'allow_inventory_override') <> 'boolean'
           )
         )
       )
       or (
         coalesce(nullif(item ->> 'item_type', ''), 'inventory') = 'custom'
         and (
           nullif(trim(item ->> 'custom_item_name'), '') is null
           or not (item ? 'unit_price')
         )
       )
  ) then
    raise exception 'Each manual order item must include a valid type, quantity, price, and item details.';
  end if;

  drop table if exists pg_temp.requested_manual_order_items;
  drop table if exists pg_temp.locked_manual_order_items;

  create temporary table pg_temp.requested_manual_order_items (
    line_number integer primary key,
    item_type text not null check (item_type in ('inventory', 'custom')),
    inventory_item_id uuid,
    custom_item_name text,
    quantity integer not null check (quantity > 0),
    unit_price_override numeric(10, 2),
    allow_inventory_override boolean not null default false
  ) on commit drop;

  insert into pg_temp.requested_manual_order_items (
    line_number,
    item_type,
    inventory_item_id,
    custom_item_name,
    quantity,
    unit_price_override,
    allow_inventory_override
  )
  select
    item_with_ordinality.line_number::integer,
    coalesce(nullif(item_with_ordinality.item ->> 'item_type', ''), 'inventory'),
    case
      when coalesce(nullif(item_with_ordinality.item ->> 'item_type', ''), 'inventory') = 'inventory'
        then (item_with_ordinality.item ->> 'inventory_item_id')::uuid
      else null
    end,
    case
      when coalesce(nullif(item_with_ordinality.item ->> 'item_type', ''), 'inventory') = 'custom'
        then nullif(trim(item_with_ordinality.item ->> 'custom_item_name'), '')
      else null
    end,
    (item_with_ordinality.item ->> 'quantity')::integer,
    case
      when item_with_ordinality.item ? 'unit_price'
        then (item_with_ordinality.item ->> 'unit_price')::numeric(10, 2)
      else null
    end,
    coalesce((item_with_ordinality.item ->> 'allow_inventory_override')::boolean, false)
  from jsonb_array_elements(p_items) with ordinality as item_with_ordinality(item, line_number);

  if exists (
    select 1
    from (
      select
        requested_manual_order_items.inventory_item_id,
        count(*) as item_count
      from pg_temp.requested_manual_order_items as requested_manual_order_items
      where requested_manual_order_items.item_type = 'inventory'
      group by requested_manual_order_items.inventory_item_id
    ) as duplicated_items
    where duplicated_items.item_count > 1
  ) then
    raise exception 'Duplicate inventory items are not supported in a manual order request.';
  end if;

  select count(*)
  into v_requested_item_count
  from pg_temp.requested_manual_order_items as requested_manual_order_items;

  select count(*)
  into v_requested_inventory_item_count
  from pg_temp.requested_manual_order_items as requested_manual_order_items
  where requested_manual_order_items.item_type = 'inventory';

  if v_requested_item_count = 0 then
    raise exception 'At least one valid order item is required.';
  end if;

  v_request_hash := encode(
    extensions.digest(
      jsonb_build_object(
        'operation', 'seller_create_manual_order',
        'store_id', p_store_id,
        'customer_id', p_customer_id,
        'customer_email', v_customer_email,
        'customer_first_name', v_customer_first_name,
        'customer_last_name', v_customer_last_name,
        'customer_phone', v_customer_phone,
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
        'order_source', v_order_source,
        'payment_status', v_payment_status,
        'buyer_notes', v_buyer_notes,
        'pickup_note', v_pickup_note,
        'tax_fee_label', v_tax_fee_label,
        'tax_fee_rate', v_tax_fee_rate,
        'tax_fee_amount', v_tax_fee_amount,
        'send_buyer_notification', p_send_buyer_notification,
        'send_seller_notification', p_send_seller_notification,
        'items', (
          select jsonb_agg(
            jsonb_build_object(
              'line_number', requested_manual_order_items.line_number,
              'item_type', requested_manual_order_items.item_type,
              'inventory_item_id', requested_manual_order_items.inventory_item_id,
              'custom_item_name', requested_manual_order_items.custom_item_name,
              'quantity', requested_manual_order_items.quantity,
              'unit_price_override', requested_manual_order_items.unit_price_override,
              'allow_inventory_override', requested_manual_order_items.allow_inventory_override
            )
            order by requested_manual_order_items.line_number
          )
          from pg_temp.requested_manual_order_items as requested_manual_order_items
        )
      )::text,
      'sha256'::text
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

  select order_idempotency_keys.*
  into v_existing_idempotency
  from public.order_idempotency_keys as order_idempotency_keys
  where order_idempotency_keys.store_id = p_store_id
    and order_idempotency_keys.idempotency_key = v_idempotency_key
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
      orders.order_source,
      orders.subtotal_amount,
      orders.tax_fee_amount,
      orders.total_amount,
      orders.created_at
    from public.orders as orders
    where orders.id = v_existing_idempotency.order_id
      and orders.store_id = p_store_id;

    return;
  end if;

  create temporary table pg_temp.locked_manual_order_items (
    line_number integer primary key,
    inventory_item_id uuid not null,
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
    deduct_quantity integer not null,
    override_quantity integer not null,
    allow_inventory_override boolean not null,
    unit_price numeric(10, 2) not null,
    line_subtotal numeric(10, 2) not null
  ) on commit drop;

  insert into pg_temp.locked_manual_order_items (
    line_number,
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
    deduct_quantity,
    override_quantity,
    allow_inventory_override,
    unit_price,
    line_subtotal
  )
  select
    requested_manual_order_items.line_number,
    inventory_items.id,
    requested_manual_order_items.quantity,
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
    least(inventory_items.quantity_available, requested_manual_order_items.quantity),
    greatest(requested_manual_order_items.quantity - inventory_items.quantity_available, 0),
    requested_manual_order_items.allow_inventory_override,
    coalesce(
      requested_manual_order_items.unit_price_override,
      public.calculate_inventory_unit_price(
        listing_batches.base_price,
        inventory_items.price_override,
        listing_batches.auto_price_adjustment_enabled,
        listing_batches.price_adjustment_direction,
        listing_batches.price_adjustment_amount,
        listing_batches.price_adjustment_interval_weeks,
        listing_batches.price_adjustment_max_price,
        listing_batches.price_adjustment_min_price,
        listing_batches.available_date
      )
    ),
    (
      coalesce(
        requested_manual_order_items.unit_price_override,
        public.calculate_inventory_unit_price(
          listing_batches.base_price,
          inventory_items.price_override,
          listing_batches.auto_price_adjustment_enabled,
          listing_batches.price_adjustment_direction,
          listing_batches.price_adjustment_amount,
          listing_batches.price_adjustment_interval_weeks,
          listing_batches.price_adjustment_max_price,
          listing_batches.price_adjustment_min_price,
          listing_batches.available_date
        )
      ) * requested_manual_order_items.quantity
    )::numeric(10, 2)
  from (
    select requested_manual_order_items.*
    from pg_temp.requested_manual_order_items as requested_manual_order_items
    where requested_manual_order_items.item_type = 'inventory'
    order by requested_manual_order_items.inventory_item_id
  ) as requested_manual_order_items
  join public.inventory_items as inventory_items
    on inventory_items.id = requested_manual_order_items.inventory_item_id
   and inventory_items.store_id = p_store_id
  join public.listing_batches as listing_batches
    on listing_batches.id = inventory_items.listing_batch_id
   and listing_batches.store_id = p_store_id
  join public.listing_batch_breeds as listing_batch_breeds
    on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
   and listing_batch_breeds.store_id = p_store_id
  join public.seller_breed_profiles as seller_breed_profiles
    on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
   and seller_breed_profiles.store_id = p_store_id
  join public.species as species
    on species.id = listing_batches.species_id
  for update of inventory_items;

  select count(*)
  into v_locked_item_count
  from pg_temp.locked_manual_order_items as locked_manual_order_items;

  if v_locked_item_count <> v_requested_inventory_item_count then
    raise exception 'One or more inventory items are not available for this store.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_manual_order_items as locked_manual_order_items
    join public.inventory_items as inventory_items
      on inventory_items.id = locked_manual_order_items.inventory_item_id
    join public.listing_batches as listing_batches
      on listing_batches.id = locked_manual_order_items.listing_batch_id
    join public.listing_batch_breeds as listing_batch_breeds
      on listing_batch_breeds.id = locked_manual_order_items.listing_batch_breed_id
    join public.seller_breed_profiles as seller_breed_profiles
      on seller_breed_profiles.id = locked_manual_order_items.seller_breed_profile_id
    where inventory_items.store_id <> p_store_id
       or listing_batches.store_id <> p_store_id
       or listing_batch_breeds.store_id <> p_store_id
       or seller_breed_profiles.store_id <> p_store_id
       or listing_batch_breeds.listing_batch_id <> listing_batches.id
       or inventory_items.listing_batch_id <> listing_batches.id
       or inventory_items.listing_batch_breed_id <> listing_batch_breeds.id
       or seller_breed_profiles.species_id <> listing_batches.species_id
  ) then
    raise exception 'Invalid inventory relationship for this store.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_manual_order_items as locked_manual_order_items
    join public.inventory_items as inventory_items
      on inventory_items.id = locked_manual_order_items.inventory_item_id
    join public.listing_batches as listing_batches
      on listing_batches.id = locked_manual_order_items.listing_batch_id
    join public.listing_batch_breeds as listing_batch_breeds
      on listing_batch_breeds.id = locked_manual_order_items.listing_batch_breed_id
    join public.seller_breed_profiles as seller_breed_profiles
      on seller_breed_profiles.id = locked_manual_order_items.seller_breed_profile_id
    where inventory_items.visibility_status = 'archived'
       or inventory_items.moderation_status <> 'normal'
       or listing_batches.visibility_status = 'archived'
       or listing_batches.moderation_status <> 'normal'
       or listing_batch_breeds.visibility_status = 'archived'
       or listing_batch_breeds.moderation_status <> 'normal'
       or seller_breed_profiles.visibility_status = 'archived'
       or seller_breed_profiles.moderation_status <> 'normal'
  ) then
    raise exception 'One or more inventory items are not available for manual orders.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_manual_order_items as locked_manual_order_items
    where locked_manual_order_items.override_quantity > 0
      and locked_manual_order_items.allow_inventory_override <> true
  ) then
    raise exception 'Inventory override must be explicitly allowed when manual order quantity exceeds available inventory.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_manual_order_items as locked_manual_order_items
    where (
      locked_manual_order_items.batch_type = 'hatching_eggs'
      and locked_manual_order_items.inventory_type <> 'hatching_eggs'
    )
    or (
      locked_manual_order_items.batch_type = 'live_animals'
      and locked_manual_order_items.inventory_type = 'hatching_eggs'
    )
  ) then
    raise exception 'Invalid inventory type for listing batch type.';
  end if;

  select coalesce(sum(locked_manual_order_items.line_subtotal), 0)::numeric(10, 2)
  into v_inventory_subtotal_amount
  from pg_temp.locked_manual_order_items as locked_manual_order_items;

  select coalesce(
    sum((requested_manual_order_items.unit_price_override * requested_manual_order_items.quantity)::numeric(10, 2)),
    0
  )::numeric(10, 2)
  into v_custom_subtotal_amount
  from pg_temp.requested_manual_order_items as requested_manual_order_items
  where requested_manual_order_items.item_type = 'custom';

  v_subtotal_amount := (v_inventory_subtotal_amount + v_custom_subtotal_amount)::numeric(10, 2);
  v_total_amount := (v_subtotal_amount + v_tax_fee_amount)::numeric(10, 2);

  if p_customer_id is not null then
    select customers.*
    into v_customer
    from public.customers as customers
    where customers.id = p_customer_id
      and customers.store_id = p_store_id
    for update;

    if v_customer.id is null then
      raise exception 'Customer is not available for this store.';
    end if;

    v_customer_email := coalesce(v_customer_email, lower(trim(v_customer.email)));
    v_customer_first_name := coalesce(v_customer_first_name, v_customer.first_name);
    v_customer_last_name := coalesce(v_customer_last_name, v_customer.last_name);
    v_customer_phone := coalesce(v_customer_phone, v_customer.phone);
    v_business_name := coalesce(v_business_name, v_customer.business_name);
    v_city := coalesce(v_city, v_customer.city);
    v_state := coalesce(v_state, v_customer.state);
    v_country := coalesce(v_country, v_customer.country);
    v_delivery_address_line1 := coalesce(v_delivery_address_line1, v_customer.delivery_address_line1);
    v_delivery_address_line2 := coalesce(v_delivery_address_line2, v_customer.delivery_address_line2);
    v_delivery_city := coalesce(v_delivery_city, v_customer.delivery_city);
    v_delivery_state := coalesce(v_delivery_state, v_customer.delivery_state);
    v_delivery_postal_code := coalesce(v_delivery_postal_code, v_customer.delivery_postal_code);
    v_delivery_country := coalesce(v_delivery_country, v_customer.delivery_country);
  end if;

  if v_customer_email is null then
    raise exception 'Customer email is required.';
  end if;

  if v_customer_first_name is null then
    raise exception 'Customer first name is required.';
  end if;

  if v_customer_last_name is null then
    raise exception 'Customer last name is required.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_store_id::text || ':' || v_customer_email, 0)
  );

  if p_customer_id is null then
    select customers.*
    into v_customer
    from public.customers as customers
    where customers.store_id = p_store_id
      and lower(trim(customers.email)) = v_customer_email
    order by customers.created_at, customers.id
    limit 1
    for update;
  end if;

  if v_customer.id is null then
    insert into public.customers as customers (
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
      v_customer_email,
      v_customer_first_name,
      v_customer_last_name,
      v_customer_phone,
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
    returning customers.id into v_customer_id;
  else
    update public.customers as customers
    set
      email = v_customer_email,
      first_name = v_customer_first_name,
      last_name = v_customer_last_name,
      phone = v_customer_phone,
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
    where customers.id = v_customer.id
      and customers.store_id = p_store_id
    returning customers.id into v_customer_id;
  end if;

  insert into public.order_number_counters (
    store_id
  )
  values (
    p_store_id
  )
  on conflict on constraint order_number_counters_pkey do nothing;

  update public.order_number_counters as order_number_counters
  set last_order_number = order_number_counters.last_order_number + 1
  where order_number_counters.store_id = p_store_id
  returning order_number_counters.last_order_number into v_next_order_number;

  v_order_number := v_next_order_number::text;

  insert into public.orders as orders (
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
    subtotal_amount,
    tax_fee_label_snapshot,
    tax_fee_rate_snapshot,
    tax_fee_amount,
    total_amount
  )
  values (
    p_store_id,
    v_customer_id,
    v_order_number,
    v_order_source,
    'open',
    'pay_at_pickup',
    v_payment_status,
    v_customer_email,
    v_customer_first_name,
    v_customer_last_name,
    v_customer_phone,
    v_delivery_address_line1,
    v_delivery_address_line2,
    v_delivery_city,
    v_delivery_state,
    v_delivery_postal_code,
    v_delivery_country,
    v_buyer_notes,
    v_pickup_note,
    v_subtotal_amount,
    v_tax_fee_label,
    v_tax_fee_rate,
    v_tax_fee_amount,
    v_total_amount
  )
  returning orders.id, orders.created_at into v_order_id, v_order_created_at;

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
    line_subtotal,
    order_item_source
  )
  select
    v_order_id,
    p_store_id,
    locked_manual_order_items.inventory_item_id,
    locked_manual_order_items.listing_batch_id,
    locked_manual_order_items.listing_batch_breed_id,
    locked_manual_order_items.seller_breed_profile_id,
    locked_manual_order_items.species_id,
    locked_manual_order_items.species_name,
    locked_manual_order_items.species_slug,
    locked_manual_order_items.breed_display_name,
    locked_manual_order_items.breed_description,
    locked_manual_order_items.inventory_type,
    locked_manual_order_items.custom_inventory_label,
    locked_manual_order_items.batch_type,
    locked_manual_order_items.available_date,
    locked_manual_order_items.age_at_availability_days,
    locked_manual_order_items.unit_price,
    locked_manual_order_items.requested_quantity,
    locked_manual_order_items.line_subtotal,
    'inventory'
  from pg_temp.locked_manual_order_items as locked_manual_order_items
  order by locked_manual_order_items.line_number;

  insert into public.order_items (
    order_id,
    store_id,
    species_name_snapshot,
    species_slug_snapshot,
    breed_display_name_snapshot,
    inventory_type_snapshot,
    custom_inventory_label_snapshot,
    batch_type_snapshot,
    unit_price_snapshot,
    quantity,
    line_subtotal,
    order_item_source,
    custom_item_name_snapshot
  )
  select
    v_order_id,
    p_store_id,
    'Custom item',
    'custom',
    requested_manual_order_items.custom_item_name,
    'other',
    'Custom',
    'custom',
    requested_manual_order_items.unit_price_override,
    requested_manual_order_items.quantity,
    (requested_manual_order_items.unit_price_override * requested_manual_order_items.quantity)::numeric(10, 2),
    'custom',
    requested_manual_order_items.custom_item_name
  from pg_temp.requested_manual_order_items as requested_manual_order_items
  where requested_manual_order_items.item_type = 'custom'
  order by requested_manual_order_items.line_number;

  update public.inventory_items as inventory_items
  set quantity_available = greatest(
    inventory_items.quantity_available - locked_manual_order_items.requested_quantity,
    0
  )
  from pg_temp.locked_manual_order_items as locked_manual_order_items
  where inventory_items.id = locked_manual_order_items.inventory_item_id
    and inventory_items.store_id = p_store_id;

  for item_record in
    select locked_manual_order_items.*
    from pg_temp.locked_manual_order_items as locked_manual_order_items
    order by locked_manual_order_items.line_number
  loop
    perform public.log_inventory_activity_event(
      p_store_id,
      item_record.listing_batch_id,
      item_record.listing_batch_breed_id,
      item_record.inventory_item_id,
      'inventory_quantity_adjusted',
      item_record.quantity_available,
      greatest(item_record.quantity_available - item_record.requested_quantity, 0),
      null,
      null,
      'Manual order inventory deduction',
      jsonb_build_object(
        'order_id', v_order_id,
        'order_number', v_order_number,
        'order_source', v_order_source,
        'requested_quantity', item_record.requested_quantity,
        'deducted_quantity', item_record.deduct_quantity,
        'override_quantity', item_record.override_quantity,
        'override_applied', item_record.override_quantity > 0,
        'allow_inventory_override', item_record.allow_inventory_override,
        'unit_price_snapshot', item_record.unit_price,
        'line_subtotal', item_record.line_subtotal
      )
    );
  end loop;

  update public.order_idempotency_keys as order_idempotency_keys
  set order_id = v_order_id
  where order_idempotency_keys.store_id = p_store_id
    and order_idempotency_keys.idempotency_key = v_idempotency_key;

  if p_send_buyer_notification then
    perform public.enqueue_email_notification(
      p_store_id,
      v_order_id,
      'buyer_order_received',
      'buyer',
      v_customer_email,
      'Order received: ' || v_order_number,
      jsonb_build_object(
        'order_id', v_order_id,
        'order_number', v_order_number,
        'store_id', p_store_id,
        'store_name', v_store.store_name,
        'store_slug', v_store.store_slug,
        'buyer_first_name', v_customer_first_name,
        'buyer_last_name', v_customer_last_name,
        'buyer_email', v_customer_email,
        'order_status', 'open',
        'payment_status', v_payment_status,
        'total_amount', v_total_amount,
        'created_at', v_order_created_at,
        'pickup_note', v_pickup_note,
        'buyer_notes', v_buyer_notes,
        'order_source', v_order_source
      )
    );
  end if;

  if p_send_seller_notification then
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
        'buyer_first_name', v_customer_first_name,
        'buyer_last_name', v_customer_last_name,
        'buyer_email', v_customer_email,
        'buyer_phone', v_customer_phone,
        'order_status', 'open',
        'payment_status', v_payment_status,
        'total_amount', v_total_amount,
        'created_at', v_order_created_at,
        'item_count', v_requested_item_count,
        'order_source', v_order_source
      )
    );
  end if;

  return query
  select
    orders.id,
    orders.order_number,
    orders.store_id,
    orders.customer_id,
    orders.order_status,
    orders.payment_method,
    orders.payment_status,
    orders.order_source,
    orders.subtotal_amount,
    orders.tax_fee_amount,
    orders.total_amount,
    orders.created_at
  from public.orders as orders
  where orders.id = v_order_id
    and orders.store_id = p_store_id;
end;
$$;

comment on function public.seller_create_manual_order(
  uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, boolean, boolean
) is
'Trusted seller/admin RPC for atomically creating manual/offline orders. Supports inventory-backed items, explicit over-available quantity overrides that floor inventory at zero, custom non-inventory items, order-item price snapshots, idempotency, and optional existing transactional email notifications.';

revoke all on function public.seller_create_manual_order(
  uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, boolean, boolean
) from public;

grant execute on function public.seller_create_manual_order(
  uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, boolean, boolean
) to authenticated;
