begin;

drop function if exists public.seller_edit_order(
  uuid,
  boolean,
  jsonb,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  text,
  uuid,
  text,
  numeric,
  text,
  text,
  text,
  text,
  text,
  text,
  numeric
);

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
  v_customer public.customers%rowtype;
  v_pickup_option public.store_pickup_options%rowtype;
  v_delivery_option public.store_delivery_options%rowtype;
  v_fulfillment_method text := coalesce(nullif(trim(p_fulfillment_method), ''), 'pickup');
  v_customer_email text := lower(nullif(trim(p_customer_email), ''));
  v_customer_first_name text := nullif(trim(p_customer_first_name), '');
  v_customer_last_name text := nullif(trim(p_customer_last_name), '');
  v_customer_phone text := nullif(trim(p_customer_phone), '');
  v_business_name text := nullif(trim(p_business_name), '');
  v_buyer_notes text := nullif(trim(p_buyer_notes), '');
  v_pickup_note text := nullif(trim(p_pickup_note), '');
  v_pickup_option_label_snapshot text;
  v_delivery_option_name_snapshot text := nullif(trim(p_delivery_option_name_snapshot), '');
  v_delivery_fee_amount numeric(10, 2) := 0;
  v_delivery_address_line1 text := nullif(trim(p_delivery_address_line1), '');
  v_delivery_address_line2 text := nullif(trim(p_delivery_address_line2), '');
  v_delivery_city text := nullif(trim(p_delivery_city), '');
  v_delivery_state text := nullif(trim(p_delivery_state), '');
  v_delivery_postal_code text := nullif(trim(p_delivery_postal_code), '');
  v_delivery_country text := nullif(trim(p_delivery_country), '');
  v_subtotal_amount numeric(10, 2);
  v_tax_fee_amount numeric(10, 2);
  v_total_amount numeric(10, 2);
  v_original_subtotal_amount numeric(10, 2);
  v_original_total_amount numeric(10, 2);
  v_item_count integer;
  v_record record;
  v_old_quantity integer;
  v_new_quantity integer;
  v_actual_quantity integer;
  v_inventory_changes jsonb := '[]'::jsonb;
  v_added_lines jsonb;
  v_removed_lines jsonb;
  v_quantity_changes jsonb;
  v_fulfillment_changed boolean;
