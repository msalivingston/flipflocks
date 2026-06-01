-- Group 70B: Schema Integrity and Store-Scoped Query Hardening
--
-- Scope:
-- - Makes order cancellation inventory restoration explicit and opt-in.
-- - Adds low-risk store-scoped indexes for current seller/storefront paths.
-- - Adds a store-scoped dashboard RPC so the dashboard can avoid broad
--   cross-store summary views for its home card.
-- - Adds NOT VALID composite foreign keys for future cross-store consistency
--   without blocking the migration on existing development data.

-- ---------------------------------------------------------------------------
-- Low-risk indexes aligned with current seller/public query paths.
-- ---------------------------------------------------------------------------

create index if not exists listing_batches_store_updated_at_idx
on public.listing_batches(store_id, updated_at desc);

create index if not exists inventory_items_store_updated_at_idx
on public.inventory_items(store_id, updated_at desc);

create index if not exists media_links_store_active_entity_featured_idx
on public.media_links(store_id, entity_type, entity_id, is_featured desc, sort_order, created_at)
where visibility_status = 'active';


-- ---------------------------------------------------------------------------
-- Store-scoped seller dashboard home RPC.
-- ---------------------------------------------------------------------------

create or replace function public.get_seller_dashboard_home(
  p_store_id uuid
)
returns table (
  store_id uuid,
  store_name text,
  store_slug text,
  storefront_enabled boolean,
  store_status text,
  storefront_mode text,
  is_publicly_available boolean,
  unavailable_reason_code text,
  active_listing_count bigint,
  sold_out_listing_count bigint,
  total_active_inventory_quantity bigint,
  pending_open_order_count bigint,
  fulfilled_order_count bigint,
  canceled_order_count bigint,
  oldest_order_requiring_action_at timestamptz,
  pending_refund_count bigint,
  failed_refund_count bigint,
  failed_notification_count bigint,
  pending_notification_count bigint,
  upcoming_pickup_order_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with target_store as (
    select stores.*
    from public.stores
    where stores.id = p_store_id
      and (
        public.owns_store(stores.id)
        or public.is_admin()
      )
  ),
  inventory_availability as (
    select
      inventory_items.quantity_available,
      case
        when listing_batches.visibility_status = 'sold_out'
          or inventory_items.quantity_available <= 0
          then 'sold_out'
        when listing_batches.available_date > current_date
          then 'coming_soon'
        when inventory_items.quantity_available <= 3
          then 'limited_availability'
        else 'available'
      end as availability_status
    from target_store
    join public.inventory_items
      on inventory_items.store_id = target_store.id
    join public.listing_batch_breeds
      on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
     and listing_batch_breeds.store_id = target_store.id
    join public.listing_batches
      on listing_batches.id = inventory_items.listing_batch_id
     and listing_batches.store_id = target_store.id
    join public.seller_breed_profiles
      on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
     and seller_breed_profiles.store_id = target_store.id
    join public.species
      on species.id = listing_batches.species_id
    where species.is_active = true
      and seller_breed_profiles.visibility_status = 'active'
      and seller_breed_profiles.moderation_status = 'normal'
      and listing_batches.visibility_status in ('active', 'sold_out')
      and listing_batches.moderation_status = 'normal'
      and listing_batch_breeds.visibility_status = 'active'
      and listing_batch_breeds.moderation_status = 'normal'
      and inventory_items.visibility_status = 'active'
      and inventory_items.moderation_status = 'normal'
      and (
        (
          listing_batches.batch_type = 'hatching_eggs'
          and inventory_items.inventory_type = 'hatching_eggs'
        )
        or (
          listing_batches.batch_type = 'live_animals'
          and inventory_items.inventory_type <> 'hatching_eggs'
        )
      )
  ),
  inventory_summary as (
    select
      count(*) filter (
        where inventory_availability.availability_status <> 'sold_out'
      ) as active_listing_count,
      count(*) filter (
        where inventory_availability.availability_status = 'sold_out'
      ) as sold_out_listing_count,
      coalesce(
        sum(inventory_availability.quantity_available) filter (
          where inventory_availability.availability_status <> 'sold_out'
        ),
        0
      )::bigint as total_active_inventory_quantity
    from inventory_availability
  ),
  order_summary as (
    select
      count(*) filter (
        where orders.order_status in ('pending', 'open')
      ) as pending_open_order_count,
      count(*) filter (
        where orders.order_status = 'fulfilled'
      ) as fulfilled_order_count,
      count(*) filter (
        where orders.order_status = 'canceled'
      ) as canceled_order_count,
      min(orders.created_at) filter (
        where orders.order_status in ('pending', 'open')
      ) as oldest_order_requiring_action_at,
      count(*) filter (
        where orders.ready_for_pickup_at is not null
          and orders.order_status in ('pending', 'open')
      ) as upcoming_pickup_order_count
    from target_store
    left join public.orders
      on orders.store_id = target_store.id
  ),
  refund_summary as (
    select
      count(*) filter (where order_refunds.refund_status = 'pending') as pending_refund_count,
      count(*) filter (where order_refunds.refund_status = 'failed') as failed_refund_count
    from target_store
    left join public.order_refunds
      on order_refunds.store_id = target_store.id
  ),
  notification_summary as (
    select
      count(*) filter (where email_notifications.notification_status = 'failed') as failed_notification_count,
      count(*) filter (where email_notifications.notification_status = 'pending') as pending_notification_count
    from target_store
    left join public.email_notifications
      on email_notifications.store_id = target_store.id
  )
  select
    target_store.id as store_id,
    target_store.store_name,
    target_store.store_slug,
    target_store.storefront_enabled,
    target_store.store_status,
    target_store.storefront_mode,
    (
      target_store.storefront_enabled = true
      and target_store.store_status = 'live'
      and target_store.storefront_mode in ('hosted', 'embedded')
      and target_store.admin_hold_reason is null
    ) as is_publicly_available,
    case
      when target_store.admin_hold_reason is not null then 'admin_hold'
      when target_store.storefront_enabled = false then 'storefront_disabled'
      when target_store.store_status <> 'live' then 'store_not_live'
      when target_store.storefront_mode not in ('hosted', 'embedded') then 'storefront_private'
      else 'available'
    end as unavailable_reason_code,
    coalesce(inventory_summary.active_listing_count, 0),
    coalesce(inventory_summary.sold_out_listing_count, 0),
    coalesce(inventory_summary.total_active_inventory_quantity, 0),
    coalesce(order_summary.pending_open_order_count, 0),
    coalesce(order_summary.fulfilled_order_count, 0),
    coalesce(order_summary.canceled_order_count, 0),
    order_summary.oldest_order_requiring_action_at,
    coalesce(refund_summary.pending_refund_count, 0),
    coalesce(refund_summary.failed_refund_count, 0),
    coalesce(notification_summary.failed_notification_count, 0),
    coalesce(notification_summary.pending_notification_count, 0),
    coalesce(order_summary.upcoming_pickup_order_count, 0)
  from target_store
  cross join inventory_summary
  cross join order_summary
  cross join refund_summary
  cross join notification_summary;
$$;

comment on function public.get_seller_dashboard_home(uuid) is
'Store-scoped seller dashboard summary. Filters to the requested store before aggregating inventory, order, refund, and notification data.';

revoke all on function public.get_seller_dashboard_home(uuid) from public;
grant execute on function public.get_seller_dashboard_home(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Slug-scoped public storefront home RPC.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_storefront_home(
  p_store_slug text
)
returns table (
  store_id uuid,
  store_slug text,
  store_name text,
  store_tagline text,
  public_city text,
  public_state text,
  public_country text,
  about_text text,
  pickup_policy text,
  cancellation_policy text,
  pickup_instructions text,
  public_email text,
  public_phone text,
  website_url text,
  social_url text,
  npip_number text,
  hero_image_url text,
  hero_image_alt_text text,
  logo_image_url text,
  logo_image_alt_text text,
  public_inventory_item_count bigint,
  ready_now_item_count bigint,
  reserve_now_item_count bigint,
  sold_out_item_count bigint,
  total_quantity_available bigint,
  next_available_date date,
  has_public_inventory boolean
)
language sql
stable
set search_path = public
as $$
  with target_store as (
    select stores.*
    from public.stores
    where stores.store_slug = lower(trim(p_store_slug))
      and stores.storefront_enabled = true
      and stores.store_status = 'live'
      and stores.storefront_mode in ('hosted', 'embedded')
      and stores.admin_hold_reason is null
  ),
  public_inventory as (
    select
      inventory_items.quantity_available,
      listing_batches.available_date,
      case
        when listing_batches.visibility_status = 'sold_out'
          or inventory_items.quantity_available <= 0
          then 'sold_out'
        when listing_batches.available_date > current_date
          then 'reserve_now'
        else 'ready_now'
      end as buyer_availability_code
    from target_store
    join public.inventory_items
      on inventory_items.store_id = target_store.id
    join public.listing_batches
      on listing_batches.id = inventory_items.listing_batch_id
     and listing_batches.store_id = target_store.id
    join public.listing_batch_breeds
      on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
     and listing_batch_breeds.store_id = target_store.id
    join public.seller_breed_profiles
      on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
     and seller_breed_profiles.store_id = target_store.id
    join public.species
      on species.id = listing_batches.species_id
    where species.is_active = true
      and seller_breed_profiles.visibility_status = 'active'
      and seller_breed_profiles.moderation_status = 'normal'
      and listing_batches.visibility_status in ('active', 'sold_out')
      and listing_batches.moderation_status = 'normal'
      and listing_batch_breeds.visibility_status = 'active'
      and listing_batch_breeds.moderation_status = 'normal'
      and inventory_items.visibility_status = 'active'
      and inventory_items.moderation_status = 'normal'
      and (
        (
          listing_batches.batch_type = 'hatching_eggs'
          and inventory_items.inventory_type = 'hatching_eggs'
        )
        or (
          listing_batches.batch_type = 'live_animals'
          and inventory_items.inventory_type <> 'hatching_eggs'
        )
      )
  ),
  inventory_summary as (
    select
      count(*) as public_inventory_item_count,
      count(*) filter (
        where public_inventory.buyer_availability_code = 'ready_now'
      ) as ready_now_item_count,
      count(*) filter (
        where public_inventory.buyer_availability_code = 'reserve_now'
      ) as reserve_now_item_count,
      count(*) filter (
        where public_inventory.buyer_availability_code = 'sold_out'
      ) as sold_out_item_count,
      coalesce(sum(public_inventory.quantity_available), 0)::bigint as total_quantity_available,
      min(public_inventory.available_date) filter (
        where public_inventory.quantity_available > 0
      ) as next_available_date
    from public_inventory
  )
  select
    target_store.id as store_id,
    target_store.store_slug,
    target_store.store_name,
    target_store.store_tagline,
    target_store.public_city,
    target_store.public_state,
    target_store.public_country,
    target_store.about_text,
    target_store.pickup_policy,
    target_store.cancellation_policy,
    target_store.pickup_instructions,
    case
      when target_store.show_public_email then target_store.public_email
      else null
    end as public_email,
    case
      when target_store.show_public_phone then target_store.public_phone
      else null
    end as public_phone,
    target_store.website_url,
    target_store.social_url,
    case
      when target_store.show_npip then target_store.npip_number
      else null
    end as npip_number,
    hero_media.image_url as hero_image_url,
    hero_media.alt_text as hero_image_alt_text,
    logo_media.image_url as logo_image_url,
    logo_media.alt_text as logo_image_alt_text,
    coalesce(inventory_summary.public_inventory_item_count, 0),
    coalesce(inventory_summary.ready_now_item_count, 0),
    coalesce(inventory_summary.reserve_now_item_count, 0),
    coalesce(inventory_summary.sold_out_item_count, 0),
    coalesce(inventory_summary.total_quantity_available, 0),
    inventory_summary.next_available_date,
    coalesce(inventory_summary.public_inventory_item_count, 0) > 0
  from target_store
  cross join inventory_summary
  left join lateral (
    select
      '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
      coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
    from public.media_links
    join public.media_assets
      on media_assets.id = media_links.media_asset_id
     and media_assets.store_id = media_links.store_id
    where media_links.store_id = target_store.id
      and media_links.entity_type = 'store'
      and media_links.entity_id = target_store.id
      and media_links.display_context = 'hero'
      and media_links.visibility_status = 'active'
      and media_assets.asset_status = 'active'
      and media_assets.moderation_status = 'approved'
    order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
    limit 1
  ) as hero_media on true
  left join lateral (
    select
      '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
      coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
    from public.media_links
    join public.media_assets
      on media_assets.id = media_links.media_asset_id
     and media_assets.store_id = media_links.store_id
    where media_links.store_id = target_store.id
      and media_links.entity_type = 'store'
      and media_links.entity_id = target_store.id
      and media_links.display_context = 'logo'
      and media_links.visibility_status = 'active'
      and media_assets.asset_status = 'active'
      and media_assets.moderation_status = 'approved'
    order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
    limit 1
  ) as logo_media on true;
$$;

comment on function public.get_public_storefront_home(text) is
'Slug-scoped public storefront home payload. Filters to the requested public store before inventory summary aggregation.';

revoke all on function public.get_public_storefront_home(text) from public;
grant execute on function public.get_public_storefront_home(text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Cancellation with explicit restore_inventory opt-in.
-- ---------------------------------------------------------------------------

drop function if exists public.cancel_order(uuid, text);

create function public.cancel_order(
  p_order_id uuid,
  p_canceled_reason text,
  p_restore_inventory boolean default false
)
returns table (
  order_id uuid,
  order_number text,
  store_id uuid,
  order_status text,
  payment_status text,
  fulfilled_at timestamptz,
  canceled_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_store public.stores%rowtype;
  v_from_order_status text;
  v_from_payment_status text;
  v_to_payment_status text;
  v_canceled_reason text;
  v_restore_inventory boolean;
  v_actor_type text;
  v_inventory_metadata jsonb;
  v_item record;
begin
  v_canceled_reason := nullif(trim(p_canceled_reason), '');
  v_restore_inventory := coalesce(p_restore_inventory, false);

  if v_canceled_reason is null then
    raise exception 'Cancellation reason is required.';
  end if;

  select *
  into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'Order is not available.';
  end if;

  if not (public.owns_store(v_order.store_id) or public.is_admin()) then
    raise exception 'Order is not available.';
  end if;

  if v_order.order_status not in ('pending', 'open') then
    raise exception 'Only pending or open orders can be canceled.';
  end if;

  v_from_order_status := v_order.order_status;
  v_from_payment_status := v_order.payment_status;
  v_to_payment_status := case
    when v_order.payment_status in ('unpaid', 'pay_at_pickup') then 'canceled'
    else v_order.payment_status
  end;

  drop table if exists pg_temp.cancel_order_items;

  create temporary table pg_temp.cancel_order_items (
    order_item_id uuid primary key,
    inventory_item_id uuid not null,
    listing_batch_id uuid,
    listing_batch_breed_id uuid,
    quantity_to_restore integer not null,
    from_quantity_available integer not null
  ) on commit drop;

  if v_restore_inventory then
    insert into pg_temp.cancel_order_items (
      order_item_id,
      inventory_item_id,
      listing_batch_id,
      listing_batch_breed_id,
      quantity_to_restore,
      from_quantity_available
    )
    select
      order_items.id,
      order_items.inventory_item_id,
      order_items.listing_batch_id,
      order_items.listing_batch_breed_id,
      order_items.quantity - order_items.fulfilled_quantity - order_items.restored_quantity,
      inventory_items.quantity_available
    from public.order_items
    join public.inventory_items
      on inventory_items.id = order_items.inventory_item_id
     and inventory_items.store_id = v_order.store_id
    where order_items.order_id = v_order.id
      and order_items.store_id = v_order.store_id
      and coalesce(order_items.order_item_source, 'inventory') = 'inventory'
      and order_items.inventory_item_id is not null
      and order_items.quantity - order_items.fulfilled_quantity - order_items.restored_quantity > 0
    order by inventory_items.id
    for update of inventory_items, order_items;

    update public.inventory_items
    set quantity_available = inventory_items.quantity_available + cancel_order_items.quantity_to_restore
    from pg_temp.cancel_order_items
    where inventory_items.id = cancel_order_items.inventory_item_id
      and inventory_items.store_id = v_order.store_id;

    update public.order_items
    set restored_quantity = order_items.restored_quantity + cancel_order_items.quantity_to_restore
    from pg_temp.cancel_order_items
    where order_items.id = cancel_order_items.order_item_id
      and order_items.order_id = v_order.id
      and order_items.store_id = v_order.store_id;

    for v_item in
      select *
      from pg_temp.cancel_order_items
      order by inventory_item_id
    loop
      perform public.log_inventory_activity_event(
        v_order.store_id,
        v_item.listing_batch_id,
        v_item.listing_batch_breed_id,
        v_item.inventory_item_id,
        'inventory_quantity_adjusted',
        v_item.from_quantity_available,
        v_item.from_quantity_available + v_item.quantity_to_restore,
        null,
        null,
        'Canceled order inventory restoration',
        jsonb_build_object(
          'order_id', v_order.id,
          'order_number', v_order.order_number,
          'order_item_id', v_item.order_item_id,
          'quantity_restored', v_item.quantity_to_restore,
          'restore_inventory_requested', true
        )
      );
    end loop;
  end if;

  select jsonb_build_object(
    'restore_inventory_requested', v_restore_inventory,
    'inventory_adjustments',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'order_item_id', cancel_order_items.order_item_id,
          'inventory_item_id', cancel_order_items.inventory_item_id,
          'quantity_restored', cancel_order_items.quantity_to_restore
        )
        order by cancel_order_items.inventory_item_id
      ) filter (where cancel_order_items.order_item_id is not null),
      '[]'::jsonb
    )
  )
  into v_inventory_metadata
  from pg_temp.cancel_order_items;

  update public.orders
  set
    order_status = 'canceled',
    payment_status = v_to_payment_status,
    canceled_at = now(),
    canceled_reason = v_canceled_reason
  where orders.id = v_order.id
  returning * into v_order;

  select *
  into v_store
  from public.stores
  where stores.id = v_order.store_id;

  v_actor_type := case when public.is_admin() then 'admin' else 'seller' end;

  insert into public.order_events (
    store_id,
    order_id,
    actor_user_id,
    actor_type,
    event_type,
    from_order_status,
    to_order_status,
    from_payment_status,
    to_payment_status,
    note,
    metadata
  )
  values (
    v_order.store_id,
    v_order.id,
    auth.uid(),
    v_actor_type,
    'order_canceled',
    v_from_order_status,
    'canceled',
    v_from_payment_status,
    v_to_payment_status,
    v_canceled_reason,
    v_inventory_metadata
  );

  perform public.enqueue_email_notification(
    v_order.store_id,
    v_order.id,
    'buyer_order_canceled',
    'buyer',
    v_order.buyer_email_snapshot,
    'Order canceled: ' || v_order.order_number,
    jsonb_build_object(
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'store_id', v_order.store_id,
      'store_name', v_store.store_name,
      'store_slug', v_store.store_slug,
      'buyer_first_name', v_order.buyer_first_name_snapshot,
      'buyer_last_name', v_order.buyer_last_name_snapshot,
      'buyer_email', v_order.buyer_email_snapshot,
      'order_status', v_order.order_status,
      'payment_status', v_order.payment_status,
      'total_amount', v_order.total_amount,
      'created_at', v_order.created_at,
      'canceled_at', v_order.canceled_at
    )
  );

  return query
  select
    orders.id,
    orders.order_number,
    orders.store_id,
    orders.order_status,
    orders.payment_status,
    orders.fulfilled_at,
    orders.canceled_at,
    orders.updated_at
  from public.orders
  where orders.id = v_order.id;
end;
$$;

comment on function public.cancel_order(uuid, text, boolean) is
'Cancels a pending/open order. Inventory restoration is explicit and opt-in through p_restore_inventory; custom manual items never restore inventory.';

revoke all on function public.cancel_order(uuid, text, boolean) from public;
grant execute on function public.cancel_order(uuid, text, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- Minimal future-write store consistency constraints.
-- Existing data is not validated here; these constraints are intentionally
-- NOT VALID so any cleanup can be handled in a separate data-quality group.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_id_store_unique'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_id_store_unique unique (id, store_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'listing_batches_id_store_unique'
      and conrelid = 'public.listing_batches'::regclass
  ) then
    alter table public.listing_batches
      add constraint listing_batches_id_store_unique unique (id, store_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'listing_batch_breeds_id_store_unique'
      and conrelid = 'public.listing_batch_breeds'::regclass
  ) then
    alter table public.listing_batch_breeds
      add constraint listing_batch_breeds_id_store_unique unique (id, store_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'seller_breed_profiles_id_store_unique'
      and conrelid = 'public.seller_breed_profiles'::regclass
  ) then
    alter table public.seller_breed_profiles
      add constraint seller_breed_profiles_id_store_unique unique (id, store_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_items_id_store_unique'
      and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
      add constraint inventory_items_id_store_unique unique (id, store_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'listing_batch_breeds_listing_batch_store_fk'
      and conrelid = 'public.listing_batch_breeds'::regclass
  ) then
    alter table public.listing_batch_breeds
      add constraint listing_batch_breeds_listing_batch_store_fk
      foreign key (listing_batch_id, store_id)
      references public.listing_batches(id, store_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'listing_batch_breeds_profile_store_fk'
      and conrelid = 'public.listing_batch_breeds'::regclass
  ) then
    alter table public.listing_batch_breeds
      add constraint listing_batch_breeds_profile_store_fk
      foreign key (seller_breed_profile_id, store_id)
      references public.seller_breed_profiles(id, store_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_items_listing_batch_store_fk'
      and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
      add constraint inventory_items_listing_batch_store_fk
      foreign key (listing_batch_id, store_id)
      references public.listing_batches(id, store_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_items_listing_batch_breed_store_fk'
      and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
      add constraint inventory_items_listing_batch_breed_store_fk
      foreign key (listing_batch_breed_id, store_id)
      references public.listing_batch_breeds(id, store_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'order_items_order_store_fk'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_order_store_fk
      foreign key (order_id, store_id)
      references public.orders(id, store_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'order_items_inventory_item_store_fk'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_inventory_item_store_fk
      foreign key (inventory_item_id, store_id)
      references public.inventory_items(id, store_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'order_items_listing_batch_store_fk'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_listing_batch_store_fk
      foreign key (listing_batch_id, store_id)
      references public.listing_batches(id, store_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'order_items_listing_batch_breed_store_fk'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_listing_batch_breed_store_fk
      foreign key (listing_batch_breed_id, store_id)
      references public.listing_batch_breeds(id, store_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'order_items_seller_breed_profile_store_fk'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_seller_breed_profile_store_fk
      foreign key (seller_breed_profile_id, store_id)
      references public.seller_breed_profiles(id, store_id)
      not valid;
  end if;
end;
$$;
