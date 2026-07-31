-- Treat email and phone as contact information rather than unique customer
-- identifiers when public checkout or manual orders resolve a customer.

create or replace function public.normalize_customer_name_for_matching(
  p_first_name text,
  p_last_name text
)
returns text
language sql
immutable
parallel safe
as $function$
  select nullif(
    regexp_replace(
      lower(
        trim(
          concat_ws(
            ' ',
            nullif(trim(p_first_name), ''),
            nullif(trim(p_last_name), '')
          )
        )
      ),
      '[[:space:]]+',
      ' ',
      'g'
    ),
    ''
  );
$function$;

revoke all on function public.normalize_customer_name_for_matching(text, text)
from public;

create or replace function public.resolve_order_customer_match(
  p_store_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_name text := public.normalize_customer_name_for_matching(
    p_first_name,
    p_last_name
  );
  v_email text := nullif(lower(trim(p_email)), '');
  v_phone text := public.normalize_customer_phone_for_matching(p_phone);
  v_match_count integer;
  v_customer_id uuid;
begin
  if p_store_id is null or v_name is null then
    return null;
  end if;

  if v_email is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        p_store_id::text || ':customer-name-email:' || v_name || ':' || v_email,
        0
      )
    );
  end if;

  if v_phone is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        p_store_id::text || ':customer-name-phone:' || v_name || ':' || v_phone,
        0
      )
    );
  end if;

  select count(*)::integer
  into v_match_count
  from public.customers as c
  where c.store_id = p_store_id
    and public.normalize_customer_name_for_matching(
      c.first_name,
      c.last_name
    ) = v_name
    and (
      (
        v_email is not null
        and lower(trim(c.email)) = v_email
      )
      or (
        v_phone is not null
        and public.normalize_customer_phone_for_matching(c.phone) = v_phone
      )
    );

  if v_match_count > 1 then
    raise warning
      'Multiple customer records matched submitted name and contact details for store %; choosing deterministically.',
      p_store_id;
  end if;

  select c.id
  into v_customer_id
  from public.customers as c
  where c.store_id = p_store_id
    and public.normalize_customer_name_for_matching(
      c.first_name,
      c.last_name
    ) = v_name
    and (
      (
        v_email is not null
        and lower(trim(c.email)) = v_email
      )
      or (
        v_phone is not null
        and public.normalize_customer_phone_for_matching(c.phone) = v_phone
      )
    )
  order by c.created_at, c.id
  limit 1
  for update;

  return v_customer_id;
end;
$function$;

revoke all on function public.resolve_order_customer_match(
  uuid,
  text,
  text,
  text,
  text
) from public;

comment on function public.resolve_order_customer_match(
  uuid,
  text,
  text,
  text,
  text
) is
'Returns the oldest deterministic same-store customer matching normalized full name plus normalized email or phone. Weak contact-only matches are not reused.';

