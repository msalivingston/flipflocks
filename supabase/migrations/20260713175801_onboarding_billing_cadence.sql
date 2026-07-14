-- Persist monthly/yearly seller onboarding billing cadence without Stripe.

begin;

drop function if exists public.seller_save_onboarding_plan_access(jsonb);

create or replace function public.seller_save_onboarding_plan_access(
  p_plan jsonb
)
returns table (
  store_id uuid,
  plan_key text,
  billing_plan text,
  subscription_status text,
  applied_promo_code text,
  trial_ends_at timestamptz,
  storefront_access_until timestamptz,
  billing_complete boolean,
  next_step integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_store public.stores%rowtype;
  v_plan jsonb := coalesce(p_plan, '{}'::jsonb);
  v_plan_key text;
  v_requested_billing_plan text;
  v_promo_code text;
  v_billing_plan text;
  v_subscription_status text;
  v_trial_ends_at timestamptz;
  v_storefront_access_until timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if jsonb_typeof(v_plan) <> 'object' then
    raise exception 'Plan access details must be provided.';
  end if;

  v_plan_key := nullif(trim(v_plan ->> 'plan_key'), '');
  if v_plan_key not in ('small_flock', 'full_flock') then
    raise exception 'Choose Small Flock or Full Flock before continuing.';
  end if;

  v_requested_billing_plan := coalesce(
    nullif(trim(v_plan ->> 'billing_plan'), ''),
    'monthly'
  );
  if v_requested_billing_plan not in ('monthly', 'yearly') then
    raise exception 'Choose monthly or yearly billing before continuing.';
  end if;

  v_promo_code := nullif(upper(trim(v_plan ->> 'promo_code')), '');

  if v_promo_code is not null and v_promo_code <> 'FOUNDINGFLOCK' then
    raise exception 'Invalid promo code.';
  end if;

  select s.*
  into v_store
  from public.stores as s
  left join public.user_roles as ur
    on ur.store_id = s.id
   and ur.user_id = v_user_id
   and ur.role in ('seller', 'staff')
  where s.owner_user_id = v_user_id
     or ur.store_id = s.id
  order by s.created_at asc
  limit 1
  for update of s;

  if v_store.id is null then
    raise exception 'Complete farm basics before choosing a plan.';
  end if;

  if not exists (
    select 1
    from public.seller_onboarding_state as sos
    where sos.store_id = v_store.id
      and sos.profile_complete = true
  ) then
    raise exception 'Complete farm basics before choosing a plan.';
  end if;

  if v_promo_code = 'FOUNDINGFLOCK' then
    v_billing_plan := 'comped';
    v_subscription_status := 'comped';
    v_trial_ends_at := null;
    v_storefront_access_until := null;
  else
    v_billing_plan := v_requested_billing_plan;
    v_subscription_status := 'trialing';
    v_trial_ends_at := now() + interval '7 days';
    v_storefront_access_until := v_trial_ends_at;
  end if;

  update public.seller_billing_status as sbs
  set
    plan_key = v_plan_key,
    billing_plan = v_billing_plan,
    subscription_status = v_subscription_status,
    current_period_start = now(),
    current_period_end = v_trial_ends_at,
    storefront_access_until = v_storefront_access_until,
    trial_ends_at = v_trial_ends_at,
    paused_at = null,
    dormancy_started_at = null,
    applied_promo_code = v_promo_code,
    updated_at = now()
  where sbs.store_id = v_store.id;

  if not found then
    insert into public.seller_billing_status (
      store_id,
      plan_key,
      billing_plan,
      subscription_status,
      current_period_start,
      current_period_end,
      storefront_access_until,
      trial_ends_at,
      applied_promo_code
    )
    values (
      v_store.id,
      v_plan_key,
      v_billing_plan,
      v_subscription_status,
      now(),
      v_trial_ends_at,
      v_storefront_access_until,
      v_trial_ends_at,
      v_promo_code
    );
  end if;

  update public.seller_onboarding_state as sos
  set
    billing_complete = true,
    categories_complete = false,
    updated_at = now()
  where sos.store_id = v_store.id;

  if not found then
    insert into public.seller_onboarding_state (
      store_id,
      profile_complete,
      categories_complete,
      pickup_complete,
      billing_complete,
      terms_accepted,
      first_listing_created,
      ready_to_launch
    )
    values (
      v_store.id,
      true,
      false,
      false,
      true,
      false,
      false,
      false
    );
  end if;

  return query
  select
    v_store.id,
    v_plan_key,
    v_billing_plan,
    v_subscription_status,
    v_promo_code,
    v_trial_ends_at,
    v_storefront_access_until,
    true,
    4;
end;
$$;

comment on function public.seller_save_onboarding_plan_access(jsonb) is
'Trusted seller onboarding Step 3 plan access save. Creates local monthly, yearly, or beta access state, stores plan_key, and does not create Stripe customer, subscription, checkout, or payment collection.';

revoke all on function public.seller_save_onboarding_plan_access(jsonb) from public;
grant execute on function public.seller_save_onboarding_plan_access(jsonb) to authenticated;

commit;
