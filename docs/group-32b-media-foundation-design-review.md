# Group 32B Media Foundation Design Review

Group 32B is a design review only. It does not create migrations, SQL, Edge Functions, schema changes, React code, storage buckets, commits, pushes, deployments, or remote migration application.

The goal is to identify the smallest production-safe media foundation needed before seller UI implementation for storefront logo, storefront banner, listing photos, and inventory-row photos.

## Current Architecture Assessment

The current backend already has the right core shape for a unified media architecture.

Existing media tables:

- `media_assets`
- `media_links`

Existing public media-aware projections:

- `public_storefronts`
- `public_storefront_breed_inventory`
- `public_storefront_inventory`
- `public_storefront_home`
- `public_storefront_item_detail`

Existing supported media entity types:

- `store`
- `seller_breed_profile`
- `listing_batch`
- `listing_batch_breed`
- `inventory_item`

Existing useful fields:

- `media_assets.bucket_name`
- `media_assets.storage_path`
- `media_assets.content_type`
- `media_assets.file_size_bytes`
- `media_assets.width_px`
- `media_assets.height_px`
- `media_assets.alt_text`
- `media_assets.asset_status`
- `media_assets.moderation_status`
- `media_links.entity_type`
- `media_links.entity_id`
- `media_links.display_context`
- `media_links.sort_order`
- `media_links.is_featured`
- `media_links.alt_text_override`
- `media_links.caption`
- `media_links.visibility_status`

Current architecture strengths:

- One reusable media model can support storefront, listing, inventory-row, and future seller breed profile images.
- `media_links.sort_order` already supports explicit stable ordering.
- `media_links.display_context` already supports contexts such as `logo`, `hero`, `primary`, and `gallery`.
- `media_links.is_featured` already supports one featured image per entity/context through a partial unique index.
- `media_assets.bucket_name` plus `storage_path` keeps storage identity separate from public URL generation.
- Public storefront projections already expose only active, approved, public-safe media.
- Base media tables are protected by RLS and do not have public read policies.

Current gaps:

- No Supabase Storage bucket has been created for seller media.
- No storage object policy or upload boundary is defined.
- No trusted upload Edge Function or helper exists.
- No server-generated storage path convention exists.
- No seller-safe media RPC exists to create, attach, reorder, replace, hide, or archive media.
- No server-side validation currently proves that a `media_links.entity_id` belongs to the same store for non-store entities.
- No seller-facing media management projection exists for edit screens.
- Existing public projections expose featured image fields, not full ordered galleries.
- Moderation state exists, but there is no operational moderation workflow yet.

Conclusion:

The schema foundation is mostly ready. The missing work is not a new media data model; it is a narrow production-safe upload, validation, management, and projection layer.

## Recommended Media Architecture

Use one shared media architecture for all V1 seller images.

Recommended core model:

- Continue using `media_assets` as the uploaded object metadata record.
- Continue using `media_links` as the attachment/placement record.
- Use `display_context` to distinguish use cases.
- Use `sort_order` for gallery ordering.
- Use `is_featured` for primary image selection.
- Use `visibility_status = 'archived'` to remove media from use without deleting historical metadata.
- Use `asset_status = 'archived'` only when an asset is no longer used anywhere.

Do not create separate image tables for:

- storefront logos
- storefront banners
- listing photos
- inventory-row photos

Reason:

Separate systems would duplicate ownership validation, ordering, moderation, public projection logic, and future video support. The existing `media_assets` and `media_links` model already represents the required relationships.

## Storage Recommendation

### Recommended Bucket Strategy

Create one public Supabase Storage bucket for V1 seller-facing public images.

Recommended bucket name:

- `seller-media`

Reason:

- Storefront logos, banners, listing photos, and inventory-row photos are public-facing by design.
- Existing public projections already build URLs using `/storage/v1/object/public/{bucket_name}/{storage_path}`.
- Public read access keeps buyer storefront rendering simple and cache-friendly.
- Signed read URLs add complexity without a strong V1 security benefit for public storefront images.

