begin;

create or replace function public.seller_sync_hatching_egg_group_media_from_item(
  p_hatching_egg_inventory_item_id uuid
)
returns setof public.seller_media_management
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.hatching_egg_inventory_items%rowtype;
  v_group_key text;
  v_group_ids uuid[];
  v_link_ids uuid[];
begin
  select *
  into v_item
  from public.hatching_egg_inventory_items
  where id = p_hatching_egg_inventory_item_id
    and visibility_status <> 'archived'
  for update;

  if not found or not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Hatching egg item not found';
  end if;

  v_group_key := public.normalize_hatching_egg_item_name(v_item.item_name);

  v_group_ids := array(
    select hatching_items.id
    from public.hatching_egg_inventory_items as hatching_items
    where hatching_items.store_id = v_item.store_id
      and hatching_items.visibility_status <> 'archived'
      and public.normalize_hatching_egg_item_name(hatching_items.item_name) = v_group_key
    order by hatching_items.id
    for update
  );

  perform media_links.id
  from public.media_links as media_links
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = any(v_group_ids)
    and media_links.display_context = 'gallery'
  for update;

  update public.media_links
  set
    visibility_status = 'archived',
    is_featured = false,
    updated_at = now()
  where store_id = v_item.store_id
    and entity_type = 'hatching_egg_inventory_item'
    and entity_id = any(v_group_ids)
    and display_context = 'gallery'
    and visibility_status = 'active'
    and media_asset_id not in (
      select source_links.media_asset_id
      from public.media_links as source_links
      join public.media_assets as source_assets
        on source_assets.id = source_links.media_asset_id
       and source_assets.store_id = source_links.store_id
      where source_links.store_id = v_item.store_id
        and source_links.entity_type = 'hatching_egg_inventory_item'
        and source_links.entity_id = v_item.id
        and source_links.display_context = 'gallery'
        and source_links.visibility_status = 'active'
        and source_assets.asset_status = 'active'
    );

  insert into public.media_links (
    store_id,
    media_asset_id,
    entity_type,
    entity_id,
    display_context,
    sort_order,
    is_featured,
    alt_text_override,
    caption,
    crop_metadata,
    visibility_status
  )
  select
    v_item.store_id,
    source_links.media_asset_id,
    'hatching_egg_inventory_item',
    group_item_id,
    'gallery',
    source_links.sort_order,
    source_links.is_featured,
    source_links.alt_text_override,
    source_links.caption,
    source_links.crop_metadata,
    'active'
  from public.media_links as source_links
  join public.media_assets as source_assets
    on source_assets.id = source_links.media_asset_id
   and source_assets.store_id = source_links.store_id
  cross join unnest(v_group_ids) as group_item_id
  where source_links.store_id = v_item.store_id
    and source_links.entity_type = 'hatching_egg_inventory_item'
    and source_links.entity_id = v_item.id
    and source_links.display_context = 'gallery'
    and source_links.visibility_status = 'active'
    and source_assets.asset_status = 'active'
  on conflict (entity_type, entity_id, media_asset_id) do update
  set
    display_context = excluded.display_context,
    sort_order = excluded.sort_order,
    is_featured = excluded.is_featured,
    alt_text_override = excluded.alt_text_override,
    caption = excluded.caption,
    crop_metadata = excluded.crop_metadata,
    visibility_status = 'active',
    updated_at = now();

  select array_agg(media_links.id order by media_links.sort_order, media_links.created_at, media_links.id)
  into v_link_ids
  from public.media_links as media_links
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'hatching_egg_inventory_item'
    and media_links.entity_id = v_item.id
    and media_links.display_context = 'gallery'
    and media_links.visibility_status = 'active';

  return query
  select *
  from public.media_management_response_for_links(coalesce(v_link_ids, array[]::uuid[])) as media
  order by media.is_featured desc, media.sort_order asc, media.linked_at asc;
end;
$$;

comment on function public.seller_sync_hatching_egg_group_media_from_item(uuid) is
'Trusted seller/admin RPC that copies one standalone Hatching Eggs item''s active gallery media set to every non-archived item in its current normalized-name group after save.';

revoke all on function public.seller_sync_hatching_egg_group_media_from_item(uuid) from public;

grant execute on function public.seller_sync_hatching_egg_group_media_from_item(uuid) to authenticated;

commit;
