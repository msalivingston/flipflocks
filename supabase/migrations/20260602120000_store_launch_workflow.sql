-- Store Launch Workflow
--
-- Adds seller-facing launch readiness plus a service-role-only launch RPC.
-- This keeps lifecycle status separate from storefront publication:
-- - launch changes stores.store_status from draft to live
-- - launch does not change stores.storefront_enabled
-- - sellers still control publication through seller_update_store_settings

begin;

create or replace function public.evaluate_store_launch_readiness(
  p_store_id uuid,
  p_actor_user_id uuid
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
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_store public.stores%rowtype;
  v_store_exists boolean := false;
  v_owns_store boolean := false;
  v_terms_accepted boolean := false;
  v_billing_active boolean := false;
  v_saleable_inventory_rows bigint := 0;
  v_total_saleable_quantity bigint := 0;
  v_store_media_count bigint := 0;
begin
  select *
  into v_store
  from public.stores
  where stores.id = p_store_id;

  v_store_exists := v_store.id is not null;

  if v_store_exists then
    v_owns_store := v_store.owner_user_id = p_actor_user_id;

    select exists (
      select 1
      from public.seller_terms_acceptances
      where seller_terms_acceptances.store_id = v_store.id
        and seller_terms_acceptances.accepted_by_user_id = v_store.owner_user_id
    )
    into v_terms_accepted;

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

    select
      count(*),
      coalesce(sum(inventory_items.quantity_available), 0)::bigint
    into v_saleable_inventory_rows, v_total_saleable_quantity
    from public.inventory_items
    join public.listing_batch_breeds
      on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
     and listing_batch_breeds.store_id = v_store.id
    join public.listing_batches
      on listing_batches.id = inventory_items.listing_batch_id
     and listing_batches.store_id = v_store.id
    join public.seller_breed_profiles
      on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
     and seller_breed_profiles.store_id = v_store.id
    join public.species
      on species.id = listing_batches.species_id
    where inventory_items.store_id = v_store.id
      and species.is_active = true
      and seller_breed_profiles.visibility_status = 'active'
      and seller_breed_profiles.moderation_status = 'normal'
      and listing_batches.visibility_status = 'active'
      and listing_batches.moderation_status = 'normal'
      and listing_batch_breeds.visibility_status = 'active'
      and listing_batch_breeds.moderation_status = 'normal'
      and inventory_items.visibility_status = 'active'
      and inventory_items.moderation_status = 'normal'
      and inventory_items.quantity_available > 0
      and (
        (
          listing_batches.batch_type = 'hatching_eggs'
          and inventory_items.inventory_type = 'hatching_eggs'
        )
        or (
          listing_batches.batch_type = 'live_animals'
          and inventory_items.inventory_type <> 'hatching_eggs'
        )
      );

    select count(*)
    into v_store_media_count
    from public.media_links
    join public.media_assets
      on media_assets.id = media_links.media_asset_id
     and media_assets.store_id = media_links.store_id
    where media_links.store_id = v_store.id
      and media_links.entity_type = 'store'
      and media_links.entity_id = v_store.id
      and media_links.display_context in ('logo', 'hero')
      and media_links.visibility_status = 'active'
      and media_assets.asset_status = 'active'
      and media_assets.moderation_status = 'approved';
  end if;

  return query
  select
    'required'::text,
    'store_exists'::text,
    'Store exists'::text,
    v_store_exists,
    case
      when v_store_exists then 'Store record found.'
      else 'Store could not be found.'
    end,
    case
      when v_store_exists then 'No action needed.'
      else 'Reload the dashboard or recreate the seller store.'
    end,
    case when v_store_exists then 1 else 0 end::bigint;

  return query
  select
    'required'::text,
    'seller_owns_store'::text,
    'Seller owns store'::text,
    v_store_exists and v_owns_store,
    case
      when v_store_exists and v_owns_store then 'This store belongs to the signed-in seller.'
      else 'The signed-in seller does not own this store.'
    end,
    case
      when v_store_exists and v_owns_store then 'No action needed.'
      else 'Sign in as the store owner or check the store ownership setup.'
    end,
    case when v_store_exists and v_owns_store then 1 else 0 end::bigint;

  return query
  select
    'required'::text,
    'store_status_draft'::text,
    'Store is in draft'::text,
    v_store_exists and v_store.store_status = 'draft',
    case
      when v_store_exists and v_store.store_status = 'draft' then 'This store is ready for a first launch.'
      when v_store_exists then 'Only draft stores can be launched from this workflow.'
      else 'Store status could not be checked.'
    end,
    case
      when v_store_exists and v_store.store_status = 'draft' then 'No action needed.'
      when v_store_exists and v_store.store_status = 'live' then 'The store is already live.'
      else 'Ask an admin to review this store status.'
    end,
    case when v_store_exists and v_store.store_status = 'draft' then 1 else 0 end::bigint;

  return query
  select
    'required'::text,
    'store_name_present'::text,
    'Store name'::text,
    v_store_exists and nullif(trim(v_store.store_name), '') is not null,
    case
      when v_store_exists and nullif(trim(v_store.store_name), '') is not null then 'Store name is set.'
      else 'Store name is missing.'
    end,
    case
      when v_store_exists and nullif(trim(v_store.store_name), '') is not null then 'No action needed.'
      else 'Add a store name in Store Admin.'
    end,
    case when v_store_exists and nullif(trim(v_store.store_name), '') is not null then 1 else 0 end::bigint;

  return query
  select
    'required'::text,
    'store_slug_present'::text,
    'Store URL slug'::text,
    v_store_exists and nullif(trim(v_store.store_slug), '') is not null,
    case
      when v_store_exists and nullif(trim(v_store.store_slug), '') is not null then 'Store URL slug is set.'
      else 'Store URL slug is missing.'
    end,
    case
      when v_store_exists and nullif(trim(v_store.store_slug), '') is not null then 'No action needed.'
      else 'Add a store slug in Store Admin.'
    end,
    case when v_store_exists and nullif(trim(v_store.store_slug), '') is not null then 1 else 0 end::bigint;

  return query
  select
    'required'::text,
    'location_present'::text,
    'Location'::text,
    v_store_exists
      and nullif(trim(coalesce(v_store.public_city, '')), '') is not null
      and nullif(trim(coalesce(v_store.public_state, '')), '') is not null
      and nullif(trim(coalesce(v_store.public_country, '')), '') is not null,
    case
      when v_store_exists
        and nullif(trim(coalesce(v_store.public_city, '')), '') is not null
        and nullif(trim(coalesce(v_store.public_state, '')), '') is not null
        and nullif(trim(coalesce(v_store.public_country, '')), '') is not null
        then 'Public location is set.'
      else 'Public city, state, or country is missing.'
    end,
    case
      when v_store_exists
        and nullif(trim(coalesce(v_store.public_city, '')), '') is not null
        and nullif(trim(coalesce(v_store.public_state, '')), '') is not null
        and nullif(trim(coalesce(v_store.public_country, '')), '') is not null
        then 'No action needed.'
      else 'Add city, state, and country in Store Admin.'
    end,
    case
      when v_store_exists
        and nullif(trim(coalesce(v_store.public_city, '')), '') is not null
        and nullif(trim(coalesce(v_store.public_state, '')), '') is not null
        and nullif(trim(coalesce(v_store.public_country, '')), '') is not null
        then 1
      else 0
    end::bigint;

  return query
  select
    'required'::text,
    'terms_accepted'::text,
    'Seller terms'::text,
    v_store_exists and v_terms_accepted,
    case
      when v_store_exists and v_terms_accepted then 'Seller terms have been accepted.'
      else 'Seller terms acceptance is missing.'
    end,
    case
      when v_store_exists and v_terms_accepted then 'No action needed.'
      else 'Accept seller terms before launching.'
    end,
    case when v_store_exists and v_terms_accepted then 1 else 0 end::bigint;

  return query
  select
    'required'::text,
    'billing_access_active'::text,
    'Billing access'::text,
    v_store_exists and v_billing_active,
    case
      when v_store_exists and v_billing_active then 'Billing access is active.'
      else 'Billing access is not active.'
    end,
    case
      when v_store_exists and v_billing_active then 'No action needed.'
      else 'Update billing status before launching.'
    end,
    case when v_store_exists and v_billing_active then 1 else 0 end::bigint;

  return query
  select
    'required'::text,
    'no_admin_hold'::text,
    'No admin hold'::text,
    v_store_exists and v_store.admin_hold_reason is null,
    case
      when v_store_exists and v_store.admin_hold_reason is null then 'No admin hold is present.'
      else 'An admin hold is blocking launch.'
    end,
    case
      when v_store_exists and v_store.admin_hold_reason is null then 'No action needed.'
      else 'Ask an admin to review the hold before launching.'
    end,
    case when v_store_exists and v_store.admin_hold_reason is null then 1 else 0 end::bigint;

  return query
  select
    'required'::text,
    'saleable_inventory'::text,
    'Saleable inventory'::text,
    v_store_exists and v_saleable_inventory_rows > 0 and v_total_saleable_quantity > 0,
    case
      when v_store_exists and v_saleable_inventory_rows > 0 and v_total_saleable_quantity > 0
        then 'At least one saleable inventory row has available quantity.'
      else 'No saleable inventory with available quantity was found.'
    end,
    case
      when v_store_exists and v_saleable_inventory_rows > 0 and v_total_saleable_quantity > 0
        then 'No action needed.'
      else 'Publish inventory with available quantity.'
    end,
    coalesce(v_total_saleable_quantity, 0)::bigint;

  return query
  select
    'warning'::text,
    'about_text_present'::text,
    'About text'::text,
    v_store_exists and nullif(trim(coalesce(v_store.about_text, '')), '') is not null,
    case
      when v_store_exists and nullif(trim(coalesce(v_store.about_text, '')), '') is not null then 'About text is set.'
      else 'About text is missing.'
    end,
    case
      when v_store_exists and nullif(trim(coalesce(v_store.about_text, '')), '') is not null then 'No action needed.'
      else 'Add a short store description in Store Admin.'
    end,
    case when v_store_exists and nullif(trim(coalesce(v_store.about_text, '')), '') is not null then 1 else 0 end::bigint;

  return query
  select
    'warning'::text,
    'store_image_present'::text,
    'Store image or logo'::text,
    v_store_exists and v_store_media_count > 0,
    case
      when v_store_exists and v_store_media_count > 0 then 'Store image or logo is set.'
      else 'Store image or logo is missing.'
    end,
    case
      when v_store_exists and v_store_media_count > 0 then 'No action needed.'
      else 'Add a store logo or hero image when media tools are available.'
    end,
    coalesce(v_store_media_count, 0)::bigint;

  return query
  select
    'warning'::text,
    'pickup_instructions_present'::text,
    'Pickup instructions'::text,
    v_store_exists and nullif(trim(coalesce(v_store.pickup_instructions, '')), '') is not null,
    case
      when v_store_exists and nullif(trim(coalesce(v_store.pickup_instructions, '')), '') is not null then 'Pickup instructions are set.'
      else 'Pickup instructions are missing.'
    end,
    case
      when v_store_exists and nullif(trim(coalesce(v_store.pickup_instructions, '')), '') is not null then 'No action needed.'
      else 'Add pickup instructions in Store Admin.'
    end,
    case when v_store_exists and nullif(trim(coalesce(v_store.pickup_instructions, '')), '') is not null then 1 else 0 end::bigint;

  return query
  select
    'warning'::text,
    'public_email_present'::text,
    'Public email'::text,
    v_store_exists
      and nullif(trim(coalesce(v_store.public_email, '')), '') is not null
      and v_store.show_public_email = true,
    case
      when v_store_exists
        and nullif(trim(coalesce(v_store.public_email, '')), '') is not null
        and v_store.show_public_email = true
        then 'Public email is visible.'
      else 'Public email is missing or hidden.'
    end,
    case
      when v_store_exists
        and nullif(trim(coalesce(v_store.public_email, '')), '') is not null
        and v_store.show_public_email = true
        then 'No action needed.'
      else 'Add and show a public email in Store Admin.'
    end,
    case
      when v_store_exists
        and nullif(trim(coalesce(v_store.public_email, '')), '') is not null
        and v_store.show_public_email = true
        then 1
      else 0
    end::bigint;

  return query
  select
    'warning'::text,
    'inventory_quantity'::text,
    'Inventory quantity'::text,
    v_store_exists and v_total_saleable_quantity > 3,
    case
      when v_store_exists and v_total_saleable_quantity > 3 then 'Inventory quantity looks healthy.'
      else 'Available inventory is low.'
    end,
    case
      when v_store_exists and v_total_saleable_quantity > 3 then 'No action needed.'
      else 'Add more available quantity when you have more birds ready.'
    end,
    coalesce(v_total_saleable_quantity, 0)::bigint;
end;
$$;

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
set search_path = public
as $$
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
$$;

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
  set store_status = 'live'
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
    )
    values (
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
    ) as is_publicly_available,
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

comment on function public.evaluate_store_launch_readiness(uuid, uuid) is
'Internal launch readiness evaluator shared by seller-facing readiness checks and the trusted launch workflow.';

comment on function public.seller_get_store_launch_readiness(uuid) is
'Seller/admin read-only launch readiness checklist for Store Admin.';

comment on function public.trusted_launch_store(uuid, uuid) is
'Service-role-only store launch workflow. Revalidates ownership and readiness, then changes store_status from draft to live without changing storefront_enabled.';

revoke all on function public.evaluate_store_launch_readiness(uuid, uuid) from public;
revoke all on function public.seller_get_store_launch_readiness(uuid) from public;
revoke all on function public.trusted_launch_store(uuid, uuid) from public;

grant execute on function public.seller_get_store_launch_readiness(uuid) to authenticated;
grant execute on function public.trusted_launch_store(uuid, uuid) to service_role;

commit;
