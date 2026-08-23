begin;

comment on column public.order_items.inventory_debited_quantity is
'Compatibility inventory ledger. Strict order flows record the quantity physically debited. Seller/manual inventory-backed lines record ordered quantity so shared restoration constraints and cancellation logic remain compatible; custom lines record zero.';

-- Seller edits intentionally use ordered-quantity deltas. Positive deltas are
-- clamped to available stock; negative deltas restore the full ordered decrease.
-- Other operations retain the strict reconciliation behavior.
create or replace function public.reconcile_order_inventory(
  p_store_id uuid,
  p_operation text,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source record;
  v_before_quantity integer;
  v_after_quantity integer;
  v_visibility_status text;
  v_moderation_status text;
  v_archived_at timestamptz;
  v_listing_batch_id uuid;
  v_listing_batch_breed_id uuid;
  v_result jsonb;
  v_effective_delta integer;
begin
  if p_store_id is null
     or nullif(trim(p_operation), '') is null
     or p_changes is null
     or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'Invalid inventory reconciliation request.';
  end if;

  drop table if exists pg_temp.batch_d_inventory_line_changes;
  drop table if exists pg_temp.batch_d_inventory_source_changes;

  create temporary table pg_temp.batch_d_inventory_line_changes (
    order_item_id uuid,
    item_type text not null,
    source_id uuid not null,
    quantity_delta integer not null,
    prior_debited_quantity integer,
    new_debited_quantity integer,
    prior_restored_quantity integer,
    new_restored_quantity integer,
    source_before_quantity integer,
    source_after_quantity integer
  ) on commit drop;

  insert into pg_temp.batch_d_inventory_line_changes (
    order_item_id,
    item_type,
    source_id,
    quantity_delta,
    prior_debited_quantity,
    new_debited_quantity,
    prior_restored_quantity,
    new_restored_quantity
  )
  select
    change.order_item_id,
    change.item_type,
    change.source_id,
    change.quantity_delta,
    change.prior_debited_quantity,
    change.new_debited_quantity,
    change.prior_restored_quantity,
    change.new_restored_quantity
  from jsonb_to_recordset(p_changes) as change(
    order_item_id uuid,
    item_type text,
    source_id uuid,
    quantity_delta integer,
    prior_debited_quantity integer,
    new_debited_quantity integer,
    prior_restored_quantity integer,
    new_restored_quantity integer
  )
  where change.quantity_delta <> 0;

  if exists (
    select 1
    from pg_temp.batch_d_inventory_line_changes as line_change
    where line_change.item_type not in (
      'listing_inventory',
      'equipment_inventory',
      'processed_poultry_inventory',
      'hatching_egg_inventory'
    )
       or line_change.source_id is null
  ) then
    raise exception 'Invalid inventory reconciliation source.';
  end if;

  create temporary table pg_temp.batch_d_inventory_source_changes (
    item_type text not null,
    source_id uuid not null,
    quantity_delta integer not null,
    source_before_quantity integer,
    source_after_quantity integer,
    primary key (item_type, source_id)
  ) on commit drop;

  insert into pg_temp.batch_d_inventory_source_changes (
    item_type,
    source_id,
    quantity_delta
  )
  select
    line_change.item_type,
    line_change.source_id,
    sum(line_change.quantity_delta)::integer
  from pg_temp.batch_d_inventory_line_changes as line_change
  group by line_change.item_type, line_change.source_id
  having sum(line_change.quantity_delta) <> 0;

  for v_source in
    select source_change.*
    from pg_temp.batch_d_inventory_source_changes as source_change
    order by
      case source_change.item_type
        when 'listing_inventory' then 1
        when 'equipment_inventory' then 2
        when 'processed_poultry_inventory' then 3
        when 'hatching_egg_inventory' then 4
        else 5
      end,
      source_change.source_id
  loop
    v_before_quantity := null;
    v_visibility_status := null;
    v_moderation_status := null;
    v_archived_at := null;
    v_listing_batch_id := null;
    v_listing_batch_breed_id := null;

    if v_source.item_type = 'listing_inventory' then
      select
        ii.quantity_available,
        ii.visibility_status,
        ii.moderation_status,
        ii.archived_at,
        ii.listing_batch_id,
        ii.listing_batch_breed_id
      into
        v_before_quantity,
        v_visibility_status,
        v_moderation_status,
        v_archived_at,
        v_listing_batch_id,
        v_listing_batch_breed_id
      from public.inventory_items as ii
      where ii.id = v_source.source_id
        and ii.store_id = p_store_id
      for update;
    elsif v_source.item_type = 'equipment_inventory' then
      select ei.quantity_available, ei.visibility_status, ei.moderation_status, ei.archived_at
      into v_before_quantity, v_visibility_status, v_moderation_status, v_archived_at
      from public.equipment_inventory_items as ei
      where ei.id = v_source.source_id
        and ei.store_id = p_store_id
      for update;
    elsif v_source.item_type = 'processed_poultry_inventory' then
      select ppi.quantity_available, ppi.visibility_status, ppi.moderation_status, ppi.archived_at
      into v_before_quantity, v_visibility_status, v_moderation_status, v_archived_at
      from public.processed_poultry_inventory_items as ppi
      where ppi.id = v_source.source_id
        and ppi.store_id = p_store_id
      for update;
    else
      select hei.quantity_available, hei.visibility_status, hei.moderation_status, hei.archived_at
      into v_before_quantity, v_visibility_status, v_moderation_status, v_archived_at
      from public.hatching_egg_inventory_items as hei
      where hei.id = v_source.source_id
        and hei.store_id = p_store_id
      for update;
    end if;

    if not found then
      raise exception 'One or more inventory items are not available for this store.';
    end if;

    if v_source.quantity_delta > 0
       and (
         v_visibility_status = 'archived'
         or v_archived_at is not null
         or v_moderation_status is distinct from 'normal'
       ) then
      raise exception 'Archived or moderated inventory cannot be consumed.';
    end if;

    if p_operation = 'order_edited' then
      if v_source.quantity_delta > 0 then
        v_effective_delta := least(v_before_quantity, v_source.quantity_delta);
      else
        v_effective_delta := v_source.quantity_delta;
      end if;
    else
      v_effective_delta := v_source.quantity_delta;
      if v_before_quantity < v_effective_delta then
        raise exception 'Insufficient inventory quantity available.';
      end if;
    end if;

    v_after_quantity := v_before_quantity - v_effective_delta;
    if v_after_quantity < 0 then
      raise exception 'Insufficient inventory quantity available.';
    end if;

    if v_source.item_type = 'listing_inventory' then
      update public.inventory_items as ii
      set quantity_available = v_after_quantity
      where ii.id = v_source.source_id
        and ii.store_id = p_store_id;

      perform public.log_inventory_activity_event(
        p_store_id,
        v_listing_batch_id,
        v_listing_batch_breed_id,
        v_source.source_id,
        'inventory_quantity_adjusted',
        v_before_quantity,
        v_after_quantity,
        null,
        null,
        'Seller order inventory reconciliation',
        jsonb_build_object(
          'operation', p_operation,
          'requested_quantity_delta', v_source.quantity_delta,
          'physical_quantity_delta', v_effective_delta,
          'seller_override_quantity', greatest(v_source.quantity_delta - v_effective_delta, 0),
          'actor_user_id', auth.uid()
        )
      );
    elsif v_source.item_type = 'equipment_inventory' then
      update public.equipment_inventory_items as ei
      set quantity_available = v_after_quantity
      where ei.id = v_source.source_id
        and ei.store_id = p_store_id;
    elsif v_source.item_type = 'processed_poultry_inventory' then
      update public.processed_poultry_inventory_items as ppi
      set quantity_available = v_after_quantity
      where ppi.id = v_source.source_id
        and ppi.store_id = p_store_id;
    else
      update public.hatching_egg_inventory_items as hei
      set quantity_available = v_after_quantity
      where hei.id = v_source.source_id
        and hei.store_id = p_store_id;
    end if;

    update pg_temp.batch_d_inventory_line_changes as line_change
    set
      source_before_quantity = v_before_quantity,
      source_after_quantity = v_after_quantity,
      quantity_delta = case
        when v_source.quantity_delta = 0 then 0
        else trunc(
          line_change.quantity_delta::numeric
          * v_effective_delta::numeric
          / v_source.quantity_delta::numeric
        )::integer
      end
    where line_change.item_type = v_source.item_type
      and line_change.source_id = v_source.source_id;
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'order_item_id', line_change.order_item_id,
        'item_type', line_change.item_type,
        'source_id', line_change.source_id,
        'before_quantity', line_change.source_before_quantity,
        'inventory_delta', -line_change.quantity_delta,
        'after_quantity', line_change.source_after_quantity,
        'prior_debited_quantity', line_change.prior_debited_quantity,
        'new_debited_quantity', line_change.new_debited_quantity,
        'prior_restored_quantity', line_change.prior_restored_quantity,
        'new_restored_quantity', line_change.new_restored_quantity
      )
      order by line_change.item_type, line_change.source_id, line_change.order_item_id
    ),
    '[]'::jsonb
  )
  into v_result
  from pg_temp.batch_d_inventory_line_changes as line_change;

  return v_result;
