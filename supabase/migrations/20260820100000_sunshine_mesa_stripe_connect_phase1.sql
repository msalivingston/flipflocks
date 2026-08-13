-- Sunshine Mesa Farm Stripe Connect Phase 1.
-- Direct charges only; Stripe remains authoritative for account and payment state.

create table public.store_stripe_connections (
  store_id uuid not null references public.stores(id) on delete cascade,
  stripe_livemode boolean not null,
  stripe_account_id text,
  primary key (store_id, stripe_livemode),
  constraint store_stripe_connections_account_id_check check (
    stripe_account_id is null or stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
  )
);

create unique index store_stripe_connections_account_mode_unique_idx
on public.store_stripe_connections(stripe_account_id, stripe_livemode)
where stripe_account_id is not null;

alter table public.store_stripe_connections enable row level security;
revoke all on public.store_stripe_connections from public, anon, authenticated;
grant select, insert, update on public.store_stripe_connections to service_role;

comment on table public.store_stripe_connections is
'Private pilot allowlist and connected-account binding. Stripe is authoritative for every readiness and requirements field.';

insert into public.store_stripe_connections (store_id, stripe_livemode)
select stores.id, modes.stripe_livemode
from public.stores
cross join (values (false), (true)) as modes(stripe_livemode)
where stores.store_slug = 'sunshine-mesa-farm'
on conflict (store_id, stripe_livemode) do nothing;


create table public.storefront_card_checkout_reservations (
  id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  stripe_livemode boolean not null,
  stripe_account_id text not null,
  stripe_checkout_session_id text not null unique,
  expires_at timestamptz not null,
  amount_total_cents bigint not null,
  currency text not null,
  order_snapshot jsonb not null,
  item_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint storefront_card_reservation_account_check check (
    stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
  ),
  constraint storefront_card_reservation_session_check check (
    stripe_checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9]+$'
  ),
  constraint storefront_card_reservation_expiry_check check (expires_at > created_at),
  constraint storefront_card_reservation_amount_check check (amount_total_cents >= 0),
  constraint storefront_card_reservation_currency_check check (currency ~ '^[a-z]{3}$'),
  constraint storefront_card_reservation_order_snapshot_check check (jsonb_typeof(order_snapshot) = 'object'),
  constraint storefront_card_reservation_item_snapshot_check check (
    jsonb_typeof(item_snapshot) = 'array' and jsonb_array_length(item_snapshot) > 0
  )
);

create index storefront_card_reservations_store_expiry_idx
on public.storefront_card_checkout_reservations(store_id, expires_at);

alter table public.storefront_card_checkout_reservations enable row level security;
revoke all on public.storefront_card_checkout_reservations from public, anon, authenticated;
grant select, insert, delete on public.storefront_card_checkout_reservations to service_role;

comment on table public.storefront_card_checkout_reservations is
'Short-lived inventory holds, one per connected-account Checkout Session. Rows are removed by paid or expired settlement.';


