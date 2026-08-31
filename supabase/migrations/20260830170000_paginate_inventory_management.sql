-- Bounded Inventory Management data with complete status-scoped summaries.
-- Reservation quantities preserve seller_order_item_detail semantics while
-- aggregating every matching order item inside PostgreSQL.

create or replace function public.seller_get_inventory_management_page(
  p_store_id uuid,
  p_category text,
  p_availability text default 'current_inventory',
  p_species text default 'all',
  p_type_sex text default 'all',
  p_age text default 'all',
  p_breed text default 'all',
  p_product_category text default 'all',
  p_equipment_category text default 'all',
  p_condition text default 'all',
  p_search text default null,
  p_sort text default 'name',
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_category text := lower(trim(coalesce(p_category, '')));
  v_availability text := lower(trim(coalesce(p_availability, 'current_inventory')));
  v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if p_store_id is null then
    raise exception 'store_required' using errcode = '22023';
  end if;

  if not public.owns_store(p_store_id) and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_category not in ('live_poultry', 'hatching_eggs', 'processed_poultry', 'equipment') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;

  if v_availability not in ('current_inventory', 'available_now', 'coming_soon', 'sold_out', 'hidden', 'archived') then
    raise exception 'invalid_availability' using errcode = '22023';
  end if;

  return (
    with reservation_totals as materialized (
      select 'live_poultry'::text as category, details.inventory_item_id as item_id,
        sum(greatest(coalesce(details.remaining_unfulfilled_quantity, 0), 0))::bigint as reserved_quantity
      from public.seller_order_item_detail details
      where v_category = 'live_poultry'
        and details.store_id = p_store_id and details.inventory_item_id is not null
      group by details.inventory_item_id
      union all
      select 'equipment', details.equipment_inventory_item_id,
        sum(greatest(coalesce(details.remaining_unfulfilled_quantity, 0), 0))::bigint
      from public.seller_order_item_detail details
      where v_category = 'equipment'
        and details.store_id = p_store_id and details.equipment_inventory_item_id is not null
      group by details.equipment_inventory_item_id
      union all
      select 'processed_poultry', details.processed_poultry_inventory_item_id,
        sum(greatest(coalesce(details.remaining_unfulfilled_quantity, 0), 0))::bigint
      from public.seller_order_item_detail details
      where v_category = 'processed_poultry'
        and details.store_id = p_store_id and details.processed_poultry_inventory_item_id is not null
      group by details.processed_poultry_inventory_item_id
    ),
    live_facts as (
      select
        'live_poultry'::text as category,
        inventory.inventory_item_id as item_id,
        jsonb_build_object(
          'store_id', inventory.store_id,
          'listing_batch_id', inventory.listing_batch_id,
          'listing_batch_breed_id', inventory.listing_batch_breed_id,
          'inventory_item_id', inventory.inventory_item_id,
          'species_name', inventory.species_name,
          'species_slug', inventory.species_slug,
          'breed_display_name', inventory.breed_display_name,
          'batch_type', inventory.batch_type,
          'origin_date', inventory.origin_date,
          'available_date', inventory.available_date,
          'quantity_available', inventory.quantity_available,
          'inventory_type', inventory.inventory_type,
          'custom_inventory_label', inventory.custom_inventory_label,
          'effective_unit_price', inventory.effective_unit_price,
          'price_override', inventory.price_override,
          'inventory_item_sort_order', inventory.inventory_item_sort_order,
          'inventory_visibility_status', inventory.inventory_visibility_status,
          'inventory_moderation_status', inventory.inventory_moderation_status,
          'listing_batch_breed_visibility_status', inventory.listing_batch_breed_visibility_status,
          'listing_batch_visibility_status', inventory.listing_batch_visibility_status,
          'listing_batch_moderation_status', inventory.listing_batch_moderation_status,
          'operational_availability_status', inventory.operational_availability_status,
          'inventory_seller_notes', inventory.inventory_seller_notes,
          'internal_batch_label', inventory.internal_batch_label,
          'archived_at', inventory.archived_at,
          'inventory_updated_at', inventory.inventory_updated_at
        ) as raw_row,
        inventory.species_slug as species_value,
        inventory.species_name as species_label,
        inventory.inventory_type || ':' || coalesce(inventory.custom_inventory_label, '') as type_value,
        case
          when inventory.inventory_type = 'other' and inventory.custom_inventory_label is not null then inventory.custom_inventory_label
          when inventory.inventory_type = 'female' then 'Female'
          when inventory.inventory_type = 'male' then 'Male'
          when inventory.inventory_type in ('straight_run', 'unsexed') then 'Straight Run'
          when inventory.inventory_type = 'pair' then 'Pair'
          when inventory.inventory_type = 'trio' then 'Trio'
          else replace(inventory.inventory_type, '_', ' ')
        end as type_label,
        inventory.breed_display_name as breed_value,
        null::text as product_category,
        null::text as equipment_category,
        null::text as condition_value,
        case
          when inventory.listing_batch_visibility_status = 'archived'
            or inventory.listing_batch_breed_visibility_status = 'archived'
            or inventory.inventory_visibility_status = 'archived' then 'archived'
          when inventory.inventory_visibility_status = 'hidden'
            or inventory.listing_batch_visibility_status = 'hidden'
            or inventory.listing_batch_breed_visibility_status = 'hidden'
            or inventory.operational_availability_status in ('hidden', 'unavailable') then 'hidden'
          when inventory.operational_availability_status = 'sold_out'
            or coalesce(inventory.quantity_available, 0) <= 0 then 'sold_out'
          when inventory.listing_batch_visibility_status <> 'active'
            or inventory.listing_batch_breed_visibility_status <> 'active'
            or inventory.inventory_visibility_status <> 'active' then 'hidden'
          when inventory.available_date > current_date then 'coming_soon'
          else 'available_now'
        end as availability_value,
        lower(concat_ws(' ', inventory.breed_display_name, inventory.species_name,
          inventory.inventory_type, inventory.custom_inventory_label,
          inventory.operational_availability_status)) as search_text,
        inventory.origin_date as hatch_date,
        case when inventory.origin_date is null or inventory.available_date is null then null
          else inventory.available_date - inventory.origin_date end::integer as age_days,
        coalesce(inventory.quantity_available, 0)::bigint as available_quantity,
        coalesce(reservations.reserved_quantity, 0)::bigint as reserved_quantity,
        inventory.effective_unit_price::numeric as price,
        inventory.inventory_updated_at as updated_at,
        inventory.breed_display_name as sort_name
      from public.seller_inventory_management inventory
      left join reservation_totals reservations
        on reservations.category = 'live_poultry' and reservations.item_id = inventory.inventory_item_id
      where inventory.store_id = p_store_id
        and inventory.batch_type is distinct from 'hatching_eggs'
        and inventory.inventory_type is distinct from 'hatching_eggs'
        and inventory.inventory_moderation_status = 'normal'
        and inventory.listing_batch_moderation_status = 'normal'
    ),
    hatching_facts as (
      select
        'hatching_eggs'::text,
        inventory.hatching_egg_inventory_item_id,
        jsonb_build_object(
          'hatching_egg_inventory_item_id', inventory.hatching_egg_inventory_item_id,
          'hatching_egg_product_id', inventory.hatching_egg_product_id,
          'store_id', inventory.store_id,
          'item_name', inventory.item_name,
          'species_id', inventory.species_id,
          'species_name', inventory.species_name,
          'species_slug', inventory.species_slug,
          'description', inventory.description,
          'quantity_available', inventory.quantity_available,
          'price', inventory.price,
          'available_date', inventory.available_date,
          'minimum_order_quantity', inventory.minimum_order_quantity,
          'visibility_status', inventory.visibility_status,
          'moderation_status', inventory.moderation_status,
          'operational_availability_status', inventory.operational_availability_status,
          'seller_notes', inventory.seller_notes,
          'first_published_at', inventory.first_published_at,
          'archived_at', inventory.archived_at,
          'created_at', inventory.created_at,
          'updated_at', inventory.updated_at
        ),
        inventory.species_slug, inventory.species_name,
        null::text, null::text, inventory.item_name,
        null::text, null::text, null::text,
        case
          when inventory.visibility_status = 'archived' then 'archived'
          when inventory.visibility_status = 'hidden' then 'hidden'
          when inventory.visibility_status = 'sold_out'
            or inventory.operational_availability_status = 'sold_out'
            or inventory.quantity_available <= 0 then 'sold_out'
          when inventory.visibility_status <> 'active' then 'hidden'
          when inventory.available_date > current_date then 'coming_soon'
          else 'available_now'
        end,
        lower(concat_ws(' ', inventory.item_name, inventory.species_name,
          inventory.description, inventory.operational_availability_status)),
        null::date, null::integer,
        inventory.quantity_available::bigint, 0::bigint, inventory.price::numeric,
        inventory.updated_at, inventory.item_name
      from public.seller_hatching_egg_inventory_management inventory
      where inventory.store_id = p_store_id and inventory.moderation_status = 'normal'
    ),
    processed_facts as (
      select
        'processed_poultry'::text,
        inventory.processed_poultry_inventory_item_id,
        jsonb_build_object(
          'processed_poultry_inventory_item_id', inventory.processed_poultry_inventory_item_id,
          'store_id', inventory.store_id,
          'product_name', inventory.product_name,
          'poultry_type', inventory.poultry_type,
          'product_type', inventory.product_type,
          'package_size', inventory.package_size,
          'description', inventory.description,
          'available_date', inventory.available_date,
          'quantity_available', inventory.quantity_available,
          'price', inventory.price,
          'visibility_status', inventory.visibility_status,
          'moderation_status', inventory.moderation_status,
          'operational_availability_status', inventory.operational_availability_status,
          'seller_notes', inventory.seller_notes,
          'first_published_at', inventory.first_published_at,
          'archived_at', inventory.archived_at,
          'created_at', inventory.created_at,
          'updated_at', inventory.updated_at
        ),
        'processed_poultry'::text, 'Poultry Products'::text,
        null::text, null::text, inventory.product_name,
        inventory.product_type, null::text, null::text,
        case
          when inventory.visibility_status = 'archived' then 'archived'
          when inventory.visibility_status = 'hidden' then 'hidden'
          when inventory.operational_availability_status = 'sold_out' or inventory.quantity_available <= 0 then 'sold_out'
          when inventory.visibility_status <> 'active' then 'hidden'
          when inventory.available_date > current_date then 'coming_soon'
          else 'available_now'
        end,
        lower(concat_ws(' ', inventory.product_name, inventory.poultry_type,
          inventory.product_type, inventory.package_size, inventory.description,
          inventory.operational_availability_status)),
        null::date, null::integer,
        inventory.quantity_available::bigint,
        coalesce(reservations.reserved_quantity, 0)::bigint,
        inventory.price::numeric, inventory.updated_at, inventory.product_name
      from public.seller_processed_poultry_inventory_management inventory
      left join reservation_totals reservations
        on reservations.category = 'processed_poultry'
       and reservations.item_id = inventory.processed_poultry_inventory_item_id
      where inventory.store_id = p_store_id and inventory.moderation_status = 'normal'
    ),
    equipment_facts as (
      select
        'equipment'::text,
        inventory.equipment_inventory_item_id,
        jsonb_build_object(
          'equipment_inventory_item_id', inventory.equipment_inventory_item_id,
          'store_id', inventory.store_id,
          'item_name', inventory.item_name,
          'category', inventory.category,
          'condition', inventory.condition,
          'description', inventory.description,
          'available_date', inventory.available_date,
          'quantity_available', inventory.quantity_available,
          'price', inventory.price,
          'visibility_status', inventory.visibility_status,
          'moderation_status', inventory.moderation_status,
          'operational_availability_status', inventory.operational_availability_status,
          'seller_notes', inventory.seller_notes,
          'first_published_at', inventory.first_published_at,
          'archived_at', inventory.archived_at,
          'created_at', inventory.created_at,
          'updated_at', inventory.updated_at
        ),
        'equipment'::text, 'Equipment'::text,
        null::text, null::text, inventory.item_name,
        null::text, inventory.category, inventory.condition,
        case
          when inventory.visibility_status = 'archived' then 'archived'
          when inventory.visibility_status = 'hidden' then 'hidden'
          when inventory.operational_availability_status = 'sold_out' or inventory.quantity_available <= 0 then 'sold_out'
          when inventory.visibility_status <> 'active' then 'hidden'
          when inventory.available_date > current_date then 'coming_soon'
          else 'available_now'
        end,
        lower(concat_ws(' ', inventory.item_name, inventory.category,
          inventory.condition, inventory.description, inventory.operational_availability_status)),
        null::date, null::integer,
        inventory.quantity_available::bigint,
        coalesce(reservations.reserved_quantity, 0)::bigint,
        inventory.price::numeric, inventory.updated_at, inventory.item_name
      from public.seller_equipment_inventory_management inventory
      left join reservation_totals reservations
        on reservations.category = 'equipment'
       and reservations.item_id = inventory.equipment_inventory_item_id
      where inventory.store_id = p_store_id and inventory.moderation_status = 'normal'
    ),
    facts as materialized (
      select * from live_facts where v_category = 'live_poultry'
      union all select * from hatching_facts where v_category = 'hatching_eggs'
      union all select * from processed_facts where v_category = 'processed_poultry'
      union all select * from equipment_facts where v_category = 'equipment'
    ),
    status_scope as materialized (
      select * from facts
      where case
        when v_availability = 'archived' then availability_value = 'archived'
        when v_availability = 'current_inventory' then availability_value <> 'archived'
        else availability_value <> 'archived' and availability_value = v_availability
      end
    ),
    filtered as materialized (
      select * from status_scope
      where (coalesce(p_species, 'all') = 'all' or species_value = p_species)
        and (coalesce(p_type_sex, 'all') = 'all' or type_value = p_type_sex)
        and (coalesce(p_breed, 'all') = 'all' or breed_value = p_breed)
        and (coalesce(p_product_category, 'all') = 'all' or product_category = p_product_category)
        and (coalesce(p_equipment_category, 'all') = 'all' or equipment_category = p_equipment_category)
        and (coalesce(p_condition, 'all') = 'all' or condition_value = p_condition)
        and (
          coalesce(p_age, 'all') = 'all'
          or (p_age = 'unknown' and age_days is null)
          or (p_age = '0_6' and floor(age_days / 7.0) <= 6)
          or (p_age = '7_12' and floor(age_days / 7.0) between 7 and 12)
          or (p_age = '13_24' and floor(age_days / 7.0) between 13 and 24)
          or (p_age = '25_plus' and floor(age_days / 7.0) >= 25)
        )
        and (v_search is null or position(v_search in search_text) > 0)
    ),
    page as materialized (
      select * from filtered
      order by
        case when p_sort = 'hatch_date' then hatch_date end asc nulls last,
        case when p_sort in ('name', 'breed', 'product_name', 'item_name') then lower(sort_name) end asc,
        case when p_sort = 'age' then age_days end asc nulls last,
        case when p_sort = 'available' then available_quantity end desc,
        case when p_sort = 'reserved' then reserved_quantity end desc,
        case when p_sort = 'price' then price end asc nulls last,
        case when p_sort = 'recently_added' then updated_at end desc nulls last,
        case when p_sort = 'availability' then
          case availability_value
            when 'archived' then 'Archived'
            when 'hidden' then case
              when coalesce((raw_row ->> 'is_unfinished_add_v2_draft')::boolean, false)
                then 'Draft'
              else 'Hidden'
            end
            when 'coming_soon' then 'Ready ' || to_char((raw_row ->> 'available_date')::date, 'FMMon FMDD')
            when 'available_now' then 'Ready now'
            when 'sold_out' then 'Sold out'
          end
        end asc,
        lower(species_label), lower(sort_name), item_id
      offset v_offset limit v_limit
    ),
    page_with_media as (
      select
        page.*,
        case when page.category = 'live_poultry' then page.raw_row || jsonb_build_object(
          'has_published_activity', publication.has_published_activity,
          'is_unfinished_add_v2_draft',
            page.raw_row ->> 'listing_batch_visibility_status' = 'hidden'
            and page.raw_row ->> 'internal_batch_label' = '__add_inventory_v2_live_birds__'
            and not publication.has_published_activity
        ) else page.raw_row end as display_row,
        case when page.category = 'hatching_eggs' then (
          select jsonb_build_object('url', media.public_url, 'alt', coalesce(media.alt_text, ''))
          from public.seller_media_management media
          where media.store_id = p_store_id
            and media.entity_type = 'hatching_egg_inventory_item'
            and media.entity_id = page.item_id
            and media.display_context = 'gallery'
            and media.visibility_status = 'active'
            and media.moderation_status = 'normal'
            and media.public_url is not null
          order by media.is_featured desc, media.sort_order asc, media.media_link_id
          limit 1
        ) else null end as primary_photo
      from page
      left join lateral (
        select exists (
          select 1 from public.order_items
          where order_items.listing_batch_id = (page.raw_row ->> 'listing_batch_id')::uuid
        ) or exists (
          select 1 from public.inventory_activity_events
          where inventory_activity_events.listing_batch_id = (page.raw_row ->> 'listing_batch_id')::uuid
            and inventory_activity_events.event_type in ('listing_batch_created', 'listing_batch_visibility_changed')
            and (
              inventory_activity_events.from_visibility_status in ('active', 'sold_out')
              or inventory_activity_events.to_visibility_status in ('active', 'sold_out')
            )
        ) as has_published_activity
      ) publication on page.category = 'live_poultry'
    )
    select jsonb_build_object(
      'category', v_category,
      'category_count', (select count(*) from facts),
      'total_count', (select count(*) from filtered),
      'summary', jsonb_build_object(
        'available_quantity', coalesce((select sum(available_quantity) from status_scope), 0),
        'reserved_quantity', coalesce((select sum(reserved_quantity) from status_scope), 0),
        'inventory_value', coalesce((select sum(available_quantity * coalesce(price, 0)) from status_scope), 0)
      ),
      'options', jsonb_build_object(
        'species', coalesce((select jsonb_agg(jsonb_build_object('value', species_value, 'label', species_label) order by species_label) from (select distinct species_value, species_label from status_scope where species_value is not null) values_for_species), '[]'::jsonb),
        'type_sex', coalesce((select jsonb_agg(jsonb_build_object('value', type_value, 'label', type_label) order by type_label) from (select distinct type_value, type_label from status_scope where type_value is not null) values_for_types), '[]'::jsonb),
        'breed', coalesce((select jsonb_agg(jsonb_build_object('value', breed_value, 'label', breed_value) order by breed_value) from (select distinct breed_value from status_scope where breed_value is not null) values_for_breeds), '[]'::jsonb),
        'product_category', coalesce((select jsonb_agg(jsonb_build_object('value', product_category, 'label', product_category) order by product_category) from (select distinct product_category from status_scope where product_category is not null) values_for_products), '[]'::jsonb),
        'equipment_category', coalesce((select jsonb_agg(jsonb_build_object('value', equipment_category, 'label', equipment_category) order by equipment_category) from (select distinct equipment_category from status_scope where equipment_category is not null) values_for_equipment), '[]'::jsonb),
        'condition', coalesce((select jsonb_agg(jsonb_build_object('value', condition_value, 'label', condition_value) order by condition_value) from (select distinct condition_value from status_scope where condition_value is not null and condition_value <> '') values_for_conditions), '[]'::jsonb)
      ),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'row', display_row,
        'reserved_quantity', reserved_quantity,
        'primary_photo', primary_photo
      ) order by
        case when p_sort = 'hatch_date' then hatch_date end asc nulls last,
        case when p_sort in ('name', 'breed', 'product_name', 'item_name') then lower(sort_name) end asc,
        case when p_sort = 'age' then age_days end asc nulls last,
        case when p_sort = 'available' then available_quantity end desc,
        case when p_sort = 'reserved' then reserved_quantity end desc,
        case when p_sort = 'price' then price end asc nulls last,
        case when p_sort = 'recently_added' then updated_at end desc nulls last,
        case when p_sort = 'availability' then
          case availability_value
            when 'archived' then 'Archived'
            when 'hidden' then case
              when coalesce((raw_row ->> 'is_unfinished_add_v2_draft')::boolean, false)
                then 'Draft'
              else 'Hidden'
            end
            when 'coming_soon' then 'Ready ' || to_char((raw_row ->> 'available_date')::date, 'FMMon FMDD')
            when 'available_now' then 'Ready now'
            when 'sold_out' then 'Sold out'
          end
        end asc,
        lower(species_label), lower(sort_name), item_id
      ) from page_with_media), '[]'::jsonb)
    )
  );
end;
$$;

comment on function public.seller_get_inventory_management_page(uuid, text, text, text, text, text, text, text, text, text, text, text, integer, integer) is
'Returns one bounded Inventory Management page, complete status-scoped totals, full-dataset filter options, and page-only media. Reservations use all qualifying order items.';

revoke all on function public.seller_get_inventory_management_page(uuid, text, text, text, text, text, text, text, text, text, text, text, integer, integer) from public;
grant execute on function public.seller_get_inventory_management_page(uuid, text, text, text, text, text, text, text, text, text, text, text, integer, integer) to authenticated;