end;
$$;

create or replace function public.seller_create_manual_order(
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
  order_id uuid,
  order_number text,
  store_id uuid,
  customer_id uuid,
  order_status text,
  payment_method text,
  payment_status text,
  order_source text,
  subtotal_amount numeric(10, 2),
  tax_fee_amount numeric(10, 2),
  total_amount numeric(10, 2),
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_order_id uuid;
  v_created_order_id uuid;
  v_sanitized_items jsonb;
  v_changes jsonb;
begin
  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Store is not available.';
  end if;

  -- Serialize retries for the same seller request before touching inventory.
  -- The retained creator still owns the durable idempotency record.
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_store_id::text || ':' || coalesce(nullif(trim(p_idempotency_key), ''), ''),
      0
    )
  );

  select oik.order_id
  into v_existing_order_id
  from public.order_idempotency_keys as oik
  where oik.store_id = p_store_id
    and oik.idempotency_key = nullif(trim(p_idempotency_key), '');

  if v_existing_order_id is not null then
    return query
    select
      o.id,
      o.order_number,
      o.store_id,
      o.customer_id,
      o.order_status,
      o.payment_method,
      o.payment_status,
      o.order_source,
      o.subtotal_amount,
      o.tax_fee_amount,
      o.total_amount,
      o.created_at
    from public.orders as o
    where o.id = v_existing_order_id
      and o.store_id = p_store_id;
    return;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Order items must be an array.';
  end if;

  select coalesce(
    jsonb_agg(
      case
        when coalesce(nullif(item_with_ordinality.item ->> 'item_type', ''), 'inventory') = 'listing_inventory'
          then (item_with_ordinality.item - 'allow_inventory_override')
            || jsonb_build_object('item_type', 'inventory')
        else item_with_ordinality.item - 'allow_inventory_override'
      end
      order by item_with_ordinality.line_number
    ),
    '[]'::jsonb
  )
  into v_sanitized_items
  from jsonb_array_elements(p_items)
    with ordinality as item_with_ordinality(item, line_number);

  drop table if exists pg_temp.seller_manual_quantity_sources;
  create temporary table pg_temp.seller_manual_quantity_sources (
    item_type text not null,
    source_id uuid not null,
    requested_quantity integer not null,
    before_quantity integer,
    primary key (item_type, source_id)
  ) on commit drop;

  insert into pg_temp.seller_manual_quantity_sources (
    item_type,
    source_id,
    requested_quantity
  )
  select
    requested.item_type,
    requested.source_id,
    sum(requested.quantity)::integer
  from (
    select
      case
        when coalesce(nullif(item ->> 'item_type', ''), 'inventory') = 'inventory'
          then 'listing_inventory'
        else nullif(item ->> 'item_type', '')
      end as item_type,
      case
        when coalesce(nullif(item ->> 'item_type', ''), 'inventory') = 'inventory'
          then nullif(item ->> 'inventory_item_id', '')::uuid
        when nullif(item ->> 'item_type', '') in (
          'equipment_inventory',
          'processed_poultry_inventory',
          'hatching_egg_inventory'
        ) then nullif(item ->> 'item_id', '')::uuid
        else null
      end as source_id,
      (item ->> 'quantity')::integer as quantity
    from jsonb_array_elements(v_sanitized_items) as item
  ) as requested
  where requested.item_type in (
      'listing_inventory',
      'equipment_inventory',
      'processed_poultry_inventory',
      'hatching_egg_inventory'
    )
    and requested.source_id is not null
  group by requested.item_type, requested.source_id;

  -- Lock before reading quantities. Every category uses the same deterministic
  -- category/UUID order as seller edits and strict reconciliation.
  perform 1
  from public.inventory_items as ii
  join pg_temp.seller_manual_quantity_sources as source
    on source.item_type = 'listing_inventory'
   and source.source_id = ii.id
  where ii.store_id = p_store_id
  order by ii.id
  for update of ii;

  perform 1
  from public.equipment_inventory_items as ei
  join pg_temp.seller_manual_quantity_sources as source
    on source.item_type = 'equipment_inventory'
   and source.source_id = ei.id
  where ei.store_id = p_store_id
  order by ei.id
  for update of ei;

  perform 1
  from public.processed_poultry_inventory_items as ppi
  join pg_temp.seller_manual_quantity_sources as source
    on source.item_type = 'processed_poultry_inventory'
   and source.source_id = ppi.id
  where ppi.store_id = p_store_id
  order by ppi.id
  for update of ppi;

  perform 1
  from public.hatching_egg_inventory_items as hei
  join pg_temp.seller_manual_quantity_sources as source
    on source.item_type = 'hatching_egg_inventory'
   and source.source_id = hei.id
  where hei.store_id = p_store_id
  order by hei.id
  for update of hei;

  update pg_temp.seller_manual_quantity_sources as source
  set before_quantity = ii.quantity_available
  from public.inventory_items as ii
  where source.item_type = 'listing_inventory'
    and ii.id = source.source_id
    and ii.store_id = p_store_id;

  update pg_temp.seller_manual_quantity_sources as source
  set before_quantity = ei.quantity_available
  from public.equipment_inventory_items as ei
  where source.item_type = 'equipment_inventory'
    and ei.id = source.source_id
    and ei.store_id = p_store_id;

  update pg_temp.seller_manual_quantity_sources as source
  set before_quantity = ppi.quantity_available
  from public.processed_poultry_inventory_items as ppi
  where source.item_type = 'processed_poultry_inventory'
    and ppi.id = source.source_id
    and ppi.store_id = p_store_id;

  update pg_temp.seller_manual_quantity_sources as source
  set before_quantity = hei.quantity_available
  from public.hatching_egg_inventory_items as hei
  where source.item_type = 'hatching_egg_inventory'
    and hei.id = source.source_id
    and hei.store_id = p_store_id;

  if exists (
    select 1
    from pg_temp.seller_manual_quantity_sources as source
    where source.before_quantity is null
  ) then
    raise exception 'One or more inventory items are not available for this store.';
  end if;

  -- The established creator owns source eligibility, snapshots, customers,
  -- order totals, and idempotency. Temporary inflation only lets that strict
  -- implementation persist the seller's requested quantity. The real stock
  -- value is written from the locked pre-order quantity immediately afterward.
  update public.inventory_items as ii
  set quantity_available = greatest(ii.quantity_available, source.requested_quantity)
  from pg_temp.seller_manual_quantity_sources as source
  where source.item_type = 'listing_inventory'
    and ii.id = source.source_id
    and ii.store_id = p_store_id;

  update public.equipment_inventory_items as ei
  set quantity_available = greatest(ei.quantity_available, source.requested_quantity)
  from pg_temp.seller_manual_quantity_sources as source
  where source.item_type = 'equipment_inventory'
    and ei.id = source.source_id
    and ei.store_id = p_store_id;

  update public.processed_poultry_inventory_items as ppi
  set quantity_available = greatest(ppi.quantity_available, source.requested_quantity)
  from pg_temp.seller_manual_quantity_sources as source
  where source.item_type = 'processed_poultry_inventory'
    and ppi.id = source.source_id
    and ppi.store_id = p_store_id;

  update public.hatching_egg_inventory_items as hei
  set quantity_available = greatest(hei.quantity_available, source.requested_quantity)
  from pg_temp.seller_manual_quantity_sources as source
  where source.item_type = 'hatching_egg_inventory'
    and hei.id = source.source_id
    and hei.store_id = p_store_id;

  return query
  select *
  from public.seller_create_manual_order_batch_d_internal(
    p_store_id,
    p_idempotency_key,
    v_sanitized_items,
    p_customer_id,
    p_customer_email,
    p_customer_first_name,
    p_customer_last_name,
    p_customer_phone,
    p_business_name,
    p_city,
    p_state,
    p_country,
    p_delivery_address_line1,
    p_delivery_address_line2,
    p_delivery_city,
    p_delivery_state,
    p_delivery_postal_code,
    p_delivery_country,
    p_order_source,
    p_payment_status,
    p_buyer_notes,
    p_pickup_note,
    p_tax_fee_label,
    p_tax_fee_rate,
    p_tax_fee_amount,
    p_send_buyer_notification,
    p_send_seller_notification,
    p_pickup_option_id,
    p_fulfillment_method,
    p_delivery_option_id
  );

  select oik.order_id
  into v_created_order_id
  from public.order_idempotency_keys as oik
  where oik.store_id = p_store_id
    and oik.idempotency_key = nullif(trim(p_idempotency_key), '');

  update public.inventory_items as ii
  set quantity_available = greatest(source.before_quantity - source.requested_quantity, 0)
  from pg_temp.seller_manual_quantity_sources as source
  where source.item_type = 'listing_inventory'
    and ii.id = source.source_id
    and ii.store_id = p_store_id;

  update public.equipment_inventory_items as ei
  set quantity_available = greatest(source.before_quantity - source.requested_quantity, 0)
  from pg_temp.seller_manual_quantity_sources as source
  where source.item_type = 'equipment_inventory'
    and ei.id = source.source_id
    and ei.store_id = p_store_id;

  update public.processed_poultry_inventory_items as ppi
  set quantity_available = greatest(source.before_quantity - source.requested_quantity, 0)
  from pg_temp.seller_manual_quantity_sources as source
  where source.item_type = 'processed_poultry_inventory'
    and ppi.id = source.source_id
    and ppi.store_id = p_store_id;

  update public.hatching_egg_inventory_items as hei
  set quantity_available = greatest(source.before_quantity - source.requested_quantity, 0)
  from pg_temp.seller_manual_quantity_sources as source
  where source.item_type = 'hatching_egg_inventory'
    and hei.id = source.source_id
    and hei.store_id = p_store_id;

  update public.order_items as oi
  set inventory_debited_quantity = oi.quantity
  where oi.order_id = v_created_order_id
    and oi.store_id = p_store_id
    and oi.order_item_source <> 'custom';

  update public.order_items as oi
  set inventory_debited_quantity = 0
  where oi.order_id = v_created_order_id
    and oi.store_id = p_store_id
    and oi.order_item_source = 'custom';

  update public.inventory_activity_events as event
  set
    from_quantity_available = source.before_quantity,
    to_quantity_available = greatest(source.before_quantity - source.requested_quantity, 0),
    metadata = coalesce(event.metadata, '{}'::jsonb) || jsonb_build_object(
      'requested_quantity', source.requested_quantity,
      'physical_quantity_delta', least(source.before_quantity, source.requested_quantity),
      'seller_override_quantity', greatest(source.requested_quantity - source.before_quantity, 0),
      'override_applied', source.requested_quantity > source.before_quantity
    )
  from pg_temp.seller_manual_quantity_sources as source
  where source.item_type = 'listing_inventory'
    and event.store_id = p_store_id
    and event.inventory_item_id = source.source_id
    and event.metadata ->> 'order_id' = v_created_order_id::text
    and event.note = 'Manual order inventory deduction';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'order_item_id', current_item.id,
        'item_type', source.item_type,
        'source_id', source.source_id,
        'before_quantity', source.before_quantity,
        'inventory_delta',
          greatest(source.before_quantity - source.requested_quantity, 0)
          - source.before_quantity,
        'after_quantity', greatest(source.before_quantity - source.requested_quantity, 0),
        'prior_debited_quantity', 0,
        'new_debited_quantity', source.requested_quantity,
        'prior_restored_quantity', 0,
        'new_restored_quantity', 0,
        'ordered_quantity', source.requested_quantity,
        'physical_quantity_change', least(source.before_quantity, source.requested_quantity),
        'seller_override_quantity', greatest(source.requested_quantity - source.before_quantity, 0)
      )
      order by source.item_type, source.source_id
    ),
    '[]'::jsonb
  )
  into v_changes
  from pg_temp.seller_manual_quantity_sources as source
  left join lateral (
    select oi.id
    from public.order_items as oi
    where oi.order_id = v_created_order_id
      and oi.store_id = p_store_id
      and (
        (source.item_type = 'listing_inventory' and oi.inventory_item_id = source.source_id)
        or (source.item_type = 'equipment_inventory' and oi.equipment_inventory_item_id = source.source_id)
        or (
          source.item_type = 'processed_poultry_inventory'
          and oi.processed_poultry_inventory_item_id = source.source_id
        )
        or (
          source.item_type = 'hatching_egg_inventory'
          and oi.hatching_egg_inventory_item_id = source.source_id
        )
      )
    order by oi.id
    limit 1
  ) as current_item on true;

  perform public.record_order_inventory_reconciliation(
    v_created_order_id,
    p_store_id,
    'manual_order_created',
    v_changes
  );
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

