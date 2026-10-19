-- Extend the existing creators and reservation, retaining their validation,
-- inventory locks, payment bindings, notifications, and reconciliation logic.
begin;

create function public.coupon_migration_replace(p_sql text,p_anchor text,p_replacement text)
returns text language plpgsql as $$
begin
  if (length(p_sql)-length(replace(p_sql,p_anchor,'')))/length(p_anchor) <> 1 then
    raise exception 'Coupon migration expected exactly one anchor: %',p_anchor;
  end if;
  return replace(p_sql,p_anchor,p_replacement);
end;
$$;

do $migration$
declare
  v_name text; v_oid oid; v_sql text; v_lines text; v_email text; v_store text;
  v_old_signature text; v_last_arg text; v_is_core boolean;
begin
  foreach v_name in array array[
    'create_pay_at_pickup_order_v2_batch_d_internal','seller_create_manual_order_batch_d_internal',
    'seller_edit_order_batch_d_internal','create_pay_at_pickup_order_v2','seller_create_manual_order','seller_edit_order',
    'reserve_storefront_card_checkout'
  ] loop
    select p.oid,replace(pg_get_functiondef(p.oid),chr(13),''),p.oid::regprocedure::text
    into strict v_oid,v_sql,v_old_signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=v_name;
    v_sql:=public.coupon_migration_replace(v_sql,E')\n RETURNS',E', p_coupon_code text DEFAULT NULL, p_manual_discount_type text DEFAULT NULL, p_manual_discount_value numeric DEFAULT NULL)\n RETURNS');
    v_is_core:=v_name like '%batch_d_internal';
    if v_is_core then
      v_sql:=public.coupon_migration_replace(v_sql,E'\ndeclare\n',E'\ndeclare\n  v_coupon_pricing jsonb;\n');
      v_store:='p_store_id';
      if v_name='create_pay_at_pickup_order_v2_batch_d_internal' then
        v_email:='v_buyer_email';
        v_lines:='(select jsonb_agg(to_jsonb(l)) from pg_temp.locked_order_items l)';
      elsif v_name='seller_create_manual_order_batch_d_internal' then
        v_email:='v_customer_email';
        v_lines:=$lines$(select jsonb_agg(line) from (
          select to_jsonb(l) line from pg_temp.locked_manual_order_items l union all
          select to_jsonb(l) from pg_temp.locked_manual_equipment_items l union all
          select to_jsonb(l) from pg_temp.locked_manual_processed_poultry_items l union all
          select to_jsonb(l) from pg_temp.locked_manual_hatching_egg_items l union all
          select jsonb_build_object('item_type','custom','line_subtotal',unit_price_override*quantity)
            from pg_temp.requested_manual_order_items where item_type='custom'
        ) lines)$lines$;
      else
        v_store:='v_order.store_id'; v_email:='v_customer_email';
        v_lines:='(select jsonb_agg(to_jsonb(i)) from public.order_items i where i.order_id=v_order.id)';
      end if;
      v_sql:=public.coupon_migration_replace(v_sql,'  v_total_amount :=',format($hook$
  if p_coupon_code is not null or p_manual_discount_value is not null %s then
    v_coupon_pricing := public.calculate_order_discounts(%s,%s,%s,p_coupon_code,p_manual_discount_type,p_manual_discount_value,%s);
    v_subtotal_amount := (v_coupon_pricing->>'net_subtotal')::numeric;
  end if;
  v_total_amount :=$hook$,
        case when v_name='seller_edit_order_batch_d_internal' then 'or v_order.discount_snapshot is not null' else '' end,
        v_store,v_email,v_lines,case when v_name='seller_edit_order_batch_d_internal' then 'v_order.id' else 'null' end));
      if v_name='seller_edit_order_batch_d_internal' then
        v_sql:=public.coupon_migration_replace(v_sql,'  insert into public.order_events (',E'  perform public.attach_order_discounts(v_order.id,v_coupon_pricing);\n\n  insert into public.order_events (');
      else
        v_sql:=public.coupon_migration_replace(v_sql,'  update public.order_idempotency_keys as ',E'  perform public.attach_order_discounts(v_order_id,v_coupon_pricing);\n\n  update public.order_idempotency_keys as ');
        -- Coupon intent participates in the durable request fingerprint.
        v_sql:=public.coupon_migration_replace(v_sql,'  insert into public.order_idempotency_keys', $hash$
  if p_coupon_code is not null or p_manual_discount_value is not null then
    v_request_hash:=encode(extensions.digest(v_request_hash || jsonb_build_object(
      'coupon_code',upper(trim(p_coupon_code)),'manual_type',p_manual_discount_type,'manual_value',p_manual_discount_value)::text,'sha256'),'hex');
  end if;
  insert into public.order_idempotency_keys$hash$);
      end if;
    elsif v_name='reserve_storefront_card_checkout' then
      v_sql:=public.coupon_migration_replace(v_sql,E'\ndeclare\n',E'\ndeclare\n  v_coupon_pricing jsonb;\n');
      v_sql:=public.coupon_migration_replace(v_sql,'  v_total := (v_subtotal+v_delivery_fee)::numeric(10,2);',$hook$
  if nullif(trim(p_coupon_code),'') is not null then
    v_coupon_pricing:=public.calculate_order_discounts(p_store_id,v_email,
      (select jsonb_agg(to_jsonb(l)) from pg_temp.card_locked_items l),p_coupon_code,'fixed',0,null,p_reservation_id);
    v_subtotal:=(v_coupon_pricing->>'net_subtotal')::numeric;
  end if;
  v_total := (v_subtotal+v_delivery_fee)::numeric(10,2);$hook$);
      v_sql:=public.coupon_migration_replace(v_sql,$anchor$'subtotal_amount',v_subtotal,$anchor$, $hook$'discount_snapshot',v_coupon_pricing,'subtotal_amount',v_subtotal,$hook$);
    else
      -- The outer inventory-reconciliation wrappers delegate all pricing to
      -- the same retained creators. Append coupon intent to that call only.
      v_last_arg:=case when v_name='seller_edit_order' then 'p_tax_fee_amount' else 'p_delivery_option_id' end;
      v_sql:=public.coupon_migration_replace(v_sql,v_last_arg || E'\n  );',v_last_arg || E',\n    p_coupon_code, p_manual_discount_type, p_manual_discount_value\n  );');
    end if;
    execute format('alter function %s rename to %I',v_old_signature,v_name||'_before_coupons');
    execute format('revoke all on function public.%I(%s) from public,anon,authenticated,service_role',v_name||'_before_coupons',pg_get_function_identity_arguments(v_oid));
    execute v_sql;
    select p.oid::regprocedure::text into v_old_signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=v_name;
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v_old_signature);
    if v_name in ('seller_create_manual_order','seller_edit_order') then execute format('grant execute on function %s to authenticated',v_old_signature);
    elsif v_name in ('create_pay_at_pickup_order_v2','reserve_storefront_card_checkout') then execute format('grant execute on function %s to service_role',v_old_signature);
    end if;
  end loop;
