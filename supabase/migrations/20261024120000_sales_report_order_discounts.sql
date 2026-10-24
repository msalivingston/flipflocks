-- Expose the existing order-level pricing breakdown in sales report rows.
-- Item revenue continues to use allocated order_items.line_subtotal.
begin;

do $migration$
declare
  v_sql text;
  v_amount_anchor text := '''total_amount'', p.total_amount,';
  v_join_anchor text := '      left join lateral (';
begin
  select pg_get_functiondef(p.oid) into strict v_sql
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'seller_get_report_page';

  if (length(v_sql) - length(replace(v_sql, v_amount_anchor, ''))) / length(v_amount_anchor) <> 1
    or (length(v_sql) - length(replace(v_sql, v_join_anchor, ''))) / length(v_join_anchor) <> 1 then
    raise exception 'Sales report discount migration anchors changed.';
  end if;

  v_sql := replace(v_sql, v_amount_anchor, v_amount_anchor || E'\n        ''gross_subtotal_amount'', o.gross_subtotal_amount,\n        ''subtotal_amount'', o.subtotal_amount,\n        ''coupon_discount_amount'', o.coupon_discount_amount,\n        ''manual_discount_amount'', o.manual_discount_amount,\n        ''coupon_code'', o.discount_snapshot->''coupon''->>''code'',\n        ''tax_fee_amount'', o.tax_fee_amount,\n        ''delivery_fee_amount'', o.delivery_fee_amount,');
  v_sql := replace(v_sql, v_join_anchor,
    E'      left join public.orders o on o.id = p.order_id and o.store_id = p_store_id\n' || v_join_anchor);
  execute v_sql;
end;
$migration$;

-- Bulk printable orders use the order management projection, which predates
-- the discount columns. Include the existing order snapshot in its payload.
do $print_migration$
declare
  v_sql text;
  v_anchor text := '''delivery_fee_amount'', orders.delivery_fee_amount';
begin
  select pg_get_functiondef(p.oid) into strict v_sql
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'seller_get_orders_for_print';

  if (length(v_sql) - length(replace(v_sql, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'Printable order discount migration anchor changed.';
  end if;

  v_sql := replace(v_sql, v_anchor, v_anchor || E',\n            ''discount_snapshot'', orders.discount_snapshot,\n            ''gross_subtotal_amount'', orders.gross_subtotal_amount,\n            ''coupon_discount_amount'', orders.coupon_discount_amount,\n            ''manual_discount_amount'', orders.manual_discount_amount');
  execute v_sql;
end;
$print_migration$;

-- The order-list quick view also needs the breakdown without changing the
-- bounded base pagination or its inventory joins.
do $list_migration$
declare
  v_sql text;
  v_return_anchor text := '  return jsonb_set(v_page, ''{items}'', v_items, true);';
begin
  select pg_get_functiondef(p.oid) into strict v_sql
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'seller_get_order_list_page';

  if strpos(v_sql, '  v_page jsonb;') = 0 or strpos(v_sql, v_return_anchor) = 0 then
    raise exception 'Order list discount migration anchors changed.';
  end if;

  v_sql := replace(v_sql, '  v_page jsonb;', E'  v_page jsonb;\n  v_orders jsonb;');
  v_sql := replace(v_sql, v_return_anchor, $replacement$
  select coalesce(jsonb_agg(page_order.value || jsonb_build_object(
    'discount_snapshot', orders.discount_snapshot,
    'gross_subtotal_amount', orders.gross_subtotal_amount,
    'subtotal_amount', orders.subtotal_amount,
    'coupon_discount_amount', orders.coupon_discount_amount,
    'manual_discount_amount', orders.manual_discount_amount,
    'tax_fee_amount', orders.tax_fee_amount,
    'delivery_fee_amount', orders.delivery_fee_amount
  ) order by page_order.ordinality), '[]'::jsonb)
  into v_orders
  from jsonb_array_elements(coalesce(v_page -> 'orders', '[]'::jsonb))
    with ordinality as page_order(value, ordinality)
  join public.orders on orders.id = (page_order.value ->> 'order_id')::uuid
    and orders.store_id = p_store_id;

  return jsonb_set(jsonb_set(v_page, '{items}', v_items, true), '{orders}', v_orders, true);$replacement$);
  execute v_sql;
end;
$list_migration$;

commit;
