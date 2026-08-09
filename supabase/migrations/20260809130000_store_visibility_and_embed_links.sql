begin;

create type public.storefront_visibility as enum ('public', 'embed_only');

alter table public.stores
add column storefront_visibility public.storefront_visibility not null default 'public';

comment on column public.stores.storefront_visibility is
'Controls whether an otherwise available store has a public hosted storefront or is reachable only through validated embedded-order routes. Store status and storefront_enabled remain authoritative availability controls.';

create function public.is_valid_seller_https_website_url(p_value text)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $function$
declare
  v_match text[];
begin
  if p_value is null
     or p_value <> btrim(p_value)
     or octet_length(p_value) not between 12 and 2048
     or p_value ~ '[[:cntrl:][:space:]\\]' then
    return false;
  end if;

  v_match := regexp_match(
    p_value,
    '^https://([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\])(?::([0-9]{1,5}))?(?:[/?#].*)?$'
  );

  if v_match is null then return false; end if;
  if v_match[2] is not null and v_match[2]::integer > 65535 then
    return false;
  end if;

  return true;
end;
$function$;

alter table public.stores
add constraint stores_embed_only_requires_https_website_check check (
  storefront_visibility = 'public'
  or public.is_valid_seller_https_website_url(website_url)
);

create function public.seller_get_store_visibility(p_store_id uuid)
returns table (
  store_id uuid,
  storefront_visibility public.storefront_visibility,
  website_url text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select stores.id, stores.storefront_visibility, stores.website_url
  from public.stores
  where stores.id = p_store_id
    and (public.owns_store(stores.id) or public.is_admin());
$function$;

revoke all on function public.seller_get_store_visibility(uuid) from public, anon;
grant execute on function public.seller_get_store_visibility(uuid) to authenticated;

create function public.seller_update_store_visibility(
  p_store_id uuid,
  p_visibility public.storefront_visibility,
  p_website_url text
)
returns table (
  store_id uuid,
  storefront_visibility public.storefront_visibility,
  website_url text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_store public.stores%rowtype;
  v_website_url text := nullif(btrim(p_website_url), '');
begin
  if p_store_id is null or p_visibility is null then
    raise exception 'Store and visibility are required.';
  end if;

  select stores.* into v_store
  from public.stores
  where stores.id = p_store_id
  for update;

  if v_store.id is null then
    raise exception 'Store is not available.';
  end if;

  if not (public.owns_store(v_store.id) or public.is_admin()) then
    raise exception 'Not authorized to update this store.';
  end if;

  if v_store.store_status in ('suspended', 'canceled') then
    raise exception 'Suspended or canceled stores cannot update seller settings.';
  end if;

  if p_visibility = 'embed_only'
     and not public.is_valid_seller_https_website_url(v_website_url) then
    raise exception 'A valid HTTPS Website URL must be saved before the store can be website embed only.';
  end if;

  update public.stores
  set
    storefront_visibility = p_visibility,
    website_url = v_website_url,
    updated_at = now()
  where stores.id = v_store.id
  returning stores.* into v_store;

  return query
  select v_store.id, v_store.storefront_visibility, v_store.website_url;
end;
$function$;

revoke all on function public.seller_update_store_visibility(
  uuid, public.storefront_visibility, text
) from public, anon;
grant execute on function public.seller_update_store_visibility(
  uuid, public.storefront_visibility, text
) to authenticated;

create function public.get_public_storefront_access(p_store_slug text)
returns table (
  store_slug text,
  storefront_visibility public.storefront_visibility,
  website_url text,
  is_publicly_available boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select
    stores.store_slug,
    stores.storefront_visibility,
    stores.website_url,
    status.is_publicly_available
  from public.stores
  cross join lateral public.get_storefront_public_status(stores.store_slug) as status
  where stores.store_slug = lower(btrim(p_store_slug));
$function$;

revoke all on function public.get_public_storefront_access(text) from public;
grant execute on function public.get_public_storefront_access(text) to anon, authenticated;

-- The embed consumes the buyer-safe storefront projections, so those projections
-- intentionally retain embed-only stores. Only true discovery surfaces are
-- narrowed here; hosted route boundaries enforce browsing visibility.
do $block$
declare
  v_name text;
  v_definition text;
begin
  foreach v_name in array array[
    'public_storefronts',
    'public_discoverable_storefronts',
    'public_discoverable_inventory'
  ]
  loop
    if to_regclass('public.' || v_name) is null then
      raise exception 'Expected discovery view public.% is missing.', v_name;
    end if;

    select regexp_replace(
      pg_get_viewdef(format('public.%I', v_name)::regclass, true),
      ';[[:space:]]*$',
      ''
    ) into v_definition;

    execute format(
      'create or replace view public.%I with (security_barrier = true) as
       select visibility_source.*
       from (%s) as visibility_source
       where exists (
         select 1 from public.stores
         where stores.id = visibility_source.store_id
           and stores.storefront_visibility = ''public''
       )',
      v_name,
      v_definition
    );
  end loop;
end;
$block$;

comment on view public.public_storefronts is
'Official public hosted-store projection. Embed-only stores are excluded; embed inventory continues through the existing buyer-safe storefront projections.';

comment on view public.public_discoverable_storefronts is
'Public store discovery projection. Embed-only stores are excluded.';

comment on view public.public_discoverable_inventory is
'Public inventory discovery projection. Inventory belonging to embed-only stores is excluded.';

commit;
