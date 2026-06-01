-- Group 66: Seller Manual Order Historical Age Snapshots
--
-- Manual orders already use public.seller_create_manual_order(...) to freeze
-- unit_price_snapshot and decrement inventory. Add hatch/current-age snapshots
-- at the order item layer so every trusted order creation path preserves the
-- historical bird age without duplicating that logic in each RPC.

alter table public.order_items
  add column if not exists hatch_date_snapshot date,
  add column if not exists age_at_sale_days_snapshot integer;

alter table public.order_items
  drop constraint if exists order_items_age_at_sale_days_snapshot_nonnegative_check;

alter table public.order_items
  add constraint order_items_age_at_sale_days_snapshot_nonnegative_check check (
    age_at_sale_days_snapshot is null
    or age_at_sale_days_snapshot >= 0
  );

comment on column public.order_items.hatch_date_snapshot is
'Hatch/origin date captured when the order item is created. Historical display should not depend on later listing batch edits.';

comment on column public.order_items.age_at_sale_days_snapshot is
'Age in days on the order creation date, captured for live animal order items. Historical display should not depend on the current date.';

create or replace function public.set_order_item_age_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.listing_batches%rowtype;
begin
  select *
  into v_batch
  from public.listing_batches
  where listing_batches.id = new.listing_batch_id;

  if v_batch.id is null then
    return new;
  end if;

  if new.hatch_date_snapshot is null then
    new.hatch_date_snapshot := v_batch.origin_date;
  end if;

  if new.age_at_sale_days_snapshot is null
    and v_batch.batch_type = 'live_animals'
    and v_batch.origin_date is not null then
    new.age_at_sale_days_snapshot := greatest(
      (current_date - v_batch.origin_date)::integer,
      0
    );
  end if;

  return new;
end;
$$;

drop trigger if exists set_order_item_age_snapshots on public.order_items;

create trigger set_order_item_age_snapshots
before insert on public.order_items
for each row
execute function public.set_order_item_age_snapshots();

create or replace view public.seller_order_item_detail
with (security_barrier = true)
as
select
  order_items.store_id,
  order_items.order_id,
  order_items.id as order_item_id,
  orders.order_number,
  order_items.inventory_item_id,
  order_items.listing_batch_id,
  order_items.listing_batch_breed_id,
  order_items.seller_breed_profile_id,
  order_items.species_id,
  order_items.species_name_snapshot,
  order_items.species_slug_snapshot,
  order_items.breed_display_name_snapshot,
  order_items.breed_description_snapshot,
  order_items.inventory_type_snapshot,
  order_items.custom_inventory_label_snapshot,
  order_items.batch_type_snapshot,
  order_items.available_date_snapshot,
  order_items.age_at_availability_days_snapshot,
  order_items.unit_price_snapshot,
  order_items.quantity,
  order_items.fulfilled_quantity,
  order_items.restored_quantity,
  greatest(
    order_items.quantity
      - order_items.fulfilled_quantity
      - order_items.restored_quantity,
    0
  ) as remaining_unfulfilled_quantity,
  order_items.line_subtotal,
  order_items.created_at,
  order_items.hatch_date_snapshot,
  order_items.age_at_sale_days_snapshot
from public.order_items
join public.orders
  on orders.id = order_items.order_id
 and orders.store_id = order_items.store_id
where public.owns_store(order_items.store_id)
   or public.is_admin();

comment on view public.seller_order_item_detail is
'Seller-private order line detail projection for order detail and fulfillment screens, including Group 66 hatch and age-at-sale snapshots.';
