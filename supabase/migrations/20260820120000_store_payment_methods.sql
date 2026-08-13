-- Seller-configurable storefront payment methods.
-- Stripe connection/readiness remains authoritative and is stored separately.

alter table public.stores
  add column pay_at_pickup_enabled boolean not null default true,
  add column card_payments_enabled boolean not null default false,
  add constraint stores_payment_method_required_check
    check (pay_at_pickup_enabled or card_payments_enabled);

comment on column public.stores.pay_at_pickup_enabled is
'Seller choice to offer Pay at Pickup for new storefront orders.';

comment on column public.stores.card_payments_enabled is
'Seller choice to offer Stripe card checkout. This does not imply that Stripe is connected or ready.';

create or replace function public.seller_get_payment_methods(
  p_store_id uuid
)
returns table (
  store_id uuid,
  pay_at_pickup_enabled boolean,
  card_payments_enabled boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    stores.id,
    stores.pay_at_pickup_enabled,
    stores.card_payments_enabled
  from public.stores
  where stores.id = p_store_id
    and (public.owns_store(stores.id) or public.is_admin());
$$;

comment on function public.seller_get_payment_methods(uuid) is
'Returns the seller-selected storefront payment methods without exposing Stripe account data.';

revoke all on function public.seller_get_payment_methods(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.seller_get_payment_methods(uuid)
  to authenticated;

create or replace function public.seller_update_payment_methods(
  p_store_id uuid,
  p_pay_at_pickup_enabled boolean,
  p_card_payments_enabled boolean
)
returns table (
  store_id uuid,
  pay_at_pickup_enabled boolean,
  card_payments_enabled boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores%rowtype;
begin
  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if p_pay_at_pickup_enabled is null or p_card_payments_enabled is null then
    raise exception 'Payment method selections are required.';
  end if;

  if not p_pay_at_pickup_enabled and not p_card_payments_enabled then
    raise exception 'At least one payment method must be enabled.';
  end if;

  select stores.*
  into v_store
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

  update public.stores
  set
    pay_at_pickup_enabled = p_pay_at_pickup_enabled,
    card_payments_enabled = p_card_payments_enabled,
    updated_at = now()
  where stores.id = v_store.id;

  return query
  select
    stores.id,
    stores.pay_at_pickup_enabled,
    stores.card_payments_enabled
  from public.stores
  where stores.id = v_store.id;
end;
$$;

comment on function public.seller_update_payment_methods(uuid, boolean, boolean) is
'Updates the seller payment-method choices and requires at least one enabled method. Does not mutate Stripe connections.';

revoke all on function public.seller_update_payment_methods(uuid, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.seller_update_payment_methods(uuid, boolean, boolean)
  to authenticated;

create or replace function public.get_public_store_payment_methods(
  p_store_slug text
)
returns table (
  store_id uuid,
  pay_at_pickup_enabled boolean,
  card_payments_enabled boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    stores.id,
    stores.pay_at_pickup_enabled,
    stores.card_payments_enabled
  from public.stores
  join public.get_storefront_public_status(p_store_slug) as storefront_status
    on storefront_status.store_slug = stores.store_slug
  where storefront_status.store_exists = true
    and storefront_status.is_publicly_available = true;
$$;

comment on function public.get_public_store_payment_methods(text) is
'Public-safe payment-method choices for an available storefront. Stripe readiness is intentionally excluded.';

revoke all on function public.get_public_store_payment_methods(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_store_payment_methods(text)
  to anon, authenticated, service_role;

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
  left join public.public_storefront_home
    on public_storefront_home.store_slug = storefront_status.store_slug
  left join public.stores
    on stores.id = public_storefront_home.store_id;
$$;

comment on function public.get_public_storefront_by_slug(text) is
'Public-safe storefront lookup by slug, including seller-selected payment methods but no Stripe account data.';

revoke all on function public.get_public_storefront_by_slug(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_storefront_by_slug(text)
  to anon, authenticated, service_role;
