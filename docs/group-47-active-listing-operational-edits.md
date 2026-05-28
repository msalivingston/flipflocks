# Group 47 - Active Listing Operational Edits

## Design Summary

Group 47 adds the first live-listing maintenance workflow. It lets sellers update availability and pricing on active listings without reopening the full hidden setup edit flow.

The workflow is intentionally narrow:

- hidden listings still use broad setup editing
- active listings get operational availability and pricing updates
- archived, sold-out, and other non-active states remain outside this group

No backend migration, projection change, visibility transition, storefront redesign, or listing structure change was added.

## Active Operational Edit Scope

Active listings can update:

- bird group quantity
- optional custom price for each active bird group

Active listings cannot update in this group:

- species
- breed
- hatch/origin date
- available date
- base listing structure
- add/remove bird groups
- bird type
- hatching egg/live bird compatibility
- photos
- visibility status
- archive/delete behavior

Quantity may be set to 0. This does not automatically unpublish the listing; existing storefront sold-out behavior remains responsible for buyer-facing availability.

## RPCs Used

- `seller_update_inventory_item(...)`
  - used only to update the existing inventory item's optional custom/group price
  - structural fields are passed through unchanged
- `seller_adjust_inventory_quantity(...)`
  - used to set the active bird group's quantity

The existing RPC ownership checks and RLS assumptions remain the security boundary. The frontend gate is only a usability guard.

## UX Decisions

- Hidden listings show `Edit Setup Details`.
- Active listings show `Update Availability & Pricing`.
- Active operational editing uses seller language:
  - bird groups
  - how many are available
  - optional custom price
- The active edit form explains that dates, breed, photos, and setup structure stay unchanged in this step.

## Validation

- Quantity must be a whole number of 0 or more.
- Optional custom price must be valid money when supplied.
- Existing hatching egg/live bird compatibility is preserved.
- Only active inventory items are included in the operational edit form.

## Known Limitations

- No unpublish, archive, or delete workflow exists yet.
- Active photo updates remain deferred.
- Public description and seller notes remain setup-oriented for now.
- Active listing add/remove group behavior remains deferred because it is a structural edit.

## Recommendation for Group 48

Add a narrow active-listing photo and public description maintenance pass, or build an unpublish/archive decision review if live-listing lifecycle controls are more urgent.
