begin;

create function public.discounted_coupon_lines(p_lines jsonb,p_pricing jsonb)
returns jsonb language sql stable set search_path=public as $$
  with lines as (
    select value as line,ordinality as n,coalesce(value->>'inventory_item_id',value->>'equipment_inventory_item_id',value->>'processed_poultry_inventory_item_id',value->>'hatching_egg_inventory_item_id',value->>'item_id') as source_id,(value->>'line_subtotal')::numeric as gross,
      case when public.coupon_line_eligible(nullif(p_pricing->'coupon','null'::jsonb),value) then (value->>'line_subtotal')::numeric else 0 end as eligible
    from jsonb_array_elements(p_lines) with ordinality
  ), allocated as (
    select *,coalesce(round(sum(eligible) over(order by source_id,n)*(p_pricing->>'coupon_amount')::numeric/nullif((p_pricing->>'eligible_subtotal')::numeric,0),2),0)
      - coalesce(round((sum(eligible) over(order by source_id,n)-eligible)*(p_pricing->>'coupon_amount')::numeric/nullif((p_pricing->>'eligible_subtotal')::numeric,0),2),0) discount
    from lines
  ) select jsonb_agg(jsonb_build_object('item_name',line->>'item_name','quantity',coalesce(line->'requested_quantity',line->'quantity'),
      'net_amount',gross-discount) order by n) from allocated;
$$;
revoke all on function public.discounted_coupon_lines(jsonb,jsonb) from public,anon,authenticated;

create or replace function public.preview_storefront_coupon(p_store_slug text,p_items jsonb,p_coupon_code text,p_customer_email text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_summary record; v_store_id uuid; v_pricing jsonb;
begin
  select * into v_summary from public.get_public_checkout_summary(p_store_slug,p_items);
  if not coalesce(v_summary.is_checkout_available,false) then raise exception 'Cart is not available for checkout.'; end if;
  select id into v_store_id from public.stores where store_slug=p_store_slug;
  v_pricing:=public.calculate_order_discounts(v_store_id,p_customer_email,v_summary.items,p_coupon_code);
  return jsonb_build_object('coupon_code',v_pricing->'coupon'->>'code','coupon_amount',v_pricing->'coupon_amount','net_subtotal',v_pricing->'net_subtotal',
    'lines',public.discounted_coupon_lines(v_summary.items,v_pricing));
end;
$$;

create function public.seller_preview_order_coupon(p_store_id uuid,p_items jsonb,p_coupon_code text,p_customer_email text,p_order_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lines jsonb; v_pricing jsonb;
begin
  if not public.owns_store(p_store_id) then raise exception 'Store is not available.'; end if;
  if p_order_id is not null and not exists(select 1 from public.orders where id=p_order_id and store_id=p_store_id) then raise exception 'Order is not available.'; end if;
  -- Seller unit-price overrides are intentional; only owners can preview these.
  select jsonb_agg(value || jsonb_build_object('line_subtotal',round((value->>'unit_price')::numeric*(value->>'quantity')::numeric,2)))
  into v_lines from jsonb_array_elements(p_items);
  v_pricing:=public.calculate_order_discounts(p_store_id,p_customer_email,coalesce(v_lines,'[]'::jsonb),p_coupon_code,'fixed',0,p_order_id);
  return jsonb_build_object('coupon_code',v_pricing->'coupon'->>'code','coupon_amount',v_pricing->'coupon_amount','net_subtotal',v_pricing->'net_subtotal');
end;
$$;
revoke all on function public.seller_preview_order_coupon(uuid,jsonb,text,text,uuid) from public,anon;
grant execute on function public.seller_preview_order_coupon(uuid,jsonb,text,text,uuid) to authenticated;
commit;
