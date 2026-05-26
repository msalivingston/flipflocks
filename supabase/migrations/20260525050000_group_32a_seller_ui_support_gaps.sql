-- Group 32A: Seller UI Support Gaps
--
-- Scope:
-- - Adds seller-defined pickup option/dropdown support.
-- - Adds narrow seller-safe customer detail/update support.
-- - Adds a safe listing duplication RPC.
-- - Adds small seller defaults support needed by seller UI planning.
--
-- This group does not add:
-- - React/UI code
-- - Stripe behavior
-- - media upload/storage behavior
-- - Equipment & Supplies backend
-- - arbitrary scheduled pickup dates
-- - broad settings infrastructure


create table public.store_pickup_options (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,

  label text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint store_pickup_options_label_not_empty_check check (
    length(trim(label)) > 0
  ),

  constraint store_pickup_options_description_not_empty_check check (
    description is null
    or length(trim(description)) > 0
  ),

  constraint store_pickup_options_sort_order_nonnegative_check check (
    sort_order >= 0
  )
);

comment on table public.store_pickup_options is
'Seller-defined pickup choices buyers may select during checkout. These are labels/dropdown choices, not scheduled appointment dates or capacity-managed slots.';

comment on column public.store_pickup_options.label is
'Seller-facing and buyer-facing pickup choice label, such as Thursday afternoon pickup, farm pickup, or Saturday by appointment.';

comment on column public.store_pickup_options.description is
'Optional additional seller-defined pickup guidance for this option.';

comment on column public.store_pickup_options.is_active is
'Inactive pickup options are hidden from new checkout choices but historical order snapshots keep their selected label.';

create index store_pickup_options_store_active_sort_idx
on public.store_pickup_options(store_id, is_active, sort_order, label);

create index store_pickup_options_store_sort_idx
on public.store_pickup_options(store_id, sort_order, label);

create trigger store_pickup_options_set_updated_at
before update on public.store_pickup_options
for each row
execute function public.set_updated_at();


alter table public.store_pickup_options enable row level security;

create policy "Store owners can read own pickup options"
on public.store_pickup_options
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);

create policy "Store owners can insert own pickup options"
on public.store_pickup_options
for insert
to authenticated
with check (
  public.owns_store(store_id)
  or public.is_admin()
);

create policy "Store owners can update own pickup options"
on public.store_pickup_options
for update
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
)
with check (
  public.owns_store(store_id)
  or public.is_admin()
);

create policy "Platform admins can delete pickup options"
on public.store_pickup_options
for delete
to authenticated
using (
  public.is_admin()
);


alter table public.orders
add column pickup_option_id uuid references public.store_pickup_options(id) on delete set null,
add column pickup_option_label_snapshot text;

alter table public.orders
add constraint orders_pickup_option_label_snapshot_not_empty_check check (
  pickup_option_label_snapshot is null
  or length(trim(pickup_option_label_snapshot)) > 0
);

comment on column public.orders.pickup_option_id is
'Optional selected seller-defined pickup option. The value may be null if the option is later deleted; pickup_option_label_snapshot preserves historical display.';

comment on column public.orders.pickup_option_label_snapshot is
'Historical snapshot of the selected pickup option label at the time it was selected. This prevents later option edits from changing existing order meaning.';

create index orders_store_pickup_option_status_idx
on public.orders(store_id, order_status, pickup_option_label_snapshot)
where pickup_option_label_snapshot is not null;


alter table public.stores
add column pickup_location_text text,
add column communication_email text,
add column default_pickup_option_id uuid references public.store_pickup_options(id) on delete set null,
add column currency text not null default 'usd';

alter table public.stores
add constraint stores_pickup_location_text_not_empty_check check (
  pickup_location_text is null
  or length(trim(pickup_location_text)) > 0
);

alter table public.stores
add constraint stores_communication_email_not_empty_check check (
  communication_email is null
  or length(trim(communication_email)) > 0
);

alter table public.stores
add constraint stores_currency_format_check check (
  currency ~ '^[a-z]{3}$'
);

comment on column public.stores.pickup_location_text is
'Seller default pickup location/general area text used to prefill seller workflows. This is not an appointment date.';

comment on column public.stores.communication_email is
'Seller default communication email used by seller workflows when distinct from public storefront email or order notification email.';

comment on column public.stores.default_pickup_option_id is
'Optional default seller-defined pickup option used to prefill seller workflows.';

