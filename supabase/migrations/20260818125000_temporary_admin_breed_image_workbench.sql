-- Temporary platform-admin workbench state for catalog breed image generation.
--
-- Image-family planning remains source-controlled and is intentionally not
-- stored in the production database. This migration does not recreate views or
-- change existing breed, seller, listing, inventory, or order data.

begin;

create table if not exists public.admin_breed_image_reviews (
  breed_id uuid primary key references public.breeds(id) on delete restrict,
  status text not null,
  candidate_storage_path text,
  generation_mode text,
  last_error text,
  generated_by_user_id uuid references auth.users(id) on delete set null,
  approved_by_user_id uuid references auth.users(id) on delete set null,
  generated_at timestamptz,
  approved_at timestamptz,
  skipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_breed_image_reviews_status_check check (
    status in ('generating', 'candidate_ready', 'approved', 'skipped', 'generation_failed')
  ),
  constraint admin_breed_image_reviews_generation_mode_check check (
    generation_mode is null
    or generation_mode in ('master', 'representative', 'derivative')
  ),
  constraint admin_breed_image_reviews_candidate_status_check check (
    status <> 'candidate_ready'
    or nullif(trim(coalesce(candidate_storage_path, '')), '') is not null
  )
);

comment on table public.admin_breed_image_reviews is
'Temporary service-role-only workflow state for platform catalog breed image candidates. Image-family planning metadata is not stored here.';

alter table public.admin_breed_image_reviews enable row level security;

revoke all on table public.admin_breed_image_reviews from public;
revoke all on table public.admin_breed_image_reviews from anon;
revoke all on table public.admin_breed_image_reviews from authenticated;
grant all on table public.admin_breed_image_reviews to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'breed-image-workbench',
  'breed-image-workbench',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
