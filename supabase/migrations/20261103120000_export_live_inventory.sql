create or replace function public.seller_export_live_inventory(
  p_store_id uuid, p_availability text, p_species text, p_type_sex text,
  p_age text, p_search text, p_sort text
) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_page jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_offset integer := 0;
  v_count integer;
begin
  -- The existing function checks ownership and supplies the exact screen filters,
  -- sorting, effective prices, and already-unreserved available quantities.
  loop
    v_page := public.seller_get_inventory_management_page(
      p_store_id => p_store_id, p_category => 'live_poultry',
      p_availability => p_availability, p_species => p_species,
      p_type_sex => p_type_sex, p_age => p_age, p_search => p_search,
      p_sort => p_sort, p_offset => v_offset, p_limit => 100
    );
    v_count := jsonb_array_length(v_page->'rows');
    select v_rows || coalesce(jsonb_agg(
      (entry.value->'row') || jsonb_build_object(
        'feather_condition', details.feather_condition,
        'breeding_history', details.breeding_history
      ) order by entry.ordinality
    ), '[]'::jsonb) into v_rows
    from jsonb_array_elements(v_page->'rows') with ordinality as entry(value, ordinality)
    join public.seller_inventory_management details
      on details.store_id = p_store_id
      and details.inventory_item_id = (entry.value->'row'->>'inventory_item_id')::uuid
    where coalesce((entry.value->'row'->>'quantity_available')::numeric, 0) > 0;
    exit when v_count < 100;
    v_offset := v_offset + v_count;
  end loop;
  if p_sort = 'hatch_date' then
    select coalesce(jsonb_agg(item order by
      (item->>'origin_date')::date asc nulls last,
      lower(item->>'breed_display_name'), lower(item->>'species_name'),
      item->>'inventory_item_id'), '[]'::jsonb)
    into v_rows from jsonb_array_elements(v_rows) as item;
  end if;
  return v_rows;
end $$;
revoke all on function public.seller_export_live_inventory(uuid, text, text, text, text, text, text) from public;
grant execute on function public.seller_export_live_inventory(uuid, text, text, text, text, text, text) to authenticated;
