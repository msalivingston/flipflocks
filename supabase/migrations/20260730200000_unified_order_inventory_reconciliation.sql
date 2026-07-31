-- Phase 1 Security Batch D: make order inventory reconciliation strict,
-- complete across every inventory-backed item type, and independent of
-- browser inventory-authority flags.

begin;

alter table public.order_items
add column if not exists inventory_debited_quantity integer;

comment on column public.order_items.inventory_debited_quantity is
'Quantity on this order line that was actually removed from its inventory source. NULL means a historical source-backed line has not yet been safely classified.';

-- Custom lines have no inventory source and can be classified without
-- making assumptions about historical stock mutations.
update public.order_items
set inventory_debited_quantity = 0
where order_item_source = 'custom'
  and inventory_item_id is null
  and equipment_inventory_item_id is null
  and processed_poultry_inventory_item_id is null
  and hatching_egg_inventory_item_id is null
  and inventory_debited_quantity is null;

alter table public.order_items
  add constraint order_items_inventory_debited_quantity_range_check
  check (
    inventory_debited_quantity is null
    or (
      inventory_debited_quantity >= 0
      and inventory_debited_quantity <= quantity
    )
  ) not valid,
  add constraint order_items_restored_not_over_debited_check
  check (
    inventory_debited_quantity is null
    or restored_quantity <= inventory_debited_quantity
  ) not valid,
  add constraint order_items_custom_inventory_debit_zero_check
  check (
    order_item_source <> 'custom'
    or inventory_debited_quantity is null
    or inventory_debited_quantity = 0
  ) not valid;

alter table public.order_events
drop constraint if exists order_events_event_type_check;

alter table public.order_events
add constraint order_events_event_type_check check (
  event_type in (
    'payment_marked_paid',
    'payment_marked_pay_at_pickup',
    'payment_provider_checkout_session_recorded',
    'payment_provider_payment_succeeded',
    'payment_provider_payment_failed',
    'payment_provider_refund_updated',
    'order_ready_for_pickup',
    'order_partially_fulfilled',
    'order_fulfilled',
    'order_unfulfilled',
    'order_canceled',
    'order_reinstated',
    'order_archived',
    'order_unarchived',
    'refund_recorded',
    'order_edited',
    'order_inventory_reconciled'
  )
);

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
    from pg_temp.batch_d_inventory_line_changes
    where item_type not in (
      'listing_inventory',
      'equipment_inventory',
      'processed_poultry_inventory',
      'hatching_egg_inventory'
    )
       or source_id is null
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
    item_type,
    source_id,
    sum(quantity_delta)::integer
  from pg_temp.batch_d_inventory_line_changes
  group by item_type, source_id
  having sum(quantity_delta) <> 0;

  -- Positive quantity_delta consumes stock. Negative quantity_delta restores
  -- stock. Every caller supplies deltas derived from locked order-line state.
  for v_source in
    select *
    from pg_temp.batch_d_inventory_source_changes
    order by
      case item_type
        when 'listing_inventory' then 1
        when 'equipment_inventory' then 2
        when 'processed_poultry_inventory' then 3
        when 'hatching_egg_inventory' then 4
        else 5
      end,
      source_id
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
      select
        ei.quantity_available,
        ei.visibility_status,
        ei.moderation_status,
        ei.archived_at
      into
        v_before_quantity,
        v_visibility_status,
        v_moderation_status,
        v_archived_at
      from public.equipment_inventory_items as ei
      where ei.id = v_source.source_id
        and ei.store_id = p_store_id
      for update;
    elsif v_source.item_type = 'processed_poultry_inventory' then
      select
        ppi.quantity_available,
        ppi.visibility_status,
        ppi.moderation_status,
        ppi.archived_at
      into
        v_before_quantity,
        v_visibility_status,
        v_moderation_status,
        v_archived_at
      from public.processed_poultry_inventory_items as ppi
      where ppi.id = v_source.source_id
        and ppi.store_id = p_store_id
      for update;
    else
      select
        hei.quantity_available,
        hei.visibility_status,
        hei.moderation_status,
        hei.archived_at
      into
        v_before_quantity,
        v_visibility_status,
        v_moderation_status,
        v_archived_at
      from public.hatching_egg_inventory_items as hei
      where hei.id = v_source.source_id
        and hei.store_id = p_store_id
      for update;
    end if;

    if not found then
      raise exception 'One or more inventory items are not available for this store.';
    end if;

    if v_source.quantity_delta > 0 then
      if v_visibility_status = 'archived'
         or v_archived_at is not null
         or v_moderation_status is distinct from 'normal' then
        raise exception 'Archived or moderated inventory cannot be consumed.';
      end if;

      if v_before_quantity < v_source.quantity_delta then
        raise exception 'Insufficient inventory quantity available.';
      end if;
    end if;

    v_after_quantity := v_before_quantity - v_source.quantity_delta;

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
        'Strict order inventory reconciliation',
        jsonb_build_object(
          'operation', p_operation,
          'quantity_delta', v_source.quantity_delta,
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

    update pg_temp.batch_d_inventory_source_changes
    set
      source_before_quantity = v_before_quantity,
      source_after_quantity = v_after_quantity
    where item_type = v_source.item_type
      and source_id = v_source.source_id;

    update pg_temp.batch_d_inventory_line_changes as line_change
    set
      source_before_quantity = v_before_quantity,
      source_after_quantity = v_after_quantity
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
      order by
        case line_change.item_type
          when 'listing_inventory' then 1
          when 'equipment_inventory' then 2
          when 'processed_poultry_inventory' then 3
          when 'hatching_egg_inventory' then 4
          else 5
        end,
        line_change.source_id,
        line_change.order_item_id
    ),
    '[]'::jsonb
  )
  into v_result
  from pg_temp.batch_d_inventory_line_changes as line_change;

  return v_result;
