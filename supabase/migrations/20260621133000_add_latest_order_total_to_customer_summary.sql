create or replace view public.seller_customer_summary
with (security_barrier = true)
as
with customer_order_summary as (
  select
    orders.store_id,
    orders.customer_id,
    count(*) as order_count,
    max(orders.created_at) as latest_order_created_at,
    count(*) filter (where orders.order_status in ('pending', 'open')) as open_order_count,
    coalesce(sum(orders.total_amount), 0)::numeric(10, 2) as lifetime_order_total
  from public.orders
  group by orders.store_id, orders.customer_id
),
latest_customer_order as (
  select distinct on (orders.store_id, orders.customer_id)
    orders.store_id,
    orders.customer_id,
    orders.total_amount as latest_order_total
  from public.orders
  order by orders.store_id, orders.customer_id, orders.created_at desc, orders.id desc
)
select
  customers.store_id,
  customers.id as customer_id,
  customers.email,
  customers.first_name,
  customers.last_name,
  customers.phone,
  customers.business_name,
  customers.city,
  customers.state,
  customers.country,
  customers.delivery_city,
  customers.delivery_state,
  customers.delivery_postal_code,
  customers.delivery_country,
  customers.created_at,
  customers.updated_at,
  coalesce(customer_order_summary.order_count, 0) as order_count,
  coalesce(customer_order_summary.open_order_count, 0) as open_order_count,
  coalesce(customer_order_summary.lifetime_order_total, 0)::numeric(10, 2) as lifetime_order_total,
  customer_order_summary.latest_order_created_at,
  coalesce(latest_customer_order.latest_order_total, 0)::numeric(10, 2) as latest_order_total
from public.customers
left join customer_order_summary
  on customer_order_summary.store_id = customers.store_id
 and customer_order_summary.customer_id = customers.id
left join latest_customer_order
  on latest_customer_order.store_id = customers.store_id
 and latest_customer_order.customer_id = customers.id
where public.owns_store(customers.store_id)
   or public.is_admin();

comment on view public.seller_customer_summary is
'Seller-private customer/contact summary for dashboard lookup and fulfillment support. Internal notes are intentionally omitted.';

revoke all on public.seller_customer_summary from public;
grant select on public.seller_customer_summary to authenticated;
