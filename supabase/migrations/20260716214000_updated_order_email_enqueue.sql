-- Trusted enqueue helper for optional updated-order customer emails.
-- The order edit UI calls this only after seller_edit_order succeeds.

create or replace function public.seller_enqueue_updated_order_email(
  p_order_id uuid,
  p_email_action_id text
)
returns table (
  buyer_notification_queued boolean,
  seller_copy_queued boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_store public.stores%rowtype;
  v_email_action_id text := nullif(trim(coalesce(p_email_action_id, '')), '');
  v_buyer_name text;
  v_order_number_label text;
  v_store_name text;
begin
  if p_order_id is null then
    raise exception 'Order is required.';
  end if;

  if v_email_action_id is null then
    raise exception 'Email action identifier is required.';
  end if;

  select orders.*
  into v_order
  from public.orders as orders
  where orders.id = p_order_id
    and (public.owns_store(orders.store_id) or public.is_admin());

  if v_order.id is null then
    raise exception 'Order is not available.';
  end if;

  if nullif(trim(coalesce(v_order.buyer_email_snapshot, '')), '') is null then
    buyer_notification_queued := false;
    seller_copy_queued := false;
    return next;
    return;
  end if;

  select stores.*
  into v_store
  from public.stores as stores
  where stores.id = v_order.store_id;

  v_buyer_name := coalesce(
    nullif(trim(concat_ws(
      ' ',
      v_order.buyer_first_name_snapshot,
      v_order.buyer_last_name_snapshot
    )), ''),
    'Customer'
  );
  v_order_number_label := '#' || v_order.order_number::text;
  v_store_name := coalesce(nullif(trim(v_store.store_name), ''), 'your store');

  perform public.enqueue_email_notification(
    v_order.store_id,
    v_order.id,
    'buyer_order_updated',
    'buyer',
    v_order.buyer_email_snapshot,
    'Your order with ' || v_store_name || ' has been updated ' ||
      chr(8212) || ' ' || v_order_number_label,
    jsonb_build_object(
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'store_id', v_order.store_id,
      'store_name', v_store.store_name,
      'store_slug', v_store.store_slug,
      'buyer_first_name', v_order.buyer_first_name_snapshot,
      'buyer_last_name', v_order.buyer_last_name_snapshot,
      'buyer_email', v_order.buyer_email_snapshot,
      'order_status', v_order.order_status,
      'payment_status', v_order.payment_status,
      'total_amount', v_order.total_amount,
      'created_at', v_order.created_at,
      'email_action_id', v_email_action_id
    ),
    v_email_action_id
  );

  select exists (
    select 1
    from public.email_notifications
    where email_notifications.store_id = v_order.store_id
      and email_notifications.order_id = v_order.id
      and email_notifications.notification_type = 'buyer_order_updated'
      and email_notifications.recipient_type = 'buyer'
      and email_notifications.dedupe_key =
        'buyer_order_updated:order:' || v_order.id::text || ':action:' || v_email_action_id
  )
  into buyer_notification_queued;

  if buyer_notification_queued then
    perform public.enqueue_email_notification(
      v_order.store_id,
      v_order.id,
      'seller_order_updated_copy',
      'seller',
      v_store.order_notification_email,
      'Customer copy: Updated order ' || v_order_number_label ||
        ' for ' || v_buyer_name,
      jsonb_build_object(
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'store_id', v_order.store_id,
        'store_name', v_store.store_name,
        'store_slug', v_store.store_slug,
        'buyer_first_name', v_order.buyer_first_name_snapshot,
        'buyer_last_name', v_order.buyer_last_name_snapshot,
        'buyer_email', v_order.buyer_email_snapshot,
        'order_status', v_order.order_status,
        'payment_status', v_order.payment_status,
        'total_amount', v_order.total_amount,
        'created_at', v_order.created_at,
        'email_action_id', v_email_action_id
      ),
      v_email_action_id
    );
  end if;

  select exists (
    select 1
    from public.email_notifications
    where email_notifications.store_id = v_order.store_id
      and email_notifications.order_id = v_order.id
      and email_notifications.notification_type = 'seller_order_updated_copy'
      and email_notifications.recipient_type = 'seller'
      and email_notifications.dedupe_key =
        'seller_order_updated_copy:order:' || v_order.id::text || ':action:' || v_email_action_id
  )
  into seller_copy_queued;

  return next;
end;
$$;

comment on function public.seller_enqueue_updated_order_email(uuid, text) is
'Trusted seller helper that enqueues the buyer updated-order notice and seller copy for one saved order edit action.';

revoke all on function public.seller_enqueue_updated_order_email(uuid, text) from public;
grant execute on function public.seller_enqueue_updated_order_email(uuid, text) to authenticated, service_role;
