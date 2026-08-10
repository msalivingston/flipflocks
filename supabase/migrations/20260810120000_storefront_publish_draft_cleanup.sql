-- Narrow storefront launch/default-media and add-v2 live-bird publication cleanup.

begin;

-- Preserve the existing onboarding implementation behind a wrapper so the
-- default hero is selected only when this call genuinely creates the store.
alter function public.seller_bootstrap_store_from_onboarding(jsonb)
  rename to seller_bootstrap_store_from_onboarding_without_default_hero;

revoke all on function public.seller_bootstrap_store_from_onboarding_without_default_hero(jsonb)
  from public, anon, authenticated, service_role;

create function public.seller_bootstrap_store_from_onboarding(
  p_profile jsonb
)
returns table (
  store_id uuid,
  store_name text,
  store_slug text,
  profile_complete boolean,
  next_step integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_existing_store_id uuid;
  v_result record;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  select stores.id
  into v_existing_store_id
  from public.stores
  where stores.owner_user_id = v_user_id
  order by stores.created_at, stores.id
  limit 1;

  select *
  into v_result
  from public.seller_bootstrap_store_from_onboarding_without_default_hero(p_profile);

  if v_existing_store_id is null then
    perform public.seller_select_store_hero_library(
      v_result.store_id,
      '/storefront-heroes/sunlit-pasture-flock.png',
      'Chickens in a sunlit farm pasture'
    );
  end if;

  return query
  select
    v_result.store_id,
    v_result.store_name,
    v_result.store_slug,
    v_result.profile_complete,
    v_result.next_step;
end;
$function$;

comment on function public.seller_bootstrap_store_from_onboarding(jsonb) is
'Farm Basics bootstrap. A newly inserted store receives the stock farm hero through the existing media library model; existing stores are never reinitialized.';

revoke all on function public.seller_bootstrap_store_from_onboarding(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.seller_bootstrap_store_from_onboarding(jsonb)
  to authenticated;

-- Launch remains draft-only and retains every existing readiness/ownership
-- check, but the explicit launch now enables the storefront in the same write.
create or replace function public.trusted_launch_store(
  p_store_id uuid,
  p_actor_user_id uuid
)
returns table (
  store_id uuid,
  store_status text,
  storefront_enabled boolean,
  is_publicly_available boolean,
  launched_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores%rowtype;
  v_missing_required text;
  v_launched_at timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Store launch must be performed by a trusted workflow.';
  end if;

  if p_store_id is null or p_actor_user_id is null then
    raise exception 'Store and actor are required.';
  end if;

  select *
  into v_store
  from public.stores
  where stores.id = p_store_id
  for update;

  if v_store.id is null then
    raise exception 'Store could not be found.';
  end if;

  if v_store.owner_user_id <> p_actor_user_id then
    raise exception 'The signed-in seller does not own this store.';
  end if;

  select string_agg(readiness.label, ', ' order by readiness.label)
  into v_missing_required
  from public.evaluate_store_launch_readiness(p_store_id, p_actor_user_id) as readiness
  where readiness.item_type = 'required'
    and readiness.passed = false;

  if v_missing_required is not null then
    raise exception 'Store is not ready to launch. Missing: %', v_missing_required;
  end if;

  update public.stores
  set
    store_status = 'live',
    storefront_enabled = true
  where stores.id = v_store.id
    and stores.store_status = 'draft'
  returning * into v_store;

  if v_store.id is null then
    raise exception 'Store launch failed.';
  end if;

  update public.seller_onboarding_state
  set
    ready_to_launch = true,
    launched_at = coalesce(seller_onboarding_state.launched_at, v_launched_at)
  where seller_onboarding_state.store_id = v_store.id;

  if not found then
    insert into public.seller_onboarding_state (
      store_id,
      ready_to_launch,
      launched_at
    ) values (
      v_store.id,
      true,
      v_launched_at
    );
  end if;

  return query
  select
    v_store.id,
    v_store.store_status,
    v_store.storefront_enabled,
    (
      v_store.storefront_enabled = true
      and v_store.store_status = 'live'
      and v_store.storefront_mode in ('hosted', 'embedded')
      and v_store.admin_hold_reason is null
    ),
    coalesce(
      (
        select seller_onboarding_state.launched_at
        from public.seller_onboarding_state
        where seller_onboarding_state.store_id = v_store.id
      ),
      v_launched_at
    );
end;
$$;

comment on function public.trusted_launch_store(uuid, uuid) is
'Service-role-only launch workflow. Revalidates ownership and readiness, then atomically changes a draft store to live and enables its storefront.';

revoke all on function public.trusted_launch_store(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.trusted_launch_store(uuid, uuid)
  to service_role;

-- One authoritative unit calculation for the UI preflight. The existing plan
-- resolver and active-unit counter remain the source of truth.
create function public.seller_preflight_live_bird_publication(
  p_store_id uuid,
  p_breed_groups jsonb,
  p_excluded_listing_batch_id uuid default null
)
returns table (
  effective_plan_key text,
  active_bird_limit integer,
  currently_active_bird_units integer,
  requested_bird_units integer,
  remaining_bird_units integer,
  can_publish boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_plan_key text;
  v_current integer;
  v_requested integer;
begin
  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Not authorized to publish inventory for this store.';
  end if;

  perform public.assert_store_has_active_entitlement(p_store_id);

  if p_breed_groups is null or jsonb_typeof(p_breed_groups) <> 'array' then
    raise exception 'Live bird breed groups are required.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_breed_groups) as breed_group(value)
    where jsonb_typeof(breed_group.value) <> 'object'
      or jsonb_typeof(breed_group.value -> 'inventory_items') <> 'array'
  ) then
    raise exception 'Live bird breed groups are invalid.';
  end if;

  v_plan_key := public.get_store_plan_key(p_store_id);
  v_current := public.small_flock_active_live_bird_units(
    p_store_id,
    p_excluded_listing_batch_id,
    null
  );

  select coalesce(sum(public.live_bird_plan_units(
    inventory_item.value ->> 'inventory_type',
    case
      when inventory_item.value ->> 'quantity_available' ~ '^[0-9]+$'
        then (inventory_item.value ->> 'quantity_available')::integer
      else 0
    end
  )), 0)::integer
  into v_requested
  from jsonb_array_elements(p_breed_groups) as breed_group(value)
  cross join lateral jsonb_array_elements(breed_group.value -> 'inventory_items')
    as inventory_item(value)
  where coalesce(nullif(breed_group.value ->> 'visibility_status', ''), 'active') = 'active'
    and coalesce(nullif(inventory_item.value ->> 'visibility_status', ''), 'active') = 'active';

  return query
  select
    v_plan_key,
    case when v_plan_key = 'small_flock' then 5 else null end,
    v_current,
    v_requested,
    case when v_plan_key = 'small_flock' then greatest(5 - v_current, 0) else null end,
    v_plan_key <> 'small_flock' or v_current + v_requested <= 5;
end;
$function$;

comment on function public.seller_preflight_live_bird_publication(uuid, jsonb, uuid) is
'Seller-safe authoritative live-bird publication preflight using the effective plan and the same single/pair/trio unit calculation as database enforcement.';

revoke all on function public.seller_preflight_live_bird_publication(uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.seller_preflight_live_bird_publication(uuid, jsonb, uuid)
  to authenticated;

-- Serialize only writes that can increase active live-bird units. This makes
-- the existing count-and-trigger enforcement safe across separate batches.
create function public.lock_store_for_live_bird_publication()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_batch_status text;
begin
  if tg_table_name = 'listing_batches' then
    if new.batch_type = 'live_animals'
      and new.visibility_status = 'active'
      and (
        tg_op = 'INSERT'
        or old.visibility_status is distinct from new.visibility_status
      ) then
      perform 1
      from public.stores
      where stores.id = new.store_id
      for update;
    end if;
  elsif new.visibility_status = 'active' then
    select listing_batches.visibility_status
    into v_batch_status
    from public.listing_batches
    where listing_batches.id = new.listing_batch_id;

    if v_batch_status = 'active'
      and (
        tg_op = 'INSERT'
        or old.visibility_status is distinct from new.visibility_status
        or old.inventory_type is distinct from new.inventory_type
        or coalesce(old.quantity_available, 0) < coalesce(new.quantity_available, 0)
      ) then
      perform 1
      from public.stores
      where stores.id = new.store_id
      for update;
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.lock_store_for_live_bird_publication()
  from public, anon, authenticated, service_role;

drop trigger if exists listing_batches_00_live_bird_publish_lock
  on public.listing_batches;
create trigger listing_batches_00_live_bird_publish_lock
before insert or update on public.listing_batches
for each row execute function public.lock_store_for_live_bird_publication();

drop trigger if exists inventory_items_00_live_bird_publish_lock
  on public.inventory_items;
create trigger inventory_items_00_live_bird_publish_lock
before insert or update on public.inventory_items
for each row execute function public.lock_store_for_live_bird_publication();

-- Publish a saved add-v2 draft in one transaction. A blocked publication is a
-- normal result so the UI receives exact allowance numbers without changing
-- the draft or its marker.
create function public.seller_publish_live_bird_draft(
  p_listing_batch_id uuid
)
returns table (
  listing_batch_id uuid,
  published boolean,
  effective_plan_key text,
  active_bird_limit integer,
  currently_active_bird_units integer,
  requested_bird_units integer,
  remaining_bird_units integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_batch public.listing_batches%rowtype;
  v_plan_key text;
  v_current integer;
  v_requested integer;
  v_has_published_history boolean;
begin
  select *
  into v_batch
  from public.listing_batches
  where listing_batches.id = p_listing_batch_id;

  if v_batch.id is null then
    raise exception 'Draft could not be found.';
  end if;
  if not (public.owns_store(v_batch.store_id) or public.is_admin()) then
    raise exception 'Not authorized to publish this draft.';
  end if;

  perform 1
  from public.stores
  where stores.id = v_batch.store_id
  for update;

  select *
  into v_batch
  from public.listing_batches
  where listing_batches.id = p_listing_batch_id
  for update;

  select exists (
    select 1
    from public.order_items
    where order_items.listing_batch_id = v_batch.id
  ) or exists (
    select 1
    from public.inventory_activity_events
    where inventory_activity_events.listing_batch_id = v_batch.id
      and inventory_activity_events.event_type in (
        'listing_batch_created',
        'listing_batch_visibility_changed'
      )
      and (
        inventory_activity_events.from_visibility_status in ('active', 'sold_out')
        or inventory_activity_events.to_visibility_status in ('active', 'sold_out')
      )
  ) into v_has_published_history;

  if v_batch.batch_type <> 'live_animals'
    or v_batch.visibility_status <> 'hidden'
    or v_batch.internal_batch_label is distinct from '__add_inventory_v2_live_birds__'
    or v_has_published_history then
    raise exception 'This listing is not an unfinished Add Inventory live-bird draft.';
  end if;

  perform public.assert_store_has_active_entitlement(v_batch.store_id);
  v_plan_key := public.get_store_plan_key(v_batch.store_id);
  v_current := public.small_flock_active_live_bird_units(v_batch.store_id, v_batch.id, null);

  select coalesce(sum(public.live_bird_plan_units(
    inventory_items.inventory_type,
    inventory_items.quantity_available
  )), 0)::integer
  into v_requested
  from public.inventory_items
  join public.listing_batch_breeds
    on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
  where inventory_items.listing_batch_id = v_batch.id
    and inventory_items.visibility_status = 'active'
    and listing_batch_breeds.visibility_status = 'active'
    and inventory_items.quantity_available > 0;

  if v_plan_key = 'small_flock' and v_current + v_requested > 5 then
    return query
    select v_batch.id, false, v_plan_key, 5, v_current, v_requested,
      greatest(5 - v_current, 0);
    return;
  end if;

  update public.listing_batches
  set
    visibility_status = 'active',
    internal_batch_label = null
  where listing_batches.id = v_batch.id;

  perform public.log_inventory_activity_event(
    v_batch.store_id,
    v_batch.id,
    null,
    null,
    'listing_batch_visibility_changed',
    null,
    null,
    v_batch.visibility_status,
    'active',
    'Published from Add Inventory v2.',
    '{}'::jsonb
  );

  return query
  select v_batch.id, true, v_plan_key,
    case when v_plan_key = 'small_flock' then 5 else null end,
    v_current, v_requested,
    case when v_plan_key = 'small_flock' then greatest(5 - v_current, 0) else null end;
end;
$function$;

comment on function public.seller_publish_live_bird_draft(uuid) is
'Atomically validates and publishes an unfinished marked add-v2 live-bird draft, clearing its marker only after authoritative allowance enforcement succeeds.';

revoke all on function public.seller_publish_live_bird_draft(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.seller_publish_live_bird_draft(uuid)
  to authenticated;

-- Seller-facing classification uses both orders and the existing publication
-- activity semantics; this keeps a deliberately hidden published listing out
-- of the unfinished-draft workflow.
create function public.seller_get_live_bird_listing_publication_states(
  p_store_id uuid
)
returns table (
  listing_batch_id uuid,
  internal_batch_label text,
  listing_batch_visibility_status text,
  has_published_activity boolean,
  is_unfinished_add_v2_draft boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
begin
  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Not authorized to inspect inventory for this store.';
  end if;

  return query
  select
    listing_batches.id,
    listing_batches.internal_batch_label,
    listing_batches.visibility_status,
    publication.has_published_activity,
    listing_batches.visibility_status = 'hidden'
      and listing_batches.internal_batch_label = '__add_inventory_v2_live_birds__'
      and not publication.has_published_activity
  from public.listing_batches
  cross join lateral (
    select exists (
      select 1
      from public.order_items
      where order_items.listing_batch_id = listing_batches.id
    ) or exists (
      select 1
      from public.inventory_activity_events
      where inventory_activity_events.listing_batch_id = listing_batches.id
        and inventory_activity_events.event_type in (
          'listing_batch_created',
          'listing_batch_visibility_changed'
        )
        and (
          inventory_activity_events.from_visibility_status in ('active', 'sold_out')
          or inventory_activity_events.to_visibility_status in ('active', 'sold_out')
        )
    ) as has_published_activity
  ) as publication
  where listing_batches.store_id = p_store_id
    and listing_batches.batch_type = 'live_animals';
end;
$function$;

comment on function public.seller_get_live_bird_listing_publication_states(uuid) is
'Seller-private listing-batch classification for unfinished add-v2 drafts versus deliberately hidden published live-bird inventory.';

revoke all on function public.seller_get_live_bird_listing_publication_states(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.seller_get_live_bird_listing_publication_states(uuid)
  to authenticated;

-- Internal batch labels do not affect publication, visibility, quantities, or
-- active bird units. Permit label-only maintenance for stores without current
-- selling access while retaining the existing entitlement and Coop checks for
-- every update that can affect active selling state.
create or replace function public.enforce_listing_batch_plan_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'UPDATE'
    and (to_jsonb(new) - array[
      'internal_batch_label', 'age_at_availability_days', 'updated_at'
    ]) = (to_jsonb(old) - array[
      'internal_batch_label', 'age_at_availability_days', 'updated_at'
    ]) then
    return new;
  end if;

  if not public.store_has_active_entitlement(new.store_id) then
    if tg_op = 'UPDATE'
      and new.visibility_status in ('hidden', 'sold_out', 'archived')
      and (to_jsonb(new) - array[
        'visibility_status', 'age_at_availability_days', 'updated_at'
      ]) = (to_jsonb(old) - array[
        'visibility_status', 'age_at_availability_days', 'updated_at'
      ]) then
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

-- Active marked batches and batches with definitive order/publication history
-- cannot be unfinished drafts. Ambiguous hidden marked batches are preserved.
update public.listing_batches
set internal_batch_label = null
where listing_batches.internal_batch_label = '__add_inventory_v2_live_birds__'
  and (
    listing_batches.visibility_status = 'active'
    or exists (
      select 1
      from public.order_items
      where order_items.listing_batch_id = listing_batches.id
    )
    or exists (
      select 1
      from public.inventory_activity_events
      where inventory_activity_events.listing_batch_id = listing_batches.id
        and inventory_activity_events.event_type in (
          'listing_batch_created',
          'listing_batch_visibility_changed'
        )
        and (
          inventory_activity_events.from_visibility_status in ('active', 'sold_out')
          or inventory_activity_events.to_visibility_status in ('active', 'sold_out')
        )
    )
  );

commit;
