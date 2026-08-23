begin;

-- Seller-entered orders intentionally permit an order quantity that is greater
-- than tracked stock. Storefront creation remains on the existing strict paths.

alter function public.seller_create_manual_order(
  uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, numeric,
  numeric, boolean, boolean, uuid, text, uuid
)
rename to seller_create_manual_order_strict_wrapper;

revoke all on function public.seller_create_manual_order_strict_wrapper(
  uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, numeric,
  numeric, boolean, boolean, uuid, text, uuid
) from public, anon, authenticated, service_role;

create function public.seller_create_manual_order(
  p_store_id uuid,
  p_idempotency_key text,
  p_items jsonb,
  p_customer_id uuid default null,
  p_customer_email text default null,
  p_customer_first_name text default null,
  p_customer_last_name text default null,
  p_customer_phone text default null,
  p_business_name text default null,
  p_city text default null,
  p_state text default null,
  p_country text default null,
  p_delivery_address_line1 text default null,
  p_delivery_address_line2 text default null,
  p_delivery_city text default null,
  p_delivery_state text default null,
  p_delivery_postal_code text default null,
  p_delivery_country text default null,
  p_order_source text default 'manual',
  p_payment_status text default 'pay_at_pickup',
  p_buyer_notes text default null,
  p_pickup_note text default null,
  p_tax_fee_label text default null,
  p_tax_fee_rate numeric default null,
  p_tax_fee_amount numeric default 0,
  p_send_buyer_notification boolean default false,
  p_send_seller_notification boolean default false,
  p_pickup_option_id uuid default null,
  p_fulfillment_method text default 'pickup',
  p_delivery_option_id uuid default null
)
returns table (
  order_id uuid, order_number text, store_id uuid, customer_id uuid,
  order_status text, payment_method text, payment_status text, order_source text,
  subtotal_amount numeric(10, 2), tax_fee_amount numeric(10, 2),
  total_amount numeric(10, 2), created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_order_id uuid;
  v_order_id uuid;
  v_changes jsonb;
begin
  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Store is not available.';
  end if;

  select order_id into v_existing_order_id
  from public.order_idempotency_keys
  where store_id = p_store_id
    and idempotency_key = nullif(trim(p_idempotency_key), '');

  if v_existing_order_id is not null then
    return query
    select o.id, o.order_number, o.store_id, o.customer_id, o.order_status,
      o.payment_method, o.payment_status, o.order_source, o.subtotal_amount,
      o.tax_fee_amount, o.total_amount, o.created_at
    from public.orders as o
    where o.id = v_existing_order_id and o.store_id = p_store_id;
    return;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Order items must be an array.';
  end if;

  create temporary table pg_temp.seller_manual_oversell_sources (
    item_type text not null,
    source_id uuid not null,
    requested_quantity integer not null,
    before_quantity integer,
    actual_debit integer,
    primary key (item_type, source_id)
  ) on commit drop;

  insert into pg_temp.seller_manual_oversell_sources (item_type, source_id, requested_quantity)
  select item_type, source_id, sum(quantity)::integer
  from (
    select
      case
        when coalesce(nullif(item ->> 'item_type', ''), 'inventory') in ('inventory', 'listing_inventory') then 'listing_inventory'
        else nullif(item ->> 'item_type', '')
      end as item_type,
      case
        when coalesce(nullif(item ->> 'item_type', ''), 'inventory') in ('inventory', 'listing_inventory')
          then nullif(item ->> 'inventory_item_id', '')::uuid
        when nullif(item ->> 'item_type', '') in ('equipment_inventory', 'processed_poultry_inventory', 'hatching_egg_inventory')
          then nullif(item ->> 'item_id', '')::uuid
        else null
      end as source_id,
      (item ->> 'quantity')::integer as quantity
    from jsonb_array_elements(p_items) as item
  ) as requested
  where item_type in ('listing_inventory', 'equipment_inventory', 'processed_poultry_inventory', 'hatching_egg_inventory')
    and source_id is not null
  group by item_type, source_id;

  -- Capture and lock source quantities in the same canonical order used by the
  -- strict reconciler. The retained creation implementation then creates the
  -- requested order snapshots without ever persisting a negative inventory value.
  update pg_temp.seller_manual_oversell_sources as source
  set before_quantity = inventory.quantity_available
  from public.inventory_items as inventory
  where source.item_type = 'listing_inventory'
    and inventory.id = source.source_id and inventory.store_id = p_store_id;
  perform 1 from public.inventory_items as inventory
  join pg_temp.seller_manual_oversell_sources as source on source.item_type = 'listing_inventory' and source.source_id = inventory.id
  where inventory.store_id = p_store_id order by inventory.id for update;

  update pg_temp.seller_manual_oversell_sources as source
  set before_quantity = inventory.quantity_available
  from public.equipment_inventory_items as inventory
  where source.item_type = 'equipment_inventory'
    and inventory.id = source.source_id and inventory.store_id = p_store_id;
  perform 1 from public.equipment_inventory_items as inventory
  join pg_temp.seller_manual_oversell_sources as source on source.item_type = 'equipment_inventory' and source.source_id = inventory.id
  where inventory.store_id = p_store_id order by inventory.id for update;

  update pg_temp.seller_manual_oversell_sources as source
  set before_quantity = inventory.quantity_available
  from public.processed_poultry_inventory_items as inventory
  where source.item_type = 'processed_poultry_inventory'
    and inventory.id = source.source_id and inventory.store_id = p_store_id;
  perform 1 from public.processed_poultry_inventory_items as inventory
  join pg_temp.seller_manual_oversell_sources as source on source.item_type = 'processed_poultry_inventory' and source.source_id = inventory.id
  where inventory.store_id = p_store_id order by inventory.id for update;

  update pg_temp.seller_manual_oversell_sources as source
  set before_quantity = inventory.quantity_available
  from public.hatching_egg_inventory_items as inventory
  where source.item_type = 'hatching_egg_inventory'
    and inventory.id = source.source_id and inventory.store_id = p_store_id;
  perform 1 from public.hatching_egg_inventory_items as inventory
  join pg_temp.seller_manual_oversell_sources as source on source.item_type = 'hatching_egg_inventory' and source.source_id = inventory.id
  where inventory.store_id = p_store_id order by inventory.id for update;

  update pg_temp.seller_manual_oversell_sources
  set actual_debit = least(before_quantity, requested_quantity);

  -- The retained internal creator owns all snapshot, customer, eligibility,
  -- idempotency, and transactional order construction. These temporary values
  -- are private to this transaction and are reset to the actual seller debit below.
  update public.inventory_items as inventory set quantity_available = greatest(inventory.quantity_available, source.requested_quantity)
  from pg_temp.seller_manual_oversell_sources as source
  where source.item_type = 'listing_inventory' and inventory.id = source.source_id and inventory.store_id = p_store_id;
  update public.equipment_inventory_items as inventory set quantity_available = greatest(inventory.quantity_available, source.requested_quantity)
  from pg_temp.seller_manual_oversell_sources as source
  where source.item_type = 'equipment_inventory' and inventory.id = source.source_id and inventory.store_id = p_store_id;
  update public.processed_poultry_inventory_items as inventory set quantity_available = greatest(inventory.quantity_available, source.requested_quantity)
  from pg_temp.seller_manual_oversell_sources as source
  where source.item_type = 'processed_poultry_inventory' and inventory.id = source.source_id and inventory.store_id = p_store_id;
  update public.hatching_egg_inventory_items as inventory set quantity_available = greatest(inventory.quantity_available, source.requested_quantity)
  from pg_temp.seller_manual_oversell_sources as source
  where source.item_type = 'hatching_egg_inventory' and inventory.id = source.source_id and inventory.store_id = p_store_id;

  return query select * from public.seller_create_manual_order_batch_d_internal(
    p_store_id, p_idempotency_key, p_items, p_customer_id, p_customer_email,
    p_customer_first_name, p_customer_last_name, p_customer_phone, p_business_name,
    p_city, p_state, p_country, p_delivery_address_line1, p_delivery_address_line2,
    p_delivery_city, p_delivery_state, p_delivery_postal_code, p_delivery_country,
    p_order_source, p_payment_status, p_buyer_notes, p_pickup_note, p_tax_fee_label,
    p_tax_fee_rate, p_tax_fee_amount, p_send_buyer_notification,
    p_send_seller_notification, p_pickup_option_id, p_fulfillment_method,
    p_delivery_option_id
  );

  select order_id into v_order_id from public.order_idempotency_keys
  where store_id = p_store_id and idempotency_key = nullif(trim(p_idempotency_key), '');

  update public.inventory_items as inventory set quantity_available = source.before_quantity - source.actual_debit
  from pg_temp.seller_manual_oversell_sources as source
  where source.item_type = 'listing_inventory' and inventory.id = source.source_id and inventory.store_id = p_store_id;
  update public.equipment_inventory_items as inventory set quantity_available = source.before_quantity - source.actual_debit
  from pg_temp.seller_manual_oversell_sources as source
  where source.item_type = 'equipment_inventory' and inventory.id = source.source_id and inventory.store_id = p_store_id;
  update public.processed_poultry_inventory_items as inventory set quantity_available = source.before_quantity - source.actual_debit
  from pg_temp.seller_manual_oversell_sources as source
  where source.item_type = 'processed_poultry_inventory' and inventory.id = source.source_id and inventory.store_id = p_store_id;
  update public.hatching_egg_inventory_items as inventory set quantity_available = source.before_quantity - source.actual_debit
  from pg_temp.seller_manual_oversell_sources as source
  where source.item_type = 'hatching_egg_inventory' and inventory.id = source.source_id and inventory.store_id = p_store_id;

  update public.order_items as item
  set inventory_debited_quantity = coalesce(source.actual_debit, 0)
  from pg_temp.seller_manual_oversell_sources as source
  where item.order_id = v_order_id and item.store_id = p_store_id
    and ((source.item_type = 'listing_inventory' and item.inventory_item_id = source.source_id)
      or (source.item_type = 'equipment_inventory' and item.equipment_inventory_item_id = source.source_id)
      or (source.item_type = 'processed_poultry_inventory' and item.processed_poultry_inventory_item_id = source.source_id)
      or (source.item_type = 'hatching_egg_inventory' and item.hatching_egg_inventory_item_id = source.source_id));
  update public.order_items set inventory_debited_quantity = 0
  where order_id = v_order_id and store_id = p_store_id and order_item_source = 'custom';

  update public.inventory_activity_events as event
  set from_quantity_available = source.before_quantity,
      to_quantity_available = source.before_quantity - source.actual_debit,
      metadata = coalesce(event.metadata, '{}'::jsonb) || jsonb_build_object(
        'deducted_quantity', source.actual_debit,
        'override_quantity', source.requested_quantity - source.actual_debit,
        'override_applied', source.requested_quantity > source.actual_debit
      )
  from pg_temp.seller_manual_oversell_sources as source
  where source.item_type = 'listing_inventory'
    and event.store_id = p_store_id and event.inventory_item_id = source.source_id
    and event.metadata ->> 'order_id' = v_order_id::text
    and event.note = 'Manual order inventory deduction';

  v_changes := public.describe_new_order_inventory_debits(v_order_id, p_store_id);
  perform public.record_order_inventory_reconciliation(v_order_id, p_store_id, 'manual_order_created', v_changes);
end;
$$;

revoke all on function public.seller_create_manual_order(
  uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, numeric,
  numeric, boolean, boolean, uuid, text, uuid
) from public, anon, service_role;
grant execute on function public.seller_create_manual_order(
  uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, numeric,
  numeric, boolean, boolean, uuid, text, uuid
) to authenticated;

alter function public.seller_edit_order(
  uuid, jsonb, jsonb, uuid, text, text, text, text, text, text, text, uuid,
  text, uuid, text, numeric, text, text, text, text, text, text, numeric
)
rename to seller_edit_order_strict_wrapper;

revoke all on function public.seller_edit_order_strict_wrapper(
  uuid, jsonb, jsonb, uuid, text, text, text, text, text, text, text, uuid,
  text, uuid, text, numeric, text, text, text, text, text, text, numeric
) from public, anon, authenticated, service_role;

create function public.seller_edit_order(
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
    sum(oi.quantity)::integer,sum(oi.inventory_debited_quantity)::integer,min(oi.id)
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

  -- The retained strict persistence wrapper expects its temporary debit to be
  -- at least the old ordered quantity. The real ledger is restored below from
  -- the bounded seller delta; this temporary value never commits on its own.
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

revoke all on function public.seller_edit_order(uuid,jsonb,jsonb,uuid,text,text,text,text,text,text,text,uuid,text,uuid,text,numeric,text,text,text,text,text,text,numeric) from public, anon, service_role;
grant execute on function public.seller_edit_order(uuid,jsonb,jsonb,uuid,text,text,text,text,text,text,text,uuid,text,uuid,text,numeric,text,text,text,text,text,text,numeric) to authenticated;

-- Ledger-aware seller edits use the exact reconciler, but only debit stock that
-- exists. This branch is reachable only from seller_edit_order.
create or replace function public.reconcile_order_inventory(
  p_store_id uuid, p_operation text, p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source record; v_before_quantity integer; v_after_quantity integer;
  v_visibility_status text; v_moderation_status text; v_archived_at timestamptz;
  v_listing_batch_id uuid; v_listing_batch_breed_id uuid; v_result jsonb;
  v_effective_delta integer; v_available_debit integer;
begin
  if p_store_id is null or nullif(trim(p_operation), '') is null or p_changes is null or jsonb_typeof(p_changes) <> 'array' then raise exception 'Invalid inventory reconciliation request.'; end if;
  drop table if exists pg_temp.batch_d_inventory_line_changes;
  drop table if exists pg_temp.batch_d_inventory_source_changes;
  create temporary table pg_temp.batch_d_inventory_line_changes (
    order_item_id uuid, item_type text not null, source_id uuid not null,
    quantity_delta integer not null, prior_debited_quantity integer,
    new_debited_quantity integer, prior_restored_quantity integer,
    new_restored_quantity integer, source_before_quantity integer, source_after_quantity integer
  ) on commit drop;
  insert into pg_temp.batch_d_inventory_line_changes(order_item_id,item_type,source_id,quantity_delta,prior_debited_quantity,new_debited_quantity,prior_restored_quantity,new_restored_quantity)
  select change.order_item_id,change.item_type,change.source_id,change.quantity_delta,change.prior_debited_quantity,change.new_debited_quantity,change.prior_restored_quantity,change.new_restored_quantity
  from jsonb_to_recordset(p_changes) as change(order_item_id uuid,item_type text,source_id uuid,quantity_delta integer,prior_debited_quantity integer,new_debited_quantity integer,prior_restored_quantity integer,new_restored_quantity integer)
  where change.quantity_delta <> 0;
  if exists(select 1 from pg_temp.batch_d_inventory_line_changes where item_type not in ('listing_inventory','equipment_inventory','processed_poultry_inventory','hatching_egg_inventory') or source_id is null) then raise exception 'Invalid inventory reconciliation source.'; end if;
  create temporary table pg_temp.batch_d_inventory_source_changes(item_type text not null,source_id uuid not null,quantity_delta integer not null,source_before_quantity integer,source_after_quantity integer,primary key(item_type,source_id)) on commit drop;
  insert into pg_temp.batch_d_inventory_source_changes(item_type,source_id,quantity_delta)
  select item_type,source_id,sum(quantity_delta)::integer from pg_temp.batch_d_inventory_line_changes group by item_type,source_id having sum(quantity_delta) <> 0;
  for v_source in select * from pg_temp.batch_d_inventory_source_changes order by case item_type when 'listing_inventory' then 1 when 'equipment_inventory' then 2 when 'processed_poultry_inventory' then 3 when 'hatching_egg_inventory' then 4 else 5 end, source_id loop
    v_before_quantity:=null; v_visibility_status:=null; v_moderation_status:=null; v_archived_at:=null; v_listing_batch_id:=null; v_listing_batch_breed_id:=null;
    if v_source.item_type='listing_inventory' then select ii.quantity_available,ii.visibility_status,ii.moderation_status,ii.archived_at,ii.listing_batch_id,ii.listing_batch_breed_id into v_before_quantity,v_visibility_status,v_moderation_status,v_archived_at,v_listing_batch_id,v_listing_batch_breed_id from public.inventory_items ii where ii.id=v_source.source_id and ii.store_id=p_store_id for update;
    elsif v_source.item_type='equipment_inventory' then select ei.quantity_available,ei.visibility_status,ei.moderation_status,ei.archived_at into v_before_quantity,v_visibility_status,v_moderation_status,v_archived_at from public.equipment_inventory_items ei where ei.id=v_source.source_id and ei.store_id=p_store_id for update;
    elsif v_source.item_type='processed_poultry_inventory' then select ppi.quantity_available,ppi.visibility_status,ppi.moderation_status,ppi.archived_at into v_before_quantity,v_visibility_status,v_moderation_status,v_archived_at from public.processed_poultry_inventory_items ppi where ppi.id=v_source.source_id and ppi.store_id=p_store_id for update;
    else select hei.quantity_available,hei.visibility_status,hei.moderation_status,hei.archived_at into v_before_quantity,v_visibility_status,v_moderation_status,v_archived_at from public.hatching_egg_inventory_items hei where hei.id=v_source.source_id and hei.store_id=p_store_id for update; end if;
    if not found then raise exception 'One or more inventory items are not available for this store.'; end if;
    if v_source.quantity_delta > 0 and (v_visibility_status='archived' or v_archived_at is not null or v_moderation_status is distinct from 'normal') then raise exception 'Archived or moderated inventory cannot be consumed.'; end if;
    if p_operation='order_edited' then
      if v_source.quantity_delta > 0 then v_effective_delta:=least(v_before_quantity,v_source.quantity_delta);
      else select coalesce(sum(prior_debited_quantity),0) into v_available_debit from pg_temp.batch_d_inventory_line_changes where item_type=v_source.item_type and source_id=v_source.source_id; v_effective_delta:=-least(abs(v_source.quantity_delta),v_available_debit); end if;
      update pg_temp.batch_d_inventory_line_changes set quantity_delta=v_effective_delta,new_debited_quantity=coalesce(prior_debited_quantity,0)+v_effective_delta where item_type=v_source.item_type and source_id=v_source.source_id;
    else
      v_effective_delta:=v_source.quantity_delta;
      if v_before_quantity < v_effective_delta then raise exception 'Insufficient inventory quantity available.'; end if;
    end if;
    v_after_quantity:=v_before_quantity-v_effective_delta;
    if v_after_quantity<0 then raise exception 'Insufficient inventory quantity available.'; end if;
    if v_source.item_type='listing_inventory' then update public.inventory_items set quantity_available=v_after_quantity where id=v_source.source_id and store_id=p_store_id; perform public.log_inventory_activity_event(p_store_id,v_listing_batch_id,v_listing_batch_breed_id,v_source.source_id,'inventory_quantity_adjusted',v_before_quantity,v_after_quantity,null,null,'Strict order inventory reconciliation',jsonb_build_object('operation',p_operation,'quantity_delta',v_effective_delta,'actor_user_id',auth.uid()));
    elsif v_source.item_type='equipment_inventory' then update public.equipment_inventory_items set quantity_available=v_after_quantity where id=v_source.source_id and store_id=p_store_id;
    elsif v_source.item_type='processed_poultry_inventory' then update public.processed_poultry_inventory_items set quantity_available=v_after_quantity where id=v_source.source_id and store_id=p_store_id;
    else update public.hatching_egg_inventory_items set quantity_available=v_after_quantity where id=v_source.source_id and store_id=p_store_id; end if;
    update pg_temp.batch_d_inventory_line_changes set source_before_quantity=v_before_quantity,source_after_quantity=v_after_quantity where item_type=v_source.item_type and source_id=v_source.source_id;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('order_item_id',order_item_id,'item_type',item_type,'source_id',source_id,'before_quantity',source_before_quantity,'inventory_delta',-quantity_delta,'after_quantity',source_after_quantity,'prior_debited_quantity',prior_debited_quantity,'new_debited_quantity',new_debited_quantity,'prior_restored_quantity',prior_restored_quantity,'new_restored_quantity',new_restored_quantity) order by item_type,source_id,order_item_id),'[]'::jsonb) into v_result from pg_temp.batch_d_inventory_line_changes;
  return v_result;
end;
$$;

create or replace function public.describe_new_order_inventory_debits(p_order_id uuid, p_store_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_item_id',oi.id,'item_type',oi.order_item_source,
    'source_id',case when coalesce(oi.order_item_source,'listing_inventory') in ('inventory','listing_inventory') then oi.inventory_item_id when oi.order_item_source='equipment_inventory' then oi.equipment_inventory_item_id when oi.order_item_source='processed_poultry_inventory' then oi.processed_poultry_inventory_item_id when oi.order_item_source='hatching_egg_inventory' then oi.hatching_egg_inventory_item_id else null end,
    'before_quantity',case when coalesce(oi.order_item_source,'listing_inventory') in ('inventory','listing_inventory') then ii.quantity_available+coalesce(oi.inventory_debited_quantity,0) when oi.order_item_source='equipment_inventory' then ei.quantity_available+coalesce(oi.inventory_debited_quantity,0) when oi.order_item_source='processed_poultry_inventory' then ppi.quantity_available+coalesce(oi.inventory_debited_quantity,0) when oi.order_item_source='hatching_egg_inventory' then hei.quantity_available+coalesce(oi.inventory_debited_quantity,0) else null end,
    'inventory_delta',case when oi.order_item_source='custom' then 0 else -coalesce(oi.inventory_debited_quantity,0) end,
    'after_quantity',case when coalesce(oi.order_item_source,'listing_inventory') in ('inventory','listing_inventory') then ii.quantity_available when oi.order_item_source='equipment_inventory' then ei.quantity_available when oi.order_item_source='processed_poultry_inventory' then ppi.quantity_available when oi.order_item_source='hatching_egg_inventory' then hei.quantity_available else null end,
    'prior_debited_quantity',0,'new_debited_quantity',oi.inventory_debited_quantity,'prior_restored_quantity',0,'new_restored_quantity',oi.restored_quantity) order by oi.id),'[]'::jsonb)
  from public.order_items oi left join public.inventory_items ii on ii.id=oi.inventory_item_id and ii.store_id=oi.store_id left join public.equipment_inventory_items ei on ei.id=oi.equipment_inventory_item_id and ei.store_id=oi.store_id left join public.processed_poultry_inventory_items ppi on ppi.id=oi.processed_poultry_inventory_item_id and ppi.store_id=oi.store_id left join public.hatching_egg_inventory_items hei on hei.id=oi.hatching_egg_inventory_item_id and hei.store_id=oi.store_id
  where oi.order_id=p_order_id and oi.store_id=p_store_id;
$$;

commit;