end;
$$;

comment on function public.reconcile_order_inventory(uuid, text, jsonb) is
'Owner-internal exact inventory reconciler. Positive deltas consume stock, negative deltas restore stock, and source rows are locked Live Poultry, Equipment, Poultry Products, Hatching Eggs, then UUID.';

revoke all on function public.reconcile_order_inventory(uuid, text, jsonb)
from public, anon, authenticated, service_role;

create or replace function public.record_order_inventory_reconciliation(
  p_order_id uuid,
  p_store_id uuid,
  p_operation text,
  p_changes jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_changes is null
     or jsonb_typeof(p_changes) <> 'array'
     or jsonb_array_length(p_changes) = 0 then
    return;
  end if;

  if not exists (
    select 1
    from public.orders as o
    where o.id = p_order_id
      and o.store_id = p_store_id
  ) then
    raise exception 'Order is not available.';
  end if;

  insert into public.order_events (
    store_id,
    order_id,
    actor_user_id,
    actor_type,
    event_type,
    note,
    metadata
  )
  values (
    p_store_id,
    p_order_id,
    auth.uid(),
    case
      when auth.uid() is null then 'system'
      when public.is_admin() then 'admin'
      else 'seller'
    end,
    'order_inventory_reconciled',
    'Strict order inventory reconciliation',
    jsonb_build_object(
      'operation', p_operation,
      'actual_actor_user_id', auth.uid(),
      'changes', p_changes
    )
  );
end;
$$;

revoke all on function public.record_order_inventory_reconciliation(
  uuid, uuid, text, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.describe_new_order_inventory_debits(
  p_order_id uuid,
  p_store_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'order_item_id', oi.id,
        'item_type', oi.order_item_source,
        'source_id',
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
          end,
        'before_quantity',
          case
            when coalesce(oi.order_item_source, 'listing_inventory') in ('inventory', 'listing_inventory')
              then ii.quantity_available + oi.quantity
            when oi.order_item_source = 'equipment_inventory'
              then ei.quantity_available + oi.quantity
            when oi.order_item_source = 'processed_poultry_inventory'
              then ppi.quantity_available + oi.quantity
            when oi.order_item_source = 'hatching_egg_inventory'
              then hei.quantity_available + oi.quantity
            else null
          end,
        'inventory_delta',
          case when oi.order_item_source = 'custom' then 0 else -oi.quantity end,
        'after_quantity',
          case
            when coalesce(oi.order_item_source, 'listing_inventory') in ('inventory', 'listing_inventory')
              then ii.quantity_available
            when oi.order_item_source = 'equipment_inventory'
              then ei.quantity_available
            when oi.order_item_source = 'processed_poultry_inventory'
              then ppi.quantity_available
            when oi.order_item_source = 'hatching_egg_inventory'
              then hei.quantity_available
            else null
          end,
        'prior_debited_quantity', 0,
        'new_debited_quantity', oi.inventory_debited_quantity,
        'prior_restored_quantity', 0,
        'new_restored_quantity', oi.restored_quantity
      )
      order by oi.id
    ),
    '[]'::jsonb
  )
  from public.order_items as oi
  left join public.inventory_items as ii
    on ii.id = oi.inventory_item_id
   and ii.store_id = oi.store_id
  left join public.equipment_inventory_items as ei
    on ei.id = oi.equipment_inventory_item_id
   and ei.store_id = oi.store_id
  left join public.processed_poultry_inventory_items as ppi
    on ppi.id = oi.processed_poultry_inventory_item_id
   and ppi.store_id = oi.store_id
  left join public.hatching_egg_inventory_items as hei
    on hei.id = oi.hatching_egg_inventory_item_id
   and hei.store_id = oi.store_id
  where oi.order_id = p_order_id
    and oi.store_id = p_store_id;