Do not store private seller documents, moderation-only evidence, account files, payment files, or admin-only files in this bucket.

### Alternative Considered: Private Bucket With Signed URLs

Pros:

- Allows revocation-style access patterns.
- Better fit for private documents or admin-only media.

Cons:

- Adds read-token generation, expiration handling, caching complexity, and more moving parts.
- Conflicts with current public projection assumptions.
- Does not meaningfully protect images that are intended to appear on a public storefront.

Recommendation:

Do not use signed read URLs for V1 public storefront/listing media. Revisit private buckets later only for genuinely private assets.

### Path Strategy

Use server-generated, store-scoped, randomized object paths.

Recommended pattern:

```text
stores/{store_id}/images/{yyyy}/{mm}/{media_asset_id}-{random}.{ext}
```

Examples:

```text
stores/0f4.../images/2026/05/7c2...-k9x4r2.webp
stores/0f4.../images/2026/05/189...-q81p3a.jpg
```

Path rules:

- The seller never supplies `storage_path`.
- The seller never edits `storage_path`.
- The original filename may be stored in `media_assets.original_filename`, but it should not be used as the storage object name.
- The path should be generated by a trusted Edge Function or server-side helper.
- The path should include the store ID for operational clarity and future cleanup.
- The filename should include a UUID/random suffix to prevent collisions and avoid exposing buyer/seller file naming habits.

### Naming Strategy

Accepted extensions should correspond to the stored content type:

- `.jpg` for `image/jpeg`
- `.png` for `image/png`
- `.webp` for `image/webp`

Recommended V1 upload limits:

- MIME types: `image/jpeg`, `image/png`, `image/webp`
- Maximum original file size: 8 MB
- Maximum decoded dimensions: choose a practical ceiling before implementation, such as 6000 x 6000 px

Recommended V1 processing:

- If feasible, normalize large uploads to web-optimized WebP or JPEG.
- Store final `content_type`, `file_size_bytes`, `width_px`, and `height_px` after processing.
- If image processing is deferred, still enforce MIME type, file size, and dimensions before writing `media_assets`.

## Entity Attachment Strategy

### Storefront Logo

Attach as:

- `media_links.entity_type = 'store'`
- `media_links.entity_id = stores.id`
- `media_links.display_context = 'logo'`
- `media_links.is_featured = true`
- `media_links.sort_order = 0`

Behavior:

- V1 should show one active logo.
- Replacement should archive or hide the old active logo link and create a new active featured logo link.
- The old asset can remain for audit/rollback unless no links use it and cleanup policy archives it.

Current public support:

- `public_storefronts.logo_image_url`
- `public_storefronts.logo_image_alt_text`
- `public_storefront_home.logo_image_url`
- `public_storefront_home.logo_image_alt_text`

### Storefront Banner

Attach as:

- `media_links.entity_type = 'store'`
- `media_links.entity_id = stores.id`
- `media_links.display_context = 'hero'`
- `media_links.is_featured = true`
- `media_links.sort_order = 0`

Behavior:

- V1 should show one active banner/hero image.
- Replacement should archive or hide the old active hero link and create a new active featured hero link.

Current public support:

- `public_storefronts.hero_image_url`
- `public_storefronts.hero_image_alt_text`
- `public_storefront_home.hero_image_url`
- `public_storefront_home.hero_image_alt_text`

### Listing Photos

Attach listing-level photos as:

- `media_links.entity_type = 'listing_batch'`
- `media_links.entity_id = listing_batches.id`
- `media_links.display_context = 'gallery'`
- `media_links.sort_order = 0, 1, 2, ...`
- `media_links.is_featured = true` for the primary listing photo

Behavior:

- Multiple active photos should be allowed.
- Ordering should be explicit through `sort_order`.
- One image can be featured for cards/search/listing previews.
- Listing photos should not replace seller breed profile photos.

Current public support:

- Existing public projections use listing-level media as part of featured image fallback.
- Existing public projections do not expose a full ordered listing gallery.

Recommended V1 addition:

