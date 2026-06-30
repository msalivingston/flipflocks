alter table public.seller_billing_status
add column if not exists plan_key text not null default 'full_flock';

alter table public.seller_billing_status
drop constraint if exists seller_billing_status_plan_key_check;

alter table public.seller_billing_status
add constraint seller_billing_status_plan_key_check
check (plan_key in ('small_flock', 'full_flock'));

create index if not exists seller_billing_status_plan_key_idx
on public.seller_billing_status(plan_key);

create or replace function public.get_store_plan_key(p_store_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select seller_billing_status.plan_key
      from public.seller_billing_status
      where seller_billing_status.store_id = p_store_id
      limit 1
    ),
    'full_flock'
  );
$$;

create or replace function public.live_bird_plan_units(
  p_inventory_type text,
  p_quantity integer
)
returns integer
language sql
immutable
as $$
  select case
    when p_inventory_type in ('female', 'male', 'straight_run', 'unsexed') then greatest(coalesce(p_quantity, 0), 0)
    when p_inventory_type = 'pair' then greatest(coalesce(p_quantity, 0), 0) * 2
    when p_inventory_type = 'trio' then greatest(coalesce(p_quantity, 0), 0) * 3
    else 0
  end;
$$;

create or replace function public.small_flock_active_live_bird_units(
  p_store_id uuid,
  p_excluded_listing_batch_id uuid default null,
  p_excluded_inventory_item_id uuid default null
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(public.live_bird_plan_units(ii.inventory_type, ii.quantity_available)), 0)::integer
  from public.inventory_items as ii
  join public.listing_batches as lb
    on lb.id = ii.listing_batch_id
  join public.listing_batch_breeds as lbb
    on lbb.id = ii.listing_batch_breed_id
  where ii.store_id = p_store_id
    and lb.batch_type = 'live_animals'
    and lb.visibility_status = 'active'
    and lbb.visibility_status = 'active'
    and ii.visibility_status = 'active'
    and ii.quantity_available > 0
    and (p_excluded_listing_batch_id is null or lb.id <> p_excluded_listing_batch_id)
    and (p_excluded_inventory_item_id is null or ii.id <> p_excluded_inventory_item_id);
$$;