$$;

revoke all on function public.describe_new_order_inventory_debits(uuid, uuid)
from public, anon, authenticated, service_role;

-- Retire every old browser-callable overload before installing the secured
-- wrappers below. Only the exact replacement signatures are granted again.
do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'seller_create_manual_order',
        'seller_edit_order',
        'cancel_order',
        'reinstate_order',
        'create_pay_at_pickup_order',
        'create_pay_at_pickup_order_v2'
      )
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      v_function.signature
    );
  end loop;
end;
$$;

alter function public.create_pay_at_pickup_order_v2(
  uuid, text, text, text, text, jsonb, text, text, text, text, text, text,
  text, text, text, text, text, text, text, inet, text, uuid, text, uuid
)
rename to create_pay_at_pickup_order_v2_batch_d_internal;

revoke all on function public.create_pay_at_pickup_order_v2_batch_d_internal(
  uuid, text, text, text, text, jsonb, text, text, text, text, text, text,
  text, text, text, text, text, text, text, inet, text, uuid, text, uuid
) from public, anon, authenticated, service_role;

create function public.create_pay_at_pickup_order_v2(
  p_store_id uuid,
  p_idempotency_key text,
  p_buyer_email text,
  p_buyer_first_name text,
  p_buyer_last_name text,
  p_items jsonb,
  p_buyer_phone text default null,
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
  p_buyer_notes text default null,
  p_pickup_note text default null,
  p_buyer_ip_address inet default null,
  p_buyer_user_agent text default null,
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
  subtotal_amount numeric(10, 2),
  tax_fee_amount numeric(10, 2),
  total_amount numeric(10, 2),
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_order_id uuid;
  v_order_id uuid;
  v_changes jsonb;
  v_classified_count integer := 0;
begin
  select oik.order_id
  into v_existing_order_id
  from public.order_idempotency_keys as oik
  where oik.store_id = p_store_id
    and oik.idempotency_key = nullif(trim(p_idempotency_key), '');

  return query
  select *
  from public.create_pay_at_pickup_order_v2_batch_d_internal(
    p_store_id,
    p_idempotency_key,
    p_buyer_email,
    p_buyer_first_name,
    p_buyer_last_name,
    p_items,
    p_buyer_phone,
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
    p_buyer_notes,
    p_pickup_note,
    p_buyer_ip_address,
    p_buyer_user_agent,
    p_pickup_option_id,
    p_fulfillment_method,
    p_delivery_option_id
  );

  select oik.order_id
  into v_order_id
  from public.order_idempotency_keys as oik
  where oik.store_id = p_store_id
    and oik.idempotency_key = nullif(trim(p_idempotency_key), '');

  if v_existing_order_id is null then
    update public.order_items as oi
    set inventory_debited_quantity =
      case when oi.order_item_source = 'custom' then 0 else oi.quantity end
    where oi.order_id = v_order_id
      and oi.store_id = p_store_id
      and oi.inventory_debited_quantity is null;

    get diagnostics v_classified_count = row_count;

    if v_classified_count > 0 then
      v_changes := public.describe_new_order_inventory_debits(v_order_id, p_store_id);
      perform public.record_order_inventory_reconciliation(
        v_order_id,
        p_store_id,
        'public_checkout_created',
        v_changes
      );
    end if;
  end if;
end;
$$;

revoke all on function public.create_pay_at_pickup_order_v2(
  uuid, text, text, text, text, jsonb, text, text, text, text, text, text,
  text, text, text, text, text, text, text, inet, text, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.create_pay_at_pickup_order_v2(
  uuid, text, text, text, text, jsonb, text, text, text, text, text, text,
  text, text, text, text, text, text, text, inet, text, uuid, text, uuid
) to service_role;

alter function public.seller_create_manual_order(
  uuid, text, jsonb, uuid, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, numeric,
  numeric, boolean, boolean, uuid, text, uuid
)
rename to seller_create_manual_order_batch_d_internal;

revoke all on function public.seller_create_manual_order_batch_d_internal(
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
set search_path = public
as $$
declare
  v_existing_order_id uuid;
  v_order_id uuid;
  v_sanitized_items jsonb := p_items;
  v_changes jsonb;
  v_classified_count integer := 0;
begin
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    select coalesce(
      jsonb_agg(item_with_ordinality.item - 'allow_inventory_override'
        order by item_with_ordinality.line_number),
      '[]'::jsonb
    )
    into v_sanitized_items
    from jsonb_array_elements(p_items)
      with ordinality as item_with_ordinality(item, line_number);
  end if;

  select oik.order_id
  into v_existing_order_id
  from public.order_idempotency_keys as oik
  where oik.store_id = p_store_id
    and oik.idempotency_key = nullif(trim(p_idempotency_key), '');

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
  into v_order_id
  from public.order_idempotency_keys as oik
  where oik.store_id = p_store_id
    and oik.idempotency_key = nullif(trim(p_idempotency_key), '');

  if v_existing_order_id is null then
    update public.order_items as oi
    set inventory_debited_quantity =
      case when oi.order_item_source = 'custom' then 0 else oi.quantity end
    where oi.order_id = v_order_id
      and oi.store_id = p_store_id
      and oi.inventory_debited_quantity is null;

    get diagnostics v_classified_count = row_count;

    if v_classified_count > 0 then
      v_changes := public.describe_new_order_inventory_debits(v_order_id, p_store_id);
      perform public.record_order_inventory_reconciliation(
        v_order_id,
        p_store_id,
        'manual_order_created',
        v_changes
      );
    end if;
  end if;
exception
  when raise_exception then
    if sqlerrm = 'Inventory override must be explicitly allowed when manual order quantity exceeds available inventory.' then
      raise exception 'Insufficient inventory quantity available.';
    end if;
    raise;
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
rename to seller_edit_order_batch_d_internal;

revoke all on function public.seller_edit_order_batch_d_internal(
  uuid, jsonb, jsonb, uuid, text, text, text, text, text, text, text, uuid,
  text, uuid, text, numeric, text, text, text, text, text, text, numeric
) from public, anon, authenticated, service_role;

create function public.seller_edit_order(
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

  drop table if exists pg_temp.batch_d_edit_existing;
  drop table if exists pg_temp.batch_d_edit_requested;
  drop table if exists pg_temp.batch_d_edit_changes;

  create temporary table pg_temp.batch_d_edit_existing on commit drop as
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

  create temporary table pg_temp.batch_d_edit_requested (
    line_number integer primary key,
    order_item_id uuid,
    item_type text not null,
    source_id uuid,
    quantity integer not null
  ) on commit drop;

  insert into pg_temp.batch_d_edit_requested (
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
    from pg_temp.batch_d_edit_requested as requested
    left join pg_temp.batch_d_edit_existing as existing
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

  -- Lock every source used by the current or requested order before applying
  -- any delta. This prevents the retained persistence implementation from
  -- introducing a second, incompatible lock order for unchanged lines.
  perform 1
  from public.inventory_items as ii
  where ii.store_id = v_order.store_id
    and ii.id in (
      select source_id
      from pg_temp.batch_d_edit_existing
      where item_type = 'listing_inventory'
      union
      select source_id
      from pg_temp.batch_d_edit_requested
      where item_type = 'listing_inventory'
    )
  order by ii.id
  for update;

  perform 1
  from public.equipment_inventory_items as ei
  where ei.store_id = v_order.store_id
    and ei.id in (
      select source_id
      from pg_temp.batch_d_edit_existing
      where item_type = 'equipment_inventory'
      union
      select source_id
      from pg_temp.batch_d_edit_requested
      where item_type = 'equipment_inventory'
    )
  order by ei.id
  for update;

  perform 1
  from public.processed_poultry_inventory_items as ppi
  where ppi.store_id = v_order.store_id
    and ppi.id in (
      select source_id
      from pg_temp.batch_d_edit_existing
      where item_type = 'processed_poultry_inventory'
      union
      select source_id
      from pg_temp.batch_d_edit_requested
      where item_type = 'processed_poultry_inventory'
    )
  order by ppi.id
  for update;

  perform 1
  from public.hatching_egg_inventory_items as hei
  where hei.store_id = v_order.store_id
    and hei.id in (
      select source_id
      from pg_temp.batch_d_edit_existing
      where item_type = 'hatching_egg_inventory'
      union
      select source_id
      from pg_temp.batch_d_edit_requested
      where item_type = 'hatching_egg_inventory'
    )
  order by hei.id
  for update;

  if exists (
    select 1
    from (
      select item_type, source_id
      from pg_temp.batch_d_edit_existing
      where item_type <> 'custom'
      union
      select item_type, source_id
      from pg_temp.batch_d_edit_requested
      where item_type <> 'custom'
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

  create temporary table pg_temp.batch_d_edit_changes on commit drop as
  select
    requested.order_item_id,
    requested.item_type,
    requested.source_id,
    (requested.quantity - existing.quantity)::integer as quantity_delta,
    existing.inventory_debited_quantity as prior_debited_quantity,
    (
      existing.inventory_debited_quantity
      + requested.quantity
      - existing.quantity
    )::integer as new_debited_quantity,
    existing.restored_quantity as prior_restored_quantity,
    existing.restored_quantity as new_restored_quantity
  from pg_temp.batch_d_edit_requested as requested
  join pg_temp.batch_d_edit_existing as existing
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
  from pg_temp.batch_d_edit_requested as requested
  where requested.order_item_id is null
    and requested.item_type <> 'custom'

  union all

  select
    existing.order_item_id,
    existing.item_type,
    existing.source_id,
    -existing.inventory_debited_quantity,
    existing.inventory_debited_quantity,
    0,
    existing.restored_quantity,
    existing.restored_quantity
  from pg_temp.batch_d_edit_existing as existing
  where existing.item_type <> 'custom'
    and not exists (
      select 1
      from pg_temp.batch_d_edit_requested as requested
      where requested.order_item_id = existing.order_item_id
    );

  if exists (
    select 1
    from pg_temp.batch_d_edit_changes
    where source_id is null
       or new_debited_quantity < 0
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
  from pg_temp.batch_d_edit_changes as change;

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

  -- Existing strict lines may be reduced below their prior debit. Clear the
  -- ledger only inside this locked transaction so the retained persistence
  -- function can update quantity before the exact final debit is written.
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
    case
      when requested.item_type = 'custom' then 0
      when requested.order_item_id is null then requested.quantity
      else existing.inventory_debited_quantity
        + requested.quantity
        - existing.quantity
    end
  from pg_temp.batch_d_edit_requested as requested
  left join pg_temp.batch_d_edit_existing as existing
    on existing.order_item_id = requested.order_item_id
  where oi.order_id = v_order.id
    and oi.store_id = v_order.store_id
    and (
      oi.id = requested.order_item_id
      or (
        requested.order_item_id is null
        and (
          (requested.item_type = 'listing_inventory' and oi.inventory_item_id = requested.source_id)
          or (requested.item_type = 'equipment_inventory' and oi.equipment_inventory_item_id = requested.source_id)
          or (requested.item_type = 'processed_poultry_inventory' and oi.processed_poultry_inventory_item_id = requested.source_id)
          or (requested.item_type = 'hatching_egg_inventory' and oi.hatching_egg_inventory_item_id = requested.source_id)
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
      and oi.order_item_source <> 'custom'
      and oi.inventory_debited_quantity is null
  ) then
    raise exception 'Order inventory reconciliation did not classify every source-backed line.';
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

alter function public.cancel_order(uuid, text, boolean, boolean)
rename to cancel_order_batch_d_internal;

revoke all on function public.cancel_order_batch_d_internal(
  uuid, text, boolean, boolean
) from public, anon, authenticated, service_role;

create function public.cancel_order(
  p_order_id uuid,
  p_canceled_reason text,
  p_restore_inventory boolean default false,
  p_send_buyer_notification boolean default false
)
returns table (
  order_id uuid,
  order_number text,
  store_id uuid,
  order_status text,
  payment_status text,
  fulfilled_at timestamptz,
  canceled_at timestamptz,
  updated_at timestamptz,
  buyer_notification_queued boolean,
  seller_copy_queued boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_changes jsonb := '[]'::jsonb;
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

  if v_order.order_status not in ('pending', 'open') then
    raise exception 'Only pending or open orders can be canceled.';
  end if;

  perform 1
  from public.order_items as oi
  where oi.order_id = v_order.id
    and oi.store_id = v_order.store_id
  order by oi.id
  for update;

  if coalesce(p_restore_inventory, false) then
    if exists (
      select 1
      from public.order_items as oi
      where oi.order_id = v_order.id
        and oi.store_id = v_order.store_id
        and oi.order_item_source <> 'custom'
        and oi.inventory_debited_quantity is null
    ) then
      raise exception 'Order inventory requires operational reconciliation before cancellation.';
    end if;

    drop table if exists pg_temp.batch_d_cancel_changes;
    create temporary table pg_temp.batch_d_cancel_changes on commit drop as
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
      greatest(
        oi.inventory_debited_quantity
        - oi.fulfilled_quantity
        - oi.restored_quantity,
        0
      )::integer as restorable_quantity,
      oi.inventory_debited_quantity,
      oi.restored_quantity
    from public.order_items as oi
    where oi.order_id = v_order.id
      and oi.store_id = v_order.store_id
      and oi.order_item_source <> 'custom';

    select public.reconcile_order_inventory(
      v_order.store_id,
      'order_canceled',
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'order_item_id', change.order_item_id,
            'item_type', change.item_type,
            'source_id', change.source_id,
            'quantity_delta', -change.restorable_quantity,
            'prior_debited_quantity', change.inventory_debited_quantity,
            'new_debited_quantity', change.inventory_debited_quantity,
            'prior_restored_quantity', change.restored_quantity,
            'new_restored_quantity', change.restored_quantity + change.restorable_quantity
          )
        ) filter (where change.restorable_quantity > 0),
        '[]'::jsonb
      )
    )
    into v_changes
    from pg_temp.batch_d_cancel_changes as change;

    update public.order_items as oi
    set restored_quantity = oi.restored_quantity + change.restorable_quantity
    from pg_temp.batch_d_cancel_changes as change
    where oi.id = change.order_item_id
      and change.restorable_quantity > 0;
  end if;

  return query
  select *
  from public.cancel_order_batch_d_internal(
    p_order_id,
    p_canceled_reason,
    false,
    p_send_buyer_notification
  );

  perform public.record_order_inventory_reconciliation(
    v_order.id,
    v_order.store_id,
    'order_canceled',
    v_changes
  );
end;
$$;

revoke all on function public.cancel_order(uuid, text, boolean, boolean)
from public, anon;
grant execute on function public.cancel_order(uuid, text, boolean, boolean)
to authenticated, service_role;

alter function public.reinstate_order(uuid, text)
rename to reinstate_order_batch_d_internal;

revoke all on function public.reinstate_order_batch_d_internal(uuid, text)
from public, anon, authenticated, service_role;

create function public.reinstate_order(
  p_order_id uuid,
  p_note text default null
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
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_changes jsonb := '[]'::jsonb;
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

  if v_order.order_status <> 'canceled' then
    raise exception 'Only canceled orders can be reinstated.';
  end if;

  if v_order.payment_method <> 'pay_at_pickup' then
    raise exception 'Only pay-at-pickup orders can be reinstated.';
  end if;

  if v_order.payment_status <> 'canceled' then
    raise exception 'Only unpaid canceled orders can be reinstated.';
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
      and oi.fulfilled_quantity <> 0
  ) then
    raise exception 'Partially fulfilled orders cannot be reinstated.';
  end if;

  if exists (
    select 1
    from public.order_items as oi
    where oi.order_id = v_order.id
      and oi.store_id = v_order.store_id
      and oi.order_item_source <> 'custom'
      and oi.restored_quantity > 0
      and oi.inventory_debited_quantity is null
  ) then
    raise exception 'Order inventory requires operational reconciliation before reinstatement.';
  end if;

  perform 1
  from public.order_items as oi
  join public.inventory_items as ii
    on ii.id = oi.inventory_item_id
   and ii.store_id = v_order.store_id
  where oi.order_id = v_order.id
    and oi.store_id = v_order.store_id
    and coalesce(oi.order_item_source, 'listing_inventory') in ('inventory', 'listing_inventory')
  order by ii.id
  for update of ii;

  perform 1
  from public.order_items as oi
  join public.equipment_inventory_items as ei
    on ei.id = oi.equipment_inventory_item_id
   and ei.store_id = v_order.store_id
  where oi.order_id = v_order.id
    and oi.store_id = v_order.store_id
    and oi.order_item_source = 'equipment_inventory'
  order by ei.id
  for update of ei;

  perform 1
  from public.order_items as oi
  join public.processed_poultry_inventory_items as ppi
    on ppi.id = oi.processed_poultry_inventory_item_id
   and ppi.store_id = v_order.store_id
  where oi.order_id = v_order.id
    and oi.store_id = v_order.store_id
    and oi.order_item_source = 'processed_poultry_inventory'
  order by ppi.id
  for update of ppi;

  perform 1
  from public.order_items as oi
  join public.hatching_egg_inventory_items as hei
    on hei.id = oi.hatching_egg_inventory_item_id
   and hei.store_id = v_order.store_id
  where oi.order_id = v_order.id
    and oi.store_id = v_order.store_id
    and oi.order_item_source = 'hatching_egg_inventory'
  order by hei.id
  for update of hei;

  if exists (
    select 1
    from public.order_items as oi
    where oi.order_id = v_order.id
      and oi.store_id = v_order.store_id
      and (
        (
          coalesce(oi.order_item_source, 'listing_inventory') in ('inventory', 'listing_inventory')
          and not exists (
            select 1
            from public.inventory_items as ii
            where ii.id = oi.inventory_item_id
              and ii.store_id = v_order.store_id
              and ii.visibility_status <> 'archived'
              and ii.archived_at is null
              and ii.moderation_status = 'normal'
          )
        )
        or (
          oi.order_item_source = 'equipment_inventory'
          and not exists (
            select 1
            from public.equipment_inventory_items as ei
            where ei.id = oi.equipment_inventory_item_id
              and ei.store_id = v_order.store_id
              and ei.visibility_status <> 'archived'
              and ei.archived_at is null
              and ei.moderation_status = 'normal'
          )
        )
        or (
          oi.order_item_source = 'processed_poultry_inventory'
          and not exists (
            select 1
            from public.processed_poultry_inventory_items as ppi
            where ppi.id = oi.processed_poultry_inventory_item_id
              and ppi.store_id = v_order.store_id
              and ppi.visibility_status <> 'archived'
              and ppi.archived_at is null
              and ppi.moderation_status = 'normal'
          )
        )
        or (
          oi.order_item_source = 'hatching_egg_inventory'
          and not exists (
            select 1
            from public.hatching_egg_inventory_items as hei
            where hei.id = oi.hatching_egg_inventory_item_id
              and hei.store_id = v_order.store_id
              and hei.visibility_status <> 'archived'
              and hei.archived_at is null
              and hei.moderation_status = 'normal'
          )
        )
      )
  ) then
    raise exception 'One or more inventory items cannot be reinstated.';
  end if;

  drop table if exists pg_temp.batch_d_reinstate_changes;
  create temporary table pg_temp.batch_d_reinstate_changes on commit drop as
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
    oi.restored_quantity,
    oi.inventory_debited_quantity
  from public.order_items as oi
  where oi.order_id = v_order.id
    and oi.store_id = v_order.store_id
    and oi.order_item_source <> 'custom';

  select public.reconcile_order_inventory(
    v_order.store_id,
    'order_reinstated',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'order_item_id', change.order_item_id,
          'item_type', change.item_type,
          'source_id', change.source_id,
          'quantity_delta', change.restored_quantity,
          'prior_debited_quantity', change.inventory_debited_quantity,
          'new_debited_quantity', change.inventory_debited_quantity,
          'prior_restored_quantity', change.restored_quantity,
          'new_restored_quantity', 0
        )
      ) filter (where change.restored_quantity > 0),
      '[]'::jsonb
    )
  )
  into v_changes
  from pg_temp.batch_d_reinstate_changes as change;

  update public.order_items as oi
  set restored_quantity = 0
  from pg_temp.batch_d_reinstate_changes as change
  where oi.id = change.order_item_id
    and change.restored_quantity > 0;

  update public.orders as o
  set
    order_status = 'open',
    payment_status = 'pay_at_pickup',
    canceled_at = null,
    canceled_reason = null,
    fulfilled_at = null,
    updated_at = now()
  where o.id = v_order.id
    and o.store_id = v_order.store_id
  returning o.* into v_order;

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
    case when public.is_admin() then 'admin' else 'seller' end,
    'order_reinstated',
    'canceled',
    'open',
    'canceled',
    'pay_at_pickup',
    nullif(trim(p_note), ''),
    jsonb_build_object(
      'inventory_reconciliation', v_changes,
      'actual_actor_user_id', auth.uid()
    )
  );

  perform public.record_order_inventory_reconciliation(
    v_order.id,
    v_order.store_id,
    'order_reinstated',
    v_changes
  );

  return query
  select
    o.id,
    o.order_number,
    o.store_id,
    o.order_status,
    o.payment_status,
    o.fulfilled_at,
    o.canceled_at,
    o.updated_at
  from public.orders as o
  where o.id = v_order.id;
end;
$$;

revoke all on function public.reinstate_order(uuid, text)
from public, anon, service_role;
grant execute on function public.reinstate_order(uuid, text)
to authenticated;

-- The unversioned checkout RPC and all historical lifecycle overloads remain
-- non-browser-callable. Only the replacement signatures above are exposed.
do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname = 'create_pay_at_pickup_order'
        or (
          p.proname = 'cancel_order'
          and p.oid <> to_regprocedure(
            'public.cancel_order(uuid,text,boolean,boolean)'
          )
        )
      )
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      v_function.signature
    );
  end loop;
end;
$$;

commit;
