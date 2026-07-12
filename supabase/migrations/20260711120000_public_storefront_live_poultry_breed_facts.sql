-- Expose public-safe breed facts for the buyer live-poultry product page.
--
-- The buyer page already receives per-option pickup dates from
-- public_storefront_inventory.available_date. This migration adds read-only
-- breed characteristic fields and origin_date for current-age display.

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
  public_storefront_breed_inventory.inventory_sort_order,
  public_storefront_breed_inventory.batch_type,
  public_storefront_breed_inventory.age_at_availability_days,
  listing_batches.origin_date,
  coalesce(seller_breed_profiles.bird_type, breeds.bird_type) as breed_bird_type,
  coalesce(seller_breed_profiles.egg_color, breeds.egg_color) as breed_egg_color,
  coalesce(
    seller_breed_profiles.annual_egg_production,
    breeds.annual_egg_production
  ) as breed_annual_egg_production
from public.public_storefront_breed_inventory
join public.stores
  on stores.id = public_storefront_breed_inventory.store_id
join public.listing_batches
  on listing_batches.id = public_storefront_breed_inventory.listing_batch_id
left join public.seller_breed_profiles
  on seller_breed_profiles.id = public_storefront_breed_inventory.seller_breed_profile_id
left join public.breeds
  on breeds.id = seller_breed_profiles.breed_id
left join public.seller_billing_status
  on seller_billing_status.store_id = stores.id
where (
    coalesce(public_storefront_breed_inventory.batch_type, '') <> 'hatching_eggs'
    and coalesce(public_storefront_breed_inventory.inventory_type, '') <> 'hatching_eggs'
  )
  or (
    stores.hatching_eggs_enabled = true
    and coalesce(seller_billing_status.plan_key, 'full_flock') <> 'small_flock'
  );

comment on view public.public_storefront_inventory is
'Buyer-facing storefront inventory projection for V1 UI. Reuses the official public storefront inventory layer, hides hatching egg rows when the seller disables that public module, exposes public-safe breed facts plus origin_date, batch_type, and age_at_availability_days for buyer option labels, and translates availability to the approved buyer labels: Ready now, Reserve now, and Sold out.';

grant select on public.public_storefront_inventory to anon, authenticated;
