-- Phase 1 seller-configured delivery options for Store Admin only.
-- This does not wire delivery into checkout, orders, emails, print views, Stripe,
-- public storefront pages, or pickup behavior.

alter table public.stores
add column if not exists delivery_enabled boolean not null default false;

comment on column public.stores.delivery_enabled is
'Seller-controlled Store Admin toggle for offering delivery options. Phase 1 only stores the setting and does not affect checkout.';

create table public.store_delivery_options (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  price_amount numeric(10, 2) not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint store_delivery_options_name_not_empty_check check (
    length(trim(name)) > 0
  ),
  constraint store_delivery_options_price_nonnegative_check check (
    price_amount >= 0
  ),
  constraint store_delivery_options_sort_order_nonnegative_check check (
    sort_order >= 0
  )
);

comment on table public.store_delivery_options is
'Seller-defined delivery locations or areas and prices for future checkout use. Phase 1 only exposes these in Store Admin.';

create index store_delivery_options_store_active_sort_idx
on public.store_delivery_options(store_id, is_active, sort_order, name);

create index store_delivery_options_store_sort_idx
on public.store_delivery_options(store_id, sort_order, name);

create trigger store_delivery_options_set_updated_at
before update on public.store_delivery_options
for each row
execute function public.set_updated_at();

alter table public.store_delivery_options enable row level security;

create policy "Store owners can read own delivery options"
on public.store_delivery_options
for select
to authenticated
using (public.owns_store(store_id));

create policy "Store owners can insert own delivery options"
on public.store_delivery_options
for insert
to authenticated
with check (public.owns_store(store_id));

create policy "Store owners can update own delivery options"
on public.store_delivery_options
for update
to authenticated
using (public.owns_store(store_id))
with check (public.owns_store(store_id));

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
  stores.updated_at,
  stores.pickup_method,
  stores.delivery_enabled
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

create or replace function public.seller_update_delivery_enabled(
  p_store_id uuid,
  p_delivery_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if not exists (
    select 1
    from public.stores
    where stores.id = p_store_id
      and stores.owner_user_id = auth.uid()
  ) then
    raise exception 'Not authorized to update delivery settings for this store.';
  end if;

  update public.stores
  set delivery_enabled = coalesce(p_delivery_enabled, false)
  where stores.id = p_store_id;
end;
$$;

comment on function public.seller_update_delivery_enabled(uuid, boolean) is
'Narrow seller-only RPC for Store Admin delivery enablement. It does not update other store defaults.';

create or replace function public.seller_create_delivery_option(
  p_store_id uuid,
  p_name text,
  p_price_amount numeric,
  p_sort_order integer default 0,
  p_is_active boolean default true
)
returns public.store_delivery_options
language plpgsql
security definer
set search_path = public
as $$
declare
  v_option public.store_delivery_options%rowtype;
begin
  if not public.owns_store(p_store_id) then
    raise exception 'Not authorized to create delivery options for this store.';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'Delivery option name is required.';
  end if;

  if p_price_amount is null or p_price_amount < 0 then
    raise exception 'Delivery price must be zero or greater.';
  end if;

  if coalesce(p_sort_order, 0) < 0 then
    raise exception 'Display order must be nonnegative.';
  end if;

  insert into public.store_delivery_options (
    store_id,
    name,
    price_amount,
    sort_order,
    is_active
  )
  values (
    p_store_id,
    trim(p_name),
    round(p_price_amount, 2),
    coalesce(p_sort_order, 0),
    coalesce(p_is_active, true)
  )
  returning * into v_option;

  return v_option;
end;
$$;

create or replace function public.seller_update_delivery_option(
  p_delivery_option_id uuid,
  p_name text,
  p_price_amount numeric,
  p_sort_order integer default 0,
  p_is_active boolean default true
)
returns public.store_delivery_options
language plpgsql
security definer
set search_path = public
as $$
declare
  v_option public.store_delivery_options%rowtype;
  v_updated_option public.store_delivery_options%rowtype;
begin
  select *
  into v_option
  from public.store_delivery_options
  where store_delivery_options.id = p_delivery_option_id
  for update;

  if v_option.id is null then
    raise exception 'Delivery option not found.';
  end if;

  if not public.owns_store(v_option.store_id) then
    raise exception 'Not authorized to update this delivery option.';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'Delivery option name is required.';
  end if;

  if p_price_amount is null or p_price_amount < 0 then
    raise exception 'Delivery price must be zero or greater.';
  end if;

  if coalesce(p_sort_order, 0) < 0 then
    raise exception 'Display order must be nonnegative.';
  end if;

  update public.store_delivery_options
  set
    name = trim(p_name),
    price_amount = round(p_price_amount, 2),
    sort_order = coalesce(p_sort_order, 0),
    is_active = coalesce(p_is_active, true)
  where store_delivery_options.id = v_option.id
  returning * into v_updated_option;

  return v_updated_option;
end;
$$;

comment on function public.seller_create_delivery_option(uuid, text, numeric, integer, boolean) is
'Seller RPC for creating a Store Admin delivery option. Phase 1 only stores seller settings.';

comment on function public.seller_update_delivery_option(uuid, text, numeric, integer, boolean) is
'Seller RPC for updating or soft-deactivating a Store Admin delivery option. Phase 1 only stores seller settings.';

revoke all on function public.seller_update_delivery_enabled(uuid, boolean) from public;
revoke all on function public.seller_create_delivery_option(uuid, text, numeric, integer, boolean) from public;
revoke all on function public.seller_update_delivery_option(uuid, text, numeric, integer, boolean) from public;

grant execute on function public.seller_update_delivery_enabled(uuid, boolean) to authenticated;
grant execute on function public.seller_create_delivery_option(uuid, text, numeric, integer, boolean) to authenticated;
grant execute on function public.seller_update_delivery_option(uuid, text, numeric, integer, boolean) to authenticated;