- Add a public-safe ordered media projection or JSON field for item/detail pages if the public UI needs multiple photos.
- Add a seller-private projection for edit screens that returns all listing media links in order.

### Inventory-Row Photos

Attach row-level photos as:

- `media_links.entity_type = 'inventory_item'`
- `media_links.entity_id = inventory_items.id`
- `media_links.display_context = 'gallery'`
- `media_links.sort_order = 0, 1, 2, ...`
- `media_links.is_featured = true` for the primary row image

Behavior:

- Inventory-row photos represent the specific sellable group/row.
- They should outrank listing-level and breed-profile photos in public fallback.
- They should be optional.
- Multiple row photos should be supported even if V1 UI only displays the first few.

Current public support:

- Existing public projections use inventory-row media first in the featured image fallback.
- Existing public projections do not expose a full ordered inventory-row gallery.

Recommended V1 addition:

- Add a public-safe ordered media projection or JSON field for item/detail pages if the public UI needs multiple row photos.
- Add seller-private media projection support for row edit screens.

### Listing Batch Breed Photos

The existing schema supports:

- `media_links.entity_type = 'listing_batch_breed'`

This should remain available as an intermediate attachment level when a seller wants photos for a breed row inside a mixed listing. It is not strictly required for the four Group 32B target media types, but keeping support avoids schema churn and aligns with current public fallback order.

## Upload and Management Workflow

### Upload

Recommended V1 upload flow:

1. Authenticated seller selects an image.
2. Client sends the image to a trusted media upload Edge Function.
3. Edge Function validates:
   - authenticated user
   - store ownership
   - requested entity type
   - requested entity ownership
   - MIME type
   - file size
   - decoded dimensions, if practical
4. Edge Function generates a store-scoped randomized storage path.
5. Edge Function uploads to the public `seller-media` bucket.
6. Edge Function creates a `media_assets` row.
7. Edge Function creates or updates a `media_links` row through trusted server-side logic.
8. Edge Function returns a seller-safe media payload.

The client should not directly create arbitrary `media_assets`, `media_links`, or storage object paths.

### Attach

Attachment should be server-side and validated.

Required validation:

- The media asset belongs to the same store.
- The target entity exists.
- The target entity belongs to the same store.
- The requested `entity_type` is supported.
- The requested `display_context` is allowed for that entity type.

Recommended allowed V1 contexts:

| Entity Type | Allowed Contexts |
| --- | --- |
| `store` | `logo`, `hero`, `gallery` |
| `listing_batch` | `gallery`, `primary` |
| `listing_batch_breed` | `gallery`, `primary` |
| `inventory_item` | `gallery`, `primary` |
| `seller_breed_profile` | `gallery`, `primary` |

For V1, UI should use `gallery` plus `is_featured` for listing and inventory-row photos. `primary` can remain supported for future clarity, but the implementation should avoid requiring both patterns.

### Reorder

Recommended V1 behavior:

- Reorder updates `media_links.sort_order` for the active links attached to one entity and display context.
- The API should accept the full ordered list of link IDs.
- The server should validate all link IDs belong to the same store, entity, and display context.
- The server should rewrite sort orders to a stable sequence such as `0, 1, 2, ...`.

Reason:

Full-list reorder avoids duplicated sort values and stale drag/drop state.

### Replace

Recommended V1 behavior:

- Replacing a logo or banner uploads a new asset and creates a new active featured link.
- Existing active links for the same store and display context should be set to `archived` or `hidden`.
- The old storage object should not be immediately hard-deleted by default.

Recommended replacement modes:

- Single-slot contexts: `store/logo`, `store/hero`.
- Multi-photo contexts: listing and inventory galleries.

For single-slot contexts, replacement means "make this new image the only active link for this context."

For multi-photo contexts, replacement should mean "replace this specific media link with a new asset while preserving sort order," not "clear the whole gallery."

### Remove

Recommended V1 behavior:

- Removing from an entity should set `media_links.visibility_status = 'archived'`.
- If a removed link was featured, server logic should optionally promote the first remaining active link.
- Asset hard deletion should be admin-only or delayed cleanup.
- Storage object deletion should be handled by a future cleanup job only after no active/non-archived links reference the asset.

