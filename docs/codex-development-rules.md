# Codex Development Rules for FlipFlocks

These rules are for AI-assisted development. They are intended to prevent architectural drift.

## Read Docs First

Before making any code, schema, migration, or RLS changes, read:

1. `docs/flipflocks-core-architecture.md`
2. `docs/flipflocks-v1-scope.md`
3. `docs/flipflocks-schema-plan.md`
4. `docs/flipflocks-security-rls.md`
5. `docs/codex-development-rules.md`

If existing code conflicts with these documents, report the conflict and stop before changing anything.

## Do Not Invent Product Direction

FlipFlocks is not a centralized marketplace.

Do not add or assume:

- marketplace browsing
- public seller directory
- platform-wide search across sellers
- buyer/seller messaging
- reviews
- ratings
- shipping
- auctions
- escrow
- platform-held buyer payments
- transaction fees on seller sales
- social/community features
- complex CRM features

## Work in Small Steps

Make one meaningful change at a time.

Preferred workflow:

1. inspect relevant files
2. explain the intended change
3. make the smallest useful change
4. run lint/build when appropriate
5. report files changed
6. stop

Do not refactor unrelated code.

Do not "clean up" broad areas of the project unless specifically asked.

## Schema Changes Require Gap Analysis First

Core backend architecture is complete through Group 28 and is frozen for V1 implementation.

Future migrations should be limited to:

- reference seed data
- defects found during implementation or testing
- security hardening
- performance indexes
- proven missing V1 requirements

Before editing Supabase schema or migrations:

1. inspect current schema/migrations/app references
2. compare against `docs/flipflocks-schema-plan.md`
3. produce a gap analysis
4. stop for review

Do not create, rename, or drop tables without explicit approval.

Do not assume current test tables are final.

## RLS and Security Rules

Never weaken RLS to make code work.

Sensitive operations must be server-side:

- inventory decrement
- order creation
- payment confirmation
- admin actions
- subscription access changes
- final price/total calculation

Frontend code may collect intent, but server-side code must validate ownership, availability, pricing, and permissions.

## Naming Discipline

Use the canonical hierarchy:

Store
→ Batch
→ Breed Within Batch
→ Inventory Item

Preferred database naming:

- `stores`
- `listing_batches`
- `listing_batch_breeds`
- `inventory_items`

Use `storefront` for public-facing UI language. Use `stores` for database table language.

Avoid introducing generic `products` or `listings` tables unless specifically approved.

## Inventory Rule

Inventory decreases only when an official order is created.

Pay at pickup:

- official order is created immediately at buyer submission
- inventory decreases immediately
- payment status remains unpaid/pay-at-pickup

Stripe checkout:

- no official order during incomplete checkout
- no inventory decrease during incomplete checkout
- official order is created only after successful payment confirmation
- inventory decreases when that official order is created

## UI Rules

V1 should be mobile-first, simple, and seller-friendly.

Sellers enter structured facts. The system generates the storefront.

Avoid UI that makes sellers manually design storefront pages.

Avoid adding complex dashboards, charts, or analytics unless explicitly requested.

## Admin Rules

Admin V1 should be plain and functional.

Core admin pattern:

1. find the record
2. view status
3. change status if needed
4. leave a note
5. log the action

Do not build a complex admin analytics dashboard in V1 unless explicitly requested.

## Commit Hygiene

Before recommending a commit:

- run `npm run lint` if relevant
- run `npm run build` if relevant
- report changed files
- summarize exactly what changed

If Git operations fail because of permissions, report the issue and provide local terminal commands for the user to run.

## Stop Conditions

Stop and ask/report before continuing if:

- schema changes are needed
- RLS policies need changing
- a doc/code conflict is found
- a V1/future scope ambiguity appears
- an architectural assumption is unclear
- a change touches payments, inventory decrement, or admin permissions
- implementation would require adding excluded V1 features

## Project Owner Preferences

The project owner prefers practical, specific instructions. When giving code patches or local commands, be explicit about where the change goes and what command to run.

Avoid vague guidance.
