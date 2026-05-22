-- Group 11: Trusted Order Creation and Inventory Reservation Foundation
-- Objects:
-- - orders audit columns
-- - customers normalized email lookup index
-- - order_number_counters
-- - order_idempotency_keys
-- - create_pay_at_pickup_order(...)
--
-- Scope:
-- - Creates trusted pay-at-pickup order creation RPC.
-- - Reuses or creates customers by normalized store/email.
-- - Generates numeric-only store-scoped order numbers.
-- - Validates storefront, inventory, listing, breed, and species eligibility.
-- - Locks and decrements inventory atomically.
-- - Inserts trusted historical order and order item snapshots.
-- - Prevents duplicate submissions with required idempotency keys.
-- - Does not create Stripe integration, temporary holds, email notifications,
--   pickup option tables, storefront UI, or order cancellation/restock logic.

alter table public.orders
add column buyer_ip_address inet;

alter table public.orders
add column buyer_user_agent text;

alter table public.orders
add constraint orders_buyer_user_agent_not_empty_check check (
  buyer_user_agent is null
  or length(trim(buyer_user_agent)) > 0
);

comment on column public.orders.buyer_ip_address is
'Optional buyer IP address captured by trusted order creation for audit, support, troubleshooting, and abuse review. Do not expose publicly.';

comment on column public.orders.buyer_user_agent is
'Optional buyer user agent captured by trusted order creation for audit, support, troubleshooting, and abuse review. Do not expose publicly.';


create index customers_store_normalized_email_idx
on public.customers(store_id, lower(trim(email)));


create table public.order_number_counters (
  store_id uuid primary key references public.stores(id) on delete cascade,
  last_order_number integer not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint order_number_counters_last_order_number_nonnegative_check check (
    last_order_number >= 0
  )
);

comment on table public.order_number_counters is
'Store-scoped order number counter used by trusted order creation. Generates numeric-only order numbers from a per-store sequence.';

comment on column public.order_number_counters.store_id is
'Store whose order number sequence is tracked by this row.';

comment on column public.order_number_counters.last_order_number is
'Last numeric order number issued for this store. New stores start at 1001 because the default stored value is 1000 before increment.';


