-- Customer contacts may legitimately be identified only by a business name,
-- email address, or phone number. Personal names are optional.

alter table public.customers
  alter column first_name drop not null,
  add constraint customers_meaningful_identifier_check
    check (
      coalesce(
        nullif(trim(first_name), ''),
        nullif(trim(last_name), ''),
        nullif(trim(business_name), ''),
        nullif(trim(email), ''),
        nullif(trim(phone), '')
      ) is not null
    );

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
    'first_name', 'last_name', 'business_name', 'email', 'phone', 'city',
    'state', 'country', 'delivery_address_line1', 'delivery_address_line2',
    'delivery_city', 'delivery_state', 'delivery_postal_code',
    'delivery_country', 'internal_notes'
  ];
  v_unknown_keys text;
begin
  if p_updates is null or jsonb_typeof(p_updates) <> 'object' then
    raise exception 'Customer updates must be provided as an object.';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id
  for update;

  if v_customer.id is null then
    raise exception 'Customer not found.';
  end if;

  if not (public.owns_store(v_customer.store_id) or public.is_admin()) then
    raise exception 'Not authorized to update this customer.';
  end if;

  select string_agg(key, ', ' order by key)
  into v_unknown_keys
  from jsonb_object_keys(p_updates) as key
  where key <> all (v_allowed_keys);

  if v_unknown_keys is not null then
    raise exception 'Unsupported customer fields: %', v_unknown_keys;
  end if;

  update public.customers as customers
  set
    first_name = case when p_updates ? 'first_name' then nullif(trim(p_updates ->> 'first_name'), '') else customers.first_name end,
    last_name = case when p_updates ? 'last_name' then nullif(trim(p_updates ->> 'last_name'), '') else customers.last_name end,
    business_name = case when p_updates ? 'business_name' then nullif(trim(p_updates ->> 'business_name'), '') else customers.business_name end,
    email = case when p_updates ? 'email' then lower(nullif(trim(p_updates ->> 'email'), '')) else customers.email end,
    phone = case when p_updates ? 'phone' then nullif(trim(p_updates ->> 'phone'), '') else customers.phone end,
    city = case when p_updates ? 'city' then nullif(trim(p_updates ->> 'city'), '') else customers.city end,
    state = case when p_updates ? 'state' then nullif(trim(p_updates ->> 'state'), '') else customers.state end,
    country = case when p_updates ? 'country' then nullif(trim(p_updates ->> 'country'), '') else customers.country end,
    delivery_address_line1 = case when p_updates ? 'delivery_address_line1' then nullif(trim(p_updates ->> 'delivery_address_line1'), '') else customers.delivery_address_line1 end,
    delivery_address_line2 = case when p_updates ? 'delivery_address_line2' then nullif(trim(p_updates ->> 'delivery_address_line2'), '') else customers.delivery_address_line2 end,
    delivery_city = case when p_updates ? 'delivery_city' then nullif(trim(p_updates ->> 'delivery_city'), '') else customers.delivery_city end,
    delivery_state = case when p_updates ? 'delivery_state' then nullif(trim(p_updates ->> 'delivery_state'), '') else customers.delivery_state end,
    delivery_postal_code = case when p_updates ? 'delivery_postal_code' then nullif(trim(p_updates ->> 'delivery_postal_code'), '') else customers.delivery_postal_code end,
    delivery_country = case when p_updates ? 'delivery_country' then nullif(trim(p_updates ->> 'delivery_country'), '') else customers.delivery_country end,
    internal_notes = case when p_updates ? 'internal_notes' then nullif(trim(p_updates ->> 'internal_notes'), '') else customers.internal_notes end
  where customers.id = v_customer.id
  returning * into v_updated_customer;

  return v_updated_customer;
end;
$$;
