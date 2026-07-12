# FlockFront V1 Core Architecture

## Backend Architecture Status

Core backend architecture is complete through Group 28 and is frozen for V1 implementation. Groups 1-28 have been reviewed, applied to the remote Supabase project, committed, and pushed.

Future migrations should be limited to reference seed data, defects found during implementation or testing, security hardening, performance indexes, or proven missing V1 requirements.

The next implementation phase is:

1. Reference seed data
2. Edge Functions for Stripe, notifications, and integration workers
3. Seller dashboard UI
4. Public storefront and checkout UI
5. End-to-end testing

## Platform Identity

FlockFront is seller storefront infrastructure for livestock sellers. It is not a centralized public marketplace.

Each seller operates an independent storefront. Buyers primarily access storefronts through direct seller links, social media, breeder referrals, farm websites, QR codes, email campaigns, or local community groups.

V1 intentionally avoids centralized marketplace discovery. There is no platform-wide buyer browsing across sellers, no aggregated inventory feed, and no public "find sellers near me" system.

The platform prioritizes seller independence, simple operational workflows, privacy-conscious design, local pickup workflows, and lightweight ecommerce infrastructure.

## Canonical Data Hierarchy

The official V1 inventory hierarchy is:

Store
→ Batch
→ Breed Within Batch
→ Inventory Item

### Store

A seller's storefront/business presence on FlockFront.

The database table should be named `stores`. The public-facing experience may be called a storefront.

### Batch

A seller-created inventory grouping representing:

- one species
- one hatch, birth, or acquisition date
- one availability date
- one base/default pricing structure

### Breed Within Batch

A breed grouping that exists inside a batch.

Example: Cream Legbar within the June 1 batch.

Breed-within-batch records should connect through seller breed profiles. Seller breed profiles bridge platform-managed breed templates with seller-specific display names, descriptions, private notes, and custom breed names.

### Inventory Item

A specific sellable inventory type within a breed grouping. Inventory items are the actual sellable units tied to quantity and pricing.

Examples:

- Female
- Male
- Straight Run
- Pair
- Trio
- Mixed
- Unknown

Avoid inconsistent terminology such as listing row, breed row, line item, or product listing unless referring only to UI presentation.

## Seller Workflow Philosophy

This is livestock ecommerce, not a classified listing platform.

Sellers do not manually build storefront pages. Sellers enter structured inventory facts, and the system automatically generates a clean shopping experience.

Primary goals:

- fast seller workflow
- mobile-friendly inventory management
- breed-first buyer experience
- minimal onboarding friction
- standardized data where useful
- flexible future expansion without overbuilding V1

## Storefront Modes

Each store may operate in only one storefront mode at a time to avoid duplicate inventory presentation, customer confusion, and split order flows.

Supported V1 storefront modes:

- `hosted` — seller uses a FlockFront-hosted storefront page
- `embedded` — seller uses FlockFront inventory/order components embedded into their own website
- `private` — storefront is not publicly active

The storefront mode is controlled at the store level, not per batch or inventory item.

Listings, inventory, pricing, batches, and orders remain centralized regardless of storefront mode.

Hosted storefronts use a public storefront slug. Embedded storefronts use a secure embed token tied to the seller store. Future embedded storefronts may support domain allowlists.

## Buyer Access Model

V1 storefronts are direct-access storefronts. Buyers typically arrive through seller-shared links, social media, breeder referrals, QR codes, seller websites, email campaigns, or local community groups.

Storefront browsing occurs within an individual seller's store only.

Buyer browsing should be breed-first. Seller operations should remain batch-first.

## Inventory Behavior

Inventory decreases only when an official order is created.

For pay-at-pickup orders:

- buyer submits order
- official order is created immediately
- inventory decreases immediately
- payment status begins as unpaid/pay-at-pickup

For Stripe/card checkout orders:

- buyer begins Stripe checkout
- no official order exists yet
- no inventory decrease occurs yet
- payment succeeds through Stripe-hosted checkout
- Stripe webhook/payment confirmation triggers official order creation
- inventory decreases when the official order is created

Failed, expired, or abandoned Stripe checkouts do not create orders and do not decrease inventory.

V1 intentionally does not include temporary inventory holds, cart reservations, checkout countdown timers, or advanced inventory locking systems.

Inventory changes must be validated and applied server-side. The frontend must never directly control final inventory counts.

If simultaneous purchases occur and inventory becomes unavailable before final order creation, the system should gracefully prevent overselling wherever possible through server-side validation.

## Age Logic

Age is calculated from dates, not selected manually by the seller.

Core calculation:

Available Date minus Hatch/Birth/Acquisition Date

This determines the age buyers see when animals are available.

The system may store or calculate:

- `age_at_availability_days`
- current age based on current date
- optional species-specific display label

Internal source of truth is numeric age in days. Buyer-facing labels may display weeks, months, or species-specific categories.

Examples for chickens:

- Chick
- Started Chick
- Growout
- Point of Lay

Other species may simply display a numeric age such as "8 weeks old."

## Pricing Logic

Each batch has a base/default price.

Inventory items may optionally override the batch price.

Optional V1/Future-compatible batch-level automatic weekly price increases may support growing animals. If enabled, the price increase applies to the inventory item's effective starting price. If the item has a price override, the increase applies to the overridden price rather than the batch base price.

## Species and Breed Philosophy

One storefront may support multiple species in V1.

