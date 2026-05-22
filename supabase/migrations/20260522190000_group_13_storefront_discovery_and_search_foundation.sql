-- Group 13: Storefront Discovery and Search Foundation
-- Objects:
-- - storefront_discovery_settings
-- - public_discoverable_storefronts
-- - public_discoverable_inventory
-- - public_breed_availability
--
-- Scope:
-- - Adds opt-in public discovery settings for stores.
-- - Builds public discovery views on top of Group 8 public-safe views.
-- - Supports simple store, inventory, species, breed, category, and location browsing.
-- - Uses normal views, not materialized views.
-- - Does not create search RPCs, buyer accounts, saved searches, alerts,
--   messaging, reviews, paid placement, map/radius search, embeddable widgets,
--   or buyer self-edit order links.


create table public.storefront_discovery_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,

  is_discoverable boolean not null default false,

  service_area_summary text,
  search_keywords text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint storefront_discovery_settings_service_area_summary_not_empty_check check (
    service_area_summary is null
    or length(trim(service_area_summary)) > 0
  ),

  constraint storefront_discovery_settings_search_keywords_not_empty_check check (
    search_keywords is null
    or length(trim(search_keywords)) > 0
  )
);

comment on table public.storefront_discovery_settings is
'Store-owned opt-in settings for public directory and search discovery. Direct storefront links remain the primary product model; stores are discoverable only when is_discoverable is true.';

comment on column public.storefront_discovery_settings.store_id is
'Store these discovery settings belong to. One settings row per store.';

comment on column public.storefront_discovery_settings.is_discoverable is
'Single public discovery toggle. false means direct storefront only; true means eligible for public directory/search when the storefront is otherwise public and live.';

comment on column public.storefront_discovery_settings.service_area_summary is
'Optional public-safe summary of pickup, local delivery, or service area. Must not contain private exact address details unless intentionally public.';

comment on column public.storefront_discovery_settings.search_keywords is
'Optional seller-provided public-safe keywords to improve simple discovery search.';


insert into public.storefront_discovery_settings (
  store_id,
  is_discoverable
)
select
  stores.id,
  false
from public.stores
on conflict (store_id) do nothing;


create index storefront_discovery_settings_is_discoverable_idx
on public.storefront_discovery_settings(is_discoverable);

create index if not exists breeds_species_category_idx
on public.breeds(species_id, category);


create trigger storefront_discovery_settings_set_updated_at
before update on public.storefront_discovery_settings
for each row
execute function public.set_updated_at();


alter table public.storefront_discovery_settings enable row level security;


create policy "Store owners can read own storefront discovery settings"
on public.storefront_discovery_settings
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Store owners can insert own storefront discovery settings"
on public.storefront_discovery_settings
for insert
to authenticated
with check (
  public.owns_store(store_id)
  or public.is_admin()
);


create policy "Store owners can update own storefront discovery settings"
on public.storefront_discovery_settings
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


create policy "Platform admins can delete storefront discovery settings"
on public.storefront_discovery_settings
for delete
to authenticated
using (
  public.is_admin()
);


create or replace view public.public_discoverable_storefronts
with (security_barrier = true)
as
select
  public_storefronts.store_id,
  public_storefronts.store_slug,
  public_storefronts.store_name,
  public_storefronts.store_tagline,
  public_storefronts.public_city,
  public_storefronts.public_state,
  public_storefronts.public_country,
  public_storefronts.about_text,
  public_storefronts.pickup_policy,
  storefront_discovery_settings.service_area_summary,
  public_storefronts.website_url,
  public_storefronts.social_url,
  public_storefronts.hero_image_url,
  public_storefronts.hero_image_alt_text,
  public_storefronts.logo_image_url,
  public_storefronts.logo_image_alt_text,
  trim(concat_ws(
    ' ',
    public_storefronts.store_name,
    public_storefronts.store_tagline,
    public_storefronts.public_city,
    public_storefronts.public_state,
    public_storefronts.public_country,
    public_storefronts.about_text,
    public_storefronts.pickup_policy,
    storefront_discovery_settings.service_area_summary,
    storefront_discovery_settings.search_keywords
  )) as search_text
from public.public_storefronts
join public.storefront_discovery_settings
  on storefront_discovery_settings.store_id = public_storefronts.store_id
where storefront_discovery_settings.is_discoverable = true;


comment on view public.public_discoverable_storefronts is
'Public-safe opt-in storefront discovery view. Built on public.public_storefronts and includes only stores with storefront_discovery_settings.is_discoverable = true.';

comment on column public.public_discoverable_storefronts.search_text is
'Composed public-safe text intended for simple V1 storefront discovery filtering/search. It is generated from public storefront fields and optional discovery keywords.';


