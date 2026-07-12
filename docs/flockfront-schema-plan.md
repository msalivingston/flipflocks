# FlockFront V1 Schema Plan

This document describes the intended schema direction. It should be compared against the current Supabase schema before creating migrations.

## Implementation Status

The core backend schema and database-side operations layer are complete through Group 28 and are frozen for V1 implementation. This document remains useful as architectural context, but the applied Supabase migrations are now the source of truth for the implemented schema.

Future migrations should be limited to:

- reference seed data
- implementation or testing defects
- security hardening
- performance indexes
- proven missing V1 requirements

Do not redesign the Groups 1-28 backend unless a genuine defect is found.

## Implemented Migration Groups

| Group | Name | One-line description |
| --- | --- | --- |
| 1 | Ownership & Access Foundation | Stores, roles, ownership helpers, and base RLS. |
| 2 | Species & Breed Reference Data | Species and global breed reference data. |
| 3 | Seller Breed Profiles | Seller-owned breed display, description, and notes layer. |
| 4 | Listing Batches | Seller batch/date/pricing inventory grouping. |
| 5 | Listing Batch Breeds | Breed groupings inside listing batches. |
| 6 | Inventory Items | Sellable inventory rows and quantity source of truth. |
| 7 | Media Assets & Media Links | Reusable image/media attachment model. |
| 8 | Public Storefront Projection Layer | Buyer-safe public storefront and inventory views. |
| 9A | Breed Catalog Schema Refinement | Breed catalog normalization refinements. |
| 10 | Customers, Orders & Order Items Foundation | Customer, order, and order item records. |
| 11 | Trusted Order Creation Foundation | Server-side order creation and inventory decrement. |
| 12 | Seller Order Management & Fulfillment Foundation | Seller order lifecycle operations. |
| 13 | Storefront Discovery & Search Foundation | Constrained opt-in discovery/search support. |
| 14 | Public Storefront Delivery Foundation | Pickup and delivery-facing storefront fields/status lookup. |
| 15 | Checkout Delivery Foundation | Checkout contact/address snapshots and validation. |
| 16 | Seller Storefront Configuration Foundation | Seller storefront publication toggle and availability logic. |
| 17 | Seller Dashboard Operational Projection Layer | Dashboard status, inventory, order, and attention views. |
| 18 | Email Notification Foundation | Provider-agnostic transactional email outbox. |
| 19 | Notification Lifecycle Integration | Lifecycle enqueueing for order notifications. |
| 20 | Seller Inventory Operations Foundation | Trusted seller inventory operation RPCs and activity logging. |
| 21 | Notification Processing Foundation | Notification claiming, retry, sent, failed, and suppression controls. |
| 22 | Seller Manual Order Creation Foundation | Seller-created offline/manual orders with inventory override safety. |
| 23 | Fulfillment Workflow & Refund Foundation | Partial fulfillment, inventory restoration, and refund records. |
| 24 | Admin Operations Foundation | Platform operations views, store suspension, and admin audit. |
| 25 | Stripe Payment Integration Foundation | Hosted checkout, provider event, and refund reconciliation foundation. |
| 26 | Edge Function & Integration Foundation | Worker run audit and integration recovery support. |
| 27 | Seller Dashboard API Support Layer | Seller-facing dashboard read projections for UI development. |
| 28 | Public Storefront / Checkout API Support Layer | Buyer-facing storefront and checkout summary support. |

## Reference Seed Foundation

The platform-managed reference catalog exists for seller onboarding, buyer search, filtering, discoverability, and future analytics. It is not intended to model every breeder program, strain, project, or line.

Catalog naming uses `Breed - Variety` when a variety is part of the platform-managed record, for example `Marans - Black Copper` and `Wyandotte - Silver Laced`. Do not invert these names into `Black Copper Marans` or `Silver Laced Wyandotte` in seed data.

For chickens, `public.breeds.category` uses product-facing V1 labels for seller onboarding and buyer filtering:

- Layers
- Meat Birds
- Bantams
- Dual Purpose
- Ornamental / Exhibition
- Specialty / Project
- Farmers Choice

Bantam wording remains in catalog names when it is buyer/seller meaningful, including entries such as `Bantam Ameraucana - Black`, `Bantam Wyandotte - Silver Laced`, `Old English Game Bantam - Birchen`, and `Dutch Bantam`. All bantam breeds and bantam-first types should use category `Bantams`, including commonly bantam-focused entries whose names do not include `Bantam`, such as `Sebright - Golden` and `Serama`. This intentional redundancy avoids name and slug collisions with standard-size variants.

