# Group 64B - Batch Breed Profile Upsert Diagnosis

## Root Cause

The batch save flow only loaded active, normal seller breed profiles. Catalog breeds such as Marans could still have an existing seller breed profile for the store in a hidden or archived state. Because those profiles were not loaded, the batch form treated the selected breed as a fresh catalog breed and called `seller_upsert_breed_profile` without `p_seller_breed_profile_id`.

That made the failing path depend on conflict-based upsert behavior instead of the existing profile update path. The working existing-profile path already has the profile id available and bypasses this issue.

## Corrected Payload Handling

The batch form now:

- Loads all normal seller breed profiles for the store.
- Shows only active profiles in the breed picker, preserving the current UI behavior.
- Resolves selected catalog breeds against all normal profiles before calling the RPC.
- Reuses active existing profiles directly.
- Reactivates hidden or archived existing profiles by calling `seller_upsert_breed_profile` with `p_seller_breed_profile_id`.
- Continues to create a new profile through `seller_upsert_breed_profile` when no seller profile exists yet.

The corrected profile-id update payload includes:

- `p_store_id`
- `p_species_id`
- `p_breed_id`
- `p_custom_breed_name`
- `p_display_name`
- `p_seller_description`
- `p_seller_notes`
- `p_visibility_status: "active"`
- `p_seller_breed_profile_id`

## Debug Visibility

Development logging now includes the RPC payload and the normalized Supabase error fields:

- `message`
- `details`
- `hint`
- `code`

The seller-facing error remains plain and does not expose raw database terms.

## Backend Functions Used

- `seller_upsert_breed_profile(...)`
- `seller_create_listing_batch_with_inventory(...)`

No migration or new RPC was added.
