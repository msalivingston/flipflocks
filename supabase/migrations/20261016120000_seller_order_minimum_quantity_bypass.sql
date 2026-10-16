-- Seller-entered orders are operational workflows. They retain availability,
-- source identity, pricing, and reservation validation, but are not subject to
-- a storefront customer's aggregate live-bird minimum policy.
begin;

do $migration$
declare
  v_name text;
  v_oid oid;
  v_definition text;
  v_assertion text;
begin
  for v_name, v_assertion in values
    ('seller_create_manual_order',
      '  perform public.assert_live_bird_minimum_order_quantities(p_store_id, (select coalesce(jsonb_agg(jsonb_build_object(''item_type'', item_type, ''item_id'', source_id, ''quantity'', requested_quantity)), ''[]''::jsonb) from pg_temp.seller_manual_quantity_sources));'),
    ('seller_edit_order',
      '  perform public.assert_live_bird_minimum_order_quantities(v_order.store_id, (select coalesce(jsonb_agg(jsonb_build_object(''item_type'', item_type, ''item_id'', source_id, ''quantity'', quantity)), ''[]''::jsonb) from pg_temp.seller_quantity_edit_requested));')
  loop
    select p.oid, replace(pg_get_functiondef(p.oid), chr(13), '')
      into v_oid, v_definition
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = v_name;

    if v_oid is null or position(v_assertion in v_definition) = 0 then
      raise exception 'Seller minimum quantity enforcement anchor missing in %.', v_name;
    end if;

    execute replace(v_definition, v_assertion || E'\n\n', '');
  end loop;
end;
$migration$;

commit;