comment on column public.stores.currency is
'Default ISO currency code for seller workflows. Stored lowercase, for example usd.';


create or replace view public.seller_store_defaults
with (security_barrier = true)
as
select
  stores.id as store_id,
  stores.pickup_instructions,
  stores.pickup_location_text,
  stores.default_pickup_option_id,
  store_pickup_options.label as default_pickup_option_label,
  stores.communication_email,
  stores.order_notification_email,
  stores.currency,
  stores.updated_at
from public.stores
left join public.store_pickup_options
  on store_pickup_options.id = stores.default_pickup_option_id
 and store_pickup_options.store_id = stores.id
where public.owns_store(stores.id)
   or public.is_admin();

comment on view public.seller_store_defaults is
'Seller-private defaults used to prefill seller workflows. This is intentionally narrow and avoids broad settings infrastructure.';

revoke all on public.seller_store_defaults from public;
grant select on public.seller_store_defaults to authenticated;


create or replace function public.seller_create_pickup_option(
  p_store_id uuid,
  p_label text,
  p_description text default null,
  p_sort_order integer default 0,
  p_is_active boolean default true
)
returns public.store_pickup_options
language plpgsql
security definer
set search_path = public
as $$
declare
  v_option public.store_pickup_options%rowtype;
begin
  if not (
    public.owns_store(p_store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to create pickup options for this store.';
  end if;

  if nullif(trim(p_label), '') is null then
    raise exception 'Pickup option label is required.';
  end if;

  if coalesce(p_sort_order, 0) < 0 then
    raise exception 'Sort order must be nonnegative.';
  end if;

  insert into public.store_pickup_options (
    store_id,
    label,
    description,
    sort_order,
    is_active
  )
  values (
    p_store_id,
    trim(p_label),
    nullif(trim(p_description), ''),
    coalesce(p_sort_order, 0),
    coalesce(p_is_active, true)
  )
  returning * into v_option;

  return v_option;
end;
$$;


create or replace function public.seller_update_pickup_option(
  p_pickup_option_id uuid,
  p_label text,
  p_description text default null,
  p_sort_order integer default 0,
  p_is_active boolean default true
)
returns public.store_pickup_options
language plpgsql
security definer
set search_path = public
as $$
declare
  v_option public.store_pickup_options%rowtype;
  v_updated_option public.store_pickup_options%rowtype;
begin
  select *
  into v_option
  from public.store_pickup_options
  where store_pickup_options.id = p_pickup_option_id
  for update;

  if v_option.id is null then
    raise exception 'Pickup option not found.';
  end if;

  if not (
    public.owns_store(v_option.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to update this pickup option.';
  end if;

  if nullif(trim(p_label), '') is null then
    raise exception 'Pickup option label is required.';
  end if;

  if coalesce(p_sort_order, 0) < 0 then
    raise exception 'Sort order must be nonnegative.';
  end if;

  update public.store_pickup_options
  set
    label = trim(p_label),
    description = nullif(trim(p_description), ''),
    sort_order = coalesce(p_sort_order, 0),
    is_active = coalesce(p_is_active, true)
  where store_pickup_options.id = v_option.id
  returning * into v_updated_option;

  return v_updated_option;
end;
$$;


create or replace function public.seller_set_pickup_option_active(
  p_pickup_option_id uuid,
  p_is_active boolean
)
returns public.store_pickup_options
language plpgsql
security definer
set search_path = public
as $$
declare
  v_option public.store_pickup_options%rowtype;
  v_updated_option public.store_pickup_options%rowtype;
begin
  select *
  into v_option
  from public.store_pickup_options
  where store_pickup_options.id = p_pickup_option_id
  for update;

  if v_option.id is null then
    raise exception 'Pickup option not found.';
  end if;

  if not (
    public.owns_store(v_option.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to update this pickup option.';
  end if;

  update public.store_pickup_options
  set is_active = coalesce(p_is_active, false)
  where store_pickup_options.id = v_option.id
  returning * into v_updated_option;

  return v_updated_option;
end;
$$;


create or replace function public.seller_set_order_pickup_option(
  p_order_id uuid,
  p_pickup_option_id uuid
)
returns table (
  order_id uuid,
  order_number text,
  store_id uuid,
  order_status text,
  pickup_option_id uuid,
  pickup_option_label_snapshot text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_option public.store_pickup_options%rowtype;
begin
  select *
  into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'Order not found.';
  end if;

  if not (
    public.owns_store(v_order.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to update this order.';
  end if;

  if v_order.order_status not in ('pending', 'open') then
    raise exception 'Pickup option can only be changed for open orders.';
  end if;

  if p_pickup_option_id is null then
    update public.orders
    set
      pickup_option_id = null,
      pickup_option_label_snapshot = null
    where orders.id = v_order.id;
  else
    select *
    into v_option
    from public.store_pickup_options
    where store_pickup_options.id = p_pickup_option_id
      and store_pickup_options.store_id = v_order.store_id
      and store_pickup_options.is_active = true;

    if v_option.id is null then
      raise exception 'Pickup option is not available for this order.';
    end if;

    update public.orders
    set
      pickup_option_id = v_option.id,
      pickup_option_label_snapshot = v_option.label
    where orders.id = v_order.id;
  end if;

  return query
  select
    orders.id,
    orders.order_number,
    orders.store_id,
    orders.order_status,
    orders.pickup_option_id,
    orders.pickup_option_label_snapshot,
    orders.updated_at
  from public.orders
  where orders.id = v_order.id;
end;
$$;


create or replace function public.seller_update_store_defaults(
  p_store_id uuid,
  p_defaults jsonb
)
returns setof public.seller_store_defaults
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed_keys text[] := array[
    'pickup_instructions',
    'pickup_location_text',
    'default_pickup_option_id',
    'communication_email',
    'order_notification_email',
    'currency'
  ];
  v_unknown_keys text;
  v_default_pickup_option_id uuid;
  v_currency text;
begin
  if not (
    public.owns_store(p_store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to update defaults for this store.';
  end if;

  if p_defaults is null
    or jsonb_typeof(p_defaults) <> 'object' then
    raise exception 'Defaults must be provided as an object.';
  end if;

  select string_agg(key, ', ' order by key)
  into v_unknown_keys
  from jsonb_object_keys(p_defaults) as key
  where key <> all (v_allowed_keys);

  if v_unknown_keys is not null then
    raise exception 'Unsupported store default fields: %', v_unknown_keys;
  end if;

  if p_defaults ? 'default_pickup_option_id'
    and nullif(trim(p_defaults ->> 'default_pickup_option_id'), '') is not null then
    v_default_pickup_option_id := (p_defaults ->> 'default_pickup_option_id')::uuid;

    if not exists (
      select 1
      from public.store_pickup_options
      where store_pickup_options.id = v_default_pickup_option_id
        and store_pickup_options.store_id = p_store_id
        and store_pickup_options.is_active = true
    ) then
      raise exception 'Default pickup option is not available for this store.';
    end if;
  end if;

  if p_defaults ? 'currency' then
    v_currency := lower(nullif(trim(p_defaults ->> 'currency'), ''));

    if v_currency is null
      or v_currency !~ '^[a-z]{3}$' then
      raise exception 'Currency must be a three-letter ISO code.';
    end if;
  end if;

  update public.stores
  set
    pickup_instructions = case
      when p_defaults ? 'pickup_instructions' then nullif(trim(p_defaults ->> 'pickup_instructions'), '')
      else stores.pickup_instructions
    end,
    pickup_location_text = case
      when p_defaults ? 'pickup_location_text' then nullif(trim(p_defaults ->> 'pickup_location_text'), '')
      else stores.pickup_location_text
    end,
    default_pickup_option_id = case
      when p_defaults ? 'default_pickup_option_id' then v_default_pickup_option_id
      else stores.default_pickup_option_id
    end,
    communication_email = case
      when p_defaults ? 'communication_email' then lower(nullif(trim(p_defaults ->> 'communication_email'), ''))
      else stores.communication_email
    end,
    order_notification_email = case
      when p_defaults ? 'order_notification_email' then lower(nullif(trim(p_defaults ->> 'order_notification_email'), ''))
      else stores.order_notification_email
    end,
    currency = case
      when p_defaults ? 'currency' then v_currency
      else stores.currency
    end
  where stores.id = p_store_id;

  return query
  select *
  from public.seller_store_defaults
  where seller_store_defaults.store_id = p_store_id;
end;
$$;


create or replace view public.seller_customer_detail
with (security_barrier = true)
as
with customer_order_summary as (
  select
    orders.store_id,
    orders.customer_id,
    count(*) as order_count,
    max(orders.created_at) as latest_order_created_at,
    count(*) filter (where orders.order_status in ('pending', 'open')) as open_order_count,
    coalesce(sum(orders.total_amount), 0)::numeric(10, 2) as lifetime_order_total
  from public.orders
  group by orders.store_id, orders.customer_id
)
select
  customers.store_id,
  customers.id as customer_id,
  customers.email,
  customers.first_name,
  customers.last_name,
  customers.phone,
  customers.business_name,
  customers.city,
  customers.state,
  customers.country,
  customers.delivery_address_line1,
  customers.delivery_address_line2,
  customers.delivery_city,
  customers.delivery_state,
  customers.delivery_postal_code,
  customers.delivery_country,
  customers.internal_notes,
  customers.created_at,
  customers.updated_at,
  coalesce(customer_order_summary.order_count, 0) as order_count,
  coalesce(customer_order_summary.open_order_count, 0) as open_order_count,
  coalesce(customer_order_summary.lifetime_order_total, 0)::numeric(10, 2) as lifetime_order_total,
  customer_order_summary.latest_order_created_at
from public.customers
left join customer_order_summary
  on customer_order_summary.store_id = customers.store_id
 and customer_order_summary.customer_id = customers.id
where public.owns_store(customers.store_id)
   or public.is_admin();

comment on view public.seller_customer_detail is
'Seller-private customer detail projection for the limited customer edit scope: name, phone, email, address, and notes.';

revoke all on public.seller_customer_detail from public;
grant select on public.seller_customer_detail to authenticated;


create or replace function public.seller_update_customer(
  p_customer_id uuid,
  p_updates jsonb
)
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
  v_updated_customer public.customers%rowtype;
  v_allowed_keys text[] := array[
    'first_name',
    'last_name',
    'email',
    'phone',
    'city',
    'state',
    'country',
    'delivery_address_line1',
    'delivery_address_line2',
    'delivery_city',
    'delivery_state',
    'delivery_postal_code',
    'delivery_country',
    'internal_notes'
  ];
  v_unknown_keys text;
  v_first_name text;
  v_last_name text;
  v_email text;
begin
  if p_updates is null
    or jsonb_typeof(p_updates) <> 'object' then
    raise exception 'Customer updates must be provided as an object.';
  end if;

  select *
  into v_customer
  from public.customers
  where customers.id = p_customer_id
  for update;

  if v_customer.id is null then
    raise exception 'Customer not found.';
  end if;

  if not (
    public.owns_store(v_customer.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to update this customer.';
  end if;

  select string_agg(key, ', ' order by key)
  into v_unknown_keys
  from jsonb_object_keys(p_updates) as key
  where key <> all (v_allowed_keys);

  if v_unknown_keys is not null then
    raise exception 'Unsupported customer fields: %', v_unknown_keys;
  end if;

  if p_updates ? 'first_name' then
    v_first_name := nullif(trim(p_updates ->> 'first_name'), '');

    if v_first_name is null then
      raise exception 'Customer first name is required.';
    end if;
  end if;

  if p_updates ? 'last_name' then
    v_last_name := nullif(trim(p_updates ->> 'last_name'), '');

    if v_last_name is null then
      raise exception 'Customer last name is required.';
    end if;
  end if;

  if p_updates ? 'email' then
    v_email := lower(nullif(trim(p_updates ->> 'email'), ''));

    if v_email is null then
      raise exception 'Customer email is required.';
    end if;
  end if;

  update public.customers
  set
    first_name = case
      when p_updates ? 'first_name' then v_first_name
      else customers.first_name
    end,
    last_name = case
      when p_updates ? 'last_name' then v_last_name
      else customers.last_name
    end,
    email = case
      when p_updates ? 'email' then v_email
      else customers.email
    end,
    phone = case
      when p_updates ? 'phone' then nullif(trim(p_updates ->> 'phone'), '')
      else customers.phone
    end,
    city = case
      when p_updates ? 'city' then nullif(trim(p_updates ->> 'city'), '')
      else customers.city
    end,
    state = case
      when p_updates ? 'state' then nullif(trim(p_updates ->> 'state'), '')
      else customers.state
    end,
    country = case
      when p_updates ? 'country' then nullif(trim(p_updates ->> 'country'), '')
      else customers.country
    end,
    delivery_address_line1 = case
      when p_updates ? 'delivery_address_line1' then nullif(trim(p_updates ->> 'delivery_address_line1'), '')
      else customers.delivery_address_line1
    end,
    delivery_address_line2 = case
      when p_updates ? 'delivery_address_line2' then nullif(trim(p_updates ->> 'delivery_address_line2'), '')
      else customers.delivery_address_line2
    end,
    delivery_city = case
      when p_updates ? 'delivery_city' then nullif(trim(p_updates ->> 'delivery_city'), '')
      else customers.delivery_city
    end,
    delivery_state = case
      when p_updates ? 'delivery_state' then nullif(trim(p_updates ->> 'delivery_state'), '')
      else customers.delivery_state
    end,
    delivery_postal_code = case
      when p_updates ? 'delivery_postal_code' then nullif(trim(p_updates ->> 'delivery_postal_code'), '')
      else customers.delivery_postal_code
    end,
    delivery_country = case
      when p_updates ? 'delivery_country' then nullif(trim(p_updates ->> 'delivery_country'), '')
      else customers.delivery_country
    end,
    internal_notes = case
      when p_updates ? 'internal_notes' then nullif(trim(p_updates ->> 'internal_notes'), '')
      else customers.internal_notes
    end
  where customers.id = v_customer.id
  returning * into v_updated_customer;

  return v_updated_customer;
end;
$$;


create or replace function public.seller_duplicate_listing(
  p_listing_batch_id uuid,
  p_origin_date date,
  p_available_date date,
  p_visibility_status text default 'hidden',
  p_internal_batch_label text default null
)
returns table (
  source_listing_batch_id uuid,
  duplicated_listing_batch_id uuid,
  store_id uuid,
  visibility_status text,
  duplicated_breed_row_count integer,
  duplicated_inventory_row_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_batch public.listing_batches%rowtype;
  v_new_batch public.listing_batches%rowtype;
  v_source_breed public.listing_batch_breeds%rowtype;
  v_new_breed public.listing_batch_breeds%rowtype;
  v_source_item public.inventory_items%rowtype;
  v_breed_count integer := 0;
  v_item_count integer := 0;
begin
  select *
  into v_source_batch
  from public.listing_batches
  where listing_batches.id = p_listing_batch_id;

  if v_source_batch.id is null then
    raise exception 'Listing not found.';
  end if;

  if not (
    public.owns_store(v_source_batch.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to duplicate this listing.';
  end if;

  if p_visibility_status is null
    or p_visibility_status not in ('active', 'hidden') then
    raise exception 'Duplicate listing visibility must be active or hidden.';
  end if;

  if p_available_date is null then
    raise exception 'New available date is required.';
  end if;

  if v_source_batch.batch_type = 'live_animals'
    and p_origin_date is null then
    raise exception 'New origin date is required for live animal listings.';
  end if;

  v_new_batch := public.seller_create_listing_batch(
    v_source_batch.store_id,
    v_source_batch.species_id,
    v_source_batch.batch_type,
    p_origin_date,
    p_available_date,
    v_source_batch.base_price,
    v_source_batch.auto_price_increase_enabled,
    v_source_batch.auto_price_increase_amount,
    v_source_batch.auto_price_increase_max_price,
    coalesce(nullif(trim(p_internal_batch_label), ''), v_source_batch.internal_batch_label),
    v_source_batch.seller_notes,
    p_visibility_status
  );

  for v_source_breed in
    select *
    from public.listing_batch_breeds
    where listing_batch_breeds.listing_batch_id = v_source_batch.id
      and listing_batch_breeds.store_id = v_source_batch.store_id
      and listing_batch_breeds.visibility_status <> 'archived'
    order by listing_batch_breeds.sort_order, listing_batch_breeds.created_at, listing_batch_breeds.id
  loop
    v_new_breed := public.seller_add_listing_batch_breed(
      v_new_batch.id,
      v_source_breed.seller_breed_profile_id,
      v_source_breed.seller_notes,
      v_source_breed.sort_order,
      case
        when p_visibility_status = 'hidden' then 'hidden'
        else v_source_breed.visibility_status
      end
    );

    v_breed_count := v_breed_count + 1;

    for v_source_item in
      select *
      from public.inventory_items
      where inventory_items.listing_batch_breed_id = v_source_breed.id
        and inventory_items.store_id = v_source_batch.store_id
        and inventory_items.visibility_status <> 'archived'
      order by inventory_items.sort_order, inventory_items.created_at, inventory_items.id
    loop
      perform public.seller_create_inventory_item(
        v_new_breed.id,
        v_source_item.inventory_type,
        v_source_item.custom_inventory_label,
        v_source_item.quantity_available,
        v_source_item.price_override,
        v_source_item.sort_order,
        case
          when p_visibility_status = 'hidden' then 'hidden'
          else v_source_item.visibility_status
        end,
        v_source_item.seller_notes
      );

      v_item_count := v_item_count + 1;
    end loop;
  end loop;

  return query
  select
    v_source_batch.id,
    v_new_batch.id,
    v_new_batch.store_id,
    v_new_batch.visibility_status,
    v_breed_count,
    v_item_count;
end;
$$;


create or replace view public.seller_dashboard_order_summary
with (security_barrier = true)
as
select
  stores.id as store_id,
  count(orders.id) filter (
    where orders.order_status in ('pending', 'open')
  ) as pending_open_order_count,
  count(orders.id) filter (
    where orders.order_status = 'fulfilled'
  ) as fulfilled_order_count,
  count(orders.id) filter (
    where orders.order_status = 'canceled'
  ) as canceled_order_count,
  min(orders.created_at) filter (
    where orders.order_status in ('pending', 'open')
  ) as oldest_order_requiring_action_at,
  count(orders.id) filter (
    where orders.order_status in ('pending', 'open')
      and orders.pickup_option_label_snapshot is not null
  ) as upcoming_pickup_order_count
from public.stores
left join public.orders
  on orders.store_id = stores.id
where public.owns_store(stores.id)
   or public.is_admin()
group by stores.id;

comment on view public.seller_dashboard_order_summary is
'Seller-private dashboard projection for operational order counts. Upcoming pickups are open orders with a selected seller-defined pickup option, not arbitrary scheduled pickup dates.';


create or replace view public.seller_dashboard_attention_orders
with (security_barrier = true)
as
select
  orders.store_id,
  orders.id as order_id,
  orders.order_number,
  orders.order_status,
  orders.payment_status,
  orders.buyer_first_name_snapshot,
  orders.buyer_last_name_snapshot,
  orders.buyer_email_snapshot,
  orders.buyer_phone_snapshot,
  orders.created_at,
  orders.total_amount,
  coalesce(order_item_counts.item_count, 0) as item_count,
  orders.pickup_option_id,
  orders.pickup_option_label_snapshot
from public.orders
left join (
  select
    order_items.order_id,
    count(*) as item_count
  from public.order_items
  group by order_items.order_id
) as order_item_counts
  on order_item_counts.order_id = orders.id
where orders.order_status in ('pending', 'open')
  and (
    public.owns_store(orders.store_id)
    or public.is_admin()
  )
order by orders.created_at asc, orders.id asc;

comment on view public.seller_dashboard_attention_orders is
'Seller-private dashboard projection listing pending/open orders that need attention, including selected pickup option labels when present.';


create or replace view public.seller_dashboard_home
with (security_barrier = true)
as
with refund_summary as (
  select
    order_refunds.store_id,
    count(*) filter (where order_refunds.refund_status = 'pending') as pending_refund_count,
    count(*) filter (where order_refunds.refund_status = 'failed') as failed_refund_count
  from public.order_refunds
  group by order_refunds.store_id
),
notification_summary as (
  select
    email_notifications.store_id,
    count(*) filter (where email_notifications.notification_status = 'failed') as failed_notification_count,
    count(*) filter (where email_notifications.notification_status = 'pending') as pending_notification_count
  from public.email_notifications
  group by email_notifications.store_id
)
select
  stores.id as store_id,
  stores.store_name,
  stores.store_slug,
  storefront_status.storefront_enabled,
  storefront_status.store_status,
  storefront_status.storefront_mode,
  storefront_status.is_publicly_available,
  storefront_status.unavailable_reason_code,
  inventory_summary.active_listing_count,
  inventory_summary.sold_out_listing_count,
  inventory_summary.total_active_inventory_quantity,
  order_summary.pending_open_order_count,
  order_summary.fulfilled_order_count,
  order_summary.canceled_order_count,
  order_summary.oldest_order_requiring_action_at,
  coalesce(refund_summary.pending_refund_count, 0) as pending_refund_count,
  coalesce(refund_summary.failed_refund_count, 0) as failed_refund_count,
  coalesce(notification_summary.failed_notification_count, 0) as failed_notification_count,
  coalesce(notification_summary.pending_notification_count, 0) as pending_notification_count,
  coalesce(order_summary.upcoming_pickup_order_count, 0) as upcoming_pickup_order_count
from public.stores
left join public.seller_dashboard_storefront_status as storefront_status
  on storefront_status.store_id = stores.id
left join public.seller_dashboard_inventory_summary as inventory_summary
  on inventory_summary.store_id = stores.id
left join public.seller_dashboard_order_summary as order_summary
  on order_summary.store_id = stores.id
left join refund_summary
  on refund_summary.store_id = stores.id
left join notification_summary
  on notification_summary.store_id = stores.id
where public.owns_store(stores.id)
   or public.is_admin();

comment on view public.seller_dashboard_home is
'Seller-private dashboard home projection combining existing operational summaries with refund, notification, and pickup-option order counts. This is read-only UI support, not stored analytics.';


create or replace view public.seller_order_management
with (security_barrier = true)
as
with item_summary as (
  select
    order_items.store_id,
    order_items.order_id,
    count(*) as item_count,
    coalesce(sum(order_items.quantity), 0) as total_item_quantity,
    coalesce(sum(order_items.fulfilled_quantity), 0) as fulfilled_item_quantity,
    coalesce(sum(order_items.restored_quantity), 0) as restored_item_quantity
  from public.order_items
  group by order_items.store_id, order_items.order_id
),
refund_summary as (
  select
    order_refunds.store_id,
    order_refunds.order_id,
    count(*) as refund_count,
    coalesce(sum(order_refunds.refund_amount) filter (
      where order_refunds.refund_status in ('pending', 'succeeded')
    ), 0)::numeric(10, 2) as reserved_refund_amount,
    coalesce(sum(order_refunds.refund_amount) filter (
      where order_refunds.refund_status = 'succeeded'
    ), 0)::numeric(10, 2) as succeeded_refund_amount,
    max(order_refunds.created_at) as latest_refund_created_at
  from public.order_refunds
  group by order_refunds.store_id, order_refunds.order_id
),
notification_summary as (
  select
    email_notifications.store_id,
    email_notifications.order_id,
    count(*) filter (where email_notifications.notification_status = 'failed') as failed_notification_count,
    count(*) filter (where email_notifications.notification_status = 'pending') as pending_notification_count,
    max(email_notifications.updated_at) as latest_notification_updated_at
  from public.email_notifications
  group by email_notifications.store_id, email_notifications.order_id
)
select
  orders.store_id,
  orders.id as order_id,
  orders.order_number,
  orders.order_source,
  orders.order_status,
  orders.payment_method,
  orders.payment_status,
  orders.payment_provider,
  orders.provider_payment_status,
  orders.ready_for_pickup_at,
  orders.paid_at,
  orders.fulfilled_at,
  orders.canceled_at,
  orders.created_at,
  orders.updated_at,
  orders.customer_id,
  orders.buyer_first_name_snapshot,
  orders.buyer_last_name_snapshot,
  orders.buyer_email_snapshot,
  orders.buyer_phone_snapshot,
  orders.buyer_address_line1_snapshot,
  orders.buyer_address_line2_snapshot,
  orders.buyer_city_snapshot,
  orders.buyer_state_snapshot,
  orders.buyer_postal_code_snapshot,
  orders.buyer_country_snapshot,
  orders.pickup_note,
  orders.buyer_notes,
  orders.subtotal_amount,
  orders.tax_fee_label_snapshot,
  orders.tax_fee_amount,
  orders.total_amount,
  coalesce(item_summary.item_count, 0) as item_count,
  coalesce(item_summary.total_item_quantity, 0) as total_item_quantity,
  coalesce(item_summary.fulfilled_item_quantity, 0) as fulfilled_item_quantity,
  coalesce(item_summary.restored_item_quantity, 0) as restored_item_quantity,
  coalesce(refund_summary.refund_count, 0) as refund_count,
  coalesce(refund_summary.reserved_refund_amount, 0)::numeric(10, 2) as reserved_refund_amount,
  coalesce(refund_summary.succeeded_refund_amount, 0)::numeric(10, 2) as succeeded_refund_amount,
  greatest(
    orders.total_amount - coalesce(refund_summary.reserved_refund_amount, 0),
    0
  )::numeric(10, 2) as refundable_amount_remaining,
  refund_summary.latest_refund_created_at,
  coalesce(notification_summary.failed_notification_count, 0) as failed_notification_count,
  coalesce(notification_summary.pending_notification_count, 0) as pending_notification_count,
  notification_summary.latest_notification_updated_at,
  orders.pickup_option_id,
  orders.pickup_option_label_snapshot
from public.orders
left join item_summary
  on item_summary.store_id = orders.store_id
 and item_summary.order_id = orders.id
left join refund_summary
  on refund_summary.store_id = orders.store_id
 and refund_summary.order_id = orders.id
left join notification_summary
  on notification_summary.store_id = orders.store_id
 and notification_summary.order_id = orders.id
where public.owns_store(orders.store_id)
   or public.is_admin();

comment on view public.seller_order_management is
'Seller-private order management projection with fulfillment, refund, notification, pickup-option, and contact snapshots needed for dashboard order lists. Provider identifiers are intentionally omitted.';


drop function public.create_pay_at_pickup_order(
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

  select *
  into v_store
  from public.stores
  where stores.id = p_store_id
    and stores.storefront_enabled = true
    and stores.store_status = 'live'
    and stores.storefront_mode in ('hosted', 'embedded')
    and stores.admin_hold_reason is null;

  if v_store.id is null then
    raise exception 'Store is not available for checkout.';
  end if;

  if p_pickup_option_id is not null then
    select *
    into v_pickup_option
    from public.store_pickup_options
    where store_pickup_options.id = p_pickup_option_id
      and store_pickup_options.store_id = p_store_id
      and store_pickup_options.is_active = true;

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
            from pg_temp.requested_order_items
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
  else
    update public.customers
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
  returning id, created_at into v_order_id, v_order_created_at;

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
  text,
  uuid
) is
'Trusted pay-at-pickup storefront order creation RPC. Called by the pay-at-pickup-order Edge Function using service_role. Supports optional seller-defined pickup option snapshots; does not implement arbitrary scheduled pickup dates.';

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
  text,
  uuid
) from public;

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
  text,
  uuid
) from anon, authenticated;

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
  text,
  uuid
) to service_role;


comment on function public.seller_create_pickup_option(uuid, text, text, integer, boolean) is
'Seller/admin RPC for creating a store-owned pickup option label. These are dropdown choices, not calendar appointments.';

comment on function public.seller_update_pickup_option(uuid, text, text, integer, boolean) is
'Seller/admin RPC for updating a store-owned pickup option label, description, sort order, or active status.';

comment on function public.seller_set_pickup_option_active(uuid, boolean) is
'Seller/admin RPC for activating or deactivating a pickup option without deleting historical order snapshots.';

comment on function public.seller_set_order_pickup_option(uuid, uuid) is
'Seller/admin RPC for assigning or clearing an active pickup option on an open order while preserving the selected label snapshot.';

comment on function public.seller_update_store_defaults(uuid, jsonb) is
'Seller/admin RPC for updating narrow seller defaults used to prefill seller workflows.';

comment on function public.seller_update_customer(uuid, jsonb) is
'Seller/admin RPC for updating only approved customer fields: name, phone, email, address/contact fields, and notes.';

comment on function public.seller_duplicate_listing(uuid, date, date, text, text) is
'Seller/admin RPC for duplicating a live-animal listing. Clones listing basics, breed rows, inventory rows, and listing settings; does not clone media, orders, moderation fields, or provider/system fields.';


revoke all on function public.seller_create_pickup_option(uuid, text, text, integer, boolean) from public;
revoke all on function public.seller_update_pickup_option(uuid, text, text, integer, boolean) from public;
revoke all on function public.seller_set_pickup_option_active(uuid, boolean) from public;
revoke all on function public.seller_set_order_pickup_option(uuid, uuid) from public;
revoke all on function public.seller_update_store_defaults(uuid, jsonb) from public;
revoke all on function public.seller_update_customer(uuid, jsonb) from public;
revoke all on function public.seller_duplicate_listing(uuid, date, date, text, text) from public;

grant execute on function public.seller_create_pickup_option(uuid, text, text, integer, boolean) to authenticated;
grant execute on function public.seller_update_pickup_option(uuid, text, text, integer, boolean) to authenticated;
grant execute on function public.seller_set_pickup_option_active(uuid, boolean) to authenticated;
grant execute on function public.seller_set_order_pickup_option(uuid, uuid) to authenticated;
grant execute on function public.seller_update_store_defaults(uuid, jsonb) to authenticated;
grant execute on function public.seller_update_customer(uuid, jsonb) to authenticated;
grant execute on function public.seller_duplicate_listing(uuid, date, date, text, text) to authenticated;

grant select on public.seller_dashboard_order_summary to authenticated;
grant select on public.seller_dashboard_attention_orders to authenticated;
grant select on public.seller_dashboard_home to authenticated;
grant select on public.seller_order_management to authenticated;
