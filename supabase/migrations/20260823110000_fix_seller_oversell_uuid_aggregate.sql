begin;

-- Preserve existing reconciliation behavior while selecting a deterministic
-- order-item UUID for audit metadata without an unsupported UUID aggregate.
create or replace function public.seller_edit_order(
  p_order_id uuid, p_items jsonb, p_removed_items jsonb default '[]'::jsonb,
  p_customer_id uuid default null, p_customer_email text default null,
  p_customer_first_name text default null, p_customer_last_name text default null,
  p_customer_phone text default null, p_business_name text default null,
  p_buyer_notes text default null, p_fulfillment_method text default 'pickup',
  p_pickup_option_id uuid default null, p_pickup_note text default null,
  p_delivery_option_id uuid default null, p_delivery_option_name_snapshot text default null,
  p_delivery_fee_amount numeric default 0, p_delivery_address_line1 text default null,
  p_delivery_address_line2 text default null, p_delivery_city text default null,
  p_delivery_state text default null, p_delivery_postal_code text default null,
  p_delivery_country text default null, p_tax_fee_amount numeric default null
)
returns table (
  order_id uuid, order_number text, store_id uuid,
  original_subtotal_amount numeric(10,2), original_total_amount numeric(10,2),
  revised_subtotal_amount numeric(10,2), revised_tax_fee_amount numeric(10,2),
  revised_delivery_fee_amount numeric(10,2), revised_total_amount numeric(10,2),
  inventory_changed boolean, updated_at timestamptz
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_changes jsonb;
  v_started_at timestamptz := clock_timestamp();
  v_listing record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or not (public.owns_store(v_order.store_id) or public.is_admin()) then raise exception 'Order is not available.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Order items must be an array.'; end if;

  create temporary table pg_temp.seller_edit_oversell_sources (
    item_type text not null, source_id uuid not null, prior_quantity integer not null default 0,
    requested_quantity integer not null default 0, prior_debit integer not null default 0,
    prior_order_item_id uuid,
    before_quantity integer, actual_delta integer, primary key(item_type, source_id)
  ) on commit drop;
  insert into pg_temp.seller_edit_oversell_sources(item_type,source_id,prior_quantity,prior_debit,prior_order_item_id)
  select case when coalesce(oi.order_item_source,'listing_inventory') in ('inventory','listing_inventory') then 'listing_inventory' else oi.order_item_source end,
    case when coalesce(oi.order_item_source,'listing_inventory') in ('inventory','listing_inventory') then oi.inventory_item_id when oi.order_item_source='equipment_inventory' then oi.equipment_inventory_item_id when oi.order_item_source='processed_poultry_inventory' then oi.processed_poultry_inventory_item_id when oi.order_item_source='hatching_egg_inventory' then oi.hatching_egg_inventory_item_id end,
    sum(oi.quantity)::integer,sum(oi.inventory_debited_quantity)::integer,(array_agg(oi.id order by oi.id))[1]
  from public.order_items oi where oi.order_id=v_order.id and oi.store_id=v_order.store_id and oi.order_item_source<>'custom'
  group by 1,2;
  insert into pg_temp.seller_edit_oversell_sources(item_type,source_id,requested_quantity)
  select item_type,source_id,sum(quantity)::integer from (
    select case when coalesce(nullif(item->>'item_type',''),'inventory') in ('inventory','listing_inventory') then 'listing_inventory' else nullif(item->>'item_type','') end item_type,
      case when coalesce(nullif(item->>'item_type',''),'inventory') in ('inventory','listing_inventory') then nullif(item->>'inventory_item_id','')::uuid when nullif(item->>'item_type','') in ('equipment_inventory','processed_poultry_inventory','hatching_egg_inventory') then nullif(item->>'item_id','')::uuid end source_id,
      (item->>'quantity')::integer quantity from jsonb_array_elements(p_items) item
  ) requested where item_type in ('listing_inventory','equipment_inventory','processed_poultry_inventory','hatching_egg_inventory') and source_id is not null group by 1,2
  on conflict(item_type,source_id) do update set requested_quantity=excluded.requested_quantity;

  update pg_temp.seller_edit_oversell_sources s set before_quantity=i.quantity_available from public.inventory_items i where s.item_type='listing_inventory' and i.id=s.source_id and i.store_id=v_order.store_id;
  perform 1 from public.inventory_items i join pg_temp.seller_edit_oversell_sources s on s.item_type='listing_inventory' and s.source_id=i.id where i.store_id=v_order.store_id order by i.id for update;
  update pg_temp.seller_edit_oversell_sources s set before_quantity=i.quantity_available from public.equipment_inventory_items i where s.item_type='equipment_inventory' and i.id=s.source_id and i.store_id=v_order.store_id;
  perform 1 from public.equipment_inventory_items i join pg_temp.seller_edit_oversell_sources s on s.item_type='equipment_inventory' and s.source_id=i.id where i.store_id=v_order.store_id order by i.id for update;
  update pg_temp.seller_edit_oversell_sources s set before_quantity=i.quantity_available from public.processed_poultry_inventory_items i where s.item_type='processed_poultry_inventory' and i.id=s.source_id and i.store_id=v_order.store_id;
  perform 1 from public.processed_poultry_inventory_items i join pg_temp.seller_edit_oversell_sources s on s.item_type='processed_poultry_inventory' and s.source_id=i.id where i.store_id=v_order.store_id order by i.id for update;
  update pg_temp.seller_edit_oversell_sources s set before_quantity=i.quantity_available from public.hatching_egg_inventory_items i where s.item_type='hatching_egg_inventory' and i.id=s.source_id and i.store_id=v_order.store_id;
  perform 1 from public.hatching_egg_inventory_items i join pg_temp.seller_edit_oversell_sources s on s.item_type='hatching_egg_inventory' and s.source_id=i.id where i.store_id=v_order.store_id order by i.id for update;

  update pg_temp.seller_edit_oversell_sources
  set actual_delta = case
    when requested_quantity >= prior_quantity
      then least(before_quantity, requested_quantity - prior_quantity)
    else least(prior_debit, requested_quantity) - prior_debit
  end;
  update public.inventory_items i set quantity_available=greatest(i.quantity_available,greatest(s.requested_quantity-s.prior_quantity,0)) from pg_temp.seller_edit_oversell_sources s where s.item_type='listing_inventory' and i.id=s.source_id and i.store_id=v_order.store_id;
  update public.equipment_inventory_items i set quantity_available=greatest(i.quantity_available,greatest(s.requested_quantity-s.prior_quantity,0)) from pg_temp.seller_edit_oversell_sources s where s.item_type='equipment_inventory' and i.id=s.source_id and i.store_id=v_order.store_id;
  update public.processed_poultry_inventory_items i set quantity_available=greatest(i.quantity_available,greatest(s.requested_quantity-s.prior_quantity,0)) from pg_temp.seller_edit_oversell_sources s where s.item_type='processed_poultry_inventory' and i.id=s.source_id and i.store_id=v_order.store_id;
  update public.hatching_egg_inventory_items i set quantity_available=greatest(i.quantity_available,greatest(s.requested_quantity-s.prior_quantity,0)) from pg_temp.seller_edit_oversell_sources s where s.item_type='hatching_egg_inventory' and i.id=s.source_id and i.store_id=v_order.store_id;

  update public.order_items set inventory_debited_quantity=quantity
  where order_id=v_order.id and store_id=v_order.store_id and order_item_source<>'custom';

  return query select * from public.seller_edit_order_strict_wrapper(p_order_id,p_items,p_removed_items,p_customer_id,p_customer_email,p_customer_first_name,p_customer_last_name,p_customer_phone,p_business_name,p_buyer_notes,p_fulfillment_method,p_pickup_option_id,p_pickup_note,p_delivery_option_id,p_delivery_option_name_snapshot,p_delivery_fee_amount,p_delivery_address_line1,p_delivery_address_line2,p_delivery_city,p_delivery_state,p_delivery_postal_code,p_delivery_country,p_tax_fee_amount);

  update public.inventory_items i set quantity_available=s.before_quantity-s.actual_delta from pg_temp.seller_edit_oversell_sources s where s.item_type='listing_inventory' and i.id=s.source_id and i.store_id=v_order.store_id;
  update public.equipment_inventory_items i set quantity_available=s.before_quantity-s.actual_delta from pg_temp.seller_edit_oversell_sources s where s.item_type='equipment_inventory' and i.id=s.source_id and i.store_id=v_order.store_id;
  update public.processed_poultry_inventory_items i set quantity_available=s.before_quantity-s.actual_delta from pg_temp.seller_edit_oversell_sources s where s.item_type='processed_poultry_inventory' and i.id=s.source_id and i.store_id=v_order.store_id;
  update public.hatching_egg_inventory_items i set quantity_available=s.before_quantity-s.actual_delta from pg_temp.seller_edit_oversell_sources s where s.item_type='hatching_egg_inventory' and i.id=s.source_id and i.store_id=v_order.store_id;
  update public.order_items oi set inventory_debited_quantity=least(oi.quantity,greatest(s.prior_debit+s.actual_delta,0)) from pg_temp.seller_edit_oversell_sources s where oi.order_id=v_order.id and oi.store_id=v_order.store_id and ((s.item_type='listing_inventory' and oi.inventory_item_id=s.source_id) or (s.item_type='equipment_inventory' and oi.equipment_inventory_item_id=s.source_id) or (s.item_type='processed_poultry_inventory' and oi.processed_poultry_inventory_item_id=s.source_id) or (s.item_type='hatching_egg_inventory' and oi.hatching_egg_inventory_item_id=s.source_id));
  update public.order_items set inventory_debited_quantity=0 where order_id=v_order.id and store_id=v_order.store_id and order_item_source='custom';
  delete from public.order_events where order_id=v_order.id and store_id=v_order.store_id and event_type='order_inventory_reconciled' and metadata->>'operation'='order_edited' and created_at>=v_started_at;
  delete from public.inventory_activity_events where store_id=v_order.store_id and event_type='inventory_quantity_adjusted' and note='Strict order inventory reconciliation' and metadata->>'operation'='order_edited' and created_at>=v_started_at;
  for v_listing in select s.*,i.listing_batch_id,i.listing_batch_breed_id from pg_temp.seller_edit_oversell_sources s join public.inventory_items i on s.item_type='listing_inventory' and i.id=s.source_id and i.store_id=v_order.store_id where s.actual_delta<>0 loop perform public.log_inventory_activity_event(v_order.store_id,v_listing.listing_batch_id,v_listing.listing_batch_breed_id,v_listing.source_id,'inventory_quantity_adjusted',v_listing.before_quantity,v_listing.before_quantity-v_listing.actual_delta,null,null,'Seller manual order inventory reconciliation',jsonb_build_object('operation','order_edited','requested_quantity_delta',v_listing.requested_quantity-v_listing.prior_quantity,'actual_quantity_delta',v_listing.actual_delta,'actor_user_id',auth.uid())); end loop;
  select coalesce(jsonb_agg(jsonb_build_object('order_item_id',coalesce(current_item.id,s.prior_order_item_id),'item_type',s.item_type,'source_id',s.source_id,'before_quantity',s.before_quantity,'inventory_delta',-s.actual_delta,'after_quantity',s.before_quantity-s.actual_delta,'prior_debited_quantity',s.prior_debit,'new_debited_quantity',greatest(s.prior_debit+s.actual_delta,0),'prior_restored_quantity',0,'new_restored_quantity',0) order by s.item_type,s.source_id),'[]'::jsonb) into v_changes from pg_temp.seller_edit_oversell_sources s left join lateral (select id from public.order_items oi where oi.order_id=v_order.id and oi.store_id=v_order.store_id and ((s.item_type='listing_inventory' and oi.inventory_item_id=s.source_id) or (s.item_type='equipment_inventory' and oi.equipment_inventory_item_id=s.source_id) or (s.item_type='processed_poultry_inventory' and oi.processed_poultry_inventory_item_id=s.source_id) or (s.item_type='hatching_egg_inventory' and oi.hatching_egg_inventory_item_id=s.source_id)) limit 1) current_item on true where s.actual_delta<>0;
  perform public.record_order_inventory_reconciliation(v_order.id,v_order.store_id,'order_edited',v_changes);
end;
$$;

commit;
