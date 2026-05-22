-- Group 10: Customers, Orders, and Order Items Foundation
-- Tables:
-- - customers
-- - orders
-- - order_items
--
-- Scope:
-- - Creates the durable customer/order/order item foundation for V1.
-- - Preserves historical buyer-facing order snapshots.
-- - Does not create order number generation logic.
-- - Does not create inventory decrement logic.
-- - Does not create RPCs.
-- - Does not create Stripe webhook objects.
-- - Does not create email notification tables.
-- - Does not create pickup option tables.
--
-- Requires:
-- - public.stores
-- - public.owns_store(uuid)
-- - public.is_admin()
-- - public.set_updated_at()
-- - public.species
-- - public.seller_breed_profiles
-- - public.listing_batches
-- - public.listing_batch_breeds
-- - public.inventory_items


create table public.customers (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,

  email text not null,
  first_name text not null,
  last_name text not null,
  phone text,
  business_name text,

  city text,
  state text,
  country text,

  delivery_address_line1 text,
  delivery_address_line2 text,
  delivery_city text,
  delivery_state text,
  delivery_postal_code text,
  delivery_country text,

  internal_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint customers_email_not_empty_check check (
    length(trim(email)) > 0
  ),

  constraint customers_first_name_not_empty_check check (
    length(trim(first_name)) > 0
  ),

  constraint customers_last_name_not_empty_check check (
    length(trim(last_name)) > 0
  ),

  constraint customers_phone_not_empty_check check (
    phone is null
    or length(trim(phone)) > 0
  ),

  constraint customers_business_name_not_empty_check check (
    business_name is null
    or length(trim(business_name)) > 0
  ),

  constraint customers_city_not_empty_check check (
    city is null
    or length(trim(city)) > 0
  ),

  constraint customers_state_not_empty_check check (
    state is null
    or length(trim(state)) > 0
  ),

  constraint customers_country_not_empty_check check (
    country is null
    or length(trim(country)) > 0
  ),

  constraint customers_delivery_address_line1_not_empty_check check (
    delivery_address_line1 is null
    or length(trim(delivery_address_line1)) > 0
  ),

  constraint customers_delivery_address_line2_not_empty_check check (
    delivery_address_line2 is null
    or length(trim(delivery_address_line2)) > 0
  ),

  constraint customers_delivery_city_not_empty_check check (
    delivery_city is null
    or length(trim(delivery_city)) > 0
  ),

  constraint customers_delivery_state_not_empty_check check (
    delivery_state is null
    or length(trim(delivery_state)) > 0
  ),

  constraint customers_delivery_postal_code_not_empty_check check (
    delivery_postal_code is null
    or length(trim(delivery_postal_code)) > 0
  ),

  constraint customers_delivery_country_not_empty_check check (
    delivery_country is null
    or length(trim(delivery_country)) > 0
  ),

  constraint customers_internal_notes_not_empty_check check (
    internal_notes is null
    or length(trim(internal_notes)) > 0
  )
);

comment on table public.customers is
'Store-scoped buyer/contact records for seller operations and guest checkout. Customer records are private to the store owner and platform admins.';

comment on column public.customers.store_id is
'Tenant ownership field used for RLS and seller/admin access checks.';

comment on column public.customers.email is
'Required buyer email for V1 customer/contact records. No hard unique constraint is applied because guest checkout and future merge workflows may need flexibility.';

comment on column public.customers.internal_notes is
'Private seller-only notes about the customer. Do not expose through public storefront views, public APIs, or buyer-facing order views.';

comment on column public.customers.delivery_address_line1 is
'Optional delivery/contact address field for future local delivery flexibility. This does not imply V1 shipping support.';

comment on column public.customers.delivery_address_line2 is
'Optional delivery/contact address field for future local delivery flexibility. This does not imply V1 shipping support.';

comment on column public.customers.delivery_city is
'Optional delivery/contact city for future local delivery flexibility. This does not imply V1 shipping support.';

comment on column public.customers.delivery_state is
'Optional delivery/contact state or region for future local delivery flexibility. This does not imply V1 shipping support.';

comment on column public.customers.delivery_postal_code is
'Optional delivery/contact postal code for future local delivery flexibility. This does not imply V1 shipping support.';

comment on column public.customers.delivery_country is
'Optional delivery/contact country for future local delivery flexibility. This does not imply V1 shipping support.';


