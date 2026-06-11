-- Keep normal seller dashboard bootstrap scoped to actual seller access.
--
-- Platform admins keep support-safe access through explicit /admin RPCs.
-- This function is used by /dashboard/* and must not turn platform-admin
-- status into seller dashboard context.

begin;

create or replace function public.get_seller_context()
returns table (
  store_id uuid,
  store_name text,
  store_tagline text,
  store_slug text,
  store_status text,
  storefront_mode text,
  storefront_enabled boolean,
  hatching_eggs_enabled boolean,
  equipment_supplies_enabled boolean,
  processed_poultry_enabled boolean,
  is_publicly_available boolean,
  public_city text,
  public_state text,
  public_country text,
  about_text text,
  pickup_policy text,
  cancellation_policy text,
  pickup_instructions text,
  public_email text,
  public_phone text,
  show_public_email boolean,
  show_public_phone boolean,
  website_url text,
  social_url text,
  npip_number text,
  show_npip boolean,
  order_notification_email text,
  billing_plan text,
  subscription_status text,
  storefront_access_until timestamptz,
  trial_ends_at timestamptz,
  profile_complete boolean,
  billing_complete boolean,
  terms_accepted boolean,
  first_listing_created boolean,
  ready_to_launch boolean,
  launched_at timestamptz,
  role text,
  is_admin boolean,
  other_policies text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    stores.id as store_id,
    stores.store_name,
    stores.store_tagline,
    stores.store_slug,
    stores.store_status,
    stores.storefront_mode,
    stores.storefront_enabled,
    stores.hatching_eggs_enabled,
    stores.equipment_supplies_enabled,
    stores.processed_poultry_enabled,
    (
      stores.storefront_enabled = true
      and stores.store_status = 'live'
      and stores.storefront_mode in ('hosted', 'embedded')
      and stores.admin_hold_reason is null
    ) as is_publicly_available,
    stores.public_city,
    stores.public_state,
    stores.public_country,
    stores.about_text,
    stores.pickup_policy,
    stores.cancellation_policy,
    stores.pickup_instructions,
    stores.public_email,
    stores.public_phone,
    stores.show_public_email,
    stores.show_public_phone,
    stores.website_url,
    stores.social_url,
    stores.npip_number,
    stores.show_npip,
    stores.order_notification_email,
    seller_billing_status.billing_plan,
    seller_billing_status.subscription_status,
    seller_billing_status.storefront_access_until,
    seller_billing_status.trial_ends_at,
    coalesce(seller_onboarding_state.profile_complete, false) as profile_complete,
    coalesce(seller_onboarding_state.billing_complete, false) as billing_complete,
    coalesce(seller_onboarding_state.terms_accepted, false) as terms_accepted,
    coalesce(seller_onboarding_state.first_listing_created, false) as first_listing_created,
    coalesce(seller_onboarding_state.ready_to_launch, false) as ready_to_launch,
    seller_onboarding_state.launched_at,
    user_roles.role,
    public.is_admin() as is_admin,
    stores.other_policies
  from public.stores
  left join public.user_roles
    on user_roles.store_id = stores.id
   and user_roles.user_id = auth.uid()
   and user_roles.role in ('seller', 'staff')
  left join public.seller_billing_status
    on seller_billing_status.store_id = stores.id
  left join public.seller_onboarding_state
    on seller_onboarding_state.store_id = stores.id
  where stores.owner_user_id = auth.uid()
     or user_roles.store_id = stores.id;
$$;

comment on function public.get_seller_context() is
'Seller dashboard bootstrap context. Returns only stores the current user owns or has scoped seller/staff membership for; platform admin status alone does not grant /dashboard seller context.';

revoke all on function public.get_seller_context() from public;
grant execute on function public.get_seller_context() to authenticated;

commit;