create or replace function public.seller_edit_order(
  p_order_id uuid,
  p_items jsonb,
  p_removed_items jsonb default '[]'::jsonb,
  p_customer_id uuid default null,
  p_customer_email text default null,
  p_customer_first_name text default null,
  p_customer_last_name text default null,
  p_customer_phone text default null,
  p_business_name text default null,
  p_buyer_notes text default null,
  p_fulfillment_method text default 'pickup',
  p_pickup_option_id uuid default null,
  p_pickup_note text default null,
  p_delivery_option_id uuid default null,
  p_delivery_option_name_snapshot text default null,
  p_delivery_fee_amount numeric default 0,
  p_delivery_address_line1 text default null,
  p_delivery_address_line2 text default null,
  p_delivery_city text default null,
  p_delivery_state text default null,
  p_delivery_postal_code text default null,
  p_delivery_country text default null,
  p_tax_fee_amount numeric default null
)
returns table (
  order_id uuid,
  order_number text,
  store_id uuid,
  original_subtotal_amount numeric(10, 2),
  original_total_amount numeric(10, 2),
  revised_subtotal_amount numeric(10, 2),
  revised_tax_fee_amount numeric(10, 2),
  revised_delivery_fee_amount numeric(10, 2),
  revised_total_amount numeric(10, 2),
  inventory_changed boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_sanitized_items jsonb;
  v_changes jsonb;
begin
  select o.*
  into v_order
  from public.orders as o
  where o.id = p_order_id
  for update;

  if v_order.id is null
     or not (public.owns_store(v_order.store_id) or public.is_admin()) then
    raise exception 'Order is not available.';
  end if;

  if v_order.payment_method = 'stripe_checkout'
     and v_order.payment_status <> 'unpaid' then
    raise exception 'Paid online orders cannot be edited.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Order items must be an array.';
  end if;

  perform 1
  from public.order_items as oi
  where oi.order_id = v_order.id
    and oi.store_id = v_order.store_id
  order by oi.id
  for update;

  if exists (
    select 1
    from public.order_items as oi
    where oi.order_id = v_order.id
      and oi.store_id = v_order.store_id
      and oi.order_item_source <> 'custom'
      and oi.inventory_debited_quantity is null
  ) then
    raise exception 'Order inventory requires operational reconciliation before editing.';
  end if;

  drop table if exists pg_temp.seller_quantity_edit_existing;
  drop table if exists pg_temp.seller_quantity_edit_requested;
  drop table if exists pg_temp.seller_quantity_edit_changes;

  create temporary table pg_temp.seller_quantity_edit_existing on commit drop as
  select
    oi.id as order_item_id,
    case
      when coalesce(oi.order_item_source, 'listing_inventory') in ('inventory', 'listing_inventory')
        then 'listing_inventory'
      else oi.order_item_source
    end as item_type,
    case
      when coalesce(oi.order_item_source, 'listing_inventory') in ('inventory', 'listing_inventory')
        then oi.inventory_item_id
      when oi.order_item_source = 'equipment_inventory'
        then oi.equipment_inventory_item_id
      when oi.order_item_source = 'processed_poultry_inventory'
        then oi.processed_poultry_inventory_item_id
      when oi.order_item_source = 'hatching_egg_inventory'
        then oi.hatching_egg_inventory_item_id
      else null
    end as source_id,
    oi.quantity,
    oi.inventory_debited_quantity,
    oi.fulfilled_quantity,
    oi.restored_quantity
  from public.order_items as oi
  where oi.order_id = v_order.id
    and oi.store_id = v_order.store_id;

  create temporary table pg_temp.seller_quantity_edit_requested (
    line_number integer primary key,
    order_item_id uuid,
    item_type text not null,
    source_id uuid,
    quantity integer not null
  ) on commit drop;

  insert into pg_temp.seller_quantity_edit_requested (
    line_number,
    order_item_id,
    item_type,
    source_id,
    quantity
  )
  select
    item_with_ordinality.line_number::integer,
    nullif(item_with_ordinality.item ->> 'order_item_id', '')::uuid,
    case
      when coalesce(nullif(item_with_ordinality.item ->> 'item_type', ''), 'inventory')
        in ('inventory', 'listing_inventory') then 'listing_inventory'
      else coalesce(nullif(item_with_ordinality.item ->> 'item_type', ''), 'inventory')
    end,
    case
      when coalesce(nullif(item_with_ordinality.item ->> 'item_type', ''), 'inventory')
        in ('inventory', 'listing_inventory')
        then nullif(item_with_ordinality.item ->> 'inventory_item_id', '')::uuid
      when coalesce(nullif(item_with_ordinality.item ->> 'item_type', ''), 'inventory')
        in ('equipment_inventory', 'processed_poultry_inventory', 'hatching_egg_inventory')
        then nullif(item_with_ordinality.item ->> 'item_id', '')::uuid
      else null
    end,
    (item_with_ordinality.item ->> 'quantity')::integer
  from jsonb_array_elements(p_items)
    with ordinality as item_with_ordinality(item, line_number);

  if exists (
    select 1
    from pg_temp.seller_quantity_edit_requested as requested
    left join pg_temp.seller_quantity_edit_existing as existing
      on existing.order_item_id = requested.order_item_id
    where requested.order_item_id is not null
      and (
        existing.order_item_id is null
        or existing.item_type is distinct from requested.item_type
        or existing.source_id is distinct from requested.source_id
      )
  ) then
    raise exception 'Change an inventory item by removing the old line and adding a new line.';
  end if;

  -- Lock current and requested exact sources in one deterministic order before
  -- calculating any quantity delta.
  perform 1
  from public.inventory_items as ii
  where ii.store_id = v_order.store_id
    and ii.id in (
      select existing.source_id
      from pg_temp.seller_quantity_edit_existing as existing
      where existing.item_type = 'listing_inventory'
      union
      select requested.source_id
      from pg_temp.seller_quantity_edit_requested as requested
      where requested.item_type = 'listing_inventory'
    )
  order by ii.id
  for update;

  perform 1
  from public.equipment_inventory_items as ei
  where ei.store_id = v_order.store_id
    and ei.id in (
      select existing.source_id
      from pg_temp.seller_quantity_edit_existing as existing
      where existing.item_type = 'equipment_inventory'
      union
      select requested.source_id
      from pg_temp.seller_quantity_edit_requested as requested
      where requested.item_type = 'equipment_inventory'
    )
  order by ei.id
  for update;

  perform 1
  from public.processed_poultry_inventory_items as ppi
  where ppi.store_id = v_order.store_id
    and ppi.id in (
      select existing.source_id
      from pg_temp.seller_quantity_edit_existing as existing
      where existing.item_type = 'processed_poultry_inventory'
      union
      select requested.source_id
      from pg_temp.seller_quantity_edit_requested as requested
      where requested.item_type = 'processed_poultry_inventory'
    )
  order by ppi.id
  for update;

  perform 1
  from public.hatching_egg_inventory_items as hei
  where hei.store_id = v_order.store_id
    and hei.id in (
      select existing.source_id
      from pg_temp.seller_quantity_edit_existing as existing
      where existing.item_type = 'hatching_egg_inventory'
      union
      select requested.source_id
      from pg_temp.seller_quantity_edit_requested as requested
      where requested.item_type = 'hatching_egg_inventory'
    )
  order by hei.id
  for update;

  if exists (
    select 1
    from (
      select existing.item_type, existing.source_id
      from pg_temp.seller_quantity_edit_existing as existing
      where existing.item_type <> 'custom'
      union
      select requested.item_type, requested.source_id
      from pg_temp.seller_quantity_edit_requested as requested
      where requested.item_type <> 'custom'
    ) as source
    where source.source_id is null
       or (
         source.item_type = 'listing_inventory'
         and not exists (
           select 1
           from public.inventory_items as ii
           where ii.id = source.source_id
             and ii.store_id = v_order.store_id
         )
       )
       or (
         source.item_type = 'equipment_inventory'
         and not exists (
           select 1
           from public.equipment_inventory_items as ei
           where ei.id = source.source_id
             and ei.store_id = v_order.store_id
         )
       )
       or (
         source.item_type = 'processed_poultry_inventory'
         and not exists (
           select 1
           from public.processed_poultry_inventory_items as ppi
           where ppi.id = source.source_id
             and ppi.store_id = v_order.store_id
         )
       )
       or (
         source.item_type = 'hatching_egg_inventory'
         and not exists (
           select 1
           from public.hatching_egg_inventory_items as hei
           where hei.id = source.source_id
             and hei.store_id = v_order.store_id
         )
       )
  ) then
    raise exception 'One or more inventory items are not available for this store.';
  end if;

  create temporary table pg_temp.seller_quantity_edit_changes on commit drop as
  select
    requested.order_item_id,
    requested.item_type,
    requested.source_id,
    (requested.quantity - existing.quantity)::integer as quantity_delta,
    existing.inventory_debited_quantity as prior_debited_quantity,
    requested.quantity as new_debited_quantity,
    existing.restored_quantity as prior_restored_quantity,
    existing.restored_quantity as new_restored_quantity
  from pg_temp.seller_quantity_edit_requested as requested
  join pg_temp.seller_quantity_edit_existing as existing
    on existing.order_item_id = requested.order_item_id
  where requested.item_type <> 'custom'
    and requested.quantity <> existing.quantity

  union all

  select
    null::uuid,
    requested.item_type,
    requested.source_id,
    requested.quantity,
    0,
    requested.quantity,
    0,
    0
  from pg_temp.seller_quantity_edit_requested as requested
  where requested.order_item_id is null
    and requested.item_type <> 'custom'

  union all

  select
    existing.order_item_id,
    existing.item_type,
    existing.source_id,
    -existing.quantity,
    existing.inventory_debited_quantity,
    0,
    existing.restored_quantity,
    existing.restored_quantity
  from pg_temp.seller_quantity_edit_existing as existing
  where existing.item_type <> 'custom'
    and not exists (
      select 1
      from pg_temp.seller_quantity_edit_requested as requested
      where requested.order_item_id = existing.order_item_id
    );

  if exists (
    select 1
    from pg_temp.seller_quantity_edit_changes as change
    where change.source_id is null
       or change.new_debited_quantity < 0
  ) then
    raise exception 'Order inventory requires operational reconciliation before editing.';
  end if;

  select public.reconcile_order_inventory(
    v_order.store_id,
    'order_edited',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'order_item_id', change.order_item_id,
          'item_type', change.item_type,
          'source_id', change.source_id,
          'quantity_delta', change.quantity_delta,
          'prior_debited_quantity', change.prior_debited_quantity,
          'new_debited_quantity', change.new_debited_quantity,
          'prior_restored_quantity', change.prior_restored_quantity,
          'new_restored_quantity', change.new_restored_quantity
        )
      ) filter (where change.quantity_delta <> 0),
      '[]'::jsonb
    )
  )
  into v_changes
  from pg_temp.seller_quantity_edit_changes as change;

  select coalesce(
    jsonb_agg(
      (item_with_ordinality.item - 'change_inventory')
        || jsonb_build_object('change_inventory', false)
      order by item_with_ordinality.line_number
    ),
    '[]'::jsonb
  )
  into v_sanitized_items
  from jsonb_array_elements(p_items)
    with ordinality as item_with_ordinality(item, line_number);

  -- The inventory transaction above is authoritative. The retained persistence
  -- function receives no browser-authoritative inventory mutation flag.
  update public.order_items as oi
  set inventory_debited_quantity = null
  where oi.order_id = v_order.id
    and oi.store_id = v_order.store_id
    and oi.order_item_source <> 'custom';

  return query
  select *
  from public.seller_edit_order_batch_d_internal(
    p_order_id,
    v_sanitized_items,
    '[]'::jsonb,
    p_customer_id,
    p_customer_email,
    p_customer_first_name,
    p_customer_last_name,
    p_customer_phone,
    p_business_name,
    p_buyer_notes,
    p_fulfillment_method,
    p_pickup_option_id,
    p_pickup_note,
    p_delivery_option_id,
    p_delivery_option_name_snapshot,
    p_delivery_fee_amount,
    p_delivery_address_line1,
    p_delivery_address_line2,
    p_delivery_city,
    p_delivery_state,
    p_delivery_postal_code,
    p_delivery_country,
    p_tax_fee_amount
  );

  update public.order_items as oi
  set inventory_debited_quantity =
    case when requested.item_type = 'custom' then 0 else requested.quantity end
  from pg_temp.seller_quantity_edit_requested as requested
  where oi.order_id = v_order.id
    and oi.store_id = v_order.store_id
    and (
      oi.id = requested.order_item_id
      or (
        requested.order_item_id is null
        and (
          (requested.item_type = 'listing_inventory' and oi.inventory_item_id = requested.source_id)
          or (
            requested.item_type = 'equipment_inventory'
            and oi.equipment_inventory_item_id = requested.source_id
          )
          or (
            requested.item_type = 'processed_poultry_inventory'
            and oi.processed_poultry_inventory_item_id = requested.source_id
          )
          or (
            requested.item_type = 'hatching_egg_inventory'
            and oi.hatching_egg_inventory_item_id = requested.source_id
          )
          or (
            requested.item_type = 'custom'
            and oi.order_item_source = 'custom'
            and oi.inventory_debited_quantity is null
          )
        )
      )
    );

  if exists (
    select 1
    from public.order_items as oi
    where oi.order_id = v_order.id
      and oi.store_id = v_order.store_id
      and (
        (oi.order_item_source <> 'custom' and oi.inventory_debited_quantity <> oi.quantity)
        or (oi.order_item_source = 'custom' and oi.inventory_debited_quantity <> 0)
        or oi.inventory_debited_quantity is null
      )
  ) then
    raise exception 'Order inventory reconciliation did not classify every order line.';
  end if;

  perform public.record_order_inventory_reconciliation(
    v_order.id,
    v_order.store_id,
    'order_edited',
    v_changes
  );
end;
$$;

revoke all on function public.seller_edit_order(
  uuid, jsonb, jsonb, uuid, text, text, text, text, text, text, text, uuid,
  text, uuid, text, numeric, text, text, text, text, text, text, numeric
) from public, anon, service_role;
grant execute on function public.seller_edit_order(
  uuid, jsonb, jsonb, uuid, text, text, text, text, text, text, text, uuid,
  text, uuid, text, numeric, text, text, text, text, text, text, numeric
) to authenticated;

commit;