begin
  if p_order_id is null then
    raise exception 'Order is required.';
  end if;

  if not public.is_admin() then
    if auth.uid() is null then
      raise exception 'Authentication is required.';
    end if;
  end if;

  select orders.*
  into v_order
  from public.orders as orders
  where orders.id = p_order_id
    and (public.owns_store(orders.store_id) or public.is_admin())
  for update;

  if v_order.id is null then
    raise exception 'Order is not available.';
  end if;

  if v_order.canceled_at is not null or v_order.order_status = 'canceled' then
    raise exception 'Canceled orders cannot be edited.';
  end if;

  if v_order.fulfilled_at is not null or v_order.order_status = 'fulfilled' then
    raise exception 'Fulfilled orders cannot be edited.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one order item is required.';
  end if;

  if p_removed_items is null or jsonb_typeof(p_removed_items) <> 'array' then
    raise exception 'Removed order items must be an array.';
  end if;

  if v_fulfillment_method not in ('pickup', 'delivery') then
    raise exception 'Fulfillment method must be pickup or delivery.';
  end if;

  if v_fulfillment_method = 'pickup' and p_delivery_option_id is not null then
    raise exception 'Delivery option must be blank for pickup orders.';
  end if;

  if p_pickup_option_id is not null and v_pickup_note is not null then
    raise exception 'Pickup option and pickup note cannot both be set.';
  end if;

  if v_fulfillment_method = 'delivery' then
    if p_pickup_option_id is not null or v_pickup_note is not null then
      raise exception 'Pickup fields must be blank for delivery orders.';
    end if;

    if p_delivery_option_id is not null then
      select store_delivery_options.*
      into v_delivery_option
      from public.store_delivery_options as store_delivery_options
      where store_delivery_options.id = p_delivery_option_id
        and store_delivery_options.store_id = v_order.store_id
        and store_delivery_options.is_active = true;

      if v_delivery_option.id is null then
        raise exception 'Delivery option is not available for this store.';
      end if;

      v_delivery_option_name_snapshot := v_delivery_option.name;
      v_delivery_fee_amount := v_delivery_option.price_amount;
    else
      if v_delivery_option_name_snapshot is null then
        raise exception 'Delivery option is required for delivery orders.';
      end if;

      v_delivery_fee_amount := coalesce(p_delivery_fee_amount, 0)::numeric(10, 2);
    end if;

    if v_delivery_fee_amount < 0 then
      raise exception 'Delivery fee cannot be negative.';
    end if;

    if v_delivery_address_line1 is null
      or v_delivery_city is null
      or v_delivery_state is null
      or v_delivery_postal_code is null then
      raise exception 'Delivery address is required for delivery orders.';
    end if;

    v_delivery_country := coalesce(v_delivery_country, 'US');
  else
    if p_pickup_option_id is not null then
      select store_pickup_options.*
      into v_pickup_option
      from public.store_pickup_options as store_pickup_options
      where store_pickup_options.id = p_pickup_option_id
        and store_pickup_options.store_id = v_order.store_id
        and store_pickup_options.is_active = true;

      if v_pickup_option.id is null then
        raise exception 'Pickup option is not available for this store.';
      end if;

      v_pickup_option_label_snapshot := v_pickup_option.label;
      v_pickup_note := null;
    end if;
  end if;

  if p_customer_id is not null then
    select customers.*
    into v_customer
    from public.customers as customers
    where customers.id = p_customer_id
      and customers.store_id = v_order.store_id;

    if v_customer.id is null then
      raise exception 'Customer is not available for this store.';
    end if;

    v_customer_email := v_customer.email;
    v_customer_first_name := v_customer.first_name;
    v_customer_last_name := v_customer.last_name;
    v_customer_phone := v_customer.phone;
    v_business_name := v_customer.business_name;
  end if;

  if v_customer_email is null then raise exception 'Customer email is required.'; end if;
  if v_customer_first_name is null then raise exception 'Customer first name is required.'; end if;
  if v_customer_last_name is null then raise exception 'Customer last name is required.'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where jsonb_typeof(item) <> 'object'
       or coalesce(nullif(item ->> 'item_type', ''), 'inventory') not in (
         'inventory',
         'custom',
         'equipment_inventory',
         'processed_poultry_inventory'
       )
       or not (item ? 'quantity')
       or item ->> 'quantity' !~ '^[0-9]+$'
       or (item ->> 'quantity')::integer <= 0
       or not (item ? 'unit_price')
       or item ->> 'unit_price' !~ '^[0-9]+(\.[0-9]{1,2})?$'
       or (
         item ? 'order_item_id'
         and nullif(item ->> 'order_item_id', '') is not null
         and item ->> 'order_item_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       )
       or (
         coalesce(nullif(item ->> 'item_type', ''), 'inventory') = 'inventory'
         and (
           not (item ? 'inventory_item_id')
           or item ->> 'inventory_item_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         )
       )
       or (
         coalesce(nullif(item ->> 'item_type', ''), 'inventory') = 'custom'
         and nullif(trim(item ->> 'custom_item_name'), '') is null
       )
       or (
         coalesce(nullif(item ->> 'item_type', ''), 'inventory') in (
           'equipment_inventory',
           'processed_poultry_inventory'
         )
         and (
           not (item ? 'item_id')
           or item ->> 'item_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         )
       )
  ) then
    raise exception 'Each order item must include a valid type, quantity, price, and item details.';
  end if;

  perform 1
  from public.order_items as order_items
  where order_items.order_id = v_order.id
    and order_items.store_id = v_order.store_id
  for update;

  if exists (
    select 1
    from jsonb_array_elements(p_removed_items) as removed_item
    where jsonb_typeof(removed_item) <> 'object'
       or not (removed_item ? 'order_item_id')
       or removed_item ->> 'order_item_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (
         removed_item ? 'change_inventory'
         and jsonb_typeof(removed_item -> 'change_inventory') <> 'boolean'
       )
  ) then
    raise exception 'Each removed order item must include a valid order item ID and inventory choice.';
  end if;

  create temporary table pg_temp.edit_existing_items on commit drop as
  select
    order_items.id as order_item_id,
    order_items.order_item_source as item_type,
    case
      when coalesce(order_items.order_item_source, 'listing_inventory') in ('inventory', 'listing_inventory')
        then order_items.inventory_item_id
      when order_items.order_item_source = 'equipment_inventory'
        then order_items.equipment_inventory_item_id
      when order_items.order_item_source = 'processed_poultry_inventory'
        then order_items.processed_poultry_inventory_item_id
      else null
    end as source_id,
    order_items.quantity,
    order_items.unit_price_snapshot,
    coalesce(order_items.item_name_snapshot, order_items.custom_item_name_snapshot, order_items.breed_display_name_snapshot) as label,
    order_items.fulfilled_quantity,
    order_items.restored_quantity
  from public.order_items as order_items
  where order_items.order_id = v_order.id
    and order_items.store_id = v_order.store_id;

  if exists (
    select 1
    from pg_temp.edit_existing_items
    where fulfilled_quantity <> 0 or restored_quantity <> 0
  ) then
    raise exception 'Orders with fulfilled or restored item quantities cannot be edited.';
  end if;

  create temporary table pg_temp.edit_requested_items (
    line_number integer primary key,
    order_item_id uuid,
    item_type text not null,
    source_id uuid,
    custom_item_name text,
    change_inventory boolean not null default false,
    quantity integer not null,
    unit_price numeric(10, 2) not null
  ) on commit drop;

  insert into pg_temp.edit_requested_items (
    line_number,
    order_item_id,
    item_type,
    source_id,
    custom_item_name,
    change_inventory,
    quantity,
    unit_price
  )
  select
    item_with_ordinality.line_number::integer,
    nullif(item_with_ordinality.item ->> 'order_item_id', '')::uuid,
    coalesce(nullif(item_with_ordinality.item ->> 'item_type', ''), 'inventory'),
    case
      when coalesce(nullif(item_with_ordinality.item ->> 'item_type', ''), 'inventory') = 'inventory'
        then (item_with_ordinality.item ->> 'inventory_item_id')::uuid
      when coalesce(nullif(item_with_ordinality.item ->> 'item_type', ''), 'inventory') in (
        'equipment_inventory',
        'processed_poultry_inventory'
      )
        then (item_with_ordinality.item ->> 'item_id')::uuid
      else null
    end,
    case
      when coalesce(nullif(item_with_ordinality.item ->> 'item_type', ''), 'inventory') = 'custom'
        then nullif(trim(item_with_ordinality.item ->> 'custom_item_name'), '')
      else null
    end,
    coalesce((item_with_ordinality.item ->> 'change_inventory')::boolean, false),
    (item_with_ordinality.item ->> 'quantity')::integer,
    (item_with_ordinality.item ->> 'unit_price')::numeric(10, 2)
  from jsonb_array_elements(p_items) with ordinality as item_with_ordinality(item, line_number);

  create temporary table pg_temp.edit_removed_items (
    order_item_id uuid primary key,
    change_inventory boolean not null default false
  ) on commit drop;

  insert into pg_temp.edit_removed_items (order_item_id, change_inventory)
  select
    (removed_item ->> 'order_item_id')::uuid,
    coalesce((removed_item ->> 'change_inventory')::boolean, false)
  from jsonb_array_elements(p_removed_items) as removed_item;

  select count(*) into v_item_count from pg_temp.edit_requested_items;
  if v_item_count = 0 then raise exception 'At least one valid order item is required.'; end if;

  if exists (
    select 1
    from pg_temp.edit_requested_items as requested
    where requested.order_item_id is not null
      and not exists (
        select 1
        from pg_temp.edit_existing_items as existing
        where existing.order_item_id = requested.order_item_id
      )
  ) then
    raise exception 'One or more existing order lines are not available.';
  end if;

  if exists (
    select 1
    from pg_temp.edit_requested_items as requested
    join pg_temp.edit_existing_items as existing
      on existing.order_item_id = requested.order_item_id
    where requested.order_item_id is not null
      and (
        case
          when coalesce(existing.item_type, 'listing_inventory') in ('inventory', 'listing_inventory') then 'inventory'
          else existing.item_type
        end
      ) <> requested.item_type
  ) then
    raise exception 'Change an inventory item by removing the old line and adding a new line.';
  end if;

  if exists (
    select 1
    from pg_temp.edit_requested_items as requested
    join pg_temp.edit_existing_items as existing
      on existing.order_item_id = requested.order_item_id
    where requested.order_item_id is not null
      and requested.item_type <> 'custom'
      and requested.source_id is distinct from existing.source_id
  ) then
    raise exception 'Change an inventory item by removing the old line and adding a new line.';
  end if;

  if exists (
    select 1
    from (
      select
        requested.item_type,
        requested.source_id,
        count(*) as item_count
      from pg_temp.edit_requested_items as requested
      where requested.item_type <> 'custom'
      group by requested.item_type, requested.source_id
    ) as duplicated
    where duplicated.item_count > 1
  ) then
    raise exception 'Duplicate inventory items are not supported in an order edit request.';
  end if;

  for v_record in
    select distinct item_type, source_id
    from (
      select
        case when item_type = 'listing_inventory' then 'inventory' else item_type end as item_type,
        source_id
      from pg_temp.edit_existing_items
      where source_id is not null and item_type <> 'custom'
      union
      select item_type, source_id
      from pg_temp.edit_requested_items
      where source_id is not null and item_type <> 'custom'
    ) as inventory_sources
    order by item_type, source_id
  loop
    if v_record.item_type = 'inventory' then
      perform 1
      from public.inventory_items as inventory_items
      where inventory_items.id = v_record.source_id
        and inventory_items.store_id = v_order.store_id
      for update;
    elsif v_record.item_type = 'equipment_inventory' then
      perform 1
      from public.equipment_inventory_items as equipment_inventory_items
      where equipment_inventory_items.id = v_record.source_id
        and equipment_inventory_items.store_id = v_order.store_id
      for update;
    elsif v_record.item_type = 'processed_poultry_inventory' then
      perform 1
      from public.processed_poultry_inventory_items as processed_items
      where processed_items.id = v_record.source_id
        and processed_items.store_id = v_order.store_id
      for update;
    end if;

    if not found then
      raise exception 'One or more inventory items are not available for this store.';
    end if;
  end loop;

  create temporary table pg_temp.edit_inventory_deltas on commit drop as
  select
    selected_deltas.item_type,
    selected_deltas.source_id,
    sum(selected_deltas.quantity_delta)::integer as quantity_delta
  from (
    select
      requested.item_type,
      requested.source_id,
      case
        when existing.order_item_id is null then requested.quantity
        else requested.quantity - existing.quantity
      end as quantity_delta
    from pg_temp.edit_requested_items as requested
    left join pg_temp.edit_existing_items as existing
      on existing.order_item_id = requested.order_item_id
    where requested.change_inventory = true
      and requested.item_type <> 'custom'
      and requested.source_id is not null
      and (
        existing.order_item_id is null
        or requested.quantity <> existing.quantity
      )

    union all

    select
      case when existing.item_type = 'listing_inventory' then 'inventory' else existing.item_type end as item_type,
      existing.source_id,
      -existing.quantity as quantity_delta
    from pg_temp.edit_removed_items as removed
    join pg_temp.edit_existing_items as existing
      on existing.order_item_id = removed.order_item_id
    where removed.change_inventory = true
      and existing.item_type <> 'custom'
      and existing.source_id is not null
  ) as selected_deltas
  group by selected_deltas.item_type, selected_deltas.source_id
  having sum(selected_deltas.quantity_delta) <> 0;

  for v_record in
    select *
    from pg_temp.edit_inventory_deltas
    order by item_type, source_id
  loop
    if v_record.item_type = 'inventory' then
      select inventory_items.quantity_available
      into v_old_quantity
      from public.inventory_items as inventory_items
      where inventory_items.id = v_record.source_id
        and inventory_items.store_id = v_order.store_id
      for update;

      if v_record.quantity_delta > 0 then
        v_new_quantity := greatest(v_old_quantity - v_record.quantity_delta, 0);
      else
        v_new_quantity := v_old_quantity + abs(v_record.quantity_delta);
      end if;

      update public.inventory_items as inventory_items
      set quantity_available = v_new_quantity
      where inventory_items.id = v_record.source_id
        and inventory_items.store_id = v_order.store_id;
    elsif v_record.item_type = 'equipment_inventory' then
      select equipment_inventory_items.quantity_available
      into v_old_quantity
      from public.equipment_inventory_items as equipment_inventory_items
      where equipment_inventory_items.id = v_record.source_id
        and equipment_inventory_items.store_id = v_order.store_id
      for update;

      if v_record.quantity_delta > 0 then
        v_new_quantity := greatest(v_old_quantity - v_record.quantity_delta, 0);
      else
        v_new_quantity := v_old_quantity + abs(v_record.quantity_delta);
      end if;

      update public.equipment_inventory_items as equipment_inventory_items
      set quantity_available = v_new_quantity
      where equipment_inventory_items.id = v_record.source_id
        and equipment_inventory_items.store_id = v_order.store_id;
    else
      select processed_items.quantity_available
      into v_old_quantity
      from public.processed_poultry_inventory_items as processed_items
      where processed_items.id = v_record.source_id
        and processed_items.store_id = v_order.store_id
      for update;

      if v_record.quantity_delta > 0 then
        v_new_quantity := greatest(v_old_quantity - v_record.quantity_delta, 0);
      else
        v_new_quantity := v_old_quantity + abs(v_record.quantity_delta);
      end if;

      update public.processed_poultry_inventory_items as processed_poultry_inventory_items
      set quantity_available = v_new_quantity
      where processed_poultry_inventory_items.id = v_record.source_id
        and processed_poultry_inventory_items.store_id = v_order.store_id;
    end if;

    v_actual_quantity := abs(v_new_quantity - v_old_quantity);
    v_inventory_changes := v_inventory_changes || jsonb_build_array(
      jsonb_build_object(
        'item_type', v_record.item_type,
        'item_id', v_record.source_id,
        'quantity_delta', v_record.quantity_delta,
        'old_quantity_available', v_old_quantity,
        'new_quantity_available', v_new_quantity,
        'actual_quantity_changed', v_actual_quantity
      )
    );
  end loop;

  update public.order_items as order_items
  set
    quantity = requested.quantity,
    unit_price_snapshot = requested.unit_price,
    line_subtotal = (requested.unit_price * requested.quantity)::numeric(10, 2),
    custom_item_name_snapshot = case
      when requested.item_type = 'custom' then requested.custom_item_name
      else order_items.custom_item_name_snapshot
    end,
    breed_display_name_snapshot = case
      when requested.item_type = 'custom' then requested.custom_item_name
      else order_items.breed_display_name_snapshot
    end
  from pg_temp.edit_requested_items as requested
  where order_items.id = requested.order_item_id
    and order_items.order_id = v_order.id
    and order_items.store_id = v_order.store_id;

  delete from public.order_items as order_items
  where order_items.order_id = v_order.id
    and order_items.store_id = v_order.store_id
    and not exists (
      select 1
      from pg_temp.edit_requested_items as requested
      where requested.order_item_id = order_items.id
    );

  insert into public.order_items (
    order_id,
    store_id,
    inventory_item_id,
    listing_batch_id,
    listing_batch_breed_id,
    seller_breed_profile_id,
    species_id,
    species_name_snapshot,
    species_slug_snapshot,
    breed_display_name_snapshot,
    breed_description_snapshot,
    inventory_type_snapshot,
    custom_inventory_label_snapshot,
    batch_type_snapshot,
    available_date_snapshot,
    age_at_availability_days_snapshot,
    unit_price_snapshot,
    quantity,
    line_subtotal,
    order_item_source
  )
  select
    v_order.id,
    v_order.store_id,
    inventory_items.id,
    listing_batches.id,
    listing_batch_breeds.id,
    seller_breed_profiles.id,
    species.id,
    species.common_name,
    species.slug,
    seller_breed_profiles.display_name,
    seller_breed_profiles.seller_description,
    inventory_items.inventory_type,
    inventory_items.custom_inventory_label,
    listing_batches.batch_type,
    listing_batches.available_date,
    case when listing_batches.batch_type = 'live_animals' then listing_batches.age_at_availability_days else null end,
    requested.unit_price,
    requested.quantity,
    (requested.unit_price * requested.quantity)::numeric(10, 2),
    'listing_inventory'
  from pg_temp.edit_requested_items as requested
  join public.inventory_items as inventory_items
    on inventory_items.id = requested.source_id
   and inventory_items.store_id = v_order.store_id
  join public.listing_batches as listing_batches
    on listing_batches.id = inventory_items.listing_batch_id
   and listing_batches.store_id = v_order.store_id
  join public.listing_batch_breeds as listing_batch_breeds
    on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
   and listing_batch_breeds.store_id = v_order.store_id
  join public.seller_breed_profiles as seller_breed_profiles
    on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
   and seller_breed_profiles.store_id = v_order.store_id
  join public.species as species
    on species.id = listing_batches.species_id
  where requested.order_item_id is null
    and requested.item_type = 'inventory'
  order by requested.line_number;

  insert into public.order_items (
    order_id,
    store_id,
    equipment_inventory_item_id,
    species_name_snapshot,
    species_slug_snapshot,
    breed_display_name_snapshot,
    breed_description_snapshot,
    inventory_type_snapshot,
    custom_inventory_label_snapshot,
    batch_type_snapshot,
    product_type_snapshot,
    item_name_snapshot,
    item_category_snapshot,
    unit_price_snapshot,
    quantity,
    line_subtotal,
    order_item_source
  )
  select
    v_order.id,
    v_order.store_id,
    equipment_inventory_items.id,
    'Equipment & Supplies',
    'equipment-supplies',
    equipment_inventory_items.item_name,
    equipment_inventory_items.description,
    'equipment_supplies',
    equipment_inventory_items.condition,
    'equipment_supplies',
    'equipment_supplies',
    equipment_inventory_items.item_name,
    equipment_inventory_items.category,
    requested.unit_price,
    requested.quantity,
    (requested.unit_price * requested.quantity)::numeric(10, 2),
    'equipment_inventory'
  from pg_temp.edit_requested_items as requested
  join public.equipment_inventory_items as equipment_inventory_items
    on equipment_inventory_items.id = requested.source_id
   and equipment_inventory_items.store_id = v_order.store_id
  where requested.order_item_id is null
    and requested.item_type = 'equipment_inventory'
  order by requested.line_number;

  insert into public.order_items (
    order_id,
    store_id,
    processed_poultry_inventory_item_id,
    species_name_snapshot,
    species_slug_snapshot,
    breed_display_name_snapshot,
    breed_description_snapshot,
    inventory_type_snapshot,
    custom_inventory_label_snapshot,
    batch_type_snapshot,
    product_type_snapshot,
    item_name_snapshot,
    item_category_snapshot,
    unit_price_snapshot,
    quantity,
    line_subtotal,
    order_item_source
  )
  select
    v_order.id,
    v_order.store_id,
    processed_items.id,
    processed_items.poultry_type,
    lower(replace(processed_items.poultry_type, ' ', '-')),
    processed_items.product_name,
    processed_items.description,
    'processed_poultry',
    concat_ws(' - ', processed_items.product_type, processed_items.package_size),
    'processed_poultry',
    'processed_poultry',
    processed_items.product_name,
    processed_items.poultry_type,
    requested.unit_price,
    requested.quantity,
    (requested.unit_price * requested.quantity)::numeric(10, 2),
    'processed_poultry_inventory'
  from pg_temp.edit_requested_items as requested
  join public.processed_poultry_inventory_items as processed_items
    on processed_items.id = requested.source_id
   and processed_items.store_id = v_order.store_id
  where requested.order_item_id is null
    and requested.item_type = 'processed_poultry_inventory'
  order by requested.line_number;

  insert into public.order_items (
    order_id,
    store_id,
    species_name_snapshot,
    species_slug_snapshot,
    breed_display_name_snapshot,
    inventory_type_snapshot,
    custom_inventory_label_snapshot,
    batch_type_snapshot,
    unit_price_snapshot,
    quantity,
    line_subtotal,
    order_item_source,
    custom_item_name_snapshot
  )
  select
    v_order.id,
    v_order.store_id,
    'Custom item',
    'custom',
    requested.custom_item_name,
    'other',
    'Custom',
    'custom',
    requested.unit_price,
    requested.quantity,
    (requested.unit_price * requested.quantity)::numeric(10, 2),
    'custom',
    requested.custom_item_name
  from pg_temp.edit_requested_items as requested
  where requested.order_item_id is null
    and requested.item_type = 'custom'
  order by requested.line_number;

  select coalesce(sum(order_items.line_subtotal), 0)::numeric(10, 2)
  into v_subtotal_amount
  from public.order_items as order_items
  where order_items.order_id = v_order.id
    and order_items.store_id = v_order.store_id;

  v_tax_fee_amount := coalesce(p_tax_fee_amount, v_order.tax_fee_amount, 0)::numeric(10, 2);
  if v_tax_fee_amount < 0 then raise exception 'Tax or fee amount cannot be negative.'; end if;

  v_total_amount := (v_subtotal_amount + v_tax_fee_amount + v_delivery_fee_amount)::numeric(10, 2);
  v_original_subtotal_amount := v_order.subtotal_amount;
  v_original_total_amount := v_order.total_amount;
  v_fulfillment_changed := coalesce(v_order.fulfillment_method, 'pickup') <> v_fulfillment_method;

  select coalesce(jsonb_agg(jsonb_build_object(
    'line_number', requested.line_number,
    'item_type', requested.item_type,
    'item_id', requested.source_id,
    'custom_item_name', requested.custom_item_name,
    'quantity', requested.quantity
  ) order by requested.line_number), '[]'::jsonb)
  into v_added_lines
  from pg_temp.edit_requested_items as requested
  where requested.order_item_id is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'order_item_id', existing.order_item_id,
    'item_type', existing.item_type,
    'item_id', existing.source_id,
    'label', existing.label,
    'quantity', existing.quantity
  ) order by existing.order_item_id), '[]'::jsonb)
  into v_removed_lines
  from pg_temp.edit_existing_items as existing
  where not exists (
    select 1
    from pg_temp.edit_requested_items as requested
    where requested.order_item_id = existing.order_item_id
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'order_item_id', existing.order_item_id,
    'item_type', existing.item_type,
    'item_id', existing.source_id,
    'label', existing.label,
    'old_quantity', existing.quantity,
    'new_quantity', requested.quantity
  ) order by requested.line_number), '[]'::jsonb)
  into v_quantity_changes
  from pg_temp.edit_existing_items as existing
  join pg_temp.edit_requested_items as requested
    on requested.order_item_id = existing.order_item_id
  where existing.quantity <> requested.quantity;

  update public.orders
  set
    customer_id = p_customer_id,
    buyer_email_snapshot = v_customer_email,
    buyer_first_name_snapshot = v_customer_first_name,
    buyer_last_name_snapshot = v_customer_last_name,
    buyer_phone_snapshot = v_customer_phone,
    buyer_address_line1_snapshot = case when v_fulfillment_method = 'delivery' then v_delivery_address_line1 else null end,
    buyer_address_line2_snapshot = case when v_fulfillment_method = 'delivery' then v_delivery_address_line2 else null end,
    buyer_city_snapshot = case when v_fulfillment_method = 'delivery' then v_delivery_city else null end,
    buyer_state_snapshot = case when v_fulfillment_method = 'delivery' then v_delivery_state else null end,
    buyer_postal_code_snapshot = case when v_fulfillment_method = 'delivery' then v_delivery_postal_code else null end,
    buyer_country_snapshot = case when v_fulfillment_method = 'delivery' then v_delivery_country else null end,
    buyer_notes = v_buyer_notes,
    pickup_note = case when v_fulfillment_method = 'pickup' then v_pickup_note else null end,
    pickup_option_id = case when v_fulfillment_method = 'pickup' then p_pickup_option_id else null end,
    pickup_option_label_snapshot = case when v_fulfillment_method = 'pickup' then v_pickup_option_label_snapshot else null end,
    fulfillment_method = v_fulfillment_method,
    delivery_option_name_snapshot = case when v_fulfillment_method = 'delivery' then v_delivery_option_name_snapshot else null end,
    delivery_fee_amount = case when v_fulfillment_method = 'delivery' then v_delivery_fee_amount else 0 end,
    subtotal_amount = v_subtotal_amount,
    tax_fee_amount = v_tax_fee_amount,
    total_amount = v_total_amount,
    updated_at = now()
  where orders.id = v_order.id
    and orders.store_id = v_order.store_id
  returning orders.updated_at into updated_at;

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
    'order_edited',
    v_order.order_status,
    v_order.order_status,
    v_order.payment_status,
    v_order.payment_status,
    'Order edited',
    jsonb_build_object(
      'edited_by', auth.uid(),
      'original_total', v_original_total_amount,
      'revised_total', v_total_amount,
      'original_subtotal', v_original_subtotal_amount,
      'revised_subtotal', v_subtotal_amount,
      'inventory_change_requested', exists (select 1 from pg_temp.edit_inventory_deltas),
      'inventory_changes', v_inventory_changes,
      'added_lines', v_added_lines,
      'removed_lines', v_removed_lines,
      'quantity_changes', v_quantity_changes,
      'fulfillment_method_changed', v_fulfillment_changed,
      'from_fulfillment_method', coalesce(v_order.fulfillment_method, 'pickup'),
      'to_fulfillment_method', v_fulfillment_method,
      'edited_at', now()
    )
  );

  order_id := v_order.id;
  order_number := v_order.order_number;
  store_id := v_order.store_id;
  original_subtotal_amount := v_original_subtotal_amount;
  original_total_amount := v_original_total_amount;
  revised_subtotal_amount := v_subtotal_amount;
  revised_tax_fee_amount := v_tax_fee_amount;
  revised_delivery_fee_amount := v_delivery_fee_amount;
  revised_total_amount := v_total_amount;
  inventory_changed := exists (select 1 from pg_temp.edit_inventory_deltas);

  return next;
end;
$$;

comment on function public.seller_edit_order(
  uuid,
  jsonb,
  jsonb,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  text,
  uuid,
  text,
  numeric,
  text,
  text,
  text,
  text,
  text,
  text,
  numeric
) is
'Seller RPC for editing an eligible unfulfilled, non-canceled order and optionally applying grouped inventory deltas in the same transaction.';

revoke all on function public.seller_edit_order(
  uuid,
  jsonb,
  jsonb,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  text,
  uuid,
  text,
  numeric,
  text,
  text,
  text,
  text,
  text,
  text,
  numeric
) from public;

grant execute on function public.seller_edit_order(
  uuid,
  jsonb,
  jsonb,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  text,
  uuid,
  text,
  numeric,
  text,
  text,
  text,
  text,
  text,
  text,
  numeric
) to authenticated;

commit;