create table public.order_idempotency_keys (
  store_id uuid not null references public.stores(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  order_id uuid references public.orders(id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (store_id, idempotency_key),

  constraint order_idempotency_keys_key_not_empty_check check (
    length(trim(idempotency_key)) > 0
  ),

  constraint order_idempotency_keys_key_length_check check (
    length(idempotency_key) <= 200
  ),

  constraint order_idempotency_keys_request_hash_not_empty_check check (
    length(trim(request_hash)) > 0
  )
);

comment on table public.order_idempotency_keys is
'Idempotency records for trusted order creation. Prevents duplicate order submissions and duplicate inventory decrements for retried checkout requests.';

comment on column public.order_idempotency_keys.store_id is
'Store scope for the idempotency key.';

comment on column public.order_idempotency_keys.idempotency_key is
'Client-provided unique key for a checkout attempt. Required by trusted order creation and unique per store.';

comment on column public.order_idempotency_keys.request_hash is
'Hash of stable order-affecting request inputs. Buyer IP address and user agent are intentionally excluded.';

comment on column public.order_idempotency_keys.order_id is
'Order created for this idempotency key once trusted order creation completes.';


create index order_idempotency_keys_order_id_idx
on public.order_idempotency_keys(order_id);


create trigger order_number_counters_set_updated_at
before update on public.order_number_counters
for each row
execute function public.set_updated_at();


alter table public.order_number_counters enable row level security;
alter table public.order_idempotency_keys enable row level security;


create policy "Platform admins can read order number counters"
on public.order_number_counters
for select
to authenticated
using (
  public.is_admin()
);


create policy "Platform admins can delete order number counters"
on public.order_number_counters
for delete
to authenticated
using (
  public.is_admin()
);


create policy "Platform admins can read order idempotency keys"
on public.order_idempotency_keys
for select
to authenticated
using (
  public.is_admin()
);


create policy "Platform admins can delete order idempotency keys"
on public.order_idempotency_keys
for delete
to authenticated
using (
  public.is_admin()
);


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
  p_buyer_user_agent text default null
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
set search_path = public
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

  v_request_hash text;
  v_existing_idempotency public.order_idempotency_keys%rowtype;

  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
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
    from pg_temp.requested_order_items
    where inventory_item_id is null
       or quantity <= 0
  ) then
    raise exception 'Each order item must include a valid inventory item ID and positive quantity.';
  end if;

  select count(*)
  into v_requested_item_count
  from pg_temp.requested_order_items;

  if v_requested_item_count = 0 then
    raise exception 'At least one valid order item is required.';
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
        'items', (
          select jsonb_agg(
            jsonb_build_object(
              'inventory_item_id', requested_order_items.inventory_item_id,
              'quantity', requested_order_items.quantity
            )
            order by requested_order_items.inventory_item_id
          )
          from pg_temp.requested_order_items
        )
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
  on conflict (store_id, idempotency_key) do nothing;

  select *
  into v_existing_idempotency
  from public.order_idempotency_keys
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
      orders.subtotal_amount,
      orders.tax_fee_amount,
      orders.total_amount,
      orders.created_at
    from public.orders
    where orders.id = v_existing_idempotency.order_id;

    return;
  end if;

  if not exists (
    select 1
    from public.stores
    where stores.id = p_store_id
      and stores.store_status = 'live'
      and stores.storefront_mode in ('hosted', 'embedded')
      and stores.admin_hold_reason is null
  ) then
    raise exception 'Store is not available for checkout.';
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
    select *
    from pg_temp.requested_order_items
    order by inventory_item_id
  ) as requested_order_items
  join public.inventory_items
    on inventory_items.id = requested_order_items.inventory_item_id
  join public.listing_batches
    on listing_batches.id = inventory_items.listing_batch_id
  join public.listing_batch_breeds
    on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
  join public.seller_breed_profiles
    on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
  join public.species
    on species.id = listing_batches.species_id
  where inventory_items.id in (
    select requested_order_items.inventory_item_id
    from pg_temp.requested_order_items
    order by requested_order_items.inventory_item_id
  )
  for update of inventory_items;

  select count(*)
  into v_locked_item_count
  from pg_temp.locked_order_items;

  if v_locked_item_count <> v_requested_item_count then
    raise exception 'One or more inventory items were not found.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items
    where store_id <> p_store_id
  ) then
    raise exception 'One or more inventory items do not belong to this store.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items
    join public.inventory_items
      on inventory_items.id = locked_order_items.inventory_item_id
    join public.listing_batches
      on listing_batches.id = locked_order_items.listing_batch_id
    join public.listing_batch_breeds
      on listing_batch_breeds.id = locked_order_items.listing_batch_breed_id
    join public.seller_breed_profiles
      on seller_breed_profiles.id = locked_order_items.seller_breed_profile_id
    join public.species
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
    from pg_temp.locked_order_items
    join public.inventory_items
      on inventory_items.id = locked_order_items.inventory_item_id
    join public.listing_batches
      on listing_batches.id = locked_order_items.listing_batch_id
    join public.listing_batch_breeds
      on listing_batch_breeds.id = locked_order_items.listing_batch_breed_id
    join public.seller_breed_profiles
      on seller_breed_profiles.id = locked_order_items.seller_breed_profile_id
    join public.species
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
    from pg_temp.locked_order_items
    where quantity_available < requested_quantity
  ) then
    raise exception 'Insufficient inventory quantity available.';
  end if;

  if exists (
    select 1
    from pg_temp.locked_order_items
    where (
      batch_type = 'hatching_eggs'
      and inventory_type <> 'hatching_eggs'
    )
    or (
      batch_type = 'live_animals'
      and inventory_type = 'hatching_eggs'
    )
  ) then
    raise exception 'Invalid inventory type for listing batch type.';
  end if;

  select coalesce(sum(line_subtotal), 0)::numeric(10, 2)
  into v_subtotal_amount
  from pg_temp.locked_order_items;

  v_total_amount := v_subtotal_amount + v_tax_fee_amount;

  perform pg_advisory_xact_lock(
    hashtextextended(p_store_id::text || ':' || v_buyer_email, 0)
  );

  select customers.id
  into v_customer_id
  from public.customers
  where customers.store_id = p_store_id
    and lower(trim(customers.email)) = v_buyer_email
  order by customers.created_at, customers.id
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
    returning id into v_customer_id;
  end if;

  insert into public.order_number_counters (
    store_id
  )
  values (
    p_store_id
  )
  on conflict (store_id) do nothing;

  update public.order_number_counters
  set last_order_number = last_order_number + 1
  where order_number_counters.store_id = p_store_id
  returning last_order_number into v_next_order_number;

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
    buyer_notes,
    pickup_note,
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
    v_buyer_notes,
    v_pickup_note,
    v_subtotal_amount,
    null,
    null,
    v_tax_fee_amount,
    v_total_amount,
    p_buyer_ip_address,
    v_buyer_user_agent
  )
  returning id into v_order_id;

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
  from pg_temp.locked_order_items
  order by locked_order_items.inventory_item_id;

  update public.inventory_items
  set quantity_available = inventory_items.quantity_available - locked_order_items.requested_quantity
  from pg_temp.locked_order_items
  where inventory_items.id = locked_order_items.inventory_item_id;

  update public.order_idempotency_keys
  set order_id = v_order_id
  where order_idempotency_keys.store_id = p_store_id
    and order_idempotency_keys.idempotency_key = v_idempotency_key;

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
  from public.orders
  where orders.id = v_order_id;
end;
$$;


comment on function public.create_pay_at_pickup_order(
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  inet,
  text
) is
'Trusted pay-at-pickup storefront order creation RPC. Validates storefront and inventory eligibility, reuses or creates a customer by normalized email, generates a numeric store-scoped order number, inserts trusted order snapshots, decrements inventory atomically, and protects retries with idempotency keys.';


revoke all on function public.create_pay_at_pickup_order(
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  inet,
  text
) from public;

grant execute on function public.create_pay_at_pickup_order(
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  inet,
  text
) to anon, authenticated;
