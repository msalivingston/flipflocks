# FlipFlocks V1 Core Architecture

## Platform Identity

FlipFlocks is seller storefront infrastructure for livestock sellers. It is not a centralized public marketplace.

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

A seller's storefront/business presence on FlipFlocks.

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

- `hosted` — seller uses a FlipFlocks-hosted storefront page
- `embedded` — seller uses FlipFlocks inventory/order components embedded into their own website
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

FlipFlocks should remain minimally visible to buyers beyond basic platform branding such as "Powered by FlipFlocks."

## Core Architecture Rule

Seller enters inventory facts. The system generates storefront structure automatically.

Operational simplicity is a core platform feature, not a temporary limitation.
