# FlipFlocks V1 Documentation Package

These documents define the working architecture for FlipFlocks V1. They are intended to be committed into the project repo under `/docs` and used as the source of truth for Codex-assisted development.

## Current Backend Status

Core backend architecture is complete through Group 28 and is considered frozen for V1 implementation work.

Future database migrations should be limited to:

- reference seed data
- defects found during implementation or testing
- security hardening
- performance indexes
- proven missing V1 requirements

Next phase:

1. Reference seed data
2. Edge Functions
3. Seller dashboard UI
4. Public storefront and checkout UI
5. End-to-end testing

Recommended reading order for Codex:

1. `flipflocks-core-architecture.md`
2. `flipflocks-v1-scope.md`
3. `flipflocks-schema-plan.md`
4. `flipflocks-security-rls.md`
5. `codex-development-rules.md`

Group implementation notes:

- `group-29-seller-api-safety.md`
- `group-30-public-storefront-pay-at-pickup-api.md`
- `group-31-seller-ui-foundation.md`
- `group-31-ui-implementation-readiness-review.md`
- `group-32a-seller-ui-support-gaps.md`
- `group-32b-media-foundation-design-review.md`
- `group-32b-media-foundation-implementation.md`
- `group-71-lightweight-platform-admin-dashboard.md`
- `group-72-admin-breed-catalog-image-manager.md`

Core instruction for Codex:

Read these documents before making changes. If existing code or schema conflicts with these documents, report the conflict and stop before changing code, schema, migrations, or RLS policies.
