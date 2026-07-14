-- Reorder seller onboarding so plan access is selected before selling categories.

begin;

alter table public.seller_billing_status
add column if not exists plan_key text not null default 'full_flock';

alter table public.seller_billing_status
add column if not exists applied_promo_code text;

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
    raise exception 'Choose Coop or Market before continuing.';
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
    v_billing_plan := 'monthly';
    v_subscription_status := 'trialing';
    v_trial_ends_at := now() + interval '7 days';
    v_storefront_access_until := v_trial_ends_at;
  end if;

  update public.seller_billing_status as sbs
  set
    plan_key = v_plan_key,
    stripe_customer_id = null,
    stripe_subscription_id = null,
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
      stripe_customer_id,
      stripe_subscription_id,
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
      null,
      null,
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
'Trusted seller onboarding Step 3 plan access save. Creates local trial or beta access state, stores plan_key, and does not create Stripe customer, subscription, checkout, or payment collection.';

revoke all on function public.seller_save_onboarding_plan_access(jsonb) from public;
grant execute on function public.seller_save_onboarding_plan_access(jsonb) to authenticated;

drop function if exists public.seller_save_onboarding_categories(jsonb);

create or replace function public.seller_save_onboarding_categories(
  p_categories jsonb
)
returns table (
  store_id uuid,
  hatching_eggs_enabled boolean,
  processed_poultry_enabled boolean,
  equipment_supplies_enabled boolean,
  categories_complete boolean,
  next_step integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_store public.stores%rowtype;
  v_plan_key text;
  v_hatching_eggs_enabled boolean;
  v_processed_poultry_enabled boolean;
  v_equipment_supplies_enabled boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if p_categories is null or jsonb_typeof(p_categories) <> 'object' then
    raise exception 'Selling categories must be provided.';
  end if;

  v_hatching_eggs_enabled := coalesce((p_categories ->> 'hatching_eggs')::boolean, false);
  v_processed_poultry_enabled := coalesce((p_categories ->> 'poultry_products')::boolean, false);
  v_equipment_supplies_enabled := coalesce((p_categories ->> 'equipment_supplies')::boolean, false);

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
    raise exception 'Complete farm basics before choosing selling categories.';
  end if;

  select coalesce(sbs.plan_key, 'full_flock')
  into v_plan_key
  from public.seller_billing_status as sbs
  where sbs.store_id = v_store.id
  limit 1;

  if v_plan_key is null then
    raise exception 'Choose a plan before choosing selling categories.';
  end if;

  if not exists (
    select 1
    from public.seller_onboarding_state as sos
    where sos.store_id = v_store.id
      and sos.profile_complete = true
      and sos.billing_complete = true
  ) then
    raise exception 'Choose a plan before choosing selling categories.';
  end if;

  if v_plan_key = 'small_flock'
    and (
      v_hatching_eggs_enabled
      or v_processed_poultry_enabled
      or v_equipment_supplies_enabled
    ) then
    raise exception 'This category is included with Market.';
  end if;

  update public.stores as s
  set
    hatching_eggs_enabled = v_hatching_eggs_enabled,
    processed_poultry_enabled = v_processed_poultry_enabled,
    equipment_supplies_enabled = v_equipment_supplies_enabled,
    updated_at = now()
  where s.id = v_store.id
  returning s.* into v_store;

  update public.seller_onboarding_state as sos
  set
    categories_complete = true,
    updated_at = now()
  where sos.store_id = v_store.id;

  if not found then
    insert into public.seller_onboarding_state (
      store_id,
      profile_complete,
      categories_complete,
      billing_complete,
      terms_accepted,
      first_listing_created,
      ready_to_launch
    )
    values (
      v_store.id,
      true,
      true,
      true,
      false,
      false,
      false
    );
  end if;

  return query
  select
    v_store.id,
    v_store.hatching_eggs_enabled,
    v_store.processed_poultry_enabled,
    v_store.equipment_supplies_enabled,
    true,
    5;
end;
$$;

comment on function public.seller_save_onboarding_categories(jsonb) is
'Trusted seller onboarding Step 4 category save. Updates draft store module toggles after plan selection and marks categories complete without activating storefront.';

revoke all on function public.seller_save_onboarding_categories(jsonb) from public;
grant execute on function public.seller_save_onboarding_categories(jsonb) to authenticated;

drop function if exists public.seller_save_onboarding_pickup(jsonb);

create or replace function public.seller_save_onboarding_pickup(
  p_pickup jsonb
)
returns table (
  store_id uuid,
  pickup_complete boolean,
  next_step integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_store public.stores%rowtype;
  v_pickup_instructions text;
  v_email_enabled boolean;
  v_text_enabled boolean;
  v_phone_enabled boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if p_pickup is null or jsonb_typeof(p_pickup) <> 'object' then
    raise exception 'Pickup details must be provided.';
  end if;

  v_pickup_instructions := nullif(trim(p_pickup ->> 'pickup_instructions'), '');
  v_email_enabled := coalesce((p_pickup ->> 'email_enabled')::boolean, false);
  v_text_enabled := coalesce((p_pickup ->> 'text_enabled')::boolean, false);
  v_phone_enabled := coalesce((p_pickup ->> 'phone_enabled')::boolean, false);

  if v_pickup_instructions is null then
    raise exception 'Pickup instructions are required.';
  end if;

  if not (v_email_enabled or v_text_enabled or v_phone_enabled) then
    raise exception 'Choose at least one buyer contact method.';
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
    raise exception 'Complete farm basics before saving pickup instructions.';
  end if;

  if not exists (
    select 1
    from public.seller_onboarding_state as sos
    where sos.store_id = v_store.id
      and sos.profile_complete = true
      and sos.billing_complete = true
      and sos.categories_complete = true
  ) then
    raise exception 'Complete selling categories before saving pickup instructions.';
  end if;

  update public.stores as s
  set
    pickup_instructions = v_pickup_instructions,
    buyer_contact_email_enabled = v_email_enabled,
    buyer_contact_text_enabled = v_text_enabled,
    buyer_contact_phone_enabled = v_phone_enabled,
    show_public_phone = (v_text_enabled or v_phone_enabled),
    updated_at = now()
  where s.id = v_store.id
  returning s.* into v_store;

  update public.seller_onboarding_state as sos
  set
    pickup_complete = true,
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
      true,
      true,
      true,
      false,
      false,
      false
    );
  end if;

  return query
  select
    v_store.id,
    true,
    6;
end;
$$;

comment on function public.seller_save_onboarding_pickup(jsonb) is
'Trusted seller onboarding Step 5 pickup save. Updates pickup instructions and buyer contact preferences without activating storefront or creating billing records.';

revoke all on function public.seller_save_onboarding_pickup(jsonb) from public;
grant execute on function public.seller_save_onboarding_pickup(jsonb) to authenticated;

commit;