end;
$migration$;

do $migration$
declare v_sql text; v_oid oid;
begin
  select p.oid,replace(pg_get_functiondef(p.oid),chr(13),'') into strict v_oid,v_sql
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='settle_storefront_card_checkout';
  v_sql:=public.coupon_migration_replace(v_sql,'  insert into public.stripe_checkout_sessions(',
    E'  perform public.attach_order_discounts(v_order_id,v_snapshot->''discount_snapshot'');\n  insert into public.stripe_checkout_sessions(');
  -- Free Checkout Sessions legitimately have no PaymentIntent. All existing
  -- account, currency, amount, and verified-session bindings still apply.
  v_sql:=public.coupon_migration_replace(v_sql,$anchor$if nullif(trim(p_stripe_payment_intent_id),'') is null$anchor$, $hook$if p_amount_total_cents > 0 and nullif(trim(p_stripe_payment_intent_id),'') is null$hook$);
  execute v_sql;
end;
$migration$;

create function public.preview_storefront_coupon(p_store_slug text,p_items jsonb,p_coupon_code text,p_customer_email text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_summary record; v_store_id uuid; v_pricing jsonb;
begin
  select * into v_summary from public.get_public_checkout_summary(p_store_slug,p_items);
  if not coalesce(v_summary.is_checkout_available,false) then raise exception 'Cart is not available for checkout.'; end if;
  select id into v_store_id from public.stores where store_slug=p_store_slug;
  v_pricing:=public.calculate_order_discounts(v_store_id,p_customer_email,v_summary.items,p_coupon_code);
  return jsonb_build_object('coupon_code',v_pricing->'coupon'->>'code','coupon_amount',v_pricing->'coupon_amount','net_subtotal',v_pricing->'net_subtotal');
end;
$$;
revoke all on function public.preview_storefront_coupon(text,jsonb,text,text) from public;
grant execute on function public.preview_storefront_coupon(text,jsonb,text,text) to anon,authenticated,service_role;

-- A fully discounted card order has nothing to refund. Use the existing
-- cancellation/inventory reconciliation path, only for a bound zero Session.
do $zero_balance$
declare v_sql text; v_anchor text := E'    and v_order.payment_status <> ''unpaid'' then';
begin
  select replace(pg_get_functiondef(p.oid),chr(13),'') into strict v_sql
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='cancel_order_batch_d_internal';
  if strpos(v_sql,v_anchor)=0 then raise exception 'Zero-balance cancellation anchor missing.'; end if;
  v_sql:=replace(v_sql,v_anchor,$hook$
    and v_order.payment_status <> 'unpaid'
    and not (v_order.total_amount=0 and exists(
      select 1 from public.stripe_checkout_sessions s where s.order_id=v_order.id and s.store_id=v_order.store_id
        and s.amount_total_cents=0 and s.checkout_session_status='complete' and s.payment_status='paid'
    )) then$hook$);
  execute v_sql;
end;
$zero_balance$;

-- Restoring creates a new order: prefill the original code and manual intent,
-- then revalidate the code rather than silently dropping or blindly reusing it.
do $restore_coupon$
declare v_sql text;
begin
  select replace(pg_get_functiondef(p.oid),chr(13),'') into strict v_sql
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='seller_get_order_restore_draft';
  if strpos(v_sql,$anchor$'source_order_id', v_source_order.id,$anchor$)=0 then raise exception 'Coupon restore draft anchor missing.'; end if;
  execute replace(v_sql,$anchor$'source_order_id', v_source_order.id,$anchor$,
    $hook$'discount_snapshot', v_source_order.discount_snapshot, 'source_order_id', v_source_order.id,$hook$);
end;
$restore_coupon$;
drop function public.coupon_migration_replace(text,text,text);
commit;
