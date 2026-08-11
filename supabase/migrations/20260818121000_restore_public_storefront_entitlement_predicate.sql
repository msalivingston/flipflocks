-- Emergency forward fix: restore the public-safe storefront entitlement check.

begin;

do $block$
declare
  v_name text := 'public_storefront_inventory';
  v_oid oid;
  v_definition text;
  v_replacement text;
  v_actual_calls integer;
  v_owner oid;
  v_acl aclitem[];
  v_comment text;
  v_options text[];
  v_columns jsonb;
begin
  v_oid := to_regclass('public.' || v_name);
  if v_oid is null then
    raise exception 'Expected public view public.% is missing.', v_name;
  end if;

  select
    views.relowner,
    views.relacl,
    obj_description(views.oid, 'pg_class'),
    views.reloptions,
    (
      select jsonb_agg(
        jsonb_build_array(
          columns.attnum,
          columns.attname,
          columns.atttypid,
          columns.atttypmod,
          columns.attnotnull
        )
        order by columns.attnum
      )
      from pg_catalog.pg_attribute as columns
      where columns.attrelid = views.oid
        and columns.attnum > 0
        and not columns.attisdropped
    )
  into v_owner, v_acl, v_comment, v_options, v_columns
  from pg_catalog.pg_class as views
  where views.oid = v_oid
    and views.relkind = 'v';

  if not found then
    raise exception 'Expected public.% to be a view.', v_name;
  end if;

  select pg_get_viewdef(v_oid, true)
  into v_definition;

  v_actual_calls :=
    (
      length(v_definition)
      - length(replace(v_definition, 'get_store_plan_key', ''))
    ) / length('get_store_plan_key');

  if v_actual_calls <> 1 then
    raise exception
      'Expected one get_store_plan_key call in public.%, found %.',
      v_name,
      v_actual_calls;
  end if;

  if strpos(v_definition, 'seller_breed_profiles.bird_type') = 0
     or strpos(v_definition, 'seller_breed_profiles.egg_color') = 0
     or strpos(
       v_definition,
       'seller_breed_profiles.annual_egg_production'
     ) = 0
     or strpos(v_definition, 'breeds.bird_type') > 0
     or strpos(v_definition, 'breeds.egg_color') > 0
     or strpos(v_definition, 'breeds.annual_egg_production') > 0 then
    raise exception
      'Unexpected seller breed metadata definition for public.%.',
      v_name;
  end if;

  v_replacement := regexp_replace(
    v_definition,
    '(public[.])?get_store_plan_key[(]stores[.]id[)] = ''full_flock''::text',
    'public.store_has_public_market_entitlement(stores.id)',
    'g'
  );
  v_replacement := regexp_replace(
    v_replacement,
    ';[[:space:]]*$',
    ''
  );

  if strpos(v_replacement, 'get_store_plan_key') > 0
     or strpos(
       v_replacement,
       'store_has_public_market_entitlement'
     ) = 0 then
    raise exception
      'Could not safely restore the public entitlement predicate in public.%.',
      v_name;
  end if;

  execute format(
    'create or replace view public.%I with (security_barrier = true) as %s',
    v_name,
    v_replacement
  );

  if exists (
    select 1
    from pg_catalog.pg_class as views
    where views.oid = v_oid
      and (
        views.relowner is distinct from v_owner
        or views.relacl is distinct from v_acl
        or obj_description(views.oid, 'pg_class') is distinct from v_comment
        or views.reloptions is distinct from v_options
        or (
          select jsonb_agg(
            jsonb_build_array(
              columns.attnum,
              columns.attname,
              columns.atttypid,
              columns.atttypmod,
              columns.attnotnull
            )
            order by columns.attnum
          )
          from pg_catalog.pg_attribute as columns
          where columns.attrelid = views.oid
            and columns.attnum > 0
            and not columns.attisdropped
        ) is distinct from v_columns
      )
  ) then
    raise exception
      'Public view metadata changed unexpectedly for public.%.',
      v_name;
  end if;

  select pg_get_viewdef(v_oid, true)
  into v_definition;

  if strpos(v_definition, 'get_store_plan_key') > 0
     or strpos(
       v_definition,
       'store_has_public_market_entitlement'
     ) = 0
     or strpos(v_definition, 'seller_breed_profiles.bird_type') = 0
     or strpos(v_definition, 'seller_breed_profiles.egg_color') = 0
     or strpos(
       v_definition,
       'seller_breed_profiles.annual_egg_production'
     ) = 0 then
    raise exception
      'Public storefront entitlement or seller metadata correction failed for public.%.',
      v_name;
  end if;
end;
$block$;

commit;
