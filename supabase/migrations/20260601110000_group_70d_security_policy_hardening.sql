-- Group 70D: Security Policy Hardening
--
-- Scope:
-- - Removes broad direct seller writes from lifecycle, moderation, order, and
--   inventory tables that are now managed through trusted RPCs.
-- - Preserves seller read policies and trusted SECURITY DEFINER workflows.
-- - Patches public media gallery availability checks to match the public
--   storefront status predicate.
--
-- Deferred:
-- - Group 70B NOT VALID store-consistency constraints still need a data audit
--   before validation. Do not validate them blindly in this group.

begin;


-- ---------------------------------------------------------------------------
-- Store lifecycle/admin fields
-- ---------------------------------------------------------------------------

create or replace function public.prevent_non_admin_store_protected_field_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.store_status <> 'draft'
      or new.admin_hold_reason is not null
      or new.admin_suspended_at is not null
      or new.admin_suspended_by_user_id is not null
      or new.admin_reactivated_at is not null
      or new.admin_reactivated_by_user_id is not null
      or new.admin_suspension_previous_store_status is not null then
      raise exception 'Store lifecycle and admin fields must be managed by trusted workflows.';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.owner_user_id is distinct from old.owner_user_id
      or new.store_status is distinct from old.store_status
      or new.admin_hold_reason is distinct from old.admin_hold_reason
      or new.admin_suspended_at is distinct from old.admin_suspended_at
      or new.admin_suspended_by_user_id is distinct from old.admin_suspended_by_user_id
      or new.admin_reactivated_at is distinct from old.admin_reactivated_at
      or new.admin_reactivated_by_user_id is distinct from old.admin_reactivated_by_user_id
      or new.admin_suspension_previous_store_status is distinct from old.admin_suspension_previous_store_status then
      raise exception 'Store lifecycle and admin fields must be managed by trusted workflows.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists stores_prevent_non_admin_protected_field_mutation on public.stores;

create trigger stores_prevent_non_admin_protected_field_mutation
before insert or update on public.stores
for each row
execute function public.prevent_non_admin_store_protected_field_mutation();

drop policy if exists "Store owners can update own stores" on public.stores;

drop policy if exists "Platform admins can update stores directly" on public.stores;
create policy "Platform admins can update stores directly"
on public.stores
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);

comment on function public.prevent_non_admin_store_protected_field_mutation() is
'Blocks non-admin direct mutation of store lifecycle/admin fields. Seller-facing store changes should go through seller_update_store_settings.';


-- ---------------------------------------------------------------------------
-- Seller catalog/listing/inventory writes now go through trusted RPCs.
-- ---------------------------------------------------------------------------

drop policy if exists "Store owners can insert own seller breed profiles" on public.seller_breed_profiles;
drop policy if exists "Store owners can update own seller breed profiles" on public.seller_breed_profiles;

drop policy if exists "Platform admins can insert seller breed profiles directly" on public.seller_breed_profiles;
create policy "Platform admins can insert seller breed profiles directly"
on public.seller_breed_profiles
for insert
to authenticated
with check (
  public.is_admin()
);

drop policy if exists "Platform admins can update seller breed profiles directly" on public.seller_breed_profiles;
create policy "Platform admins can update seller breed profiles directly"
on public.seller_breed_profiles
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);

drop policy if exists "Store owners can insert own listing batches" on public.listing_batches;
drop policy if exists "Store owners can update own listing batches" on public.listing_batches;

drop policy if exists "Platform admins can insert listing batches directly" on public.listing_batches;
create policy "Platform admins can insert listing batches directly"
on public.listing_batches
for insert
to authenticated
with check (
  public.is_admin()
);

drop policy if exists "Platform admins can update listing batches directly" on public.listing_batches;
create policy "Platform admins can update listing batches directly"
on public.listing_batches
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);

drop policy if exists "Store owners can insert own listing batch breeds" on public.listing_batch_breeds;
drop policy if exists "Store owners can update own listing batch breeds" on public.listing_batch_breeds;

drop policy if exists "Platform admins can insert listing batch breeds directly" on public.listing_batch_breeds;
create policy "Platform admins can insert listing batch breeds directly"
on public.listing_batch_breeds
for insert
to authenticated
with check (
  public.is_admin()
);

drop policy if exists "Platform admins can update listing batch breeds directly" on public.listing_batch_breeds;
create policy "Platform admins can update listing batch breeds directly"
on public.listing_batch_breeds
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);

drop policy if exists "Store owners can insert own inventory items" on public.inventory_items;
drop policy if exists "Store owners can update own inventory items" on public.inventory_items;

drop policy if exists "Platform admins can insert inventory items directly" on public.inventory_items;
create policy "Platform admins can insert inventory items directly"
on public.inventory_items
for insert
to authenticated
with check (
  public.is_admin()
);

drop policy if exists "Platform admins can update inventory items directly" on public.inventory_items;
create policy "Platform admins can update inventory items directly"
on public.inventory_items
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);


