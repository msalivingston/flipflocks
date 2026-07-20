begin;

create or replace view public.seller_hatching_egg_inventory_management
with (security_barrier = true)
as
select
  hatching_items.id as hatching_egg_inventory_item_id,
  hatching_items.store_id,
  hatching_items.item_name,
  hatching_items.species_id,
  species.common_name as species_name,
  species.slug as species_slug,
  hatching_items.description,
  hatching_items.quantity_available,
  hatching_items.price,
  hatching_items.available_date,
  hatching_items.minimum_order_quantity,
  hatching_items.visibility_status,
  hatching_items.moderation_status,
  case
    when hatching_items.visibility_status = 'archived' then 'archived'
    when hatching_items.moderation_status <> 'normal' then 'unavailable'
    when hatching_items.visibility_status = 'sold_out'
      or hatching_items.quantity_available <= 0 then 'sold_out'
    when hatching_items.visibility_status <> 'active' then 'hidden'
    when hatching_items.available_date > current_date then 'coming_soon'
    else 'ready_now'
  end as operational_availability_status,
  hatching_items.seller_notes,
  hatching_items.first_published_at,
  hatching_items.archived_at,
  hatching_items.created_at,
  hatching_items.updated_at,
  (
    'he-' ||
    md5(
      hatching_items.store_id::text ||
      ':' ||
      lower(regexp_replace(btrim(hatching_items.item_name), '\s+', ' ', 'g'))
    )
  ) as hatching_egg_product_id
from public.hatching_egg_inventory_items as hatching_items
join public.species
  on species.id = hatching_items.species_id
where public.owns_store(hatching_items.store_id)
   or public.is_admin();

comment on view public.seller_hatching_egg_inventory_management is
'Seller-private standalone Hatching Eggs management projection for Add-only support, including the existing public product ID used by storefront product routes.';

grant select on public.seller_hatching_egg_inventory_management to authenticated;

commit;
