-- Provide a complete, advisory duplicate lookup for seller-managed customers.
-- Email and phone matches remain non-unique and never prevent insertion.

create or replace function public.normalize_customer_phone_for_matching(
  p_phone text
)
returns text
language sql
immutable
parallel safe
as $function$
  with normalized as (
    select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as digits
  )
  select nullif(
    case
      when length(digits) = 11 and left(digits, 1) = '1'
        then substring(digits from 2)
      else digits
    end,
    ''
  )
  from normalized;
$function$;

revoke all on function public.normalize_customer_phone_for_matching(text)
from public;

create index if not exists customers_store_warning_phone_idx
on public.customers (
  store_id,
  public.normalize_customer_phone_for_matching(phone)
)
where phone is not null;

create or replace function public.seller_find_possible_customer_duplicates(
  p_store_id uuid,
  p_email text default null,
  p_phone text default null,
  p_exclude_customer_id uuid default null
)
returns table (
  customer_id uuid,
  first_name text,
  last_name text,
  business_name text,
  email text,
  phone text,
  email_matches boolean,
  phone_matches boolean
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_email text := nullif(lower(trim(p_email)), '');
  v_phone text := public.normalize_customer_phone_for_matching(p_phone);
begin
  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'You do not have access to this store.';
  end if;

  if v_email is null and v_phone is null then
    return;
  end if;

  return query
  select
    c.id,
    c.first_name,
    c.last_name,
    c.business_name,
    c.email,
    c.phone,
    (
      v_email is not null
      and lower(trim(c.email)) = v_email
    ) as email_matches,
    (
      v_phone is not null
      and public.normalize_customer_phone_for_matching(c.phone) = v_phone
    ) as phone_matches
  from public.customers c
  where c.store_id = p_store_id
    and (p_exclude_customer_id is null or c.id <> p_exclude_customer_id)
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
  order by
    (
      v_email is not null
      and lower(trim(c.email)) = v_email
      and v_phone is not null
      and public.normalize_customer_phone_for_matching(c.phone) = v_phone
    ) desc,
    c.created_at,
    c.id;
end;
$function$;

revoke all on function public.seller_find_possible_customer_duplicates(
  uuid,
  text,
  text,
  uuid
) from public;

grant execute on function public.seller_find_possible_customer_duplicates(
  uuid,
  text,
  text,
  uuid
) to authenticated;

comment on function public.seller_find_possible_customer_duplicates(
  uuid,
  text,
  text,
  uuid
) is
'Returns advisory same-store customer matches by normalized email or phone. Results never prevent creating a separate customer.';
