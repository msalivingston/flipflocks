-- Group 28: Public Storefront / Checkout API Support Layer
--
-- Scope:
-- - Adds buyer-facing read projections for storefront home, inventory, and item detail.
-- - Adds public-safe RPCs for storefront slug lookup and checkout summary.
-- - Reuses existing public storefront projections and trusted checkout/order RPCs.
-- - Keeps order creation, payment creation, and inventory mutation in existing trusted functions.
--
-- This group does not add:
-- - new order creation logic
-- - marketplace discovery/search features
-- - buyer accounts
-- - messaging/reviews
-- - payment/refund business logic
-- - seller dashboard or admin APIs


create index if not exists stores_public_slug_availability_idx
on public.stores(store_slug, storefront_enabled, store_status, storefront_mode)
where admin_hold_reason is null;

create index if not exists inventory_items_public_store_item_idx
on public.inventory_items(store_id, id)
where visibility_status = 'active'
  and moderation_status = 'normal';


-- Group 28 intentionally owns the following public API views/RPCs. The base
-- inventory view may exist from a failed draft or legacy prototype shape, so it
-- must be dropped before recreation when column names change.
drop function if exists public.get_public_checkout_summary(text, jsonb);
drop function if exists public.get_public_storefront_by_slug(text);
drop view if exists public.public_storefront_item_detail;
drop view if exists public.public_storefront_home;
drop view if exists public.public_storefront_inventory;


create or replace view public.public_storefront_inventory
with (security_barrier = true)
as
select
  public_storefront_breed_inventory.store_id,
  public_storefront_breed_inventory.store_slug,
  public_storefront_breed_inventory.species_id,
  public_storefront_breed_inventory.species_name,
  public_storefront_breed_inventory.species_slug,
  public_storefront_breed_inventory.seller_breed_profile_id,
  public_storefront_breed_inventory.breed_display_name,
  public_storefront_breed_inventory.breed_description,
  public_storefront_breed_inventory.listing_batch_id,
  public_storefront_breed_inventory.listing_batch_breed_id,
  public_storefront_breed_inventory.inventory_item_id,
  public_storefront_breed_inventory.inventory_type,
  public_storefront_breed_inventory.custom_inventory_label,
  public_storefront_breed_inventory.quantity_available,
  case
    when public_storefront_breed_inventory.quantity_available <= 0
      or public_storefront_breed_inventory.availability_status = 'sold_out'
      then 'sold_out'
    when public_storefront_breed_inventory.available_date > current_date
      then 'reserve_now'
    else 'ready_now'
  end as buyer_availability_code,
  case
    when public_storefront_breed_inventory.quantity_available <= 0
      or public_storefront_breed_inventory.availability_status = 'sold_out'
      then 'Sold out'
    when public_storefront_breed_inventory.available_date > current_date
      then 'Reserve now'
    else 'Ready now'
  end as buyer_availability_label,
  public_storefront_breed_inventory.available_date,
  public_storefront_breed_inventory.is_available_now,
  (
    public_storefront_breed_inventory.quantity_available > 0
    and public_storefront_breed_inventory.availability_status <> 'sold_out'
  ) as can_checkout,
  public_storefront_breed_inventory.unit_price,
  public_storefront_breed_inventory.featured_image_url,
  public_storefront_breed_inventory.featured_image_alt_text,
  public_storefront_breed_inventory.breed_sort_order,
  public_storefront_breed_inventory.inventory_sort_order
from public.public_storefront_breed_inventory;

comment on view public.public_storefront_inventory is
'Buyer-facing storefront inventory projection for V1 UI. Reuses the official public storefront inventory layer, exposes only public-safe fields, and translates availability to the approved buyer labels: Ready now, Reserve now, and Sold out.';


