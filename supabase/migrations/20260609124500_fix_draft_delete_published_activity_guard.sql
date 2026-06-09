-- Only listing batch visibility history should block draft deletion.
-- Active inventory rows can be created inside a hidden draft and must not count
-- as previously published inventory.

create or replace function public.seller_get_draft_listing_batch_delete_status(
  p_listing_batch_id uuid
)
returns table (
  is_draft boolean,
  has_order_history boolean,
  has_published_activity boolean,
  can_delete boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.listing_batches%rowtype;
  v_has_order_history boolean;
  v_has_published_activity boolean;
begin
  select *
  into v_batch
  from public.listing_batches
  where listing_batches.id = p_listing_batch_id;

  if v_batch.id is null then
    raise exception 'Draft not found.';
  end if;

  if not (
    public.owns_store(v_batch.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to inspect this draft.';
  end if;

  select exists (
    select 1
    from public.order_items
    where order_items.listing_batch_id = v_batch.id
  )
  into v_has_order_history;

  select exists (
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
  )
  into v_has_published_activity;

  return query
  select
    v_batch.visibility_status = 'hidden',
    v_has_order_history,
    v_has_published_activity,
    v_batch.visibility_status = 'hidden'
      and not v_has_order_history
      and not v_has_published_activity;
end;
$$;

create or replace function public.seller_delete_draft_listing_batch(
  p_listing_batch_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.listing_batches%rowtype;
  v_breed_ids uuid[];
  v_inventory_item_ids uuid[];
begin
  select *
  into v_batch
  from public.listing_batches
  where listing_batches.id = p_listing_batch_id
  for update;

  if v_batch.id is null then
    raise exception 'Draft not found.';
  end if;

  if not (
    public.owns_store(v_batch.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to delete this draft.';
  end if;

  if v_batch.visibility_status <> 'hidden' then
    raise exception 'Only drafts can be deleted.';
  end if;

  if exists (
    select 1
    from public.order_items
    where order_items.listing_batch_id = v_batch.id
  ) then
    raise exception 'This inventory has order history and can only be archived.';
  end if;

  if exists (
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
  ) then
    raise exception 'This inventory has been published before and can only be archived.';
  end if;

  select coalesce(array_agg(listing_batch_breeds.id), '{}'::uuid[])
  into v_breed_ids
  from public.listing_batch_breeds
  where listing_batch_breeds.listing_batch_id = v_batch.id;

  select coalesce(array_agg(inventory_items.id), '{}'::uuid[])
  into v_inventory_item_ids
  from public.inventory_items
  where inventory_items.listing_batch_id = v_batch.id;

  delete from public.media_links
  where media_links.store_id = v_batch.store_id
    and (
      (
        media_links.entity_type = 'listing_batch'
        and media_links.entity_id = v_batch.id
      )
      or (
        media_links.entity_type = 'listing_batch_breed'
        and media_links.entity_id = any(v_breed_ids)
      )
      or (
        media_links.entity_type = 'inventory_item'
        and media_links.entity_id = any(v_inventory_item_ids)
      )
    );

  delete from public.inventory_activity_events
  where inventory_activity_events.store_id = v_batch.store_id
    and (
      inventory_activity_events.listing_batch_id = v_batch.id
      or inventory_activity_events.listing_batch_breed_id = any(v_breed_ids)
      or inventory_activity_events.inventory_item_id = any(v_inventory_item_ids)
    );

  delete from public.listing_batches
  where listing_batches.id = v_batch.id;
end;
$$;
