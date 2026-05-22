-- Group 9A: Breed Catalog Schema Refinement
-- Scope:
-- - Add public.breeds catalog fields needed for V1 selectable breed/variety records.
-- - No breed data cleanup.
-- - No inserts.
-- - No deactivations.
-- - No ID changes.

alter table public.breeds
add column if not exists description text;

alter table public.breeds
add column if not exists image_prompt text;

alter table public.breeds
add column if not exists image_url text;

alter table public.breeds
add column if not exists category text;

comment on column public.breeds.description is
'Platform-managed breed/variety description used as default catalog information. Seller-specific public descriptions belong in seller_breed_profiles.';

comment on column public.breeds.image_prompt is
'Prompt seed for future generated default breed images. Should describe breed appearance generically and avoid seller-specific claims.';

comment on column public.breeds.image_url is
'Nullable default breed image URL or storage path for future catalog/storefront fallback images. Seller/listing media remains separate.';

comment on column public.breeds.category is
'Optional platform-managed catalog grouping for browsing/filtering, such as standard, bantam, ornamental, waterfowl, gamebird, rabbit, or other future categories.';