create or replace view public.public_storefront_home
with (security_barrier = true)
as
with inventory_summary as (
  select
    public_storefront_inventory.store_id,
    count(*) as public_inventory_item_count,
    count(*) filter (
      where public_storefront_inventory.buyer_availability_code = 'ready_now'
    ) as ready_now_item_count,
    count(*) filter (
      where public_storefront_inventory.buyer_availability_code = 'reserve_now'
    ) as reserve_now_item_count,
    count(*) filter (
      where public_storefront_inventory.buyer_availability_code = 'sold_out'
    ) as sold_out_item_count,
    coalesce(sum(public_storefront_inventory.quantity_available), 0) as total_quantity_available,
    min(public_storefront_inventory.available_date) filter (
      where public_storefront_inventory.quantity_available > 0
    ) as next_available_date
  from public.public_storefront_inventory
  group by public_storefront_inventory.store_id
)
select
  public_storefronts.store_id,
  public_storefronts.store_slug,
  public_storefronts.store_name,
  public_storefronts.store_tagline,
  public_storefronts.public_city,
  public_storefronts.public_state,
  public_storefronts.public_country,
  public_storefronts.about_text,
  public_storefronts.pickup_policy,
  public_storefronts.cancellation_policy,
  public_storefronts.pickup_instructions,
  public_storefronts.public_email,
  public_storefronts.public_phone,
  public_storefronts.website_url,
  public_storefronts.social_url,
  public_storefronts.npip_number,
  public_storefronts.hero_image_url,
  public_storefronts.hero_image_alt_text,
  public_storefronts.logo_image_url,
  public_storefronts.logo_image_alt_text,
  coalesce(inventory_summary.public_inventory_item_count, 0) as public_inventory_item_count,
  coalesce(inventory_summary.ready_now_item_count, 0) as ready_now_item_count,
  coalesce(inventory_summary.reserve_now_item_count, 0) as reserve_now_item_count,
  coalesce(inventory_summary.sold_out_item_count, 0) as sold_out_item_count,
  coalesce(inventory_summary.total_quantity_available, 0) as total_quantity_available,
  inventory_summary.next_available_date,
  (
    coalesce(inventory_summary.public_inventory_item_count, 0) > 0
  ) as has_public_inventory
from public.public_storefronts
left join inventory_summary
  on inventory_summary.store_id = public_storefronts.store_id;

comment on view public.public_storefront_home is
'Buyer-facing storefront home projection by public slug. Includes public-safe storefront profile fields and small inventory counts so the UI can distinguish an unavailable store from a live store with no inventory.';


create or replace view public.public_storefront_item_detail
with (security_barrier = true)
as
select
  public_storefront_inventory.store_id,
  public_storefront_inventory.store_slug,
  public_storefronts.store_name,
  public_storefronts.pickup_policy,
  public_storefronts.cancellation_policy,
  public_storefronts.pickup_instructions,
  public_storefront_inventory.species_id,
  public_storefront_inventory.species_name,
  public_storefront_inventory.species_slug,
  public_storefront_inventory.seller_breed_profile_id,
  public_storefront_inventory.breed_display_name,
  public_storefront_inventory.breed_description,
  public_storefront_inventory.listing_batch_id,
  public_storefront_inventory.listing_batch_breed_id,
  public_storefront_inventory.inventory_item_id,
  public_storefront_inventory.inventory_type,
  public_storefront_inventory.custom_inventory_label,
  public_storefront_inventory.quantity_available,
  public_storefront_inventory.buyer_availability_code,
  public_storefront_inventory.buyer_availability_label,
  public_storefront_inventory.available_date,
  public_storefront_inventory.is_available_now,
  public_storefront_inventory.can_checkout,
  public_storefront_inventory.unit_price,
  public_storefront_inventory.featured_image_url,
  public_storefront_inventory.featured_image_alt_text
from public.public_storefront_inventory
join public.public_storefronts
  on public_storefronts.store_id = public_storefront_inventory.store_id;

comment on view public.public_storefront_item_detail is
'Buyer-facing item detail projection. It joins public-safe item data to public-safe storefront policy fields and excludes seller-private notes, admin fields, provider/payment identifiers, customers, orders, notifications, and audit records.';


create or replace function public.get_public_storefront_by_slug(
  p_store_slug text
)
returns table (
  store_slug text,
  store_exists boolean,
  is_publicly_available boolean,
  message text,
  storefront jsonb
)
language sql
stable
set search_path = public
as $$
  select
    storefront_status.store_slug,
    storefront_status.store_exists,
    storefront_status.is_publicly_available,
    storefront_status.message,
    case
      when storefront_status.is_publicly_available
        then to_jsonb(public_storefront_home)
      else null::jsonb
    end as storefront
  from public.get_storefront_public_status(p_store_slug) as storefront_status
  left join public.public_storefront_home
    on public_storefront_home.store_slug = storefront_status.store_slug;
$$;

comment on function public.get_public_storefront_by_slug(text) is
'Public-safe storefront lookup by slug. Returns the existing public availability status plus the public storefront home payload when available. Does not expose internal unavailable reasons.';