create table public.orders (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid not null references public.customers(id),

  order_number text not null,

  order_source text not null default 'storefront',
  order_status text not null default 'pending',

  payment_method text not null default 'pay_at_pickup',
  payment_status text not null default 'pay_at_pickup',

  buyer_email_snapshot text not null,
  buyer_first_name_snapshot text not null,
  buyer_last_name_snapshot text not null,
  buyer_phone_snapshot text,

  buyer_notes text,
  pickup_note text,

  subtotal_amount numeric(10, 2) not null default 0,
  tax_fee_label_snapshot text,
  tax_fee_rate_snapshot numeric(7, 4),
  tax_fee_amount numeric(10, 2) not null default 0,
  total_amount numeric(10, 2) not null default 0,

  canceled_at timestamptz,
  canceled_reason text,
  fulfilled_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint orders_order_number_not_empty_check check (
    length(trim(order_number)) > 0
  ),

  constraint orders_order_source_check check (
    order_source in ('storefront', 'seller_created', 'imported')
  ),

  constraint orders_order_status_check check (
    order_status in ('pending', 'open', 'fulfilled', 'canceled')
  ),

  constraint orders_payment_method_check check (
    payment_method in ('pay_at_pickup', 'stripe_checkout')
  ),

  constraint orders_payment_status_check check (
    payment_status in ('unpaid', 'pay_at_pickup', 'paid', 'canceled', 'refunded')
  ),

  constraint orders_payment_method_status_compatible_check check (
    not (
      payment_method = 'stripe_checkout'
      and payment_status = 'pay_at_pickup'
    )
  ),

  constraint orders_buyer_email_snapshot_not_empty_check check (
    length(trim(buyer_email_snapshot)) > 0
  ),

  constraint orders_buyer_first_name_snapshot_not_empty_check check (
    length(trim(buyer_first_name_snapshot)) > 0
  ),

  constraint orders_buyer_last_name_snapshot_not_empty_check check (
    length(trim(buyer_last_name_snapshot)) > 0
  ),

  constraint orders_buyer_phone_snapshot_not_empty_check check (
    buyer_phone_snapshot is null
    or length(trim(buyer_phone_snapshot)) > 0
  ),

  constraint orders_buyer_notes_not_empty_check check (
    buyer_notes is null
    or length(trim(buyer_notes)) > 0
  ),

  constraint orders_pickup_note_not_empty_check check (
    pickup_note is null
    or length(trim(pickup_note)) > 0
  ),

  constraint orders_tax_fee_label_snapshot_not_empty_check check (
    tax_fee_label_snapshot is null
    or length(trim(tax_fee_label_snapshot)) > 0
  ),

  constraint orders_canceled_reason_not_empty_check check (
    canceled_reason is null
    or length(trim(canceled_reason)) > 0
  ),

  constraint orders_subtotal_amount_nonnegative_check check (
    subtotal_amount >= 0
  ),

  constraint orders_tax_fee_amount_nonnegative_check check (
    tax_fee_amount >= 0
  ),

  constraint orders_total_amount_nonnegative_check check (
    total_amount >= 0
  ),

  constraint orders_tax_fee_rate_snapshot_nonnegative_check check (
    tax_fee_rate_snapshot is null
    or tax_fee_rate_snapshot >= 0
  ),

  constraint orders_canceled_at_required_check check (
    order_status <> 'canceled'
    or canceled_at is not null
  ),

  constraint orders_fulfilled_at_required_check check (
    order_status <> 'fulfilled'
    or fulfilled_at is not null
  ),

  constraint orders_store_order_number_unique unique (
    store_id,
    order_number
  )
);

comment on table public.orders is
'Store-scoped order/reservation header. Preserves buyer contact, pickup, tax, and total snapshots from checkout or seller-created order time. Future buyer checkout should use trusted server routes or RPCs, not direct public table writes.';

comment on column public.orders.store_id is
'Tenant ownership field used for RLS and seller/admin access checks.';

comment on column public.orders.customer_id is
'Customer/contact record associated with this order. Uses default restrict/no-action delete behavior so historical orders are not orphaned or removed when customer deletion is attempted.';

comment on column public.orders.order_number is
'Human-facing order number unique within a store. Generation is intentionally deferred to future trusted order creation logic.';

comment on column public.orders.order_source is
'Internal/system-facing source of the order: storefront, seller_created, or imported. This should not clutter seller dashboards.';

comment on column public.orders.order_status is
'Order lifecycle status. Normal workflows should use status changes rather than hard deletion.';

comment on column public.orders.payment_method is
'Payment method selected for the order. V1 supports pay_at_pickup and future stripe_checkout.';

comment on column public.orders.payment_status is
'Payment status snapshot for the order. pay_at_pickup is an intentional payment arrangement, not an online-payment failure state.';

comment on column public.orders.buyer_email_snapshot is
'Buyer email captured at checkout/order creation time. Historical snapshot should not depend on later customer edits.';

comment on column public.orders.buyer_first_name_snapshot is
'Buyer first name captured at checkout/order creation time. Historical snapshot should not depend on later customer edits.';

