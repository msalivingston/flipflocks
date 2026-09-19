-- The active seller_edit_order wrapper delegates to this retained persistence
-- function. Allow an order to retain its own archived option, while keeping
-- archived options ineligible when a seller selects a different option.
do $$
declare
  v_function regprocedure := to_regprocedure(
    'public.seller_edit_order_batch_d_internal(uuid,jsonb,jsonb,uuid,text,text,text,text,text,text,text,uuid,text,uuid,text,numeric,text,text,text,text,text,text,numeric)'
  );
  v_definition text;
  v_updated_definition text;
  v_old_predicate text :=
    '        and store_pickup_options.store_id = v_order.store_id' || E'\n' ||
    '        and store_pickup_options.is_active = true;';
  v_new_predicate text :=
    '        and store_pickup_options.store_id = v_order.store_id' || E'\n' ||
    '        and (' || E'\n' ||
    '          (' || E'\n' ||
    '            store_pickup_options.is_active = true' || E'\n' ||
    '            and store_pickup_options.archived_at is null' || E'\n' ||
    '          )' || E'\n' ||
    '          or store_pickup_options.id = v_order.pickup_option_id' || E'\n' ||
    '        );';
begin
  if v_function is null then
    raise exception 'seller_edit_order_batch_d_internal is missing.';
  end if;

  select pg_get_functiondef(v_function) into v_definition;

  if position(v_old_predicate in v_definition) = 0 then
    raise exception 'seller_edit_order_batch_d_internal pickup validation has changed unexpectedly.';
  end if;

  v_updated_definition := replace(
    v_definition,
    v_old_predicate,
    v_new_predicate
  );

  execute v_updated_definition;
end;
$$;

comment on function public.seller_edit_order_batch_d_internal(
  uuid, jsonb, jsonb, uuid, text, text, text, text, text, text, text, uuid,
  text, uuid, text, numeric, text, text, text, text, text, text, numeric
) is
'Internal seller order persistence. Existing orders may retain their assigned archived pickup option; new pickup selections must be active and unarchived.';
