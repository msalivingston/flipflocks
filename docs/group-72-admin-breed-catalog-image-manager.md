# Group 72: Admin Breed Catalog Image Manager

Group 72 adds a small platform-admin tool for uploading and replacing default
catalog breed images.

## Scope

- Adds `/admin/breeds`.
- Adds `/admin/breeds/[breedId]`.
- Adds a public `catalog-images` Supabase Storage bucket.
- Adds narrow admin-checked catalog breed read/update RPCs.
- Adds the `admin-catalog-breed-image-upload` Edge Function.

This group does not add breed creation, breed deletion, seller breed profile
editing, seller media writes, bulk import, impersonation, or seller dashboard
access.

## Follow-Up: Catalog Details

A small follow-up added a separate Catalog Details section below the image
manager on `/admin/breeds/[breedId]`.

Editable fields are limited to:

- `breed_name` (Base Breed)
- `variety`
- `description`
- `category` (Breed Category)
- `egg_color`
- `annual_egg_production`
- `temperament`
- `image_prompt`

Read-only fields remain:

- `breed_slug`
- `species`

The details form uses the admin-only
`admin_update_catalog_breed_details(...)` RPC. It does not update seller breed
profiles, seller media, breed identity, active state, sort order, creation
timestamps, or restore-photo behavior.

The `/admin/breeds` list sorts alphabetically by breed name for all image-status
filters. Missing-image filtering is explicit through the Image status control
and the Missing images quick button.

The details editor uses controlled dropdowns for Breed Category (`category`)
and `egg_color`. Breed Category is the sole current breed classification; the
legacy `bird_type` field is not part of the active breed schema or admin RPC
contract.

## Security Model

All breed list/detail reads go through admin-only RPCs that explicitly check
`public.is_admin()`.

Normal upload and replacement goes through the
`admin-catalog-breed-image-upload` Edge Function. The function:

- verifies the caller is authenticated,
- verifies the caller is a platform admin with `public.is_admin()`,
- validates the target breed,
- validates image bytes, type, file size, and dimensions,
- writes the object with the service role to the `catalog-images` bucket,
- updates only `public.breeds.image_url`,
- removes the uploaded object if the database update fails.

The browser does not receive broad storage write permission.

## Image Paths

Catalog uploads use versioned object paths:

```text
catalog-images/catalog/breeds/{species_slug}/{breed_slug}/{timestamp-or-random}.{ext}
```

`public.breeds.image_url` stores that bucket-prefixed path directly.

Existing static paths such as
`/catalog/breeds/chickens/rhode-island-red.png` remain supported.

## Restore Compatibility

The seller Restore Default Photo flow reads `public.breeds.image_url`, fetches
that catalog image, copies it into seller media, and marks the copied asset with:

- `source_type = 'catalog_breed_image'`
- `source_breed_id`
- `source_image_url`

Versioned catalog paths are intentional. When a platform admin replaces a
catalog image, the stored `image_url` changes, so future restore operations can
distinguish the new default from old seller-restored copies. Existing seller
media is not automatically replaced.