comment on column public.orders.buyer_last_name_snapshot is
'Buyer last name captured at checkout/order creation time. Historical snapshot should not depend on later customer edits.';

comment on column public.orders.buyer_phone_snapshot is
'Buyer phone captured at checkout/order creation time when provided. Historical snapshot should not depend on later customer edits.';

comment on column public.orders.buyer_notes is
'Buyer-provided notes for this order.';

comment on column public.orders.pickup_note is
'Pickup coordination note captured for this order. Pickup option tables are intentionally deferred.';

comment on column public.orders.subtotal_amount is
'Order subtotal captured at checkout/order creation time. Future trusted order creation logic must calculate and validate this value server-side.';

comment on column public.orders.tax_fee_label_snapshot is
'Optional tax/local fee label captured at checkout/order creation time.';

comment on column public.orders.tax_fee_rate_snapshot is
'Optional tax/local fee rate captured at checkout/order creation time.';

comment on column public.orders.tax_fee_amount is
'Tax/local fee amount captured at checkout/order creation time.';

comment on column public.orders.total_amount is
'Order total captured at checkout/order creation time. Future trusted order creation logic must calculate and validate this value server-side.';


create table public.order_items (
  id uuid primary key default gen_random_uuid(),

  order_id uuid not null references public.orders(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,

  inventory_item_id uuid not null references public.inventory_items(id),
  listing_batch_id uuid not null references public.listing_batches(id),
  listing_batch_breed_id uuid not null references public.listing_batch_breeds(id),
  seller_breed_profile_id uuid not null references public.seller_breed_profiles(id),
  species_id uuid not null references public.species(id),

  species_name_snapshot text not null,
  species_slug_snapshot text not null,
  breed_display_name_snapshot text not null,
  breed_description_snapshot text,

  inventory_type_snapshot text not null,
  custom_inventory_label_snapshot text,

  batch_type_snapshot text not null,
  available_date_snapshot date not null,
  age_at_availability_days_snapshot integer,

  unit_price_snapshot numeric(10, 2) not null,
  quantity integer not null,
  line_subtotal numeric(10, 2) not null,

  created_at timestamptz not null default now(),

  constraint order_items_species_name_snapshot_not_empty_check check (
    length(trim(species_name_snapshot)) > 0
  ),

  constraint order_items_species_slug_snapshot_not_empty_check check (
    length(trim(species_slug_snapshot)) > 0
  ),

  constraint order_items_breed_display_name_snapshot_not_empty_check check (
    length(trim(breed_display_name_snapshot)) > 0
  ),

  constraint order_items_breed_description_snapshot_not_empty_check check (
    breed_description_snapshot is null
    or length(trim(breed_description_snapshot)) > 0
  ),

  constraint order_items_inventory_type_snapshot_check check (
    inventory_type_snapshot in (
      'female',
      'male',
      'straight_run',
      'unsexed',
      'pair',
      'trio',
      'hatching_eggs',
      'other'
    )
  ),

  constraint order_items_custom_inventory_label_snapshot_not_empty_check check (
    custom_inventory_label_snapshot is null
    or length(trim(custom_inventory_label_snapshot)) > 0
  ),

  constraint order_items_batch_type_snapshot_check check (
    batch_type_snapshot in ('live_animals', 'hatching_eggs')
  ),

  constraint order_items_age_at_availability_days_snapshot_nonnegative_check check (
    age_at_availability_days_snapshot is null
    or age_at_availability_days_snapshot >= 0
  ),

  constraint order_items_unit_price_snapshot_nonnegative_check check (
    unit_price_snapshot >= 0
  ),

  constraint order_items_quantity_positive_check check (
    quantity > 0
  ),

  constraint order_items_line_subtotal_nonnegative_check check (
    line_subtotal >= 0
  )
);

comment on table public.order_items is
'Line-level order item snapshots. Foreign keys are retained for traceability, but snapshot columns are the historical source of truth for buyer-facing order details. Inventory decrement is intentionally deferred to future trusted order creation logic.';

comment on column public.order_items.order_id is
'Parent order. Order items cascade when an order is deleted by a platform admin; hard deletion is not a normal seller workflow.';

comment on column public.order_items.store_id is
'Tenant ownership field duplicated for RLS, reporting, and query simplicity. Future trusted order creation logic must ensure this matches the parent order and referenced inventory/listing records.';

comment on column public.order_items.inventory_item_id is
'Referenced inventory item selected at checkout/order creation time. Kept for traceability; historical display should use snapshot columns.';

comment on column public.order_items.listing_batch_id is
'Referenced listing batch selected at checkout/order creation time. Kept for traceability; historical display should use snapshot columns.';

comment on column public.order_items.listing_batch_breed_id is
'Referenced breed grouping selected at checkout/order creation time. Kept for traceability; historical display should use snapshot columns.';

comment on column public.order_items.seller_breed_profile_id is
'Referenced seller breed profile selected at checkout/order creation time. Kept for traceability; historical display should use snapshot columns.';

comment on column public.order_items.species_id is
'Referenced species selected at checkout/order creation time. Kept for traceability; historical display should use snapshot columns.';

comment on column public.order_items.species_name_snapshot is
'Species display name captured at checkout/order creation time. Historical snapshot should not depend on later species edits.';

comment on column public.order_items.species_slug_snapshot is
'Species slug captured at checkout/order creation time. Historical snapshot should not depend on later species edits.';

comment on column public.order_items.breed_display_name_snapshot is
'Breed display name captured at checkout/order creation time. Historical snapshot should not depend on later seller breed profile or catalog edits.';

comment on column public.order_items.breed_description_snapshot is
'Optional seller-facing/public breed description captured at checkout/order creation time. Historical snapshot should not depend on later profile edits.';

comment on column public.order_items.inventory_type_snapshot is
'Inventory type captured at checkout/order creation time. Historical snapshot should not depend on later inventory item edits.';

comment on column public.order_items.custom_inventory_label_snapshot is
'Custom inventory label captured at checkout/order creation time when present. Historical snapshot should not depend on later inventory item edits.';

comment on column public.order_items.batch_type_snapshot is
'Batch type captured at checkout/order creation time.';

comment on column public.order_items.available_date_snapshot is
'Ready/available date captured at checkout/order creation time. Historical snapshot should not depend on later batch edits.';

comment on column public.order_items.age_at_availability_days_snapshot is
'Age at availability captured at checkout/order creation time. Nullable for hatching eggs or contexts where age should not be displayed.';

comment on column public.order_items.unit_price_snapshot is
'Unit price captured at checkout/order creation time. Historical snapshot should not depend on later price changes or date-based auto-pricing.';

comment on column public.order_items.quantity is
'Quantity ordered for this line item. Future trusted order creation logic must validate and decrement inventory server-side.';

comment on column public.order_items.line_subtotal is
'Line subtotal captured at checkout/order creation time. Future trusted order creation logic must calculate and validate this value server-side.';


-- Seller dashboard, lookup, and join indexes

create index customers_store_id_idx
on public.customers(store_id);

create index customers_store_email_idx
on public.customers(store_id, email);

create index customers_store_created_at_idx
on public.customers(store_id, created_at desc);


create index orders_store_created_at_idx
on public.orders(store_id, created_at desc);

create index orders_store_order_status_idx
on public.orders(store_id, order_status);

create index orders_store_payment_status_idx
on public.orders(store_id, payment_status);

create index orders_customer_id_idx
on public.orders(customer_id);

create index orders_store_customer_created_at_idx
on public.orders(store_id, customer_id, created_at desc);


create index order_items_order_id_idx
on public.order_items(order_id);

create index order_items_store_created_at_idx
on public.order_items(store_id, created_at desc);

create index order_items_inventory_item_id_idx
on public.order_items(inventory_item_id);

create index order_items_listing_batch_id_idx
on public.order_items(listing_batch_id);

create index order_items_listing_batch_breed_id_idx
on public.order_items(listing_batch_breed_id);

create index order_items_seller_breed_profile_id_idx
on public.order_items(seller_breed_profile_id);

create index order_items_species_id_idx
on public.order_items(species_id);


-- updated_at triggers

create trigger customers_set_updated_at
before update on public.customers
for each row
execute function public.set_updated_at();


create trigger orders_set_updated_at
before update on public.orders
for each row
execute function public.set_updated_at();


-- RLS

alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;


create policy "Store owners can read own customers"
on public.customers
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Store owners can insert own customers"
on public.customers
for insert
to authenticated
with check (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Store owners can update own customers"
on public.customers
for update
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
)
with check (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Platform admins can delete customers"
on public.customers
for delete
to authenticated
using (
  public.is_admin()
);


create policy "Store owners can read own orders"
on public.orders
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Store owners can insert own orders"
on public.orders
for insert
to authenticated
with check (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Store owners can update own orders"
on public.orders
for update
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
)
with check (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Platform admins can delete orders"
on public.orders
for delete
to authenticated
using (
  public.is_admin()
);


create policy "Store owners can read own order items"
on public.order_items
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Store owners can insert own order items"
on public.order_items
for insert
to authenticated
with check (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Store owners can update own order items"
on public.order_items
for update
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
)
with check (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Platform admins can delete order items"
on public.order_items
for delete
to authenticated
using (
  public.is_admin()
);

-- Public read policies intentionally omitted.
-- Buyer-facing checkout/order creation should use future trusted server routes
-- or RPCs. Base tables contain private customer, seller, and historical order
-- details and must not be queried directly by public clients.
