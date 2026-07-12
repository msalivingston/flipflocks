begin;

update public.stores
set storefront_font_pair = 'farmstead'
where storefront_font_pair in ('heritage', 'country_classic')
   or storefront_font_pair not in (
    'farmstead',
    'homestead',
    'farm_market',
    'modern_farm',
    'friendly_fields',
    'clean_simple'
  );

alter table public.stores
drop constraint if exists stores_storefront_font_pair_check;

alter table public.stores
add constraint stores_storefront_font_pair_check
check (storefront_font_pair in (
  'farmstead',
  'homestead',
  'farm_market',
  'modern_farm',
  'friendly_fields',
  'clean_simple'
));

do $$
declare
  v_function_definition text;
  v_legacy_assignment text := $old$
  v_storefront_font_pair := case
    when p_settings ? 'storefront_font_pair' then nullif(trim(p_settings ->> 'storefront_font_pair'), '')
    else v_store.storefront_font_pair
  end;
$old$;
  v_updated_assignment text := $new$
  v_storefront_font_pair := case
    when p_settings ? 'storefront_font_pair' then nullif(trim(p_settings ->> 'storefront_font_pair'), '')
    else v_store.storefront_font_pair
  end;

  if v_storefront_font_pair in ('heritage', 'country_classic') then
    v_storefront_font_pair := 'farmstead';
  end if;
$new$;
  v_legacy_allowed_list text := $old$
  if v_storefront_font_pair not in (
    'farmstead',
    'homestead',
    'modern_farm',
    'heritage',
    'country_classic'
  ) then
$old$;
  v_updated_allowed_list text := $new$
  if v_storefront_font_pair not in (
    'farmstead',
    'homestead',
    'farm_market',
    'modern_farm',
    'friendly_fields',
    'clean_simple'
  ) then
$new$;
begin
  select pg_get_functiondef('public.seller_update_store_settings(uuid, jsonb)'::regprocedure)
  into v_function_definition;

  if position(v_legacy_assignment in v_function_definition) = 0 then
    raise exception 'Could not locate storefront font assignment in seller_update_store_settings.';
  end if;

  if position(v_legacy_allowed_list in v_function_definition) = 0 then
    raise exception 'Could not locate storefront font allowed list in seller_update_store_settings.';
  end if;

  v_function_definition := replace(
    v_function_definition,
    v_legacy_assignment,
    v_updated_assignment
  );

  v_function_definition := replace(
    v_function_definition,
    v_legacy_allowed_list,
    v_updated_allowed_list
  );

  execute v_function_definition;
end $$;

comment on constraint stores_storefront_font_pair_check on public.stores is
'Allowed seller storefront font pair identifiers. Retired Heritage and Country Classic values fall back to Farmstead.';

commit;
