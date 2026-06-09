-- Expose the same draft-delete guard used by seller_delete_draft_listing_batch
-- so the seller UI can decide whether to show Delete Draft or Archive Inventory.

create or replace function public.seller_get_draft_listing_batch_delete_status(
  p_listing_batch_id uuid
)
returns table (
  is_draft boolean,
  has_order_history boolean,
  has_published_activity boolean,
  can_delete boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.listing_batches%rowtype;
  v_has_order_history boolean;
  v_has_published_activity boolean;
begin
  select *
  into v_batch
  from public.listing_batches
  where listing_batches.id = p_listing_batch_id;

  if v_batch.id is null then
    raise exception 'Draft not found.';
  end if;

  if not (
    public.owns_store(v_batch.store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to inspect this draft.';
  end if;

  select exists (
    select 1
    from public.order_items
    where order_items.listing_batch_id = v_batch.id
  )
  into v_has_order_history;

  select exists (
    select 1
    from public.inventory_activity_events
    where inventory_activity_events.listing_batch_id = v_batch.id
      and (
        inventory_activity_events.from_visibility_status in ('active', 'sold_out')
        or inventory_activity_events.to_visibility_status in ('active', 'sold_out')
      )
  )
  into v_has_published_activity;

  return query
  select
    v_batch.visibility_status = 'hidden',
    v_has_order_history,
    v_has_published_activity,
    v_batch.visibility_status = 'hidden'
      and not v_has_order_history
      and not v_has_published_activity;
end;
$$;

comment on function public.seller_get_draft_listing_batch_delete_status(uuid) is
'Trusted seller/admin RPC that reports whether a listing batch is a never-published draft with no order history and is therefore eligible for permanent draft deletion.';

revoke all on function public.seller_get_draft_listing_batch_delete_status(uuid) from public;
grant execute on function public.seller_get_draft_listing_batch_delete_status(uuid) to authenticated;
