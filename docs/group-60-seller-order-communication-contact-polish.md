# Group 60 - Seller Order Communication / Contact Polish

## Scope

Group 60 improves the seller order detail page so sellers can quickly contact buyers about pickup requests. It does not add messaging, notifications, email sending, SMS, new RPCs, migrations, or order lifecycle changes.

## Data Used

The order detail page continues to read from `seller_order_management` and `seller_order_item_detail`. Existing buyer/contact fields were sufficient:

- buyer first and last name snapshots
- buyer email snapshot
- buyer phone snapshot
- buyer pickup/contact address snapshots
- buyer notes
- pickup note

`seller_order_management` does not currently expose a buyer business/company snapshot, so this group did not add a company display placeholder.

## UX Changes

The order detail sidebar now has a clearer `Buyer contact` section with tap-friendly rows for:

- buyer name
- buyer email
- buyer phone

Email and phone rows include direct actions:

- `Email buyer`
- `Call buyer`
- `Copy email`
- `Copy phone`

The notes area was renamed to `Pickup / order notes` and uses plain empty-state wording when buyer or pickup notes are missing.

## Deferred

- In-app messaging
- Sending emails or SMS from FlockFront
- Buyer notification changes
- Seller-editable order notes
- Adding buyer business/company snapshot to the seller projection
