create or replace function public.seller_delete_customer(
  p_customer_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_customer_id uuid;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'AUTHENTICATION_REQUIRED';
  end if;

  select customers.id
  into v_customer_id
  from public.customers
  where customers.id = p_customer_id
    and public.owns_store(customers.store_id)
  for update;

  if v_customer_id is null then
    raise exception using
      errcode = '42501',
      message = 'CUSTOMER_NOT_FOUND_OR_NOT_AUTHORIZED';
  end if;

  if exists (
    select 1
    from public.orders
    where orders.customer_id = v_customer_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'CUSTOMER_HAS_ORDER_HISTORY';
  end if;

  begin
    delete from public.customers
    where customers.id = v_customer_id;
  exception
    when foreign_key_violation then
      if exists (
        select 1
        from public.orders
        where orders.customer_id = v_customer_id
      ) then
        raise exception using
          errcode = 'P0001',
          message = 'CUSTOMER_HAS_ORDER_HISTORY';
      end if;

      raise;
  end;

  return v_customer_id;
end;
$function$;

comment on function public.seller_delete_customer(uuid) is
'Permanently deletes an owned customer only when no order references the customer. The customer row is locked before the authoritative order-history check; the restrictive orders foreign key remains the final safeguard.';

revoke all on function public.seller_delete_customer(uuid) from public;
revoke all on function public.seller_delete_customer(uuid) from anon;
grant execute on function public.seller_delete_customer(uuid) to authenticated;
