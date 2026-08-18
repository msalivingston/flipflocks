-- Pay-at-pickup orders only require City and ZIP Code. Card checkout keeps its
-- existing full-address validation in the Stripe checkout path.
do $migration$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'create_pay_at_pickup_order_v2_batch_d_internal';

  if v_definition is null then
    raise exception 'create_pay_at_pickup_order_v2_batch_d_internal was not found.';
  end if;

  v_patched := replace(
    v_definition,
    $$  if v_delivery_address_line1 is null then raise exception 'Buyer address line 1 is required.'; end if;
  if v_delivery_city is null then raise exception 'Buyer city is required.'; end if;
  if v_delivery_state is null then raise exception 'Buyer state is required.'; end if;
  if v_delivery_postal_code is null then raise exception 'Buyer postal code is required.'; end if;$$,
    $$  if v_delivery_city is null then raise exception 'Buyer city is required.'; end if;
  if v_delivery_postal_code is null then raise exception 'Buyer postal code is required.'; end if;$$
  );

  if v_patched = v_definition then
    raise exception 'Pay-at-pickup address validation patch did not match.';
  end if;

  execute v_patched;
end;
$migration$;
