-- Add standalone Hatching Eggs to the v2 public order creation path.
--
-- This replaces only create_pay_at_pickup_order_v2 and preserves the existing
-- listing, equipment, and processed-poultry behavior.

begin;

create or replace function public.create_pay_at_pickup_order_v2(
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
  p_pickup_option_id uuid default null,
  p_fulfillment_method text default 'pickup',
  p_delivery_option_id uuid default null
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
  v_idempotency_key text := nullif(trim(p_idempotency_key), '');
  v_buyer_email text := lower(nullif(trim(p_buyer_email), ''));
  v_buyer_first_name text := nullif(trim(p_buyer_first_name), '');
  v_buyer_last_name text := nullif(trim(p_buyer_last_name), '');
  v_buyer_phone text := nullif(trim(p_buyer_phone), '');
  v_delivery_address_line1 text := nullif(trim(p_delivery_address_line1), '');
  v_delivery_address_line2 text := nullif(trim(p_delivery_address_line2), '');
  v_delivery_city text := nullif(trim(p_delivery_city), '');
  v_delivery_state text := nullif(trim(p_delivery_state), '');
  v_delivery_postal_code text := nullif(trim(p_delivery_postal_code), '');
  v_delivery_country text := coalesce(nullif(trim(p_delivery_country), ''), 'US');
  v_business_name text := nullif(trim(p_business_name), '');
  v_city text := nullif(trim(p_city), '');
  v_state text := nullif(trim(p_state), '');
  v_country text := coalesce(nullif(trim(p_country), ''), coalesce(nullif(trim(p_delivery_country), ''), 'US'));
  v_buyer_notes text := nullif(trim(p_buyer_notes), '');
  v_pickup_note text := nullif(trim(p_pickup_note), '');
  v_buyer_user_agent text := nullif(trim(p_buyer_user_agent), '');
  v_fulfillment_method text := coalesce(nullif(trim(p_fulfillment_method), ''), 'pickup');
  v_pickup_option public.store_pickup_options%rowtype;
  v_delivery_option public.store_delivery_options%rowtype;
  v_pickup_option_label_snapshot text;
  v_delivery_option_name_snapshot text;
  v_delivery_fee_amount numeric(10, 2) := 0;
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
  if p_store_id is null then raise exception 'Store is required.'; end if;
  if v_idempotency_key is null then raise exception 'Idempotency key is required.'; end if;
  if length(v_idempotency_key) > 200 then raise exception 'Idempotency key must be 200 characters or fewer.'; end if;
  if v_buyer_email is null then raise exception 'Buyer email is required.'; end if;
  if v_buyer_first_name is null then raise exception 'Buyer first name is required.'; end if;
  if v_buyer_last_name is null then raise exception 'Buyer last name is required.'; end if;
  if v_buyer_phone is null then raise exception 'Buyer phone is required.'; end if;
  if v_delivery_address_line1 is null then raise exception 'Buyer address line 1 is required.'; end if;
  if v_delivery_city is null then raise exception 'Buyer city is required.'; end if;
  if v_delivery_state is null then raise exception 'Buyer state is required.'; end if;
  if v_delivery_postal_code is null then raise exception 'Buyer postal code is required.'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one order item is required.';
  end if;

  select s.*
  into v_store
  from public.stores as s
  where s.id = p_store_id
    and s.storefront_enabled = true
    and s.store_status = 'live'
    and s.storefront_mode in ('hosted', 'embedded')
    and s.admin_hold_reason is null;

  if v_store.id is null then
    raise exception 'Store is not available for checkout.';
  end if;

  if v_fulfillment_method not in ('pickup', 'delivery') then
    raise exception 'Fulfillment method must be pickup or delivery.';
  end if;

  if v_fulfillment_method = 'pickup' and p_delivery_option_id is not null then
    raise exception 'Delivery option must be blank for pickup orders.';
  end if;

  if v_fulfillment_method = 'delivery' then
    if p_pickup_option_id is not null then
      raise exception 'Pickup option must be blank for delivery orders.';
    end if;

    if p_delivery_option_id is null then
      raise exception 'Delivery option is required for delivery orders.';
    end if;

    if coalesce(v_store.delivery_enabled, false) = false then
      raise exception 'Store does not offer delivery.';
    end if;

    select sdo.*
    into v_delivery_option
    from public.store_delivery_options as sdo
    where sdo.id = p_delivery_option_id
      and sdo.store_id = p_store_id
      and sdo.is_active = true;

    if v_delivery_option.id is null then
      raise exception 'Delivery option is not available for this store.';
    end if;

    v_delivery_option_name_snapshot := v_delivery_option.name;
    v_delivery_fee_amount := v_delivery_option.price_amount;
  end if;

  if p_pickup_option_id is not null then
    select spo.*
    into v_pickup_option
    from public.store_pickup_options as spo
    where spo.id = p_pickup_option_id
      and spo.store_id = p_store_id
      and spo.is_active = true;

    if v_pickup_option.id is null then
      raise exception 'Pickup option is not available for this store.';
    end if;

    v_pickup_option_label_snapshot := v_pickup_option.label;
  end if;

  create temporary table pg_temp.requested_order_items (
    item_type text not null,
    item_id uuid not null,
    quantity integer not null check (quantity > 0),
    primary key (item_type, item_id)
  ) on commit drop;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as raw_item(item)
    where jsonb_typeof(raw_item.item) <> 'object'
       or (
        not (
          raw_item.item ? 'inventory_item_id'
          and raw_item.item ->> 'inventory_item_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
        and not (
          raw_item.item ->> 'item_type' in ('listing_inventory', 'equipment_inventory', 'processed_poultry_inventory', 'hatching_egg_inventory')
          and raw_item.item ->> 'item_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
      )
       or raw_item.item ->> 'quantity' !~ '^[0-9]+$'
       or (raw_item.item ->> 'quantity')::integer <= 0
  ) then
    raise exception 'Each order item must include a valid item type, item ID, and positive quantity.';
  end if;

  insert into pg_temp.requested_order_items (item_type, item_id, quantity)
  select
    case when raw_item.item ? 'inventory_item_id' then 'listing_inventory' else raw_item.item ->> 'item_type' end,
    case when raw_item.item ? 'inventory_item_id' then (raw_item.item ->> 'inventory_item_id')::uuid else (raw_item.item ->> 'item_id')::uuid end,
    sum((raw_item.item ->> 'quantity')::integer)::integer
  from jsonb_array_elements(p_items) as raw_item(item)
  where jsonb_typeof(raw_item.item) = 'object'
    and (
      (
        raw_item.item ? 'inventory_item_id'
        and raw_item.item ->> 'inventory_item_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      or (
        raw_item.item ->> 'item_type' in ('listing_inventory', 'equipment_inventory', 'processed_poultry_inventory', 'hatching_egg_inventory')
        and raw_item.item ->> 'item_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
    )
    and raw_item.item ->> 'quantity' ~ '^[0-9]+$'
    and (raw_item.item ->> 'quantity')::integer > 0
  group by 1, 2;

  select count(*) into v_requested_item_count from pg_temp.requested_order_items as roi;

  if v_requested_item_count = 0 then
    raise exception 'Each order item must include a valid item type, item ID, and positive quantity.';
  end if;

  v_request_hash := encode(
    digest(
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
        'pickup_option_id', p_pickup_option_id,
        'fulfillment_method', v_fulfillment_method,
        'delivery_option_id', p_delivery_option_id,
        'items', (
          select jsonb_agg(
            jsonb_build_object(
              'item_type', roi.item_type,
              'item_id', roi.item_id,
              'quantity', roi.quantity
            )
            order by roi.item_type, roi.item_id
          )
          from pg_temp.requested_order_items as roi
        )
      )::text,
      'sha256'
    ),
    'hex'
  );

  insert into public.order_idempotency_keys as oik (store_id, idempotency_key, request_hash)
  values (p_store_id, v_idempotency_key, v_request_hash)
  on conflict on constraint order_idempotency_keys_pkey do nothing;

  select oik.*
  into v_existing_idempotency
  from public.order_idempotency_keys as oik
  where oik.store_id = p_store_id
    and oik.idempotency_key = v_idempotency_key
  for update;

  if v_existing_idempotency.request_hash <> v_request_hash then
    raise exception 'Idempotency key was already used with a different request.';
  end if;

  if v_existing_idempotency.order_id is not null then
    return query
    select
      o.id,
      o.order_number,
      o.store_id,
      o.customer_id,
      o.order_status,
      o.payment_method,
      o.payment_status,
      o.subtotal_amount,
      o.tax_fee_amount,
      o.total_amount,
      o.created_at
    from public.orders as o
    where o.id = v_existing_idempotency.order_id;

    return;
  end if;

  create temporary table pg_temp.locked_order_items (
    item_type text not null,
    item_id uuid not null,
    requested_quantity integer not null,
    store_id uuid not null,
    inventory_item_id uuid,
    equipment_inventory_item_id uuid,
    processed_poultry_inventory_item_id uuid,
    hatching_egg_inventory_item_id uuid,
    listing_batch_id uuid,
    listing_batch_breed_id uuid,
    seller_breed_profile_id uuid,
    species_id uuid,
    species_name text not null,
    species_slug text not null,
    breed_display_name text not null,
    breed_description text,
    inventory_type text not null,
    custom_inventory_label text,
    batch_type text not null,
    product_type text not null,
    item_name text not null,
    item_category text not null,
    available_date date,
    age_at_availability_days integer,
    quantity_available integer not null,
    unit_price numeric(10, 2) not null,
    line_subtotal numeric(10, 2) not null,
    can_checkout boolean not null,
    primary key (item_type, item_id)
  ) on commit drop;

  insert into pg_temp.locked_order_items (
    item_type,
    item_id,
    requested_quantity,
    store_id,
    inventory_item_id,
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
    product_type,
    item_name,
    item_category,
    available_date,
    age_at_availability_days,
    quantity_available,
    unit_price,
    line_subtotal,
    can_checkout
  )
  select
    'listing_inventory',
    ii.id,
    roi.quantity,
    ii.store_id,
    ii.id,
    lb.id,
    lbb.id,
    sbp.id,
    sp.id,
    sp.common_name,
    sp.slug,
    sbp.display_name,
    sbp.seller_description,
    ii.inventory_type,
    ii.custom_inventory_label,
    lb.batch_type,
    lb.batch_type,
    sbp.display_name,
    sp.common_name,
    lb.available_date,
    case when lb.batch_type = 'live_animals' then lb.age_at_availability_days else null end,
    ii.quantity_available,
    public.calculate_inventory_unit_price(
      lb.base_price,
      ii.price_override,
      lb.auto_price_adjustment_enabled,
      lb.price_adjustment_direction,
      lb.price_adjustment_amount,
      lb.price_adjustment_interval_weeks,
      lb.price_adjustment_max_price,
      lb.price_adjustment_min_price,
      lb.available_date
    ),
    (
      public.calculate_inventory_unit_price(
        lb.base_price,
        ii.price_override,
        lb.auto_price_adjustment_enabled,
        lb.price_adjustment_direction,
        lb.price_adjustment_amount,
        lb.price_adjustment_interval_weeks,
        lb.price_adjustment_max_price,
        lb.price_adjustment_min_price,
        lb.available_date
      ) * roi.quantity
    )::numeric(10, 2),
    (
      ii.visibility_status = 'active'
      and ii.moderation_status = 'normal'
      and lb.visibility_status = 'active'
      and lb.moderation_status = 'normal'
      and lbb.visibility_status = 'active'
      and lbb.moderation_status = 'normal'
      and sbp.visibility_status = 'active'
      and sbp.moderation_status = 'normal'
      and sp.is_active = true
    )
  from pg_temp.requested_order_items as roi
  join public.inventory_items as ii on ii.id = roi.item_id
  join public.listing_batches as lb on lb.id = ii.listing_batch_id
  join public.listing_batch_breeds as lbb on lbb.id = ii.listing_batch_breed_id
  join public.seller_breed_profiles as sbp on sbp.id = lbb.seller_breed_profile_id
  join public.species as sp on sp.id = lb.species_id
  where roi.item_type = 'listing_inventory'
  order by ii.id
  for update of ii;

  insert into pg_temp.locked_order_items (
    item_type,
    item_id,
    requested_quantity,
    store_id,
    equipment_inventory_item_id,
    species_name,
    species_slug,
    breed_display_name,
    breed_description,
    inventory_type,
    custom_inventory_label,
    batch_type,
    product_type,
    item_name,
    item_category,
    quantity_available,
    unit_price,
    line_subtotal,
    can_checkout
  )
  select
    'equipment_inventory',
    ei.id,
    roi.quantity,
    ei.store_id,
    ei.id,
    'Equipment & Supplies',
    'equipment-supplies',
    ei.item_name,
    ei.description,
    'equipment_supplies',
    ei.condition,
    'equipment_supplies',
    'equipment_supplies',
    ei.item_name,
    ei.category,
    ei.quantity_available,
    ei.price,
    (ei.price * roi.quantity)::numeric(10, 2),
    (ei.visibility_status = 'active' and ei.moderation_status = 'normal')
  from pg_temp.requested_order_items as roi
  join public.equipment_inventory_items as ei on ei.id = roi.item_id
  where roi.item_type = 'equipment_inventory'
  order by ei.id
  for update of ei;

  insert into pg_temp.locked_order_items (
    item_type,
    item_id,
    requested_quantity,
    store_id,
    processed_poultry_inventory_item_id,
    species_name,
    species_slug,
    breed_display_name,
    breed_description,
    inventory_type,
    custom_inventory_label,
    batch_type,
    product_type,
    item_name,
    item_category,
    quantity_available,
    unit_price,
    line_subtotal,
    can_checkout
  )
  select
    'processed_poultry_inventory',
    ppi.id,
    roi.quantity,
    ppi.store_id,
    ppi.id,
    ppi.poultry_type,
    lower(replace(ppi.poultry_type, ' ', '-')),
    ppi.product_name,
    ppi.description,
    'processed_poultry',
    concat_ws(' - ', ppi.product_type, ppi.package_size),
    'processed_poultry',
    'processed_poultry',
    ppi.product_name,
    ppi.poultry_type,
    ppi.quantity_available,
    ppi.price,
    (ppi.price * roi.quantity)::numeric(10, 2),
    (ppi.visibility_status = 'active' and ppi.moderation_status = 'normal')
  from pg_temp.requested_order_items as roi
  join public.processed_poultry_inventory_items as ppi on ppi.id = roi.item_id
  where roi.item_type = 'processed_poultry_inventory'
  order by ppi.id
  for update of ppi;

  insert into pg_temp.locked_order_items (
    item_type,
    item_id,
    requested_quantity,
    store_id,
    hatching_egg_inventory_item_id,
    species_id,
    species_name,
    species_slug,
    breed_display_name,
    breed_description,
    inventory_type,
    custom_inventory_label,
    batch_type,
    product_type,
    item_name,
    item_category,
    available_date,
    age_at_availability_days,
    quantity_available,
    unit_price,
    line_subtotal,
    can_checkout
  )
  select
    'hatching_egg_inventory',
    hei.id,
    roi.quantity,
    hei.store_id,
    hei.id,
    sp.id,
    sp.common_name,
    sp.slug,
    hei.item_name,
    hei.description,
    'hatching_eggs',
    null::text,
    'hatching_eggs',
    'hatching_eggs',
    hei.item_name,
    sp.common_name,
    hei.available_date,
    null::integer,
    hei.quantity_available,
    hei.price,
    (hei.price * roi.quantity)::numeric(10, 2),
    (
      hei.visibility_status = 'active'
      and hei.moderation_status = 'normal'
      and hei.archived_at is null
      and sp.is_active = true
      and roi.quantity > 0
      and roi.quantity <= hei.quantity_available
      and roi.quantity >= coalesce(hei.minimum_order_quantity, 1)
    )
  from pg_temp.requested_order_items as roi
  join public.hatching_egg_inventory_items as hei on hei.id = roi.item_id
  join public.species as sp on sp.id = hei.species_id
  where roi.item_type = 'hatching_egg_inventory'
  order by hei.id
  for update of hei;

  select count(*) into v_locked_item_count from pg_temp.locked_order_items as loi;

  if v_locked_item_count <> v_requested_item_count then
    raise exception 'One or more inventory items were not found.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items as loi
    where loi.store_id <> p_store_id
  ) then
    raise exception 'One or more inventory items do not belong to this store.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items as loi
    where loi.can_checkout = false
  ) then
    raise exception 'One or more inventory items are not available for checkout.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items as loi
    where loi.quantity_available < loi.requested_quantity
  ) then
    raise exception 'Insufficient inventory quantity available.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items as loi
    where loi.item_type = 'listing_inventory'
      and (
        (loi.batch_type = 'hatching_eggs' and loi.inventory_type <> 'hatching_eggs')
        or (loi.batch_type = 'live_animals' and loi.inventory_type = 'hatching_eggs')
      )
  ) then
    raise exception 'Invalid inventory type for listing batch type.';
  end if;

  select coalesce(sum(loi.line_subtotal), 0)::numeric(10, 2)
  into v_subtotal_amount
  from pg_temp.locked_order_items as loi;

  v_total_amount := v_subtotal_amount + v_tax_fee_amount + v_delivery_fee_amount;

  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || ':' || v_buyer_email, 0));

  select c.id
  into v_customer_id
  from public.customers as c
  where c.store_id = p_store_id
    and lower(trim(c.email)) = v_buyer_email
  order by c.created_at, c.id
  limit 1;

  if v_customer_id is null then
    insert into public.customers (
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
    returning customers.id into v_customer_id;
  else
    update public.customers as c
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
    where c.id = v_customer_id;
  end if;

  insert into public.order_number_counters as inserted_counter (store_id)
  values (p_store_id)
  on conflict on constraint order_number_counters_pkey do nothing;

  update public.order_number_counters as onc
  set last_order_number = onc.last_order_number + 1
  where onc.store_id = p_store_id
  returning onc.last_order_number into v_next_order_number;

  v_order_number := v_next_order_number::text;

  insert into public.orders (
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
    fulfillment_method,
    delivery_option_name_snapshot,
    delivery_fee_amount,
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
    v_fulfillment_method,
    v_delivery_option_name_snapshot,
    v_delivery_fee_amount,
    v_subtotal_amount,
    null,
    null,
    v_tax_fee_amount,
    v_total_amount,
    p_buyer_ip_address,
    v_buyer_user_agent
  )
  returning orders.id, orders.created_at into v_order_id, v_order_created_at;

  insert into public.order_items (
    order_id,
    store_id,
    order_item_source,
    inventory_item_id,
    equipment_inventory_item_id,
    processed_poultry_inventory_item_id,
    hatching_egg_inventory_item_id,
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
    product_type_snapshot,
    item_name_snapshot,
    item_category_snapshot,
    available_date_snapshot,
    age_at_availability_days_snapshot,
    unit_price_snapshot,
    quantity,
    line_subtotal
  )
  select
    v_order_id,
    p_store_id,
    loi.item_type,
    loi.inventory_item_id,
    loi.equipment_inventory_item_id,
    loi.processed_poultry_inventory_item_id,
    loi.hatching_egg_inventory_item_id,
    loi.listing_batch_id,
    loi.listing_batch_breed_id,
    loi.seller_breed_profile_id,
    loi.species_id,
    loi.species_name,
    loi.species_slug,
    loi.breed_display_name,
    loi.breed_description,
    loi.inventory_type,
    loi.custom_inventory_label,
    loi.batch_type,
    loi.product_type,
    loi.item_name,
    loi.item_category,
    loi.available_date,
    loi.age_at_availability_days,
    loi.unit_price,
    loi.requested_quantity,
    loi.line_subtotal
  from pg_temp.locked_order_items as loi
  order by loi.item_type, loi.item_id;

  update public.inventory_items as ii
  set quantity_available = ii.quantity_available - loi.requested_quantity
  from pg_temp.locked_order_items as loi
  where loi.item_type = 'listing_inventory'
    and ii.id = loi.inventory_item_id;

  update public.equipment_inventory_items as ei
  set quantity_available = ei.quantity_available - loi.requested_quantity
  from pg_temp.locked_order_items as loi
  where loi.item_type = 'equipment_inventory'
    and ei.id = loi.equipment_inventory_item_id;

  update public.processed_poultry_inventory_items as ppi
  set quantity_available = ppi.quantity_available - loi.requested_quantity
  from pg_temp.locked_order_items as loi
  where loi.item_type = 'processed_poultry_inventory'
    and ppi.id = loi.processed_poultry_inventory_item_id;

  update public.hatching_egg_inventory_items as hei
  set quantity_available = hei.quantity_available - loi.requested_quantity
  from pg_temp.locked_order_items as loi
  where loi.item_type = 'hatching_egg_inventory'
    and hei.id = loi.hatching_egg_inventory_item_id;

  update public.order_idempotency_keys as oik
  set order_id = v_order_id
  where oik.store_id = p_store_id
    and oik.idempotency_key = v_idempotency_key;

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
    o.id,
    o.order_number,
    o.store_id,
    o.customer_id,
    o.order_status,
    o.payment_method,
    o.payment_status,
    o.subtotal_amount,
    o.tax_fee_amount,
    o.total_amount,
    o.created_at
  from public.orders as o
  where o.id = v_order_id;
end;
$$;

revoke all on function public.create_pay_at_pickup_order_v2(
  uuid, text, text, text, text, jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, inet, text, uuid, text, uuid
) from public;
revoke all on function public.create_pay_at_pickup_order_v2(
  uuid, text, text, text, text, jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, inet, text, uuid, text, uuid
) from anon;
revoke all on function public.create_pay_at_pickup_order_v2(
  uuid, text, text, text, text, jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, inet, text, uuid, text, uuid
) from authenticated;

grant execute on function public.create_pay_at_pickup_order_v2(
  uuid, text, text, text, text, jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, inet, text, uuid, text, uuid
) to service_role;

comment on function public.create_pay_at_pickup_order_v2(
  uuid, text, text, text, text, jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, inet, text, uuid, text, uuid
) is
'Versioned trusted storefront order creation RPC with backend-validated pickup or delivery fulfillment. Delivery option name and fee are loaded from store_delivery_options and snapshotted on the order.';


commit;
