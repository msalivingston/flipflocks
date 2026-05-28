# Group 43 - Hidden Listing Photo Attachment UI

## Design Summary

Group 43 adds the first narrow seller-facing photo attachment UI for saved listing detail pages.

The feature is hidden-listing-only for setup write actions. Non-hidden listings can show existing photos, but live operational photo management is intentionally left for a later workflow.

No publish behavior, visibility transition, duplicate workflow, public storefront change, or broad media library manager was added.

## Backend Support Confirmed

Existing Group 32B media support covers this group:

- `seller-media` public storage bucket
- `seller-media-upload` Edge Function
- `seller_create_uploaded_media(...)`
- `seller_archive_media_link(...)`
- `seller_media_management`

No migration or new backend object was needed.

## Attachment Level

Photos are attached at:

- entity type: `listing_batch`
- display context: `gallery`

This matches the Group 32B recommendation for listing photos and keeps Group 43 focused on whole-listing photos, not inventory-row or breed-profile media.

## Upload Behavior

Hidden listings now show a `Photos` section with an `Add Photos` control.

Uploads:

- accept JPEG, PNG, and WebP
- enforce the existing 8 MB file limit in the UI before upload
- are sent through the existing `seller-media-upload` Edge Function
- are attached to the current listing batch
- make the first uploaded photo featured when the listing has no active photos

The trusted Edge Function still performs authoritative validation for file type, file size, dimensions, ownership, storage path, and metadata creation.

## Remove Behavior

Removing a photo from a hidden listing calls:

- `seller_archive_media_link(...)`

This archives the media link only. It does not hard-delete the storage object or media asset metadata.

## Readiness Behavior

The existing Group 41 readiness check already counts active approved media from `seller_media_management`. With Group 43, uploaded listing photos make the photo readiness item pass once at least one active approved photo is attached.

## Limitations

- This is not a full media library.
- Existing uploaded assets cannot be browsed and attached separately yet.
- Caption, alt text editing, reordering, and featured-photo selection remain future work.
- Photos are listing-level only in this group.

## Files Changed

- `app/dashboard/listings/[listingBatchId]/listing-detail.tsx`
- `app/dashboard/listings/[listingBatchId]/listing-photos-section.tsx`
- `docs/group-43-hidden-listing-photo-attachment-ui.md`

## Recommendation for Group 44

Add the first hidden-listing publish/go-live action, while keeping future live operational edits separate from hidden setup edits.
