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

do $migration$
declare
  v_definition text;
  v_old text := $old$
  select c.id
  into v_customer_id
  from public.customers as c
  where c.store_id = p_store_id
    and lower(trim(c.email)) = v_buyer_email
  order by c.created_at, c.id
  limit 1;
$old$;
  v_new text := $new$
  v_customer_id := public.resolve_order_customer_match(
    p_store_id,
    v_buyer_first_name,
    v_buyer_last_name,
    v_buyer_email,
    v_buyer_phone
  );
$new$;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc as p
  join pg_namespace as n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'create_pay_at_pickup_order_v2';

  if v_definition is null then
    raise exception 'public.create_pay_at_pickup_order_v2 was not found.';
  end if;

  v_definition := replace(v_definition, chr(13) || chr(10), chr(10));

  if strpos(v_definition, v_old) = 0 then
    raise exception
      'The expected public checkout customer lookup block was not found.';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_old text := $old$
  if p_customer_id is null then
    select customers.*
    into v_customer
    from public.customers as customers
    where customers.store_id = p_store_id
      and lower(trim(customers.email)) = v_customer_email
    order by customers.created_at, customers.id
    limit 1
    for update;
  end if;
$old$;
  v_new text := $new$
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
$new$;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc as p
  join pg_namespace as n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'seller_create_manual_order';

  if v_definition is null then
    raise exception 'public.seller_create_manual_order was not found.';
  end if;

  v_definition := replace(v_definition, chr(13) || chr(10), chr(10));

  if strpos(v_definition, v_old) = 0 then
    raise exception
      'The expected manual-order customer lookup block was not found.';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$migration$;
