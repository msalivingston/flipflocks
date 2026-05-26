# FlipFlocks V1 Scope

## Current Implementation Status

Core backend architecture is complete through Group 28 and is frozen for V1 implementation. Future migrations should be limited to reference seed data, verified implementation/testing defects, security hardening, performance indexes, or proven missing V1 requirements.

The next phase is:

1. Reference seed data
2. Edge Functions
3. Seller dashboard UI
4. Public storefront and checkout UI
5. End-to-end testing

## V1 Product Scope

FlipFlocks V1 is a direct-link seller storefront platform for livestock sellers, poultry-first but not poultry-only.

V1 supports:

- independent seller storefronts
- hosted storefronts
- embedded storefront mode as an architectural target
- private/inactive storefront mode
- seller onboarding
- local pickup workflows
- batches
- breed-within-batch groupings
- inventory items
- guest checkout
- pay-at-pickup orders
- optional seller-connected Stripe checkout
- customer records created from guest checkout
- seller storefront profiles
- seller pickup/cancellation policy text
- minimal admin controls
- Supabase RLS-based tenant isolation
- Stripe-hosted/prebuilt payment architecture, without raw card handling or marketplace payout flows

## Explicitly Not V1

Do not build these unless a later project decision explicitly changes scope:

- no-email customer support
- centralized marketplace browsing
- platform-wide buyer search across stores
- public seller directory
- public "find sellers near me" feature
- aggregated inventory feed
- marketplace recommendation systems
- shipping systems
- shipping labels or rates
- shipped hatching eggs
- transport logistics systems
- appointment scheduling system
- automated reminder system
- buyer self-service order editing
- deposit or partial payment logic
- buyer accounts
- internal messaging
- buyer/seller inboxes
- chat
- reviews or ratings
- auctions
- escrow
- wallet systems
- platform-held buyer payments
- Stripe Connect/payouts
- platform-managed refunds for seller sales
- chargeback/dispute management
- accounting exports
- advanced analytics
- social/community features
- pedigree management
- advanced reservation logic
- temporary inventory holds
- checkout countdown timers
- enterprise CRM features
- marketing funnels
- lead scoring
- email campaign tools
- loyalty systems
- saved carts/account carts
- AI recommendations
- arbitrary plugins/extensions

## Buyer Flow V1

Buyers browse within a seller storefront by species, breed, ready date, and inventory type.

Buyer-facing language should use:

- Ready Date
- Pickup Schedule
- Pickup Information

Avoid exposing backend terms such as fulfillment group.

Buyers may order across multiple ready dates in one order. Internally, the system can group orders by ready date for seller operations, but that complexity should remain mostly invisible to buyers.

Cart behavior should be lightweight. Items may stay in cart using browser local storage. Do not build a complex account-based saved cart system in V1.

## Pickup Coordination — V1

## Pickup Coordination — V1

V1 is local pickup focused.

Seller configures global storefront-level pickup information:

- pickup location/general area
- pickup policy
- cancellation policy
- optional pickup instructions

Exact pickup address should not be shown publicly unless the seller intentionally chooses to do so. Exact pickup instructions may be revealed after order confirmation or handled manually by the seller.

### Seller-Defined Pickup Options

Sellers may optionally create a list of pickup choices that buyers select during checkout.
Pickup options are optional. Sellers who prefer open-ended coordination may skip pickup options entirely and rely on buyer notes instead.

These are simple seller-defined dropdown labels. They are not freeform scheduled pickup dates, appointment slots, capacity-managed slots, or calendar bookings.

Examples:

- Thursday afternoon pickup
- Friday morning pickup
- Saturday by appointment
- Farm pickup
- Delivery route / transport stop if later supported

The selected pickup option is stored with the order and displayed in seller-facing order management screens.

Sellers may edit the selected pickup option after order creation to accommodate reschedules, transport changes, weather delays, hatch timing changes, or other real-world farm adjustments.

To preserve historical accuracy, orders store both:

- pickup_option_id
- pickup_option_label (snapshot at time of order)

This prevents later edits to pickup options from changing historical order records.

V1 intentionally does not include:

- appointment scheduling
- calendar integrations
- automated availability management
- pickup slot capacity limits
- automated rescheduling workflows
- automated reminder systems

## Payment V1

FlipFlocks supports two seller-facing order payment modes:

1. Pay at pickup
2. Stripe-hosted/prebuilt checkout

Sellers remain responsible for their animal sales. Stripe Connect, seller payout flows, split payments, and marketplace-style payment administration are deferred.

FlipFlocks does not handle raw card data, hold funds, collect seller bank details, collect SSNs, or manage seller payout compliance.

Platform billing is separate from buyer payments. Sellers pay FlipFlocks for platform access through Stripe-hosted subscription billing.

## Taxes and Fees V1

V1 uses seller responsibility language.

Sellers may optionally set a tax/local fee percentage at checkout with:

- percentage
- buyer-facing label
- optional note

Suggested buyer-facing label: Sales Tax / Local Fees

Required disclaimer concept:

Sellers are responsible for determining and collecting any applicable taxes, fees, permits, or compliance requirements for their sales.

## Store Statuses

Operational store status values:

- `draft`
- `live`
- `paused`
- `dormant`
- `suspended`
- `canceled`

Definitions:

- `draft`: seller is setting up and store is not public
- `live`: storefront is public through direct link
- `paused`: seller paused selling; listings are hidden; storefront may show paused message or be hidden depending on settings
- `dormant`: reduced access/data-retention billing mode; storefront and listings hidden; active selling disabled
- `suspended`: platform/admin hold; public storefront disabled immediately
- `canceled`: seller canceled; historical records retained according to policy

Paused/dormant sellers may log in and update profile, billing, and account details, but cannot create, edit, publish, or republish listings unless subscription/store access becomes active again.

Reactivated sellers do not automatically relaunch. They must manually review and republish listings.

## Billing Statuses

Subscription/billing status values:

- `trialing`
- `active`
- `past_due`
- `dormant`
- `canceled`
- `comped`
- `suspended`

V1 subscription structure:

- flat annual subscription option
- flat monthly subscription option at a higher effective monthly rate
- no free plan after trial
- no transaction fees on seller sales
- dormancy option for seasonal sellers

Dormancy preserves seller data and storefront configuration while disabling public selling activity.

## Visibility Statuses

Visibility status values for public content:

- `active`
- `hidden`
- `archived`
- `sold_out`

Use status fields rather than hard deletion for business-critical records.

## Moderation Philosophy

V1 moderation is lightweight.

Early platform growth relies on:

- manual admin review
- seller accountability
- reversible visibility controls
- basic upload screening where practical

Do not build complex automated moderation workflows in early V1.

Recommended content moderation states:

- `visible`
- `hidden`
- `flagged`

Image upload moderation may use separate states:

- `pending`
- `approved`
- `needs_review`
- `rejected`

Livestock terms such as cock, cockerel, breast, laying, or mounting should not trigger rejection by themselves.

## V1 Simplicity Rule

When architectural decisions become ambiguous, V1 should favor:

- fewer states
- fewer automations
- fewer hidden workflows
- fewer background systems
- simpler seller behavior
- simpler operational assumptions

Operational simplicity is a core platform feature.
