-- One-off customer-history support for migrated records. Historical totals
-- remain separate from FlockFront orders, but are included in seller-facing
-- customer lifetime totals and counts.

begin;

alter table public.customers
  add column imported_order_total_cents bigint not null default 0,
  add column imported_order_count integer not null default 0,
  add column imported_source text,
  add column email_marketing_status text not null default 'subscribed',
  add column sms_marketing_status text not null default 'subscribed',
  add constraint customers_imported_order_total_cents_nonnegative_check
    check (imported_order_total_cents >= 0),
  add constraint customers_imported_order_count_nonnegative_check
    check (imported_order_count >= 0),
  add constraint customers_email_marketing_status_check
    check (email_marketing_status in ('subscribed', 'unsubscribed')),
  add constraint customers_sms_marketing_status_check
    check (sms_marketing_status in ('subscribed', 'unsubscribed'));

comment on column public.customers.imported_order_total_cents is
'Historical customer spend imported from a prior system, stored as integer cents and kept separate from FlockFront orders.';

comment on column public.customers.imported_order_count is
'Historical order count imported from a prior system and kept separate from FlockFront orders.';

comment on column public.customers.imported_source is
'Source system for historical customer data, such as whiting_farms.';

comment on column public.customers.email_marketing_status is
'Migration-safe email marketing status. Explicit prior-system unsubscribes remain unsubscribed.';

comment on column public.customers.sms_marketing_status is
'Migration-safe SMS marketing status. Explicit prior-system unsubscribes remain unsubscribed.';

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
  coalesce(customer_order_summary.order_count, 0) + customers.imported_order_count as order_count,
  coalesce(customer_order_summary.open_order_count, 0) as open_order_count,
  (
    coalesce(customer_order_summary.lifetime_order_total, 0)
    + customers.imported_order_total_cents / 100.0
  )::numeric(10, 2) as lifetime_order_total,
  customer_order_summary.latest_order_created_at,
  coalesce(latest_customer_order.latest_order_total, 0)::numeric(10, 2) as latest_order_total,
  customers.imported_order_total_cents,
  customers.imported_order_count,
  customers.imported_source,
  customers.email_marketing_status,
  customers.sms_marketing_status
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
'Seller-private customer/contact summary. Lifetime amount and order count include imported historical values when present; individual historical orders are not fabricated.';

revoke all on public.seller_customer_summary from public;
grant select on public.seller_customer_summary to authenticated;

create or replace view public.seller_customer_detail
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
  customers.delivery_address_line1,
  customers.delivery_address_line2,
  customers.delivery_city,
  customers.delivery_state,
  customers.delivery_postal_code,
  customers.delivery_country,
  customers.internal_notes,
  customers.created_at,
  customers.updated_at,
  coalesce(customer_order_summary.order_count, 0) + customers.imported_order_count as order_count,
  coalesce(customer_order_summary.open_order_count, 0) as open_order_count,
  (
    coalesce(customer_order_summary.lifetime_order_total, 0)
    + customers.imported_order_total_cents / 100.0
  )::numeric(10, 2) as lifetime_order_total,
  customer_order_summary.latest_order_created_at,
  customers.imported_order_total_cents,
  customers.imported_order_count,
  customers.imported_source,
  customers.email_marketing_status,
  customers.sms_marketing_status
from public.customers
left join customer_order_summary
  on customer_order_summary.store_id = customers.store_id
 and customer_order_summary.customer_id = customers.id
where public.owns_store(customers.store_id)
   or public.is_admin();

comment on view public.seller_customer_detail is
'Seller-private customer detail. Lifetime amount and order count include imported historical values when present; individual historical orders are not fabricated.';

revoke all on public.seller_customer_detail from public;
grant select on public.seller_customer_detail to authenticated;

commit;
