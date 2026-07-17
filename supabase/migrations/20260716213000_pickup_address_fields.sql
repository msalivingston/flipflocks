-- Add an explicit buyer-facing pickup/contact address for completed-order communication.
-- This is intentionally separate from private billing/contact address fields.

alter table public.stores
add column if not exists pickup_address_line1 text,
add column if not exists pickup_address_line2 text,
add column if not exists pickup_city text,
add column if not exists pickup_state text,
add column if not exists pickup_postal_code text,
add column if not exists pickup_country text;

comment on column public.stores.pickup_address_line1 is
'Seller buyer-facing pickup/contact street address line 1. May be disclosed to buyers after an order is placed. Separate from private billing information and not automatically shown on the anonymous storefront.';

comment on column public.stores.pickup_address_line2 is
'Seller buyer-facing pickup/contact street address line 2. May be disclosed to buyers after an order is placed. Separate from private billing information and not automatically shown on the anonymous storefront.';

comment on column public.stores.pickup_city is
'Seller buyer-facing pickup/contact city. May be disclosed to buyers after an order is placed. Separate from private billing information and not automatically shown on the anonymous storefront.';

comment on column public.stores.pickup_state is
'Seller buyer-facing pickup/contact state or region. May be disclosed to buyers after an order is placed. Separate from private billing information and not automatically shown on the anonymous storefront.';

comment on column public.stores.pickup_postal_code is
'Seller buyer-facing pickup/contact ZIP or postal code. May be disclosed to buyers after an order is placed. Separate from private billing information and not automatically shown on the anonymous storefront.';

comment on column public.stores.pickup_country is
'Seller buyer-facing pickup/contact country code. May be disclosed to buyers after an order is placed. Separate from private billing information and not automatically shown on the anonymous storefront.';

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
  stores.delivery_enabled,
  stores.pickup_address_line1,
  stores.pickup_address_line2,
  stores.pickup_city,
  stores.pickup_state,
  stores.pickup_postal_code,
  stores.pickup_country
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
    'pickup_method',
    'pickup_instructions',
    'pickup_location_text',
    'pickup_address_line1',
    'pickup_address_line2',
    'pickup_city',
    'pickup_state',
    'pickup_postal_code',
    'pickup_country',
    'default_pickup_option_id',
    'communication_email',
    'order_notification_email',
    'currency'
  ];
  v_unknown_keys text;
  v_default_pickup_option_id uuid;
  v_currency text;
  v_pickup_method text;
  v_pickup_country text;
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

  if p_defaults ? 'pickup_method' then
    v_pickup_method := nullif(trim(p_defaults ->> 'pickup_method'), '');

    if v_pickup_method not in ('notes', 'manual_options') then
      raise exception 'Pickup method must be notes or manual_options.';
    end if;
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

  if p_defaults ? 'pickup_country' then
    v_pickup_country := upper(coalesce(nullif(trim(p_defaults ->> 'pickup_country'), ''), 'US'));

    if v_pickup_country !~ '^[A-Z]{2}$' then
      raise exception 'Pickup country must be a two-letter country code.';
    end if;
  end if;

  update public.stores
  set
    pickup_method = case
      when p_defaults ? 'pickup_method' then v_pickup_method
      else stores.pickup_method
    end,
    pickup_instructions = case
      when p_defaults ? 'pickup_instructions' then nullif(trim(p_defaults ->> 'pickup_instructions'), '')
      else stores.pickup_instructions
    end,
    pickup_location_text = case
      when p_defaults ? 'pickup_location_text' then nullif(trim(p_defaults ->> 'pickup_location_text'), '')
      else stores.pickup_location_text
    end,
    pickup_address_line1 = case
      when p_defaults ? 'pickup_address_line1' then nullif(trim(p_defaults ->> 'pickup_address_line1'), '')
      else stores.pickup_address_line1
    end,
    pickup_address_line2 = case
      when p_defaults ? 'pickup_address_line2' then nullif(trim(p_defaults ->> 'pickup_address_line2'), '')
      else stores.pickup_address_line2
    end,
    pickup_city = case
      when p_defaults ? 'pickup_city' then nullif(trim(p_defaults ->> 'pickup_city'), '')
      else stores.pickup_city
    end,
    pickup_state = case
      when p_defaults ? 'pickup_state' then upper(nullif(trim(p_defaults ->> 'pickup_state'), ''))
      else stores.pickup_state
    end,
    pickup_postal_code = case
      when p_defaults ? 'pickup_postal_code' then nullif(trim(p_defaults ->> 'pickup_postal_code'), '')
      else stores.pickup_postal_code
    end,
    pickup_country = case
      when p_defaults ? 'pickup_country' then v_pickup_country
      else stores.pickup_country
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

comment on function public.seller_update_store_defaults(uuid, jsonb) is
'Trusted seller defaults update helper. Allows pickup method, pickup text defaults, buyer-facing pickup address, default pickup option, communication/order email, and currency.';

revoke all on function public.seller_update_store_defaults(uuid, jsonb) from public;
grant execute on function public.seller_update_store_defaults(uuid, jsonb) to authenticated;
