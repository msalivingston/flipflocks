-- Seller account billing address updates
--
-- Keeps private billing address edits behind a narrow trusted RPC instead of
-- reopening broad seller writes on stores.

begin;

create or replace function public.seller_update_billing_address(
  p_store_id uuid,
  p_address jsonb
)
returns table (
  billing_address_line1 text,
  billing_address_line2 text,
  billing_city text,
  billing_state text,
  billing_postal_code text,
  billing_country text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed_keys text[] := array[
    'billing_address_line1',
    'billing_address_line2',
    'billing_city',
    'billing_state',
    'billing_postal_code',
    'billing_country'
  ];
  v_unknown_keys text;
  v_address_line1 text;
  v_address_line2 text;
  v_city text;
  v_country text;
  v_postal_code text;
  v_state text;
begin
  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Not authorized to update billing address for this store.';
  end if;

  if p_address is null or jsonb_typeof(p_address) <> 'object' then
    raise exception 'Billing address must be provided as an object.';
  end if;

  select string_agg(address_key, ', ' order by address_key)
  into v_unknown_keys
  from jsonb_object_keys(p_address) as address_key
  where not (address_key = any(v_allowed_keys));

  if v_unknown_keys is not null then
    raise exception 'Unsupported billing address field(s): %', v_unknown_keys;
  end if;

  v_address_line1 := nullif(trim(p_address ->> 'billing_address_line1'), '');
  v_address_line2 := nullif(trim(p_address ->> 'billing_address_line2'), '');
  v_city := nullif(trim(p_address ->> 'billing_city'), '');
  v_state := upper(nullif(trim(p_address ->> 'billing_state'), ''));
  v_postal_code := nullif(trim(p_address ->> 'billing_postal_code'), '');
  v_country := upper(coalesce(nullif(trim(p_address ->> 'billing_country'), ''), 'US'));

  if v_address_line1 is null then raise exception 'Street address is required.'; end if;
  if v_city is null then raise exception 'City is required.'; end if;
  if v_state is null then raise exception 'State is required.'; end if;
  if v_postal_code is null then raise exception 'ZIP code is required.'; end if;

  if v_country !~ '^[A-Z]{2}$' then
    raise exception 'Billing country must be a two-letter country code.';
  end if;

  update public.stores
  set
    billing_address_line1 = v_address_line1,
    billing_address_line2 = v_address_line2,
    billing_city = v_city,
    billing_state = v_state,
    billing_postal_code = v_postal_code,
    billing_country = v_country
  where stores.id = p_store_id;

  return query
  select
    stores.billing_address_line1,
    stores.billing_address_line2,
    stores.billing_city,
    stores.billing_state,
    stores.billing_postal_code,
    stores.billing_country
  from public.stores
  where stores.id = p_store_id;
end;
$$;

comment on function public.seller_update_billing_address(uuid, jsonb) is
'Trusted seller/admin RPC for updating private seller billing address fields on the Account page.';

revoke all on function public.seller_update_billing_address(uuid, jsonb) from public;
grant execute on function public.seller_update_billing_address(uuid, jsonb) to authenticated;

commit;
