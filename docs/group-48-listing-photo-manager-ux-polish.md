# Group 48 - Listing Photo Manager UX Polish

## Design Summary

Group 48 polishes the hidden-listing photo manager into a simple product-editor style layout while keeping the existing media architecture.

The UI now centers the seller workflow around:

- one larger featured photo
- smaller additional photo thumbnails
- an obvious add-photo slot
- simple photo order controls
- a clear 4-photo maximum

No backend migration, media library picker, drag-and-drop system, caption editor, public storefront redesign, or active-listing photo editing was added.

## Backend Support

Existing Group 32B media support was sufficient:

- `seller-media-upload` Edge Function
- `seller_archive_media_link(...)`
- `seller_set_media_featured(...)`
- `seller_reorder_media(...)`
- `seller_media_management`

Featured selection uses the existing media link `is_featured` support.

Reorder uses the existing media link `sort_order` support through `seller_reorder_media(...)`.

## Photo Limit Behavior

The hidden listing photo manager allows up to 4 active approved listing photos.

The UI:

- shows `Add up to 4 photos`
- shows the current count
- blocks upload attempts above the remaining available slots
- hides the add slot after 4 photos
- shows a maxed-out message at 4 photos

The Edge Function and storage validation still enforce file type and size. The frontend keeps the 8 MB limit and accepts JPG, PNG, and WebP.

## Featured / Reorder Behavior

Hidden listings can:

- make any photo featured
- move photos left
- move photos right
- remove photos

The first uploaded photo is still sent as featured when there are no active photos yet.

The featured photo is displayed as the main large image. Additional photos are displayed as smaller thumbnails.

## Scroll Behavior

After upload, remove, make featured, or reorder, the component requests fresh photo data and scrolls the Photos section back into view. This avoids the rough page-top jump while still using the existing parent reload pattern.

## Deferred Media Polish

- No drag-and-drop ordering.
- No captions or alt text editing.
- No media library picker.
- No active-listing photo management yet.
- No hard-delete behavior for image files.

## Recommendation for Group 49

Add a focused active-listing public content maintenance slice: active listing photos and public description edits, still separate from structural setup edits.
