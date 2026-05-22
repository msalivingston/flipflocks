-- Group 14: Public Storefront Delivery Foundation
--
-- Scope:
-- - Adds reserved platform route protection for stores.store_slug.
-- - Adds a public-safe storefront status lookup function for hosted storefront delivery.
--
-- This group does not add:
-- - storefront widgets
-- - buyer accounts
-- - alerts
-- - messaging
-- - reviews or ratings
-- - SEO systems
-- - slug history
-- - slug moderation systems
-- - trademark enforcement
-- - payment features
-- - order edit links
-- - search systems
-- - marketplace features


do $$
declare
  v_conflicting_slugs text;
begin
  select string_agg(stores.store_slug, ', ' order by stores.store_slug)
  into v_conflicting_slugs
  from public.stores
  where stores.store_slug in (
    'admin',
    'api',
    'auth',
    'login',
    'logout',
    'signup',
    'register',
    'account',
    'dashboard',
    'settings',
    'support',
    'help',
    'search',
    'discover',
    'marketplace',
    'stores',
    'store',
    'checkout',
    'cart',
    'orders',
    'order',
    'terms',
    'privacy',
    'pricing',
    'embed',
    'widgets',
    'assets',
    'static',
    'flipflocks'
  );

  if v_conflicting_slugs is not null then
    raise exception
      'Cannot add reserved store slug protection. Existing stores use reserved slug(s): %',
      v_conflicting_slugs;
  end if;
end;
$$;


alter table public.stores
add constraint stores_store_slug_reserved_check check (
  store_slug not in (
    'admin',
    'api',
    'auth',
    'login',
    'logout',
    'signup',
    'register',
    'account',
    'dashboard',
    'settings',
    'support',
    'help',
    'search',
    'discover',
    'marketplace',
    'stores',
    'store',
    'checkout',
    'cart',
    'orders',
    'order',
    'terms',
    'privacy',
    'pricing',
    'embed',
    'widgets',
    'assets',
    'static',
    'flipflocks'
  )
);

comment on constraint stores_store_slug_reserved_check on public.stores is
'Prevents store slugs from colliding with reserved FlipFlocks platform routes. This is exact reserved route matching only, not trademark or content moderation enforcement.';


create or replace function public.get_storefront_public_status(
  p_store_slug text
)
returns table (
  store_slug text,
  store_exists boolean,
  is_publicly_available boolean,
  message text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_normalized_slug text;
  v_store record;
  v_is_publicly_available boolean;
begin
  v_normalized_slug := lower(trim(p_store_slug));

  if v_normalized_slug is null or v_normalized_slug = '' then
    return query
    select
      null::text,
      false,
      false,
      'not_found'::text;
    return;
  end if;

  select
    stores.store_slug,
    stores.store_status,
    stores.storefront_mode,
    stores.admin_hold_reason
  into v_store
  from public.stores
  where stores.store_slug = v_normalized_slug
  limit 1;

  if not found then
    return query
    select
      v_normalized_slug,
      false,
      false,
      'not_found'::text;
    return;
  end if;

  v_is_publicly_available :=
    v_store.store_status = 'live'
    and v_store.storefront_mode in ('hosted', 'embedded')
    and v_store.admin_hold_reason is null;

  return query
  select
    v_store.store_slug::text,
    true,
    v_is_publicly_available,
    case
      when v_is_publicly_available then null::text
      else 'This store is currently unavailable.'::text
    end;
end;
$$;

comment on function public.get_storefront_public_status(text) is
'Public-safe hosted storefront status lookup. Distinguishes not found, unavailable, and publicly available stores without exposing internal status reasons such as admin hold details or suspension context.';


revoke all on function public.get_storefront_public_status(text) from public;
grant execute on function public.get_storefront_public_status(text) to anon, authenticated;
