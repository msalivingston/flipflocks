begin;

-- Preserve existing preferences: their provenance cannot be inferred from the
-- current boolean values. New stores must make an explicit contact choice.
alter table public.stores
  alter column show_public_email set default false,
  alter column buyer_contact_email_enabled set default false;

alter table public.stores drop constraint stores_public_contact_method_required;
alter table public.stores add constraint stores_public_contact_method_required
  check (
    not (store_status = 'live' and storefront_enabled
      and storefront_mode in ('hosted', 'embedded'))
    or show_public_email
    or (show_public_phone and nullif(btrim(public_phone), '') is not null)
  );

-- The trigger also verifies that the selected contact value actually exists.
create or replace function public.enforce_store_public_contact_method()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.store_status = 'live' and new.storefront_enabled
    and new.storefront_mode in ('hosted', 'embedded')
    and not (
      (new.show_public_email and exists (
        select 1 from auth.users u
        where u.id = new.owner_user_id and nullif(btrim(u.email::text), '') is not null
      ))
      or (new.show_public_phone and nullif(btrim(new.public_phone), '') is not null)
    ) then
    raise exception 'Choose at least one contact method to display on your published storefront: account email or a saved phone number.';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_store_public_contact_method() from public, anon, authenticated;

-- A non-API schema keeps auth.users out of the public view's table dependency
-- graph. No copied/editable email exists: every call resolves the current owner.
create schema if not exists private;
revoke all on schema private from public;

create function private.storefront_account_email(p_store_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select lower(nullif(btrim(u.email::text), ''))
  from public.stores s
  join auth.users u on u.id = s.owner_user_id
  where s.id = p_store_id and s.show_public_email
    and (
      public.owns_store(s.id) or public.is_admin()
      or (s.storefront_enabled and s.store_status = 'live'
        and s.storefront_mode in ('hosted', 'embedded')
        and s.admin_hold_reason is null
        and public.store_has_active_entitlement(s.id))
    );
$$;
revoke all on function private.storefront_account_email(uuid) from public;
grant execute on function private.storefront_account_email(uuid) to anon, authenticated, service_role;

-- Preserve all existing view/RPC columns, guards, and grants. Replace only the
-- owner-email scalar subquery, failing if the expected definition differs.
do $migration$
declare
  definition text;
  revised text;
  signature text;
begin
  select pg_get_viewdef('public.public_storefronts'::regclass, true) into definition;
  revised := regexp_replace(definition,
    '\(\s*SELECT lower\(NULLIF\(TRIM\(BOTH FROM owner_users.email(::text)?\), ''''::text\)\) AS lower\s+FROM auth.users owner_users\s+WHERE owner_users.id = stores.owner_user_id\)',
    'private.storefront_account_email(stores.id)', 'i');
  if revised = definition or revised like '%auth.users%' then
    raise exception 'Could not isolate public_storefronts account email lookup.';
  end if;
  execute 'create or replace view public.public_storefronts with (security_barrier = true) as ' || revised;

  foreach signature in array array[
    'public.get_public_storefront_home(text)',
    'public.get_seller_storefront_home_preview(text)'
  ] loop
    select pg_get_functiondef(signature::regprocedure) into definition;
    revised := regexp_replace(definition,
      '\(\s*select lower\(nullif\(trim\(owner_users.email::text\), ''''\)\)\s+from auth.users as owner_users\s+where owner_users.id = target_store.owner_user_id\s*\)',
      'private.storefront_account_email(target_store.id)', 'i');
    if revised = definition or revised like '%auth.users%' then
      raise exception 'Could not isolate account email lookup in %.', signature;
    end if;
    execute revised;
  end loop;

  -- Onboarding must not accept a phone choice that cannot appear publicly.
  select replace(pg_get_functiondef('public.seller_save_onboarding_pickup(jsonb)'::regprocedure), chr(13), '')
  into definition;
  revised := replace(definition,
    E'  update public.stores\n  set pickup_address_line1',
    E'  if (v_phone_enabled or v_text_enabled) and nullif(btrim(v_store.public_phone), '''') is null then\n    raise exception ''Save a phone number before choosing public phone or text contact.'';\n  end if;\n\n  update public.stores\n  set pickup_address_line1');
  if revised = definition then
    raise exception 'Could not locate onboarding contact validation.';
  end if;
  execute revised;
end;
$migration$;

comment on column public.stores.show_public_email is
'Explicit visibility setting for the current owner account email. Defaults to private for new stores. Published storefronts require public email or a saved public phone.';

commit;