Seller-created breed profiles remain the place for breeder-specific details such as lines, projects, generation notes, selection goals, and private breeder notes. Examples that must remain seller-created content rather than global catalog entries include dark egg projects, F5 selections, foundation lines, annual breeding groups, and named seller projects.

Reference seed migrations should use a hybrid/phased approach:

- seed all supported species required by V1
- seed a curated practical catalog for common poultry and specialty sellers
- add future catalog records through reviewed reference-data migrations
- avoid importing large poultry encyclopedias or speculative aliases
- avoid AI-generated breed descriptions, placeholder marketing copy, and placeholder images

The current supported species seed set is:

- Chickens
- Ducks
- Geese
- Turkeys
- Guinea Fowl
- Quail
- Pheasants
- Peafowl
- Pigeons & Doves
- Emus, Ostriches & Rheas

Use only practical, high-confidence global aliases. Seller-defined aliases should not become platform-wide aliases automatically.

Do not assume current test tables are final. If existing tables conflict with this plan, report the conflict before editing schema or app code.

## Naming Principles

Use plural table names.

Use `stores` for seller storefront/business records. Use "storefront" in UI language when referring to the public presentation.

Use the canonical hierarchy:

stores
→ listing_batches
→ listing_batch_breeds
→ inventory_items

The exact table names may be adjusted during implementation, but the hierarchy should remain stable.

## Core Tables

### store_pickup_options

Seller-defined pickup choices available during checkout.
Creating pickup options is optional. If a store has no active pickup options, checkout should rely on buyer notes/pickup notes only.

Fields:

- id
- store_id
- label
- sort_order
- is_active
- created_at
- updated_at

### seller_terms_acceptances

Purpose: track required seller terms acceptance.

Recommended fields:

- `id` UUID primary key
- `store_id` UUID references stores
- `terms_version` text
- `accepted_at` timestamptz
- `accepted_by_user_id` UUID references auth.users
- `ip_address` text nullable
- `user_agent` text nullable

### seller_billing_status

Purpose: mirror platform subscription/billing state needed for access control.

Recommended fields:

- `id` UUID primary key
- `store_id` UUID references stores unique
- `stripe_customer_id` text nullable
- `stripe_subscription_id` text nullable
- `billing_plan` text: monthly, yearly, dormancy, comped
- `subscription_status` text: trialing, active, past_due, dormant, canceled, comped, suspended
- `current_period_start` timestamptz nullable
- `current_period_end` timestamptz nullable
- `storefront_access_until` timestamptz nullable
- `trial_ends_at` timestamptz nullable
- `paused_at` timestamptz nullable
- `dormancy_started_at` timestamptz nullable
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()

Stripe remains source of truth for actual billing. This table mirrors access-critical values for app behavior.

### seller_onboarding_state

Purpose: lightweight checklist for setup and launch validation.

Recommended fields:

- `id` UUID primary key
- `store_id` UUID references stores unique
- `profile_complete` boolean default false
- `billing_complete` boolean default false
- `terms_accepted` boolean default false
- `first_listing_created` boolean default false
- `ready_to_launch` boolean default false
- `launched_at` timestamptz nullable
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()

Do not build complex step-by-step wizard tracking unless needed.

### species

Purpose: platform-managed species defaults.

Recommended fields:

- `id` UUID primary key
- `common_name` text
- `slug` text unique
- `is_active` boolean default true
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()

### global_breed_templates

Purpose: platform-managed default breed information.

Recommended fields:

- `id` UUID primary key
- `species_id` UUID references species
- `canonical_name` text
- `slug` text
- `description` text nullable
- `egg_color` text nullable
- `temperament` text nullable
- `production_traits` text nullable
- `default_image_url` text nullable
- `is_active` boolean default true
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()

### breed_aliases

Purpose: map search terms and misspellings to canonical global breed templates.

Recommended fields:

- `id` UUID primary key
- `global_breed_template_id` UUID references global_breed_templates
- `alias` text
- `created_at` timestamptz default now()

### seller_breed_profiles

Purpose: seller-specific breed notes, display naming, private seller notes, and future default breed photos.

Recommended fields:

