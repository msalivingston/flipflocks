begin;

alter table public.stores
  add column show_public_website boolean not null default false;

do $migration$
declare
  v_storefronts_definition text;
  v_public_home_definition text;
  v_preview_definition text;
  v_context_definition text;
  v_settings_definition text;
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

  if length(v_storefronts_definition) - length(replace(
    v_storefronts_definition,
    'stores.website_url',
    ''
  )) <> length('stores.website_url') then
    raise exception
      'Expected exactly one stores.website_url reference in public_storefronts.';
  end if;

  v_storefronts_definition := replace(
    v_storefronts_definition,
    'stores.website_url',
    $website$case
      when stores.show_public_website then stores.website_url
      else null::text
    end as website_url$website$
  );

  if length(v_public_home_definition) - length(replace(
    v_public_home_definition,
    'target_store.website_url',
    ''
  )) <> length('target_store.website_url') then
    raise exception
      'Expected exactly one target_store.website_url reference in get_public_storefront_home.';
  end if;

  v_public_home_definition := replace(
    v_public_home_definition,
    'target_store.website_url',
    $website$case
      when target_store.show_public_website then target_store.website_url
      else null
    end$website$
  );

  if length(v_preview_definition) - length(replace(
    v_preview_definition,
    'target_store.website_url',
    ''
  )) <> length('target_store.website_url') then
    raise exception
      'Expected exactly one target_store.website_url reference in get_seller_storefront_home_preview.';
  end if;

  v_preview_definition := replace(
    v_preview_definition,
    'target_store.website_url',
    $website$case
      when target_store.show_public_website then target_store.website_url
      else null
    end$website$
  );

  if length(v_context_definition) - length(replace(
    v_context_definition,
    'show_public_phone boolean, website_url text',
    ''
  )) <> length('show_public_phone boolean, website_url text')
  or length(v_context_definition) - length(replace(
    v_context_definition,
    E'stores.show_public_phone,\n    stores.website_url',
    ''
  )) <> length(E'stores.show_public_phone,\n    stores.website_url')
  then
    raise exception 'Could not extend get_seller_context with website visibility.';
  end if;

  v_context_definition := replace(
    v_context_definition,
    'show_public_phone boolean, website_url text',
    'show_public_phone boolean, show_public_website boolean, website_url text'
  );
  v_context_definition := replace(
    v_context_definition,
    E'stores.show_public_phone,\n    stores.website_url',
    E'stores.show_public_phone,\n    stores.show_public_website,\n    stores.website_url'
  );

  if length(v_settings_definition) - length(replace(
    v_settings_definition,
    'show_public_phone boolean, website_url text',
    ''
  )) <> length('show_public_phone boolean, website_url text')
  or length(v_settings_definition) - length(replace(
    v_settings_definition,
    E'''show_public_phone'',\n    ''website_url''',
    ''
  )) <> length(E'''show_public_phone'',\n    ''website_url''')
  or length(v_settings_definition) - length(replace(
    v_settings_definition,
    '    website_url = case',
    ''
  )) <> length('    website_url = case')
  or length(v_settings_definition) - length(replace(
    v_settings_definition,
    E'v_store.show_public_phone,\n    v_store.website_url',
    ''
  )) <> length(E'v_store.show_public_phone,\n    v_store.website_url')
  then
    raise exception
      'Could not extend seller_update_store_settings with website visibility.';
  end if;

  v_settings_definition := replace(
    v_settings_definition,
    'show_public_phone boolean, website_url text',
    'show_public_phone boolean, show_public_website boolean, website_url text'
  );
  v_settings_definition := replace(
    v_settings_definition,
    E'''show_public_phone'',\n    ''website_url''',
    E'''show_public_phone'',\n    ''show_public_website'',\n    ''website_url'''
  );
  v_settings_definition := replace(
    v_settings_definition,
    '    website_url = case',
    E'    show_public_website = case\n      when p_settings ? ''show_public_website''\n        then coalesce(\n          (p_settings ->> ''show_public_website'')::boolean,\n          stores.show_public_website\n        )\n      else stores.show_public_website\n    end,\n    website_url = case'
  );
  v_settings_definition := replace(
    v_settings_definition,
    E'v_store.show_public_phone,\n    v_store.website_url',
    E'v_store.show_public_phone,\n    v_store.show_public_website,\n    v_store.website_url'
  );

  execute
    'create or replace view public.public_storefronts '
    || 'with (security_barrier = true) as '
    || v_storefronts_definition;
  execute v_public_home_definition;
  execute v_preview_definition;

  drop function public.get_seller_context();
  drop function public.seller_update_store_settings(uuid, jsonb);

  execute v_context_definition;
  execute v_settings_definition;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stores'
      and column_name = 'show_public_website'
      and is_nullable = 'NO'
      and column_default = 'false'
  ) then
    raise exception 'The stores.show_public_website column is invalid.';
  end if;
end;
$migration$;

comment on column public.stores.show_public_website is
'Seller visibility preference. When true, display-facing public storefront contracts expose website_url; embed/store-access routing remains independent.';

comment on function public.get_seller_context() is
'Seller dashboard bootstrap context. Returns only stores the current user owns or has scoped seller/staff membership for; platform admin status alone does not grant seller dashboard context.';

comment on function public.seller_update_store_settings(uuid, jsonb) is
'Seller/admin RPC for updating seller-editable storefront settings, including public contact visibility preferences.';

revoke all on function public.get_seller_context()
  from public, anon, authenticated, service_role;
grant execute on function public.get_seller_context() to authenticated;

revoke all on function public.seller_update_store_settings(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.seller_update_store_settings(uuid, jsonb)
  to authenticated;

commit;
