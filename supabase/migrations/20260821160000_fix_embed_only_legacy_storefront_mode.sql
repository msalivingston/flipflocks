-- Embed-only visibility is an active selling mode. A legacy private
-- storefront_mode blocks every buyer-safe storefront projection before the
-- embed route can validate its signed return context.
begin;

create or replace function public.seller_update_store_visibility(
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
    storefront_mode = case
      when p_visibility = 'embed_only' and stores.storefront_mode = 'private'
        then 'embedded'
      else stores.storefront_mode
    end,
    website_url = v_website_url,
    updated_at = now()
  where stores.id = v_store.id
  returning stores.* into v_store;

  return query
  select v_store.id, v_store.storefront_visibility, v_store.website_url;
end;
$function$;

comment on function public.seller_update_store_visibility(
  uuid, public.storefront_visibility, text
) is
'Updates seller storefront visibility and website URL. Selecting embed-only visibility normalizes a legacy private storefront mode to embedded without changing publication or entitlement state.';

revoke all on function public.seller_update_store_visibility(
  uuid, public.storefront_visibility, text
) from public, anon;
grant execute on function public.seller_update_store_visibility(
  uuid, public.storefront_visibility, text
) to authenticated;

-- Repair stores already saved in the invalid combination. All launch,
-- storefront-enabled, entitlement, inventory, and moderation gates remain in
-- their existing buyer-safe projections.
update public.stores
set
  storefront_mode = 'embedded',
  updated_at = now()
where storefront_visibility = 'embed_only'
  and storefront_mode = 'private';

alter table public.stores
add constraint stores_embed_only_not_private_mode_check check (
  storefront_visibility <> 'embed_only'
  or storefront_mode <> 'private'
);

comment on constraint stores_embed_only_not_private_mode_check
on public.stores is
'Embed-only stores must remain eligible for buyer-safe embedded storefront projections; storefront_enabled, status, entitlement, inventory, and moderation checks still apply.';

commit;
