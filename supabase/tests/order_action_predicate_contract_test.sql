begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

create temporary table active_order_action_functions on commit drop as
select
  p.proname as function_name,
  pg_get_functiondef(p.oid) as definition
from pg_proc as p
join pg_namespace as n
  on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'cancel_order',
    'mark_order_fulfilled',
    'mark_order_paid',
    'mark_order_pay_at_pickup',
    'seller_archive_order',
    'seller_bulk_archive_orders',
    'seller_bulk_mark_orders_fulfilled',
    'seller_bulk_mark_orders_paid',
    'seller_bulk_unarchive_orders',
    'seller_edit_order',
    'seller_edit_order_batch_d_internal',
    'seller_mark_order_unfulfilled',
    'seller_record_order_fulfillment',
    'seller_unarchive_order',
    'cancel_order_batch_d_internal'
  );

select ok(
  (
    select definition like '%order_status not in (''pending'', ''open'')%'
    from active_order_action_functions
    where function_name = 'cancel_order'
  ),
  'cancel_order requires pending or open status'
);

select ok(
  (
    select wrapper.definition like '%cancel_order_batch_d_internal(%'
      and retained.definition like '%payment_method = ''stripe_checkout''%'
      and retained.definition like '%payment_status <> ''unpaid''%'
      and not has_function_privilege(
        'authenticated',
        'public.cancel_order_batch_d_internal(uuid,text,boolean,boolean)',
        'execute'
      )
    from active_order_action_functions as wrapper
    cross join active_order_action_functions as retained
    where wrapper.function_name = 'cancel_order'
      and retained.function_name = 'cancel_order_batch_d_internal'
  ),
  'cancel_order blocks online payment states other than unpaid'
);

select ok(
  (
    select definition like '%order_status not in (''pending'', ''open'')%'
    from active_order_action_functions
    where function_name = 'seller_record_order_fulfillment'
  ),
  'single item-level fulfillment requires pending or open status'
);

select ok(
  (
    select definition like '%order_status not in (''pending'', ''open'')%'
    from active_order_action_functions
    where function_name = 'mark_order_fulfilled'
  ),
  'whole-order fulfillment requires pending or open status'
);

select ok(
  (
    select definition like '%order_status <> ''fulfilled''%'
    from active_order_action_functions
    where function_name = 'seller_mark_order_unfulfilled'
  ),
  'unfulfill requires fulfilled status'
);

select ok(
  (
    select definition like '%payment_provider <> ''offline''%'
      and definition like '%payment_method <> ''pay_at_pickup''%'
    from active_order_action_functions
    where function_name = 'mark_order_paid'
  ),
  'single mark-paid is limited to offline pay-at-pickup orders'
);

select ok(
  (
    select definition like '%order_status not in (''pending'', ''open'', ''fulfilled'')%'
      and definition like '%payment_status not in (''pay_at_pickup'', ''unpaid'')%'
    from active_order_action_functions
    where function_name = 'mark_order_paid'
  ),
  'single mark-paid requires an eligible lifecycle and unpaid state'
);

select ok(
  (
    select definition like '%payment_provider <> ''offline''%'
      and definition like '%payment_method <> ''pay_at_pickup''%'
      and definition like '%payment_status <> ''paid''%'
    from active_order_action_functions
    where function_name = 'mark_order_pay_at_pickup'
  ),
  'single mark-unpaid is limited to paid offline pay-at-pickup orders'
);

select ok(
  (
    select wrapper.definition like '%seller_edit_order_batch_d_internal(%'
      and retained.definition like '%canceled_at is not null%'
      and retained.definition like '%order_status = ''canceled''%'
      and retained.definition like '%fulfilled_at is not null%'
      and retained.definition like '%order_status = ''fulfilled''%'
      and not has_function_privilege(
        'authenticated',
        'public.seller_edit_order_batch_d_internal(uuid,jsonb,jsonb,uuid,text,text,text,text,text,text,text,uuid,text,uuid,text,numeric,text,text,text,text,text,text,numeric)',
        'execute'
      )
    from active_order_action_functions as wrapper
    cross join active_order_action_functions as retained
    where wrapper.function_name = 'seller_edit_order'
      and retained.function_name = 'seller_edit_order_batch_d_internal'
  ),
  'order editing rejects canceled and fulfilled orders'
);

select ok(
  (
    select wrapper.definition like '%seller_edit_order_batch_d_internal(%'
      and retained.definition like '%fulfilled_quantity <> 0 or restored_quantity <> 0%'
    from active_order_action_functions as wrapper
    cross join active_order_action_functions as retained
    where wrapper.function_name = 'seller_edit_order'
      and retained.function_name = 'seller_edit_order_batch_d_internal'
  ),
  'order editing rejects partially fulfilled or restored lines'
);

select ok(
  (
    select
      archive.definition like '%archived_at is not null%'
      and unarchive.definition like '%archived_at is null%'
    from active_order_action_functions as archive
    cross join active_order_action_functions as unarchive
    where archive.function_name = 'seller_archive_order'
      and unarchive.function_name = 'seller_unarchive_order'
  ),
  'single archive actions depend only on archive state after authorization'
);

select ok(
  (
    select definition like '%archived_at is null%'
      and definition like '%order_status in (''pending'', ''open'')%'
      and definition like '%quantity - order_item.fulfilled_quantity - order_item.restored_quantity > 0%'
    from active_order_action_functions
    where function_name = 'seller_bulk_mark_orders_fulfilled'
  ),
  'bulk fulfillment skips archived, non-open, and fully processed orders'
);

select ok(
  (
    select definition like '%archived_at is null%'
      and definition like '%payment_provider = ''offline''%'
      and definition like '%payment_method = ''pay_at_pickup''%'
      and definition like '%order_status in (''pending'', ''open'', ''fulfilled'')%'
      and definition like '%payment_status in (''pay_at_pickup'', ''unpaid'')%'
    from active_order_action_functions
    where function_name = 'seller_bulk_mark_orders_paid'
  ),
  'bulk mark-paid uses the same payment rule and additionally excludes archived orders'
);

select ok(
  (
    select definition like '%archived_at is null%'
    from active_order_action_functions
    where function_name = 'seller_bulk_archive_orders'
  ),
  'bulk archive updates only unarchived orders'
);

select ok(
  (
    select definition like '%archived_at is not null%'
    from active_order_action_functions
    where function_name = 'seller_bulk_unarchive_orders'
  ),
  'bulk unarchive updates only archived orders'
);

select * from finish();

rollback;
