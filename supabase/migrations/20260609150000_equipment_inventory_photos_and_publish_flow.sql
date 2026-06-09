alter table public.media_links
  drop constraint if exists media_links_entity_type_check;

alter table public.media_links
  add constraint media_links_entity_type_check check (
    entity_type in (
      'store',
      'seller_breed_profile',
      'listing_batch',
      'listing_batch_breed',
      'inventory_item',
      'equipment_inventory_item'
    )
  );

create or replace function public.validate_seller_media_entity(
  p_store_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_store_id is null or p_entity_type is null or p_entity_id is null then
    return false;
  end if;

  case p_entity_type
    when 'store' then
      return p_entity_id = p_store_id
        and exists (
          select 1
          from public.stores
          where stores.id = p_store_id
        );
    when 'listing_batch' then
      return exists (
        select 1
        from public.listing_batches
        where listing_batches.id = p_entity_id
          and listing_batches.store_id = p_store_id
      );
    when 'listing_batch_breed' then
      return exists (
        select 1
        from public.listing_batch_breeds
        where listing_batch_breeds.id = p_entity_id
          and listing_batch_breeds.store_id = p_store_id
      );
    when 'inventory_item' then
      return exists (
        select 1
        from public.inventory_items
        where inventory_items.id = p_entity_id
          and inventory_items.store_id = p_store_id
      );
    when 'seller_breed_profile' then
      return exists (
        select 1
        from public.seller_breed_profiles
        where seller_breed_profiles.id = p_entity_id
          and seller_breed_profiles.store_id = p_store_id
      );
    when 'equipment_inventory_item' then
      return exists (
        select 1
        from public.equipment_inventory_items
        where equipment_inventory_items.id = p_entity_id
          and equipment_inventory_items.store_id = p_store_id
      );
    else
      return false;
  end case;
end;
$$;

create or replace function public.validate_seller_media_context(
  p_entity_type text,
  p_display_context text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_entity_type
    when 'store' then p_display_context in ('logo', 'hero', 'gallery')
    when 'listing_batch' then p_display_context in ('primary', 'gallery')
    when 'listing_batch_breed' then p_display_context in ('primary', 'gallery')
    when 'inventory_item' then p_display_context in ('primary', 'gallery')
    when 'seller_breed_profile' then p_display_context in ('primary', 'gallery')
    when 'equipment_inventory_item' then p_display_context in ('primary', 'gallery')
    else false
  end;
$$;

create or replace function public.enforce_equipment_media_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_active_count integer;
begin
  if new.entity_type <> 'equipment_inventory_item'
    or new.display_context <> 'gallery'
    or new.visibility_status <> 'active' then
    return new;
  end if;

  select count(*)
  into v_active_count
  from public.media_links
  join public.media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.entity_type = new.entity_type
    and media_links.entity_id = new.entity_id
    and media_links.display_context = new.display_context
    and media_links.visibility_status = 'active'
    and media_links.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and media_assets.asset_status = 'active';

  if v_active_count >= 4 then
    raise exception 'Equipment & Supplies can have up to 4 photos.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_equipment_media_limit_trigger on public.media_links;

create trigger enforce_equipment_media_limit_trigger
before insert or update of entity_type, entity_id, display_context, visibility_status
on public.media_links
for each row
execute function public.enforce_equipment_media_limit();

create or replace function public.seller_delete_equipment_draft(
  p_equipment_inventory_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.equipment_inventory_items%rowtype;
begin
  select *
  into v_item
  from public.equipment_inventory_items
  where equipment_inventory_items.id = p_equipment_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Equipment inventory not found.';
  end if;

  if not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Not authorized to delete this equipment draft.';
  end if;

  if v_item.visibility_status <> 'hidden' then
    raise exception 'Only drafts can be deleted.';
  end if;

  if v_item.first_published_at is not null then
    raise exception 'This equipment inventory has been published before and can only be archived.';
  end if;

  delete from public.media_links
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'equipment_inventory_item'
    and media_links.entity_id = v_item.id;

  delete from public.equipment_inventory_items
  where equipment_inventory_items.id = v_item.id;
end;
$$;

comment on function public.validate_seller_media_entity(uuid, text, uuid) is
'Validates that a seller media entity belongs to the given store, including Equipment & Supplies inventory items.';

comment on function public.validate_seller_media_context(text, text) is
'Validates supported media display contexts by entity type.';

comment on function public.enforce_equipment_media_limit() is
'Keeps Equipment & Supplies inventory items limited to four active gallery photos.';

comment on function public.seller_delete_equipment_draft(uuid) is
'Trusted seller/admin RPC to permanently delete never-published Equipment & Supplies drafts and their media links.';

revoke all on function public.enforce_equipment_media_limit() from public;
