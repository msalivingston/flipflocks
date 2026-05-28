# Group 50 - Active Listing Public Content Maintenance

## Design Summary

Group 50 lets sellers maintain buyer-facing content on active listings without returning the listing to hidden.

This keeps active maintenance separate from hidden setup editing:

- hidden listings keep broad setup editing
- active listings can update public listing content
- structural setup fields remain read-only while active

No backend migration, media architecture change, storefront redesign, checkout change, visibility change, archive/delete behavior, or bird-group restructuring was added.

## Active Public-Content Scope

Active listings can update:

- public description
- listing photos
- featured photo
- photo order
- photo removal

Active listings cannot update in this group:

- species
- breed
- hatch/origin date
- available date
- bird-group structure
- bird type
- add/remove bird groups
- listing visibility
- archive/delete lifecycle state

## Public Description Behavior

Public description continues to use the existing Group 42 path:

- `seller_breed_profiles.seller_description`
- `seller_upsert_breed_profile(...)`

The active listing detail page now has an `Update Public Listing Content` section with `Update buyer description`.

The single-breed limitation remains: if a future listing has multiple breed profiles, the UI shows a safe error rather than applying one description to multiple profiles.

## Photo Behavior

The existing listing photo manager is now reusable for active public-content maintenance.

Active listings can use the existing photo controls:

- add photos
- remove photos
- make featured
- move left
- move right

The existing 4-photo limit, JPG/PNG/WebP validation, 8 MB limit, upload Edge Function, reorder RPC, featured RPC, and archive-link behavior remain unchanged.

## Seller-Facing Terminology

The UI uses:

- `Update Public Listing Content`
- `Update buyer description`
- `Update the photos buyers see on this live listing`

It does not expose media asset, entity, projection, visibility enum, or RPC terminology.

## Recommendation for Group 51

Review live listing lifecycle gaps next. The likely next focused slice is archive-with-warning for retired listings, or a seller-facing sold-out status review if quantity-zero behavior needs clearer seller control.