-- ---------------------------------------------------------------------------
-- Order writes now go through trusted checkout/manual-order/order-management RPCs.
-- ---------------------------------------------------------------------------

drop policy if exists "Store owners can insert own orders" on public.orders;
drop policy if exists "Store owners can update own orders" on public.orders;

drop policy if exists "Platform admins can insert orders directly" on public.orders;
create policy "Platform admins can insert orders directly"
on public.orders
for insert
to authenticated
with check (
  public.is_admin()
);

drop policy if exists "Platform admins can update orders directly" on public.orders;
create policy "Platform admins can update orders directly"
on public.orders
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);

drop policy if exists "Store owners can insert own order items" on public.order_items;
drop policy if exists "Store owners can update own order items" on public.order_items;

drop policy if exists "Platform admins can insert order items directly" on public.order_items;
create policy "Platform admins can insert order items directly"
on public.order_items
for insert
to authenticated
with check (
  public.is_admin()
);

drop policy if exists "Platform admins can update order items directly" on public.order_items;
create policy "Platform admins can update order items directly"
on public.order_items
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);


-- ---------------------------------------------------------------------------
-- Public media gallery availability
-- ---------------------------------------------------------------------------

create or replace view public.public_storefront_media_gallery
with (security_barrier = true)
as
select
  stores.store_slug,
  media_links.store_id,
  media_links.entity_type,
  media_links.entity_id,
  media_links.display_context,
  '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as public_url,
  coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text,
  media_links.caption,
  media_links.sort_order,
  media_links.is_featured,
  media_assets.width_px,
  media_assets.height_px
from public.media_links
join public.media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
join public.stores
  on stores.id = media_links.store_id
where media_links.entity_type = 'store'
  and media_links.entity_id = stores.id
  and media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
union all
select
  stores.store_slug,
  media_links.store_id,
  media_links.entity_type,
  media_links.entity_id,
  media_links.display_context,
  '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as public_url,
  coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text,
  media_links.caption,
  media_links.sort_order,
  media_links.is_featured,
  media_assets.width_px,
  media_assets.height_px
from public.media_links
join public.media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
join public.listing_batches
  on listing_batches.id = media_links.entity_id
 and media_links.entity_type = 'listing_batch'
join public.stores
  on stores.id = listing_batches.store_id
 and stores.id = media_links.store_id
where media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and listing_batches.visibility_status in ('active', 'sold_out')
union all
select
  stores.store_slug,
  media_links.store_id,
  media_links.entity_type,
  media_links.entity_id,
  media_links.display_context,
  '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as public_url,
  coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text,
  media_links.caption,
  media_links.sort_order,
  media_links.is_featured,
  media_assets.width_px,
  media_assets.height_px
from public.media_links
join public.media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
join public.listing_batch_breeds
  on listing_batch_breeds.id = media_links.entity_id
 and media_links.entity_type = 'listing_batch_breed'
join public.seller_breed_profiles
  on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
join public.listing_batches
  on listing_batches.id = listing_batch_breeds.listing_batch_id
join public.stores
  on stores.id = listing_batch_breeds.store_id
 and stores.id = media_links.store_id
where media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and listing_batches.visibility_status in ('active', 'sold_out')
  and listing_batch_breeds.visibility_status = 'active'
  and seller_breed_profiles.visibility_status = 'active'
union all
select
  stores.store_slug,
  media_links.store_id,
  media_links.entity_type,
  media_links.entity_id,
  media_links.display_context,
  '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as public_url,
  coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text,
  media_links.caption,
  media_links.sort_order,
  media_links.is_featured,
  media_assets.width_px,
  media_assets.height_px
from public.media_links
join public.media_assets
  on media_assets.id = media_links.media_asset_id
 and media_assets.store_id = media_links.store_id
join public.inventory_items
  on inventory_items.id = media_links.entity_id
 and media_links.entity_type = 'inventory_item'
join public.listing_batch_breeds
  on listing_batch_breeds.id = inventory_items.listing_batch_breed_id
join public.seller_breed_profiles
  on seller_breed_profiles.id = listing_batch_breeds.seller_breed_profile_id
join public.listing_batches
  on listing_batches.id = inventory_items.listing_batch_id
join public.stores
  on stores.id = inventory_items.store_id
 and stores.id = media_links.store_id
where media_links.visibility_status = 'active'
  and media_assets.asset_status = 'active'
  and media_assets.moderation_status = 'approved'
  and stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and listing_batches.visibility_status in ('active', 'sold_out')
  and listing_batch_breeds.visibility_status = 'active'
  and seller_breed_profiles.visibility_status = 'active'
  and inventory_items.visibility_status = 'active';

comment on view public.public_storefront_media_gallery is
'Public ordered gallery projection for active approved media on storefronts that satisfy the centralized public availability predicate.';

grant select on public.public_storefront_media_gallery to anon, authenticated;

commit;