create or replace function public.get_public_checkout_summary(
  p_store_slug text,
  p_items jsonb
)
returns table (
  store_id uuid,
  store_slug text,
  is_checkout_available boolean,
  message text,
  item_count integer,
  total_quantity integer,
  subtotal_amount numeric(10, 2),
  items jsonb
)
language sql
stable
set search_path = public
as $$
  with normalized_input as (
    select
      lower(trim(p_store_slug)) as normalized_store_slug,
      case
        when p_items is not null
          and jsonb_typeof(p_items) = 'array'
          then p_items
        else '[]'::jsonb
      end as normalized_items,
      (
        p_items is not null
        and jsonb_typeof(p_items) = 'array'
      ) as items_are_array
  ),
  storefront as (
    select
      public_storefront_home.store_id,
      public_storefront_home.store_slug
    from public.public_storefront_home
    join normalized_input
      on normalized_input.normalized_store_slug = public_storefront_home.store_slug
  ),
  raw_items as (
    select
      raw_item.value as item
    from normalized_input
    cross join lateral jsonb_array_elements(normalized_input.normalized_items) as raw_item(value)
  ),
  item_validation as (
    select
      count(*) as raw_item_count,
      count(*) filter (
        where jsonb_typeof(raw_items.item) <> 'object'
           or not (raw_items.item ? 'inventory_item_id')
           or not (raw_items.item ? 'quantity')
           or raw_items.item ->> 'inventory_item_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           or raw_items.item ->> 'quantity' !~ '^[0-9]+$'
           or case
                when raw_items.item ->> 'quantity' ~ '^[0-9]+$'
                  then (raw_items.item ->> 'quantity')::integer <= 0
                else true
              end
      ) as invalid_item_count
    from raw_items
  ),
  valid_raw_items as (
    select
      raw_items.item ->> 'inventory_item_id' as inventory_item_id_text,
      raw_items.item ->> 'quantity' as quantity_text
    from raw_items
    where jsonb_typeof(raw_items.item) = 'object'
      and raw_items.item ? 'inventory_item_id'
      and raw_items.item ? 'quantity'
      and raw_items.item ->> 'inventory_item_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and raw_items.item ->> 'quantity' ~ '^[0-9]+$'
      and case
            when raw_items.item ->> 'quantity' ~ '^[0-9]+$'
              then (raw_items.item ->> 'quantity')::integer > 0
            else false
          end
  ),
  requested_items as (
    select
      valid_raw_items.inventory_item_id_text::uuid as inventory_item_id,
      sum(valid_raw_items.quantity_text::integer)::integer as requested_quantity
    from valid_raw_items
    group by valid_raw_items.inventory_item_id_text::uuid
  ),
  requested_summary as (
    select
      count(*)::integer as item_count,
      coalesce(sum(requested_items.requested_quantity), 0)::integer as total_quantity
    from requested_items
  ),
  matched_items as (
    select
      requested_items.inventory_item_id as requested_inventory_item_id,
      requested_items.requested_quantity,
      public_storefront_inventory.inventory_item_id,
      public_storefront_inventory.store_id,
      public_storefront_inventory.store_slug,
      public_storefront_inventory.species_id,
      public_storefront_inventory.species_name,
      public_storefront_inventory.species_slug,
      public_storefront_inventory.seller_breed_profile_id,
      public_storefront_inventory.breed_display_name,
      public_storefront_inventory.breed_description,
      public_storefront_inventory.listing_batch_id,
      public_storefront_inventory.listing_batch_breed_id,
      public_storefront_inventory.inventory_type,
      public_storefront_inventory.custom_inventory_label,
      public_storefront_inventory.quantity_available,
      public_storefront_inventory.buyer_availability_code,
      public_storefront_inventory.buyer_availability_label,
      public_storefront_inventory.available_date,
      public_storefront_inventory.can_checkout,
      public_storefront_inventory.unit_price,
      (
        public_storefront_inventory.unit_price * requested_items.requested_quantity
      )::numeric(10, 2) as line_subtotal
    from requested_items
    left join public.public_storefront_inventory
      on public_storefront_inventory.inventory_item_id = requested_items.inventory_item_id
     and public_storefront_inventory.store_slug = (
       select storefront.store_slug
       from storefront
       limit 1
     )
  ),
  matched_summary as (
    select
      count(*) filter (
        where matched_items.inventory_item_id is null
      )::integer as missing_item_count,
      count(*) filter (
        where matched_items.inventory_item_id is not null
          and (
            matched_items.can_checkout = false
            or matched_items.quantity_available < matched_items.requested_quantity
          )
      )::integer as unavailable_item_count,
      coalesce(sum(matched_items.line_subtotal) filter (
        where matched_items.inventory_item_id is not null
      ), 0)::numeric(10, 2) as subtotal_amount,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'store_id', matched_items.store_id,
            'store_slug', matched_items.store_slug,
            'inventory_item_id', matched_items.inventory_item_id,
            'listing_batch_id', matched_items.listing_batch_id,
            'listing_batch_breed_id', matched_items.listing_batch_breed_id,
            'seller_breed_profile_id', matched_items.seller_breed_profile_id,
            'species_id', matched_items.species_id,
            'species_name', matched_items.species_name,
            'species_slug', matched_items.species_slug,
            'breed_display_name', matched_items.breed_display_name,
            'breed_description', matched_items.breed_description,
            'inventory_type', matched_items.inventory_type,
            'custom_inventory_label', matched_items.custom_inventory_label,
            'requested_quantity', matched_items.requested_quantity,
            'quantity_available', matched_items.quantity_available,
            'buyer_availability_code', matched_items.buyer_availability_code,
            'buyer_availability_label', matched_items.buyer_availability_label,
            'available_date', matched_items.available_date,
            'unit_price', matched_items.unit_price,
            'line_subtotal', matched_items.line_subtotal
          )
          order by
            matched_items.species_name,
            matched_items.breed_display_name,
            matched_items.available_date,
            matched_items.inventory_item_id
        ) filter (
          where matched_items.inventory_item_id is not null
        ),
        '[]'::jsonb
      ) as items
    from matched_items
  )
  select
    storefront.store_id,
    normalized_input.normalized_store_slug as store_slug,
    (
      storefront.store_id is not null
      and normalized_input.items_are_array = true
      and item_validation.raw_item_count > 0
      and item_validation.invalid_item_count = 0
      and requested_summary.item_count > 0
      and matched_summary.missing_item_count = 0
      and matched_summary.unavailable_item_count = 0
    ) as is_checkout_available,
    case
      when storefront.store_id is null
        then 'This store is currently unavailable.'
      when normalized_input.items_are_array = false
        then 'Checkout items are invalid.'
      when item_validation.raw_item_count = 0
        or requested_summary.item_count = 0
        then 'At least one checkout item is required.'
      when item_validation.invalid_item_count > 0
        then 'Checkout items are invalid.'
      when matched_summary.missing_item_count > 0
        then 'One or more items are no longer available.'
      when matched_summary.unavailable_item_count > 0
        then 'Insufficient inventory quantity available.'
      else null::text
    end as message,
    requested_summary.item_count,
    requested_summary.total_quantity,
    case
      when storefront.store_id is not null
        and normalized_input.items_are_array = true
        and item_validation.raw_item_count > 0
        and item_validation.invalid_item_count = 0
        and requested_summary.item_count > 0
        and matched_summary.missing_item_count = 0
        and matched_summary.unavailable_item_count = 0
        then matched_summary.subtotal_amount
      else 0::numeric(10, 2)
    end as subtotal_amount,
    case
      when storefront.store_id is not null
        and normalized_input.items_are_array = true
        and item_validation.raw_item_count > 0
        and item_validation.invalid_item_count = 0
        and requested_summary.item_count > 0
        and matched_summary.missing_item_count = 0
        and matched_summary.unavailable_item_count = 0
        then matched_summary.items
      else '[]'::jsonb
    end as items
  from normalized_input
  left join storefront on true
  cross join item_validation
  cross join requested_summary
  cross join matched_summary;
$$;

comment on function public.get_public_checkout_summary(text, jsonb) is
'Public-safe checkout summary for storefront UI. Re-checks storefront publication through public storefront projections and validates requested inventory quantities without creating orders, holding inventory, or exposing private seller/order/customer/payment data. Final order creation remains the responsibility of trusted checkout RPCs.';


revoke all on public.public_storefront_home from public;
revoke all on public.public_storefront_inventory from public;
revoke all on public.public_storefront_item_detail from public;

grant select on public.public_storefront_home to anon, authenticated;
grant select on public.public_storefront_inventory to anon, authenticated;
grant select on public.public_storefront_item_detail to anon, authenticated;


revoke all on function public.get_public_storefront_by_slug(text) from public;
revoke all on function public.get_public_checkout_summary(text, jsonb) from public;

grant execute on function public.get_public_storefront_by_slug(text) to anon, authenticated;
grant execute on function public.get_public_checkout_summary(text, jsonb) to anon, authenticated;
