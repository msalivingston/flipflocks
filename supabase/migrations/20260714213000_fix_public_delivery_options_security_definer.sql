-- Correct Phase 2B public delivery options RPC to run with the same
-- security-definer pattern used by the existing public storefront RPCs.

create or replace function public.get_public_storefront_delivery_options(
  p_store_slug text
)
returns table (
  delivery_option_id uuid,
  name text,
  price_amount numeric(10, 2),
  sort_order integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    store_delivery_options.id as delivery_option_id,
    store_delivery_options.name,
    store_delivery_options.price_amount,
    store_delivery_options.sort_order
  from public.get_storefront_public_status(p_store_slug) as storefront_status
  join public.stores
    on stores.store_slug = storefront_status.store_slug
   and storefront_status.is_publicly_available = true
   and stores.delivery_enabled = true
  join public.store_delivery_options
    on store_delivery_options.store_id = stores.id
   and store_delivery_options.is_active = true
  order by
    store_delivery_options.sort_order,
    store_delivery_options.created_at,
    store_delivery_options.id;
$$;

comment on function public.get_public_storefront_delivery_options(text) is
'Public checkout helper returning active delivery options for a public delivery-enabled store. Returns no rows for unavailable stores, disabled delivery, or no active options.';

revoke all on function public.get_public_storefront_delivery_options(text) from public;
grant execute on function public.get_public_storefront_delivery_options(text) to anon, authenticated;