- `id` UUID primary key
- `store_id` UUID references stores
- `species_id` UUID references species
- `breed_id` UUID references breeds nullable
- `custom_breed_name` text nullable
- `normalized_custom_breed_name` text nullable
- `display_name` text
- `seller_description` text nullable
- `seller_notes` text nullable
- `visibility_status` text default active
- `moderation_status` text default normal: normal, flagged
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()

Seller breed profiles are the bridge between platform-managed breeds and future `listing_batch_breeds`.

Seller-created custom breeds belong to the store in `seller_breed_profiles`. They do not automatically become global templates or rows in `breeds`.

Each seller breed profile must have exactly one breed source:

- `breed_id`
- `custom_breed_name`

Do not allow both, and do not allow neither.

Use `visibility_status = archived` instead of seller hard delete in V1. Do not create a seller delete policy for this table in V1.

`seller_notes` is private seller-only content and must not be exposed in public storefront views.

When `breed_id` is supplied, application/server validation must ensure `breeds.species_id` equals `seller_breed_profiles.species_id`.

Sellers must not be allowed to edit `moderation_status` through application UI or API handlers.

`display_name` is historical/public-facing content. Future order item snapshots should preserve historical breed naming rather than changing old orders when seller breed profiles are edited.

### listing_batches

Purpose: batch/date-based inventory grouping.

Recommended fields:

- `id` UUID primary key
- `store_id` UUID references stores
- `species_id` UUID references species
- `hatch_birth_acquisition_date` date
- `available_date` date
- `base_price` numeric
- `auto_price_increase_enabled` boolean default false
- `auto_price_increase_amount` numeric nullable
- `auto_price_increase_interval` text nullable
- `auto_price_increase_start` text nullable
- `auto_price_increase_max_price` numeric nullable
- `batch_notes` text nullable
- `visibility_status` text default active
- `moderation_status` text nullable
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()

A batch represents one species, one hatch/birth/acquisition date, one availability date, and one base pricing structure.

### listing_batch_breeds

Purpose: breed grouping inside a batch.

Recommended fields:

- `id` UUID primary key
- `store_id` UUID references stores
- `listing_batch_id` UUID references listing_batches
- `seller_breed_profile_id` UUID references seller_breed_profiles nullable
- `global_breed_template_id` UUID references global_breed_templates nullable
- `display_breed_name` text
- `breed_notes` text nullable
- `visibility_status` text default active
- `moderation_status` text nullable
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()

`listing_batch_breeds` should use `seller_breed_profiles` as the seller-owned bridge to platform-managed breeds or seller-created custom breed names.

### inventory_items

Purpose: actual sellable inventory units.

Recommended fields:

- `id` UUID primary key
- `store_id` UUID references stores
- `listing_batch_id` UUID references listing_batches
- `listing_batch_breed_id` UUID references listing_batch_breeds
- `inventory_type` text: female, male, straight_run, pair, trio, mixed, unknown, other
- `quantity_available` integer
- `price_override` numeric nullable
- `visibility_status` text default active
- `moderation_status` text nullable
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()

Inventory items are the sellable records used in cart/order logic.

Do not trust frontend-submitted quantity, price, or ownership. Final quantity and price must be validated server-side.

### customers

Purpose: operational customer memory for sellers.

Recommended fields:

- `id` UUID primary key
- `store_id` UUID references stores
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()
- `first_name` text
- `last_name` text
- `business_name` text nullable
- `email` text
- `phone` text nullable
- `city` text nullable
- `state` text nullable
- `country` text nullable
- `internal_notes` text nullable
- `total_orders` integer default 0
- `total_spent` numeric default 0
- `last_order_date` timestamptz nullable

Guest checkout should still create customer records. Customer records should survive deleted/canceled/refunded orders.

### orders

Purpose: official purchase/reservation transaction.

Recommended fields:

- `id` UUID primary key
- `store_id` UUID references stores
- `customer_id` UUID references customers
- `order_number` text
- `order_status` text: pending, open, fulfilled, canceled
- `payment_method` text: pay_at_pickup, stripe_checkout, private_manual
- `payment_status` text: unpaid, pay_at_pickup, paid, canceled, refunded
- `subtotal_amount` numeric
- `tax_fee_amount` numeric nullable
- `total_amount` numeric
- `buyer_notes` text nullable
- `pickup_note` text nullable
- `pickup_option_id` UUID references store_pickup_options nullable
- `pickup_option_label` text nullable
- `stripe_checkout_session_id` text nullable
- `stripe_payment_intent_id` text nullable
- `paid_at` timestamptz nullable
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()

