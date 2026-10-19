begin;

-- Seller writes run through owner/admin-authorized SECURITY DEFINER RPCs.
-- Keep authenticated SELECT and admin DML (the existing RLS policies require
-- these). Public views execute table reads as their postgres owner.
revoke all on table public.inventory_items from public, anon;
revoke truncate, references, trigger on table public.inventory_items from authenticated;

-- These are seller workflows, not customer checkout contracts. Preserve their
-- authenticated/service grants while removing anonymous/default execution.
do $$
declare
  operation regprocedure;
begin
  for operation in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = any(array[
        'seller_create_listing_batch', 'seller_update_listing_batch',
        'seller_set_listing_batch_visibility', 'seller_add_listing_batch_breed',
        'seller_update_listing_batch_breed', 'seller_set_listing_batch_breed_visibility',
        'seller_create_inventory_item', 'seller_update_inventory_item',
        'seller_adjust_inventory_quantity', 'seller_set_inventory_visibility',
        'seller_create_listing_batch_with_inventory', 'seller_create_live_bird_batches',
        'seller_archive_inventory_items', 'seller_restore_inventory_items',
        'seller_clear_inventory_items', 'seller_delete_inventory_entries',
        'seller_duplicate_listing', 'seller_delete_draft_listing_batch',
        'seller_publish_live_bird_draft', 'seller_preflight_live_bird_publication'
      ])
  loop
    execute format('revoke execute on function %s from public, anon', operation);
  end loop;
end;
$$;

commit;
