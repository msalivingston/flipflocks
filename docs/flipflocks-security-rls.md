# FlipFlocks Security and RLS Rules

## Security Model

FlipFlocks uses a shared database with strict tenant separation through Supabase Row Level Security.

Every sensitive business record must be scoped to the correct store and user. Never trust frontend permissions.

Ownership and access must be validated through `auth.uid()` and server-side role checks.

## Foundational Security Assumptions

- FlipFlocks is storefront infrastructure, not a centralized marketplace.
- Each seller has an independent storefront.
- Sellers remain merchant of record for animal sales.
- FlipFlocks avoids custody of seller sale proceeds in V1.
- Stripe Connect direct seller flows are preferred for online checkout.
- FlipFlocks minimizes tax/1099/platform payout complexity.
- All sensitive data is protected by Supabase RLS.
- All sensitive ownership is enforced with `auth.uid()` and store ownership/role checks.
- Server-side APIs/functions are required for sensitive operations.
- Inventory decrements are transactional and server-side only.
- No direct frontend trust for pricing, inventory, payment status, or permissions.
- Minimal public exposure of seller and customer data.
- Simplicity and constrained workflows are security features.

## Primary Risks

Highest-priority risks:

- tenant data leakage
- broken RLS policies
- seller account compromise
- inventory manipulation
- price manipulation
- payment state inconsistencies
- admin overreach
- spam/scam storefronts
- scraping
- unsafe uploads

Less relevant V1 risks:

- marketplace escrow fraud
- centralized fulfillment fraud
- buyer/seller dispute arbitration systems
- platform-wide payout liability
- marketplace tax nexus exposure

## Authentication and Authorization

All sensitive data must be protected by Supabase RLS.

Never rely on frontend hiding, disabled buttons, route guards, or client-submitted IDs as the source of truth.

Seller-owned records must be accessible only to:

- the owning seller/user
- authorized future store staff
- platform admins with explicit role checks

Admin-only actions require explicit role checks. Do not grant broad access without corresponding audit logs.

## Server-Side Business Logic

The frontend must never directly control final values for:

- inventory counts
- order completion
- payment status
- seller subscription state
- refunds
- admin actions
- final order totals
- final item prices
- ownership assignment

These operations must occur through secure backend APIs, server actions, Supabase RPC functions, or Edge Functions with appropriate validation.

## Inventory Security

Inventory decreases only when an official order is created.

Pay-at-pickup orders create the official order immediately and decrease inventory immediately.

Stripe checkout orders create the official order only after successful payment confirmation, normally through a verified webhook or equivalent trusted server-side confirmation.

Before order creation, server-side logic must validate:

- store is active/eligible
- inventory item exists
- inventory item belongs to the store
- item is visible/sellable
- requested quantity is available
- effective price is calculated from trusted database values
- buyer-facing totals are recalculated server-side

Do not trust cart totals, item prices, or quantities submitted from the browser.

## Payment Security

Stripe is the source of truth for payment status.

Stripe webhooks must be cryptographically verified using Stripe signature validation.

FlipFlocks must not collect or store:

- raw credit card numbers
- seller bank account information
- Social Security numbers
- tax IDs
- identity verification documents

Seller order payments should use Stripe-hosted checkout for card payments. Sellers remain merchant of record.

Platform billing is separate from seller order payments.

## RLS Policy Principles

Every seller-owned table should include a `store_id` whenever practical.

RLS policies should follow these patterns:

- sellers can read their own store records
- sellers can manage records where `store_id` belongs to a store they own or are authorized for
- buyers/anonymous users can read only public, active storefront records needed for shopping
- buyers/anonymous users cannot read private seller data, customer data, admin data, billing data, or order history
- admins can access records only through explicit admin role checks

Avoid direct public access to entire tables. Create carefully limited public read policies or server-side views/functions for public storefront display.

## Public Data Boundaries

Public storefronts may show:

- farm/store name
- public city/state/general location
- about text
- optional website/social links
- seller-controlled public phone/email visibility
- public pickup/cancellation policy text
- public active inventory
- approved public photos
- seller-chosen NPIP display if enabled

Public storefronts must not expose:

- exact pickup address unless seller explicitly publishes it
- buyer/customer records
- order records
- seller private notes
- admin notes
- billing/subscription internals
- non-public phone/email fields
- internal sales totals
- Stripe IDs
- private moderation data

## File Upload Safety

V1 image uploads only.

Required controls:

- file type restrictions
- file size limits
- randomized filenames/storage paths
- resizing/compression where practical
- signed URLs for private/admin assets where appropriate
- moderation status before public display

Image moderation should be tuned for livestock context. Poultry and livestock terms should not trigger rejection by themselves.

## Logging and Auditing

Critical actions should be logged:

- admin changes
- store suspension/unsuspension
- content hiding/unhiding
- subscription access overrides
- inventory edits
- order cancellations
- refund-related records if added later
- visibility changes

Admin edits to seller-owned records should create admin action log entries.

## Rate Limiting and Abuse Prevention

Before public launch, implement or plan controls for:

- signup abuse
- login abuse
- public order spam
- upload spam
- scraping
- fake/scam storefronts

CAPTCHA and rate limiting may be appropriate for signup, order submission, and other public endpoints.

## Development Discipline

- No direct production edits.
- Use tracked migrations for schema changes.
- Review AI-generated code before merge.
- Run lint/build before commits.
- Security review before deployment.
- Test RLS before launch.
- Never disable RLS to make development easier unless working in a clearly isolated local throwaway environment.
- If a feature requires bypassing RLS, stop and redesign.

## V1 Risk Reduction Rule

Avoid features that dramatically increase security, liability, or moderation risk in V1, including:

- internal messaging
- escrow
- wallet systems
- platform-held funds
- public APIs
- multi-admin organizations
- plugins/extensions
- complex automation around disputes/refunds