create function public.reserve_storefront_card_checkout(
  p_reservation_id uuid,
  p_store_id uuid,
  p_stripe_livemode boolean,
  p_stripe_account_id text,
  p_stripe_checkout_session_id text,
  p_expires_at timestamptz,
  p_amount_total_cents bigint,
  p_currency text,
  p_buyer_email text,
  p_buyer_first_name text,
  p_buyer_last_name text,
  p_buyer_phone text,
  p_items jsonb,
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
  reservation_id uuid,
  stripe_checkout_session_id text,
  expires_at timestamptz,
  amount_total_cents bigint,
  currency text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_store public.stores%rowtype;
  v_connection public.store_stripe_connections%rowtype;
  v_pickup_option public.store_pickup_options%rowtype;
  v_delivery_option public.store_delivery_options%rowtype;
  v_email text := lower(nullif(trim(p_buyer_email), ''));
  v_first_name text := nullif(trim(p_buyer_first_name), '');
  v_last_name text := nullif(trim(p_buyer_last_name), '');
  v_phone text := nullif(trim(p_buyer_phone), '');
  v_fulfillment text := coalesce(nullif(trim(p_fulfillment_method), ''), 'pickup');
  v_currency text := lower(nullif(trim(p_currency), ''));
  v_subtotal numeric(10,2);
  v_delivery_fee numeric(10,2) := 0;
  v_total numeric(10,2);
  v_item_count integer;
  v_locked_count integer;
  v_item_snapshot jsonb;
  v_order_snapshot jsonb;
  v_existing public.storefront_card_checkout_reservations%rowtype;
begin
  if p_reservation_id is null or p_store_id is null then raise exception 'Reservation and store are required.'; end if;
  if p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$' then raise exception 'Stripe account is invalid.'; end if;
  if p_stripe_checkout_session_id !~ '^cs_(test|live)_[A-Za-z0-9]+$' then raise exception 'Stripe Checkout Session is invalid.'; end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'Stripe Checkout Session expiration is invalid.'; end if;
  if p_amount_total_cents is null or p_amount_total_cents < 0 then raise exception 'Stripe Checkout amount is invalid.'; end if;
  if v_currency !~ '^[a-z]{3}$' then raise exception 'Stripe Checkout currency is invalid.'; end if;
  if v_email is null or v_first_name is null or v_last_name is null or v_phone is null then
    raise exception 'Buyer contact information is required.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one order item is required.';
  end if;

  select stores.* into v_store
  from public.stores
  where stores.id = p_store_id
    and stores.storefront_enabled = true
    and stores.store_status = 'live'
    and stores.storefront_mode in ('hosted', 'embedded')
    and stores.admin_hold_reason is null;
  if v_store.id is null then raise exception 'Store is not available for checkout.'; end if;
  if lower(v_store.currency_code) <> v_currency then raise exception 'Stripe Checkout currency does not match the store.'; end if;

  select connections.* into v_connection
  from public.store_stripe_connections as connections
  where connections.store_id = p_store_id
    and connections.stripe_livemode = p_stripe_livemode
    and connections.stripe_account_id = p_stripe_account_id;
  if v_connection.store_id is null then raise exception 'Store is not enabled for card payments.'; end if;

  select reservations.* into v_existing
  from public.storefront_card_checkout_reservations as reservations
  where reservations.id = p_reservation_id
     or reservations.stripe_checkout_session_id = p_stripe_checkout_session_id
  for update;
  if v_existing.id is not null then
    if v_existing.id <> p_reservation_id
      or v_existing.store_id <> p_store_id
      or v_existing.stripe_account_id <> p_stripe_account_id
      or v_existing.stripe_livemode <> p_stripe_livemode
      or v_existing.amount_total_cents <> p_amount_total_cents
      or v_existing.currency <> v_currency then
      raise exception 'Stripe Checkout reservation conflicts with an existing request.';
    end if;
    return query select v_existing.id, v_existing.stripe_checkout_session_id, v_existing.expires_at,
      v_existing.amount_total_cents, v_existing.currency;
    return;
  end if;

  if v_fulfillment not in ('pickup', 'delivery') then raise exception 'Fulfillment method must be pickup or delivery.'; end if;
  if v_fulfillment = 'pickup' and p_delivery_option_id is not null then raise exception 'Delivery option must be blank for pickup orders.'; end if;
  if v_fulfillment = 'delivery' then
    if p_pickup_option_id is not null then raise exception 'Pickup option must be blank for delivery orders.'; end if;
    if p_delivery_option_id is null then raise exception 'Delivery option is required for delivery orders.'; end if;
    if coalesce(v_store.delivery_enabled, false) = false then raise exception 'Store does not offer delivery.'; end if;
    select options.* into v_delivery_option from public.store_delivery_options as options
    where options.id = p_delivery_option_id and options.store_id = p_store_id and options.is_active = true;
    if v_delivery_option.id is null then raise exception 'Delivery option is not available for this store.'; end if;
    v_delivery_fee := v_delivery_option.price_amount;
  else
    if p_pickup_option_id is not null then
      select options.* into v_pickup_option from public.store_pickup_options as options
      where options.id = p_pickup_option_id and options.store_id = p_store_id and options.is_active = true;
      if v_pickup_option.id is null then raise exception 'Pickup option is not available for this store.'; end if;
    end if;
  end if;

  create temporary table pg_temp.card_requested_items (
    item_type text not null,
    item_id uuid not null,
    quantity integer not null check (quantity > 0),
    primary key (item_type, item_id)
  ) on commit drop;

  if exists (
    select 1 from jsonb_array_elements(p_items) as raw(item)
    where jsonb_typeof(raw.item) <> 'object'
      or raw.item ->> 'item_type' not in ('listing_inventory','equipment_inventory','processed_poultry_inventory','hatching_egg_inventory')
      or raw.item ->> 'item_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or raw.item ->> 'quantity' !~ '^[0-9]+$'
      or (raw.item ->> 'quantity')::integer <= 0
  ) then raise exception 'Each order item must include a valid item type, item ID, and positive quantity.'; end if;

  insert into pg_temp.card_requested_items
  select raw.item ->> 'item_type', (raw.item ->> 'item_id')::uuid,
    sum((raw.item ->> 'quantity')::integer)::integer
  from jsonb_array_elements(p_items) as raw(item)
  group by 1,2;
  select count(*) into v_item_count from pg_temp.card_requested_items;

  create temporary table pg_temp.card_locked_items (
    item_type text not null, item_id uuid not null, requested_quantity integer not null, store_id uuid not null,
    inventory_item_id uuid, equipment_inventory_item_id uuid, processed_poultry_inventory_item_id uuid,
    hatching_egg_inventory_item_id uuid, listing_batch_id uuid, listing_batch_breed_id uuid,
    seller_breed_profile_id uuid, species_id uuid, species_name text not null, species_slug text not null,
    breed_display_name text not null, breed_description text, inventory_type text not null,
    custom_inventory_label text, batch_type text not null, product_type text not null,
    item_name text not null, item_category text not null, available_date date,
    age_at_availability_days integer, quantity_available integer not null, unit_price numeric(10,2) not null,
    line_subtotal numeric(10,2) not null, can_checkout boolean not null,
    primary key (item_type,item_id)
  ) on commit drop;

  insert into pg_temp.card_locked_items
  select 'listing_inventory', ii.id, requested.quantity, ii.store_id, ii.id, null::uuid, null::uuid, null::uuid,
    batches.id, batch_breeds.id, profiles.id, species.id, species.common_name, species.slug,
    profiles.display_name, profiles.seller_description, ii.inventory_type, ii.custom_inventory_label,
    batches.batch_type, batches.batch_type, profiles.display_name, species.common_name, batches.available_date,
    case when batches.batch_type='live_animals' then batches.age_at_availability_days else null end,
    ii.quantity_available,
    public.calculate_inventory_unit_price(batches.base_price,ii.price_override,batches.auto_price_adjustment_enabled,
      batches.price_adjustment_direction,batches.price_adjustment_amount,batches.price_adjustment_interval_weeks,
      batches.price_adjustment_max_price,batches.price_adjustment_min_price,batches.available_date),
    (public.calculate_inventory_unit_price(batches.base_price,ii.price_override,batches.auto_price_adjustment_enabled,
      batches.price_adjustment_direction,batches.price_adjustment_amount,batches.price_adjustment_interval_weeks,
      batches.price_adjustment_max_price,batches.price_adjustment_min_price,batches.available_date)*requested.quantity)::numeric(10,2),
    (ii.visibility_status='active' and ii.moderation_status='normal' and batches.visibility_status='active'
      and batches.moderation_status='normal' and batch_breeds.visibility_status='active'
      and batch_breeds.moderation_status='normal' and profiles.visibility_status='active'
      and profiles.moderation_status='normal' and species.is_active=true)
  from pg_temp.card_requested_items requested
  join public.inventory_items ii on ii.id=requested.item_id
  join public.listing_batches batches on batches.id=ii.listing_batch_id
  join public.listing_batch_breeds batch_breeds on batch_breeds.id=ii.listing_batch_breed_id
  join public.seller_breed_profiles profiles on profiles.id=batch_breeds.seller_breed_profile_id
  join public.species on species.id=batches.species_id
  where requested.item_type='listing_inventory' order by ii.id for update of ii;

  insert into pg_temp.card_locked_items
  select 'equipment_inventory', items.id, requested.quantity, items.store_id, null::uuid, items.id, null::uuid, null::uuid,
    null::uuid,null::uuid,null::uuid,null::uuid,'Equipment & Supplies','equipment-supplies',items.item_name,items.description,
    'equipment_supplies',items.condition,'equipment_supplies','equipment_supplies',items.item_name,items.category,null::date,
    null::integer,items.quantity_available,items.price,(items.price*requested.quantity)::numeric(10,2),
    (items.visibility_status='active' and items.moderation_status='normal')
  from pg_temp.card_requested_items requested join public.equipment_inventory_items items on items.id=requested.item_id
  where requested.item_type='equipment_inventory' order by items.id for update of items;

  insert into pg_temp.card_locked_items
  select 'processed_poultry_inventory', items.id, requested.quantity, items.store_id, null::uuid,null::uuid,items.id,null::uuid,
    null::uuid,null::uuid,null::uuid,null::uuid,items.poultry_type,lower(replace(items.poultry_type,' ','-')),
    items.product_name,items.description,'processed_poultry',concat_ws(' - ',items.product_type,items.package_size),
    'processed_poultry','processed_poultry',items.product_name,items.poultry_type,null::date,null::integer,
    items.quantity_available,items.price,(items.price*requested.quantity)::numeric(10,2),
    (items.visibility_status='active' and items.moderation_status='normal')
  from pg_temp.card_requested_items requested join public.processed_poultry_inventory_items items on items.id=requested.item_id
  where requested.item_type='processed_poultry_inventory' order by items.id for update of items;

  insert into pg_temp.card_locked_items
  select 'hatching_egg_inventory', items.id, requested.quantity, items.store_id, null::uuid,null::uuid,null::uuid,items.id,
    null::uuid,null::uuid,null::uuid,species.id,species.common_name,species.slug,items.item_name,items.description,
    'hatching_eggs',null::text,'hatching_eggs','hatching_eggs',items.item_name,species.common_name,items.available_date,
    null::integer,items.quantity_available,items.price,(items.price*requested.quantity)::numeric(10,2),
    (items.visibility_status='active' and items.moderation_status='normal' and items.archived_at is null
      and species.is_active=true and requested.quantity<=items.quantity_available
      and requested.quantity>=coalesce(items.minimum_order_quantity,1))
  from pg_temp.card_requested_items requested
  join public.hatching_egg_inventory_items items on items.id=requested.item_id
  join public.species on species.id=items.species_id
  where requested.item_type='hatching_egg_inventory' order by items.id for update of items;

  select count(*) into v_locked_count from pg_temp.card_locked_items;
  if v_locked_count <> v_item_count then raise exception 'One or more inventory items were not found.'; end if;
  if exists(select 1 from pg_temp.card_locked_items where store_id<>p_store_id) then raise exception 'One or more inventory items do not belong to this store.'; end if;
  if exists(select 1 from pg_temp.card_locked_items where not can_checkout) then raise exception 'One or more inventory items are not available for checkout.'; end if;
  if exists(select 1 from pg_temp.card_locked_items where quantity_available<requested_quantity) then raise exception 'Insufficient inventory quantity available.'; end if;
  if exists(select 1 from pg_temp.card_locked_items where item_type='listing_inventory' and
    ((batch_type='hatching_eggs' and inventory_type<>'hatching_eggs') or (batch_type='live_animals' and inventory_type='hatching_eggs')))
  then raise exception 'Invalid inventory type for listing batch type.'; end if;

  select coalesce(sum(line_subtotal),0)::numeric(10,2) into v_subtotal from pg_temp.card_locked_items;
  v_total := (v_subtotal+v_delivery_fee)::numeric(10,2);
  if round(v_total*100)::bigint <> p_amount_total_cents then raise exception 'Stripe Checkout amount does not match current pricing.'; end if;

  select jsonb_agg(jsonb_build_object(
    'item_type',item_type,'item_id',item_id,'quantity',requested_quantity,
    'inventory_item_id',inventory_item_id,'equipment_inventory_item_id',equipment_inventory_item_id,
    'processed_poultry_inventory_item_id',processed_poultry_inventory_item_id,
    'hatching_egg_inventory_item_id',hatching_egg_inventory_item_id,'listing_batch_id',listing_batch_id,
    'listing_batch_breed_id',listing_batch_breed_id,'seller_breed_profile_id',seller_breed_profile_id,
    'species_id',species_id,'species_name',species_name,'species_slug',species_slug,
    'breed_display_name',breed_display_name,'breed_description',breed_description,
    'inventory_type',inventory_type,'custom_inventory_label',custom_inventory_label,'batch_type',batch_type,
    'product_type',product_type,'item_name',item_name,'item_category',item_category,
    'available_date',available_date,'age_at_availability_days',age_at_availability_days,
    'unit_price',unit_price,'line_subtotal',line_subtotal
  ) order by item_type,item_id) into v_item_snapshot from pg_temp.card_locked_items;

  v_order_snapshot := jsonb_build_object(
    'buyer_email',v_email,'buyer_first_name',v_first_name,'buyer_last_name',v_last_name,'buyer_phone',v_phone,
    'delivery_address_line1',nullif(trim(p_delivery_address_line1),''),'delivery_address_line2',nullif(trim(p_delivery_address_line2),''),
    'delivery_city',nullif(trim(p_delivery_city),''),'delivery_state',nullif(trim(p_delivery_state),''),
    'delivery_postal_code',nullif(trim(p_delivery_postal_code),''),'delivery_country',coalesce(nullif(trim(p_delivery_country),''),'US'),
    'buyer_notes',nullif(trim(p_buyer_notes),''),'pickup_note',nullif(trim(p_pickup_note),''),
    'pickup_option_id',v_pickup_option.id,'pickup_option_label',v_pickup_option.label,
    'fulfillment_method',v_fulfillment,'delivery_option_name',v_delivery_option.name,'delivery_fee_amount',v_delivery_fee,
    'subtotal_amount',v_subtotal,'tax_fee_amount',0,'total_amount',v_total,
    'buyer_ip_address',p_buyer_ip_address,'buyer_user_agent',nullif(trim(p_buyer_user_agent),''),
    'store_name',v_store.store_name,'store_slug',v_store.store_slug,'item_count',v_item_count
  );

  insert into public.storefront_card_checkout_reservations(
    id,store_id,stripe_livemode,stripe_account_id,stripe_checkout_session_id,expires_at,
    amount_total_cents,currency,order_snapshot,item_snapshot
  ) values (p_reservation_id,p_store_id,p_stripe_livemode,p_stripe_account_id,p_stripe_checkout_session_id,p_expires_at,
    p_amount_total_cents,v_currency,v_order_snapshot,v_item_snapshot);

  update public.inventory_items inventory set quantity_available=inventory.quantity_available-locked.requested_quantity
  from pg_temp.card_locked_items locked where locked.item_type='listing_inventory' and inventory.id=locked.inventory_item_id;
  update public.equipment_inventory_items inventory set quantity_available=inventory.quantity_available-locked.requested_quantity
  from pg_temp.card_locked_items locked where locked.item_type='equipment_inventory' and inventory.id=locked.equipment_inventory_item_id;
  update public.processed_poultry_inventory_items inventory set quantity_available=inventory.quantity_available-locked.requested_quantity
  from pg_temp.card_locked_items locked where locked.item_type='processed_poultry_inventory' and inventory.id=locked.processed_poultry_inventory_item_id;
  update public.hatching_egg_inventory_items inventory set quantity_available=inventory.quantity_available-locked.requested_quantity
  from pg_temp.card_locked_items locked where locked.item_type='hatching_egg_inventory' and inventory.id=locked.hatching_egg_inventory_item_id;

  return query select p_reservation_id,p_stripe_checkout_session_id,p_expires_at,p_amount_total_cents,v_currency;
end;
$$;

revoke all on function public.reserve_storefront_card_checkout(uuid,uuid,boolean,text,text,timestamptz,bigint,text,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,inet,text,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.reserve_storefront_card_checkout(uuid,uuid,boolean,text,text,timestamptz,bigint,text,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,inet,text,uuid,text,uuid) to service_role;


create function public.settle_storefront_card_checkout(
  p_stripe_checkout_session_id text,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_outcome text,
  p_amount_total_cents bigint,
  p_currency text,
  p_stripe_payment_intent_id text default null,
  p_paid_at timestamptz default null
)
returns table (
  settlement_outcome text,
  order_id uuid,
  order_number text,
  total_amount numeric(10,2),
  currency text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reservation public.storefront_card_checkout_reservations%rowtype;
  v_existing_session public.stripe_checkout_sessions%rowtype;
  v_existing_order public.orders%rowtype;
  v_snapshot jsonb;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_next integer;
  v_created_at timestamptz;
  v_email text;
  v_first text;
  v_last text;
  v_phone text;
begin
  if p_outcome not in ('paid','expired') then raise exception 'Settlement outcome must be paid or expired.'; end if;
  select reservations.* into v_reservation from public.storefront_card_checkout_reservations reservations
  where reservations.stripe_checkout_session_id=p_stripe_checkout_session_id for update;

  if v_reservation.id is null then
    select sessions.* into v_existing_session
    from public.stripe_checkout_sessions sessions
    where sessions.stripe_checkout_session_id=p_stripe_checkout_session_id;
    if v_existing_session.id is not null then
      if v_existing_session.metadata->>'stripe_account_id'<>p_stripe_account_id
        or coalesce((v_existing_session.metadata->>'stripe_livemode')::boolean,false)<>p_stripe_livemode
        or v_existing_session.amount_total_cents<>p_amount_total_cents
        or v_existing_session.currency<>lower(nullif(trim(p_currency),'')) then
        raise exception 'Stripe Checkout settlement does not match the settled order.';
      end if;
      select orders.* into v_existing_order from public.orders orders where orders.id=v_existing_session.order_id;
      return query select 'paid'::text,v_existing_order.id,v_existing_order.order_number,v_existing_order.total_amount,
        lower(v_existing_order.currency_code);
      return;
    elsif p_outcome='expired' then
      return query select 'expired'::text,null::uuid,null::text,null::numeric(10,2),lower(nullif(trim(p_currency),''));
      return;
    end if;
    raise exception 'Stripe Checkout reservation was not found.';
  end if;

  if v_reservation.stripe_account_id<>p_stripe_account_id or v_reservation.stripe_livemode<>p_stripe_livemode
    or v_reservation.amount_total_cents<>p_amount_total_cents or v_reservation.currency<>lower(nullif(trim(p_currency),'')) then
    raise exception 'Stripe Checkout settlement does not match the reservation.';
  end if;

  if p_outcome='expired' then
    update public.inventory_items inventory set quantity_available=inventory.quantity_available+(item->>'quantity')::integer
    from jsonb_array_elements(v_reservation.item_snapshot) item
    where item->>'item_type'='listing_inventory' and inventory.id=(item->>'inventory_item_id')::uuid;
    update public.equipment_inventory_items inventory set quantity_available=inventory.quantity_available+(item->>'quantity')::integer
    from jsonb_array_elements(v_reservation.item_snapshot) item
    where item->>'item_type'='equipment_inventory' and inventory.id=(item->>'equipment_inventory_item_id')::uuid;
    update public.processed_poultry_inventory_items inventory set quantity_available=inventory.quantity_available+(item->>'quantity')::integer
    from jsonb_array_elements(v_reservation.item_snapshot) item
    where item->>'item_type'='processed_poultry_inventory' and inventory.id=(item->>'processed_poultry_inventory_item_id')::uuid;
    update public.hatching_egg_inventory_items inventory set quantity_available=inventory.quantity_available+(item->>'quantity')::integer
    from jsonb_array_elements(v_reservation.item_snapshot) item
    where item->>'item_type'='hatching_egg_inventory' and inventory.id=(item->>'hatching_egg_inventory_item_id')::uuid;
    delete from public.storefront_card_checkout_reservations where id=v_reservation.id;
    return query select 'expired'::text,null::uuid,null::text,null::numeric(10,2),v_reservation.currency;
    return;
  end if;

  if nullif(trim(p_stripe_payment_intent_id),'') is null then raise exception 'Paid settlement requires a Stripe PaymentIntent.'; end if;
  v_snapshot:=v_reservation.order_snapshot;
  v_email:=v_snapshot->>'buyer_email'; v_first:=v_snapshot->>'buyer_first_name';
  v_last:=v_snapshot->>'buyer_last_name'; v_phone:=v_snapshot->>'buyer_phone';

  perform pg_advisory_xact_lock(hashtextextended(v_reservation.store_id::text||':'||v_email,0));
  v_customer_id:=public.resolve_order_customer_match(v_reservation.store_id,v_first,v_last,v_email,v_phone);
  if v_customer_id is null then
    insert into public.customers(store_id,email,first_name,last_name,phone,city,state,country,
      delivery_address_line1,delivery_address_line2,delivery_city,delivery_state,delivery_postal_code,delivery_country)
    values(v_reservation.store_id,v_email,v_first,v_last,v_phone,v_snapshot->>'delivery_city',v_snapshot->>'delivery_state',
      coalesce(v_snapshot->>'delivery_country','US'),v_snapshot->>'delivery_address_line1',v_snapshot->>'delivery_address_line2',
      v_snapshot->>'delivery_city',v_snapshot->>'delivery_state',v_snapshot->>'delivery_postal_code',coalesce(v_snapshot->>'delivery_country','US'))
    returning id into v_customer_id;
  else
    update public.customers set first_name=v_first,last_name=v_last,phone=v_phone,
      delivery_address_line1=v_snapshot->>'delivery_address_line1',delivery_address_line2=v_snapshot->>'delivery_address_line2',
      delivery_city=v_snapshot->>'delivery_city',delivery_state=v_snapshot->>'delivery_state',
      delivery_postal_code=v_snapshot->>'delivery_postal_code',delivery_country=coalesce(v_snapshot->>'delivery_country','US')
    where id=v_customer_id;
  end if;

  insert into public.order_number_counters(store_id) values(v_reservation.store_id)
  on conflict on constraint order_number_counters_pkey do nothing;
  update public.order_number_counters set last_order_number=last_order_number+1 where store_id=v_reservation.store_id
  returning last_order_number into v_next;
  v_order_number:=v_next::text;

  insert into public.orders(store_id,customer_id,order_number,order_source,order_status,payment_method,payment_status,
    payment_provider,provider_payment_status,payment_provider_status_updated_at,paid_at,
    buyer_email_snapshot,buyer_first_name_snapshot,buyer_last_name_snapshot,buyer_phone_snapshot,
    buyer_address_line1_snapshot,buyer_address_line2_snapshot,buyer_city_snapshot,buyer_state_snapshot,
    buyer_postal_code_snapshot,buyer_country_snapshot,buyer_notes,pickup_note,pickup_option_id,pickup_option_label_snapshot,
    fulfillment_method,delivery_option_name_snapshot,delivery_fee_amount,subtotal_amount,tax_fee_amount,total_amount,
    currency_code,buyer_ip_address,buyer_user_agent)
  values(v_reservation.store_id,v_customer_id,v_order_number,'storefront','open','stripe_checkout','paid',
    'stripe','paid',now(),coalesce(p_paid_at,now()),v_email,v_first,v_last,v_phone,
    v_snapshot->>'delivery_address_line1',v_snapshot->>'delivery_address_line2',v_snapshot->>'delivery_city',v_snapshot->>'delivery_state',
    v_snapshot->>'delivery_postal_code',v_snapshot->>'delivery_country',v_snapshot->>'buyer_notes',v_snapshot->>'pickup_note',
    nullif(v_snapshot->>'pickup_option_id','')::uuid,v_snapshot->>'pickup_option_label',v_snapshot->>'fulfillment_method',
    v_snapshot->>'delivery_option_name',coalesce((v_snapshot->>'delivery_fee_amount')::numeric,0),
    (v_snapshot->>'subtotal_amount')::numeric,coalesce((v_snapshot->>'tax_fee_amount')::numeric,0),
    (v_snapshot->>'total_amount')::numeric,upper(v_reservation.currency),nullif(v_snapshot->>'buyer_ip_address','')::inet,
    v_snapshot->>'buyer_user_agent') returning id,created_at into v_order_id,v_created_at;

  insert into public.order_items(order_id,store_id,order_item_source,inventory_item_id,equipment_inventory_item_id,
    processed_poultry_inventory_item_id,hatching_egg_inventory_item_id,listing_batch_id,listing_batch_breed_id,
    seller_breed_profile_id,species_id,species_name_snapshot,species_slug_snapshot,breed_display_name_snapshot,
    breed_description_snapshot,inventory_type_snapshot,custom_inventory_label_snapshot,batch_type_snapshot,
    product_type_snapshot,item_name_snapshot,item_category_snapshot,available_date_snapshot,
    age_at_availability_days_snapshot,unit_price_snapshot,quantity,line_subtotal)
  select v_order_id,v_reservation.store_id,item->>'item_type',nullif(item->>'inventory_item_id','')::uuid,
    nullif(item->>'equipment_inventory_item_id','')::uuid,nullif(item->>'processed_poultry_inventory_item_id','')::uuid,
    nullif(item->>'hatching_egg_inventory_item_id','')::uuid,nullif(item->>'listing_batch_id','')::uuid,
    nullif(item->>'listing_batch_breed_id','')::uuid,nullif(item->>'seller_breed_profile_id','')::uuid,
    nullif(item->>'species_id','')::uuid,item->>'species_name',item->>'species_slug',item->>'breed_display_name',
    item->>'breed_description',item->>'inventory_type',item->>'custom_inventory_label',item->>'batch_type',
    item->>'product_type',item->>'item_name',item->>'item_category',nullif(item->>'available_date','')::date,
    nullif(item->>'age_at_availability_days','')::integer,(item->>'unit_price')::numeric,
    (item->>'quantity')::integer,(item->>'line_subtotal')::numeric
  from jsonb_array_elements(v_reservation.item_snapshot) item;

  insert into public.stripe_checkout_sessions(store_id,order_id,stripe_checkout_session_id,stripe_payment_intent_id,
    checkout_session_status,payment_status,amount_total_cents,currency,expires_at,metadata)
  values(v_reservation.store_id,v_order_id,v_reservation.stripe_checkout_session_id,p_stripe_payment_intent_id,
    'complete','paid',v_reservation.amount_total_cents,v_reservation.currency,v_reservation.expires_at,
    jsonb_build_object('stripe_account_id',v_reservation.stripe_account_id,'stripe_livemode',v_reservation.stripe_livemode,
      'reservation_id',v_reservation.id,'schema_version','ff_connect_checkout_v1'));

  perform public.enqueue_email_notification(v_reservation.store_id,v_order_id,'buyer_order_received','buyer',v_email,
    'Order received: '||v_order_number,jsonb_build_object('order_id',v_order_id,'order_number',v_order_number,
      'store_id',v_reservation.store_id,'store_name',v_snapshot->>'store_name','store_slug',v_snapshot->>'store_slug',
      'buyer_first_name',v_first,'buyer_last_name',v_last,'buyer_email',v_email,'order_status','open','payment_status','paid',
      'total_amount',(v_snapshot->>'total_amount')::numeric,'created_at',v_created_at,'pickup_note',v_snapshot->>'pickup_note',
      'pickup_option_label',v_snapshot->>'pickup_option_label','buyer_notes',v_snapshot->>'buyer_notes'));
  perform public.enqueue_email_notification(v_reservation.store_id,v_order_id,'seller_new_order_received','seller',null,
    'New FlockFront order: '||v_order_number,jsonb_build_object('order_id',v_order_id,'order_number',v_order_number,
      'store_id',v_reservation.store_id,'store_name',v_snapshot->>'store_name','store_slug',v_snapshot->>'store_slug',
      'buyer_first_name',v_first,'buyer_last_name',v_last,'buyer_email',v_email,'buyer_phone',v_phone,'order_status','open',
      'payment_status','paid','total_amount',(v_snapshot->>'total_amount')::numeric,'created_at',v_created_at,
      'pickup_option_label',v_snapshot->>'pickup_option_label','item_count',(v_snapshot->>'item_count')::integer));

  delete from public.storefront_card_checkout_reservations where id=v_reservation.id;
  return query select 'paid'::text,v_order_id,v_order_number,(v_snapshot->>'total_amount')::numeric(10,2),v_reservation.currency;
end;
$$;

revoke all on function public.settle_storefront_card_checkout(text,text,boolean,text,bigint,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.settle_storefront_card_checkout(text,text,boolean,text,bigint,text,text,timestamptz) to service_role;
