-- Preserve the captured or manually recorded payment amount by preventing
-- seller edits after an order has been marked paid. The existing payment
-- correction and fulfillment RPCs remain available.
begin;

do $migration$
declare
  v_sql text;
  v_old_guard text := $guard$
  if v_order.payment_method = 'stripe_checkout'
     and v_order.payment_status <> 'unpaid' then
    raise exception 'Paid online orders cannot be edited.';
  end if;$guard$;
  v_local_guard text := $guard$
  if coalesce(v_order.payment_status, '') not in ('unpaid', 'pay_at_pickup')
     or (v_order.payment_status = 'pay_at_pickup'
         and v_order.payment_method is distinct from 'pay_at_pickup') then
    raise exception 'Paid orders cannot be edited.';
  end if;$guard$;
  v_new_guard text := $guard$
  if v_order.canceled_at is not null or v_order.order_status = 'canceled' then
    raise exception 'Canceled orders cannot be edited.';
  end if;

  if coalesce(v_order.payment_status, '') not in ('unpaid', 'pay_at_pickup')
     or (v_order.payment_status = 'pay_at_pickup'
         and v_order.payment_method is distinct from 'pay_at_pickup') then
    raise exception 'Paid orders cannot be edited.';
  end if;$guard$;
begin
  select pg_get_functiondef(p.oid) into strict v_sql
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'seller_edit_order';

  if (length(v_sql) - length(replace(v_sql, v_old_guard, '')))
      / length(v_old_guard) = 1 then
    execute replace(v_sql, v_old_guard, v_new_guard);
  elsif (length(v_sql) - length(replace(v_sql, v_local_guard, '')))
      / length(v_local_guard) = 1 then
    -- Also allow correcting an isolated local database that ran the
    -- initial, still-pending version of this migration during validation.
    execute replace(v_sql, v_local_guard, v_new_guard);
  else
    raise exception 'Seller edit payment guard migration anchor changed.';
  end if;
end;
$migration$;

commit;
