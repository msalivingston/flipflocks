-- Preserve archived delivery choices so sellers can review, restore, and use
-- them on existing orders without exposing them to new storefront customers.

alter table public.store_delivery_options
add column if not exists archived_at timestamptz;

update public.store_delivery_options
set archived_at = updated_at
where is_active = false
  and archived_at is null;

comment on column public.store_delivery_options.archived_at is
'When the seller archived this delivery option. Active options keep this null.';

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
  v_is_active boolean := coalesce(p_is_active, true);
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
    store_id, name, price_amount, sort_order, is_active, archived_at
  )
  values (
    p_store_id, trim(p_name), round(p_price_amount, 2),
    coalesce(p_sort_order, 0), v_is_active,
    case when v_is_active then null else now() end
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
  v_is_active boolean := coalesce(p_is_active, true);
begin
  select * into v_option
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
    is_active = v_is_active,
    archived_at = case
      when v_is_active then null
      else coalesce(v_option.archived_at, now())
    end
  where store_delivery_options.id = v_option.id
  returning * into v_updated_option;

  return v_updated_option;
end;
$$;

create or replace function public.get_public_storefront_delivery_options(
  p_store_slug text
)
returns table (
  delivery_option_id uuid,
  name text,
  price_amount numeric(10, 2),
  sort_order integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    store_delivery_options.id as delivery_option_id,
    store_delivery_options.name,
    store_delivery_options.price_amount,
    store_delivery_options.sort_order
  from public.get_storefront_public_status(p_store_slug) as storefront_status
  join public.stores
    on stores.store_slug = storefront_status.store_slug
   and storefront_status.is_publicly_available = true
   and stores.delivery_enabled = true
  join public.store_delivery_options
    on store_delivery_options.store_id = stores.id
   and store_delivery_options.is_active = true
   and store_delivery_options.archived_at is null
  order by
    store_delivery_options.sort_order,
    store_delivery_options.created_at,
    store_delivery_options.id;
$$;

do $archive_delivery_options$
declare
  v_definition text;
  v_old text := 'and store_delivery_options.is_active = true;';
  v_new text := E'and (\n          (store_delivery_options.is_active = true and store_delivery_options.archived_at is null)\n          or (store_delivery_options.is_active = false and store_delivery_options.archived_at is not null)\n        );';
begin
  select pg_get_functiondef(procedures.oid)
  into v_definition
  from pg_proc as procedures
  join pg_namespace as namespaces
    on namespaces.oid = procedures.pronamespace
  where namespaces.nspname = 'public'
    and procedures.proname = 'seller_edit_order_strict_wrapper'
  order by procedures.oid desc
  limit 1;

  if v_definition is null then
    raise exception 'seller_edit_order_strict_wrapper was not found.';
  end if;

  if position(v_old in v_definition) = 0 then
    raise exception 'Expected delivery eligibility predicate was not found.';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$archive_delivery_options$;

comment on function public.seller_update_delivery_option(uuid, text, numeric, integer, boolean) is
'Seller RPC for creating, restoring, editing, or archiving delivery options without deleting records.';