Species-specific questions should remain minimal so additional species such as rabbits or gamebirds can be supported without redesigning the core architecture.

Platform-managed global species and breed templates provide standardized defaults. Seller-specific custom breed profiles belong to the seller's store and do not automatically become global templates.

Canonical breed names and aliases should normalize common variations to reduce duplicate breed chaos.

Seller-created breed names remain in seller breed profiles. They are not automatically promoted into platform-managed breed templates.

## Photo Architecture

Breed profile images and listing/batch images are separate concepts.

Seller breed profile images represent the seller's long-term default photos for a breed. Listing/batch/inventory images represent the specific current group being sold.

Uploading a listing-specific image must not automatically replace the seller's default breed profile image.

Recommended image fallback order:

1. listing/batch/inventory-specific image
2. seller breed profile image
3. global breed template/default image
4. generic species placeholder image

V1 should keep photo management lightweight:

- one primary store logo/banner
- farm/about photos
- seller breed profile photos
- optional listing/inventory photos
- no full gallery/media management system initially

## Communication Philosophy

V1 does not include internal messaging, chat systems, buyer/seller inboxes, reviews, ratings, or platform-mediated dispute workflows.

Communication occurs through seller email, optional seller phone number, order confirmation emails, and manual pickup coordination.

Public phone visibility is controlled by the seller.

FlockFront should remain minimally visible to buyers beyond basic platform branding such as "Powered by FlockFront."

## Core Architecture Rule

Seller enters inventory facts. The system generates storefront structure automatically.

Operational simplicity is a core platform feature, not a temporary limitation.

## Current Backend Capability Summary

The frozen V1 backend now supports:

- Store ownership, seller/admin access helpers, and RLS-backed tenant isolation.
- Species, breed reference data, seller breed profiles, listing batches, breed-within-batch rows, inventory items, and media links.
- Public storefront projections that expose only live, enabled, public-safe storefront and inventory data.
- Seller-controlled storefront publication through `storefront_enabled`.
- Guest checkout foundation and trusted pay-at-pickup order creation with server-side price, availability, and inventory validation.
- Seller order management, fulfillment, cancellation, partial fulfillment, inventory restoration, manual order creation, and refund tracking.
- Transactional email notification outbox, lifecycle enqueueing, processing/retry controls, and integration worker support.
- Seller dashboard operational projections and seller-facing dashboard API support views.
- Admin operational visibility, store suspension/reactivation, admin audit events, and recovery wrappers.
- Stripe database-side integration foundation for hosted checkout, payment provider events, webhook idempotency, checkout session reconciliation, and refund reconciliation.
- Public storefront and checkout API support for buyer UI development without exposing private seller, customer, payment, notification, or admin data.

## Migration Group Index

1. Group 1, Ownership & Access Foundation: stores, roles, ownership helpers, and base RLS.
2. Group 2, Species & Breed Reference Data: species and global breed reference data.
3. Group 3, Seller Breed Profiles: seller-owned breed display and notes layer.
4. Group 4, Listing Batches: seller batch/date/pricing inventory grouping.
5. Group 5, Listing Batch Breeds: breed groupings inside batches.
6. Group 6, Inventory Items: sellable inventory rows and quantity source of truth.
7. Group 7, Media Assets & Media Links: reusable image/media attachment model.
8. Group 8, Public Storefront Projection Layer: buyer-safe public storefront and inventory views.
9. Group 9A, Breed Catalog Schema Refinement: breed catalog normalization refinements.
10. Group 10, Customers, Orders & Order Items Foundation: customer, order, and order item records.
11. Group 11, Trusted Order Creation Foundation: server-side checkout/order creation and inventory decrement.
12. Group 12, Seller Order Management & Fulfillment Foundation: seller order lifecycle operations.
13. Group 13, Storefront Discovery & Search Foundation: constrained opt-in discovery/search support.
14. Group 14, Public Storefront Delivery Foundation: pickup and delivery-facing storefront fields/status lookup.
15. Group 15, Checkout Delivery Foundation: checkout contact/address snapshots and validation.
16. Group 16, Seller Storefront Configuration Foundation: seller storefront publication toggle and availability logic.
17. Group 17, Seller Dashboard Operational Projection Layer: dashboard status, inventory, order, and attention views.
18. Group 18, Email Notification Foundation: provider-agnostic transactional email outbox.
19. Group 19, Notification Lifecycle Integration: lifecycle enqueueing for order notifications.
20. Group 20, Seller Inventory Operations Foundation: trusted seller inventory operation RPCs and activity logging.
21. Group 21, Notification Processing Foundation: notification claiming, retry, sent, failed, and suppression controls.
22. Group 22, Seller Manual Order Creation Foundation: seller-created offline/manual orders with inventory override safety.
23. Group 23, Fulfillment Workflow & Refund Foundation: partial fulfillment, inventory restoration, and refund records.
24. Group 24, Admin Operations Foundation: platform operations views, store suspension, and admin audit.
25. Group 25, Stripe Payment Integration Foundation: hosted checkout/payment provider event and refund reconciliation foundation.
26. Group 26, Edge Function & Integration Foundation: worker run audit and integration recovery support.
27. Group 27, Seller Dashboard API Support Layer: seller-facing dashboard read projections for UI development.
28. Group 28, Public Storefront / Checkout API Support Layer: buyer-facing public storefront and checkout summary support.
