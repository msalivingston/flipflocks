begin;

do $migration$
declare
  v_storefronts_definition text;
  v_public_home_definition text;
  v_preview_definition text;
  v_context_definition text;
  v_settings_definition text;
  v_readiness_definition text;
  v_public_email_item_start integer;
  v_inventory_item_start integer;
begin
  select pg_get_viewdef('public.public_storefronts'::regclass, true)
  into v_storefronts_definition;

  select replace(
    pg_get_functiondef('public.get_public_storefront_home(text)'::regprocedure),
    chr(13),
    ''
  ) into v_public_home_definition;

  select replace(
    pg_get_functiondef(
      'public.get_seller_storefront_home_preview(text)'::regprocedure
    ),
    chr(13),
    ''
  ) into v_preview_definition;

  select replace(
    pg_get_functiondef('public.get_seller_context()'::regprocedure),
    chr(13),
    ''
  ) into v_context_definition;

  select replace(
    pg_get_functiondef(
      'public.seller_update_store_settings(uuid,jsonb)'::regprocedure
    ),
    chr(13),
    ''
  ) into v_settings_definition;

  select replace(
    pg_get_functiondef(
      'public.evaluate_store_launch_readiness(uuid,uuid)'::regprocedure
    ),
    chr(13),
    ''
  ) into v_readiness_definition;

  if length(v_storefronts_definition) - length(replace(
    v_storefronts_definition,
    'stores.public_email',
    ''
  )) <> length('stores.public_email') then
    raise exception
      'Expected exactly one stores.public_email reference in public_storefronts.';
  end if;

  v_storefronts_definition := replace(
    v_storefronts_definition,
    'stores.public_email',
    $owner_email$(
      select lower(nullif(trim(owner_users.email::text), ''))
      from auth.users as owner_users
      where owner_users.id = stores.owner_user_id
    )$owner_email$
  );

  if length(v_public_home_definition) - length(replace(
    v_public_home_definition,
    'target_store.public_email',
    ''
  )) <> length('target_store.public_email') then
    raise exception
      'Expected exactly one target_store.public_email reference in get_public_storefront_home.';
  end if;

  v_public_home_definition := replace(
    v_public_home_definition,
    'target_store.public_email',
    $owner_email$(
      select lower(nullif(trim(owner_users.email::text), ''))
      from auth.users as owner_users
      where owner_users.id = target_store.owner_user_id
    )$owner_email$
  );

  if length(v_preview_definition) - length(replace(
    v_preview_definition,
    'target_store.public_email',
    ''
  )) <> length('target_store.public_email') then
    raise exception
      'Expected exactly one target_store.public_email reference in get_seller_storefront_home_preview.';
  end if;

  v_preview_definition := replace(
    v_preview_definition,
    'target_store.public_email',
    $owner_email$(
      select lower(nullif(trim(owner_users.email::text), ''))
      from auth.users as owner_users
      where owner_users.id = target_store.owner_user_id
    )$owner_email$
  );

  -- The seller bootstrap and settings contracts no longer expose or accept a
  -- separate email value. show_public_email remains in both contracts.
  v_context_definition := replace(
    v_context_definition,
    ', public_email text,',
    ','
  );
  v_context_definition := regexp_replace(
    v_context_definition,
    E'[[:space:]]*stores\\.public_email,',
    E'\n',
    'g'
  );

  v_settings_definition := replace(
    v_settings_definition,
    ', public_email text,',
    ','
  );
  v_settings_definition := regexp_replace(
    v_settings_definition,
    E'[[:space:]]*''public_email'',[[:space:]]*',
    E'\n',
    'g'
  );
  v_settings_definition := regexp_replace(
    v_settings_definition,
    E'[[:space:]]*public_email = case[[:space:]]+when p_settings \\? ''public_email''[[:space:]]+then lower\\(nullif\\(trim\\(p_settings ->> ''public_email''\\), ''''\\)\\)[[:space:]]+else stores\\.public_email[[:space:]]+end,',
    '',
    'g'
  );
  v_settings_definition := regexp_replace(
    v_settings_definition,
    E'[[:space:]]*v_store\\.public_email,',
    E'\n',
    'g'
  );

  if v_context_definition ~ '(^|[^[:alnum:]_])public_email([^[:alnum:]_]|$)'
    or v_settings_definition ~ '(^|[^[:alnum:]_])public_email([^[:alnum:]_]|$)'
  then
    raise exception
      'A seller context/settings contract still references public_email.';
  end if;

  -- Public email was optional polish, never a launch requirement. Remove the
  -- obsolete warning item rather than replacing it with a visibility mandate.
  v_public_email_item_start := strpos(
    v_readiness_definition,
    E'  return query\n'
      || E'  select\n'
      || E'    ''warning''::text,\n'
      || E'    ''public_email_present''::text,'
  );
  v_inventory_item_start := strpos(
    v_readiness_definition,
    E'  return query\n'
      || E'  select\n'
      || E'    ''warning''::text,\n'
      || E'    ''inventory_quantity''::text,'
  );

  if v_public_email_item_start = 0
    or v_inventory_item_start <= v_public_email_item_start
  then
    raise exception 'Could not isolate the legacy public-email readiness item.';
  end if;

  v_readiness_definition := substring(
    v_readiness_definition from 1 for v_public_email_item_start - 1
  ) || substring(v_readiness_definition from v_inventory_item_start);

  if v_readiness_definition ~ 'public_email'
  then
    raise exception 'Launch readiness still references public_email.';
  end if;

  -- Replace same-shape public contracts before dropping the store column so
  -- all dependent storefront views remain valid throughout the transaction.
  execute
    'create or replace view public.public_storefronts '
    || 'with (security_barrier = true) as '
    || v_storefronts_definition;
  execute v_public_home_definition;
  execute v_preview_definition;
  execute v_readiness_definition;

  -- These two RPCs have fixed named return tables, so their signatures must be
  -- dropped and recreated after the column is removed.
  drop function public.get_seller_context();
  drop function public.seller_update_store_settings(uuid, jsonb);

  alter table public.stores
    drop constraint if exists stores_public_email_not_empty_check;

  alter table public.stores
    drop column public_email;

  execute v_context_definition;
  execute v_settings_definition;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stores'
      and column_name = 'public_email'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stores'
      and column_name = 'show_public_email'
  ) then
    raise exception 'The final stores public-email schema is invalid.';
  end if;

  if exists (
    select 1
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.prosrc ~ '(stores|target_store|v_store)\\.public_email'
  ) or exists (
    select 1
    from pg_views
    where schemaname = 'public'
      and definition ~ 'stores\\.public_email'
  ) then
    raise exception 'An active public contract still reads stores.public_email.';
  end if;
end;
$migration$;

comment on column public.stores.show_public_email is
'Seller visibility preference. When true, public storefront contracts expose only the current owner auth.users.email; when false, no email is exposed.';

comment on function public.get_seller_context() is
'Seller dashboard bootstrap context. Returns only stores the current user owns or has scoped seller/staff membership for; platform admin status alone does not grant seller dashboard context.';

comment on function public.seller_update_store_settings(uuid, jsonb) is
'Seller/admin RPC for updating seller-editable storefront settings, including whether the owner account email is publicly visible. It does not accept an email address.';

revoke all on function public.get_seller_context()
  from public, anon, authenticated, service_role;
grant execute on function public.get_seller_context() to authenticated;

revoke all on function public.seller_update_store_settings(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.seller_update_store_settings(uuid, jsonb)
  to authenticated;

commit;