create or replace view public.public_discoverable_inventory
with (security_barrier = true)
as
select
  public_storefronts.store_id,
  public_storefronts.store_slug,
  public_storefronts.store_name,
  public_storefronts.store_tagline,
  public_storefronts.public_city,
  public_storefronts.public_state,
  public_storefronts.public_country,
  storefront_discovery_settings.service_area_summary,

  public_storefront_breed_inventory.species_id,
  public_storefront_breed_inventory.species_name,
  public_storefront_breed_inventory.species_slug,

  public_storefront_breed_inventory.seller_breed_profile_id,
  seller_breed_profiles.breed_id,
  public_storefront_breed_inventory.breed_display_name,
  public_storefront_breed_inventory.breed_description,
  breeds.category as breed_category,

  public_storefront_breed_inventory.listing_batch_id,
  public_storefront_breed_inventory.listing_batch_breed_id,
  public_storefront_breed_inventory.inventory_item_id,

  public_storefront_breed_inventory.inventory_type,
  public_storefront_breed_inventory.custom_inventory_label,
  public_storefront_breed_inventory.quantity_available,
  public_storefront_breed_inventory.availability_status,
  public_storefront_breed_inventory.available_date,
  public_storefront_breed_inventory.is_available_now,
  public_storefront_breed_inventory.unit_price,

  public_storefront_breed_inventory.featured_image_url,
  public_storefront_breed_inventory.featured_image_alt_text,

  trim(concat_ws(
    ' ',
    public_storefronts.store_name,
    public_storefronts.store_tagline,
    public_storefronts.public_city,
    public_storefronts.public_state,
    public_storefronts.public_country,
    storefront_discovery_settings.service_area_summary,
    storefront_discovery_settings.search_keywords,
    public_storefront_breed_inventory.species_name,
    public_storefront_breed_inventory.species_slug,
    public_storefront_breed_inventory.breed_display_name,
    public_storefront_breed_inventory.breed_description,
    breeds.category,
    public_storefront_breed_inventory.inventory_type,
    public_storefront_breed_inventory.custom_inventory_label
  )) as search_text
from public.public_storefront_breed_inventory
join public.public_storefronts
  on public_storefronts.store_id = public_storefront_breed_inventory.store_id
join public.storefront_discovery_settings
  on storefront_discovery_settings.store_id = public_storefront_breed_inventory.store_id
left join public.seller_breed_profiles
  on seller_breed_profiles.id = public_storefront_breed_inventory.seller_breed_profile_id
left join public.breeds
  on breeds.id = seller_breed_profiles.breed_id
where storefront_discovery_settings.is_discoverable = true;


comment on view public.public_discoverable_inventory is
'Public-safe opt-in discovery inventory view. Built on Group 8 public-safe storefront inventory and used as the shared source for simple search, filters, and breed availability browsing.';

comment on column public.public_discoverable_inventory.search_text is
'Composed public-safe text intended for simple V1 inventory and breed discovery filtering/search. It is generated from public storefront, species, breed, category, and optional discovery keyword fields.';


create or replace view public.public_breed_availability
with (security_barrier = true)
as
select
  public_discoverable_inventory.species_id,
  public_discoverable_inventory.species_name,
  public_discoverable_inventory.species_slug,
  public_discoverable_inventory.breed_display_name,
  public_discoverable_inventory.breed_category,

  count(distinct public_discoverable_inventory.store_id) as store_count,
  count(*) filter (
    where public_discoverable_inventory.availability_status in (
      'available',
      'limited_availability',
      'coming_soon'
    )
  ) as available_inventory_count,
  coalesce(
    sum(public_discoverable_inventory.quantity_available) filter (
      where public_discoverable_inventory.availability_status in (
        'available',
        'limited_availability',
        'coming_soon'
      )
    ),
    0
  ) as total_quantity_available,
  min(public_discoverable_inventory.available_date) filter (
    where public_discoverable_inventory.availability_status in (
      'available',
      'limited_availability',
      'coming_soon'
    )
  ) as next_available_date,
  min(public_discoverable_inventory.unit_price) filter (
    where public_discoverable_inventory.availability_status in (
      'available',
      'limited_availability',
      'coming_soon'
    )
  ) as min_unit_price,
  bool_or(public_discoverable_inventory.is_available_now) as has_available_now,
  (
    array_agg(public_discoverable_inventory.featured_image_url)
      filter (where public_discoverable_inventory.featured_image_url is not null)
  )[1] as sample_image_url
from public.public_discoverable_inventory
group by
  public_discoverable_inventory.species_id,
  public_discoverable_inventory.species_name,
  public_discoverable_inventory.species_slug,
  public_discoverable_inventory.breed_display_name,
  public_discoverable_inventory.breed_category;


comment on view public.public_breed_availability is
'Public-safe opt-in breed/species/category availability browse view. Aggregates discoverable storefront inventory into buyer-friendly browse rows.';


grant select on public.public_discoverable_storefronts to anon, authenticated;
grant select on public.public_discoverable_inventory to anon, authenticated;
grant select on public.public_breed_availability to anon, authenticated;
