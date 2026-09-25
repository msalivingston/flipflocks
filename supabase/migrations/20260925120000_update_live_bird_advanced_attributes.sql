drop function public.seller_update_inventory_item(uuid, text, text, numeric, integer, text);

create function public.seller_update_inventory_item(
  p_inventory_item_id uuid,
  p_inventory_type text,
  p_custom_inventory_label text default null,
  p_price_override numeric default null,
  p_sort_order integer default 0,
  p_seller_notes text default null,
  p_barn_location text default null,
  p_breeding_history text default null,
  p_feather_condition text default null,
  p_update_advanced_attributes boolean default false
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.listing_batches%rowtype;
  v_item public.inventory_items%rowtype;
  v_updated_item public.inventory_items%rowtype;
begin
  if p_inventory_type is null
    or p_inventory_type not in (
      'female', 'male', 'straight_run', 'unsexed', 'pair', 'trio',
      'hatching_eggs', 'other'
    ) then
    raise exception 'Invalid inventory type.';
  end if;

  if p_inventory_type = 'other'
    and nullif(trim(p_custom_inventory_label), '') is null then
    raise exception 'Custom inventory label is required for other inventory type.';
  end if;

  if coalesce(p_sort_order, 0) < 0 then
    raise exception 'Sort order must be nonnegative.';
  end if;

  if p_update_advanced_attributes then
    if char_length(btrim(p_barn_location)) > 200 then
      raise exception 'Barn location must be 200 characters or fewer.';
    end if;
    if p_breeding_history is not null
      and p_breeding_history not in ('never_bred', 'breeder') then
      raise exception 'Invalid breeding history.';
    end if;
    if p_feather_condition is not null
      and p_feather_condition not in ('excellent', 'good', 'rough', 'very_rough') then
      raise exception 'Invalid feather condition.';
    end if;
  end if;

  select * into v_item
  from public.inventory_items
  where id = p_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Inventory item not found.';
  end if;

  if not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Not authorized to update this inventory item.';
  end if;

  select * into v_batch
  from public.listing_batches
  where id = v_item.listing_batch_id;

  if v_batch.id is null or v_batch.store_id <> v_item.store_id then
    raise exception 'Inventory hierarchy is invalid.';
  end if;

  if (v_batch.batch_type = 'hatching_eggs' and p_inventory_type <> 'hatching_eggs')
    or (v_batch.batch_type = 'live_animals' and p_inventory_type = 'hatching_eggs') then
    raise exception 'Inventory type is not compatible with listing batch type.';
  end if;

  update public.inventory_items
  set
    inventory_type = p_inventory_type,
    custom_inventory_label = nullif(trim(p_custom_inventory_label), ''),
    price_override = p_price_override,
    sort_order = coalesce(p_sort_order, 0),
    seller_notes = nullif(trim(p_seller_notes), ''),
    barn_location = case
      when p_update_advanced_attributes then nullif(btrim(p_barn_location), '')
      else v_item.barn_location
    end,
    breeding_history = case
      when p_update_advanced_attributes then p_breeding_history
      else v_item.breeding_history
    end,
    feather_condition = case
      when p_update_advanced_attributes then p_feather_condition
      else v_item.feather_condition
    end
  where id = v_item.id
  returning * into v_updated_item;

  perform public.log_inventory_activity_event(
    v_updated_item.store_id, v_updated_item.listing_batch_id,
    v_updated_item.listing_batch_breed_id, v_updated_item.id,
    'inventory_item_updated', v_item.quantity_available,
    v_updated_item.quantity_available, v_item.visibility_status,
    v_updated_item.visibility_status, null,
    jsonb_build_object(
      'previous_inventory_type', v_item.inventory_type,
      'new_inventory_type', v_updated_item.inventory_type,
      'previous_price_override', v_item.price_override,
      'new_price_override', v_updated_item.price_override
    )
  );

  return v_updated_item;
end;
$$;

revoke all on function public.seller_update_inventory_item(
  uuid, text, text, numeric, integer, text, text, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.seller_update_inventory_item(
  uuid, text, text, numeric, integer, text, text, text, text, boolean
) to authenticated;

comment on function public.seller_update_inventory_item(
  uuid, text, text, numeric, integer, text, text, text, text, boolean
) is
'Trusted seller/admin RPC to update seller-editable inventory details. Advanced live-bird attributes are updated only when p_update_advanced_attributes is true.';