-- These functions are defined explicitly rather than rewritten through
-- pg_get_functiondef so clean migrations are independent of source line endings.

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

  v_customer_id := public.resolve_order_customer_match(
    p_store_id,
    v_buyer_first_name,
    v_buyer_last_name,
    v_buyer_email,
    v_buyer_phone
  );

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
  p_send_seller_notification boolean default false,
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
  v_fulfillment_method text;
  v_pickup_option public.store_pickup_options%rowtype;
  v_delivery_option public.store_delivery_options%rowtype;
  v_pickup_option_label_snapshot text;
  v_delivery_option_name_snapshot text;
  v_delivery_fee_amount numeric(10, 2);
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
  v_equipment_subtotal_amount numeric(10, 2);
  v_processed_poultry_subtotal_amount numeric(10, 2);
  v_hatching_egg_subtotal_amount numeric(10, 2);
  v_custom_subtotal_amount numeric(10, 2);
  v_subtotal_amount numeric(10, 2);
  v_total_amount numeric(10, 2);

  v_requested_item_count integer;
  v_requested_inventory_item_count integer;
  v_requested_equipment_item_count integer;
  v_requested_processed_poultry_item_count integer;
  v_requested_hatching_egg_item_count integer;
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
  v_fulfillment_method := coalesce(nullif(trim(p_fulfillment_method), ''), 'pickup');
  v_delivery_fee_amount := 0;
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

  if v_fulfillment_method not in ('pickup', 'delivery') then
    raise exception 'Fulfillment method must be pickup or delivery.';
  end if;

  if v_fulfillment_method = 'pickup' and p_delivery_option_id is not null then
    raise exception 'Delivery option must be blank for pickup orders.';
  end if;

  if p_pickup_option_id is not null and v_pickup_note is not null then
    raise exception 'Pickup option and pickup note cannot both be set.';
  end if;

  if v_fulfillment_method = 'delivery' then
    if p_pickup_option_id is not null or v_pickup_note is not null then
      raise exception 'Pickup fields must be blank for delivery orders.';
    end if;

    if p_delivery_option_id is null then
      raise exception 'Delivery option is required for delivery orders.';
    end if;

    if coalesce(v_store.delivery_enabled, false) = false then
      raise exception 'Store does not offer delivery.';
    end if;

    select store_delivery_options.*
    into v_delivery_option
    from public.store_delivery_options as store_delivery_options
    where store_delivery_options.id = p_delivery_option_id
      and store_delivery_options.store_id = p_store_id
      and store_delivery_options.is_active = true;

    if v_delivery_option.id is null then
      raise exception 'Delivery option is not available for this store.';
    end if;

    v_delivery_option_name_snapshot := v_delivery_option.name;
    v_delivery_fee_amount := v_delivery_option.price_amount;
  else
    if coalesce(v_store.pickup_method, 'notes') = 'manual_options' and p_pickup_option_id is null then
      raise exception 'Pickup option is required for this store.';
    end if;

    if p_pickup_option_id is not null then
      select store_pickup_options.*
      into v_pickup_option
      from public.store_pickup_options as store_pickup_options
      where store_pickup_options.id = p_pickup_option_id
        and store_pickup_options.store_id = p_store_id
        and store_pickup_options.is_active = true;

      if v_pickup_option.id is null then
        raise exception 'Pickup option is not available for this store.';
      end if;

      v_pickup_option_label_snapshot := v_pickup_option.label;
    end if;
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
       or coalesce(nullif(item ->> 'item_type', ''), 'inventory') not in (
         'inventory',
         'custom',
         'equipment_inventory',
         'processed_poultry_inventory',
         'hatching_egg_inventory'
       )
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
       or (
         coalesce(nullif(item ->> 'item_type', ''), 'inventory') in (
           'equipment_inventory',
           'processed_poultry_inventory',
           'hatching_egg_inventory'
         )
         and (
           not (item ? 'item_id')
           or item ->> 'item_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         )
       )
  ) then
    raise exception 'Each manual order item must include a valid type, quantity, price, and item details.';
  end if;

  drop table if exists pg_temp.requested_manual_order_items;
  drop table if exists pg_temp.locked_manual_order_items;
  drop table if exists pg_temp.locked_manual_equipment_items;
  drop table if exists pg_temp.locked_manual_processed_poultry_items;
  drop table if exists pg_temp.locked_manual_hatching_egg_items;

  create temporary table pg_temp.requested_manual_order_items (
    line_number integer primary key,
    item_type text not null check (
      item_type in (
        'inventory',
        'custom',
        'equipment_inventory',
        'processed_poultry_inventory',
        'hatching_egg_inventory'
      )
    ),
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
      when coalesce(nullif(item_with_ordinality.item ->> 'item_type', ''), 'inventory') in (
        'equipment_inventory',
        'processed_poultry_inventory',
        'hatching_egg_inventory'
      )
        then (item_with_ordinality.item ->> 'item_id')::uuid
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
        requested_manual_order_items.item_type,
        requested_manual_order_items.inventory_item_id,
        count(*) as item_count
      from pg_temp.requested_manual_order_items as requested_manual_order_items
      where requested_manual_order_items.item_type <> 'custom'
      group by
        requested_manual_order_items.item_type,
        requested_manual_order_items.inventory_item_id
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

  select count(*)
  into v_requested_equipment_item_count
  from pg_temp.requested_manual_order_items as requested_manual_order_items
  where requested_manual_order_items.item_type = 'equipment_inventory';

  select count(*)
  into v_requested_processed_poultry_item_count
  from pg_temp.requested_manual_order_items as requested_manual_order_items
  where requested_manual_order_items.item_type = 'processed_poultry_inventory';

  select count(*)
  into v_requested_hatching_egg_item_count
  from pg_temp.requested_manual_order_items as requested_manual_order_items
  where requested_manual_order_items.item_type = 'hatching_egg_inventory';

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
        'pickup_option_id', p_pickup_option_id,
        'fulfillment_method', v_fulfillment_method,
        'delivery_option_id', p_delivery_option_id,
        'delivery_fee_amount', v_delivery_fee_amount,
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

  create temporary table pg_temp.locked_manual_equipment_items (
    line_number integer primary key,
    equipment_inventory_item_id uuid not null,
    requested_quantity integer not null,
    store_id uuid not null,
    item_name text not null,
    description text,
    category text not null,
    condition text,
    quantity_available integer not null,
    unit_price numeric(10, 2) not null,
    line_subtotal numeric(10, 2) not null
  ) on commit drop;

  insert into pg_temp.locked_manual_equipment_items (
    line_number,
    equipment_inventory_item_id,
    requested_quantity,
    store_id,
    item_name,
    description,
    category,
    condition,
    quantity_available,
    unit_price,
    line_subtotal
  )
  select
    requested_manual_order_items.line_number,
    equipment_inventory_items.id,
    requested_manual_order_items.quantity,
    equipment_inventory_items.store_id,
    equipment_inventory_items.item_name,
    equipment_inventory_items.description,
    equipment_inventory_items.category,
    equipment_inventory_items.condition,
    equipment_inventory_items.quantity_available,
    coalesce(
      requested_manual_order_items.unit_price_override,
      equipment_inventory_items.price
    )::numeric(10, 2),
    (
      coalesce(
        requested_manual_order_items.unit_price_override,
        equipment_inventory_items.price
      ) * requested_manual_order_items.quantity
    )::numeric(10, 2)
  from (
    select requested_manual_order_items.*
    from pg_temp.requested_manual_order_items as requested_manual_order_items
    where requested_manual_order_items.item_type = 'equipment_inventory'
    order by requested_manual_order_items.inventory_item_id
  ) as requested_manual_order_items
  join public.equipment_inventory_items as equipment_inventory_items
    on equipment_inventory_items.id = requested_manual_order_items.inventory_item_id
   and equipment_inventory_items.store_id = p_store_id
  for update of equipment_inventory_items;

  select count(*)
  into v_locked_item_count
  from pg_temp.locked_manual_equipment_items as locked_manual_equipment_items;

  if v_locked_item_count <> v_requested_equipment_item_count then
    raise exception 'One or more equipment items are not available for this store.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_manual_equipment_items as locked_manual_equipment_items
    join public.equipment_inventory_items as equipment_inventory_items
      on equipment_inventory_items.id = locked_manual_equipment_items.equipment_inventory_item_id
    where equipment_inventory_items.store_id <> p_store_id
       or equipment_inventory_items.visibility_status = 'archived'
       or equipment_inventory_items.moderation_status <> 'normal'
  ) then
    raise exception 'One or more equipment items are not available for manual orders.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_manual_equipment_items as locked_manual_equipment_items
    where locked_manual_equipment_items.requested_quantity > locked_manual_equipment_items.quantity_available
  ) then
    raise exception 'Insufficient equipment quantity available.';
  end if;

  create temporary table pg_temp.locked_manual_processed_poultry_items (
    line_number integer primary key,
    processed_poultry_inventory_item_id uuid not null,
    requested_quantity integer not null,
    store_id uuid not null,
    product_name text not null,
    description text,
    poultry_type text not null,
    product_type text not null,
    package_size text,
    quantity_available integer not null,
    unit_price numeric(10, 2) not null,
    line_subtotal numeric(10, 2) not null
  ) on commit drop;

  insert into pg_temp.locked_manual_processed_poultry_items (
    line_number,
    processed_poultry_inventory_item_id,
    requested_quantity,
    store_id,
    product_name,
    description,
    poultry_type,
    product_type,
    package_size,
    quantity_available,
    unit_price,
    line_subtotal
  )
  select
    requested_manual_order_items.line_number,
    processed_poultry_inventory_items.id,
    requested_manual_order_items.quantity,
    processed_poultry_inventory_items.store_id,
    processed_poultry_inventory_items.product_name,
    processed_poultry_inventory_items.description,
    processed_poultry_inventory_items.poultry_type,
    processed_poultry_inventory_items.product_type,
    processed_poultry_inventory_items.package_size,
    processed_poultry_inventory_items.quantity_available,
    coalesce(
      requested_manual_order_items.unit_price_override,
      processed_poultry_inventory_items.price
    )::numeric(10, 2),
    (
      coalesce(
        requested_manual_order_items.unit_price_override,
        processed_poultry_inventory_items.price
      ) * requested_manual_order_items.quantity
    )::numeric(10, 2)
  from (
    select requested_manual_order_items.*
    from pg_temp.requested_manual_order_items as requested_manual_order_items
    where requested_manual_order_items.item_type = 'processed_poultry_inventory'
    order by requested_manual_order_items.inventory_item_id
  ) as requested_manual_order_items
  join public.processed_poultry_inventory_items as processed_poultry_inventory_items
    on processed_poultry_inventory_items.id = requested_manual_order_items.inventory_item_id
   and processed_poultry_inventory_items.store_id = p_store_id
  for update of processed_poultry_inventory_items;

  select count(*)
  into v_locked_item_count
  from pg_temp.locked_manual_processed_poultry_items as locked_manual_processed_poultry_items;

  if v_locked_item_count <> v_requested_processed_poultry_item_count then
    raise exception 'One or more poultry products are not available for this store.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_manual_processed_poultry_items as locked_manual_processed_poultry_items
    join public.processed_poultry_inventory_items as processed_poultry_inventory_items
      on processed_poultry_inventory_items.id = locked_manual_processed_poultry_items.processed_poultry_inventory_item_id
    where processed_poultry_inventory_items.store_id <> p_store_id
       or processed_poultry_inventory_items.visibility_status = 'archived'
       or processed_poultry_inventory_items.moderation_status <> 'normal'
  ) then
    raise exception 'One or more poultry products are not available for manual orders.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_manual_processed_poultry_items as locked_manual_processed_poultry_items
    where locked_manual_processed_poultry_items.requested_quantity > locked_manual_processed_poultry_items.quantity_available
  ) then
    raise exception 'Insufficient poultry product quantity available.';
  end if;

  create temporary table pg_temp.locked_manual_hatching_egg_items (
    line_number integer primary key,
    hatching_egg_inventory_item_id uuid not null,
    requested_quantity integer not null,
    store_id uuid not null,
    item_name text not null,
    description text,
    species_id uuid not null,
    species_name text not null,
    species_slug text not null,
    available_date date not null,
    minimum_order_quantity integer,
    quantity_available integer not null,
    unit_price numeric(10, 2) not null,
    line_subtotal numeric(10, 2) not null
  ) on commit drop;

  insert into pg_temp.locked_manual_hatching_egg_items (
    line_number,
    hatching_egg_inventory_item_id,
    requested_quantity,
    store_id,
    item_name,
    description,
    species_id,
    species_name,
    species_slug,
    available_date,
    minimum_order_quantity,
    quantity_available,
    unit_price,
    line_subtotal
  )
  select
    requested.line_number,
    hatching_items.id,
    requested.quantity,
    hatching_items.store_id,
    hatching_items.item_name,
    hatching_items.description,
    hatching_items.species_id,
    species.common_name,
    species.slug,
    hatching_items.available_date,
    hatching_items.minimum_order_quantity,
    hatching_items.quantity_available,
    coalesce(requested.unit_price_override, hatching_items.price)::numeric(10, 2),
    (
      coalesce(requested.unit_price_override, hatching_items.price)
      * requested.quantity
    )::numeric(10, 2)
  from (
    select requested_manual_order_items.*
    from pg_temp.requested_manual_order_items as requested_manual_order_items
    where requested_manual_order_items.item_type = 'hatching_egg_inventory'
    order by requested_manual_order_items.inventory_item_id
  ) as requested
  join public.hatching_egg_inventory_items as hatching_items
    on hatching_items.id = requested.inventory_item_id
   and hatching_items.store_id = p_store_id
  join public.species as species
    on species.id = hatching_items.species_id
  for update of hatching_items;

  select count(*)
  into v_locked_item_count
  from pg_temp.locked_manual_hatching_egg_items;

  if v_locked_item_count <> v_requested_hatching_egg_item_count then
    raise exception 'One or more hatching egg items are not available for this store.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_manual_hatching_egg_items as locked
    join public.hatching_egg_inventory_items as hatching_items
      on hatching_items.id = locked.hatching_egg_inventory_item_id
    where hatching_items.store_id <> p_store_id
       or hatching_items.visibility_status = 'archived'
       or hatching_items.moderation_status <> 'normal'
  ) then
    raise exception 'One or more hatching egg items are not available for manual orders.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_manual_hatching_egg_items as locked
    where locked.requested_quantity > locked.quantity_available
  ) then
    raise exception 'Insufficient hatching egg quantity available.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_manual_hatching_egg_items as locked
    where locked.requested_quantity < coalesce(locked.minimum_order_quantity, 1)
  ) then
    raise exception 'Hatching egg quantity is below the minimum order quantity.';
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

  select coalesce(sum(locked_manual_equipment_items.line_subtotal), 0)::numeric(10, 2)
  into v_equipment_subtotal_amount
  from pg_temp.locked_manual_equipment_items as locked_manual_equipment_items;

  select coalesce(sum(locked_manual_processed_poultry_items.line_subtotal), 0)::numeric(10, 2)
  into v_processed_poultry_subtotal_amount
  from pg_temp.locked_manual_processed_poultry_items as locked_manual_processed_poultry_items;

  select coalesce(sum(locked.line_subtotal), 0)::numeric(10, 2)
  into v_hatching_egg_subtotal_amount
  from pg_temp.locked_manual_hatching_egg_items as locked;

  select coalesce(
    sum((requested_manual_order_items.unit_price_override * requested_manual_order_items.quantity)::numeric(10, 2)),
    0
  )::numeric(10, 2)
  into v_custom_subtotal_amount
  from pg_temp.requested_manual_order_items as requested_manual_order_items
  where requested_manual_order_items.item_type = 'custom';

  v_subtotal_amount := (
    v_inventory_subtotal_amount
    + v_equipment_subtotal_amount
    + v_processed_poultry_subtotal_amount
    + v_hatching_egg_subtotal_amount
    + v_custom_subtotal_amount
  )::numeric(10, 2);
  v_total_amount := (v_subtotal_amount + v_tax_fee_amount + v_delivery_fee_amount)::numeric(10, 2);

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
    v_customer_id := public.resolve_order_customer_match(
      p_store_id,
      v_customer_first_name,
      v_customer_last_name,
      v_customer_email,
      v_customer_phone
    );

    if v_customer_id is not null then
      select customers.*
      into v_customer
      from public.customers as customers
      where customers.id = v_customer_id
        and customers.store_id = p_store_id;
    end if;
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
    pickup_option_id,
    pickup_option_label_snapshot,
    fulfillment_method,
    delivery_option_name_snapshot,
    delivery_fee_amount,
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
    p_pickup_option_id,
    v_pickup_option_label_snapshot,
    v_fulfillment_method,
    v_delivery_option_name_snapshot,
    v_delivery_fee_amount,
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
    'listing_inventory'
  from pg_temp.locked_manual_order_items as locked_manual_order_items
  order by locked_manual_order_items.line_number;

  insert into public.order_items (
    order_id,
    store_id,
    equipment_inventory_item_id,
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
    unit_price_snapshot,
    quantity,
    line_subtotal,
    order_item_source
  )
  select
    v_order_id,
    p_store_id,
    locked_manual_equipment_items.equipment_inventory_item_id,
    'Equipment & Supplies',
    'equipment-supplies',
    locked_manual_equipment_items.item_name,
    locked_manual_equipment_items.description,
    'equipment_supplies',
    locked_manual_equipment_items.condition,
    'equipment_supplies',
    'equipment_supplies',
    locked_manual_equipment_items.item_name,
    locked_manual_equipment_items.category,
    locked_manual_equipment_items.unit_price,
    locked_manual_equipment_items.requested_quantity,
    locked_manual_equipment_items.line_subtotal,
    'equipment_inventory'
  from pg_temp.locked_manual_equipment_items as locked_manual_equipment_items
  order by locked_manual_equipment_items.line_number;

  insert into public.order_items (
    order_id,
    store_id,
    processed_poultry_inventory_item_id,
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
    unit_price_snapshot,
    quantity,
    line_subtotal,
    order_item_source
  )
  select
    v_order_id,
    p_store_id,
    locked_manual_processed_poultry_items.processed_poultry_inventory_item_id,
    locked_manual_processed_poultry_items.poultry_type,
    lower(replace(locked_manual_processed_poultry_items.poultry_type, ' ', '-')),
    locked_manual_processed_poultry_items.product_name,
    locked_manual_processed_poultry_items.description,
    'processed_poultry',
    concat_ws(
      ' - ',
      locked_manual_processed_poultry_items.product_type,
      locked_manual_processed_poultry_items.package_size
    ),
    'processed_poultry',
    'processed_poultry',
    locked_manual_processed_poultry_items.product_name,
    locked_manual_processed_poultry_items.poultry_type,
    locked_manual_processed_poultry_items.unit_price,
    locked_manual_processed_poultry_items.requested_quantity,
    locked_manual_processed_poultry_items.line_subtotal,
    'processed_poultry_inventory'
  from pg_temp.locked_manual_processed_poultry_items as locked_manual_processed_poultry_items
  order by locked_manual_processed_poultry_items.line_number;

  insert into public.order_items (
    order_id,
    store_id,
    hatching_egg_inventory_item_id,
    species_id,
    species_name_snapshot,
    species_slug_snapshot,
    breed_display_name_snapshot,
    breed_description_snapshot,
    inventory_type_snapshot,
    custom_inventory_label_snapshot,
    batch_type_snapshot,
    available_date_snapshot,
    product_type_snapshot,
    item_name_snapshot,
    item_category_snapshot,
    unit_price_snapshot,
    quantity,
    line_subtotal,
    order_item_source
  )
  select
    v_order_id,
    p_store_id,
    locked.hatching_egg_inventory_item_id,
    locked.species_id,
    locked.species_name,
    locked.species_slug,
    locked.item_name,
    locked.description,
    'hatching_eggs',
    locked.species_name,
    'hatching_eggs',
    locked.available_date,
    'hatching_eggs',
    locked.item_name,
    locked.species_name,
    locked.unit_price,
    locked.requested_quantity,
    locked.line_subtotal,
    'hatching_egg_inventory'
  from pg_temp.locked_manual_hatching_egg_items as locked
  order by locked.line_number;

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

  update public.equipment_inventory_items as equipment_inventory_items
  set quantity_available =
    equipment_inventory_items.quantity_available
    - locked_manual_equipment_items.requested_quantity
  from pg_temp.locked_manual_equipment_items as locked_manual_equipment_items
  where equipment_inventory_items.id = locked_manual_equipment_items.equipment_inventory_item_id
    and equipment_inventory_items.store_id = p_store_id;

  update public.processed_poultry_inventory_items as processed_poultry_inventory_items
  set quantity_available =
    processed_poultry_inventory_items.quantity_available
    - locked_manual_processed_poultry_items.requested_quantity
  from pg_temp.locked_manual_processed_poultry_items as locked_manual_processed_poultry_items
  where processed_poultry_inventory_items.id = locked_manual_processed_poultry_items.processed_poultry_inventory_item_id
    and processed_poultry_inventory_items.store_id = p_store_id;

  update public.hatching_egg_inventory_items as hatching_items
  set quantity_available =
    hatching_items.quantity_available - locked.requested_quantity
  from pg_temp.locked_manual_hatching_egg_items as locked
  where hatching_items.id = locked.hatching_egg_inventory_item_id
    and hatching_items.store_id = p_store_id;

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
        'pickup_option_label', v_pickup_option_label_snapshot,
        'fulfillment_method', v_fulfillment_method,
        'delivery_option_name', v_delivery_option_name_snapshot,
        'delivery_fee_amount', v_delivery_fee_amount,
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
  uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, boolean, boolean, uuid, text, uuid
) is
'Trusted seller/admin RPC for atomically creating manual/offline orders, including standalone Hatching Eggs inventory.';

revoke all on function public.seller_create_manual_order(
  uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, boolean, boolean, uuid, text, uuid
) from public;

grant execute on function public.seller_create_manual_order(
  uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, boolean, boolean, uuid, text, uuid
) to authenticated;
