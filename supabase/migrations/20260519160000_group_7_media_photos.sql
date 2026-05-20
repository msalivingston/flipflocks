-- Group 7: Media / Photos
-- Tables:
-- - media_assets
-- - media_links
--
-- Scope:
-- - Creates a reusable media/photo architecture for seller-owned images.
-- - Supports photos for stores, seller breed profiles, listing batches,
--   listing batch breeds, and inventory items.
-- - Does not create storage buckets, storage policies, public storefront views,
--   RPCs, image processing, thumbnail generation, moderation integrations,
--   standard product tables, or app code.
--
-- Architecture:
-- - media_assets stores uploaded image metadata and storage object identity.
-- - media_links connects media assets to business entities through a
--   polymorphic entity_type/entity_id pair.
--
-- Storage:
-- - Do not store public URLs.
-- - bucket_name + storage_path are the source of truth.
-- - Storage bucket creation and storage.objects policies are out of scope.
--
-- Public reads:
-- - Public read policies are intentionally omitted.
-- - Future public storefront reads should use a public-safe view/RPC that
--   exposes only approved, visible media for live storefronts.
--
-- Server/API validation required:
-- - media_links.media_asset_id belongs to the same store_id.
-- - linked entity exists.
-- - linked entity belongs to media_links.store_id.
-- - entity_type controls which table entity_id refers to.
-- - uploaded storage paths should follow a trusted store-owned path convention.

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,
  uploaded_by_user_id uuid references auth.users(id),

  bucket_name text not null,
  storage_path text not null,

  original_filename text,
  content_type text not null,
  file_size_bytes bigint not null,

  width_px integer,
  height_px integer,

  alt_text text,

  asset_status text not null default 'active',
  moderation_status text not null default 'pending',
  moderation_reason text,
  moderation_checked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint media_assets_bucket_name_not_empty_check check (
    length(trim(bucket_name)) > 0
  ),

  constraint media_assets_storage_path_not_empty_check check (
    length(trim(storage_path)) > 0
  ),

  constraint media_assets_bucket_path_unique unique (
    bucket_name,
    storage_path
  ),

  constraint media_assets_original_filename_not_empty_check check (
    original_filename is null
    or length(trim(original_filename)) > 0
  ),

  constraint media_assets_content_type_check check (
    content_type in (
      'image/jpeg',
      'image/png',
      'image/webp'
    )
  ),

  constraint media_assets_file_size_positive_check check (
    file_size_bytes > 0
  ),

  constraint media_assets_width_positive_when_present_check check (
    width_px is null
    or width_px > 0
  ),

  constraint media_assets_height_positive_when_present_check check (
    height_px is null
    or height_px > 0
  ),

  constraint media_assets_alt_text_not_empty_check check (
    alt_text is null
    or length(trim(alt_text)) > 0
  ),

  constraint media_assets_asset_status_check check (
    asset_status in ('active', 'archived')
  ),

  constraint media_assets_moderation_status_check check (
    moderation_status in ('pending', 'approved', 'needs_review', 'rejected')
  ),

  constraint media_assets_moderation_reason_not_empty_check check (
    moderation_reason is null
    or length(trim(moderation_reason)) > 0
  ),

  constraint media_assets_id_store_unique unique (
    id,
    store_id
  )
);

comment on table public.media_assets is
'Uploaded seller-owned image metadata. bucket_name and storage_path are the storage source of truth; public URLs are intentionally not stored.';

comment on column public.media_assets.store_id is
'Tenant ownership field used for RLS and seller/admin access checks.';

comment on column public.media_assets.uploaded_by_user_id is
'User who uploaded the media asset when known.';

comment on column public.media_assets.bucket_name is
'Supabase Storage bucket name. Bucket creation and storage policies are out of scope for Group 7.';

comment on column public.media_assets.storage_path is
'Supabase Storage object path. Should follow a trusted store-owned path convention enforced by server/API code.';

comment on column public.media_assets.alt_text is
'Default alt text for this image asset. Entity-specific overrides belong on media_links.';

comment on column public.media_assets.asset_status is
'Asset lifecycle status. Sellers should archive assets rather than hard delete where practical.';

comment on column public.media_assets.moderation_status is
'Image moderation status for future automated or manual screening. Public storefront projections should expose only approved media.';

comment on constraint media_assets_id_store_unique
on public.media_assets is
'Supports composite references from media_links so linked media must belong to the same store.';


