-- Emergency Batch C forward fix: public views must not require direct execution
-- of the private get_store_plan_key(uuid) helper.

begin;

create or replace function public.store_has_public_market_entitlement(
  p_store_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.stores as stores
    cross join lateral public.resolve_store_entitlement(stores.id) as entitlement
    where stores.id = p_store_id
      and stores.storefront_enabled = true
      and stores.store_status = 'live'
      and stores.storefront_mode in ('hosted', 'embedded')
      and stores.admin_hold_reason is null
      and entitlement.has_active_access = true
      and entitlement.held = false
      and entitlement.effective_plan_key = 'full_flock'
  );
$function$;

comment on function public.store_has_public_market_entitlement(uuid) is
'Public-safe boolean capability check. Returns true only for an already-public, unheld store with an active authoritative Market entitlement; it never returns private plan metadata.';

revoke all on function public.store_has_public_market_entitlement(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.store_has_public_market_entitlement(uuid)
to anon, authenticated, service_role;

do $block$
declare
  v_name text;
  v_oid oid;
  v_definition text;
  v_replacement text;
  v_expected_calls integer;
  v_actual_calls integer;
  v_owner oid;
  v_acl aclitem[];
  v_comment text;
  v_options text[];
  v_columns jsonb;
begin
  -- These two affected views depend on public_storefront_inventory and contain
  -- no direct plan-helper call. Leave them byte-for-byte unchanged.
  foreach v_name in array array[
    'public_storefront_home',
    'public_storefront_item_detail'
  ]
  loop
    v_oid := to_regclass('public.' || v_name);
    if v_oid is null then
      raise exception 'Expected public view public.% is missing.', v_name;
    end if;

    select pg_get_viewdef(v_oid, true)
    into v_definition;

    if strpos(v_definition, 'get_store_plan_key') > 0
       or strpos(v_definition, 'public_storefront_inventory') = 0 then
      raise exception 'Unexpected indirect public view definition for public.%.', v_name;
    end if;
  end loop;

  -- Replace only the six final Market predicates that invoke the private plan
  -- helper. CREATE OR REPLACE preserves the existing view object, grants, and
  -- comments; the explicit metadata checks below make any drift fail loudly.
  foreach v_name in array array[
    'public_storefront_inventory',
    'public_storefront_equipment_inventory',
    'public_storefront_processed_poultry_inventory',
    'public_storefront_hatching_egg_inventory',
    'public_storefront_media_gallery'
  ]
  loop
    v_oid := to_regclass('public.' || v_name);
    if v_oid is null then
      raise exception 'Expected public view public.% is missing.', v_name;
    end if;

    v_expected_calls := case
      when v_name = 'public_storefront_media_gallery' then 2
      else 1
    end;

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

    if v_actual_calls <> v_expected_calls then
      raise exception
        'Expected % get_store_plan_key call(s) in public.%, found %.',
        v_expected_calls,
        v_name,
        v_actual_calls;
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
       or strpos(v_replacement, 'store_has_public_market_entitlement') = 0 then
      raise exception 'Could not safely replace the plan predicate in public.%.', v_name;
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
      raise exception 'Public view metadata changed unexpectedly for public.%.', v_name;
    end if;

    select pg_get_viewdef(v_oid, true)
    into v_definition;
    if strpos(v_definition, 'get_store_plan_key') > 0
       or strpos(v_definition, 'store_has_public_market_entitlement') = 0 then
      raise exception 'Public view plan resolution remains unsafe for public.%.', v_name;
    end if;
  end loop;
end;
$block$;

-- The private scalar plan helper remains unavailable through PostgREST RPC.
revoke all on function public.get_store_plan_key(uuid)
from public, anon, authenticated, service_role;

commit;
