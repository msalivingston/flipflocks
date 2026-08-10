begin;

do $migration$
declare
  v_storefronts_definition text;
  v_public_home_definition text;
  v_preview_definition text;
  v_context_definition text;
  v_settings_definition text;
  v_onboarding_definition text;
begin
  select pg_get_viewdef('public.public_storefronts'::regclass, true)
  into v_storefronts_definition;

  select replace(pg_get_functiondef(
    'public.get_public_storefront_home(text)'::regprocedure
  ), chr(13), '') into v_public_home_definition;

  select replace(pg_get_functiondef(
    'public.get_seller_storefront_home_preview(text)'::regprocedure
  ), chr(13), '') into v_preview_definition;

  select replace(pg_get_functiondef(
    'public.get_seller_context()'::regprocedure
  ), chr(13), '') into v_context_definition;

  select replace(pg_get_functiondef(
    'public.seller_update_store_settings(uuid,jsonb)'::regprocedure
  ), chr(13), '') into v_settings_definition;

  select replace(pg_get_functiondef(
    'public.seller_save_onboarding_pickup(jsonb)'::regprocedure
  ), chr(13), '') into v_onboarding_definition;

  v_storefronts_definition := regexp_replace(
    v_storefronts_definition,
    'CASE[[:space:]]+WHEN stores\.show_public_website THEN stores\.website_url[[:space:]]+ELSE NULL::text[[:space:]]+END AS website_url',
    'stores.website_url',
    'i'
  );

  v_public_home_definition := regexp_replace(
    v_public_home_definition,
    'case[[:space:]]+when target_store\.show_public_website then target_store\.website_url[[:space:]]+else null[[:space:]]+end',
    'target_store.website_url',
    'i'
  );
  v_preview_definition := regexp_replace(
    v_preview_definition,
    'case[[:space:]]+when target_store\.show_public_website then target_store\.website_url[[:space:]]+else null[[:space:]]+end',
    'target_store.website_url',
    'i'
  );

  if position('show_public_website' in v_storefronts_definition) > 0
    or position('show_public_website' in v_public_home_definition) > 0
    or position('show_public_website' in v_preview_definition) > 0
  then
    raise exception 'Could not restore website_url as an operational storefront value.';
  end if;

  if position('public_phone text, website_url text' in v_public_home_definition) = 0
    or position('public_phone text, website_url text' in v_preview_definition) = 0
    or position(E'    end,\n    target_store.website_url,' in v_public_home_definition) = 0
    or position(E'    end,\n    target_store.website_url,' in v_preview_definition) = 0
  then
    raise exception 'Could not extend storefront contact context with phone preferences.';
  end if;

  v_public_home_definition := replace(
    v_public_home_definition,
    'public_phone text, website_url text',
    'public_phone text, buyer_contact_phone_enabled boolean, buyer_contact_text_enabled boolean, website_url text'
  );
  v_preview_definition := replace(
    v_preview_definition,
    'public_phone text, website_url text',
    'public_phone text, buyer_contact_phone_enabled boolean, buyer_contact_text_enabled boolean, website_url text'
  );
  v_public_home_definition := replace(
    v_public_home_definition,
    E'    end,\n    target_store.website_url,',
    E'    end,\n    target_store.buyer_contact_phone_enabled,\n    target_store.buyer_contact_text_enabled,\n    target_store.website_url,'
  );
  v_preview_definition := replace(
    v_preview_definition,
    E'    end,\n    target_store.website_url,',
    E'    end,\n    target_store.buyer_contact_phone_enabled,\n    target_store.buyer_contact_text_enabled,\n    target_store.website_url,'
  );

  v_context_definition := replace(
    v_context_definition,
    'show_public_phone boolean, show_public_website boolean, website_url text',
    'show_public_phone boolean, website_url text'
  );
  v_context_definition := replace(
    v_context_definition,
    E'    stores.show_public_website,\n',
    ''
  );
  v_context_definition := replace(
    v_context_definition,
    'show_public_phone boolean, website_url text',
    'show_public_phone boolean, buyer_contact_phone_enabled boolean, buyer_contact_text_enabled boolean, website_url text'
  );
  v_context_definition := replace(
    v_context_definition,
    E'    stores.show_public_phone,\n    stores.website_url',
    E'    stores.show_public_phone,\n    stores.buyer_contact_phone_enabled,\n    stores.buyer_contact_text_enabled,\n    stores.website_url'
  );

  v_settings_definition := replace(
    v_settings_definition,
    'show_public_phone boolean, show_public_website boolean, website_url text',
    'show_public_phone boolean, website_url text'
  );
  v_settings_definition := replace(
    v_settings_definition,
    E'    ''show_public_website'',\n',
    ''
  );
  v_settings_definition := regexp_replace(
    v_settings_definition,
    E'    show_public_website = case\n      when p_settings \\? ''show_public_website''\n        then coalesce\\(\n          \\(p_settings ->> ''show_public_website''\\)::boolean,\n          stores\\.show_public_website\n        \\)\n      else stores\\.show_public_website\n    end,\n',
    '',
    'i'
  );
  v_settings_definition := replace(
    v_settings_definition,
    E'    v_store.show_public_website,\n',
    ''
  );
  v_settings_definition := replace(
    v_settings_definition,
    'show_public_phone boolean, website_url text',
    'show_public_phone boolean, buyer_contact_phone_enabled boolean, buyer_contact_text_enabled boolean, website_url text'
  );
  v_settings_definition := replace(
    v_settings_definition,
    E'    ''show_public_phone'',\n    ''website_url''',
    E'    ''show_public_phone'',\n    ''buyer_contact_phone_enabled'',\n    ''buyer_contact_text_enabled'',\n    ''website_url'''
  );
  v_settings_definition := replace(
    v_settings_definition,
    E'    website_url = case',
    E'    buyer_contact_phone_enabled = case\n      when p_settings ? ''buyer_contact_phone_enabled''\n        then coalesce((p_settings ->> ''buyer_contact_phone_enabled'')::boolean, stores.buyer_contact_phone_enabled)\n      else stores.buyer_contact_phone_enabled\n    end,\n    buyer_contact_text_enabled = case\n      when p_settings ? ''buyer_contact_text_enabled''\n        then coalesce((p_settings ->> ''buyer_contact_text_enabled'')::boolean, stores.buyer_contact_text_enabled)\n      else stores.buyer_contact_text_enabled\n    end,\n    website_url = case'
  );
  v_settings_definition := replace(
    v_settings_definition,
    E'    v_store.show_public_phone,\n    v_store.website_url',
    E'    v_store.show_public_phone,\n    v_store.buyer_contact_phone_enabled,\n    v_store.buyer_contact_text_enabled,\n    v_store.website_url'
  );

  if position('show_public_website' in v_context_definition) > 0
    or position('show_public_website' in v_settings_definition) > 0
    or position('buyer_contact_text_enabled boolean' in v_context_definition) = 0
    or position('buyer_contact_text_enabled boolean' in v_settings_definition) = 0
  then
    raise exception 'Could not finalize seller public-contact contracts.';
  end if;

  v_onboarding_definition := replace(
    v_onboarding_definition,
    'Choose at least one buyer contact method.',
    'Choose at least one contact method to display on your storefront.'
  );
  if position('show_public_email = v_email_enabled' in v_onboarding_definition) = 0 then
    v_onboarding_definition := replace(
      v_onboarding_definition,
      E'      buyer_contact_phone_enabled = v_phone_enabled,\n      show_public_phone = (v_text_enabled or v_phone_enabled),',
      E'      buyer_contact_phone_enabled = v_phone_enabled,\n      show_public_email = v_email_enabled,\n      show_public_phone = (v_text_enabled or v_phone_enabled),'
    );
  end if;
  if position('show_public_email = v_email_enabled' in v_onboarding_definition) = 0 then
    raise exception 'Could not align onboarding email visibility.';
  end if;

  execute 'create or replace view public.public_storefronts '
    || 'with (security_barrier = true) as '
    || v_storefronts_definition;

  drop function public.get_public_storefront_home(text);
  drop function public.get_seller_storefront_home_preview(text);
  drop function public.get_seller_context();
  drop function public.seller_update_store_settings(uuid, jsonb);

  execute v_public_home_definition;
  execute v_preview_definition;
  execute v_context_definition;
  execute v_settings_definition;
  execute v_onboarding_definition;

  if position('show_public_website' in pg_get_viewdef(
    'public.public_storefronts'::regclass,
    true
  )) > 0 then
    raise exception 'public_storefronts still depends on website visibility.';
  end if;