create table public.media_links (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,
  media_asset_id uuid not null,

  entity_type text not null,
  entity_id uuid not null,

  display_context text not null default 'gallery',
  sort_order integer not null default 0,
  is_featured boolean not null default false,

  alt_text_override text,
  caption text,

  visibility_status text not null default 'active',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint media_links_asset_same_store_fk foreign key (
    media_asset_id,
    store_id
  ) references public.media_assets(id, store_id) on delete cascade,

  constraint media_links_entity_type_check check (
    entity_type in (
      'store',
      'seller_breed_profile',
      'listing_batch',
      'listing_batch_breed',
      'inventory_item'
    )
  ),

  constraint media_links_store_entity_matches_store_check check (
    entity_type <> 'store'
    or entity_id = store_id
  ),

  constraint media_links_display_context_not_empty_check check (
    length(trim(display_context)) > 0
  ),

  constraint media_links_sort_order_nonnegative_check check (
    sort_order >= 0
  ),

  constraint media_links_alt_text_override_not_empty_check check (
    alt_text_override is null
    or length(trim(alt_text_override)) > 0
  ),

  constraint media_links_caption_not_empty_check check (
    caption is null
    or length(trim(caption)) > 0
  ),

  constraint media_links_visibility_status_check check (
    visibility_status in ('active', 'hidden', 'archived')
  ),

  constraint media_links_entity_asset_unique unique (
    entity_type,
    entity_id,
    media_asset_id
  )
);

comment on table public.media_links is
'Polymorphic links connecting media assets to seller-owned business entities. Application/server validation must ensure linked entities exist and belong to the same store.';

comment on column public.media_links.store_id is
'Tenant ownership field used for RLS and seller/admin access checks. Must match both the media asset and linked entity.';

comment on column public.media_links.media_asset_id is
'Linked media asset. Composite foreign key ensures the asset belongs to the same store_id.';

comment on column public.media_links.entity_type is
'Polymorphic entity type. Determines which business table entity_id refers to.';

comment on column public.media_links.entity_id is
'Polymorphic linked entity ID. Server/API validation must verify existence and store ownership.';

comment on column public.media_links.display_context is
'Display context for the linked media, such as gallery, primary, logo, or banner.';

comment on column public.media_links.is_featured is
'Marks the featured image for a specific entity and display_context. Enforced by a partial unique index.';

comment on column public.media_links.alt_text_override is
'Optional entity-specific alt text override. Falls back to media_assets.alt_text when absent.';

comment on column public.media_links.caption is
'Optional public-facing caption for this media placement.';

comment on column public.media_links.visibility_status is
'Link visibility status: active, hidden, or archived. Public projections should expose only active links.';


-- media_assets indexes

create index media_assets_store_asset_status_idx
on public.media_assets(store_id, asset_status);

create index media_assets_store_moderation_status_idx
on public.media_assets(store_id, moderation_status);

create index media_assets_store_created_at_idx
on public.media_assets(store_id, created_at desc);


-- media_links indexes

create index media_links_store_entity_sort_order_idx
on public.media_links(store_id, entity_type, entity_id, sort_order);

create index media_links_entity_visibility_sort_order_idx
on public.media_links(entity_type, entity_id, visibility_status, sort_order);

create index media_links_media_asset_id_idx
on public.media_links(media_asset_id);

create index media_links_store_visibility_idx
on public.media_links(store_id, visibility_status);

create unique index media_links_one_featured_per_entity_context_idx
on public.media_links(entity_type, entity_id, display_context)
where is_featured = true;


-- updated_at triggers

create trigger media_assets_set_updated_at
before update on public.media_assets
for each row
execute function public.set_updated_at();

create trigger media_links_set_updated_at
before update on public.media_links
for each row
execute function public.set_updated_at();


-- RLS

alter table public.media_assets enable row level security;
alter table public.media_links enable row level security;


-- media_assets policies

create policy "Store owners can read own media assets"
on public.media_assets
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);

create policy "Store owners can insert own media assets"
on public.media_assets
for insert
to authenticated
with check (
  public.owns_store(store_id)
  or public.is_admin()
);

create policy "Store owners can update own media assets"
on public.media_assets
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

create policy "Platform admins can delete media assets"
on public.media_assets
for delete
to authenticated
using (
  public.is_admin()
);


-- media_links policies

create policy "Store owners can read own media links"
on public.media_links
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);

create policy "Store owners can insert own media links"
on public.media_links
for insert
to authenticated
with check (
  public.owns_store(store_id)
  or public.is_admin()
);

create policy "Store owners can update own media links"
on public.media_links
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

create policy "Platform admins can delete media links"
on public.media_links
for delete
to authenticated
using (
  public.is_admin()
);

-- Public read policies intentionally omitted.
-- Future public storefront reads should use public-safe views/RPCs that expose
-- only approved, active media for eligible live storefronts.
