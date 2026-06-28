-- Seller onboarding Step 3: selling categories.
--
-- Adds a minimal progress flag and a trusted RPC that updates existing store
-- module toggles without activating the storefront or touching billing.

begin;

alter table public.seller_onboarding_state
add column if not exists categories_complete boolean not null default false;

comment on column public.seller_onboarding_state.categories_complete is
'True once the seller has reviewed selling categories during onboarding Step 3.';

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

  if not exists (
    select 1
    from public.seller_onboarding_state as sos
    where sos.store_id = v_store.id
      and sos.profile_complete = true
  ) then
    raise exception 'Complete farm basics before choosing selling categories.';
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
      false,
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
    4;
end;
$$;

comment on function public.seller_save_onboarding_categories(jsonb) is
'Trusted seller onboarding Step 3 category save. Updates draft store module toggles and marks categories complete without activating storefront or creating billing records.';

revoke all on function public.seller_save_onboarding_categories(jsonb) from public;
grant execute on function public.seller_save_onboarding_categories(jsonb) to authenticated;

commit;