Reason:

Soft removal is safer for seller mistakes, public cache behavior, audit trails, and future moderation workflows.

## Security Recommendations

### Upload Permissions

Sellers should upload only through a trusted Edge Function or server endpoint.

The upload boundary should:

- Require authentication.
- Resolve seller/store ownership server-side.
- Validate the target entity before upload.
- Generate the storage path server-side.
- Enforce MIME and size limits before creating database rows.
- Use service role only inside the server boundary.
- Return only seller-safe media metadata.

Avoid direct client writes to `storage.objects`, `media_assets`, or `media_links` for production UI.

### Ownership Validation

Every media operation must validate store ownership.

For `store`:

- `entity_id` must equal `store_id`.
- Authenticated user must own the store or be admin.

For `listing_batch`:

- Listing batch must exist.
- Listing batch `store_id` must match media store ID.

For `listing_batch_breed`:

- Breed row must exist.
- Breed row `store_id` must match media store ID.

For `inventory_item`:

- Inventory item must exist.
- Inventory item `store_id` must match media store ID.

For `seller_breed_profile`:

- Breed profile must exist.
- Breed profile `store_id` must match media store ID.

### Public Image Access

Use public read access for the V1 `seller-media` bucket.

This is acceptable because:

- Storefront logo, banner, listing photos, and inventory photos are intended for public storefront display.
- Public projections already gate which media URLs appear.
- Hidden/rejected media should not be linked from public views, even though an already-known public object URL may still load.

Important implication:

Public buckets do not provide true revocation for anyone who already has a URL. This is acceptable for V1 public storefront images, but sellers should not upload private documents or sensitive files through this system.

### Moderation

Current `media_assets.moderation_status` supports:

- `pending`
- `approved`
- `needs_review`
- `rejected`

Recommended V1 launch posture:

- If no moderation service exists, uploaded seller images should start as `pending` or `approved` based on a reviewed product decision.
- Public storefront projections should continue to expose only `approved` assets.
- If immediate public display is required for V1, the upload endpoint can mark images `approved` after basic file validation, with manual admin takedown as a later operational process.
- If stricter moderation is required, upload can return success while public display waits for approval.

The decision affects product experience but not the core data model.

### Deletion Permissions

Recommended V1 deletion model:

- Sellers can archive links.
- Sellers can archive assets only if they own them.
- Admins can hard-delete records or storage objects when required.
- Storage object hard deletion should be delayed or handled by an admin/cleanup process.

### Edge Function Safety

Recommended upload Edge Function safeguards:

- Maximum request size.
- MIME sniffing, not just trusting the browser-provided content type.
- Decode image dimensions when practical.
- Reject SVG for V1 unless a separate sanitization strategy is approved.
- Normalize file extension from detected MIME type.
- Never echo service-role errors directly to clients.
- Log enough internal detail for support without exposing private storage internals to buyers.

## Future Compatibility

### Breed Image Manager

The current model is compatible with a future seller Breed Image Manager.

Future seller breed images can attach as:

- `entity_type = 'seller_breed_profile'`
- `display_context = 'gallery'` or `primary`
- ordered with `sort_order`
- featured with `is_featured`

This keeps breed profile images separate from listing-specific images, preserving the approved fallback philosophy:

1. inventory-row or listing-specific image
2. seller breed profile image
3. global breed reference/default image
4. generic species placeholder

Do not implement Breed Image Manager in Group 32B implementation.

### Breed Reference Image Catalog

Global breed reference images are a different ownership model than seller-owned images.

Current `media_assets` requires `store_id`, so it is not ideal for global platform-owned reference images without future adjustment.

Recommended future path:

- Keep seller-owned media in `media_assets`.
- Use existing breed catalog fields or a future platform media table for global breed reference images.
- Avoid forcing platform-owned reference images into store-owned seller media.

No implementation is recommended now.

### Future Video Support

