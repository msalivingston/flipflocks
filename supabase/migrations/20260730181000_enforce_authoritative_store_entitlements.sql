-- Phase 1 Security Batch C, part 2:
-- apply the authoritative entitlement resolver to seller capabilities, launch,
-- public reads, and final order creation.

begin;

-- Do not unexpectedly hide stores whose historical access cannot be proven.
-- Production must classify or repair these rows after an explicit read-only
-- inventory and before this migration is retried.
do $block$
begin
  if exists (
    select 1
    from public.seller_billing_status
    where billing_state_authority = 'legacy_unclassified'
      and subscription_status in ('trialing', 'active', 'comped')
  ) then
    raise exception using
      errcode = 'check_violation',
      message = 'Batch C entitlement enforcement requires classification of legacy access-granting billing rows.';
  end if;
end;
$block$;

create or replace function public.get_store_plan_key(p_store_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select coalesce(
    (
      select entitlement.effective_plan_key
      from public.resolve_store_entitlement(p_store_id) as entitlement
      where entitlement.has_active_access
    ),
    'small_flock'
  );
$function$;

comment on function public.get_store_plan_key(uuid) is
'Internal effective capability plan. Inactive or malformed entitlement fails closed to Coop; callers must separately require active access before a selling mutation.';

revoke all on function public.get_store_plan_key(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.small_flock_active_live_bird_units(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.assert_store_has_active_entitlement(p_store_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
begin
  if not public.store_has_active_entitlement(p_store_id) then
    raise exception 'Active selling access is required.';
  end if;
end;
$function$;

revoke all on function public.assert_store_has_active_entitlement(uuid)
  from public, anon, authenticated, service_role;

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
set search_path = pg_catalog, public
as $function$
begin
  perform public.assert_store_has_active_entitlement(p_store_id);

  if public.get_store_plan_key(p_store_id) = 'small_flock'
    and (
      coalesce(p_hatching_eggs_enabled, false)
      or coalesce(p_equipment_supplies_enabled, false)
      or coalesce(p_processed_poultry_enabled, false)
    ) then
    raise exception 'Coop includes live birds only. Upgrade to Market to enable hatching eggs, equipment, or processed poultry.';
  end if;
end;
$function$;

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
set search_path = pg_catalog, public
as $function$
declare
  v_plan_key text;
  v_batch_status text;
  v_existing_units integer;
  v_new_units integer;
begin
  perform public.assert_store_has_active_entitlement(p_store_id);
  v_plan_key := public.get_store_plan_key(p_store_id);

  if v_plan_key <> 'small_flock' then
    return;
  end if;
  if p_batch_type = 'hatching_eggs' or p_inventory_type = 'hatching_eggs' then
    raise exception 'Hatching egg listings are included with Market.';
  end if;
  if p_inventory_type = 'other' then
    raise exception 'Flock and group listings are included with Market. Coop supports single birds, pairs, and trios.';
  end if;
  if p_inventory_type not in ('female', 'male', 'straight_run', 'unsexed', 'pair', 'trio') then
    raise exception 'This live bird offering is included with Market.';
  end if;

  select listing_batches.visibility_status
  into v_batch_status
  from public.listing_batches
  where listing_batches.id = p_listing_batch_id;

  if coalesce(p_visibility_status, 'hidden') = 'active'
    and v_batch_status = 'active' then
    v_existing_units := public.small_flock_active_live_bird_units(
      p_store_id, null, p_excluded_inventory_item_id
    );
    v_new_units := public.live_bird_plan_units(p_inventory_type, p_quantity_available);
    if v_existing_units + v_new_units > 5 then
      raise exception 'Coop includes up to 5 active birds for sale at one time. Upgrade to Market for unlimited live bird quantities.';
    end if;
  end if;
end;
$function$;

create or replace function public.assert_store_plan_allows_listing_batch_activation(
  p_listing_batch_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_batch public.listing_batches%rowtype;
  v_existing_units integer;
  v_batch_units integer;
begin
  select *
  into v_batch
  from public.listing_batches
  where listing_batches.id = p_listing_batch_id;

  if v_batch.id is null then
    return;
  end if;
  perform public.assert_store_has_active_entitlement(v_batch.store_id);

  if public.get_store_plan_key(v_batch.store_id) <> 'small_flock' then
    return;
  end if;
  if v_batch.batch_type = 'hatching_eggs' then
    raise exception 'Hatching egg listings are included with Market.';
  end if;
  if coalesce(v_batch.auto_price_adjustment_enabled, false) then
    raise exception 'Age-Based Pricing is included with Market. List growing birds once and let pricing adjust as they age.';
  end if;
  if exists (
    select 1
    from public.inventory_items
    where inventory_items.listing_batch_id = v_batch.id
      and inventory_items.visibility_status = 'active'
      and inventory_items.inventory_type = 'other'
  ) then
    raise exception 'Flock and group listings are included with Market. Coop supports single birds, pairs, and trios.';
  end if;

  v_existing_units := public.small_flock_active_live_bird_units(
    v_batch.store_id, v_batch.id, null
  );
  select coalesce(sum(public.live_bird_plan_units(
    inventory_items.inventory_type,
    inventory_items.quantity_available
  )), 0)::integer
  into v_batch_units
  from public.inventory_items
  join public.listing_batch_breeds
    on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
  where inventory_items.listing_batch_id = v_batch.id
    and inventory_items.visibility_status = 'active'
    and listing_batch_breeds.visibility_status = 'active'
    and inventory_items.quantity_available > 0;

  if v_existing_units + coalesce(v_batch_units, 0) > 5 then
    raise exception 'Coop includes up to 5 active birds for sale at one time. Upgrade to Market for unlimited live bird quantities.';
  end if;
end;
$function$;

revoke all on function public.assert_store_plan_allows_store_modules(uuid, boolean, boolean, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.assert_store_plan_allows_inventory_item(uuid, uuid, text, text, text, integer, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.assert_store_plan_allows_listing_batch_activation(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.assert_store_can_publish(p_store_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_store public.stores%rowtype;
begin
  perform public.assert_store_has_active_entitlement(p_store_id);

  select *
  into v_store
  from public.stores
  where stores.id = p_store_id;
  if v_store.id is null then
    raise exception 'Store is not available.';
  end if;

  perform public.assert_store_plan_allows_store_modules(
    v_store.id,
    v_store.hatching_eggs_enabled,
    v_store.equipment_supplies_enabled,
    v_store.processed_poultry_enabled
  );

  if public.get_store_plan_key(v_store.id) = 'small_flock' then
    if public.small_flock_active_live_bird_units(v_store.id) > 5 then
      raise exception 'Coop includes up to 5 active birds for sale at one time. Hide or reduce inventory before publishing.';
    end if;
    if exists (
      select 1
      from public.listing_batches
      where listing_batches.store_id = v_store.id
        and listing_batches.visibility_status = 'active'
        and (
          listing_batches.batch_type = 'hatching_eggs'
          or coalesce(listing_batches.auto_price_adjustment_enabled, false)
        )
    ) or exists (
      select 1
      from public.inventory_items
      where inventory_items.store_id = v_store.id
        and inventory_items.visibility_status = 'active'
        and inventory_items.inventory_type in ('hatching_eggs', 'other')
    ) then
      raise exception 'Coop inventory is not compatible with public selling. Hide Market-only inventory before publishing.';
    end if;
  end if;
end;
$function$;

revoke all on function public.assert_store_can_publish(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.enforce_store_plan_modules_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if not public.store_has_active_entitlement(new.id) then
    if tg_op = 'INSERT'
      and not coalesce(new.hatching_eggs_enabled, false)
      and not coalesce(new.equipment_supplies_enabled, false)
      and not coalesce(new.processed_poultry_enabled, false) then
      return new;
    elsif tg_op = 'UPDATE'
      and not (
        coalesce(old.hatching_eggs_enabled, false) = false
        and coalesce(new.hatching_eggs_enabled, false) = true
      )
      and not (
        coalesce(old.equipment_supplies_enabled, false) = false
        and coalesce(new.equipment_supplies_enabled, false) = true
      )
      and not (
        coalesce(old.processed_poultry_enabled, false) = false
        and coalesce(new.processed_poultry_enabled, false) = true
      ) then
      return new;
    end if;
    raise exception 'Active selling access is required.';
  end if;

  perform public.assert_store_plan_allows_store_modules(
    new.id,
    new.hatching_eggs_enabled,
    new.equipment_supplies_enabled,
    new.processed_poultry_enabled
  );
  return new;
end;
$function$;

create or replace function public.enforce_listing_batch_plan_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if not public.store_has_active_entitlement(new.store_id) then
    if tg_op = 'UPDATE'
      and new.visibility_status in ('hidden', 'sold_out', 'archived')
      and (to_jsonb(new) - array['visibility_status', 'updated_at'])
        = (to_jsonb(old) - array['visibility_status', 'updated_at']) then
      return new;
    end if;
    raise exception 'Active selling access is required.';
  end if;

  if public.get_store_plan_key(new.store_id) = 'small_flock' then
    if new.batch_type = 'hatching_eggs' then
      raise exception 'Hatching egg listings are included with Market.';
    end if;
    if coalesce(new.auto_price_adjustment_enabled, false) then
      raise exception 'Age-Based Pricing is included with Market. List growing birds once and let pricing adjust as they age.';
    end if;
    if new.visibility_status = 'active'
      and (tg_op = 'INSERT' or old.visibility_status is distinct from new.visibility_status) then
      perform public.assert_store_plan_allows_listing_batch_activation(new.id);
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists listing_batches_plan_guard on public.listing_batches;
create trigger listing_batches_plan_guard
before insert or update on public.listing_batches
for each row
execute function public.enforce_listing_batch_plan_trigger();

create or replace function public.enforce_inventory_item_plan_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
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

  if not public.store_has_active_entitlement(new.store_id) then
    if tg_op = 'UPDATE'
      and coalesce(new.quantity_available, 0) <= coalesce(old.quantity_available, 0)
      and (
        new.visibility_status is not distinct from old.visibility_status
        or new.visibility_status in ('hidden', 'sold_out', 'archived')
      )
      and not (
        coalesce(old.visibility_status, 'hidden') <> 'active'
        and new.visibility_status = 'active'
      )
      and (to_jsonb(new) - array['quantity_available', 'visibility_status', 'archived_at', 'updated_at'])
        = (to_jsonb(old) - array['quantity_available', 'visibility_status', 'archived_at', 'updated_at']) then
      return new;
    end if;
    raise exception 'Active selling access is required.';
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
    v_old_units := public.live_bird_plan_units(old.inventory_type, old.quantity_available);
    v_new_units := public.live_bird_plan_units(new.inventory_type, new.quantity_available);
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
$function$;

drop trigger if exists inventory_items_plan_guard on public.inventory_items;
create trigger inventory_items_plan_guard
before insert or update on public.inventory_items
for each row
execute function public.enforce_inventory_item_plan_trigger();

create or replace function public.enforce_market_inventory_entitlement_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if not public.store_has_active_entitlement(new.store_id) then
    if tg_op = 'UPDATE'
      and coalesce(new.quantity_available, 0) <= coalesce(old.quantity_available, 0)
      and (
        new.visibility_status is not distinct from old.visibility_status
        or new.visibility_status in ('hidden', 'sold_out', 'archived')
      )
      and not (
        coalesce(old.visibility_status, 'hidden') <> 'active'
        and new.visibility_status = 'active'
      )
      and (to_jsonb(new) - array['quantity_available', 'visibility_status', 'archived_at', 'updated_at'])
        = (to_jsonb(old) - array['quantity_available', 'visibility_status', 'archived_at', 'updated_at']) then
      return new;
    end if;
    raise exception 'Active selling access is required.';
  end if;

  if public.get_store_plan_key(new.store_id) <> 'full_flock' then
    if tg_op = 'UPDATE'
      and coalesce(new.quantity_available, 0) <= coalesce(old.quantity_available, 0)
      and new.visibility_status in ('hidden', 'sold_out', 'archived') then
      return new;
    end if;
    raise exception 'This listing category is included with Market.';
  end if;
  return new;
end;
$function$;

drop trigger if exists equipment_inventory_items_plan_guard
  on public.equipment_inventory_items;
create trigger equipment_inventory_items_plan_guard
before insert or update on public.equipment_inventory_items
for each row
execute function public.enforce_market_inventory_entitlement_trigger();

drop trigger if exists processed_poultry_inventory_items_plan_guard
  on public.processed_poultry_inventory_items;
create trigger processed_poultry_inventory_items_plan_guard
before insert or update on public.processed_poultry_inventory_items
for each row
execute function public.enforce_market_inventory_entitlement_trigger();

drop trigger if exists hatching_egg_inventory_items_plan_guard
  on public.hatching_egg_inventory_items;
create trigger hatching_egg_inventory_items_plan_guard
before insert or update on public.hatching_egg_inventory_items
for each row
execute function public.enforce_market_inventory_entitlement_trigger();

revoke all on function public.enforce_store_plan_modules_trigger()
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_listing_batch_plan_trigger()
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_inventory_item_plan_trigger()
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_market_inventory_entitlement_trigger()
  from public, anon, authenticated, service_role;

create or replace function public.validate_hatching_eggs_module_enabled(p_store_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_enabled boolean;
begin
  perform public.assert_store_has_active_entitlement(p_store_id);
  if public.get_store_plan_key(p_store_id) <> 'full_flock' then
    raise exception 'Hatching egg listings are included with Market.';
  end if;
  select stores.hatching_eggs_enabled
  into v_enabled
  from public.stores
  where stores.id = p_store_id;
  if v_enabled is distinct from true then
    raise exception 'Hatching Eggs is not enabled for this store.';
  end if;
end;
$function$;

revoke all on function public.validate_hatching_eggs_module_enabled(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.enforce_store_publication_entitlement_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if (
      coalesce(old.storefront_enabled, false) = false
      and coalesce(new.storefront_enabled, false) = true
    )
    or (
      old.store_status is distinct from new.store_status
      and new.store_status = 'live'
    ) then
    perform public.assert_store_can_publish(new.id);
  end if;
  return new;
end;
$function$;

drop trigger if exists stores_publication_entitlement_guard on public.stores;
create trigger stores_publication_entitlement_guard
before update of storefront_enabled, store_status on public.stores
for each row
execute function public.enforce_store_publication_entitlement_trigger();

revoke all on function public.enforce_store_publication_entitlement_trigger()
  from public, anon, authenticated, service_role;

drop function if exists public.get_seller_context();
create function public.get_seller_context()
returns table (
  store_id uuid,
  store_name text,
  store_tagline text,
  hero_subheading text,
  storefront_font_pair text,
  storefront_heading_color text,
  storefront_text_color text,
  storefront_top_menu_color text,
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
  other_policies text,
  custom_policies jsonb,
  requested_plan_key text,
  requested_billing_cadence text,
  effective_plan_key text,
  effective_billing_cadence text,
  has_active_entitlement boolean,
  entitlement_reason text,
  entitlement_access_until timestamptz,
  entitlement_held boolean,
  cancel_at_period_end boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select
    stores.id,
    stores.store_name,
    stores.store_tagline,
    stores.hero_subheading,
    stores.storefront_font_pair,
    stores.storefront_heading_color,
    stores.storefront_text_color,
    stores.storefront_top_menu_color,
    stores.store_slug,
    stores.store_status,
    stores.storefront_mode,
    stores.storefront_enabled,
    stores.hatching_eggs_enabled,
    stores.equipment_supplies_enabled,
    stores.processed_poultry_enabled,
    (
      stores.storefront_enabled
      and stores.store_status = 'live'
      and stores.storefront_mode in ('hosted', 'embedded')
      and entitlement.has_active_access
    ),
    stores.public_city,
    stores.public_state,
    stores.public_country,
    stores.about_text,
    stores.pickup_policy,
    stores.cancellation_policy,
    stores.public_email,
    stores.public_phone,
    stores.show_public_email,
    stores.show_public_phone,
    stores.website_url,
    stores.social_url,
    stores.npip_number,
    stores.show_npip,
    stores.order_notification_email,
    entitlement.effective_plan_key,
    entitlement.effective_billing_cadence,
    seller_billing_status.subscription_status,
    seller_billing_status.storefront_access_until,
    seller_billing_status.trial_ends_at,
    coalesce(seller_onboarding_state.profile_complete, false),
    coalesce(seller_onboarding_state.billing_complete, false),
    coalesce(seller_onboarding_state.terms_accepted, false),
    coalesce(seller_onboarding_state.first_listing_created, false),
    coalesce(seller_onboarding_state.ready_to_launch, false),
    seller_onboarding_state.launched_at,
    user_roles.role,
    public.is_admin(),
    stores.other_policies,
    stores.custom_policies,
    seller_billing_status.requested_plan_key,
    seller_billing_status.requested_billing_cadence,
    entitlement.effective_plan_key,
    entitlement.effective_billing_cadence,
    entitlement.has_active_access,
    entitlement.access_reason,
    entitlement.access_until,
    entitlement.held,
    coalesce(seller_billing_status.cancel_at_period_end, false)
  from public.stores
  left join public.user_roles
    on user_roles.store_id = stores.id
   and user_roles.user_id = auth.uid()
   and user_roles.role in ('seller', 'staff')
  left join public.seller_billing_status
    on seller_billing_status.store_id = stores.id
  left join public.seller_onboarding_state
    on seller_onboarding_state.store_id = stores.id
  cross join lateral public.resolve_store_entitlement(stores.id) as entitlement
  where stores.owner_user_id = auth.uid()
     or user_roles.store_id = stores.id;
$function$;

revoke all on function public.get_seller_context() from public, anon;
grant execute on function public.get_seller_context() to authenticated;

create or replace function public.seller_save_onboarding_categories(p_categories jsonb)
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
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_store public.stores%rowtype;
  v_plan_key text;
  v_hatching boolean;
  v_processed boolean;
  v_equipment boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if p_categories is null or jsonb_typeof(p_categories) <> 'object' then
    raise exception 'Selling categories must be provided.';
  end if;

  v_hatching := coalesce((p_categories ->> 'hatching_eggs')::boolean, false);
  v_processed := coalesce((p_categories ->> 'poultry_products')::boolean, false);
  v_equipment := coalesce((p_categories ->> 'equipment_supplies')::boolean, false);

  select *
  into v_store
  from public.stores
  where stores.owner_user_id = v_user_id
  order by stores.created_at
  limit 1
  for update;
  if v_store.id is null then
    raise exception 'Complete farm basics before choosing selling categories.';
  end if;

  perform public.assert_store_has_active_entitlement(v_store.id);
  v_plan_key := public.get_store_plan_key(v_store.id);
  if not exists (
    select 1
    from public.seller_onboarding_state
    where seller_onboarding_state.store_id = v_store.id
      and seller_onboarding_state.profile_complete
      and seller_onboarding_state.billing_complete
  ) then
    raise exception 'Choose a plan before choosing selling categories.';
  end if;
  if v_plan_key = 'small_flock'
    and (v_hatching or v_processed or v_equipment) then
    raise exception 'This category is included with Market.';
  end if;

  update public.stores
  set
    hatching_eggs_enabled = v_hatching,
    processed_poultry_enabled = v_processed,
    equipment_supplies_enabled = v_equipment
  where stores.id = v_store.id
  returning * into v_store;

  update public.seller_onboarding_state
  set categories_complete = true
  where seller_onboarding_state.store_id = v_store.id;

  return query
  select
    v_store.id,
    v_store.hatching_eggs_enabled,
    v_store.processed_poultry_enabled,
    v_store.equipment_supplies_enabled,
    true,
    5;
end;
$function$;

revoke all on function public.seller_save_onboarding_categories(jsonb)
  from public, anon;
grant execute on function public.seller_save_onboarding_categories(jsonb)
  to authenticated;

-- Preserve the detailed readiness checklist and replace its historical billing
-- predicate in place. The migration aborts if the expected active definition
-- is not present, rather than leaving a second status implementation behind.
do $rewrite$
declare
  v_definition text;
  v_rewritten text;
  v_old text := $old$
    select exists (
      select 1
      from public.seller_billing_status
      where seller_billing_status.store_id = v_store.id
        and (
          seller_billing_status.subscription_status in ('trialing', 'active', 'comped')
          or (
            seller_billing_status.storefront_access_until is not null
            and seller_billing_status.storefront_access_until >= now()
          )
          or (
            seller_billing_status.trial_ends_at is not null
            and seller_billing_status.trial_ends_at >= now()
          )
        )
        and seller_billing_status.subscription_status not in ('past_due', 'dormant', 'canceled', 'suspended')
    )
    into v_billing_active;
$old$;
  v_new text := $new$
    select coalesce(
      (
        select entitlement.has_active_access
        from public.resolve_store_entitlement(v_store.id) as entitlement
      ),
      false
    )
    into v_billing_active;
$new$;
begin
  select pg_get_functiondef(
    'public.evaluate_store_launch_readiness(uuid,uuid)'::regprocedure
  )
  into v_definition;

  v_rewritten := replace(v_definition, v_old, v_new);
  if v_rewritten = v_definition then
    raise exception 'Could not replace the historical launch billing predicate.';
  end if;

  execute v_rewritten;
end;
$rewrite$;

revoke all on function public.evaluate_store_launch_readiness(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.seller_get_store_launch_readiness(
  p_store_id uuid
)
returns table (
  item_type text,
  item_key text,
  label text,
  passed boolean,
  message text,
  action text,
  detail_count bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select *
  from public.evaluate_store_launch_readiness(p_store_id, auth.uid())
  where exists (
    select 1
    from public.stores
    where stores.id = p_store_id
      and (
        stores.owner_user_id = auth.uid()
        or public.is_admin()
      )
  );
$function$;

revoke all on function public.seller_get_store_launch_readiness(uuid)
  from public, anon;
grant execute on function public.seller_get_store_launch_readiness(uuid)
  to authenticated;

create or replace function public.get_storefront_public_status(p_store_slug text)
returns table (
  store_slug text,
  store_exists boolean,
  is_publicly_available boolean,
  message text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_slug text := lower(trim(p_store_slug));
  v_store public.stores%rowtype;
  v_available boolean := false;
begin
  if v_slug is null or v_slug = ''
    or v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    return query select v_slug, false, false, 'not_found'::text;
    return;
  end if;

  select *
  into v_store
  from public.stores
  where stores.store_slug = v_slug
  limit 1;

  if v_store.id is null then
    return query select v_slug, false, false, 'not_found'::text;
    return;
  end if;

  v_available :=
    v_store.storefront_enabled
    and v_store.store_status = 'live'
    and v_store.storefront_mode in ('hosted', 'embedded')
    and public.store_has_active_entitlement(v_store.id);

  return query
  select
    v_store.store_slug,
    true,
    v_available,
    case when v_available then null::text else 'This store is currently unavailable.'::text end;
end;
$function$;

revoke all on function public.get_storefront_public_status(text) from public;
grant execute on function public.get_storefront_public_status(text)
  to anon, authenticated;

-- Preserve every existing public view column, comment, dependency, and grant.
-- Each direct PostgREST surface receives its own store entitlement predicate;
-- callers cannot bypass the storefront status RPC by selecting a category view.
do $block$
declare
  v_name text;
  v_definition text;
begin
  foreach v_name in array array[
    'public_storefronts',
    'public_listing_batches',
    'public_inventory_items',
    'public_storefront_breed_inventory',
    'public_discoverable_storefronts',
    'public_discoverable_inventory',
    'public_storefront_home',
    'public_storefront_item_detail',
    'public_storefront_pickup_options',
    'public_storefront_inventory',
    'public_storefront_equipment_inventory',
    'public_storefront_processed_poultry_inventory',
    'public_storefront_hatching_egg_inventory',
    'public_storefront_media_gallery',
    'public_storefront_processed_poultry_media_gallery'
  ]
  loop
    if to_regclass('public.' || v_name) is null then
      raise exception 'Expected public view public.% is missing.', v_name;
    end if;
    if not exists (
      select 1
      from information_schema.columns
      where columns.table_schema = 'public'
        and columns.table_name = v_name
        and columns.column_name = 'store_id'
    ) then
      raise exception 'Expected public view public.% to contain store_id.', v_name;
    end if;

    select pg_get_viewdef(format('public.%I', v_name)::regclass, true)
    into v_definition;
    execute format(
      'create or replace view public.%I with (security_barrier = true) as select entitlement_filtered.* from (%s) as entitlement_filtered where public.store_has_active_entitlement(entitlement_filtered.store_id)',
      v_name,
      v_definition
    );
  end loop;
end;
$block$;

create or replace function public.enforce_new_order_entitlement_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  perform public.assert_store_has_active_entitlement(new.store_id);
  return new;
end;
$function$;

drop trigger if exists orders_entitlement_guard on public.orders;
create trigger orders_entitlement_guard
before insert on public.orders
for each row
execute function public.enforce_new_order_entitlement_trigger();

revoke all on function public.enforce_new_order_entitlement_trigger()
  from public, anon, authenticated, service_role;

drop function if exists public.admin_platform_store_operations_summary(uuid);
create function public.admin_platform_store_operations_summary(p_store_id uuid)
returns table (
  store_id uuid,
  requested_plan_key text,
  requested_billing_cadence text,
  plan_key text,
  billing_plan text,
  subscription_status text,
  has_active_entitlement boolean,
  entitlement_reason text,
  entitlement_access_until timestamptz,
  entitlement_held boolean,
  has_linked_stripe_subscription boolean,
  internal_note text,
  recorded_gross_sales numeric,
  total_order_count bigint,
  open_order_count bigint,
  fulfilled_order_count bigint,
  canceled_order_count bigint,
  refunded_order_count bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized to view platform admin data.';
  end if;
  if p_store_id is null or not exists (
    select 1 from public.stores where stores.id = p_store_id
  ) then
    raise exception 'Store is not available.';
  end if;

  return query
  select
    stores.id,
    seller_billing_status.requested_plan_key,
    seller_billing_status.requested_billing_cadence,
    entitlement.effective_plan_key,
    entitlement.effective_billing_cadence,
    seller_billing_status.subscription_status,
    entitlement.has_active_access,
    entitlement.access_reason,
    entitlement.access_until,
    entitlement.held,
    seller_billing_status.stripe_subscription_id is not null,
    admin_store_internal_notes.note,
    coalesce(order_summary.recorded_gross_sales, 0)::numeric(12, 2),
    coalesce(order_summary.total_order_count, 0),
    coalesce(order_summary.open_order_count, 0),
    coalesce(order_summary.fulfilled_order_count, 0),
    coalesce(order_summary.canceled_order_count, 0),
    coalesce(order_summary.refunded_order_count, 0)
  from public.stores
  left join public.seller_billing_status
    on seller_billing_status.store_id = stores.id
  left join public.admin_store_internal_notes
    on admin_store_internal_notes.store_id = stores.id
  cross join lateral public.resolve_store_entitlement(stores.id) as entitlement
  left join lateral (
    select
      coalesce(sum(orders.total_amount) filter (
        where orders.order_status <> 'canceled'
      ), 0) as recorded_gross_sales,
      count(*) as total_order_count,
      count(*) filter (where orders.order_status in ('pending', 'open')) as open_order_count,
      count(*) filter (where orders.order_status = 'fulfilled') as fulfilled_order_count,
      count(*) filter (where orders.order_status = 'canceled') as canceled_order_count,
      count(*) filter (where orders.payment_status = 'refunded') as refunded_order_count
    from public.orders
    where orders.store_id = stores.id
  ) as order_summary on true
  where stores.id = p_store_id;
end;
$function$;

revoke all on function public.admin_platform_store_operations_summary(uuid)
  from public, anon;
grant execute on function public.admin_platform_store_operations_summary(uuid)
  to authenticated;

commit;