end;
$migration$;

update public.stores
set show_public_email = true
where not show_public_email
  and not show_public_phone;

update public.stores
set buyer_contact_phone_enabled = true
where show_public_phone
  and not buyer_contact_phone_enabled
  and not buyer_contact_text_enabled;

alter table public.stores
  alter column show_public_email set default true;

create or replace function public.enforce_store_public_contact_method()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if not new.show_public_email and not new.show_public_phone then
    if tg_op = 'INSERT' then
      new.show_public_email := true;
    else
      raise exception 'Choose at least one contact method to display on your storefront.';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists stores_require_public_contact_method on public.stores;
create trigger stores_require_public_contact_method
before insert or update on public.stores
for each row execute function public.enforce_store_public_contact_method();

alter table public.stores
  add constraint stores_public_contact_method_required
  check (show_public_email or show_public_phone);

alter table public.stores
  drop column show_public_website;

comment on column public.stores.show_public_email is
'Seller visibility preference for the store owner account email. At least one of show_public_email or show_public_phone must be true.';

comment on column public.stores.show_public_phone is
'Seller visibility preference for public_phone. At least one of show_public_email or show_public_phone must be true.';

comment on function public.seller_save_onboarding_pickup(jsonb) is
'Saves pickup details and buyer contact preferences. Onboarding maps email to show_public_email and phone or text to show_public_phone.';

comment on function public.get_seller_context() is
'Seller dashboard bootstrap context. Returns only stores the current user owns or has scoped seller/staff membership for; platform admin status alone does not grant seller dashboard context.';

comment on function public.seller_update_store_settings(uuid, jsonb) is
'Seller/admin RPC for updating seller-editable storefront settings, including required public email or phone visibility.';

revoke all on function public.get_seller_context()
  from public, anon, authenticated, service_role;
grant execute on function public.get_seller_context() to authenticated;

revoke all on function public.seller_update_store_settings(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.seller_update_store_settings(uuid, jsonb)
  to authenticated;

revoke all on function public.seller_save_onboarding_pickup(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.seller_save_onboarding_pickup(jsonb)
  to authenticated;

commit;
