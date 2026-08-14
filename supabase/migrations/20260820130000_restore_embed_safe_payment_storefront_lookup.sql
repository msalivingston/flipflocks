-- Restore the canonical embed-safe storefront lookup after Payment Methods.
-- Public discovery remains governed by the existing discovery projections.

create or replace function public.get_public_storefront_by_slug(
  p_store_slug text
)
returns table (
  store_slug text,
  store_exists boolean,
  is_publicly_available boolean,
  message text,
  storefront jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    storefront_status.store_slug,
    storefront_status.store_exists,
    storefront_status.is_publicly_available,
    storefront_status.message,
    case
      when storefront_status.is_publicly_available then
        to_jsonb(public_storefront_home)
        || jsonb_build_object(
          'pay_at_pickup_enabled', stores.pay_at_pickup_enabled,
          'card_payments_enabled', stores.card_payments_enabled
        )
      else null::jsonb
    end as storefront
  from public.get_storefront_public_status(p_store_slug) as storefront_status
  left join lateral public.get_public_storefront_home(
    storefront_status.store_slug
  ) as public_storefront_home on true
  left join public.stores
    on stores.id = public_storefront_home.store_id;
$$;

comment on function public.get_public_storefront_by_slug(text) is
'Public-safe storefront lookup by slug using the canonical embed-safe storefront home, including seller-selected payment methods but no Stripe account data.';

revoke all on function public.get_public_storefront_by_slug(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_storefront_by_slug(text)
  to anon, authenticated, service_role;
