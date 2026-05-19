# FlipFlocks V1 Schema Plan

This document describes the intended schema direction. It should be compared against the current Supabase schema before creating migrations.

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
- `age_label_rules` jsonb nullable
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

Purpose: seller-specific breed notes and default breed photos.

Recommended fields:

- `id` UUID primary key
- `store_id` UUID references stores
- `species_id` UUID references species
- `global_breed_template_id` UUID references global_breed_templates nullable
- `custom_breed_name` text nullable
- `seller_description` text nullable
- `seller_notes` text nullable
- `visibility_status` text default active
- `moderation_status` text nullable
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()

Seller-created custom breeds belong to the store. They do not automatically become global templates.

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
- `pickup_note` text nullable
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
