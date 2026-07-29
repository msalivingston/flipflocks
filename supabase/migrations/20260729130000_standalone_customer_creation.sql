-- Allow sellers to save a customer independently of an order. The original
-- customer schema required email because storefront/manual order creation
-- always supplied one.

alter table public.customers
  alter column email drop not null;

create index if not exists customers_store_normalized_email_idx
on public.customers (store_id, lower(trim(email)))
where email is not null;

create index if not exists customers_store_phone_digits_idx
on public.customers (
  store_id,
  regexp_replace(phone, '[^0-9]', '', 'g')
)
where phone is not null;

comment on column public.customers.email is
'Optional customer email. Order creation flows may still require an email where their workflow requires it.';
