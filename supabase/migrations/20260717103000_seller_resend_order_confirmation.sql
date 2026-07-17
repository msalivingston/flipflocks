-- Trusted helper for seller-initiated resends of the existing buyer order confirmation.

create or replace function public.seller_resend_order_confirmation(
  p_order_id uuid,
  p_email_action_id text
)
returns table (
  notification_queued boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_store public.stores%rowtype;
  v_email_action_id text := nullif(trim(coalesce(p_email_action_id, '')), '');
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

  if v_order.order_status = 'canceled'
    or v_order.canceled_at is not null then
    raise exception 'Canceled orders are not eligible for confirmation resend.';
  end if;

  if nullif(trim(coalesce(v_order.buyer_email_snapshot, '')), '') is null then
    notification_queued := false;
    return next;
    return;
  end if;

  select stores.*
  into v_store
  from public.stores as stores
  where stores.id = v_order.store_id;

  v_order_number_label := '#' || v_order.order_number::text;
  v_store_name := coalesce(nullif(trim(v_store.store_name), ''), 'your store');

  perform public.enqueue_email_notification(
    v_order.store_id,
    v_order.id,
    'buyer_order_confirmation',
    'buyer',
    v_order.buyer_email_snapshot,
    'Your order with ' || v_store_name || ' is confirmed ' ||
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
      'email_action_id', v_email_action_id,
      'resend', true
    ),
    v_email_action_id
  );

  select exists (
    select 1
    from public.email_notifications
    where email_notifications.store_id = v_order.store_id
      and email_notifications.order_id = v_order.id
      and email_notifications.notification_type = 'buyer_order_confirmation'
      and email_notifications.recipient_type = 'buyer'
      and email_notifications.dedupe_key =
        'buyer_order_confirmation:order:' || v_order.id::text || ':action:' || v_email_action_id
  )
  into notification_queued;

  return next;
end;
$$;

comment on function public.seller_resend_order_confirmation(uuid, text) is
'Trusted seller helper that queues another copy of the existing buyer order confirmation for an eligible non-canceled order.';

revoke all on function public.seller_resend_order_confirmation(uuid, text) from public;
grant execute on function public.seller_resend_order_confirmation(uuid, text) to authenticated, service_role;