Order item, quantity, and price edits should be restricted after paid, fulfilled, canceled, or Stripe-created orders.

### order_items

Purpose: item-level snapshot of purchased inventory.

Recommended fields:

- `id` UUID primary key
- `order_id` UUID references orders
- `store_id` UUID references stores
- `inventory_item_id` UUID references inventory_items
- `listing_batch_id` UUID references listing_batches
- `listing_batch_breed_id` UUID references listing_batch_breeds
- `species_name_snapshot` text
- `breed_name_snapshot` text
- `inventory_type_snapshot` text
- `ready_date_snapshot` date
- `age_at_availability_days_snapshot` integer nullable
- `unit_price_snapshot` numeric
- `quantity` integer
- `line_total` numeric
- `created_at` timestamptz default now()

Historical order item snapshots should not be overwritten when seller edits current listings.

Future order snapshots should preserve historical breed display naming from the listing/order context.

### store_photos

Purpose: farm/about/store photos.

Recommended fields:

- `id` UUID primary key
- `store_id` UUID references stores
- `storage_path` text
- `alt_text` text nullable
- `sort_order` integer default 0
- `moderation_status` text default pending
- `moderation_provider` text nullable
- `moderation_checked_at` timestamptz nullable
- `moderation_score` numeric nullable
- `moderation_reason` text nullable
- `created_at` timestamptz default now()

### seller_breed_profile_photos

Purpose: seller default breed photos.

Recommended fields:

- `id` UUID primary key
- `seller_breed_profile_id` UUID references seller_breed_profiles
- `store_id` UUID references stores
- `storage_path` text
- `alt_text` text nullable
- `sort_order` integer default 0
- `moderation_status` text default pending
- `created_at` timestamptz default now()

### listing_photos

Purpose: batch/breed/inventory-specific photos.

Recommended fields:

- `id` UUID primary key
- `store_id` UUID references stores
- `listing_batch_id` UUID references listing_batches nullable
- `listing_batch_breed_id` UUID references listing_batch_breeds nullable
- `inventory_item_id` UUID references inventory_items nullable
- `storage_path` text
- `alt_text` text nullable
- `sort_order` integer default 0
- `moderation_status` text default pending
- `created_at` timestamptz default now()

A photo should be attached to the most specific appropriate object. Do not let listing photos overwrite seller breed profile photos automatically.

## Admin and Audit Tables

### user_roles

Purpose: app-level role checks.

Recommended fields:

- `id` UUID primary key
- `user_id` UUID references auth.users
- `role` text: seller, admin, staff
- `store_id` UUID references stores nullable
- `created_at` timestamptz default now()

V1 UI may only support one owner per store, but schema can preserve future multi-user support.

### content_flags

Purpose: basic moderation tracking.

Recommended fields:

- `id` UUID primary key
- `store_id` UUID references stores nullable
- `target_table` text
- `target_record_id` UUID
- `flag_reason` text
- `status` text: open, reviewed, dismissed, action_taken
- `review_notes` text nullable
- `created_at` timestamptz default now()
- `reviewed_at` timestamptz nullable
- `reviewed_by_user_id` UUID references auth.users nullable

### admin_action_logs

Purpose: audit platform admin changes.

Recommended fields:

- `id` UUID primary key
- `admin_user_id` UUID references auth.users
- `affected_table` text
- `affected_record_id` UUID
- `action_type` text
- `note` text nullable
- `created_at` timestamptz default now()

Admin edits to seller-owned business records should create an admin action log entry.

## Launch Validation

A store may launch only when:

- store status is draft/setup state
- farm/business name exists
- store slug exists and is unique
- public city/state exist
- about text exists
- terms accepted
- billing active or trialing according to access rules
- at least one active listing exists
- no admin hold or suspension exists

## Soft Delete Policy

Use soft deletion/status fields for business-critical records.

Do not hard delete stores, users, orders, seller breed profiles, batches, inventory, or billing-related records in normal admin workflows.

Use statuses such as archived, hidden, inactive, canceled, suspended.

## Implementation Warning

Before creating migrations, inspect the existing Supabase schema and compare it to this plan. Produce a gap analysis first. Do not modify schema until the gap analysis is reviewed.