create or replace function public.assert_store_plan_allows_store_modules(
  p_store_id uuid,
  p_hatching_eggs_enabled boolean,
  p_equipment_supplies_enabled boolean,
  p_processed_poultry_enabled boolean
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.get_store_plan_key(p_store_id) = 'small_flock'
    and (
      coalesce(p_hatching_eggs_enabled, false)
      or coalesce(p_equipment_supplies_enabled, false)
      or coalesce(p_processed_poultry_enabled, false)
    ) then
    raise exception 'Small Flock includes live birds only. Upgrade to Full Flock to enable hatching eggs, equipment, or processed poultry.';
  end if;
end;
$$;

create or replace function public.assert_store_plan_allows_inventory_item(
  p_store_id uuid,
  p_listing_batch_id uuid,
  p_batch_type text,
  p_inventory_type text,
  p_custom_inventory_label text,
  p_quantity_available integer,
  p_visibility_status text,
  p_excluded_inventory_item_id uuid default null
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan_key text;
  v_batch_status text;
  v_existing_units integer;
  v_new_units integer;
begin
  v_plan_key := public.get_store_plan_key(p_store_id);

  if v_plan_key <> 'small_flock' then
    return;
  end if;

  if p_batch_type = 'hatching_eggs' or p_inventory_type = 'hatching_eggs' then
    raise exception 'Hatching egg listings are included with Full Flock.';
  end if;

  if p_inventory_type = 'other' then
    raise exception 'Flock and group listings are included with Full Flock. Small Flock supports single birds, pairs, and trios.';
  end if;

  if p_inventory_type not in ('female', 'male', 'straight_run', 'unsexed', 'pair', 'trio') then
    raise exception 'This live bird offering is included with Full Flock.';
  end if;

  select lb.visibility_status
  into v_batch_status
  from public.listing_batches as lb
  where lb.id = p_listing_batch_id;

  if coalesce(p_visibility_status, 'hidden') = 'active'
    and v_batch_status = 'active' then
    v_existing_units := public.small_flock_active_live_bird_units(
      p_store_id,
      null,
      p_excluded_inventory_item_id
    );
    v_new_units := public.live_bird_plan_units(
      p_inventory_type,
      p_quantity_available
    );

    if v_existing_units + v_new_units > 5 then
      raise exception 'Small Flock includes up to 5 active birds for sale at one time. Upgrade to Full Flock for unlimited live bird quantities.';
    end if;
  end if;
end;
$$;

create or replace function public.assert_store_plan_allows_listing_batch_activation(
  p_listing_batch_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_batch public.listing_batches%rowtype;
  v_existing_units integer;
  v_batch_units integer;
begin
  select *
  into v_batch
  from public.listing_batches
  where listing_batches.id = p_listing_batch_id;

  if v_batch.id is null or public.get_store_plan_key(v_batch.store_id) <> 'small_flock' then
    return;
  end if;

  if v_batch.batch_type = 'hatching_eggs' then
    raise exception 'Hatching egg listings are included with Full Flock.';
  end if;

  if coalesce(v_batch.auto_price_adjustment_enabled, false) then
    raise exception 'Age-Based Pricing is included with Full Flock. List growing birds once and let pricing adjust as they age.';
  end if;

  if exists (
    select 1
    from public.inventory_items as ii
    where ii.listing_batch_id = v_batch.id
      and ii.visibility_status = 'active'
      and ii.inventory_type = 'other'
  ) then
    raise exception 'Flock and group listings are included with Full Flock. Small Flock supports single birds, pairs, and trios.';
  end if;

  v_existing_units := public.small_flock_active_live_bird_units(
    v_batch.store_id,
    v_batch.id,
    null
  );

  select coalesce(sum(public.live_bird_plan_units(ii.inventory_type, ii.quantity_available)), 0)::integer
  into v_batch_units
  from public.inventory_items as ii
  join public.listing_batch_breeds as lbb
    on lbb.id = ii.listing_batch_breed_id
  where ii.listing_batch_id = v_batch.id
    and ii.visibility_status = 'active'
    and lbb.visibility_status = 'active'
    and ii.quantity_available > 0;

  if v_existing_units + coalesce(v_batch_units, 0) > 5 then
    raise exception 'Small Flock includes up to 5 active birds for sale at one time. Upgrade to Full Flock for unlimited live bird quantities.';
  end if;
end;
$$;

drop function if exists public.get_seller_context();

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
  plan_key text,
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
    coalesce(seller_billing_status.plan_key, 'full_flock') as plan_key,
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
     or user_roles.user_id = auth.uid()
     or public.is_admin();
$$;

revoke all on function public.get_store_plan_key(uuid) from public;
revoke all on function public.small_flock_active_live_bird_units(uuid, uuid, uuid) from public;
revoke all on function public.assert_store_plan_allows_store_modules(uuid, boolean, boolean, boolean) from public;
revoke all on function public.assert_store_plan_allows_inventory_item(uuid, uuid, text, text, text, integer, text, uuid) from public;
revoke all on function public.assert_store_plan_allows_listing_batch_activation(uuid) from public;
revoke all on function public.get_seller_context() from public;

grant execute on function public.get_store_plan_key(uuid) to authenticated;
grant execute on function public.small_flock_active_live_bird_units(uuid, uuid, uuid) to authenticated;
grant execute on function public.get_seller_context() to authenticated;

create or replace function public.enforce_store_plan_modules_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_store_plan_key(new.id) <> 'small_flock' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform public.assert_store_plan_allows_store_modules(
      new.id,
      new.hatching_eggs_enabled,
      new.equipment_supplies_enabled,
      new.processed_poultry_enabled
    );

    return new;
  end if;

  if coalesce(old.hatching_eggs_enabled, false) = false
    and coalesce(new.hatching_eggs_enabled, false) = true then
    raise exception 'Hatching egg listings are included with Full Flock.';
  end if;

  if coalesce(old.equipment_supplies_enabled, false) = false
    and coalesce(new.equipment_supplies_enabled, false) = true then
    raise exception 'Equipment and supply listings are included with Full Flock.';
  end if;

  if coalesce(old.processed_poultry_enabled, false) = false
    and coalesce(new.processed_poultry_enabled, false) = true then
    raise exception 'Processed poultry listings are included with Full Flock.';
  end if;

  return new;
end;
$$;

drop trigger if exists stores_plan_modules_guard on public.stores;
create trigger stores_plan_modules_guard
before insert or update of hatching_eggs_enabled, equipment_supplies_enabled, processed_poultry_enabled
on public.stores
for each row
execute function public.enforce_store_plan_modules_trigger();

create or replace function public.enforce_listing_batch_plan_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_store_plan_key(new.store_id) = 'small_flock' then
    if tg_op = 'INSERT' and new.batch_type = 'hatching_eggs' then
      raise exception 'Hatching egg listings are included with Full Flock.';
    end if;

    if tg_op = 'UPDATE'
      and old.batch_type is distinct from new.batch_type
      and new.batch_type = 'hatching_eggs' then
      raise exception 'Hatching egg listings are included with Full Flock.';
    end if;

    if tg_op = 'INSERT'
      and coalesce(new.auto_price_adjustment_enabled, false) then
      raise exception 'Age-Based Pricing is included with Full Flock. List growing birds once and let pricing adjust as they age.';
    end if;

    if tg_op = 'UPDATE'
      and coalesce(old.auto_price_adjustment_enabled, false) = false
      and coalesce(new.auto_price_adjustment_enabled, false) = true then
      raise exception 'Age-Based Pricing is included with Full Flock. List growing birds once and let pricing adjust as they age.';
    end if;

    if new.visibility_status = 'active' then
      if new.batch_type = 'hatching_eggs' then
        raise exception 'Hatching egg listings are included with Full Flock.';
      end if;

      if coalesce(new.auto_price_adjustment_enabled, false) then
        raise exception 'Age-Based Pricing is included with Full Flock. List growing birds once and let pricing adjust as they age.';
      end if;

      if tg_op = 'INSERT'
        or old.visibility_status is distinct from new.visibility_status then
        perform public.assert_store_plan_allows_listing_batch_activation(new.id);
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists listing_batches_plan_guard on public.listing_batches;
create trigger listing_batches_plan_guard
before insert or update of batch_type, visibility_status, auto_price_adjustment_enabled
on public.listing_batches
for each row
execute function public.enforce_listing_batch_plan_trigger();

create or replace function public.enforce_inventory_item_plan_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.listing_batches%rowtype;
  v_old_units integer;
  v_new_units integer;
begin
  select *
  into v_batch
  from public.listing_batches
  where listing_batches.id = new.listing_batch_id;

  if v_batch.id is null then
    return new;
  end if;

  if public.get_store_plan_key(new.store_id) = 'small_flock'
    and tg_op = 'UPDATE' then
    if coalesce(new.visibility_status, 'hidden') <> 'active'
      and coalesce(old.visibility_status, 'hidden') = 'active' then
      return new;
    end if;

    if coalesce(new.visibility_status, 'hidden') <> 'active'
      and coalesce(old.visibility_status, 'hidden') <> 'active'
      and new.inventory_type is not distinct from old.inventory_type
      and coalesce(new.quantity_available, 0) <= coalesce(old.quantity_available, 0) then
      return new;
    end if;

    v_old_units := public.live_bird_plan_units(
      old.inventory_type,
      old.quantity_available
    );
    v_new_units := public.live_bird_plan_units(
      new.inventory_type,
      new.quantity_available
    );

    if coalesce(old.visibility_status, 'hidden') = 'active'
      and coalesce(new.visibility_status, 'hidden') = 'active'
      and old.inventory_type in ('female', 'male', 'straight_run', 'unsexed', 'pair', 'trio')
      and new.inventory_type in ('female', 'male', 'straight_run', 'unsexed', 'pair', 'trio')
      and v_new_units <= v_old_units then
      return new;
    end if;
  end if;

  perform public.assert_store_plan_allows_inventory_item(
    new.store_id,
    new.listing_batch_id,
    v_batch.batch_type,
    new.inventory_type,
    new.custom_inventory_label,
    new.quantity_available,
    new.visibility_status,
    case when tg_op = 'UPDATE' then old.id else null end
  );

  return new;
end;
$$;

drop trigger if exists inventory_items_plan_guard on public.inventory_items;
create trigger inventory_items_plan_guard
before insert or update of inventory_type, custom_inventory_label, quantity_available, visibility_status
on public.inventory_items
for each row
execute function public.enforce_inventory_item_plan_trigger();

create or replace function public.enforce_equipment_plan_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_store_plan_key(new.store_id) = 'small_flock' then
    if tg_op = 'UPDATE'
      and coalesce(new.visibility_status, 'hidden') <> 'active'
      and coalesce(old.visibility_status, 'hidden') = 'active' then
      return new;
    end if;

    if tg_op = 'UPDATE'
      and coalesce(new.visibility_status, 'hidden') in ('hidden', 'archived')
      and coalesce(old.visibility_status, 'hidden') <> 'active' then
      return new;
    end if;

    raise exception 'Equipment and supply listings are included with Full Flock.';
  end if;

  return new;
end;
$$;

drop trigger if exists equipment_inventory_items_plan_guard on public.equipment_inventory_items;
create trigger equipment_inventory_items_plan_guard
before insert or update of visibility_status
on public.equipment_inventory_items
for each row
execute function public.enforce_equipment_plan_trigger();

create or replace function public.enforce_processed_poultry_plan_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_store_plan_key(new.store_id) = 'small_flock' then
    if tg_op = 'UPDATE'
      and coalesce(new.visibility_status, 'hidden') <> 'active'
      and coalesce(old.visibility_status, 'hidden') = 'active' then
      return new;
    end if;

    if tg_op = 'UPDATE'
      and coalesce(new.visibility_status, 'hidden') in ('hidden', 'archived')
      and coalesce(old.visibility_status, 'hidden') <> 'active' then
      return new;
    end if;

    raise exception 'Processed poultry listings are included with Full Flock.';
  end if;

  return new;
end;
$$;

drop trigger if exists processed_poultry_inventory_items_plan_guard on public.processed_poultry_inventory_items;
create trigger processed_poultry_inventory_items_plan_guard
before insert or update of visibility_status
on public.processed_poultry_inventory_items
for each row
execute function public.enforce_processed_poultry_plan_trigger();

revoke all on function public.enforce_store_plan_modules_trigger() from public;
revoke all on function public.enforce_listing_batch_plan_trigger() from public;
revoke all on function public.enforce_inventory_item_plan_trigger() from public;
revoke all on function public.enforce_equipment_plan_trigger() from public;
revoke all on function public.enforce_processed_poultry_plan_trigger() from public;
