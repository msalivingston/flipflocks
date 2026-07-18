-- V2 international address/currency readiness.
--
-- Scope:
-- - Reuse existing legacy-named address columns as the future address model.
-- - Add only missing billing address line 2 and canonical currency-code columns.
-- - Preserve V1 application compatibility; no RPC, view, checkout, Stripe, or
--   application behavior changes.

begin;

do $$
declare
  v_bad_country record;
  v_bad_currency record;
begin
  select *
  into v_bad_country
  from (
    select 'stores.public_country' as column_name, public_country as bad_value, count(*) as row_count
    from public.stores
    where nullif(trim(public_country), '') is not null
      and public_country !~* '^[a-z]{2}$'
    group by public_country

    union all

    select 'stores.billing_country' as column_name, billing_country as bad_value, count(*) as row_count
    from public.stores
    where nullif(trim(billing_country), '') is not null
      and billing_country !~* '^[a-z]{2}$'
    group by billing_country

    union all

    select 'stores.pickup_country' as column_name, pickup_country as bad_value, count(*) as row_count
    from public.stores
    where nullif(trim(pickup_country), '') is not null
      and pickup_country !~* '^[a-z]{2}$'
    group by pickup_country

    union all

    select 'customers.country' as column_name, country as bad_value, count(*) as row_count
    from public.customers
    where nullif(trim(country), '') is not null
      and country !~* '^[a-z]{2}$'
    group by country

    union all

    select 'customers.delivery_country' as column_name, delivery_country as bad_value, count(*) as row_count
    from public.customers
    where nullif(trim(delivery_country), '') is not null
      and delivery_country !~* '^[a-z]{2}$'
    group by delivery_country

    union all

    select 'orders.buyer_country_snapshot' as column_name, buyer_country_snapshot as bad_value, count(*) as row_count
    from public.orders
    where nullif(trim(buyer_country_snapshot), '') is not null
      and buyer_country_snapshot !~* '^[a-z]{2}$'
    group by buyer_country_snapshot
  ) as country_violations
  order by column_name, bad_value
  limit 1;

  if found then
    raise exception
      'International readiness migration aborted: column % has % row(s) with nonblank country value "%" that is not exactly two letters.',
      v_bad_country.column_name,
      v_bad_country.row_count,
      v_bad_country.bad_value;
  end if;

  select
    'stores.currency' as column_name,
    currency as bad_value,
    count(*) as row_count
  into v_bad_currency
  from public.stores
  where nullif(trim(currency), '') is not null
    and currency !~* '^[a-z]{3}$'
  group by currency
  order by currency
  limit 1;

  if found then
    raise exception
      'International readiness migration aborted: column % has % row(s) with nonblank currency value "%" that is not exactly three letters.',
      v_bad_currency.column_name,
      v_bad_currency.row_count,
      v_bad_currency.bad_value;
  end if;
end;
$$;

update public.stores
set
  public_country = coalesce(upper(nullif(trim(public_country), '')), 'US'),
  billing_country = coalesce(upper(nullif(trim(billing_country), '')), 'US'),
  pickup_country = upper(nullif(trim(pickup_country), ''));

update public.customers
set
  country = upper(nullif(trim(country), '')),
  delivery_country = upper(nullif(trim(delivery_country), ''));

update public.orders
set buyer_country_snapshot = upper(nullif(trim(buyer_country_snapshot), ''));

alter table public.stores
  add column billing_address_line2 text,
  add column currency_code text not null default 'USD';

update public.stores
set currency_code = coalesce(upper(nullif(trim(currency), '')), 'USD');

alter table public.orders
  add column currency_code text not null default 'USD';

update public.orders
set currency_code = coalesce(stores.currency_code, 'USD')
from public.stores
where stores.id = orders.store_id;

alter table public.stores
  add constraint stores_public_country_format_check check (
    public_country ~ '^[A-Z]{2}$'
  ),
  add constraint stores_pickup_country_format_check check (
    pickup_country is null
    or pickup_country ~ '^[A-Z]{2}$'
  ),
  add constraint stores_currency_code_format_check check (
    currency_code ~ '^[A-Z]{3}$'
  );

alter table public.customers
  add constraint customers_country_format_check check (
    country is null
    or country ~ '^[A-Z]{2}$'
  ),
  add constraint customers_delivery_country_format_check check (
    delivery_country is null
    or delivery_country ~ '^[A-Z]{2}$'
  );

alter table public.orders
  add constraint orders_buyer_country_snapshot_format_check check (
    buyer_country_snapshot is null
    or buyer_country_snapshot ~ '^[A-Z]{2}$'
  ),
  add constraint orders_currency_code_format_check check (
    currency_code ~ '^[A-Z]{3}$'
  );

comment on column public.stores.public_state is
'Country-neutral administrative region for the store public location, such as state, province, county, territory, or similar. Legacy column name is retained for V1 compatibility.';

comment on column public.stores.billing_state is
'Country-neutral administrative region for the seller billing address, such as state, province, county, territory, or similar. Legacy column name is retained for V1 compatibility.';

comment on column public.stores.pickup_state is
'Country-neutral administrative region for the seller pickup/contact address, such as state, province, county, territory, or similar. Legacy column name is retained for V1 compatibility.';

comment on column public.customers.state is
'Country-neutral administrative region for the customer contact location, such as state, province, county, territory, or similar. Legacy column name is retained for V1 compatibility.';

comment on column public.customers.delivery_state is
'Country-neutral administrative region for the customer delivery address, such as state, province, county, territory, or similar. Legacy column name is retained for V1 compatibility.';

comment on column public.orders.buyer_state_snapshot is
'Country-neutral administrative region captured for the order buyer address snapshot, such as state, province, county, territory, or similar. Legacy column name is retained for V1 compatibility.';

comment on column public.stores.billing_address_line2 is
'Optional seller billing address line 2 for apartments, suites, units, building names, or other secondary address details.';

comment on column public.stores.currency is
'Legacy lowercase ISO-style currency field retained temporarily for V1 application compatibility. New database work should use stores.currency_code.';

comment on column public.stores.currency_code is
'Canonical uppercase ISO-style display and transaction currency for the store.';

comment on column public.orders.currency_code is
'Immutable uppercase ISO-style currency snapshot for the order, captured from the store currency at order creation time.';

commit;
