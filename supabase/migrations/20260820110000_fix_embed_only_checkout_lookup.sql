-- Keep public discovery restricted while allowing validated embed-only checkout
-- routes to use the canonical storefront-home lookup.

do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(
    'public.get_public_storefront_by_slug(text)'::regprocedure
  )
  into v_definition;

  v_old := $old$
  left join public.public_storefront_home
    on public_storefront_home.store_slug = storefront_status.store_slug;
$old$;
  v_new := $new$
  left join lateral public.get_public_storefront_home(
    storefront_status.store_slug
  ) as public_storefront_home on true;
$new$;

  if v_definition is null or strpos(v_definition, v_old) = 0 then
    raise exception
      'Expected get_public_storefront_by_slug storefront-home lookup was not found.';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;

  select pg_get_functiondef(
    'public.get_public_checkout_summary(text,jsonb)'::regprocedure
  )
  into v_definition;

  v_old := $old$
  storefront as (
    select public_storefront_home.store_id, public_storefront_home.store_slug
    from public.public_storefront_home
    join normalized_input
      on normalized_input.normalized_store_slug = public_storefront_home.store_slug
  ),
$old$;
  v_new := $new$
  storefront as (
    select public_storefront_home.store_id, public_storefront_home.store_slug
    from normalized_input
    cross join lateral public.get_public_storefront_home(
      normalized_input.normalized_store_slug
    ) as public_storefront_home
  ),
$new$;

  if v_definition is null or strpos(v_definition, v_old) = 0 then
    raise exception
      'Expected get_public_checkout_summary storefront-home lookup was not found.';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end;
$migration$;