The current media model can evolve toward video support but is image-only today.

Current blockers for video:

- `media_assets.content_type` only allows JPEG, PNG, and WebP.
- Public projections and comments assume image URLs.
- No transcoding, thumbnails, duration, playback metadata, or video moderation flow exists.

Recommended future-compatible choices now:

- Do not rename `media_assets` or `media_links` to image-specific table names.
- Keep `content_type` and storage metadata generic.
- Keep `display_context` generic.
- Avoid adding image-only assumptions to new RPC names where practical, except where upload validation intentionally limits V1 to images.

No video implementation should happen in Group 32B implementation.

## Ready-Now Items

Ready in the existing architecture:

- Unified asset/link schema.
- Store, listing, listing-breed, inventory-row, and seller-breed-profile attachment targets.
- Stable ordering through `sort_order`.
- Featured image selection through `is_featured`.
- Public URL construction for public bucket objects.
- Public storefront logo/banner featured image fields.
- Public featured image fallback for inventory rows.
- Public-safe filtering to active links and approved active assets.
- Seller/private RLS on base media tables.

## Potential Gaps

Blocking gaps before production media UI:

- Storage bucket creation.
- Storage upload permissions/policies.
- Trusted upload boundary.
- Server-generated path convention.
- Entity ownership validation for non-store media links.
- Seller-safe media management RPCs or Edge Function actions.
- Seller-private media projection for edit screens.
- Public full-gallery projection if V1 public item detail should show multiple photos.
- Moderation launch decision.

Non-blocking gaps:

- Image resizing/compression can be deferred if strict upload limits are enforced.
- Thumbnail generation can be deferred if UI can use original public images responsibly.
- Asset cleanup/hard deletion can be deferred in favor of link archiving.
- Breed Image Manager can be deferred.
- Video support can be deferred.

## Recommended Implementation Scope for Group 32B

The smallest safe implementation group should include only media foundation work required for seller UI uploads.

Recommended scope:

1. Create one public Supabase Storage bucket:
   - `seller-media`

2. Add a trusted media upload boundary:
   - authenticated seller only
   - service-role storage write inside the server boundary
   - server-generated store-scoped randomized path
   - MIME, size, and dimension validation
   - creates `media_assets`
   - creates initial `media_links`

3. Add seller-safe media management operations:
   - attach existing asset to supported entity
   - reorder links for one entity/context
   - replace single-slot media such as logo/banner
   - replace one gallery item while preserving sort order
   - archive/remove a link
   - set featured image
   - update alt text/caption

4. Add entity ownership validation:
   - validate store
   - validate listing batch
   - validate listing batch breed
   - validate inventory item
   - validate seller breed profile

5. Add seller media read projection:
   - media asset ID
   - link ID
   - entity type and ID
   - display context
   - public URL
   - alt text
   - caption
   - sort order
   - featured flag
   - asset/link status
   - moderation status
   - created/updated timestamps

6. Add public gallery support only if needed for first-pass UI:
   - ordered public media for listing or inventory item detail
   - active links only
   - active approved assets only
   - eligible live storefronts only

7. Document moderation behavior:
   - either auto-approve after basic validation for V1
   - or keep pending until an admin/moderation process approves

Explicitly out of scope for Group 32B implementation:

- Equipment & Supplies media.
- Breed Image Manager.
- Global breed reference image catalog.
- Video upload or playback.
- Private/signed URL media delivery.
- Full media library UI.
- Drag/drop React implementation.
- Stripe or payment files.
- AI image generation.
- Advanced image moderation automation.

## Final Recommendation

Use the existing `media_assets` and `media_links` architecture.

Add one public `seller-media` storage bucket and a narrow trusted media upload/management layer. Keep public reads simple through existing public URL conventions and public-safe projections. Use `media_links` for all attachments, ordering, featured selection, replacement, and removal behavior.

This is the smallest production-safe path because it preserves the existing schema foundation, avoids separate image systems, supports multiple ordered photos, keeps seller storage paths server-managed, and remains compatible with future breed profile images and video without implementing either now.
