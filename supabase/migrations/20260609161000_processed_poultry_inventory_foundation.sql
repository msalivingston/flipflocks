-- Processed Poultry foundation: module toggle, seller inventory CRUD, and photos.
--
-- Processed poultry is intentionally separate from live bird listing batches and
-- equipment inventory. One row is one simple local-pickup sellable item.

begin;

alter table public.stores
add column if not exists processed_poultry_enabled boolean not null default false;

comment on column public.stores.processed_poultry_enabled is
'Seller-controlled Store Admin setting for showing Processed Poultry creation entry points. It does not hide or modify existing inventory, listings, orders, or history.';

drop function if exists public.get_seller_context();

create or replace function public.get_seller_context()
returns table (
  store_id uuid,
  store_name text,
  store_tagline text,
  store_slug text,
  store_status text,
  storefront_mode text,
  storefront_enabled boolean,
  hatching_eggs_enabled boolean,
  equipment_supplies_enabled boolean,
  processed_poultry_enabled boolean,
  is_publicly_available boolean,
  public_city text,
  public_state text,
  public_country text,
  about_text text,
  pickup_policy text,
  cancellation_policy text,
  pickup_instructions text,
  public_email text,
  public_phone text,
  show_public_email boolean,
  show_public_phone boolean,
  website_url text,
  social_url text,
  npip_number text,
  show_npip boolean,
  order_notification_email text,
  billing_plan text,
  subscription_status text,
  storefront_access_until timestamptz,
  trial_ends_at timestamptz,
  profile_complete boolean,
  billing_complete boolean,
  terms_accepted boolean,
  first_listing_created boolean,
  ready_to_launch boolean,
  launched_at timestamptz,
  role text,
  is_admin boolean,
  other_policies text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    stores.id as store_id,
    stores.store_name,
    stores.store_tagline,
    stores.store_slug,
    stores.store_status,
    stores.storefront_mode,
    stores.storefront_enabled,
    stores.hatching_eggs_enabled,
    stores.equipment_supplies_enabled,
    stores.processed_poultry_enabled,
    (
      stores.storefront_enabled = true
      and stores.store_status = 'live'
      and stores.storefront_mode in ('hosted', 'embedded')
      and stores.admin_hold_reason is null
    ) as is_publicly_available,
    stores.public_city,
    stores.public_state,
    stores.public_country,
    stores.about_text,
    stores.pickup_policy,
    stores.cancellation_policy,
    stores.pickup_instructions,
    stores.public_email,
    stores.public_phone,
    stores.show_public_email,
    stores.show_public_phone,
    stores.website_url,
    stores.social_url,
    stores.npip_number,
    stores.show_npip,
    stores.order_notification_email,
    seller_billing_status.billing_plan,
    seller_billing_status.subscription_status,
    seller_billing_status.storefront_access_until,
    seller_billing_status.trial_ends_at,
    coalesce(seller_onboarding_state.profile_complete, false) as profile_complete,
    coalesce(seller_onboarding_state.billing_complete, false) as billing_complete,
    coalesce(seller_onboarding_state.terms_accepted, false) as terms_accepted,
    coalesce(seller_onboarding_state.first_listing_created, false) as first_listing_created,
    coalesce(seller_onboarding_state.ready_to_launch, false) as ready_to_launch,
    seller_onboarding_state.launched_at,
    user_roles.role,
    public.is_admin() as is_admin,
    stores.other_policies
  from public.stores
  left join public.user_roles
    on user_roles.store_id = stores.id
   and user_roles.user_id = auth.uid()
   and user_roles.role in ('seller', 'staff')
  left join public.seller_billing_status
    on seller_billing_status.store_id = stores.id
  left join public.seller_onboarding_state
    on seller_onboarding_state.store_id = stores.id
  where stores.owner_user_id = auth.uid()
     or user_roles.user_id = auth.uid()
     or public.is_admin();
$$;

drop function if exists public.seller_update_store_settings(uuid, jsonb);

create or replace function public.seller_update_store_settings(
  p_store_id uuid,
  p_settings jsonb
)
returns table (
  store_id uuid,
  store_name text,
  store_tagline text,
  store_slug text,
  store_status text,
  storefront_mode text,
  storefront_enabled boolean,
  hatching_eggs_enabled boolean,
  equipment_supplies_enabled boolean,
  processed_poultry_enabled boolean,
  is_publicly_available boolean,
  public_city text,
  public_state text,
  public_country text,
  about_text text,
  pickup_policy text,
  cancellation_policy text,
  pickup_instructions text,
  public_email text,
  public_phone text,
  show_public_email boolean,
  show_public_phone boolean,
  website_url text,
  social_url text,
  npip_number text,
  show_npip boolean,
  order_notification_email text,
  updated_at timestamptz,
  other_policies text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores%rowtype;
  v_allowed_keys text[] := array[
    'store_name',
    'store_tagline',
    'store_slug',
    'storefront_mode',
    'storefront_enabled',
    'hatching_eggs_enabled',
    'equipment_supplies_enabled',
    'processed_poultry_enabled',
    'public_city',
    'public_state',
    'public_country',
    'about_text',
    'pickup_policy',
    'cancellation_policy',
    'pickup_instructions',
    'public_email',
    'public_phone',
    'show_public_email',
    'show_public_phone',
    'website_url',
    'social_url',
    'npip_number',
    'show_npip',
    'order_notification_email',
    'other_policies'
  ];
  v_unknown_keys text;
  v_store_name text;
  v_store_slug text;
  v_storefront_mode text;
  v_public_country text;
begin
  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'Settings payload must be a JSON object.';
  end if;

  select string_agg(settings_key, ', ' order by settings_key)
  into v_unknown_keys
  from jsonb_object_keys(p_settings) as settings_key
  where not (settings_key = any(v_allowed_keys));

  if v_unknown_keys is not null then
    raise exception 'Unsupported store settings field(s): %', v_unknown_keys;
  end if;

  select stores.*
  into v_store
  from public.stores
  where stores.id = p_store_id
  for update;

  if v_store.id is null then
    raise exception 'Store is not available.';
  end if;

  if not (public.owns_store(v_store.id) or public.is_admin()) then
    raise exception 'Not authorized to update this store.';
  end if;

  if v_store.store_status in ('suspended', 'canceled') then
    raise exception 'Suspended or canceled stores cannot update seller settings.';
  end if;

  v_store_name := case
    when p_settings ? 'store_name' then nullif(trim(p_settings ->> 'store_name'), '')
    else v_store.store_name
  end;

  v_store_slug := case
    when p_settings ? 'store_slug' then lower(nullif(trim(p_settings ->> 'store_slug'), ''))
    else v_store.store_slug
  end;

  v_storefront_mode := case
    when p_settings ? 'storefront_mode' then nullif(trim(p_settings ->> 'storefront_mode'), '')
    else v_store.storefront_mode
  end;

  v_public_country := case
    when p_settings ? 'public_country' then coalesce(nullif(trim(p_settings ->> 'public_country'), ''), 'US')
    else coalesce(v_store.public_country, 'US')
  end;

  if v_store_name is null then raise exception 'Store name is required.'; end if;

  if v_store_slug is null or v_store_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Store slug is invalid.';
  end if;

  if v_storefront_mode not in ('hosted', 'embedded', 'private') then
    raise exception 'Storefront mode is not supported.';
  end if;

  update public.stores
  set
    store_name = v_store_name,
    store_tagline = case when p_settings ? 'store_tagline' then nullif(trim(p_settings ->> 'store_tagline'), '') else stores.store_tagline end,
    store_slug = v_store_slug,
    storefront_mode = v_storefront_mode,
    storefront_enabled = case when p_settings ? 'storefront_enabled' then coalesce((p_settings ->> 'storefront_enabled')::boolean, stores.storefront_enabled) else stores.storefront_enabled end,
    hatching_eggs_enabled = case when p_settings ? 'hatching_eggs_enabled' then coalesce((p_settings ->> 'hatching_eggs_enabled')::boolean, stores.hatching_eggs_enabled) else stores.hatching_eggs_enabled end,
    equipment_supplies_enabled = case when p_settings ? 'equipment_supplies_enabled' then coalesce((p_settings ->> 'equipment_supplies_enabled')::boolean, stores.equipment_supplies_enabled) else stores.equipment_supplies_enabled end,
    processed_poultry_enabled = case when p_settings ? 'processed_poultry_enabled' then coalesce((p_settings ->> 'processed_poultry_enabled')::boolean, stores.processed_poultry_enabled) else stores.processed_poultry_enabled end,
    public_city = case when p_settings ? 'public_city' then nullif(trim(p_settings ->> 'public_city'), '') else stores.public_city end,
    public_state = case when p_settings ? 'public_state' then nullif(trim(p_settings ->> 'public_state'), '') else stores.public_state end,
    public_country = v_public_country,
    about_text = case when p_settings ? 'about_text' then nullif(trim(p_settings ->> 'about_text'), '') else stores.about_text end,
    pickup_policy = case when p_settings ? 'pickup_policy' then nullif(trim(p_settings ->> 'pickup_policy'), '') else stores.pickup_policy end,
    cancellation_policy = case when p_settings ? 'cancellation_policy' then nullif(trim(p_settings ->> 'cancellation_policy'), '') else stores.cancellation_policy end,
    other_policies = case when p_settings ? 'other_policies' then nullif(trim(p_settings ->> 'other_policies'), '') else stores.other_policies end,
    pickup_instructions = case when p_settings ? 'pickup_instructions' then nullif(trim(p_settings ->> 'pickup_instructions'), '') else stores.pickup_instructions end,
    public_email = case when p_settings ? 'public_email' then lower(nullif(trim(p_settings ->> 'public_email'), '')) else stores.public_email end,
    public_phone = case when p_settings ? 'public_phone' then nullif(trim(p_settings ->> 'public_phone'), '') else stores.public_phone end,
    show_public_email = case when p_settings ? 'show_public_email' then coalesce((p_settings ->> 'show_public_email')::boolean, stores.show_public_email) else stores.show_public_email end,
    show_public_phone = case when p_settings ? 'show_public_phone' then coalesce((p_settings ->> 'show_public_phone')::boolean, stores.show_public_phone) else stores.show_public_phone end,
    website_url = case when p_settings ? 'website_url' then nullif(trim(p_settings ->> 'website_url'), '') else stores.website_url end,
    social_url = case when p_settings ? 'social_url' then nullif(trim(p_settings ->> 'social_url'), '') else stores.social_url end,
    npip_number = case when p_settings ? 'npip_number' then nullif(trim(p_settings ->> 'npip_number'), '') else stores.npip_number end,
    show_npip = case when p_settings ? 'show_npip' then coalesce((p_settings ->> 'show_npip')::boolean, stores.show_npip) else stores.show_npip end,
    order_notification_email = case when p_settings ? 'order_notification_email' then lower(nullif(trim(p_settings ->> 'order_notification_email'), '')) else stores.order_notification_email end
  where stores.id = v_store.id
  returning stores.* into v_store;

  return query
  select
    v_store.id,
    v_store.store_name,
    v_store.store_tagline,
    v_store.store_slug,
    v_store.store_status,
    v_store.storefront_mode,
    v_store.storefront_enabled,
    v_store.hatching_eggs_enabled,
    v_store.equipment_supplies_enabled,
    v_store.processed_poultry_enabled,
    (
      v_store.storefront_enabled = true
      and v_store.store_status = 'live'
      and v_store.storefront_mode in ('hosted', 'embedded')
      and v_store.admin_hold_reason is null
    ),
    v_store.public_city,
    v_store.public_state,
    v_store.public_country,
    v_store.about_text,
    v_store.pickup_policy,
    v_store.cancellation_policy,
    v_store.pickup_instructions,
    v_store.public_email,
    v_store.public_phone,
    v_store.show_public_email,
    v_store.show_public_phone,
    v_store.website_url,
    v_store.social_url,
    v_store.npip_number,
    v_store.show_npip,
    v_store.order_notification_email,
    v_store.updated_at,
    v_store.other_policies;
end;
$$;

create table if not exists public.processed_poultry_inventory_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_name text not null,
  poultry_type text not null,
  product_type text not null,
  package_size text,
  description text,
  quantity_available integer not null default 0,
  price numeric(10, 2) not null,
  visibility_status text not null default 'hidden',
  moderation_status text not null default 'normal',
  seller_notes text,
  first_published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint processed_poultry_product_name_not_empty_check check (length(trim(product_name)) > 0),
  constraint processed_poultry_poultry_type_check check (poultry_type in ('Chicken', 'Turkey', 'Duck', 'Goose', 'Other')),
  constraint processed_poultry_product_type_check check (product_type in ('Whole Bird', 'Halves', 'Parts', 'Other')),
  constraint processed_poultry_package_size_not_empty_check check (package_size is null or length(trim(package_size)) > 0),
  constraint processed_poultry_description_not_empty_check check (description is null or length(trim(description)) > 0),
  constraint processed_poultry_quantity_available_nonnegative_check check (quantity_available >= 0),
  constraint processed_poultry_price_nonnegative_check check (price >= 0),
  constraint processed_poultry_visibility_status_check check (visibility_status in ('hidden', 'active', 'sold_out', 'archived')),
  constraint processed_poultry_moderation_status_check check (moderation_status in ('normal', 'flagged')),
  constraint processed_poultry_seller_notes_not_empty_check check (seller_notes is null or length(trim(seller_notes)) > 0)
);

comment on table public.processed_poultry_inventory_items is
'Seller-owned Processed Poultry inventory. One row is one simple local-pickup product and is intentionally separate from bird listing batch tables.';

create index if not exists processed_poultry_inventory_store_visibility_idx
on public.processed_poultry_inventory_items(store_id, visibility_status);

create index if not exists processed_poultry_inventory_store_product_type_idx
on public.processed_poultry_inventory_items(store_id, poultry_type, product_type);

create index if not exists processed_poultry_inventory_store_updated_at_idx
on public.processed_poultry_inventory_items(store_id, updated_at desc);

alter table public.order_items
add column if not exists processed_poultry_inventory_item_id uuid
references public.processed_poultry_inventory_items(id);

create index if not exists order_items_processed_poultry_inventory_item_id_idx
on public.order_items(processed_poultry_inventory_item_id);

comment on column public.order_items.processed_poultry_inventory_item_id is
'Referenced Processed Poultry inventory item for processed-poultry-backed order lines.';

drop trigger if exists processed_poultry_inventory_items_set_updated_at
on public.processed_poultry_inventory_items;

create trigger processed_poultry_inventory_items_set_updated_at
before update on public.processed_poultry_inventory_items
for each row
execute function public.set_updated_at();

alter table public.processed_poultry_inventory_items enable row level security;

drop policy if exists "Store owners can read own processed poultry inventory"
on public.processed_poultry_inventory_items;

create policy "Store owners can read own processed poultry inventory"
on public.processed_poultry_inventory_items
for select
to authenticated
using (public.owns_store(store_id) or public.is_admin());

drop policy if exists "Platform admins can directly mutate processed poultry inventory"
on public.processed_poultry_inventory_items;

create policy "Platform admins can directly mutate processed poultry inventory"
on public.processed_poultry_inventory_items
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on public.processed_poultry_inventory_items from anon, authenticated;
grant select on public.processed_poultry_inventory_items to authenticated;

create or replace view public.seller_processed_poultry_inventory_management
with (security_barrier = true)
as
select
  processed_items.id as processed_poultry_inventory_item_id,
  processed_items.store_id,
  processed_items.product_name,
  processed_items.poultry_type,
  processed_items.product_type,
  processed_items.package_size,
  processed_items.description,
  processed_items.quantity_available,
  processed_items.price,
  processed_items.visibility_status,
  processed_items.moderation_status,
  case
    when processed_items.visibility_status = 'archived' then 'archived'
    when processed_items.moderation_status <> 'normal' then 'unavailable'
    when processed_items.visibility_status = 'sold_out' or processed_items.quantity_available <= 0 then 'sold_out'
    when processed_items.visibility_status <> 'active' then 'hidden'
    else 'ready_now'
  end as operational_availability_status,
  processed_items.seller_notes,
  processed_items.first_published_at,
  processed_items.archived_at,
  processed_items.created_at,
  processed_items.updated_at
from public.processed_poultry_inventory_items as processed_items
where public.owns_store(processed_items.store_id)
   or public.is_admin();

grant select on public.seller_processed_poultry_inventory_management to authenticated;

create or replace function public.validate_processed_poultry_module_enabled(p_store_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
begin
  select stores.processed_poultry_enabled
  into v_enabled
  from public.stores
  where stores.id = p_store_id;

  if v_enabled is distinct from true then
    raise exception 'Processed Poultry is turned off for this store.';
  end if;
end;
$$;

create or replace function public.validate_processed_poultry_inventory_values(
  p_product_name text,
  p_poultry_type text,
  p_product_type text,
  p_quantity_available integer,
  p_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_product_name), '') is null then
    raise exception 'Product name is required.';
  end if;

  if p_poultry_type not in ('Chicken', 'Turkey', 'Duck', 'Goose', 'Other') then
    raise exception 'Choose a supported poultry type.';
  end if;

  if p_product_type not in ('Whole Bird', 'Halves', 'Parts', 'Other') then
    raise exception 'Choose a supported product type.';
  end if;

  if coalesce(p_quantity_available, -1) < 0 then
    raise exception 'Quantity available must be zero or more.';
  end if;

  if coalesce(p_price, -1) < 0 then
    raise exception 'Price must be zero or more.';
  end if;
end;
$$;

create or replace function public.seller_create_processed_poultry_inventory_item(
  p_store_id uuid,
  p_product_name text,
  p_poultry_type text,
  p_product_type text,
  p_quantity_available integer,
  p_price numeric,
  p_package_size text default null,
  p_description text default null,
  p_seller_notes text default null
)
returns public.processed_poultry_inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.processed_poultry_inventory_items%rowtype;
begin
  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if not (public.owns_store(p_store_id) or public.is_admin()) then
    raise exception 'Not authorized to create processed poultry inventory.';
  end if;

  perform public.validate_processed_poultry_module_enabled(p_store_id);
  perform public.validate_processed_poultry_inventory_values(
    p_product_name,
    p_poultry_type,
    p_product_type,
    p_quantity_available,
    p_price
  );

  insert into public.processed_poultry_inventory_items (
    store_id,
    product_name,
    poultry_type,
    product_type,
    package_size,
    description,
    quantity_available,
    price,
    visibility_status,
    seller_notes
  )
  values (
    p_store_id,
    trim(p_product_name),
    p_poultry_type,
    p_product_type,
    nullif(trim(p_package_size), ''),
    nullif(trim(p_description), ''),
    coalesce(p_quantity_available, 0),
    p_price,
    'hidden',
    nullif(trim(p_seller_notes), '')
  )
  returning * into v_item;

  return v_item;
end;
$$;

create or replace function public.seller_update_processed_poultry_inventory_item(
  p_processed_poultry_inventory_item_id uuid,
  p_product_name text,
  p_poultry_type text,
  p_product_type text,
  p_quantity_available integer,
  p_price numeric,
  p_package_size text default null,
  p_description text default null,
  p_seller_notes text default null
)
returns public.processed_poultry_inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.processed_poultry_inventory_items%rowtype;
  v_updated_item public.processed_poultry_inventory_items%rowtype;
begin
  select processed_items.*
  into v_item
  from public.processed_poultry_inventory_items as processed_items
  where processed_items.id = p_processed_poultry_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Processed poultry inventory not found.';
  end if;

  if not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Not authorized to update this processed poultry inventory.';
  end if;

  if v_item.visibility_status = 'archived' then
    raise exception 'Archived processed poultry inventory cannot be edited.';
  end if;

  perform public.validate_processed_poultry_inventory_values(
    p_product_name,
    p_poultry_type,
    p_product_type,
    p_quantity_available,
    p_price
  );

  update public.processed_poultry_inventory_items as processed_items
  set
    product_name = trim(p_product_name),
    poultry_type = p_poultry_type,
    product_type = p_product_type,
    package_size = nullif(trim(p_package_size), ''),
    description = nullif(trim(p_description), ''),
    quantity_available = coalesce(p_quantity_available, 0),
    price = p_price,
    seller_notes = nullif(trim(p_seller_notes), '')
  where processed_items.id = v_item.id
  returning processed_items.* into v_updated_item;

  return v_updated_item;
end;
$$;

create or replace function public.seller_adjust_processed_poultry_inventory_quantity(
  p_processed_poultry_inventory_item_id uuid,
  p_quantity_available integer default null,
  p_quantity_delta integer default null
)
returns public.processed_poultry_inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.processed_poultry_inventory_items%rowtype;
  v_updated_item public.processed_poultry_inventory_items%rowtype;
  v_next_quantity integer;
begin
  if (p_quantity_available is null and p_quantity_delta is null)
    or (p_quantity_available is not null and p_quantity_delta is not null) then
    raise exception 'Provide either an absolute quantity or a quantity change.';
  end if;

  select processed_items.*
  into v_item
  from public.processed_poultry_inventory_items as processed_items
  where processed_items.id = p_processed_poultry_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Processed poultry inventory not found.';
  end if;

  if not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Not authorized to update this processed poultry inventory.';
  end if;

  if v_item.visibility_status = 'archived' then
    raise exception 'Archived processed poultry inventory cannot be edited.';
  end if;

  v_next_quantity := coalesce(p_quantity_available, v_item.quantity_available + p_quantity_delta);

  if v_next_quantity < 0 then
    raise exception 'Quantity available must be zero or more.';
  end if;

  update public.processed_poultry_inventory_items as processed_items
  set quantity_available = v_next_quantity
  where processed_items.id = v_item.id
  returning processed_items.* into v_updated_item;

  return v_updated_item;
end;
$$;

create or replace function public.seller_set_processed_poultry_inventory_visibility(
  p_processed_poultry_inventory_item_id uuid,
  p_visibility_status text
)
returns public.processed_poultry_inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.processed_poultry_inventory_items%rowtype;
  v_updated_item public.processed_poultry_inventory_items%rowtype;
begin
  if p_visibility_status not in ('active', 'hidden', 'sold_out', 'archived') then
    raise exception 'Choose a supported visibility status.';
  end if;

  select processed_items.*
  into v_item
  from public.processed_poultry_inventory_items as processed_items
  where processed_items.id = p_processed_poultry_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Processed poultry inventory not found.';
  end if;

  if not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Not authorized to update this processed poultry inventory.';
  end if;

  if v_item.visibility_status = 'archived' and p_visibility_status <> 'archived' then
    raise exception 'Archived processed poultry inventory cannot be restored yet.';
  end if;

  update public.processed_poultry_inventory_items as processed_items
  set
    visibility_status = p_visibility_status,
    first_published_at = case
      when p_visibility_status in ('active', 'sold_out') then coalesce(processed_items.first_published_at, now())
      else processed_items.first_published_at
    end,
    archived_at = case
      when p_visibility_status = 'archived' then coalesce(processed_items.archived_at, now())
      else null
    end
  where processed_items.id = v_item.id
  returning processed_items.* into v_updated_item;

  return v_updated_item;
end;
$$;

create or replace function public.seller_get_processed_poultry_draft_delete_status(
  p_processed_poultry_inventory_item_id uuid
)
returns table (
  is_draft boolean,
  has_order_history boolean,
  has_published_activity boolean,
  can_delete boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.processed_poultry_inventory_items%rowtype;
  v_is_draft boolean;
  v_has_order_history boolean;
  v_has_published_activity boolean;
begin
  select processed_items.*
  into v_item
  from public.processed_poultry_inventory_items as processed_items
  where processed_items.id = p_processed_poultry_inventory_item_id;

  if v_item.id is null then
    raise exception 'Processed poultry inventory not found.';
  end if;

  if not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Not authorized to inspect this processed poultry inventory.';
  end if;

  v_is_draft := v_item.visibility_status = 'hidden';
  v_has_order_history := exists (
    select 1
    from public.order_items as order_items
    where order_items.processed_poultry_inventory_item_id = v_item.id
  );
  v_has_published_activity := v_item.first_published_at is not null;

  return query
  select
    v_is_draft,
    v_has_order_history,
    v_has_published_activity,
    v_is_draft and not v_has_order_history and not v_has_published_activity;
end;
$$;

create or replace function public.seller_delete_processed_poultry_draft(
  p_processed_poultry_inventory_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.processed_poultry_inventory_items%rowtype;
begin
  select processed_items.*
  into v_item
  from public.processed_poultry_inventory_items as processed_items
  where processed_items.id = p_processed_poultry_inventory_item_id
  for update;

  if v_item.id is null then
    raise exception 'Processed poultry inventory not found.';
  end if;

  if not (public.owns_store(v_item.store_id) or public.is_admin()) then
    raise exception 'Not authorized to delete this processed poultry draft.';
  end if;

  if v_item.visibility_status <> 'hidden' then
    raise exception 'Only drafts can be deleted.';
  end if;

  if v_item.first_published_at is not null then
    raise exception 'This processed poultry inventory has been published before and can only be archived.';
  end if;

  if exists (
    select 1
    from public.order_items as order_items
    where order_items.processed_poultry_inventory_item_id = v_item.id
  ) then
    raise exception 'This processed poultry inventory has order history and can only be archived.';
  end if;

  delete from public.media_links as media_links
  where media_links.store_id = v_item.store_id
    and media_links.entity_type = 'processed_poultry_inventory_item'
    and media_links.entity_id = v_item.id;

  delete from public.processed_poultry_inventory_items as processed_items
  where processed_items.id = v_item.id;
end;
$$;

alter table public.media_links
  drop constraint if exists media_links_entity_type_check;

alter table public.media_links
  add constraint media_links_entity_type_check check (
    entity_type in (
      'store',
      'seller_breed_profile',
      'listing_batch',
      'listing_batch_breed',
      'inventory_item',
      'equipment_inventory_item',
      'processed_poultry_inventory_item'
    )
  );

create or replace function public.validate_seller_media_entity(
  p_store_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_store_id is null or p_entity_type is null or p_entity_id is null then
    return false;
  end if;

  case p_entity_type
    when 'store' then
      return p_entity_id = p_store_id and exists (
        select 1 from public.stores as stores where stores.id = p_store_id
      );
    when 'listing_batch' then
      return exists (
        select 1 from public.listing_batches as listing_batches
        where listing_batches.id = p_entity_id and listing_batches.store_id = p_store_id
      );
    when 'listing_batch_breed' then
      return exists (
        select 1 from public.listing_batch_breeds as listing_batch_breeds
        where listing_batch_breeds.id = p_entity_id and listing_batch_breeds.store_id = p_store_id
      );
    when 'inventory_item' then
      return exists (
        select 1 from public.inventory_items as inventory_items
        where inventory_items.id = p_entity_id and inventory_items.store_id = p_store_id
      );
    when 'seller_breed_profile' then
      return exists (
        select 1 from public.seller_breed_profiles as seller_breed_profiles
        where seller_breed_profiles.id = p_entity_id and seller_breed_profiles.store_id = p_store_id
      );
    when 'equipment_inventory_item' then
      return exists (
        select 1 from public.equipment_inventory_items as equipment_items
        where equipment_items.id = p_entity_id and equipment_items.store_id = p_store_id
      );
    when 'processed_poultry_inventory_item' then
      return exists (
        select 1 from public.processed_poultry_inventory_items as processed_items
        where processed_items.id = p_entity_id and processed_items.store_id = p_store_id
      );
    else
      return false;
  end case;
end;
$$;

create or replace function public.validate_seller_media_context(
  p_entity_type text,
  p_display_context text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_entity_type
    when 'store' then p_display_context in ('logo', 'hero', 'gallery')
    when 'listing_batch' then p_display_context in ('primary', 'gallery')
    when 'listing_batch_breed' then p_display_context in ('primary', 'gallery')
    when 'inventory_item' then p_display_context in ('primary', 'gallery')
    when 'seller_breed_profile' then p_display_context in ('primary', 'gallery')
    when 'equipment_inventory_item' then p_display_context in ('primary', 'gallery')
    when 'processed_poultry_inventory_item' then p_display_context in ('primary', 'gallery')
    else false
  end;
$$;

create or replace function public.enforce_processed_poultry_media_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_active_count integer;
begin
  if new.entity_type <> 'processed_poultry_inventory_item'
    or new.display_context <> 'gallery'
    or new.visibility_status <> 'active' then
    return new;
  end if;

  select count(*)
  into v_active_count
  from public.media_links as media_links
  join public.media_assets as media_assets
    on media_assets.id = media_links.media_asset_id
   and media_assets.store_id = media_links.store_id
  where media_links.entity_type = new.entity_type
    and media_links.entity_id = new.entity_id
    and media_links.display_context = new.display_context
    and media_links.visibility_status = 'active'
    and media_links.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and media_assets.asset_status = 'active';

  if v_active_count >= 4 then
    raise exception 'Processed Poultry can have up to 4 photos.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_processed_poultry_media_limit_trigger on public.media_links;

create trigger enforce_processed_poultry_media_limit_trigger
before insert or update of entity_type, entity_id, display_context, visibility_status
on public.media_links
for each row
execute function public.enforce_processed_poultry_media_limit();

revoke all on function public.get_seller_context() from public;
revoke all on function public.seller_update_store_settings(uuid, jsonb) from public;
revoke all on function public.validate_processed_poultry_module_enabled(uuid) from public;
revoke all on function public.validate_processed_poultry_inventory_values(text, text, text, integer, numeric) from public;
revoke all on function public.seller_create_processed_poultry_inventory_item(uuid, text, text, text, integer, numeric, text, text, text) from public;
revoke all on function public.seller_update_processed_poultry_inventory_item(uuid, text, text, text, integer, numeric, text, text, text) from public;
revoke all on function public.seller_adjust_processed_poultry_inventory_quantity(uuid, integer, integer) from public;
revoke all on function public.seller_set_processed_poultry_inventory_visibility(uuid, text) from public;
revoke all on function public.seller_get_processed_poultry_draft_delete_status(uuid) from public;
revoke all on function public.seller_delete_processed_poultry_draft(uuid) from public;
revoke all on function public.enforce_processed_poultry_media_limit() from public;

grant execute on function public.get_seller_context() to authenticated;
grant execute on function public.seller_update_store_settings(uuid, jsonb) to authenticated;
grant execute on function public.seller_create_processed_poultry_inventory_item(uuid, text, text, text, integer, numeric, text, text, text) to authenticated;
grant execute on function public.seller_update_processed_poultry_inventory_item(uuid, text, text, text, integer, numeric, text, text, text) to authenticated;
grant execute on function public.seller_adjust_processed_poultry_inventory_quantity(uuid, integer, integer) to authenticated;
grant execute on function public.seller_set_processed_poultry_inventory_visibility(uuid, text) to authenticated;
grant execute on function public.seller_get_processed_poultry_draft_delete_status(uuid) to authenticated;
grant execute on function public.seller_delete_processed_poultry_draft(uuid) to authenticated;

commit;
